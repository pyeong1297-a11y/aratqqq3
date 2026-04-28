#!/usr/bin/env node

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES, TAX_MODES, getRequiredFiles } from "./config.js";
import { checkRequiredDataFiles } from "./lib/data-check.js";
import { loadRequiredData } from "./lib/data-loader.js";
import { runIsaStrategy } from "./lib/isa-strategy.js";
import { formatMetricValue, printScenarioTable, printStrategyBlock } from "./lib/report.js";
import { runSnowballStrategy } from "./lib/snowball-strategy.js";
import { runUsStrategy } from "./lib/us-strategy.js";
import { runUsQldStrategy } from "./lib/us-qld-strategy.js";

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
  node src/cli.js run <strategy> [options]
  node src/cli.js check-data <strategy> [options]

Strategies

  us-tqqq
  us-tqqq-growth
  us-tqqq-balance
  us-tqqq-defense
  us-snowball-basic
  us-snowball-optimized
  us-snowball-optimized-sgov
  us-snowball-optimized-defensive
  us-bulz
  isa-kodex
  all

Options

  --data-dir <path>         Data directory (default: ./data)
  --initial-capital <num>   Starting capital
                            US default: strategy plan
                            ISA default first contribution: 10000000
  --monthly-contribution <num>
                            Monthly contribution amount
                            US default: strategy plan
                            ISA default: strategy plan
  --json                    Print JSON payload
  --save <path>             Save JSON payload
  --help                    Show help

Examples

  node src/cli.js run us-tqqq
  node src/cli.js run us-tqqq-growth
  node src/cli.js run us-snowball-basic
  node src/cli.js run us-snowball-optimized
  node src/cli.js run us-snowball-optimized-sgov
  node src/cli.js run us-snowball-optimized-defensive
  node src/cli.js run us-bulz
  node src/cli.js run isa-kodex
  node src/cli.js run all --data-dir .\\data --json
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
    const initialCapital = parseNumberOption(
      options["initial-capital"],
      strategy.contributionPlan?.initialContribution ?? DEFAULTS.initialCapital
    );
    const monthlyContribution = parseNumberOption(
      options["monthly-contribution"],
      strategy.contributionPlan?.legacyMonthlyContribution ?? 0
    );
    const contributionPlan = {
      initialContribution: initialCapital,
      legacyMonthlyContribution: monthlyContribution
    };
    const scenarios = [];

    for (const scenario of strategy.slippageScenarios) {
      for (const taxMode of TAX_MODES) {
        const result = runUsStrategy({
          name: strategy.name,
          riskBars: datasets[strategy.riskSymbol],
          spymBars: datasets.spym,
          sgovBars: datasets.sgov,
          parkingFallbackBars: datasets.bil || null,
          fxBars: datasets.usdkrw || null,
          initialCapital,
          contributionPlan,
          confirmationDays: strategy.confirmationDays,
          feeRate: strategy.feeRate,
          slippageRate: scenario.slippageRate,
          profitTakeSteps: strategy.profitTakeSteps,
          profitTakeParking: strategy.profitTakeParking,
          valuationCurrency: strategy.valuationCurrency,
          taxMode: taxMode.id
        });
        result.meta.scenarioLabel = `${scenario.label} / ${taxMode.label}`;
        scenarios.push(result);
      }
    }

    return {
      strategy: strategyName,
      label: strategy.label,
      type: strategy.type,
      initialCapital,
      contributionPlan,
      requiredFiles,
      scenarios
    };
  }

  if (strategy.type === "snowball-us") {
    const initialCapital = parseNumberOption(
      options["initial-capital"],
      strategy.contributionPlan?.initialContribution ?? DEFAULTS.initialCapital
    );
    const monthlyContribution = parseNumberOption(
      options["monthly-contribution"],
      strategy.contributionPlan?.legacyMonthlyContribution ?? 0
    );
    const contributionPlan = {
      initialContribution: initialCapital,
      legacyMonthlyContribution: monthlyContribution
    };
    const scenarios = [];

    for (const scenario of strategy.executionScenarios) {
      for (const taxMode of TAX_MODES) {
        const result = runSnowballStrategy({
          name: strategy.name,
          qqqBars: datasets[strategy.signalSymbol],
          riskBars: datasets[strategy.riskSymbol],
          sgovBars: datasets.sgov || null,
          parkingFallbackBars: datasets.bil || null,
          initialCapital,
          contributionPlan,
          feeRate: strategy.feeRate,
          annualCashYield: strategy.annualCashYield,
          slippagePerShare: scenario.slippagePerShare,
          valuationCurrency: strategy.valuationCurrency,
          taxMode: taxMode.id,
          settings: strategy.settings
        });
        result.meta.scenarioLabel = `${scenario.label} / ${taxMode.label}`;
        scenarios.push(result);
      }
    }

    return {
      strategy: strategyName,
      label: strategy.label,
      type: strategy.type,
      initialCapital,
      contributionPlan,
      requiredFiles,
      scenarios
    };
  }

  if (strategy.type === "us-qld") {
    const initialCapital = parseNumberOption(
      options["initial-capital"],
      strategy.contributionPlan?.initialContribution ?? DEFAULTS.initialCapital
    );
    const scenarios = [];

    for (const signalMode of strategy.signalModes) {
      for (const taxMode of TAX_MODES) {
        if (taxMode.id === "taxed") continue; // We only want pre-tax for now or we just run both but user asked for pre-tax 
        // We will run both since taxMode covers both, the print logic will show it.
        const result = runUsQldStrategy({
          name: strategy.name,
          signalBars: datasets.tqqq,
          qqqBars: datasets.qqq,
          qldBars: datasets.qld,
          spymBars: datasets.spym,
          sgovBars: datasets.sgov,
          initialCapital,
          signalMode,
          feeRate: strategy.feeRate,
          annualCashYield: strategy.annualCashYield,
        });
        result.meta.scenarioLabel = `${signalMode.label} / ${taxMode.label}`;
        scenarios.push(result);
      }
    }

    return {
      strategy: strategyName,
      label: strategy.label,
      type: strategy.type,
      initialCapital,
      contributionPlan: strategy.contributionPlan,
      requiredFiles,
      scenarios
    };
  }

  const initialCapital = parseNumberOption(
    options["initial-capital"],
    strategy.contributionPlan?.initialContribution ?? DEFAULTS.initialCapital
  );
  const contributionPlan = {
    ...strategy.contributionPlan,
    initialContribution: initialCapital,
    legacyMonthlyContribution: parseNumberOption(
      options["monthly-contribution"],
      strategy.contributionPlan?.legacyMonthlyContribution
    )
  };
  const bulzStrategy = STRATEGIES["us-bulz"];
  const bulzBaseScenario =
    bulzStrategy.slippageScenarios.find((item) => item.id === "base") ||
    bulzStrategy.slippageScenarios[0];
  const scenarios = [];

  for (const signalMode of strategy.signalModes) {
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
          feeRate: strategy.feeRate,
          annualCashYield: strategy.annualCashYield,
          taxMode: taxMode.id,
          contributionPlan,
          bulzStrategy,
          usSlippageRate: bulzBaseScenario.slippageRate
        });
        result.meta.scenarioLabel = `${signalMode.label} / ${scenario.label} / ${taxMode.label}`;
        scenarios.push(result);
      }
    }
  }

  return {
    strategy: strategyName,
    label: strategy.label,
    type: strategy.type,
    initialCapital,
    requiredFiles,
    scenarios
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
    ending: formatMetricValue("currency", scenario.metrics.endingValue, scenario.meta.currency)
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
    throw new Error("Strategy name is required. Example: us-bulz");
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
