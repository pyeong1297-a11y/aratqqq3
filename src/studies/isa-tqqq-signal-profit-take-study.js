#!/usr/bin/env node

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { STRATEGIES, getRequiredFiles } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { parsePriceCsv } from "../lib/csv.js";
import { runIsaStrategy } from "../lib/isa-strategy.js";

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
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

  return { positional, options };
}

function printHelp() {
  console.log(`Usage
  node src/studies/isa-tqqq-signal-profit-take-study.js [options]

Options
  --data-dir <path>   Data directory (default: ./data)
  --output <path>     Output JSON path
  --start <date>      Override comparison start date
  --signal-source <id>  Signal asset for entry/exit and PT trigger: tqqq or bulz (default: tqqq)
  --help              Show help
`);
}

async function loadCsv(filePath) {
  const text = await readFile(filePath, "utf8");
  return parsePriceCsv(text);
}

function filterBarsFromDate(bars, startDate) {
  return bars.filter((bar) => bar.date >= startDate);
}

function toIsaSignalProfitTakeSteps(steps) {
  return (steps || []).map((step) => ({
    threshold: step.threshold,
    sellFraction: step.sellFraction,
    destination: "sp500",
    triggerSource: "signal"
  }));
}

function buildSignalMode(signalSource, days, plan) {
  return {
    id: `${signalSource}-sma200-${days}d-${plan.id}`,
    label: `${signalSource.toUpperCase()} SMA200 ${days}d + ${plan.label}`,
    mode: "sma200-entry",
    confirmationDays: days,
    isaProfitTakeSteps: toIsaSignalProfitTakeSteps(plan.steps)
  };
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatCurrency(value) {
  return `${Math.round(value).toLocaleString("ko-KR")} KRW`;
}

function buildSummaryRows(results, assetId, taxMode) {
  return results
    .filter((item) => item.assetId === assetId && item.taxMode === taxMode)
    .sort((left, right) => {
      if (left.planOrder !== right.planOrder) {
        return left.planOrder - right.planOrder;
      }
      return left.confirmationDays - right.confirmationDays;
    })
    .map((item) => ({
      plan: item.planId,
      days: item.confirmationDays,
      endingValue: formatCurrency(item.metrics.endingValue),
      totalReturn: formatPercent(item.metrics.totalReturn),
      cagr: formatPercent(item.metrics.cagr),
      mdd: formatPercent(item.metrics.maxDrawdown),
      trades: item.metrics.tradeCount,
      winRate: formatPercent(item.metrics.winRate),
      isaProfitTakes: item.metrics.isaProfitTakeCount
    }));
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, String(options["data-dir"] || "data"));
  const outputPath = path.resolve(
    cwd,
    String(options.output || "results/isa-tqqq-signal-profit-take-study.json")
  );
  const acePath = path.join(dataDir, "kr", "ace_us_bigtech_top7_plus_lev.csv");
  const signalSource = String(options["signal-source"] || "tqqq").toLowerCase();

  const isaStrategy = STRATEGIES["isa-kodex"];
  const bulzStrategy = STRATEGIES["us-bulz"];
  const tqqqBase = STRATEGIES["us-tqqq"];
  const tqqqGrowth = STRATEGIES["us-tqqq-growth"];
  const tqqqBalance = STRATEGIES["us-tqqq-balance"];
  const tqqqDefense = STRATEGIES["us-tqqq-defense"];

  const requiredFiles = getRequiredFiles("isa-kodex");
  const datasets = await loadRequiredData(dataDir, requiredFiles);
  const aceBars = await loadCsv(acePath);

  const commonStartDate = String(options.start || aceBars[0].date);
  const executionAssets = [
    {
      id: "tiger",
      label: "TIGER US Nasdaq100 Leverage (418660)",
      kodexBars: filterBarsFromDate(datasets.kodex, commonStartDate)
    },
    {
      id: "ace",
      label: "ACE US BigTech TOP7 Plus Leverage (465610)",
      kodexBars: filterBarsFromDate(aceBars, commonStartDate)
    }
  ];

  const plans = [
    { id: "basic", label: "Basic (No PT)", steps: tqqqBase.profitTakeSteps || [], order: 1 },
    { id: "growth", label: "Growth", steps: tqqqGrowth.profitTakeSteps || [], order: 2 },
    { id: "balance", label: "Balance", steps: tqqqBalance.profitTakeSteps || [], order: 3 },
    { id: "defense", label: "Defense", steps: tqqqDefense.profitTakeSteps || [], order: 4 }
  ];
  const taxModes = ["none", "taxed"];

  const baseScenario =
    isaStrategy.executionScenarios.find((item) => item.id === "base") ||
    isaStrategy.executionScenarios[0];
  const bulzBaseScenario =
    bulzStrategy.slippageScenarios.find((item) => item.id === "base") ||
    bulzStrategy.slippageScenarios[0];

  const filteredShared = {
    signalBars: filterBarsFromDate(
      signalSource === "bulz" ? datasets.bulz : datasets.tqqq,
      commonStartDate
    ),
    qqqBars: filterBarsFromDate(datasets.qqq, commonStartDate),
    tigerSp500Bars: filterBarsFromDate(datasets.tigerSp500, commonStartDate),
    riskBars: filterBarsFromDate(datasets.bulz, commonStartDate),
    spymBars: filterBarsFromDate(datasets.spym, commonStartDate),
    sgovBars: filterBarsFromDate(datasets.sgov, commonStartDate),
    fxBars: filterBarsFromDate(datasets.usdkrw, commonStartDate)
  };

  const results = [];

  for (const asset of executionAssets) {
    for (const plan of plans) {
      for (let confirmationDays = 1; confirmationDays <= 5; confirmationDays += 1) {
        for (const taxMode of taxModes) {
          const signalMode = buildSignalMode(signalSource, confirmationDays, plan);
          const result = runIsaStrategy({
            name: `${asset.id}-${plan.id}-${confirmationDays}d`,
            signalBars: filteredShared.signalBars,
            qqqBars: filteredShared.qqqBars,
            kodexBars: asset.kodexBars,
            tigerSp500Bars: filteredShared.tigerSp500Bars,
            riskBars: filteredShared.riskBars,
            spymBars: filteredShared.spymBars,
            sgovBars: filteredShared.sgovBars,
            fxBars: filteredShared.fxBars,
            initialCapital: isaStrategy.contributionPlan.initialContribution,
            signalMode,
            scenario: baseScenario,
            feeRate: isaStrategy.feeRate,
            annualCashYield: isaStrategy.annualCashYield,
            taxMode,
            contributionPlan: isaStrategy.contributionPlan,
            bulzStrategy,
            usSlippageRate: bulzBaseScenario.slippageRate
          });

          results.push({
            assetId: asset.id,
            assetLabel: asset.label,
            planId: plan.id,
            planLabel: plan.label,
            planOrder: plan.order,
            confirmationDays,
            taxMode,
            startDate: result.meta.startDate,
            endDate: result.meta.endDate,
            metrics: result.metrics
          });
        }
      }
    }
  }

  const bestTaxedByAsset = executionAssets.map((asset) => {
    const taxedRows = results
      .filter((item) => item.assetId === asset.id && item.taxMode === "taxed")
      .sort((left, right) => right.metrics.endingValue - left.metrics.endingValue);

    return {
      assetId: asset.id,
      assetLabel: asset.label,
      best: taxedRows[0]
    };
  });

  const bestTaxedByPlanAndAsset = executionAssets.flatMap((asset) =>
    plans.map((plan) => {
      const taxedRows = results
        .filter(
          (item) =>
            item.assetId === asset.id &&
            item.taxMode === "taxed" &&
            item.planId === plan.id
        )
        .sort((left, right) => right.metrics.endingValue - left.metrics.endingValue);

      return {
        assetId: asset.id,
        assetLabel: asset.label,
        planId: plan.id,
        planLabel: plan.label,
        best: taxedRows[0]
      };
    })
  );

  const tigerByKey = new Map(
    results
      .filter((item) => item.assetId === "tiger")
      .map((item) => [
        `${item.planId}:${item.confirmationDays}:${item.taxMode}`,
        item
      ])
  );

  const deltasVsTiger = results
    .filter((item) => item.assetId === "ace")
    .map((item) => {
      const baseline = tigerByKey.get(
        `${item.planId}:${item.confirmationDays}:${item.taxMode}`
      );

      return {
        planId: item.planId,
        confirmationDays: item.confirmationDays,
        taxMode: item.taxMode,
        endingValueDelta:
          baseline ? item.metrics.endingValue - baseline.metrics.endingValue : null,
        cagrDelta: baseline ? item.metrics.cagr - baseline.metrics.cagr : null,
        mddDelta: baseline
          ? item.metrics.maxDrawdown - baseline.metrics.maxDrawdown
          : null,
        tradeCountDelta: baseline
          ? item.metrics.tradeCount - baseline.metrics.tradeCount
          : null,
        winRateDelta: baseline ? item.metrics.winRate - baseline.metrics.winRate : null,
        isaProfitTakeCountDelta: baseline
          ? item.metrics.isaProfitTakeCount - baseline.metrics.isaProfitTakeCount
          : null
      };
    });

  const payload = {
    meta: {
      createdAt: new Date().toISOString(),
      study: "isa-tqqq-signal-profit-take",
      scenario: {
        mode: baseScenario.mode,
        slipRate: baseScenario.slipRate,
        feeRate: isaStrategy.feeRate,
        annualCashYield: isaStrategy.annualCashYield,
        signalSource,
        signalTrigger: `${signalSource.toUpperCase()} close return from ISA cycle entry`,
        executionTiming:
          `${signalSource.toUpperCase()} threshold checked on latest US close, ISA sell executes on next KR trade day using base scenario`
      },
      commonStartDate,
      commonEndDate: executionAssets[1].kodexBars.at(-1)?.date ?? null
    },
    bestTaxedByAsset,
    bestTaxedByPlanAndAsset,
    deltasVsTiger,
    summaries: {
      tigerTaxed: buildSummaryRows(results, "tiger", "taxed"),
      aceTaxed: buildSummaryRows(results, "ace", "taxed"),
      tigerPretax: buildSummaryRows(results, "tiger", "none"),
      acePretax: buildSummaryRows(results, "ace", "none")
    },
    results
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        commonStartDate,
        commonEndDate: payload.meta.commonEndDate,
        bestTaxedByAsset: bestTaxedByAsset.map((item) => ({
          assetId: item.assetId,
          planId: item.best.planId,
          confirmationDays: item.best.confirmationDays,
          endingValue: item.best.metrics.endingValue,
          cagr: item.best.metrics.cagr,
          mdd: item.best.metrics.maxDrawdown
        }))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
