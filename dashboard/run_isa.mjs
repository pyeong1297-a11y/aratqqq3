import { loadAndSyncData } from './lib/csvLoader.js';
import { runTrendStrategy } from './lib/backtest.js';

async function main() {
  const tqqqBars = await loadAndSyncData('TQQQ');
  const qldBars = await loadAndSyncData('QLD');
  const sgovBars = await loadAndSyncData('SGOV');
  const bilBars = await loadAndSyncData('BIL');
  const spymBars = await loadAndSyncData('SPYM');

  const sgovMap = new Map([...bilBars, ...sgovBars].map(b => [b.date, b]));
  const parkingBars = [...sgovMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const profitTakeSteps = [
    { threshold: 0.50, sellFraction: 0.20, target: 'spym' },
    { threshold: 1.00, sellFraction: 0.50, target: 'spym' },
    { threshold: 2.00, sellFraction: 1.00, target: 'sgov' },
  ];

  console.log('| 대기 | CAGR | MDD | 최종평가금액 | 총수익률 |');
  console.log('| :---: | :---: | :---: | :---: | :---: |');

  for (let waitDays = 1; waitDays <= 10; waitDays++) {
    const result = runTrendStrategy({
      bars: tqqqBars,
      tradeBars: qldBars,
      parkingBars: parkingBars,
      profitBars: spymBars,
      confirmDays: waitDays,
      confirmDays2: waitDays + 1,
      smaPeriod: 200,
      profitTakeSteps: profitTakeSteps,
      profitTakeTarget: 'spym', // global fallback
      splitEntry: false,
      splitRefMode: 'max',
      startDate: '',
      endDate: '',
      initialCapital: 10000,
      feeRate: 0.0025,
    });

    const finalVal = result.metrics.finalValue;
    const initial = 10000;
    const profit = Math.max(0, finalVal - initial);
    const tax = profit * 0.099;
    const afterTaxFinalVal = finalVal - tax;

    const preCagr = (result.metrics.cagr * 100).toFixed(2) + '%';
    const mdd = (result.metrics.mdd * 100).toFixed(2) + '%';
    const preFinalValue = '$' + Math.round(finalVal).toLocaleString();
    const preTotalReturn = (result.metrics.totalReturn * 100).toFixed(1) + '%';
    
    const years = (new Date(result.metrics.endDate) - new Date(result.metrics.startDate)) / (365.25 * 24 * 3600 * 1000);
    const afterTaxCagr = ((Math.pow(afterTaxFinalVal / initial, 1 / years) - 1) * 100).toFixed(2) + '%';
    const afterTaxTotalReturn = (((afterTaxFinalVal / initial) - 1) * 100).toFixed(1) + '%';
    const afterTaxFinalValueStr = '$' + Math.round(afterTaxFinalVal).toLocaleString();

    let prefix = `${waitDays}일`;
    if (waitDays === 3 || waitDays === 4) prefix = `**${waitDays}일**`;
    
    const cagrStr = `${preCagr} (세후 ${afterTaxCagr})`;
    const finalValueStr = `${preFinalValue} (세후 ${afterTaxFinalValueStr})`;
    const totalReturnStr = `${preTotalReturn} (세후 ${afterTaxTotalReturn})`;

    let row = `| ${prefix} | `;
    if (waitDays === 3 || waitDays === 4) {
      row += `**${cagrStr}** | **${mdd}** | **${finalValueStr}** | **${totalReturnStr}** |`;
    } else {
      row += `${cagrStr} | ${mdd} | ${finalValueStr} | ${totalReturnStr} |`;
    }
    
    console.log(row);
  }
}

main().catch(console.error);
