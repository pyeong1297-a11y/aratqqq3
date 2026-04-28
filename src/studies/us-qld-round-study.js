/**
 * us-qld-pt-round-study.js
 * 과최적화 방지를 위해 "사람이 실제로 쓸 수 있는" 둥근 파라미터만 사용하는 그리드 서치.
 * 익절 구간: 20/30/40/50/60/70/80/100/120/150 (10% 단위)
 * 매도 비율: 25/33/50/66/75/100 (분수 단위: 1/4, 1/3, 1/2, 2/3, 3/4, 전량)
 * 2-step 구조 (1차 부분 매도 + 2차 전량 매도)
 * + 3-step 구조 (1차 + 2차 부분 + 3차 전량)
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULTS, STRATEGIES } from "../config.js";
import { loadRequiredData } from "../lib/data-loader.js";
import { runUsQldStrategy } from "../lib/us-qld-strategy.js";

const ROUND_THRESHOLDS = [20, 30, 40, 50, 60, 70, 80, 100, 120, 150];
const ROUND_SELL_FRACS = [0.25, 0.33, 0.5, 0.66, 0.75];

function computeCalmar(cagr, mdd) {
  if (!Number.isFinite(cagr) || !Number.isFinite(mdd) || mdd >= 0) return null;
  return cagr / Math.abs(mdd);
}

function pct(v) { return `${(v * 100).toFixed(0)}%`; }
function fmtRow(r) {
  const steps = r.steps.map(s => `+${pct(s.t)} → sell ${pct(s.f)}`).join(', ');
  return {
    steps,
    cagr: (r.cagr * 100).toFixed(2) + '%',
    mdd: (r.mdd * 100).toFixed(2) + '%',
    calmar: r.calmar?.toFixed(4) ?? '-'
  };
}

function evaluate(datasets, strategy, signalMode, steps) {
  const result = runUsQldStrategy({
    name: strategy.name,
    signalBars: datasets.tqqq,
    qqqBars: datasets.qqq,
    qldBars: datasets.qld,
    spymBars: datasets.spym,
    sgovBars: datasets.sgov,
    initialCapital: 100_000,
    signalMode: { ...signalMode, profitTakeSteps: steps },
    feeRate: strategy.feeRate,
    annualCashYield: strategy.annualCashYield
  });
  return {
    metrics: result.metrics
  };
}

async function main() {
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, DEFAULTS.dataDir);
  const outputPath = path.resolve(cwd, "results/us-qld-round-study.json");

  const strategy = STRATEGIES["us-qld-dual"];

  const requiredFiles = {
    tqqq: "us/tqqq.csv", qqq: "us/qqq.csv", qld: "us/qld.csv", spym: "us/spym.csv", sgov: "us/sgov.csv"
  };
  const datasets = await loadRequiredData(dataDir, requiredFiles);

  const results = { "pure-200-3d": [], "dual-strict": [] };

  for (const signalMode of strategy.signalModes) {
    const modeId = signalMode.id;
    let count = 0;
    console.log(`\n=== Mode: ${modeId} ===`);

    // --- 2-STEP ---
    for (const t1 of ROUND_THRESHOLDS) {
      for (const t2 of ROUND_THRESHOLDS) {
        if (t2 <= t1) continue;
        for (const f1 of ROUND_SELL_FRACS) {
          // f2 = 1.0 (전량)
          const steps = [
            { threshold: t1 / 100, sellFraction: f1 },
            { threshold: t2 / 100, sellFraction: 1.0 }
          ];
          const r = evaluate(datasets, strategy, signalMode, steps);
          const calmar = computeCalmar(r.metrics.cagr, r.metrics.maxDrawdown);
          results[modeId].push({
            stepCount: 2,
            steps: [{ t: t1/100, f: f1 }, { t: t2/100, f: 1.0 }],
            cagr: r.metrics.cagr,
            mdd: r.metrics.maxDrawdown,
            calmar
          });
          count++;
        }
      }
    }

    // --- 3-STEP ---
    for (const t1 of ROUND_THRESHOLDS) {
      for (const t2 of ROUND_THRESHOLDS) {
        if (t2 <= t1) continue;
        for (const t3 of ROUND_THRESHOLDS) {
          if (t3 <= t2) continue;
          for (const f1 of ROUND_SELL_FRACS) {
            for (const f2 of ROUND_SELL_FRACS) {
              // f3 = 1.0 (전량)
              const steps = [
                { threshold: t1 / 100, sellFraction: f1 },
                { threshold: t2 / 100, sellFraction: f2 },
                { threshold: t3 / 100, sellFraction: 1.0 }
              ];
              const r = evaluate(datasets, strategy, signalMode, steps);
              const calmar = computeCalmar(r.metrics.cagr, r.metrics.maxDrawdown);
              results[modeId].push({
                stepCount: 3,
                steps: [{ t: t1/100, f: f1 }, { t: t2/100, f: f2 }, { t: t3/100, f: 1.0 }],
                cagr: r.metrics.cagr,
                mdd: r.metrics.maxDrawdown,
                calmar
              });
              count++;
            }
          }
        }
      }
    }

    const sorted = [...results[modeId]].sort((a, b) => (b.calmar ?? -99) - (a.calmar ?? -99));
    const topCalmar = sorted.slice(0, 15);
    const topCagr = [...results[modeId]].sort((a, b) => b.cagr - a.cagr).slice(0, 15);

    console.log(`총 ${count}개 조합 평가 완료`);
    console.log(`\n🏆 Calmar 상위 5 (수익/위험 균형)`);
    topCalmar.slice(0, 5).forEach((r, i) => { const f = fmtRow(r); console.log(`  ${i+1}. ${f.steps} | CAGR ${f.cagr} MDD ${f.mdd} Calmar ${f.calmar}`); });
    console.log(`\n📈 CAGR 상위 5 (수익 극대화)`);
    topCagr.slice(0, 5).forEach((r, i) => { const f = fmtRow(r); console.log(`  ${i+1}. ${f.steps} | CAGR ${f.cagr} MDD ${f.mdd} Calmar ${f.calmar}`); });

    results[modeId] = { topCalmar, topCagr };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n✅ 결과 저장: ${outputPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
