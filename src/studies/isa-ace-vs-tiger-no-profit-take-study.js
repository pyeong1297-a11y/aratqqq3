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
  node src/studies/isa-ace-vs-tiger-no-profit-take-study.js [options]

Options
  --data-dir <path>   Data directory (default: ./data)
  --output <path>     Output JSON path
  --start <date>      Override analysis start date
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

function pickBaseScenario(strategy) {
  return (
    strategy.executionScenarios.find((item) => item.id === "base") ||
    strategy.executionScenarios[0]
  );
}

function pickBulzBaseScenario(strategy) {
  return (
    strategy.slippageScenarios.find((item) => item.id === "base") ||
    strategy.slippageScenarios[0]
  );
}

function buildSignalMode(signalSourceId, confirmationDays) {
  return {
    id: `${signalSourceId}-${confirmationDays}d-no-pt`,
    label: `${signalSourceId} ${confirmationDays}d no PT`,
    mode: "sma200-entry",
    confirmationDays,
    isaProfitTakeSteps: []
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
      if (left.signalSourceId !== right.signalSourceId) {
        return left.signalSourceId.localeCompare(right.signalSourceId);
      }
      return left.confirmationDays - right.confirmationDays;
    })
    .map((item) => ({
      signal: item.signalSourceId,
      days: item.confirmationDays,
      endingValue: formatCurrency(item.metrics.endingValue),
      totalReturn: formatPercent(item.metrics.totalReturn),
      cagr: formatPercent(item.metrics.cagr),
      mdd: formatPercent(item.metrics.maxDrawdown),
      trades: item.metrics.tradeCount,
      winRate: formatPercent(item.metrics.winRate)
    }));
}

async function main() {
  const cwd = process.cwd();
  const { options } = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const outputPath = path.resolve(
    cwd,
    String(options.output || "results/isa-ace-vs-tiger-no-profit-take-study.json")
  );
  const dataDir = path.resolve(cwd, String(options["data-dir"] || "data"));
  const acePath = path.join(dataDir, "kr", "ace_us_bigtech_top7_plus_lev.csv");

  const isaStrategy = STRATEGIES["isa-kodex"];
  const bulzStrategy = STRATEGIES["us-bulz"];
  const requiredFiles = getRequiredFiles("isa-kodex");
  const datasets = await loadRequiredData(dataDir, requiredFiles);
  const aceBars = await loadCsv(acePath);

  const baseScenario = pickBaseScenario(isaStrategy);
  const bulzBaseScenario = pickBulzBaseScenario(bulzStrategy);
  const commonStartDate = String(options.start || aceBars[0].date);

  const executionAssets = [
    {
      id: "tiger",
      label: "TIGER US Nasdaq100 Leverage (418660)",
      kodexBars: filterBarsFromDate(datasets.kodex, commonStartDate),
      selfSignalBars: datasets.kodex
    },
    {
      id: "ace",
      label: "ACE US BigTech TOP7 Plus Leverage (465610)",
      kodexBars: filterBarsFromDate(aceBars, commonStartDate),
      selfSignalBars: aceBars
    }
  ];

  const tigerSp500Bars = filterBarsFromDate(datasets.tigerSp500, commonStartDate);
  const riskBars = filterBarsFromDate(datasets.bulz, commonStartDate);
  const spymBars = filterBarsFromDate(datasets.spym, commonStartDate);
  const sgovBars = filterBarsFromDate(datasets.sgov, commonStartDate);
  const fxBars = filterBarsFromDate(datasets.usdkrw, commonStartDate);
  const qqqBars = filterBarsFromDate(datasets.qqq, commonStartDate);

  const taxModes = ["none", "taxed"];
  const signalDefinitions = [
    {
      id: "tqqq",
      label: "TQQQ SMA200",
      resolveBars: () => datasets.tqqq
    },
    {
      id: "self",
      label: "Execution Asset SMA200",
      resolveBars: (asset) => asset.selfSignalBars
    },
    {
      id: "bulz",
      label: "BULZ SMA200",
      resolveBars: () => datasets.bulz
    }
  ];

  const results = [];

  for (const asset of executionAssets) {
    for (const signalDefinition of signalDefinitions) {
      for (const confirmationDays of [1, 2, 3]) {
        for (const taxMode of taxModes) {
          const signalMode = buildSignalMode(signalDefinition.id, confirmationDays);
          const result = runIsaStrategy({
            name: `${asset.id}-${signalDefinition.id}-${confirmationDays}d-no-pt`,
            signalBars: signalDefinition.resolveBars(asset),
            qqqBars,
            kodexBars: asset.kodexBars,
            tigerSp500Bars,
            riskBars,
            spymBars,
            sgovBars,
            fxBars,
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
            signalSourceId: signalDefinition.id,
            signalSourceLabel: signalDefinition.label,
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

  const tigerByKey = new Map(
    results
      .filter((item) => item.assetId === "tiger")
      .map((item) => [
        `${item.signalSourceId}:${item.confirmationDays}:${item.taxMode}`,
        item
      ])
  );

  const deltasVsTiger = results
    .filter((item) => item.assetId === "ace")
    .map((item) => {
      const baseline = tigerByKey.get(
        `${item.signalSourceId}:${item.confirmationDays}:${item.taxMode}`
      );

      return {
        assetId: item.assetId,
        signalSourceId: item.signalSourceId,
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
        winRateDelta: baseline ? item.metrics.winRate - baseline.metrics.winRate : null
      };
    });

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

  const payload = {
    meta: {
      createdAt: new Date().toISOString(),
      study: "isa-ace-vs-tiger-no-profit-take",
      scenario: {
        mode: baseScenario.mode,
        slipRate: baseScenario.slipRate,
        feeRate: isaStrategy.feeRate,
        annualCashYield: isaStrategy.annualCashYield,
        isaProfitTake: "none"
      },
      commonStartDate,
      commonEndDate: executionAssets[1].kodexBars.at(-1)?.date ?? null,
      executionAssets: executionAssets.map((asset) => ({
        id: asset.id,
        label: asset.label,
        startDate: asset.kodexBars[0]?.date ?? null,
        endDate: asset.kodexBars.at(-1)?.date ?? null
      }))
    },
    bestTaxedByAsset,
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
          signalSourceId: item.best.signalSourceId,
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
