import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES, getRequiredFiles } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runSnowballStrategy } from "../lib/snowball-strategy.js";

const BUY_EVENT_TYPES = new Set(["dip1", "dip2", "bonus", "gold-cross"]);

function buildContributionPlan(strategy) {
  return {
    initialContribution: strategy.contributionPlan.initialContribution,
    legacyMonthlyContribution: strategy.contributionPlan.legacyMonthlyContribution ?? 0
  };
}

function findFirstOpenCycleBuy(events, lastExitDate) {
  return (
    events.find(
      (event) => BUY_EVENT_TYPES.has(event.type) && (!lastExitDate || event.date > lastExitDate)
    ) || null
  );
}

function buildOpenCycle(result) {
  if (result.metrics.openCycleReturn === null) {
    return null;
  }

  const lastClosedTrade = result.trades.at(-1) || null;
  const firstBuy = findFirstOpenCycleBuy(result.events, lastClosedTrade?.exitDate || null);

  if (!firstBuy) {
    return null;
  }

  const endingValue = result.metrics.endingValue;
  const startValue = endingValue / (1 + result.metrics.openCycleReturn);
  const entryIndex = result.dailyValues.findIndex((item) => item.date === firstBuy.date);
  const holdDays = entryIndex >= 0 ? result.dailyValues.length - 1 - entryIndex : null;

  return {
    entryDate: firstBuy.date,
    exitDate: result.meta.endDate,
    holdDays,
    pnl: endingValue - startValue,
    returnPct: result.metrics.openCycleReturn,
    reason: "open",
    status: "open"
  };
}

function buildCycleRows(result) {
  const closedTrades = result.trades.map((trade, index) => ({
    cycle: index + 1,
    entryDate: trade.entryDate,
    exitDate: trade.exitDate,
    holdDays: trade.holdDays,
    pnl: trade.pnl,
    returnPct: trade.returnPct,
    reason: trade.reason,
    status: "closed"
  }));

  const openCycle = buildOpenCycle(result);
  if (openCycle) {
    closedTrades.push({
      cycle: closedTrades.length + 1,
      ...openCycle
    });
  }

  return closedTrades;
}

function round(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function toPercent(value, digits = 2) {
  return value === null || value === undefined ? null : round(value * 100, digits);
}

function toCurrency(value) {
  return round(value, 2);
}

function summarizeWins(rows) {
  const closedRows = rows.filter((row) => row.basic.status === "closed" && row.optimized.status === "closed");

  const optimizedBeatByReturn = closedRows.filter(
    (row) => row.optimized.returnPct > row.basic.returnPct
  ).length;
  const optimizedBeatByPnl = closedRows.filter((row) => row.optimized.pnl > row.basic.pnl).length;
  const optimizedPositive = closedRows.filter((row) => row.optimized.returnPct > 0).length;
  const basicPositive = closedRows.filter((row) => row.basic.returnPct > 0).length;

  return {
    closedCycleCount: closedRows.length,
    optimizedBeatByReturn,
    optimizedBeatByPnl,
    optimizedPositive,
    basicPositive
  };
}

function buildComparisonRows(basicCycles, optimizedCycles) {
  const cycleCount = Math.max(basicCycles.length, optimizedCycles.length);
  const rows = [];

  for (let index = 0; index < cycleCount; index += 1) {
    const basic = basicCycles[index] || null;
    const optimized = optimizedCycles[index] || null;

    rows.push({
      cycle: index + 1,
      basic,
      optimized,
      deltaReturnPct:
        basic && optimized ? round(optimized.returnPct - basic.returnPct, 6) : null,
      deltaPnl: basic && optimized ? round(optimized.pnl - basic.pnl, 2) : null
    });
  }

  return rows;
}

async function main() {
  const cwd = process.cwd();
  const strategy = STRATEGIES["us-snowball-basic"];
  const dataDir = path.resolve(cwd, DEFAULTS.dataDir);
  const requiredFiles = getRequiredFiles("us-snowball-basic");
  const datasets = await loadRequiredData(dataDir, requiredFiles);
  const execution = strategy.executionScenarios[0];
  const contributionPlan = buildContributionPlan(strategy);
  const initialCapital = strategy.contributionPlan.initialContribution;

  const basic = runSnowballStrategy({
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
    settings: strategy.settings
  });

  const optimizedSettings = {
    ...strategy.settings,
    dip1Drawdown: -0.11,
    dip2Drawdown: -0.22,
    tp1Threshold: 0.37,
    tp2Threshold: 0.87,
    tp3Threshold: 3.55,
    tp1SellFractionOfBase: 0.53,
    tp2SellFractionOfBase: 0.47
  };

  const optimized = runSnowballStrategy({
    name: `${strategy.name}-optimized`,
    qqqBars: datasets[strategy.signalSymbol],
    riskBars: datasets[strategy.riskSymbol],
    initialCapital,
    contributionPlan,
    feeRate: strategy.feeRate,
    annualCashYield: strategy.annualCashYield,
    slippagePerShare: execution.slippagePerShare,
    valuationCurrency: strategy.valuationCurrency,
    taxMode: "taxed",
    settings: optimizedSettings
  });

  const basicCycles = buildCycleRows(basic);
  const optimizedCycles = buildCycleRows(optimized);
  const comparisonRows = buildComparisonRows(basicCycles, optimizedCycles);
  const summary = summarizeWins(comparisonRows);

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      startDate: strategy.settings.startDate,
      endDate: datasets[strategy.riskSymbol].at(-1)?.date ?? null,
      taxMode: "taxed",
      optimizedSettings: {
        dip1DrawdownPct: 11,
        dip2DrawdownPct: 22,
        tp1ThresholdPct: 37,
        tp2ThresholdPct: 87,
        tp3ThresholdPct: 355,
        tp1SellPctOfBase: 53,
        tp2SellPctOfBase: 47
      },
      feeRate: strategy.feeRate,
      annualCashYield: strategy.annualCashYield,
      slippagePerShare: execution.slippagePerShare
    },
    strategySummary: {
      basic: {
        cagrPct: toPercent(basic.metrics.cagr),
        mddPct: toPercent(basic.metrics.maxDrawdown),
        endingValue: toCurrency(basic.metrics.endingValue),
        tradeCount: basic.metrics.tradeCount,
        openCycleReturnPct: toPercent(basic.metrics.openCycleReturn)
      },
      optimized: {
        cagrPct: toPercent(optimized.metrics.cagr),
        mddPct: toPercent(optimized.metrics.maxDrawdown),
        endingValue: toCurrency(optimized.metrics.endingValue),
        tradeCount: optimized.metrics.tradeCount,
        openCycleReturnPct: toPercent(optimized.metrics.openCycleReturn)
      },
      cycleSummary: summary
    },
    comparisonRows: comparisonRows.map((row) => ({
      cycle: row.cycle,
      basic: row.basic
        ? {
            status: row.basic.status,
            entryDate: row.basic.entryDate,
            exitDate: row.basic.exitDate,
            holdDays: row.basic.holdDays,
            returnPct: toPercent(row.basic.returnPct),
            pnl: toCurrency(row.basic.pnl),
            reason: row.basic.reason
          }
        : null,
      optimized: row.optimized
        ? {
            status: row.optimized.status,
            entryDate: row.optimized.entryDate,
            exitDate: row.optimized.exitDate,
            holdDays: row.optimized.holdDays,
            returnPct: toPercent(row.optimized.returnPct),
            pnl: toCurrency(row.optimized.pnl),
            reason: row.optimized.reason
          }
        : null,
      deltaReturnPct: row.deltaReturnPct === null ? null : toPercent(row.deltaReturnPct),
      deltaPnl: row.deltaPnl === null ? null : toCurrency(row.deltaPnl)
    }))
  };

  const outputPath = path.resolve(cwd, "results/snowball-cycle-compare.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload.strategySummary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
