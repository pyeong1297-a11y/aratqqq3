import {
  average,
  calculateCagr,
  calculateMaxDrawdown,
  calculateSMA,
  calculateWinRate
} from "./metrics.js";
import {
  buildSingleIsaContributionSchedule,
  mapContributionScheduleToTradeDates
} from "./dca-benchmark.js";
import { buyWithCash, positionValue, sellShares } from "./portfolio.js";
import {
  buyIntoTracker,
  computeUsAnnualTax,
  createAverageCostTracker,
  reduceTrackerByValue,
  sellFromTracker,
  US_FOREIGN_BASIC_DEDUCTION_KRW,
  US_FOREIGN_BASIC_DEDUCTION_USD
} from "./tax.js";
import {
  buildAlignedUsTimeline,
  buildAlignedUsTimelineWithParkingFallback
} from "./us-timeline.js";

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

function allocateExternalUnits(navUnits, preNav, externalEndValueToday, totalValue) {
  if (externalEndValueToday <= 0) {
    return navUnits;
  }

  if (navUnits === 0) {
    return totalValue > 0 ? totalValue : externalEndValueToday;
  }

  if (preNav > 0) {
    return navUnits + externalEndValueToday / preNav;
  }

  return navUnits;
}

function buildContributionBuckets(timeline, contributionPlan, initialCapital) {
  const effectiveContributionPlan = {
    initialContribution: contributionPlan?.initialContribution ?? initialCapital,
    legacyMonthlyContribution: contributionPlan?.legacyMonthlyContribution ?? 0
  };
  const contributionSchedule = mapContributionScheduleToTradeDates(
    buildSingleIsaContributionSchedule(
      timeline.map((row) => row.date),
      effectiveContributionPlan
    ),
    timeline.map((row) => row.date)
  );
  const contributionsByDate = new Map();

  for (const item of contributionSchedule) {
    const bucket = contributionsByDate.get(item.tradeDate) || [];
    bucket.push(item);
    contributionsByDate.set(item.tradeDate, bucket);
  }

  return contributionsByDate;
}

function getTotalValue(state, prices) {
  return (
    positionValue(state.riskShares, prices.riskPrice) +
    positionValue(state.spymShares, prices.spymPrice) +
    positionValue(state.sgovShares, prices.sgovPrice)
  );
}

function resolveUsPrices(row, valuationCurrency) {
  const fxRate = valuationCurrency === "USD" ? 1 : row.fx.adjClose;
  return {
    riskPrice: row.risk.adjClose * fxRate,
    spymPrice: row.spym.adjClose * fxRate,
    sgovPrice: row.sgov.adjClose * fxRate
  };
}

function normalizeProfitTakeParking(profitTakeParking) {
  const raw = profitTakeParking || { spym: 0, sgov: 1 };
  const weights = {
    spym: Number.isFinite(raw.spym) ? Math.max(0, raw.spym) : 0,
    sgov: Number.isFinite(raw.sgov) ? Math.max(0, raw.sgov) : 0
  };
  const total = weights.spym + weights.sgov;

  if (total <= 0) {
    return { spym: 0, sgov: 1 };
  }

  return {
    spym: weights.spym / total,
    sgov: weights.sgov / total
  };
}

function buildMetrics({
  dailyValues,
  trades,
  initialCapital,
  principalContributed,
  contributionCount,
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
  const endingNav =
    dailyValues[dailyValues.length - 1].nav ??
    (initialCapital > 0 ? endingValue / initialCapital : 0);
  const totalReturn = endingNav - 1;
  const cagr = calculateCagr(
    1,
    endingNav,
    dailyValues[0].date,
    dailyValues[dailyValues.length - 1].date
  );
  const maxDrawdown = calculateMaxDrawdown(
    dailyValues.map((item) => item.nav ?? (initialCapital > 0 ? item.value / initialCapital : 0))
  );
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
    endingRiskValue: positionValue(riskShares, finalRiskPrice) + spymValue,
    principalContributed,
    netProfit: endingValue - principalContributed,
    contributionCount
  };
}

export function runUsStrategy({
  name,
  riskBars,
  spymBars,
  sgovBars,
  parkingFallbackBars = null,
  fxBars,
  initialCapital,
  contributionPlan,
  confirmationDays,
  feeRate,
  slippageRate,
  profitTakeSteps,
  profitTakeParking,
  valuationCurrency = "KRW",
  taxMode
}) {
  const timeline = parkingFallbackBars
    ? buildAlignedUsTimelineWithParkingFallback(
        {
          riskBars,
          spymBars,
          parkingBars: sgovBars,
          parkingFallbackBars
        },
        fxBars
      )
    : buildAlignedUsTimeline(
        {
          risk: riskBars,
          spym: spymBars,
          sgov: sgovBars
        },
        fxBars
      );

  if (timeline.length < 200) {
    throw new Error(`${name}: common timeline is shorter than 200 trading days.`);
  }

  const riskCloses = timeline.map((row) => row.risk.adjClose);
  const sma200 = calculateSMA(riskCloses, 200);
  const contributionsByDate = buildContributionBuckets(timeline, contributionPlan, initialCapital);
  const profitTakeParkingWeights = normalizeProfitTakeParking(profitTakeParking);

  const state = {
    riskShares: 0,
    spymShares: 0,
    sgovShares: 0,
    riskTracker: createAverageCostTracker(),
    spymTracker: createAverageCostTracker(),
    sgovTracker: createAverageCostTracker()
  };

  let activeCycle = null;
  let aboveCount = 0;
  let profitTakeCount = 0;
  let principalContributed = 0;
  let contributionCount = 0;
  let exposureDays = 0;
  let sgovDays = 0;
  let annualTaxPaid = 0;
  let navUnits = 0;
  let currentTaxYear = yearOf(timeline[0].date);
  const usTaxBasicDeduction =
    valuationCurrency === "USD"
      ? US_FOREIGN_BASIC_DEDUCTION_USD
      : US_FOREIGN_BASIC_DEDUCTION_KRW;

  const realizedByYear = new Map();
  const dailyValues = [];
  const trades = [];
  const events = [];

  for (let index = 0; index < timeline.length; index += 1) {
    const row = timeline[index];
    const year = yearOf(row.date);
    const prices = resolveUsPrices(row, valuationCurrency);

    if (taxMode === "taxed" && year !== currentTaxYear) {
      const taxDue = computeUsAnnualTax(
        realizedByYear.get(currentTaxYear) || 0,
        usTaxBasicDeduction
      );
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

    const sma = sma200[index];
    const cycleActive = activeCycle !== null;
    const hasRiskExposure = state.riskShares > 0 || state.spymShares > 0;
    const above = sma !== null && row.risk.adjClose > sma;
    const below = sma !== null && row.risk.adjClose < sma;

    aboveCount = above ? aboveCount + 1 : 0;

    if (cycleActive && below) {
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

      if (cash > 0) {
        const parking = buyWithCash(cash, prices.sgovPrice, feeRate, slippageRate);
        state.sgovShares += parking.shares;
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
      }

      const cycleEndValue = getTotalValue(state, prices);
      trades.push({
        entryDate: activeCycle.entryDate,
        exitDate: row.date,
        holdDays: index - activeCycle.entryIndex,
        pnl: cycleEndValue - (activeCycle.startValue + activeCycle.contributed),
        returnPct:
          activeCycle.startValue + activeCycle.contributed > 0
            ? cycleEndValue / (activeCycle.startValue + activeCycle.contributed) - 1
            : 0
      });
      activeCycle = null;
    } else if (hasRiskExposure && activeCycle) {
      for (let stepIndex = 0; stepIndex < profitTakeSteps.length; stepIndex += 1) {
        const step = profitTakeSteps[stepIndex];
        if (activeCycle.profitFlags[stepIndex]) {
          continue;
        }

        if (row.risk.adjClose < activeCycle.entryPriceUsd * (1 + step.threshold)) {
          continue;
        }

        const qty = state.riskShares * step.sellFraction;
        if (qty <= 0) {
          activeCycle.profitFlags[stepIndex] = true;
          continue;
        }

        const sale = sellShares(qty, prices.riskPrice, feeRate, slippageRate);
        const basis = sellFromTracker(state.riskTracker, qty, sale.proceeds);
        addRealizedGain(realizedByYear, row.date, basis.realizedGain);
        state.riskShares -= qty;

        let spymFill = null;
        let sgovFill = null;

        const spymCash = sale.proceeds * profitTakeParkingWeights.spym;
        if (spymCash > 0) {
          const buy = buyWithCash(spymCash, prices.spymPrice, feeRate, slippageRate);
          state.spymShares += buy.shares;
          buyIntoTracker(
            state.spymTracker,
            buy.shares,
            totalBuyCost(buy.shares, buy.fillPrice, feeRate)
          );
          spymFill = buy.fillPrice;
        }

        const sgovCash = sale.proceeds * profitTakeParkingWeights.sgov;
        if (sgovCash > 0) {
          const buy = buyWithCash(sgovCash, prices.sgovPrice, feeRate, slippageRate);
          state.sgovShares += buy.shares;
          buyIntoTracker(
            state.sgovTracker,
            buy.shares,
            totalBuyCost(buy.shares, buy.fillPrice, feeRate)
          );
          sgovFill = buy.fillPrice;
        }

        activeCycle.profitFlags[stepIndex] = true;
        profitTakeCount += 1;
        events.push({
          date: row.date,
          type: "profit-take",
          threshold: step.threshold,
          soldShares: qty,
          riskFill: sale.fillPrice,
          spymFill,
          sgovFill,
          parkingWeights: profitTakeParkingWeights
        });
      }
    } else if (!cycleActive && sma !== null && aboveCount >= confirmationDays) {
      if (state.sgovShares > 0) {
        const sgovSale = sellShares(state.sgovShares, prices.sgovPrice, feeRate, slippageRate);
        if (sgovSale.proceeds > 0) {
          const riskBuy = buyWithCash(sgovSale.proceeds, prices.riskPrice, feeRate, slippageRate);
          if (riskBuy.shares > 0) {
            const basis = sellFromTracker(state.sgovTracker, state.sgovShares, sgovSale.proceeds);
            addRealizedGain(realizedByYear, row.date, basis.realizedGain);
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
              entryIndex: index,
              entryPriceUsd: row.risk.adjClose * (1 + slippageRate),
              startValue: positionValue(state.riskShares, prices.riskPrice),
              contributed: 0,
              profitFlags: profitTakeSteps.map(() => false)
            };
            events.push({
              date: row.date,
              type: "entry-risk",
              price: riskBuy.fillPrice,
              shares: riskBuy.shares
            });
          }
        }
      }
    }

    const preValue = getTotalValue(state, prices);
    const preNav = navUnits > 0 ? preValue / navUnits : 1;
    let externalEndValueToday = 0;
    const pending = contributionsByDate.get(row.date) || [];

    for (const item of pending) {
      principalContributed += item.amount;
      contributionCount += 1;

      if (activeCycle) {
        const buy = buyWithCash(item.amount, prices.spymPrice, feeRate, slippageRate);
        state.spymShares += buy.shares;
        buyIntoTracker(
          state.spymTracker,
          buy.shares,
          totalBuyCost(buy.shares, buy.fillPrice, feeRate)
        );
        externalEndValueToday += positionValue(buy.shares, prices.spymPrice);

        if (activeCycle) {
          activeCycle.contributed += item.amount;
        }

        events.push({
          date: row.date,
          type: "contribution-spym",
          amount: item.amount,
          price: buy.fillPrice,
          sourceDate: item.sourceDate
        });
      } else {
        const buy = buyWithCash(item.amount, prices.sgovPrice, feeRate, slippageRate);
        state.sgovShares += buy.shares;
        buyIntoTracker(
          state.sgovTracker,
          buy.shares,
          totalBuyCost(buy.shares, buy.fillPrice, feeRate)
        );
        externalEndValueToday += positionValue(buy.shares, prices.sgovPrice);

        events.push({
          date: row.date,
          type: "contribution-sgov",
          amount: item.amount,
          price: buy.fillPrice,
          sourceDate: item.sourceDate
        });
      }
    }

    const value = getTotalValue(state, prices);
    navUnits = allocateExternalUnits(navUnits, preNav, externalEndValueToday, value);
    const nav = navUnits > 0 ? value / navUnits : 1;

    if (state.riskShares > 0 || state.spymShares > 0) {
      exposureDays += 1;
    }
    if (state.sgovShares > 0) {
      sgovDays += 1;
    }

    dailyValues.push({ date: row.date, value, nav, principalContributed });
  }

  if (taxMode === "taxed" && dailyValues.length > 0) {
    const lastRow = timeline[timeline.length - 1];
    const finalPrices = resolveUsPrices(lastRow, valuationCurrency);
    const finalTax = computeUsAnnualTax(
      realizedByYear.get(currentTaxYear) || 0,
      usTaxBasicDeduction
    );
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
      dailyValues[dailyValues.length - 1].nav =
        navUnits > 0 ? dailyValues[dailyValues.length - 1].value / navUnits : 1;
    }
  }

  const lastRow = timeline[timeline.length - 1];
  const finalPrices = resolveUsPrices(lastRow, valuationCurrency);

  const metrics = buildMetrics({
    dailyValues,
    trades,
    initialCapital,
    principalContributed,
    contributionCount,
    profitTakeCount,
    exposureDays,
    sgovDays,
    riskShares: state.riskShares,
    spymShares: state.spymShares,
    finalRiskPrice: finalPrices.riskPrice,
    finalSpymPrice: finalPrices.spymPrice,
    annualTaxPaid
  });

  return {
    meta: {
      strategyName: name,
      scenarioLabel: `slippage ${(slippageRate * 100).toFixed(2)}%`,
      startDate: timeline[0].date,
      endDate: timeline[timeline.length - 1].date,
      currency: valuationCurrency,
      feeRate,
      slippageRate,
      taxMode,
      profitTakeParking: profitTakeParkingWeights
    },
    metrics,
    trades,
    events,
    dailyValues
  };
}
