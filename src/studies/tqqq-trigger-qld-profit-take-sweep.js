import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import {
  buildSteps,
  computeCalmar,
  runTqqqTriggeredQldStrategy
} from "./tqqq-trigger-qld-direct-study.js";

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
  return runTqqqTriggeredQldStrategy({
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
    String(options.output || "results/tqqq-trigger-qld-profit-take-sweep.json")
  );
  const confirmationDays = Number(options["confirmation-days"] || 3);
  const taxRate = Number(options["tax-rate"] ?? 0.099);
  const basicDeduction = Number(options["tax-deduction"] ?? 0);
  const feeRate = 0.0025;
  const slippageRate = 0.0005;

  const datasets = await loadRequiredData(dataDir, {
    tqqq: "us/tqqq.csv",
    qld: "us/qld.csv",
    spym: "us/spym.csv",
    sgov: "us/sgov.csv"
  });
  const startDate = datasets.tqqq[0].date;
  const signalBars = datasets.tqqq.filter((bar) => bar.date >= startDate);
  const riskBars = datasets.qld.filter((bar) => bar.date >= startDate);
  const spymBars = datasets.spym.filter((bar) => bar.date >= startDate);
  const sgovBars = datasets.sgov.filter((bar) => bar.date >= startDate);

  const coarseRows = [];
  const coarseStep1Thresholds = [10, 20, 30, 40, 50, 65, 80, 100];
  const coarseStep2Thresholds = [40, 55, 65, 80, 100, 120, 140, 160, 200];
  const coarseStep1Sells = [5, 10, 20, 25, 40, 55, 70, 85];
  const coarseStep2Sells = [40, 55, 70, 85, 100];

  for (const step1ThresholdPct of coarseStep1Thresholds) {
    for (const step2ThresholdPct of coarseStep2Thresholds) {
      if (step2ThresholdPct <= step1ThresholdPct) {
        continue;
      }
      for (const step1SellPct of coarseStep1Sells) {
        for (const step2SellPct of coarseStep2Sells) {
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

  const seeds = new Map();
  for (const row of rankRows(coarseRows, "cagr").slice(0, 5)) {
    seeds.set(
      [row.step1ThresholdPct, row.step2ThresholdPct, row.step1SellPct, row.step2SellPct].join("-"),
      row
    );
  }
  for (const row of rankRows(coarseRows, "calmar").slice(0, 5)) {
    seeds.set(
      [row.step1ThresholdPct, row.step2ThresholdPct, row.step1SellPct, row.step2SellPct].join("-"),
      row
    );
  }

  const refinedRows = [];
  const seen = new Set();
  for (const seed of seeds.values()) {
    for (
      let step1ThresholdPct = Math.max(10, seed.step1ThresholdPct - 10);
      step1ThresholdPct <= Math.min(120, seed.step1ThresholdPct + 10);
      step1ThresholdPct += 5
    ) {
      for (
        let step2ThresholdPct = Math.max(step1ThresholdPct + 5, seed.step2ThresholdPct - 10);
        step2ThresholdPct <= Math.min(220, seed.step2ThresholdPct + 10);
        step2ThresholdPct += 5
      ) {
        for (
          let step1SellPct = Math.max(5, seed.step1SellPct - 15);
          step1SellPct <= Math.min(95, seed.step1SellPct + 15);
          step1SellPct += 5
        ) {
          for (
            let step2SellPct = Math.max(5, seed.step2SellPct - 15);
            step2SellPct <= Math.min(100, seed.step2SellPct + 15);
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
      model: "TQQQ signal + QLD execution, profit-takes triggered by TQQQ return",
      startDate,
      endDate: signalBars[signalBars.length - 1].date,
      confirmationDays,
      feeRate,
      slippageRate,
      taxRate,
      basicDeduction
    },
    bestByCagr: rankRows(refinedRows.length > 0 ? refinedRows : coarseRows, "cagr").slice(0, 20),
    bestByCalmar: rankRows(refinedRows.length > 0 ? refinedRows : coarseRows, "calmar").slice(0, 20),
    seedCount: seeds.size,
    coarseCount: coarseRows.length,
    refinedCount: refinedRows.length
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
