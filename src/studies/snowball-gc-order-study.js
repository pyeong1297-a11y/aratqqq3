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

function summarize(result) {
  return {
    cagrPct: Number((result.metrics.cagr * 100).toFixed(2)),
    mddPct: Number((result.metrics.maxDrawdown * 100).toFixed(2)),
    endingValue: Number(result.metrics.endingValue.toFixed(2)),
    tradeCount: result.metrics.tradeCount,
    gcEntryCount: result.metrics.gcEntryCount,
    profitTakeCount: result.metrics.profitTakeCount
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
      summary: summarize(result),
      trades2020: result.trades
        .filter((trade) => trade.entryDate >= "2020-03-01" && trade.entryDate <= "2021-12-31")
        .map((trade) => ({
          entryDate: trade.entryDate,
          exitDate: trade.exitDate,
          returnPct: Number((trade.returnPct * 100).toFixed(2)),
          reason: trade.reason
        })),
      events2020: result.events
        .filter((event) => event.date >= "2020-03-01" && event.date <= "2020-05-20")
        .map((event) => ({ date: event.date, type: event.type }))
    };
  }

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

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      startDate: strategy.settings.startDate,
      endDate: datasets[strategy.riskSymbol].at(-1)?.date ?? null,
      taxMode: "taxed"
    },
    scenarios: {
      basic_tp_first: run("basic_tp_first", strategy.settings),
      basic_gc_first: run("basic_gc_first", {
        ...strategy.settings,
        prioritizeGoldCrossOverTpSameDay: true
      }),
      optimized_tp_first: run("optimized_tp_first", optimizedSettings),
      optimized_gc_first: run("optimized_gc_first", {
        ...optimizedSettings,
        prioritizeGoldCrossOverTpSameDay: true
      })
    }
  };

  const outputPath = path.resolve(cwd, "results/snowball-gc-order-study.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(payload.scenarios).map(([key, value]) => [key, value.summary])
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
