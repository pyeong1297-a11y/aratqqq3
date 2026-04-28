import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { STRATEGIES, getRequiredFiles, DEFAULTS } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runSnowballStrategy } from "../lib/snowball-strategy.js";

const COMBOS = [
  { id: "A-optimized",    tp1Pct: 37, tp2Pct: 87, sell1Pct: 53, sell2Pct: 47, label: "현 최적화 (37/87, 53/47)" },
  { id: "B-round-close",  tp1Pct: 35, tp2Pct: 85, sell1Pct: 55, sell2Pct: 45, label: "둥근 근사 (35/85, 55/45)" },
  { id: "C-round-half",   tp1Pct: 35, tp2Pct: 85, sell1Pct: 50, sell2Pct: 50, label: "둥근 반반 (35/85, 50/50)" },
  { id: "D-early-tp",     tp1Pct: 30, tp2Pct: 80, sell1Pct: 50, sell2Pct: 50, label: "빠른 익절 (30/80, 50/50)" },
  { id: "E-late-tp",      tp1Pct: 40, tp2Pct: 90, sell1Pct: 50, sell2Pct: 50, label: "여유 익절 (40/90, 50/50)" },
  { id: "F-basic-orig",   tp1Pct: 15, tp2Pct: 68, sell1Pct: 50, sell2Pct: 35, label: "원본 Basic (15/68, 50/35)" },
];

const CASH_YIELDS = [
  { id: "high",    rate: 0.045, label: "4.5% (기존 가정)" },
  { id: "current", rate: 0.030, label: "3.0% (현실적 세후)" },
];

const TAX_MODES = ["none", "taxed"];

function fmt(n, digits = 2) {
  return (n * 100).toFixed(digits) + "%";
}

function fmtUsd(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

async function main() {
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
  const results = [];

  for (const combo of COMBOS) {
    for (const cashYield of CASH_YIELDS) {
      for (const taxMode of TAX_MODES) {
        const result = runSnowballStrategy({
          name: strategy.name,
          qqqBars: datasets[strategy.signalSymbol],
          riskBars: datasets[strategy.riskSymbol],
          initialCapital,
          contributionPlan,
          feeRate: strategy.feeRate,
          annualCashYield: cashYield.rate,
          slippagePerShare: execution.slippagePerShare,
          valuationCurrency: strategy.valuationCurrency,
          taxMode,
          settings: {
            ...strategy.settings,
            dip1Drawdown: -0.11,
            dip2Drawdown: -0.22,
            tp1Threshold: combo.tp1Pct / 100,
            tp2Threshold: combo.tp2Pct / 100,
            tp3Threshold: 3.55,
            tp1SellFractionOfBase: combo.sell1Pct / 100,
            tp2SellFractionOfBase: combo.sell2Pct / 100,
          }
        });

        results.push({
          comboId: combo.id,
          comboLabel: combo.label,
          tp1Pct: combo.tp1Pct,
          tp2Pct: combo.tp2Pct,
          sell1Pct: combo.sell1Pct,
          sell2Pct: combo.sell2Pct,
          cashYieldId: cashYield.id,
          cashYieldLabel: cashYield.label,
          cashYieldRate: cashYield.rate,
          taxMode,
          cagr: result.metrics.cagr,
          mdd: result.metrics.maxDrawdown,
          calmar: result.metrics.calmarRatio,
          sharpe: result.metrics.sharpeRatio,
          sortino: result.metrics.sortinoRatio,
          totalReturn: result.metrics.totalReturn,
          endingValue: result.metrics.endingValue,
          tradeCount: result.metrics.tradeCount,
          profitTakeCount: result.metrics.profitTakeCount,
          dipEntryCount: result.metrics.dipEntryCount,
          gcEntryCount: result.metrics.gcEntryCount,
          dcExitCount: result.metrics.dcExitCount,
        });
      }
    }
  }

  // ── 콘솔 출력: 비과세 4.5% vs 3.0% 비교 ───────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  스노우볼 Robustness Check — 둥근 파라미터 비교");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const taxMode of TAX_MODES) {
    const taxLabel = taxMode === "none" ? "비과세" : "과세 (22%)";
    console.log(`\n┌─── ${taxLabel} ────────────────────────────────────────────┐\n`);

    console.log(
      "조합".padEnd(34) +
      "│ 현금이율 ".padEnd(18) +
      "│ CAGR".padEnd(10) +
      "│ MDD".padEnd(11) +
      "│ Calmar".padEnd(10) +
      "│ 최종금액".padEnd(18)
    );
    console.log("─".repeat(105));

    for (const combo of COMBOS) {
      for (const cashYield of CASH_YIELDS) {
        const row = results.find(
          (r) => r.comboId === combo.id && r.cashYieldId === cashYield.id && r.taxMode === taxMode
        );
        if (!row) continue;

        const isOptimized = combo.id === "A-optimized" && cashYield.id === "high";
        const marker = isOptimized ? " ★" : "";

        console.log(
          (row.comboLabel + marker).padEnd(34) +
          "│ " + cashYield.label.padEnd(16) +
          "│ " + fmt(row.cagr).padEnd(8) +
          "│ " + fmt(row.mdd).padEnd(9) +
          "│ " + row.calmar.toFixed(2).padEnd(8) +
          "│ " + fmtUsd(row.endingValue)
        );
      }
      console.log("─".repeat(105));
    }
  }

  // ── CAGR 차이 요약 (비과세, 현금 3.0%) ───────────────────
  console.log("\n\n┌─── CAGR 차이 요약 (비과세, 현금 3.0%) ────────────────────┐\n");
  const baseRow = results.find(
    (r) => r.comboId === "A-optimized" && r.cashYieldId === "current" && r.taxMode === "none"
  );
  for (const combo of COMBOS) {
    const row = results.find(
      (r) => r.comboId === combo.id && r.cashYieldId === "current" && r.taxMode === "none"
    );
    if (!row || !baseRow) continue;
    const diff = row.cagr - baseRow.cagr;
    const sign = diff >= 0 ? "+" : "";
    console.log(
      `  ${row.comboLabel.padEnd(32)} CAGR ${fmt(row.cagr)}  (${sign}${fmt(diff)} vs 최적화)`
    );
  }

  // ── 이벤트 횟수 비교 (비과세, 현금 4.5%) ──────────────────
  console.log("\n\n┌─── 이벤트 횟수 (비과세, 현금 4.5%) ────────────────────────┐\n");
  console.log(
    "조합".padEnd(34) +
    "│ TP횟수".padEnd(10) +
    "│ Dip횟수".padEnd(10) +
    "│ GC횟수".padEnd(10) +
    "│ DC횟수".padEnd(10) +
    "│ Trade"
  );
  console.log("─".repeat(90));
  for (const combo of COMBOS) {
    const row = results.find(
      (r) => r.comboId === combo.id && r.cashYieldId === "high" && r.taxMode === "none"
    );
    if (!row) continue;
    console.log(
      row.comboLabel.padEnd(34) +
      "│ " + String(row.profitTakeCount).padEnd(8) +
      "│ " + String(row.dipEntryCount).padEnd(8) +
      "│ " + String(row.gcEntryCount).padEnd(8) +
      "│ " + String(row.dcExitCount).padEnd(8) +
      "│ " + row.tradeCount
    );
  }

  // ── JSON 파일 저장 ────────────────────────────────────────
  const outputPath = path.resolve(cwd, "results/snowball-robustness-check.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    combos: COMBOS,
    cashYields: CASH_YIELDS,
    results
  };
  await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`\n결과 저장: ${outputPath}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
