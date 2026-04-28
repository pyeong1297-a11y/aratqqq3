import path from "node:path";
import { DEFAULTS, STRATEGIES } from "../../src/config.js";
import { loadRequiredData } from "../../src/lib/data-loader.js";
import { runUsQldStrategy } from "../../src/lib/us-qld-strategy.js";

async function main() {
  const dataDir = path.resolve(process.cwd(), "../../data");
  const strategy = STRATEGIES["us-qld-dual"];
  const requiredFiles = { tqqq: "us/tqqq.csv", qqq: "us/qqq.csv", qld: "us/qld.csv", spym: "us/spym.csv", sgov: "us/sgov.csv" };
  const datasets = await loadRequiredData(dataDir, requiredFiles);
  const signalMode = strategy.signalModes.find(m => m.id === "pure-200-3d");

  const configs = [
    {
      label: "1순위 황금 밸런스형 (+50% / +120% / +150%)",
      steps: [
        { threshold: 0.5, sellFraction: 0.25 },
        { threshold: 1.2, sellFraction: 0.75 },
        { threshold: 1.5, sellFraction: 1.0 }
      ]
    },
    {
      label: "2순위 수익 극대화형 (+80% / +120% / +150%)",
      steps: [
        { threshold: 0.8, sellFraction: 0.5 },
        { threshold: 1.2, sellFraction: 0.75 },
        { threshold: 1.5, sellFraction: 1.0 }
      ]
    }
  ];

  for (const cfg of configs) {
    const result = runUsQldStrategy({
      name: strategy.name,
      signalBars: datasets.tqqq,
      qqqBars: datasets.qqq,
      qldBars: datasets.qld,
      spymBars: datasets.spym,
      sgovBars: datasets.sgov,
      initialCapital: 100_000,
      signalMode: { ...signalMode, profitTakeSteps: cfg.steps },
      feeRate: strategy.feeRate,
      annualCashYield: strategy.annualCashYield
    });

    const trades = result.trades;
    let hitStep1 = 0;
    let hitStep2 = 0;
    let hitStep3 = 0;
    let profitableCycles = 0;

    // To count hits per cycle, we track events bounding each cycle
    let eventCursor = 0;
    for (const trade of trades) {
      let cycleHitStep1 = false;
      let cycleHitStep2 = false;
      let cycleHitStep3 = false;
      
      while (eventCursor < result.events.length) {
        const ev = result.events[eventCursor];
        if (ev.date > trade.exitDate) break;
        if (ev.date >= trade.entryDate && ev.type === "profit-take-to-spym") {
          if (ev.threshold === cfg.steps[0].threshold) cycleHitStep1 = true;
          if (ev.threshold === cfg.steps[1].threshold) cycleHitStep2 = true;
          if (ev.threshold === cfg.steps[2].threshold) cycleHitStep3 = true;
        }
        eventCursor++;
      }
      
      if (cycleHitStep1) hitStep1++;
      if (cycleHitStep2) hitStep2++;
      if (cycleHitStep3) hitStep3++;
      if (trade.pnl > 0) profitableCycles++;
    }

    console.log(`\n=== ${cfg.label} ===`);
    console.log(`총 발생한 투자 사이클(진입~퇴출): ${trades.length}회`);
    console.log(`최종 손절 없이 수익으로 마감한 사이클(개념상 성공률): ${profitableCycles}/${trades.length}회 (${(profitableCycles/trades.length * 100).toFixed(1)}%)`);
    console.log(`- 1차 익절(+${cfg.steps[0].threshold*100}%) 도달 횟수: ${hitStep1}/${trades.length}회`);
    console.log(`- 2차 익절(+${cfg.steps[1].threshold*100}%) 도달 횟수: ${hitStep2}/${trades.length}회`);
    console.log(`- 3차 익절(+${cfg.steps[2].threshold*100}%) 도달 횟수: ${hitStep3}/${trades.length}회`);
  }
}
main().catch(console.error);
