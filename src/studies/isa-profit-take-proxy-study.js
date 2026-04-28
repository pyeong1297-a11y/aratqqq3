import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runIsaStrategy } from "../lib/isa-strategy.js";

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

function toPct(value) {
  return Math.round(value * 10_000) / 100;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function computeCalmar(cagr, maxDrawdown) {
  if (!Number.isFinite(cagr) || !Number.isFinite(maxDrawdown) || maxDrawdown >= 0) {
    return null;
  }

  return cagr / Math.abs(maxDrawdown);
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

function buildProxyDatasets(datasets, startDate) {
  return {
    signalBars: datasets.tqqq.filter((bar) => bar.date >= startDate),
    qqqBars: datasets.qqq.filter((bar) => bar.date >= startDate),
    kodexBars: buildSyntheticLeveragedBars(datasets.qqq, 2, startDate),
    tigerSp500Bars: datasets.spym.filter((bar) => bar.date >= startDate),
    riskBars: datasets.bulz,
    spymBars: datasets.spym,
    sgovBars: datasets.sgov,
    fxBars: null
  };
}

function buildContributionPlan(initialContribution) {
  return {
    initialContribution,
    legacyMonthlyContribution: 0,
    rolloverYearsFromStart: Number.POSITIVE_INFINITY,
    renewalInitialContribution: 0,
    renewalAnnualContribution: 0,
    renewalAnnualContributionMonth: 1,
    renewalAnnualContributionDay: 2,
    renewalContributionLimit: 0
  };
}

function buildSteps(rawSteps) {
  return rawSteps.map((step) => ({
    threshold: step.threshold,
    sellFraction: step.sellFraction,
    destination: "sp500"
  }));
}

function formatStepKey(steps) {
  if (steps.length === 0) {
    return "none";
  }

  return steps
    .map((step) => `${toPct(step.threshold)}:${toPct(step.sellFraction)}`)
    .join("|");
}

function summarizeResult(label, steps, result) {
  return {
    label,
    steps: steps.map((step) => ({
      thresholdPct: toPct(step.threshold),
      sellPct: toPct(step.sellFraction)
    })),
    cagr: result.metrics.cagr,
    mdd: result.metrics.maxDrawdown,
    calmar: computeCalmar(result.metrics.cagr, result.metrics.maxDrawdown),
    totalReturn: result.metrics.totalReturn,
    endingValue: result.metrics.endingValue,
    tradeCount: result.metrics.tradeCount,
    winRate: result.metrics.winRate,
    marketExposure: result.metrics.marketExposure,
    isaProfitTakeCount: result.metrics.isaProfitTakeCount
  };
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

function findSignalMode(signalModes, id) {
  const match = signalModes.find((item) => item.id === id);
  if (!match) {
    throw new Error(`Unknown signal mode: ${id}`);
  }
  return match;
}

function cloneSignalMode(signalMode, isaProfitTakeSteps) {
  return {
    ...signalMode,
    isaProfitTakeSteps
  };
}

function evaluateProxyIsa({
  strategy,
  signalMode,
  scenario,
  datasets,
  initialCapital,
  contributionPlan,
  bulzStrategy,
  steps
}) {
  return runIsaStrategy({
    name: `${strategy.name}-proxy`,
    signalBars: datasets.signalBars,
    qqqBars: datasets.qqqBars,
    kodexBars: datasets.kodexBars,
    tigerSp500Bars: datasets.tigerSp500Bars,
    riskBars: datasets.riskBars,
    spymBars: datasets.spymBars,
    sgovBars: datasets.sgovBars,
    fxBars: datasets.fxBars,
    initialCapital,
    signalMode: cloneSignalMode(signalMode, steps),
    scenario,
    feeRate: strategy.feeRate,
    annualCashYield: strategy.annualCashYield,
    taxMode: "none",
    contributionPlan,
    bulzStrategy,
    usSlippageRate: 0
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const outputPath = path.resolve(
    cwd,
    String(options.output || "results/isa-profit-take-proxy-study.json")
  );
  const signalModeId = String(options.mode || "dual-strict");
  const initialCapital = Number(options["initial-capital"] || 100_000);
  const strategy = STRATEGIES["isa-kodex"];
  const bulzStrategy = STRATEGIES["us-bulz"];
  const signalMode = findSignalMode(strategy.signalModes, signalModeId);
  const scenario =
    strategy.executionScenarios.find((item) => item.id === "base") ||
    strategy.executionScenarios[0];
  const requiredFiles = {
    tqqq: "us/tqqq.csv",
    qqq: "us/qqq.csv",
    bulz: "us/bulz.csv",
    spym: "us/spym.csv",
    sgov: "us/sgov.csv"
  };
  const rawDatasets = await loadRequiredData(dataDir, requiredFiles);
  const startDate = rawDatasets.tqqq[0].date;
  const datasets = buildProxyDatasets(rawDatasets, startDate);
  const contributionPlan = buildContributionPlan(initialCapital);

  const presetDefinitions = [
    { label: "no-pt", steps: [] },
    { label: "isa-current-80-30_100-70", steps: buildSteps([{ threshold: 0.8, sellFraction: 0.3 }, { threshold: 1.0, sellFraction: 0.7 }]) },
    { label: "tqqq-growth", steps: buildSteps([{ threshold: 1.0, sellFraction: 0.5 }, { threshold: 2.0, sellFraction: 1.0 }]) },
    { label: "tqqq-balance", steps: buildSteps([{ threshold: 0.5, sellFraction: 0.2 }, { threshold: 1.0, sellFraction: 0.5 }, { threshold: 2.0, sellFraction: 1.0 }]) },
    { label: "tqqq-defense", steps: buildSteps([{ threshold: 0.1, sellFraction: 0.1 }, { threshold: 0.25, sellFraction: 0.1 }, { threshold: 0.5, sellFraction: 0.1 }, { threshold: 1.0, sellFraction: 0.5 }, { threshold: 2.0, sellFraction: 0.5 }, { threshold: 3.0, sellFraction: 0.5 }]) }
  ];

  const presetResults = [];
  for (const preset of presetDefinitions) {
    const result = evaluateProxyIsa({
      strategy,
      signalMode,
      scenario,
      datasets,
      initialCapital,
      contributionPlan,
      bulzStrategy,
      steps: preset.steps
    });
    presetResults.push(summarizeResult(preset.label, preset.steps, result));
  }

  const coarseStep1Thresholds = [20, 40, 60, 80, 100, 120];
  const coarseStep2Thresholds = [60, 80, 100, 120, 140, 160, 180, 200, 220, 240];
  const coarseStep1Sells = [10, 30, 50, 70, 90];
  const coarseStep2Sells = [20, 40, 60, 80, 100];
  const coarseTotal =
    coarseStep1Thresholds.length *
    coarseStep2Thresholds.length *
    coarseStep1Sells.length *
    coarseStep2Sells.length;
  let coarseCounter = 0;
  const coarseRows = [];

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
          const result = evaluateProxyIsa({
            strategy,
            signalMode,
            scenario,
            datasets,
            initialCapital,
            contributionPlan,
            bulzStrategy,
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
            isaProfitTakeCount: result.metrics.isaProfitTakeCount
          });
        }
      }
    }
  }

  const bestCoarseByCagr = rankRows(coarseRows, "cagr")[0];
  const bestCoarseByCalmar = rankRows(coarseRows, "calmar")[0];
  const refineSeeds = new Map();
  for (const seed of [
    ...rankRows(coarseRows, "cagr").slice(0, 3),
    ...rankRows(coarseRows, "calmar").slice(0, 3)
  ]) {
    refineSeeds.set(
      formatStepKey(
        buildSteps([
          {
            threshold: seed.step1ThresholdPct / 100,
            sellFraction: seed.step1SellPct / 100
          },
          {
            threshold: seed.step2ThresholdPct / 100,
            sellFraction: seed.step2SellPct / 100
          }
        ])
      ),
      seed
    );
  }

  const refinedRows = [];
  const seenRefined = new Set();
  let refinedTotal = 0;
  for (const seed of refineSeeds.values()) {
    const step1ThresholdCount =
      Math.floor((Math.min(140, seed.step1ThresholdPct + 10) - Math.max(10, seed.step1ThresholdPct - 10)) / 5) + 1;
    const step2ThresholdCount =
      Math.floor((Math.min(260, seed.step2ThresholdPct + 10) - Math.max(seed.step1ThresholdPct + 5, seed.step2ThresholdPct - 10)) / 5) + 1;
    const step1SellCount =
      Math.floor((Math.min(95, seed.step1SellPct + 10) - Math.max(5, seed.step1SellPct - 10)) / 5) + 1;
    const step2SellCount =
      Math.floor((Math.min(100, seed.step2SellPct + 10) - Math.max(5, seed.step2SellPct - 10)) / 5) + 1;
    refinedTotal += step1ThresholdCount * step2ThresholdCount * step1SellCount * step2SellCount;
  }
  let refinedCounter = 0;

  for (const seed of refineSeeds.values()) {
    for (
      let step1ThresholdPct = Math.max(10, seed.step1ThresholdPct - 10);
      step1ThresholdPct <= Math.min(140, seed.step1ThresholdPct + 10);
      step1ThresholdPct += 5
    ) {
      for (
        let step2ThresholdPct = Math.max(step1ThresholdPct + 5, seed.step2ThresholdPct - 10);
        step2ThresholdPct <= Math.min(260, seed.step2ThresholdPct + 10);
        step2ThresholdPct += 5
      ) {
        for (
          let step1SellPct = Math.max(5, seed.step1SellPct - 10);
          step1SellPct <= Math.min(95, seed.step1SellPct + 10);
          step1SellPct += 5
        ) {
          for (
            let step2SellPct = Math.max(5, seed.step2SellPct - 10);
            step2SellPct <= Math.min(100, seed.step2SellPct + 10);
            step2SellPct += 5
          ) {
            const rowKey = [
              step1ThresholdPct,
              step2ThresholdPct,
              step1SellPct,
              step2SellPct
            ].join("-");
            if (seenRefined.has(rowKey)) {
              continue;
            }
            seenRefined.add(rowKey);
            refinedCounter += 1;
            logProgress("refined", refinedCounter, refinedTotal);

            const steps = buildSteps([
              { threshold: step1ThresholdPct / 100, sellFraction: step1SellPct / 100 },
              { threshold: step2ThresholdPct / 100, sellFraction: step2SellPct / 100 }
            ]);
            const result = evaluateProxyIsa({
              strategy,
              signalMode,
              scenario,
              datasets,
              initialCapital,
              contributionPlan,
              bulzStrategy,
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
              isaProfitTakeCount: result.metrics.isaProfitTakeCount
            });
          }
        }
      }
    }
  }

  const bestRefinedByCagr = rankRows(refinedRows, "cagr")[0];
  const bestRefinedByCalmar = rankRows(refinedRows, "calmar")[0];
  const bestCagrSteps = buildSteps([
    {
      threshold: bestRefinedByCagr.step1ThresholdPct / 100,
      sellFraction: bestRefinedByCagr.step1SellPct / 100
    },
    {
      threshold: bestRefinedByCagr.step2ThresholdPct / 100,
      sellFraction: bestRefinedByCagr.step2SellPct / 100
    }
  ]);
  const bestCalmarSteps = buildSteps([
    {
      threshold: bestRefinedByCalmar.step1ThresholdPct / 100,
      sellFraction: bestRefinedByCalmar.step1SellPct / 100
    },
    {
      threshold: bestRefinedByCalmar.step2ThresholdPct / 100,
      sellFraction: bestRefinedByCalmar.step2SellPct / 100
    }
  ]);

  const validationModes = strategy.signalModes.map((mode) => {
    const bestCagrResult = evaluateProxyIsa({
      strategy,
      signalMode: mode,
      scenario,
      datasets,
      initialCapital,
      contributionPlan,
      bulzStrategy,
      steps: bestCagrSteps
    });
    const bestCalmarResult = evaluateProxyIsa({
      strategy,
      signalMode: mode,
      scenario,
      datasets,
      initialCapital,
      contributionPlan,
      bulzStrategy,
      steps: bestCalmarSteps
    });

    return {
      mode: mode.id,
      bestCagrSteps: summarizeResult("best-cagr", bestCagrSteps, bestCagrResult),
      bestCalmarSteps: summarizeResult("best-calmar", bestCalmarSteps, bestCalmarResult)
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      proxyModel: "TQQQ signal + synthetic 2x QQQ execution + SPYM parking",
      rationale:
        "Ignore KR-specific FX and session gap effects, and optimize the core TQQQ->QLD-like structure.",
      startDate,
      endDate: datasets.signalBars.at(-1)?.date ?? null,
      signalModeOptimized: signalMode.id,
      scenario: {
        id: scenario.id,
        mode: scenario.mode,
        slipRate: scenario.slipRate
      },
      initialCapital,
      feeRate: strategy.feeRate,
      annualCashYield: strategy.annualCashYield,
      contributionPlan: {
        ...contributionPlan,
        rolloverYearsFromStart: "Infinity"
      },
      grid: {
        coarse: {
          step1ThresholdPct: coarseStep1Thresholds,
          step2ThresholdPct: coarseStep2Thresholds,
          step1SellPct: coarseStep1Sells,
          step2SellPct: coarseStep2Sells
        },
        refined: {
          topSeedsPerMetric: 3,
          thresholdWindowPct: 10,
          thresholdStepPct: 5,
          sellWindowPct: 10,
          sellStepPct: 5
        }
      }
    },
    presetResults,
    coarseSummary: {
      evaluatedCount: coarseRows.length,
      bestCagr: bestCoarseByCagr,
      bestCalmar: bestCoarseByCalmar,
      topCagr: rankRows(coarseRows, "cagr").slice(0, 20),
      topCalmar: rankRows(coarseRows, "calmar").slice(0, 20)
    },
    refinedSummary: {
      evaluatedCount: refinedRows.length,
      bestCagr: bestRefinedByCagr,
      bestCalmar: bestRefinedByCalmar,
      topCagr: rankRows(refinedRows, "cagr").slice(0, 20),
      topCalmar: rankRows(refinedRows, "calmar").slice(0, 20)
    },
    validationModes
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        mode: signalMode.id,
        presets: presetResults.map((row) => ({
          label: row.label,
          cagr: round(row.cagr),
          mdd: round(row.mdd),
          calmar: round(row.calmar ?? 0),
          steps: row.steps
        })),
        bestCoarseByCagr,
        bestCoarseByCalmar,
        bestRefinedByCagr,
        bestRefinedByCalmar
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
