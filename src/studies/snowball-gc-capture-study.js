import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES, getRequiredFiles } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runSnowballStrategy } from "../lib/snowball-strategy.js";

function buildContributionPlan(strategy) {
  return {
    initialContribution: strategy.contributionPlan.initialContribution,
    legacyMonthlyContribution: strategy.contributionPlan.legacyMonthlyContribution ?? 0
  };
}

function summarize(label, result) {
  return {
    label,
    cagrPct: Number((result.metrics.cagr * 100).toFixed(2)),
    mddPct: Number((result.metrics.maxDrawdown * 100).toFixed(2)),
    endingValue: Number(result.metrics.endingValue.toFixed(2)),
    tradeCount: result.metrics.tradeCount,
    gcEntryCount: result.metrics.gcEntryCount,
    dcExitCount: result.metrics.dcExitCount,
    profitTakeCount: result.metrics.profitTakeCount,
    openCycleReturnPct:
      result.metrics.openCycleReturn === null
        ? null
        : Number((result.metrics.openCycleReturn * 100).toFixed(2))
  };
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

  function run(label, settings) {
    const result = runSnowballStrategy({
      name: label,
      qqqBars: datasets[strategy.signalSymbol],
      riskBars: datasets[strategy.riskSymbol],
      initialCapital,
      contributionPlan,
      feeRate: strategy.feeRate,
      annualCashYield: strategy.annualCashYield,
      slippagePerShare: execution.slippagePerShare,
      valuationCurrency: strategy.valuationCurrency,
      taxMode: "taxed",
      settings
    });

    return {
      summary: summarize(label, result),
      gcDates: result.events.filter((event) => event.type === "gold-cross").map((event) => event.date),
      dcDates: result.events.filter((event) => event.type === "dead-cross").map((event) => event.date),
      recentTrades: result.trades
        .filter((trade) => trade.entryDate >= "2025-01-01")
        .map((trade) => ({
          entryDate: trade.entryDate,
          exitDate: trade.exitDate,
          returnPct: Number((trade.returnPct * 100).toFixed(2)),
          reason: trade.reason
        }))
    };
  }

  const scenarios = {
    baseline_5d: run("baseline_5d", optimizedSettings),
    cooldown0: run("cooldown0", { ...optimizedSettings, cooldownDays: 0 }),
    gc_during_cooldown: run("gc_during_cooldown", {
      ...optimizedSettings,
      allowGoldCrossDuringCooldown: true
    }),
    gc_after_cooldown_if_still_bullish: run("gc_after_cooldown_if_still_bullish", {
      ...optimizedSettings,
      deferGoldCrossUntilCooldownEnds: true
    })
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      startDate: optimizedSettings.startDate,
      endDate: datasets[strategy.riskSymbol].at(-1)?.date ?? null,
      taxMode: "taxed",
      optimizedSettings: {
        dip1DrawdownPct: 11,
        dip2DrawdownPct: 22,
        tp1ThresholdPct: 37,
        tp2ThresholdPct: 87,
        tp3ThresholdPct: 355,
        tp1SellPctOfBase: 53,
        tp2SellPctOfBase: 47,
        gcShort: optimizedSettings.gcShort,
        gcLong: optimizedSettings.gcLong,
        cooldownDays: optimizedSettings.cooldownDays
      }
    },
    scenarios
  };

  const outputPath = path.resolve(cwd, "results/snowball-gc-capture-study.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(scenarios).map(([key, value]) => [key, value.summary])
      ),
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
