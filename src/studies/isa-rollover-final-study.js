import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES, getRequiredFiles } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runIsaStrategy } from "../lib/isa-strategy.js";

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

function buildSignalMode(id, confirmationDays, steps) {
  return {
    id,
    label: id,
    mode: "sma200-entry",
    confirmationDays,
    isaProfitTakeSteps: steps
  };
}

function summarize(result, label, confirmationDays) {
  return {
    plan: label,
    confirmationDays,
    endingValue: result.metrics.endingValue,
    totalReturn: result.metrics.totalReturn,
    cagr: result.metrics.cagr,
    mdd: result.metrics.maxDrawdown,
    tradeCount: result.metrics.tradeCount,
    winRate: result.metrics.winRate,
    avgHoldDays: result.metrics.avgHoldDays,
    accountCount: result.metrics.accountCount,
    contributionCount: result.metrics.contributionCount,
    principalContributed: result.metrics.principalContributed,
    netProfit: result.metrics.netProfit,
    annualTaxPaid: result.metrics.annualTaxPaid,
    exitTaxPaid: result.metrics.exitTaxPaid,
    isaProfitTakeCount: result.metrics.isaProfitTakeCount,
    usProfitTakeCount: result.metrics.usProfitTakeCount,
    marketExposure: result.metrics.marketExposure
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, options["data-dir"] || DEFAULTS.dataDir);
  const outputPath = path.resolve(
    cwd,
    String(options.output || "results/isa-rollover-final-study.json")
  );

  const strategy = STRATEGIES["isa-kodex"];
  const bulzStrategy = STRATEGIES["us-bulz"];
  const bulzBaseScenario =
    bulzStrategy.slippageScenarios.find((item) => item.id === "base") ||
    bulzStrategy.slippageScenarios[0];
  const scenario =
    strategy.executionScenarios.find((item) => item.id === "base") ||
    strategy.executionScenarios[0];
  const requiredFiles = getRequiredFiles("isa-kodex");
  const datasets = await loadRequiredData(dataDir, requiredFiles);

  const baseContributionPlan = {
    ...strategy.contributionPlan,
    legacyMonthlyContribution: 0
  };

  const plans = [
    {
      id: "default-3step",
      label: "Default 3-step (40/10, 60/15, 85/all)",
      steps: [
        { threshold: 0.4, sellFraction: 0.1, destination: "sp500", triggerSource: "signal" },
        { threshold: 0.6, sellFraction: 0.15, destination: "sp500", triggerSource: "signal" },
        { threshold: 0.85, sellFraction: 1.0, destination: "sp500", triggerSource: "signal" }
      ]
    },
    {
      id: "backup-2step",
      label: "Backup 2-step (60/20, 85/all)",
      steps: [
        { threshold: 0.6, sellFraction: 0.2, destination: "sp500", triggerSource: "signal" },
        { threshold: 0.85, sellFraction: 1.0, destination: "sp500", triggerSource: "signal" }
      ]
    }
  ];

  const rows = [];
  for (const plan of plans) {
    for (const confirmationDays of [1, 2, 3, 4, 5]) {
      const signalMode = buildSignalMode(plan.id, confirmationDays, plan.steps);
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
        initialCapital: strategy.contributionPlan.initialContribution,
        signalMode,
        scenario,
        feeRate: strategy.feeRate,
        annualCashYield: strategy.annualCashYield,
        taxMode: "taxed",
        contributionPlan: baseContributionPlan,
        bulzStrategy,
        usSlippageRate: bulzBaseScenario.slippageRate
      });

      rows.push(summarize(result, plan.label, confirmationDays));
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      model: "ISA rollover study with TQQQ-triggered profit-takes on TIGER leverage",
      monthlyContribution: 0,
      rolloverYearsFromStart: baseContributionPlan.rolloverYearsFromStart,
      renewalInitialContribution: baseContributionPlan.renewalInitialContribution,
      renewalAnnualContribution: baseContributionPlan.renewalAnnualContribution,
      executionScenario: scenario.id,
      taxMode: "taxed"
    },
    rows
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
