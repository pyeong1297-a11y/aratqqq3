import {
  average,
  calculateCagr,
  calculateMaxDrawdown,
  calculateSMA,
  calculateWinRate,
  intersectBars
} from "./metrics.js";
import { buyWithCash, positionValue, sellShares } from "./portfolio.js";
import {
  buyIntoTracker,
  computeUsAnnualTax,
  createAverageCostTracker,
  reduceTrackerByValue,
  sellFromTracker
} from "./tax.js";

function yearOf(date) {
  return Number(String(date).slice(0, 4));
}

function totalBuyCost(shares, fillPrice, feeRate) {
  return shares * fillPrice * (1 + feeRate);
}

function addRealizedGain(realizedByYear, date, gain) {
  const year = yearOf(date);
  realizedByYear.set(year, (realizedByYear.get(year) || 0) + gain);
}

function deductTaxFromPortfolio(state, amount, prices) {
  let remaining = amount;

  const drain = (assetKey, tracker, price) => {
    if (remaining <= 0) {
      return;
    }

    const shares = state[assetKey];
    if (shares <= 0 || price <= 0) {
      return;
    }

    const assetValue = shares * price;
    const removedValue = Math.min(assetValue, remaining);
    const removedShares = removedValue / price;

    state[assetKey] -= removedShares;
    reduceTrackerByValue(tracker, removedShares);
    remaining -= removedValue;
  };

  drain("sgovShares", state.sgovTracker, prices.sgovPrice);
  drain("spymShares", state.spymTracker, prices.spymPrice);
  drain("riskShares", state.riskTracker, prices.riskPrice);

  return amount - remaining;
}

function buildMetrics({
  dailyValues,
  trades,
  initialCapital,
  profitTakeCount,
  exposureDays,
  sgovDays,
  riskShares,
  spymShares,
  finalRiskPrice,
  finalSpymPrice,
  annualTaxPaid
}) {
  const endingValue = dailyValues[dailyValues.length - 1].value;
  const totalReturn = endingValue / initialCapital - 1;
  const cagr = calculateCagr(
    initialCapital,
    endingValue,
    dailyValues[0].date,
    dailyValues[dailyValues.length - 1].date
  );
  const maxDrawdown = calculateMaxDrawdown(dailyValues.map((item) => item.value));
  const avgHoldDays = average(trades.map((trade) => trade.holdDays));
  const exposureRatio = exposureDays / dailyValues.length;
  const sgovHoldingRatio = sgovDays / dailyValues.length;
  const spymValue = positionValue(spymShares, finalSpymPrice);
  const spymFinalWeight = endingValue === 0 ? 0 : spymValue / endingValue;

  return {
    endingValue,
    totalReturn,
    cagr,
    maxDrawdown,
    tradeCount: trades.length,
    winRate: calculateWinRate(trades),
    avgHoldDays,
    marketExposure: exposureRatio,
    profitTakeCount,
    spymFinalWeight,
    sgovHoldingRatio,
    annualTaxPaid,
    endingRiskValue: positionValue(riskShares, finalRiskPrice) + spymValue
  };
}

export function runUsStrategy({
  name,
  riskBars,
  spymBars,
  sgovBars,
  fxBars,
  initialCapital,
  confirmationDays,
  feeRate,
  slippageRate,
  profitTakeSteps,
  taxMode
}) {
  const timeline = intersectBars({
    risk: riskBars,
    spym: spymBars,
    sgov: sgovBars,
    fx: fxBars
  });

  if (timeline.length < 200) {
    throw new Error(`${name}: 공통 데이터가 200거래일보다 짧습니다.`);
  }

  const riskCloses = timeline.map((row) => row.risk.adjClose);
  const sma200 = calculateSMA(riskCloses, 200);

  const firstFx = timeline[0].fx.adjClose;
  const firstSgovPrice = timeline[0].sgov.adjClose * firstFx;
  const state = {
    riskShares: 0,
    spymShares: 0,
    sgovShares: initialCapital / firstSgovPrice,
    riskTracker: createAverageCostTracker(),
    spymTracker: createAverageCostTracker(),
    sgovTracker: createAverageCostTracker(initialCapital / firstSgovPrice, initialCapital)
  };

  let activeCycle = null;
  let aboveCount = 0;
  let profitTakeCount = 0;
  let exposureDays = 0;
  let sgovDays = 0;
  let annualTaxPaid = 0;
  let currentTaxYear = yearOf(timeline[0].date);

  const realizedByYear = new Map();
  const dailyValues = [];
  const trades = [];
  const events = [];

  for (let i = 0; i < timeline.length; i += 1) {
    const row = timeline[i];
    const year = yearOf(row.date);
    const fxRate = row.fx.adjClose;
    const prices = {
      riskPrice: row.risk.adjClose * fxRate,
      spymPrice: row.spym.adjClose * fxRate,
      sgovPrice: row.sgov.adjClose * fxRate
    };

    if (taxMode === "taxed" && year !== currentTaxYear) {
      const taxDue = computeUsAnnualTax(realizedByYear.get(currentTaxYear) || 0);
      if (taxDue > 0) {
        const deducted = deductTaxFromPortfolio(state, taxDue, prices);
        annualTaxPaid += deducted;
        events.push({
          date: row.date,
          type: "annual-tax",
          taxYear: currentTaxYear,
          amount: deducted
        });
      }
      currentTaxYear = year;
    }

    const sma = sma200[i];
    const isInvested = state.riskShares > 0 || state.spymShares > 0;
    const above = sma !== null && row.risk.adjClose > sma;
    const below = sma !== null && row.risk.adjClose < sma;

    aboveCount = above ? aboveCount + 1 : 0;

    if (isInvested && below) {
      let cash = 0;

      if (state.riskShares > 0) {
        const sharesToSell = state.riskShares;
        const sale = sellShares(sharesToSell, prices.riskPrice, feeRate, slippageRate);
        const basis = sellFromTracker(state.riskTracker, sharesToSell, sale.proceeds);
        addRealizedGain(realizedByYear, row.date, basis.realizedGain);
        cash += sale.proceeds;
        state.riskShares = 0;

        events.push({
          date: row.date,
          type: "exit-risk",
          price: sale.fillPrice,
          proceeds: sale.proceeds
        });
      }

      if (state.spymShares > 0) {
        const sharesToSell = state.spymShares;
        const sale = sellShares(sharesToSell, prices.spymPrice, feeRate, slippageRate);
        const basis = sellFromTracker(state.spymTracker, sharesToSell, sale.proceeds);
        addRealizedGain(realizedByYear, row.date, basis.realizedGain);
        cash += sale.proceeds;
        state.spymShares = 0;

        events.push({
          date: row.date,
          type: "exit-spym",
          price: sale.fillPrice,
          proceeds: sale.proceeds
        });
      }

      const parking = buyWithCash(cash, prices.sgovPrice, feeRate, slippageRate);
      state.sgovShares = parking.shares;
      buyIntoTracker(
        state.sgovTracker,
        parking.shares,
        totalBuyCost(parking.shares, parking.fillPrice, feeRate)
      );

      events.push({
        date: row.date,
        type: "enter-sgov",
        price: parking.fillPrice,
        shares: parking.shares
      });

      if (activeCycle) {
        const cycleEndValue = positionValue(state.sgovShares, prices.sgovPrice);
        trades.push({
          entryDate: activeCycle.entryDate,
          exitDate: row.date,
          holdDays: i - activeCycle.entryIndex,
          pnl: cycleEndValue - activeCycle.startValue,
          returnPct: cycleEndValue / activeCycle.startValue - 1
        });
      }

      activeCycle = null;
    } else if (isInvested && activeCycle) {
      for (let stepIndex = 0; stepIndex < profitTakeSteps.length; stepIndex += 1) {
        const step = profitTakeSteps[stepIndex];
        if (activeCycle.profitFlags[stepIndex]) {
          continue;
        }

        if (row.risk.adjClose >= activeCycle.entryPriceUsd * (1 + step.threshold)) {
          const qty = state.riskShares * step.sellFraction;
          if (qty <= 0) {
            activeCycle.profitFlags[stepIndex] = true;
            continue;
          }

          const sale = sellShares(qty, prices.riskPrice, feeRate, slippageRate);
          const basis = sellFromTracker(state.riskTracker, qty, sale.proceeds);
          addRealizedGain(realizedByYear, row.date, basis.realizedGain);
          state.riskShares -= qty;

          const buy = buyWithCash(sale.proceeds, prices.spymPrice, feeRate, slippageRate);
          state.spymShares += buy.shares;
          buyIntoTracker(
            state.spymTracker,
            buy.shares,
            totalBuyCost(buy.shares, buy.fillPrice, feeRate)
          );

          activeCycle.profitFlags[stepIndex] = true;
          profitTakeCount += 1;

          events.push({
            date: row.date,
            type: "profit-take",
            threshold: step.threshold,
            soldShares: qty,
            riskFill: sale.fillPrice,
            spymFill: buy.fillPrice
          });
        }
      }
    } else if (!isInvested && sma !== null && aboveCount >= confirmationDays) {
      const sgovSale = sellShares(state.sgovShares, prices.sgovPrice, feeRate, slippageRate);
      const basis = sellFromTracker(state.sgovTracker, state.sgovShares, sgovSale.proceeds);
      addRealizedGain(realizedByYear, row.date, basis.realizedGain);

      const riskBuy = buyWithCash(sgovSale.proceeds, prices.riskPrice, feeRate, slippageRate);
      state.sgovShares = 0;
      state.riskShares = riskBuy.shares;
      state.spymShares = 0;

      buyIntoTracker(
        state.riskTracker,
        riskBuy.shares,
        totalBuyCost(riskBuy.shares, riskBuy.fillPrice, feeRate)
      );

      activeCycle = {
        entryDate: row.date,
        entryIndex: i,
        entryPriceUsd: row.risk.adjClose * (1 + slippageRate),
        startValue: positionValue(state.riskShares, prices.riskPrice),
        profitFlags: profitTakeSteps.map(() => false)
      };

      events.push({
        date: row.date,
        type: "entry-risk",
        price: riskBuy.fillPrice,
        shares: riskBuy.shares
      });
    }

    const value =
      positionValue(state.riskShares, prices.riskPrice) +
      positionValue(state.spymShares, prices.spymPrice) +
      positionValue(state.sgovShares, prices.sgovPrice);

    if (state.riskShares > 0 || state.spymShares > 0) {
      exposureDays += 1;
    }
    if (state.sgovShares > 0) {
      sgovDays += 1;
    }

    dailyValues.push({ date: row.date, value });
  }

  if (taxMode === "taxed" && dailyValues.length > 0) {
    const lastRow = timeline[timeline.length - 1];
    const finalPrices = {
      riskPrice: lastRow.risk.adjClose * lastRow.fx.adjClose,
      spymPrice: lastRow.spym.adjClose * lastRow.fx.adjClose,
      sgovPrice: lastRow.sgov.adjClose * lastRow.fx.adjClose
    };
    const finalTax = computeUsAnnualTax(realizedByYear.get(currentTaxYear) || 0);
    if (finalTax > 0) {
      const deducted = deductTaxFromPortfolio(state, finalTax, finalPrices);
      annualTaxPaid += deducted;
      events.push({
        date: lastRow.date,
        type: "final-tax-liability",
        taxYear: currentTaxYear,
        amount: deducted
      });
      dailyValues[dailyValues.length - 1].value -= deducted;
    }
  }

  const lastRow = timeline[timeline.length - 1];
  const finalRiskPrice = lastRow.risk.adjClose * lastRow.fx.adjClose;
  const finalSpymPrice = lastRow.spym.adjClose * lastRow.fx.adjClose;

  const metrics = buildMetrics({
    dailyValues,
    trades,
    initialCapital,
    profitTakeCount,
    exposureDays,
    sgovDays,
    riskShares: state.riskShares,
    spymShares: state.spymShares,
    finalRiskPrice,
    finalSpymPrice,
    annualTaxPaid
  });

  return {
    meta: {
      strategyName: name,
      scenarioLabel: `슬리피지 ${(slippageRate * 100).toFixed(2)}%`,
      startDate: timeline[0].date,
      endDate: timeline[timeline.length - 1].date,
      feeRate,
      slippageRate,
      taxMode
    },
    metrics,
    trades,
    events,
    dailyValues
  };
}
