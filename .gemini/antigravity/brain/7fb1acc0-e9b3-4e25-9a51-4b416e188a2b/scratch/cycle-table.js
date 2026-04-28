import path from "node:path";
import { STRATEGIES } from "../../src/config.js";
import { loadRequiredData } from "../../src/lib/data-loader.js";
import { runUsQldStrategy } from "../../src/lib/us-qld-strategy.js";

async function main() {
  const dataDir = path.resolve(process.cwd(), "../../data");
  const strategy = STRATEGIES["us-qld-dual"];
  const requiredFiles = { tqqq: "us/tqqq.csv", qqq: "us/qqq.csv", qld: "us/qld.csv", spym: "us/spym.csv", sgov: "us/sgov.csv" };
  const datasets = await loadRequiredData(dataDir, requiredFiles);
  const signalMode = strategy.signalModes.find(m => m.id === "pure-200-3d");

  // Run WITH NO profit taking to see the maximum potential of each cycle
  const result = runUsQldStrategy({
    name: strategy.name,
    signalBars: datasets.tqqq,
    qqqBars: datasets.qqq,
    qldBars: datasets.qld,
    spymBars: datasets.spym,
    sgovBars: datasets.sgov,
    initialCapital: 100_000,
    signalMode: { ...signalMode, profitTakeSteps: [] }, // No PT
    feeRate: strategy.feeRate,
    annualCashYield: strategy.annualCashYield
  });

  console.log("| 사이클 번호 | 진입일 | 퇴출일 | 보유 일수 | 사이클 수익률(매도 전 최대) | 최종 사이클 수익률 |");
  console.log("| :--- | :--- | :--- | :--- | :--- | :--- |");
  
  result.trades.forEach((trade, i) => {
    // To find max return inside the cycle, we iterate over dailyValues during this trade period
    // But since we don't have daily trade level values separated easily, we can just look at qldMap
    const startIndex = datasets.qld.findIndex(b => b.date === trade.entryDate);
    const endIndex = datasets.qld.findIndex(b => b.date === trade.exitDate);
    
    let maxReturn = 0;
    const entryPrice = datasets.qld[startIndex].adjOpen; // Approx
    
    if (startIndex >= 0 && endIndex >= 0) {
      for (let j = startIndex; j <= endIndex; j++) {
        const ret = datasets.qld[j].adjClose / entryPrice - 1;
        if (ret > maxReturn) maxReturn = ret;
      }
    }
    
    const finalPct = (trade.returnPct * 100).toFixed(1) + "%";
    const maxPct = (maxReturn * 100).toFixed(1) + "%";
    
    console.log(`| ${i + 1} | ${trade.entryDate} | ${trade.exitDate} | ${trade.holdDays} | 최대 **+${maxPct}** | **${finalPct}** |`);
  });
}
main().catch(console.error);
