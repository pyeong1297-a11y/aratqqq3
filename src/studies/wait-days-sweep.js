import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRequiredData } from "../lib/data-loader.js";
import { runUsStrategy } from "../lib/us-strategy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const DATA_DIR = path.join(repoRoot, "data");
const BASE_SLIPPAGE = 0.0005;
const FEE_RATE = 0.0025;
const INITIAL_CAPITAL = 100_000;
const WAIT_DAYS = [5, 6, 7, 8, 9, 10];
const BULZ_START_DATE = "2021-08-18";

function sliceBarsFromDate(bars, startDate) {
  return bars.filter((bar) => bar.date >= startDate);
}

function buildRows({
  name,
  riskBars,
  spymBars,
  sgovBars,
  bilBars,
  waitDays,
  profitTakeSteps,
  profitTakeParking
}) {
  return waitDays.map((confirmationDays) => {
    const result = runUsStrategy({
      name: `${name}-${confirmationDays}d`,
      riskBars,
      spymBars,
      sgovBars,
      parkingFallbackBars: bilBars,
      fxBars: null,
      initialCapital: INITIAL_CAPITAL,
      contributionPlan: {
        initialContribution: INITIAL_CAPITAL,
        legacyMonthlyContribution: 0
      },
      confirmationDays,
      feeRate: FEE_RATE,
      slippageRate: BASE_SLIPPAGE,
      profitTakeSteps,
      profitTakeParking,
      valuationCurrency: "USD",
      taxMode: "none"
    });

    return {
      waitDays: confirmationDays,
      startDate: result.meta.startDate,
      endDate: result.meta.endDate,
      endingValue: result.metrics.endingValue,
      totalReturn: result.metrics.totalReturn,
      cagr: result.metrics.cagr,
      maxDrawdown: result.metrics.maxDrawdown,
      tradeCount: result.metrics.tradeCount,
      winRate: result.metrics.winRate,
      avgHoldDays: result.metrics.avgHoldDays,
      exposure: result.metrics.marketExposure
    };
  });
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatCurrency(value) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function printTable(title, rows) {
  console.log("");
  console.log(`=== ${title} ===`);
  console.log(
    [
      "Wait".padStart(4),
      "Period".padStart(23),
      "Total Return".padStart(12),
      "CAGR".padStart(9),
      "MDD".padStart(9),
      "Trades".padStart(7),
      "Win".padStart(8),
      "AvgHold".padStart(9),
      "Exposure".padStart(9),
      "Ending".padStart(14)
    ].join("  ")
  );
  console.log("-".repeat(122));

  for (const row of rows) {
    const period = `${row.startDate}~${row.endDate}`;
    console.log(
      [
        String(row.waitDays).padStart(4),
        period.padStart(23),
        formatPercent(row.totalReturn).padStart(12),
        formatPercent(row.cagr).padStart(9),
        formatPercent(row.maxDrawdown).padStart(9),
        String(row.tradeCount).padStart(7),
        formatPercent(row.winRate).padStart(8),
        `${row.avgHoldDays.toFixed(1)}d`.padStart(9),
        formatPercent(row.exposure).padStart(9),
        formatCurrency(row.endingValue).padStart(14)
      ].join("  ")
    );
  }
}

async function main() {
  const datasets = await loadRequiredData(DATA_DIR, {
    tqqq: "us/tqqq.csv",
    bulz: "us/bulz.csv",
    spym: "us/spym.csv",
    sgov: "us/sgov.csv",
    bil: "us/bil.csv"
  });

  const tqqqRows = buildRows({
    name: "tqqq-launch",
    riskBars: datasets.tqqq,
    spymBars: datasets.spym,
    sgovBars: datasets.sgov,
    bilBars: datasets.bil,
    waitDays: WAIT_DAYS,
    profitTakeSteps: [],
    profitTakeParking: { sgov: 1 }
  });

  const tqqqOverlapRows = buildRows({
    name: "tqqq-overlap",
    riskBars: sliceBarsFromDate(datasets.tqqq, BULZ_START_DATE),
    spymBars: sliceBarsFromDate(datasets.spym, BULZ_START_DATE),
    sgovBars: sliceBarsFromDate(datasets.sgov, BULZ_START_DATE),
    bilBars: sliceBarsFromDate(datasets.bil, BULZ_START_DATE),
    waitDays: WAIT_DAYS,
    profitTakeSteps: [],
    profitTakeParking: { sgov: 1 }
  });

  const bulzRows = buildRows({
    name: "bulz-launch",
    riskBars: datasets.bulz,
    spymBars: datasets.spym,
    sgovBars: datasets.sgov,
    bilBars: datasets.bil,
    waitDays: WAIT_DAYS,
    profitTakeSteps: [{ threshold: 1.0, sellFraction: 1.0 }],
    profitTakeParking: { sgov: 1 }
  });

  printTable("TQQQ since launch | SMA200 wait 5-10 days", tqqqRows);
  printTable("TQQQ on BULZ-era overlap | SMA200 wait 5-10 days", tqqqOverlapRows);
  printTable("BULZ since launch | SMA200 wait 5-10 days", bulzRows);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
