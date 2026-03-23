#!/usr/bin/env node

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES, TAX_MODES, getRequiredFiles } from "./config.js";
import { checkRequiredDataFiles } from "./lib/data-check.js";
import { loadRequiredData } from "./lib/data-loader.js";
import {
  buildSingleIsaContributionSchedule,
  resolveBenchmarkKodexTradePrice,
  resolveBenchmarkUsOpenTradePrice,
  runSingleAssetDcaBenchmark
} from "./lib/dca-benchmark.js";
import { buildQqqReturnMap } from "./lib/isa-helpers.js";
import { runIsaStrategy } from "./lib/isa-strategy.js";
import { formatMetricValue, printScenarioTable, printStrategyBlock } from "./lib/report.js";
import { runUsStrategy } from "./lib/us-strategy.js";

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
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

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i += 1;
  }

  return { positional, options };
}

function printHelp() {
  console.log(`Usage
  node src/cli.js run <strategy> [options]
  node src/cli.js check-data <strategy> [options]

Strategies

  us-tqqq
  us-bulz
  isa-kodex
  all

Options

  --data-dir <path>         Data directory (default: ./data)
  --initial-capital <num>   Starting capital
                            US default: 100000000
                            ISA default first contribution: 10000000
  --json                    Print JSON payload
  --save <path>             Save JSON payload
  --help                    Show help

Examples

  node src/cli.js run us-tqqq
  node src/cli.js run all --data-dir .\\data --json
  node src/cli.js run isa-kodex
  node src/cli.js run isa-kodex --initial-capital 15000000
  node src/cli.js check-data all
`);
}

function parseNumberOption(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number option: ${value}`);
  }

  return parsed;
}

function buildRunList(strategyName) {
  if (strategyName === "all") {
    return Object.keys(STRATEGIES);
  }

  if (!STRATEGIES[strategyName]) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }

  return [strategyName];
}

async function maybeSaveJson(savePath, payload, cwd) {
  if (!savePath) {
    return;
  }

  const resolved = path.resolve(cwd, savePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Saved JSON: ${resolved}`);
}

async function runStrategy(strategyName, options, cwd) {
  const strategy = STRATEGIES[strategyName];
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const requiredFiles = getRequiredFiles(strategyName);
  const datasets = await loadRequiredData(dataDir, requiredFiles);

  if (strategy.type === "us") {
    const initialCapital = parseNumberOption(options["initial-capital"], DEFAULTS.initialCapital);
    const scenarioResults = [];
    for (const scenario of strategy.slippageScenarios) {
      for (const taxMode of TAX_MODES) {
        const result = runUsStrategy({
          name: strategy.name,
          riskBars: datasets[strategy.riskSymbol],
          spymBars: datasets.spym,
          sgovBars: datasets.sgov,
          fxBars: datasets.usdkrw,
          initialCapital,
          confirmationDays: strategy.confirmationDays,
          feeRate: strategy.feeRate,
          slippageRate: scenario.slippageRate,
          profitTakeSteps: strategy.profitTakeSteps,
          taxMode: taxMode.id
        });
        result.meta.scenarioLabel = `${scenario.label} / ${taxMode.label}`;
        scenarioResults.push(result);
      }
    }

    return {
      strategy: strategyName,
      label: strategy.label,
      type: strategy.type,
      initialCapital,
      requiredFiles,
      scenarios: scenarioResults
    };
  }

  const initialCapital = parseNumberOption(
    options["initial-capital"],
    strategy.contributionPlan?.initialContribution ?? DEFAULTS.initialCapital
  );
  const isaContributionPlan = {
    ...strategy.contributionPlan,
    initialContribution: initialCapital
  };
  const signalModes = strategy.signalModes || [
    { id: "default", label: "Default", mode: "dual-min-entry", confirmationDays: 3 }
  ];
  const allocationModes = strategy.allocationModes || [
    { id: "direct", label: "No envelope", envelopePct: null }
  ];
  const bulzStrategy = STRATEGIES["us-bulz"];
  const bulzBaseScenario =
    bulzStrategy.slippageScenarios.find((item) => item.id === "base") ||
    bulzStrategy.slippageScenarios[0];

  const scenarioResults = [];
  for (const signalMode of signalModes) {
    for (const allocationMode of allocationModes) {
      for (const scenario of strategy.executionScenarios) {
        for (const taxMode of TAX_MODES) {
        const result = runIsaStrategy({
          name: strategy.name,
          signalBars: datasets.tqqq,
          qqqBars: datasets.qqq,
          kodexBars: datasets.kodex,
          tigerSp500Bars: datasets.tigerSp500,
          riskBars: datasets.bulz,
          spymBars: datasets.spym,
          sgovBars: datasets.sgov,
            fxBars: datasets.usdkrw,
          initialCapital,
            signalMode,
          scenario,
          allocationMode,
          feeRate: strategy.feeRate,
          annualCashYield: strategy.annualCashYield,
          taxMode: taxMode.id,
          contributionPlan: isaContributionPlan,
          bulzStrategy,
          usSlippageRate: bulzBaseScenario.slippageRate
        });
          result.meta.scenarioLabel = `${signalMode.label} / ${scenario.label} / ${taxMode.label}`;
          scenarioResults.push(result);
        }
      }
    }
  }

  const benchmarkScenario =
    strategy.executionScenarios.find((item) => item.id === "base") || strategy.executionScenarios[0];
  const benchmarkStartDate =
    datasets.kodex[0].date > datasets.qld[0].date ? datasets.kodex[0].date : datasets.qld[0].date;
  const benchmarkEndDate =
    datasets.kodex[datasets.kodex.length - 1].date < datasets.qld[datasets.qld.length - 1].date
      ? datasets.kodex[datasets.kodex.length - 1].date
      : datasets.qld[datasets.qld.length - 1].date;
  const benchmarkKodexBars = datasets.kodex.filter(
    (bar) => bar.date >= benchmarkStartDate && bar.date <= benchmarkEndDate
  );
  const benchmarkQldBars = datasets.qld.filter(
    (bar) => bar.date >= benchmarkStartDate && bar.date <= benchmarkEndDate
  );
  const singleIsaContributionPlan = {
    initialContribution: isaContributionPlan.initialContribution,
    legacyMonthlyContribution: isaContributionPlan.legacyMonthlyContribution
  };
  const benchmarkSchedule = buildSingleIsaContributionSchedule(
    benchmarkKodexBars.map((bar) => bar.date),
    singleIsaContributionPlan
  );
  const qqqReturnMap = buildQqqReturnMap(datasets.qqq);

  for (const taxMode of TAX_MODES) {
    scenarioResults.push(
      runSingleAssetDcaBenchmark({
        name: strategy.name,
        label: `Benchmark / Single ISA KODEX DCA / ${taxMode.label}`,
        bars: benchmarkKodexBars,
        contributionSchedule: benchmarkSchedule,
        feeRate: strategy.feeRate,
        taxMode: taxMode.id,
        taxKind: "isa",
        principalLabel: "kodex",
        tradePriceResolver: ({ bar, index }) =>
          resolveBenchmarkKodexTradePrice({
            bar,
            index,
            bars: benchmarkKodexBars,
            qqqReturnMap,
            scenario: benchmarkScenario
          })
      })
    );
    scenarioResults.push(
      runSingleAssetDcaBenchmark({
        name: strategy.name,
        label: `Benchmark / QLD DCA / ${taxMode.label}`,
        bars: benchmarkQldBars,
        contributionSchedule: benchmarkSchedule,
        feeRate: bulzStrategy.feeRate,
        taxMode: taxMode.id,
        taxKind: "us",
        principalLabel: "qld",
        tradePriceResolver: ({ bar }) =>
          resolveBenchmarkUsOpenTradePrice({
            bar,
            slippageRate: bulzBaseScenario.slippageRate
          })
      })
    );
  }

  return {
    strategy: strategyName,
    label: strategy.label,
    type: strategy.type,
    initialCapital,
    requiredFiles,
    scenarios: scenarioResults
  };
}

function printResultSummary(result) {
  console.log("");
  console.log(`=== ${result.label} ===`);

  const rows = result.scenarios.map((scenario) => ({
    scenario: scenario.meta.scenarioLabel,
    totalReturn: formatMetricValue("percent", scenario.metrics.totalReturn),
    cagr: formatMetricValue("percent", scenario.metrics.cagr),
    mdd: formatMetricValue("percent", scenario.metrics.maxDrawdown),
    trades: formatMetricValue("count", scenario.metrics.tradeCount),
    winRate: formatMetricValue("percent", scenario.metrics.winRate),
    exposure: formatMetricValue("percent", scenario.metrics.marketExposure),
    ending: formatMetricValue("currency", scenario.metrics.endingValue)
  }));

  printScenarioTable(rows);

  for (const scenario of result.scenarios) {
    printStrategyBlock(scenario);
  }
}

async function runDataCheck(strategyName, options, cwd) {
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const requiredFiles = getRequiredFiles(strategyName);
  const report = await checkRequiredDataFiles(dataDir, requiredFiles);

  console.log("");
  console.log(`=== Data Check: ${strategyName} ===`);
  console.log(`Data dir: ${dataDir}`);

  for (const row of report.rows) {
    const statusText =
      row.status === "ok"
        ? "ok"
        : row.status === "missing"
          ? "missing"
          : row.status === "empty"
            ? "empty"
            : "error";
    console.log(`- ${row.key}: ${statusText} / ${row.relativePath} / ${row.detail}`);
  }

  if (report.missingCount > 0 || report.emptyCount > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const cwd = process.cwd();
  const { positional, options } = parseArgs(process.argv.slice(2));

  if (options.help || positional.length === 0) {
    printHelp();
    return;
  }

  const [command, strategyName] = positional;
  if (!["run", "check-data"].includes(command)) {
    throw new Error(`Unsupported command: ${command}`);
  }

  if (!strategyName) {
    throw new Error("Strategy name is required. Example: us-tqqq");
  }

  const runList = buildRunList(strategyName);

  if (command === "check-data") {
    for (const item of runList) {
      await runDataCheck(item, options, cwd);
    }
    return;
  }

  const results = [];

  for (const item of runList) {
    const result = await runStrategy(item, options, cwd);
    results.push(result);
    printResultSummary(result);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    cwd,
    results
  };

  if (options.json) {
    console.log("");
    console.log(JSON.stringify(payload, null, 2));
  }

  await maybeSaveJson(options.save, payload, cwd);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
