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

function parseNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function sortRows(rows, key) {
  return [...rows].sort(
    (left, right) =>
      right[key] - left[key] ||
      left.tp1SellPct - right.tp1SellPct ||
      left.tp2SellPct - right.tp2SellPct
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tp1ThresholdPct = parseNumber(options["tp1-threshold-pct"], "tp1-threshold-pct");
  const tp2ThresholdPct = parseNumber(options["tp2-threshold-pct"], "tp2-threshold-pct");
  const outputPath = String(options.output || "results/snowball-sell-grid.json");
  const dip1DrawdownPct = options["dip1-drawdown-pct"]
    ? parseNumber(options["dip1-drawdown-pct"], "dip1-drawdown-pct")
    : null;
  const dip2DrawdownPct = options["dip2-drawdown-pct"]
    ? parseNumber(options["dip2-drawdown-pct"], "dip2-drawdown-pct")
    : null;
  const dip1WeightPct = options["dip1-weight-pct"]
    ? parseNumber(options["dip1-weight-pct"], "dip1-weight-pct")
    : null;
  const dip2WeightPct = options["dip2-weight-pct"]
    ? parseNumber(options["dip2-weight-pct"], "dip2-weight-pct")
    : null;

  if (tp2ThresholdPct <= tp1ThresholdPct) {
    throw new Error("tp2-threshold-pct must be greater than tp1-threshold-pct.");
  }

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
  const taxedRows = [];

  for (let tp1SellPct = 0; tp1SellPct <= 100; tp1SellPct += 1) {
    for (let tp2SellPct = 0; tp2SellPct <= 100 - tp1SellPct; tp2SellPct += 1) {
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
          ...(dip1DrawdownPct !== null ? { dip1Drawdown: -dip1DrawdownPct / 100 } : {}),
          ...(dip2DrawdownPct !== null ? { dip2Drawdown: -dip2DrawdownPct / 100 } : {}),
          ...(dip1WeightPct !== null ? { dip1Weight: dip1WeightPct / 100 } : {}),
          ...(dip2WeightPct !== null ? { dip2Weight: dip2WeightPct / 100 } : {})
        }
      });

      taxedRows.push({
        tp1ThresholdPct,
        tp2ThresholdPct,
        tp1SellPct,
        tp2SellPct,
        remainingPct: 100 - tp1SellPct - tp2SellPct,
        cagr: result.metrics.cagr,
        mdd: result.metrics.maxDrawdown,
        calmar: result.metrics.calmarRatio,
        sortino: result.metrics.sortinoRatio,
        sharpe: result.metrics.sharpeRatio,
        totalReturn: result.metrics.totalReturn,
        endingValue: result.metrics.endingValue,
        tradeCount: result.metrics.tradeCount,
        profitTakeCount: result.metrics.profitTakeCount,
        annualTaxPaid: result.metrics.annualTaxPaid
      });
    }
  }

  const topCagr = sortRows(taxedRows, "cagr").slice(0, 20);
  const topCalmar = sortRows(taxedRows, "calmar").slice(0, 20);
  const topTaxedCalmar = topCalmar.map((item) => ({
    tp1SellPct: item.tp1SellPct,
    tp2SellPct: item.tp2SellPct,
    remainingPct: item.remainingPct
  }));
  const noTaxRows = [];

  for (const item of topTaxedCalmar) {
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
      taxMode: "none",
      settings: {
        ...strategy.settings,
        tp1Threshold: tp1ThresholdPct / 100,
        tp2Threshold: tp2ThresholdPct / 100,
        tp1SellFractionOfBase: item.tp1SellPct / 100,
        tp2SellFractionOfBase: item.tp2SellPct / 100,
        ...(dip1DrawdownPct !== null ? { dip1Drawdown: -dip1DrawdownPct / 100 } : {}),
        ...(dip2DrawdownPct !== null ? { dip2Drawdown: -dip2DrawdownPct / 100 } : {}),
        ...(dip1WeightPct !== null ? { dip1Weight: dip1WeightPct / 100 } : {}),
        ...(dip2WeightPct !== null ? { dip2Weight: dip2WeightPct / 100 } : {})
      }
    });
    noTaxRows.push({
      tp1SellPct: item.tp1SellPct,
      tp2SellPct: item.tp2SellPct,
      remainingPct: item.remainingPct,
      cagr: result.metrics.cagr,
      mdd: result.metrics.maxDrawdown,
      calmar: result.metrics.calmarRatio,
      totalReturn: result.metrics.totalReturn,
      endingValue: result.metrics.endingValue
    });
  }

  const atLeastTail10 = taxedRows.filter((row) => row.remainingPct >= 10);
  const atLeastTail15 = taxedRows.filter((row) => row.remainingPct >= 15);
  const summary = {
    tp1ThresholdPct,
    tp2ThresholdPct,
    bestCagr: topCagr[0],
    bestCalmar: topCalmar[0],
    bestCagrTail10: sortRows(atLeastTail10, "cagr")[0],
    bestCalmarTail10: sortRows(atLeastTail10, "calmar")[0],
    bestCagrTail15: sortRows(atLeastTail15, "cagr")[0],
    bestCalmarTail15: sortRows(atLeastTail15, "calmar")[0],
    topCagr,
    topCalmar,
    noTaxForTopCalmar: noTaxRows,
    evaluatedCount: taxedRows.length
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      startDate: strategy.settings.startDate,
      endDate: datasets[strategy.riskSymbol].at(-1)?.date ?? null,
      taxMode: "taxed",
      tp1ThresholdPct,
      tp2ThresholdPct,
      dipOverrides: {
        dip1DrawdownPct,
        dip2DrawdownPct,
        dip1WeightPct,
        dip2WeightPct
      },
      tpAfterGoldCross: false,
      resetDipOnNewHighSource: "close",
      feeRate: strategy.feeRate,
      annualCashYield: strategy.annualCashYield,
      slippagePerShare: execution.slippagePerShare
    },
    summary,
    taxedRows
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
