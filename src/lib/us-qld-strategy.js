import {
  average,
  calculateCagr,
  calculateMaxDrawdown,
  calculateWinRate,
  findLatestIndexBefore
} from "./metrics.js";
import { buildSignalSeries, buildQqqReturnMap } from "./isa-helpers.js";
import { buyWithCash, positionValue, sellShares } from "./portfolio.js";

function getQldTradePrice(row, tradeSide) {
  return row.qld.adjOpen;
}

function getSpymTradePrice(row, tradeSide) {
  return row.spym.adjOpen;
}

function getTotalValue(cash, qldShares, spymShares, row) {
  return (
    cash +
    positionValue(qldShares, row.qld.adjClose) +
    positionValue(spymShares, row.spym.adjClose)
  );
}

function normalizeProfitTakeSteps(signalMode) {
  if (!Array.isArray(signalMode?.profitTakeSteps)) {
    return [];
  }
  return signalMode.profitTakeSteps
    .filter((step) => Number.isFinite(step.threshold) && Number.isFinite(step.sellFraction))
    .map((step) => ({
      threshold: step.threshold,
      sellFraction: step.sellFraction
    }))
    .sort((left, right) => left.threshold - right.threshold);
}

export function runUsQldStrategy({
  name,
  signalBars,
  qqqBars,
  qldBars,
  spymBars,
  sgovBars,
  initialCapital,
  signalMode,
  feeRate,
  annualCashYield,
}) {
  const qldMap = new Map(qldBars.map(b => [b.date, b]));
  const spymMap = new Map(spymBars.map(b => [b.date, b]));
  const sgovMap = new Map(sgovBars.map(b => [b.date, b]));
  const startDate = signalBars.length > 0 ? signalBars[0].date : "1970-01-01";
  
  // Align timeline to QLD available dates that also have SPYM and start after TQQQ signal
  const timeline = qldBars.filter(b => spymMap.has(b.date) && b.date >= startDate).map(b => ({
    date: b.date,
    qld: b,
    spym: spymMap.get(b.date)
  }));

  if (timeline.length === 0) {
    throw new Error(`${name}: timeline is empty.`);
  }

  const signalSeries = buildSignalSeries(signalBars, signalMode);
  const signalDates = signalSeries.map(item => item.date);
  const profitTakeSteps = normalizeProfitTakeSteps(signalMode);

  let cash = initialCapital;
  let qldShares = 0;
  let spymShares = 0;
  
  let activeCycle = null;
  let marketExposureDays = 0;
  let cashDays = 0;
  
  const dailyValues = [];
  const events = [];
  const trades = [];
  const cashDailyRate = (1 + annualCashYield) ** (1 / 252) - 1;

  for (let index = 0; index < timeline.length; index += 1) {
    const row = timeline[index];
    const prevQldBar = index > 0 ? timeline[index - 1].qld : null;
    
    // Apply synthetic interest to cash
    if (index > 0 && cash > 0) {
      cash *= (1 + cashDailyRate);
    }
    
    // Process signals
    const latestSignalIndex = findLatestIndexBefore(signalDates, row.date);
    const latestSignal = latestSignalIndex >= 0 ? signalSeries[latestSignalIndex] : null;
    const desiredRisk = latestSignal ? latestSignal.invested : false;
    
    const currentlyInRisk = qldShares > 0;
    
    // Buy QLD
    if (!currentlyInRisk && desiredRisk) {
      // Sell all SPYM if we have any to consolidate capital, and use all Cash (including SPYM liquidation)
      if (spymShares > 0) {
        const spymPrice = getSpymTradePrice(row, "sell");
        const sale = sellShares(spymShares, spymPrice, feeRate, 0);
        cash += sale.proceeds;
        spymShares = 0;
        events.push({ date: row.date, type: "exit-spym", proceeds: sale.proceeds });
      }
      
      const qldPrice = getQldTradePrice(row, "buy");
      const buy = buyWithCash(cash, qldPrice, feeRate, 0);
      cash = 0;
      qldShares = buy.shares;
      
      activeCycle = {
        entryDate: row.date,
        entryIndex: index,
        entryTradePrice: qldPrice,
        startValue: getTotalValue(cash, qldShares, spymShares, row),
        nextProfitTakeIndex: 0
      };
      
      events.push({ date: row.date, type: "entry-qld", tradePrice: qldPrice, shares: buy.shares });
    }
    // Sell all QLD
    else if (currentlyInRisk && !desiredRisk) {
      const qldPrice = getQldTradePrice(row, "sell");
      const sale = sellShares(qldShares, qldPrice, feeRate, 0);
      cash += sale.proceeds;
      qldShares = 0;
      
      // Park in SPYM when exiting fully (optional? The user said "park in SPY/S&P500")
      // We will put everything in SGOV (cash) upon Dead Cross to match the ISA logic where exit = fully cash/SGOV.
      // Wait, ISA exits into cash (SGOV). Only profit-takes go into SP500. So we maintain this logic.

      events.push({ date: row.date, type: "exit-qld", tradePrice: qldPrice, proceeds: sale.proceeds });
      
      if (activeCycle) {
        const endValue = getTotalValue(cash, qldShares, spymShares, row);
        trades.push({
          entryDate: activeCycle.entryDate,
          exitDate: row.date,
          holdDays: index - activeCycle.entryIndex,
          pnl: endValue - activeCycle.startValue,
          returnPct: activeCycle.startValue > 0 ? endValue / activeCycle.startValue - 1 : 0
        });
        activeCycle = null;
      }
    }
    
    // Handle Profit Takes
    if (desiredRisk && activeCycle && qldShares > 0 && activeCycle.nextProfitTakeIndex < profitTakeSteps.length) {
      while (activeCycle.nextProfitTakeIndex < profitTakeSteps.length) {
        const nextStep = profitTakeSteps[activeCycle.nextProfitTakeIndex];
        const currentQldTradePrice = getQldTradePrice(row, "sell");
        const currentReturn = currentQldTradePrice / activeCycle.entryTradePrice - 1;
        
        if (currentReturn < nextStep.threshold) {
          break;
        }
        
        // Trigger Profit Take into SPYM
        const boundedSellFraction = Math.min(Math.max(nextStep.sellFraction, 0), 1);
        const sharesToSell = qldShares * boundedSellFraction;
        
        if (sharesToSell > 0) {
          const qldSale = sellShares(sharesToSell, currentQldTradePrice, feeRate, 0);
          const spymPrice = getSpymTradePrice(row, "buy");
          const spymBuy = buyWithCash(qldSale.proceeds, spymPrice, feeRate, 0);
          
          qldShares -= sharesToSell;
          spymShares += spymBuy.shares;
          // All allocated cash from sale went to spymBuy, so no cash addition needed
          
          events.push({
             date: row.date,
             type: "profit-take-to-spym",
             threshold: nextStep.threshold,
             sellFraction: nextStep.sellFraction,
             soldQldShares: sharesToSell,
             boughtSpymShares: spymBuy.shares
          });
        }
        
        activeCycle.nextProfitTakeIndex += 1;
      }
    }
    
    const totalValue = getTotalValue(cash, qldShares, spymShares, row);
    
    if (qldShares > 0) {
      marketExposureDays += 1;
    } else {
      cashDays += 1;
    }
    
    dailyValues.push({
      date: row.date,
      value: totalValue,
      nav: totalValue / initialCapital,
    });
  }
  
  const endingValue = dailyValues[dailyValues.length - 1].value;
  const endingNav = dailyValues[dailyValues.length - 1].nav;
  
  const metrics = {
    endingValue,
    totalReturn: endingNav - 1,
    cagr: calculateCagr(1, endingNav, dailyValues[0].date, dailyValues[dailyValues.length - 1].date),
    maxDrawdown: calculateMaxDrawdown(dailyValues.map(item => item.nav)),
    tradeCount: trades.length,
    winRate: calculateWinRate(trades),
    avgHoldDays: average(trades.map(t => t.holdDays)),
    marketExposure: marketExposureDays / timeline.length,
    cashHoldingRatio: cashDays / timeline.length,
    netProfit: endingValue - initialCapital
  };
  
  return {
    meta: {
      strategyName: name,
      signalMode,
      startDate: dailyValues[0].date,
      endDate: dailyValues[dailyValues.length - 1].date,
      currency: "USD"
    },
    metrics,
    trades,
    events,
    dailyValues
  };
}
