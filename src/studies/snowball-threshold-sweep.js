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

function sortByKey(rows, key) {
  return [...rows].sort(
    (left, right) =>
      right[key] - left[key] ||
      left.tp1ThresholdPct - right.tp1ThresholdPct ||
      left.tp2ThresholdPct - right.tp2ThresholdPct
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const comboId = String(options.id || "combo");
  const tp1SellPct = parseNumber(options["tp1-sell-pct"], "tp1-sell-pct");
  const tp2SellPct = parseNumber(options["tp2-sell-pct"], "tp2-sell-pct");
  const outputPath = String(
    options.output || `results/${comboId.replace(/[^a-z0-9-_]/gi, "-")}.json`
  );
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

  if (tp1SellPct < 0 || tp2SellPct < 0 || tp1SellPct + tp2SellPct > 100) {
    throw new Error("Sell combo must satisfy 0 <= tp1,tp2 and tp1 + tp2 <= 100.");
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
  const rows = [];

  for (let tp1ThresholdPct = 5; tp1ThresholdPct <= 40; tp1ThresholdPct += 1) {
    for (let tp2ThresholdPct = 40; tp2ThresholdPct <= 120; tp2ThresholdPct += 1) {
      if (tp2ThresholdPct <= tp1ThresholdPct) {
        continue;
      }

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

      rows.push({
        comboId,
        tp1SellPct,
        tp2SellPct,
        remainingPct: 100 - tp1SellPct - tp2SellPct,
        tp1ThresholdPct,
        tp2ThresholdPct,
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

  const topCagr = sortByKey(rows, "cagr").slice(0, 20);
  const topCalmar = sortByKey(rows, "calmar").slice(0, 20);
  const summary = {
    comboId,
    tp1SellPct,
    tp2SellPct,
    remainingPct: 100 - tp1SellPct - tp2SellPct,
    bestCagr: topCagr[0],
    bestCalmar: topCalmar[0],
    topCagr,
    topCalmar,
    evaluatedCount: rows.length
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    assumptions: {
      startDate: strategy.settings.startDate,
      endDate: datasets[strategy.riskSymbol].at(-1)?.date ?? null,
      taxMode: "taxed",
      tp1ThresholdPctRange: [5, 40],
      tp2ThresholdPctRange: [40, 120],
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
    rows
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
