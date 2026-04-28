import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES, getRequiredFiles } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runSnowballStrategy } from "../lib/snowball-strategy.js";

function toSummary(label, result) {
  return {
    label,
    endingValue: result.metrics.endingValue,
    totalReturn: result.metrics.totalReturn,
    cagr: result.metrics.cagr,
    mdd: result.metrics.maxDrawdown,
    calmar: result.metrics.calmarRatio,
    sharpe: result.metrics.sharpeRatio,
    sortino: result.metrics.sortinoRatio,
    tradeCount: result.metrics.tradeCount,
    profitTakeCount: result.metrics.profitTakeCount,
    gcEntryCount: result.metrics.gcEntryCount,
    dcExitCount: result.metrics.dcExitCount,
    annualTaxPaid: result.metrics.annualTaxPaid
  };
}

async function main() {
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
  const reserve30Settings = {
    ...strategy.settings,
    dip1Drawdown: -0.08,
    dip2Drawdown: -0.22,
    dip1Weight: 0.2,
    dip2Weight: 0.7,
    tp1Threshold: 0.37,
    tp2Threshold: 0.85,
    tp1SellFractionOfBase: 0.72,
    tp2SellFractionOfBase: 0.25
  };

  const reserve30 = runSnowballStrategy({
    name: `${strategy.name}-reserve30`,
    qqqBars: datasets[strategy.signalSymbol],
    riskBars: datasets[strategy.riskSymbol],
    initialCapital,
    contributionPlan,
    feeRate: strategy.feeRate,
    annualCashYield: strategy.annualCashYield,
    slippagePerShare: execution.slippagePerShare,
    valuationCurrency: strategy.valuationCurrency,
    taxMode: "taxed",
    settings: reserve30Settings
  });

  const reserve30Trend200 = runSnowballStrategy({
    name: `${strategy.name}-reserve30-200ma-3d`,
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
      ...reserve30Settings,
      trendEntryMode: "close-above-sma-confirmed",
      trendExitMode: "close-below-sma",
      trendSmaDays: 200,
      trendEntryConfirmationDays: 3
    }
  });

  const baselineSummary = toSummary("reserve30 / 5-220 cross", reserve30);
  const variantSummary = toSummary("reserve30 / 200ma 3d entry + below200 exit", reserve30Trend200);
  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      startDate: strategy.settings.startDate,
      endDate: datasets[strategy.riskSymbol].at(-1)?.date ?? null,
      taxMode: "taxed",
      feeRate: strategy.feeRate,
      annualCashYield: strategy.annualCashYield,
      slippagePerShare: execution.slippagePerShare,
      reserve30Settings: {
        dip1DrawdownPct: 8,
        dip2DrawdownPct: 22,
        dip1WeightPct: 20,
        dip2WeightPct: 70,
        tp1ThresholdPct: 37,
        tp2ThresholdPct: 85,
        tp1SellPct: 72,
        tp2SellPct: 25,
        remainingPct: 3
      },
      modifiedTrendFilter: {
        entry: "TQQQ close > SMA200 for 3 consecutive trading days",
        exit: "TQQQ close < SMA200"
      }
    },
    baseline: baselineSummary,
    variant: variantSummary,
    delta: {
      endingValue: variantSummary.endingValue - baselineSummary.endingValue,
      cagr: variantSummary.cagr - baselineSummary.cagr,
      mdd: variantSummary.mdd - baselineSummary.mdd,
      calmar: variantSummary.calmar - baselineSummary.calmar,
      tradeCount: variantSummary.tradeCount - baselineSummary.tradeCount
    }
  };

  const outputPath = path.resolve(cwd, "results/snowball-reserve30-trend200-study.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
