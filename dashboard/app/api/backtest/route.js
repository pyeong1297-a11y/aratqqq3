import { NextResponse } from 'next/server';
import { loadAndSyncData } from '@/lib/csvLoader';
import { runTrendStrategy, runSnowballStrategy } from '@/lib/backtest';

export async function POST(req) {
  try {
    const body = await req.json();
    const { strategyType, params } = body;
    const baseUrl = new URL(req.url).origin;

    if (strategyType === 'tqqq' || strategyType === 'tqqq_balance' || strategyType === 'bulz' || strategyType === 'isa_qld' || strategyType === 'manual' || strategyType === 'bitu') {
      let signalSymbol = 'tqqq';
      let tradeSymbol = 'tqqq';

      if (strategyType === 'bulz') { signalSymbol = 'bulz'; tradeSymbol = 'bulz'; }
      else if (strategyType === 'bitu') { signalSymbol = 'bitu'; tradeSymbol = 'bitu'; }
      else if (strategyType === 'isa_qld') { signalSymbol = 'tqqq'; tradeSymbol = 'qld'; }
      else if (strategyType === 'manual') { signalSymbol = params.symbol || 'tqqq'; tradeSymbol = params.symbol || 'tqqq'; }
      
      const bars     = await loadAndSyncData(signalSymbol, { baseUrl });
      const tradeBars = await loadAndSyncData(tradeSymbol, { baseUrl });
      const sgovBars = await loadAndSyncData('sgov', { baseUrl });
      const bilBars  = await loadAndSyncData('bil', { baseUrl });
      const spymBars = await loadAndSyncData('spym', { baseUrl });

      // Merge sgov + bil (bil as fallback for older dates)
      const sgovMap = new Map([...bilBars, ...sgovBars].map(b => [b.date, b]));
      const parkingBars = [...sgovMap.values()].sort((a, b) => a.date.localeCompare(b.date));

      const profitTakeSteps = (params.profitTakeSteps || []).map(s => ({
        threshold: parseFloat(s.threshold),
        sellFraction: parseFloat(s.sellFraction),
        spymRatio: parseFloat(s.spymRatio ?? 100) / 100,
      }));

      const result = runTrendStrategy({
        bars,
        tradeBars,
        parkingBars,
        profitBars: spymBars,
        primaryParkingStartDate: sgovBars[0]?.date || '',
        confirmDays: parseInt(params.confirmDays ?? 3),
        confirmDays2: parseInt(params.confirmDays2 ?? (parseInt(params.confirmDays ?? 3) + 1)),
        smaPeriod: 200,
        profitTakeSteps,
        profitTakeEnabled: params.profitTakeEnabled !== false,
        stopLossEnabled: params.stopLossEnabled === true,
        stopLossThreshold: parseFloat(params.stopLossThreshold ?? -5) / 100,
        splitEntry: params.splitEntry || false,
        splitRefMode: params.splitRefMode || 'max',
        startDate: params.startDate || '',
        endDate: params.endDate || '',
        initialCapital: parseFloat(params.initialCapital || 100_000),
        feeRate: 0.0025,
        monthlyDCA: parseFloat(params.monthlyDCA || 0),
        annualContributionLimit: parseFloat(params.annualContributionLimit || 0),
      });

      // Downsample equity curve for performance (max 800 points)
      const curve = downsample(result.equityCurve, 800);
      return NextResponse.json({ ...result, equityCurve: curve });
    }

    if (strategyType === 'snowball') {
      const tqqqBars = await loadAndSyncData('tqqq', { baseUrl });
      const qqqBars  = await loadAndSyncData('qqq', { baseUrl });
      const sgovBars = await loadAndSyncData('sgov', { baseUrl });
      const bilBars  = await loadAndSyncData('bil', { baseUrl });

      const result = runSnowballStrategy({
        tqqqBars,
        qqqBars,
        sgovBars,
        bilBars,
        settings: {
          dip1Drawdown:          parseFloat(params.dip1Drawdown ?? -0.11),
          dip2Drawdown:          parseFloat(params.dip2Drawdown ?? -0.22),
          dip1Weight:            parseFloat(params.dip1Weight ?? 0.20),
          dip2Weight:            parseFloat(params.dip2Weight ?? 0.70),
          bonusWeight:           parseFloat(params.bonusWeight ?? 0.10),
          tp1Threshold:          parseFloat(params.tp1Threshold ?? 0.37),
          tp2Threshold:          parseFloat(params.tp2Threshold ?? 0.87),
          tp3Threshold:          parseFloat(params.tp3Threshold ?? 3.55),
          tp1SellFractionOfBase: parseFloat(params.tp1SellFractionOfBase ?? 0.53),
          tp2SellFractionOfBase: parseFloat(params.tp2SellFractionOfBase ?? 0.47),
          gcShort:               parseInt(params.gcShort ?? 5),
          gcLong:                parseInt(params.gcLong ?? 220),
          cooldownDays:          parseInt(params.cooldownDays ?? 5),
          qqqLookbackDays:       252,
          rsiPeriod:             14,
          rsiBonusThreshold:     35,
          startDate:             params.startDate || '',
          endDate:               params.endDate || '',
        },
        initialCapital: parseFloat(params.initialCapital || 100_000),
        feeRate: 0.0025,
        annualCashYield: 0.045, // kept as fallback; engine uses SGOV map first
      });

      const curve = downsample(result.equityCurve, 800);
      return NextResponse.json({ ...result, equityCurve: curve });
    }

    return NextResponse.json({ error: 'Unknown strategyType' }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function downsample(curve, maxPoints) {
  if (curve.length <= maxPoints) return curve;
  const step = Math.ceil(curve.length / maxPoints);
  const result = [];
  for (let i = 0; i < curve.length; i += step) result.push(curve[i]);
  if (result[result.length - 1] !== curve[curve.length - 1]) result.push(curve[curve.length - 1]);
  return result;
}
