import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import {
  buildSteps,
  computeCalmar,
  runTqqqQldStrategy
} from "./tqqq-qld-direct-study.js";

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.split("=", 2);
    const key = rawKey.slice(2);
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function ensurePositive(value) {
  return Math.max(0.0001, value);
}

function buildSyntheticLeveragedBars(baseBars, leverage, startDate) {
  const startIndex = baseBars.findIndex((bar) => bar.date >= startDate);
  if (startIndex <= 0) {
    throw new Error(`Synthetic leveraged series start date is invalid: ${startDate}`);
  }

  const syntheticBars = [];
  let syntheticPrevClose = 100;
  let basePrevClose = baseBars[startIndex - 1].adjClose;

  for (let index = startIndex; index < baseBars.length; index += 1) {
    const bar = baseBars[index];
    const open = ensurePositive(
      syntheticPrevClose * (1 + leverage * (bar.adjOpen / basePrevClose - 1))
    );
    const highCandidate = ensurePositive(
      syntheticPrevClose * (1 + leverage * (bar.adjHigh / basePrevClose - 1))
    );
    const lowCandidate = ensurePositive(
      syntheticPrevClose * (1 + leverage * (bar.adjLow / basePrevClose - 1))
    );
    const close = ensurePositive(
      syntheticPrevClose * (1 + leverage * (bar.adjClose / basePrevClose - 1))
    );
    const high = Math.max(open, close, highCandidate, lowCandidate);
    const low = Math.min(open, close, highCandidate, lowCandidate);

    syntheticBars.push({
      date: bar.date,
      open,
      high,
      low,
      close,
      adjClose: close,
      adjOpen: open,
      adjHigh: high,
      adjLow: low,
      volume: bar.volume
    });

    syntheticPrevClose = close;
    basePrevClose = bar.adjClose;
  }

  return syntheticBars;
}

function rankRows(rows, key) {
  return [...rows].sort(
    (left, right) =>
      (right[key] ?? Number.NEGATIVE_INFINITY) - (left[key] ?? Number.NEGATIVE_INFINITY) ||
      left.step1ThresholdPct - right.step1ThresholdPct ||
      left.step2ThresholdPct - right.step2ThresholdPct ||
      left.step1SellPct - right.step1SellPct ||
      left.step2SellPct - right.step2SellPct
  );
}

function logProgress(label, current, total) {
  if (current === total || current % 250 === 0) {
    console.log(`[${label}] ${current}/${total}`);
  }
}

function evaluate({
  signalBars,
  riskBars,
  spymBars,
  sgovBars,
  confirmationDays,
  feeRate,
  slippageRate,
  taxRate,
  basicDeduction,
  steps
}) {
  return runTqqqQldStrategy({
    signalBars,
    riskBars,
    spymBars,
    sgovBars,
    initialCapital: 100_000,
    confirmationDays,
    feeRate,
    slippageRate,
    profitTakeSteps: steps,
    profitTakeParking: { spym: 1, sgov: 0 },
    taxMode: "taxed",
    taxRate,
    basicDeduction
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const outputPath = path.resolve(
    cwd,
    String(options.output || "results/tqqq-qld-profit-take-sweep.json")
  );
  const confirmationDays = Number(options["confirmation-days"] || 3);
  const taxRate = Number(options["tax-rate"] ?? 0.099);
  const basicDeduction = Number(options["tax-deduction"] ?? 0);
  const feeRate = 0.0025;
  const slippageRate = 0.0005;

  const datasets = await loadRequiredData(dataDir, {
    tqqq: "us/tqqq.csv",
    qqq: "us/qqq.csv",
    spym: "us/spym.csv",
    sgov: "us/sgov.csv"
  });
  const startDate = datasets.tqqq[0].date;
  const signalBars = datasets.tqqq.filter((bar) => bar.date >= startDate);
  const riskBars = buildSyntheticLeveragedBars(datasets.qqq, 2, startDate);
  const spymBars = datasets.spym.filter((bar) => bar.date >= startDate);
  const sgovBars = datasets.sgov.filter((bar) => bar.date >= startDate);

  const coarseRows = [];
  const coarseStep1Thresholds = [10, 20, 30, 40, 50, 65, 80, 100];
  const coarseStep2Thresholds = [40, 50, 65, 80, 100, 120, 140, 160, 200];
  const coarseStep1Sells = [10, 20, 25, 30, 40, 50, 60, 70, 80];
  const coarseStep2Sells = [50, 60, 70, 80, 90, 100];
  const coarseTotal =
    coarseStep1Thresholds.length *
    coarseStep2Thresholds.length *
    coarseStep1Sells.length *
    coarseStep2Sells.length;
  let coarseCounter = 0;

  for (const step1ThresholdPct of coarseStep1Thresholds) {
    for (const step2ThresholdPct of coarseStep2Thresholds) {
      if (step2ThresholdPct <= step1ThresholdPct) {
        continue;
      }

      for (const step1SellPct of coarseStep1Sells) {
        for (const step2SellPct of coarseStep2Sells) {
          coarseCounter += 1;
          logProgress("coarse", coarseCounter, coarseTotal);

          const steps = buildSteps([
            { threshold: step1ThresholdPct / 100, sellFraction: step1SellPct / 100 },
            { threshold: step2ThresholdPct / 100, sellFraction: step2SellPct / 100 }
          ]);
          const result = evaluate({
            signalBars,
            riskBars,
            spymBars,
            sgovBars,
            confirmationDays,
            feeRate,
            slippageRate,
            taxRate,
            basicDeduction,
            steps
          });

          coarseRows.push({
            step1ThresholdPct,
            step2ThresholdPct,
            step1SellPct,
            step2SellPct,
            cagr: result.metrics.cagr,
            mdd: result.metrics.maxDrawdown,
            calmar: computeCalmar(result.metrics.cagr, result.metrics.maxDrawdown),
            totalReturn: result.metrics.totalReturn,
            endingValue: result.metrics.endingValue,
            tradeCount: result.metrics.tradeCount,
            winRate: result.metrics.winRate,
            avgHoldDays: result.metrics.avgHoldDays,
            profitTakeCount: result.metrics.profitTakeCount,
            annualTaxPaid: result.metrics.annualTaxPaid
          });
        }
      }
    }
  }

  const topCoarseCagr = rankRows(coarseRows, "cagr").slice(0, 2);
  const topCoarseCalmar = rankRows(coarseRows, "calmar").slice(0, 2);
  const seedMap = new Map();
  for (const seed of [...topCoarseCagr, ...topCoarseCalmar]) {
    seedMap.set(
      [seed.step1ThresholdPct, seed.step2ThresholdPct, seed.step1SellPct, seed.step2SellPct].join("-"),
      seed
    );
  }

  const refinedRows = [];
  const seen = new Set();
  let refinedTotal = 0;
  for (const seed of seedMap.values()) {
    const s1tMin = Math.max(5, seed.step1ThresholdPct - 5);
    const s1tMax = Math.min(120, seed.step1ThresholdPct + 5);
    const s2tMin = Math.max(s1tMin + 5, seed.step2ThresholdPct - 10);
    const s2tMax = Math.min(220, seed.step2ThresholdPct + 10);
    const s1sMin = Math.max(5, seed.step1SellPct - 10);
    const s1sMax = Math.min(90, seed.step1SellPct + 10);
    const s2sMin = Math.max(40, seed.step2SellPct - 10);
    const s2sMax = Math.min(100, seed.step2SellPct + 10);
    refinedTotal +=
      (Math.floor((s1tMax - s1tMin) / 5) + 1) *
      (Math.floor((s2tMax - s2tMin) / 5) + 1) *
      (Math.floor((s1sMax - s1sMin) / 5) + 1) *
      (Math.floor((s2sMax - s2sMin) / 5) + 1);
  }

  let refinedCounter = 0;
  for (const seed of seedMap.values()) {
    for (
      let step1ThresholdPct = Math.max(5, seed.step1ThresholdPct - 5);
      step1ThresholdPct <= Math.min(120, seed.step1ThresholdPct + 5);
      step1ThresholdPct += 5
    ) {
      for (
        let step2ThresholdPct = Math.max(step1ThresholdPct + 5, seed.step2ThresholdPct - 10);
        step2ThresholdPct <= Math.min(220, seed.step2ThresholdPct + 10);
        step2ThresholdPct += 5
      ) {
        for (
          let step1SellPct = Math.max(5, seed.step1SellPct - 10);
          step1SellPct <= Math.min(90, seed.step1SellPct + 10);
          step1SellPct += 5
        ) {
          for (
            let step2SellPct = Math.max(40, seed.step2SellPct - 10);
            step2SellPct <= Math.min(100, seed.step2SellPct + 10);
            step2SellPct += 5
          ) {
            const key = [
              step1ThresholdPct,
              step2ThresholdPct,
              step1SellPct,
              step2SellPct
            ].join("-");
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
            refinedCounter += 1;
            logProgress("refined", refinedCounter, refinedTotal);

            const steps = buildSteps([
              { threshold: step1ThresholdPct / 100, sellFraction: step1SellPct / 100 },
              { threshold: step2ThresholdPct / 100, sellFraction: step2SellPct / 100 }
            ]);
            const result = evaluate({
              signalBars,
              riskBars,
              spymBars,
              sgovBars,
              confirmationDays,
              feeRate,
              slippageRate,
              taxRate,
              basicDeduction,
              steps
            });

            refinedRows.push({
              step1ThresholdPct,
              step2ThresholdPct,
              step1SellPct,
              step2SellPct,
              cagr: result.metrics.cagr,
              mdd: result.metrics.maxDrawdown,
              calmar: computeCalmar(result.metrics.cagr, result.metrics.maxDrawdown),
              totalReturn: result.metrics.totalReturn,
              endingValue: result.metrics.endingValue,
              tradeCount: result.metrics.tradeCount,
              winRate: result.metrics.winRate,
              avgHoldDays: result.metrics.avgHoldDays,
              profitTakeCount: result.metrics.profitTakeCount,
              annualTaxPaid: result.metrics.annualTaxPaid
            });
          }
        }
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      model: "TQQQ signal + synthetic 2x QQQ execution + SPYM parking",
      taxRate,
      basicDeduction,
      confirmationDays,
      feeRate,
      slippageRate,
      startDate,
      endDate: signalBars.at(-1)?.date ?? null
    },
    coarseSummary: {
      evaluatedCount: coarseRows.length,
      topCagr: rankRows(coarseRows, "cagr").slice(0, 20),
      topCalmar: rankRows(coarseRows, "calmar").slice(0, 20)
    },
    refinedSummary: {
      evaluatedCount: refinedRows.length,
      topCagr: rankRows(refinedRows, "cagr").slice(0, 20),
      topCalmar: rankRows(refinedRows, "calmar").slice(0, 20)
    }
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        confirmationDays,
        bestCagr: rankRows(refinedRows, "cagr")[0],
        bestCalmar: rankRows(refinedRows, "calmar")[0]
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
