import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { STRATEGIES, getRequiredFiles, DEFAULTS } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runSnowballStrategy } from "../lib/snowball-strategy.js";

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

function parseNumber(value, name, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function buildRange(start, end, step) {
  const values = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function sortRows(rows, key) {
  return [...rows].sort(
    (left, right) =>
      right[key] - left[key] ||
      left.dip1DrawdownPct - right.dip1DrawdownPct ||
      left.dip2DrawdownPct - right.dip2DrawdownPct ||
      left.dip1WeightPct - right.dip1WeightPct ||
      left.dip2WeightPct - right.dip2WeightPct
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = String(options.output || "results/snowball-dip-grid.json");
  const tp1ThresholdPct = parseNumber(options["tp1-threshold-pct"], "tp1-threshold-pct", 37);
  const tp2ThresholdPct = parseNumber(options["tp2-threshold-pct"], "tp2-threshold-pct", 85);
  const tp1SellPct = parseNumber(options["tp1-sell-pct"], "tp1-sell-pct", 59);
  const tp2SellPct = parseNumber(options["tp2-sell-pct"], "tp2-sell-pct", 41);

  const dip1DrawdownPctValues = buildRange(
    parseNumber(options["dip1-dd-start"], "dip1-dd-start", 6),
    parseNumber(options["dip1-dd-end"], "dip1-dd-end", 20),
    parseNumber(options["dip1-dd-step"], "dip1-dd-step", 2)
  );
  const dip2DrawdownPctValues = buildRange(
    parseNumber(options["dip2-dd-start"], "dip2-dd-start", 14),
    parseNumber(options["dip2-dd-end"], "dip2-dd-end", 34),
    parseNumber(options["dip2-dd-step"], "dip2-dd-step", 2)
  );
  const dip1WeightPctValues = buildRange(
    parseNumber(options["dip1-weight-start"], "dip1-weight-start", 10),
    parseNumber(options["dip1-weight-end"], "dip1-weight-end", 60),
    parseNumber(options["dip1-weight-step"], "dip1-weight-step", 10)
  );
  const dip2WeightPctValues = buildRange(
    parseNumber(options["dip2-weight-start"], "dip2-weight-start", 50),
    parseNumber(options["dip2-weight-end"], "dip2-weight-end", 100),
    parseNumber(options["dip2-weight-step"], "dip2-weight-step", 10)
  );

  const cwd = process.cwd();
  const strategy = STRATEGIES["us-snowball-basic"];
  const dataDir = path.resolve(cwd, DEFAULTS.dataDir);
  const requiredFiles = getRequiredFiles("us-snowball-basic");
  const datasets = await loadRequiredData(dataDir, requiredFiles);
  const initialCapital = strategy.contributionPlan.initialContribution;
  const contributionPlan = {
    initialContribution: initialCapital,
    legacyMonthlyContribution: strategy.contributionPlan.legacyMonthlyContribution ?? 0
  };
  const execution = strategy.executionScenarios[0];
  const rows = [];

  for (const dip1DrawdownPct of dip1DrawdownPctValues) {
    for (const dip2DrawdownPct of dip2DrawdownPctValues) {
      if (dip2DrawdownPct <= dip1DrawdownPct) {
        continue;
      }
      for (const dip1WeightPct of dip1WeightPctValues) {
        for (const dip2WeightPct of dip2WeightPctValues) {
          if (dip2WeightPct < dip1WeightPct) {
            continue;
          }

          const result = runSnowballStrategy({
            name: strategy.name,
            qqqBars: datasets[strategy.signalSymbol],
            riskBars: datasets[strategy.riskSymbol],
            initialCapital,
            contributionPlan,
            feeRate: strategy.feeRate,
            annualCashYield: strategy.annualCashYield,
            slippagePerShare: execution.slippagePerShare,
            valuationCurrency: strategy.valuationCurrency,
            taxMode: "taxed",
            settings: {
              ...strategy.settings,
              tp1Threshold: tp1ThresholdPct / 100,
              tp2Threshold: tp2ThresholdPct / 100,
              tp1SellFractionOfBase: tp1SellPct / 100,
              tp2SellFractionOfBase: tp2SellPct / 100,
              dip1Drawdown: -dip1DrawdownPct / 100,
              dip2Drawdown: -dip2DrawdownPct / 100,
              dip1Weight: dip1WeightPct / 100,
              dip2Weight: dip2WeightPct / 100
            }
          });

          rows.push({
            tp1ThresholdPct,
            tp2ThresholdPct,
            tp1SellPct,
            tp2SellPct,
            dip1DrawdownPct,
            dip2DrawdownPct,
            dip1WeightPct,
            dip2WeightPct,
            cagr: result.metrics.cagr,
            mdd: result.metrics.maxDrawdown,
            calmar: result.metrics.calmarRatio,
            sortino: result.metrics.sortinoRatio,
            sharpe: result.metrics.sharpeRatio,
            totalReturn: result.metrics.totalReturn,
            endingValue: result.metrics.endingValue,
            tradeCount: result.metrics.tradeCount,
            profitTakeCount: result.metrics.profitTakeCount,
            dipEntryCount: result.metrics.dipEntryCount,
            annualTaxPaid: result.metrics.annualTaxPaid
          });
        }
      }
    }
  }

  const topCagr = sortRows(rows, "cagr").slice(0, 20);
  const topCalmar = sortRows(rows, "calmar").slice(0, 20);
  const summary = {
    tp1ThresholdPct,
    tp2ThresholdPct,
    tp1SellPct,
    tp2SellPct,
    bestCagr: topCagr[0],
    bestCalmar: topCalmar[0],
    topCagr,
    topCalmar,
    evaluatedCount: rows.length
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      startDate: strategy.settings.startDate,
      endDate: datasets[strategy.riskSymbol].at(-1)?.date ?? null,
      taxMode: "taxed",
      tp1ThresholdPct,
      tp2ThresholdPct,
      tp1SellPct,
      tp2SellPct,
      tpAfterGoldCross: false,
      resetDipOnNewHighSource: "close",
      feeRate: strategy.feeRate,
      annualCashYield: strategy.annualCashYield,
      slippagePerShare: execution.slippagePerShare,
      searchedRanges: {
        dip1DrawdownPctValues,
        dip2DrawdownPctValues,
        dip1WeightPctValues,
        dip2WeightPctValues
      }
    },
    summary,
    rows
  };

  const resolvedOutput = path.resolve(cwd, outputPath);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
