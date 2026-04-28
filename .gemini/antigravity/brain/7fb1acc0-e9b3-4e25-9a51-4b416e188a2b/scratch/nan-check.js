import { runUsQldStrategy } from "../../src/lib/us-qld-strategy.js";
import { STRATEGIES, getRequiredFiles } from "../../src/config.js";
import { loadRequiredData } from "../../src/lib/data-loader.js";

async function main() {
  const strategyName = "us-qld-dual";
  const strategy = STRATEGIES[strategyName];
  const reqs = getRequiredFiles(strategyName);
  const data = await loadRequiredData("../../data", reqs);
  
  const result = runUsQldStrategy({
    name: strategy.name,
    signalBars: data.tqqq,
    qqqBars: data.qqq,
    qldBars: data.qld,
    spymBars: data.spym,
    sgovBars: data.sgov,
    initialCapital: 100000,
    signalMode: strategy.signalModes[0],
    feeRate: strategy.feeRate,
    annualCashYield: strategy.annualCashYield,
  });
  
  const isNaNValue = result.dailyValues.filter(x => Number.isNaN(x.value));
  console.log("NaN rows:", isNaNValue.length);
  if (isNaNValue.length > 0) {
    console.log("First NaN row:", isNaNValue[0]);
  }
}
main();
