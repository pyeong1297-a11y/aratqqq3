import { loadAndSyncData } from '../lib/csvLoader.js';
import { runSnowballStrategy } from '../lib/backtest.js';

async function testSnowball() {
  const tqqqBars = await loadAndSyncData('TQQQ');
  const qqqBars  = await loadAndSyncData('QQQ');
  const sgovBars = await loadAndSyncData('SGOV');
  const bilBars  = await loadAndSyncData('BIL');

  const settings = {
    dip1Drawdown: -0.11,
    dip2Drawdown: -0.22,
    dip1Weight: 0.20,
    dip2Weight: 0.70,
    bonusWeight: 0.10,
    tp1Threshold: 0.37,
    tp1SellFractionOfBase: 0.53,
    tp2Threshold: 0.87,
    tp2SellFractionOfBase: 0.47,
    tp3Threshold: 3.55,
    gcShort: 5,
    gcLong: 220,
    cooldownDays: 5,
    qqqLookbackDays: 252,
    rsiPeriod: 14,
    rsiBonusThreshold: 35,
    startDate: '',
    endDate: '',
  };

  const result = runSnowballStrategy({
    tqqqBars,
    qqqBars,
    sgovBars,
    bilBars,
    settings,
    initialCapital: 100000,
    feeRate: 0.0025,
  });

  console.log('--- Snowball Optimized Result ---');
  console.log('CAGR:', (result.metrics.cagr * 100).toFixed(2) + '%');
  console.log('MDD:', (result.metrics.mdd * 100).toFixed(2) + '%');
  console.log('Final Value:', '$' + Math.round(result.metrics.finalValue).toLocaleString());
  console.log('Total Return:', (result.metrics.totalReturn * 100).toFixed(2) + '%');
  console.log('Start Date:', result.metrics.startDate);
  console.log('End Date:', result.metrics.endDate);
}

testSnowball().catch(console.error);
