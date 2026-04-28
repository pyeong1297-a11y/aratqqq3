import {
  average,
  calculateCagr,
  calculateMaxDrawdown,
  calculateSMA,
  calculateWinRate,
  intersectBars
} from "./metrics.js";
import {
  buildSingleIsaContributionSchedule,
  mapContributionScheduleToTradeDates
} from "./dca-benchmark.js";
import {
  buyIntoTracker,
  computeUsAnnualTax,
  createAverageCostTracker,
  reduceTrackerByValue,
  sellFromTracker,
  US_FOREIGN_BASIC_DEDUCTION_KRW,
  US_FOREIGN_BASIC_DEDUCTION_USD
} from "./tax.js";

function yearOf(date) {
  return Number(String(date).slice(0, 4));
}

function positionValue(shares, price) {
  return shares * price;
}

function totalBuyCost(shares, fillPrice, feeRate) {
  return shares * fillPrice * (1 + feeRate);
}

function addRealizedGain(realizedByYear, date, gain) {
  const year = yearOf(date);
  realizedByYear.set(year, (realizedByYear.get(year) || 0) + gain);
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

function calculateRollingMax(values, period) {
  const result = new Array(values.length).fill(null);

  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - period + 1);
    let maxValue = -Infinity;

    for (let cursor = start; cursor <= index; cursor += 1) {
      if (values[cursor] > maxValue) {
        maxValue = values[cursor];
      }
    }

    result[index] = maxValue;
  }

  return result;
}

function calculateRSI(values, period) {
  const rsi = new Array(values.length).fill(null);
  if (values.length <= period) {
    return rsi;
  }

  let gainSum = 0;
  let lossSum = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum += Math.abs(change);
    }
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  rsi[period] =
    averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / Math.max(averageLoss, 1e-12));

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    rsi[index] =
      averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / Math.max(averageLoss, 1e-12));
  }

  return rsi;
}

function hasCloseAboveSmaConfirmation(closes, sma, index, confirmationDays) {
  if (!Number.isInteger(confirmationDays) || confirmationDays < 1) {
    return false;
  }

  const start = index - confirmationDays + 1;
  if (start < 0) {
    return false;
  }

  for (let cursor = start; cursor <= index; cursor += 1) {
    if (sma[cursor] === null || closes[cursor] <= sma[cursor]) {
      return false;
    }
  }

  return true;
}

function resolveTrendEntrySignal({
  entryMode,
  index,
  smaShort,
  smaLong,
  closes,
  trendSma,
  confirmationDays
}) {
  if (entryMode === "sma-cross") {
    const hasGcData =
      index > 0 &&
      smaShort[index - 1] !== null &&
      smaLong[index - 1] !== null &&
      smaShort[index] !== null &&
      smaLong[index] !== null;

    return (
      hasGcData &&
      smaShort[index - 1] <= smaLong[index - 1] &&
      smaShort[index] > smaLong[index]
    );
  }

  if (entryMode === "close-above-sma-confirmed") {
    return hasCloseAboveSmaConfirmation(closes, trendSma, index, confirmationDays);
  }

  throw new Error(`Unsupported trend entry mode: ${entryMode}`);
}

function resolveTrendExitSignal({ exitMode, index, smaShort, smaLong, closes, trendSma }) {
  if (exitMode === "sma-cross") {
    const hasDcData =
      index > 0 &&
      smaShort[index - 1] !== null &&
      smaLong[index - 1] !== null &&
      smaShort[index] !== null &&
      smaLong[index] !== null;

    return (
      hasDcData &&
      smaShort[index - 1] >= smaLong[index - 1] &&
      smaShort[index] < smaLong[index]
    );
  }

  if (exitMode === "close-below-sma") {
    return trendSma[index] !== null && closes[index] < trendSma[index];
  }

  throw new Error(`Unsupported trend exit mode: ${exitMode}`);
}

function calculateSharpeRatio(dailyValues) {
  if (dailyValues.length < 2) {
    return 0;
  }

  const returns = [];

  for (let index = 1; index < dailyValues.length; index += 1) {
    const previous = dailyValues[index - 1].nav;
    const current = dailyValues[index].nav;

    if (previous > 0 && current > 0) {
      returns.push(current / previous - 1);
    }
  }

  if (returns.length === 0) {
    return 0;
  }

  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  const deviation = Math.sqrt(variance);

  if (deviation <= 0) {
    return 0;
  }

  return (mean / deviation) * Math.sqrt(252);
}

function calculateSortinoRatio(dailyValues) {
  if (dailyValues.length < 2) {
    return 0;
  }

  const returns = [];

  for (let index = 1; index < dailyValues.length; index += 1) {
    const previous = dailyValues[index - 1].nav;
    const current = dailyValues[index].nav;

    if (previous > 0 && current > 0) {
      returns.push(current / previous - 1);
    }
  }

  if (returns.length === 0) {
    return 0;
  }

  const mean = average(returns);
  const downside = returns.filter((value) => value < 0).map((value) => value ** 2);
  const downsideDeviation = Math.sqrt(average(downside));

  if (downsideDeviation <= 0) {
    return 0;
  }

  return (mean / downsideDeviation) * Math.sqrt(252);
}

function buildBuyFill(cashBudget, price, feeRate, slippagePerShare) {
  const fillPrice = price + slippagePerShare;
  const costPerShare = fillPrice * (1 + feeRate);

  if (cashBudget <= 0 || costPerShare <= 0) {
    return { shares: 0, fillPrice, totalCost: 0, feePaid: 0 };
  }

  const shares = cashBudget / costPerShare;
  const gross = shares * fillPrice;
  const feePaid = gross * feeRate;

  return {
    shares,
    fillPrice,
    totalCost: gross + feePaid,
    feePaid
  };
}

function buildSellFill(shares, price, feeRate, slippagePerShare) {
  const fillPrice = Math.max(0, price - slippagePerShare);
  const gross = shares * fillPrice;
  const feePaid = gross * feeRate;

  return {
    fillPrice,
    gross,
    feePaid,
    proceeds: gross - feePaid
  };
}

function buildSignalMap(qqqBars, startDate, lookbackDays) {
  const closes = qqqBars.map((bar) => bar.adjClose);
  const highs = qqqBars.map((bar) => bar.adjHigh);
  const rollingHigh = calculateRollingMax(highs, lookbackDays);
  const map = new Map();

  for (let index = 0; index < qqqBars.length; index += 1) {
    if (qqqBars[index].date >= startDate) {
      map.set(qqqBars[index].date, {
        qqqClose: closes[index],
        qqqHigh: highs[index],
        qqqRollingHigh: rollingHigh[index]
      });
    }
  }

  return map;
}

function findLatestIndexOnOrBefore(sortedDates, targetDate) {
  let lo = 0;
  let hi = sortedDates.length - 1;
  let answer = -1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sortedDates[mid] <= targetDate) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return answer;
}

function resolveLatestBarOnOrBefore(bars, sortedDates, targetDate) {
  if (!bars || bars.length === 0) {
    return null;
  }

  const index = findLatestIndexOnOrBefore(sortedDates, targetDate);
  return index < 0 ? null : bars[index];
}

function buildSnowballTimeline({
  qqqBars,
  riskBars,
  parkingBars,
  parkingFallbackBars,
  startDate
}) {
  const baseTimeline = intersectBars({
    qqq: qqqBars,
    risk: riskBars
  }).filter((row) => row.date >= startDate);

  if (!parkingBars && !parkingFallbackBars) {
    return baseTimeline;
  }

  const parkingDates = (parkingBars || []).map((bar) => bar.date);
  const parkingFallbackDates = (parkingFallbackBars || []).map((bar) => bar.date);

  return baseTimeline.flatMap((row) => {
    const parkingBar = resolveLatestBarOnOrBefore(parkingBars, parkingDates, row.date);
    const fallbackBar = resolveLatestBarOnOrBefore(
      parkingFallbackBars,
      parkingFallbackDates,
      row.date
    );
    const resolvedParkingBar = parkingBar || fallbackBar;

    if (!resolvedParkingBar) {
      return [];
    }

    return [
      {
        ...row,
        sgov: resolvedParkingBar
      }
    ];
  });
}

function getParkingValue(state, parkingPrice = 0) {
  return state.cash + positionValue(state.sgovShares || 0, parkingPrice);
}

function getTotalPortfolioValue(state, riskPrice, parkingPrice = 0) {
  return getParkingValue(state, parkingPrice) + positionValue(state.riskShares, riskPrice);
}

function parkCashInSgov(state, parkingPrice, feeRate, slippagePerShare) {
  if (state.cash <= 0 || parkingPrice <= 0) {
    return null;
  }

  const fill = buildBuyFill(state.cash, parkingPrice, feeRate, slippagePerShare);
  if (fill.shares <= 0 || fill.totalCost <= 0) {
    return null;
  }

  state.cash -= fill.totalCost;
  if (state.cash < 1e-9) {
    state.cash = 0;
  }
  state.sgovShares += fill.shares;
  buyIntoTracker(state.sgovTracker, fill.shares, totalBuyCost(fill.shares, fill.fillPrice, feeRate));

  return fill;
}

function raiseCashFromSgov(
  state,
  date,
  amountNeeded,
  parkingPrice,
  feeRate,
  slippagePerShare,
  realizedByYear
) {
  if (amountNeeded <= state.cash || state.sgovShares <= 0 || parkingPrice <= 0) {
    return null;
  }

  const unitSale = buildSellFill(1, parkingPrice, feeRate, slippagePerShare);
  if (unitSale.proceeds <= 0) {
    return null;
  }

  const sharesToSell = Math.min(state.sgovShares, (amountNeeded - state.cash) / unitSale.proceeds);
  if (sharesToSell <= 0) {
    return null;
  }

  const sale = buildSellFill(sharesToSell, parkingPrice, feeRate, slippagePerShare);
  const basis = sellFromTracker(state.sgovTracker, sharesToSell, sale.proceeds);
  addRealizedGain(realizedByYear, date, basis.realizedGain);
  state.sgovShares -= sharesToSell;
  if (state.sgovShares < 1e-12) {
    state.sgovShares = 0;
  }
  state.cash += sale.proceeds;

  return sale;
}

function deductTaxFromState(state, amount, riskPrice, parkingPrice = 0) {
  let remaining = amount;

  if (remaining <= 0) {
    return 0;
  }

  const cashUsed = Math.min(state.cash, remaining);
  state.cash -= cashUsed;
  remaining -= cashUsed;

  if (remaining > 0 && state.sgovShares > 0 && parkingPrice > 0) {
    const assetValue = state.sgovShares * parkingPrice;
    const removedValue = Math.min(assetValue, remaining);
    const removedShares = removedValue / parkingPrice;
    state.sgovShares -= removedShares;
    reduceTrackerByValue(state.sgovTracker, removedShares);
    remaining -= removedValue;
  }

  if (remaining > 0 && state.riskShares > 0 && riskPrice > 0) {
    const assetValue = state.riskShares * riskPrice;
    const removedValue = Math.min(assetValue, remaining);
    const removedShares = removedValue / riskPrice;
    state.riskShares -= removedShares;
    reduceTrackerByValue(state.riskTracker, removedShares);
    remaining -= removedValue;
  }

  if (state.sgovShares < 1e-12) {
    state.sgovShares = 0;
  }
  if (state.riskShares < 1e-12) {
    state.riskShares = 0;
  }
  if (state.cash < 1e-9) {
    state.cash = 0;
  }

  return amount - remaining;
}

function resetTpState(state) {
  state.tp1Done = false;
  state.tp2Done = false;
  state.tpBaseShares = state.riskShares;
}

function resetDipState(state) {
  state.dip1Consumed = false;
  state.dip2Consumed = false;
  state.bonusConsumed = false;
}

function openCycleIfNeeded(state, date, index, totalValue) {
  if (state.activeCycle || state.riskShares <= 0) {
    return;
  }

  state.activeCycle = {
    entryDate: date,
    entryIndex: index,
    startValue: totalValue
  };
}

function closeCycleIfNeeded(state, date, index, totalValue, reason) {
  if (!state.activeCycle) {
    return;
  }

  state.trades.push({
    entryDate: state.activeCycle.entryDate,
    exitDate: date,
    holdDays: index - state.activeCycle.entryIndex,
    pnl: totalValue - state.activeCycle.startValue,
    returnPct:
      state.activeCycle.startValue > 0 ? totalValue / state.activeCycle.startValue - 1 : 0,
    reason
  });
  state.activeCycle = null;
}

function executeBuy({
  state,
  date,
  index,
  price,
  amount,
  reason,
  feeRate,
  slippagePerShare,
  parkingPrice = 0,
  useSgovParking = false,
  realizedByYear = null
}) {
  if (useSgovParking && realizedByYear) {
    raiseCashFromSgov(
      state,
      date,
      amount,
      parkingPrice,
      feeRate,
      slippagePerShare,
      realizedByYear
    );
  }

  const fill = buildBuyFill(Math.min(state.cash, amount), price, feeRate, slippagePerShare);
  if (fill.shares <= 0 || fill.totalCost <= 0) {
    return null;
  }

  const totalValueBefore = getTotalPortfolioValue(state, price, parkingPrice);
  state.cash -= fill.totalCost;
  if (state.cash < 1e-9) {
    state.cash = 0;
  }
  state.riskShares += fill.shares;
  buyIntoTracker(state.riskTracker, fill.shares, totalBuyCost(fill.shares, fill.fillPrice, feeRate));
  openCycleIfNeeded(state, date, index, totalValueBefore);
  resetTpState(state);

  state.events.push({
    date,
    type: reason,
    shares: fill.shares,
    fillPrice: fill.fillPrice,
    totalCost: fill.totalCost
  });

  return fill;
}

function executeSell({
  state,
  date,
  index,
  price,
  sharesToSell,
  reason,
  feeRate,
  slippagePerShare,
  realizedByYear,
  parkingPrice = 0,
  useSgovParking = false
}) {
  const qty = Math.min(state.riskShares, sharesToSell);
  if (qty <= 0) {
    return null;
  }

  const fill = buildSellFill(qty, price, feeRate, slippagePerShare);
  const basis = sellFromTracker(state.riskTracker, qty, fill.proceeds);
  addRealizedGain(realizedByYear, date, basis.realizedGain);
  state.riskShares -= qty;
  if (state.riskShares < 1e-12) {
    state.riskShares = 0;
  }
  state.cash += fill.proceeds;
  if (useSgovParking) {
    parkCashInSgov(state, parkingPrice, feeRate, slippagePerShare);
  }

  state.events.push({
    date,
    type: reason,
    shares: qty,
    fillPrice: fill.fillPrice,
    proceeds: fill.proceeds,
    realizedGain: basis.realizedGain
  });

  if (state.riskShares <= 0) {
    closeCycleIfNeeded(state, date, index, getParkingValue(state, parkingPrice), reason);
    state.tpBaseShares = 0;
    state.tp1Done = false;
    state.tp2Done = false;
  }

  return fill;
}

function buildMetrics({
  dailyValues,
  trades,
  initialCapital,
  principalContributed,
  contributionCount,
  exposureDays,
  cashDays,
  sgovDays,
  annualTaxPaid,
  riskShares,
  finalRiskPrice,
  cash,
  eventCounts,
  activeCycle
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
  const cashHoldingRatio = cashDays / dailyValues.length;
  const sgovHoldingRatio = sgovDays / dailyValues.length;
  const endingRiskValue = positionValue(riskShares, finalRiskPrice);

  return {
    endingValue,
    totalReturn,
    cagr,
    maxDrawdown,
    calmarRatio: cagr && maxDrawdown < 0 ? cagr / Math.abs(maxDrawdown) : 0,
    sharpeRatio: calculateSharpeRatio(dailyValues),
    sortinoRatio: calculateSortinoRatio(dailyValues),
    tradeCount: trades.length,
    winRate: calculateWinRate(trades),
    avgHoldDays,
    marketExposure: exposureRatio,
    cashHoldingRatio,
    sgovHoldingRatio,
    annualTaxPaid,
    endingRiskValue,
    principalContributed,
    netProfit: endingValue - principalContributed,
    contributionCount,
    profitTakeCount: eventCounts.tp1 + eventCounts.tp2 + eventCounts.tp3,
    dipEntryCount: eventCounts.dip1 + eventCounts.dip2 + eventCounts.bonus,
    gcEntryCount: eventCounts.gc,
    dcExitCount: eventCounts.dc,
    cashWeight: endingValue === 0 ? 0 : cash / endingValue,
    openCycleReturn:
      activeCycle && activeCycle.startValue > 0 ? endingValue / activeCycle.startValue - 1 : null
  };
}

export function runSnowballStrategy({
  name,
  qqqBars,
  riskBars,
  sgovBars = null,
  parkingFallbackBars = null,
  initialCapital,
  contributionPlan,
  feeRate,
  annualCashYield,
  slippagePerShare,
  valuationCurrency = "USD",
  taxMode,
  settings
}) {
  const resolvedSettings = {
    resetDipOnNewHighSource: "close",
    allowTpAfterGoldCross: false,
    allowGoldCrossDuringCooldown: false,
    deferGoldCrossUntilCooldownEnds: false,
    prioritizeGoldCrossOverTpSameDay: false,
    useSgovParking: false,
    postGoldCrossTp2Threshold: null,
    postGoldCrossTp2SellFractionOfBase: 0,
    trendEntryMode: "sma-cross",
    trendExitMode: "sma-cross",
    trendSmaDays: null,
    trendEntryConfirmationDays: 1,
    tp1SellFractionOfBase: 0.5,
    tp2SellFractionOfBase: 0.35,
    ...settings
  };
  if (
    resolvedSettings.tp1SellFractionOfBase < 0 ||
    resolvedSettings.tp2SellFractionOfBase < 0 ||
    resolvedSettings.tp1SellFractionOfBase > 1 ||
    resolvedSettings.tp2SellFractionOfBase > 1
  ) {
    throw new Error(`${name}: TP sell fractions must stay within [0, 1].`);
  }
  if (
    resolvedSettings.tp1SellFractionOfBase + resolvedSettings.tp2SellFractionOfBase >
    1 + 1e-12
  ) {
    throw new Error(`${name}: TP1 + TP2 sell fractions cannot exceed 100% of base shares.`);
  }
  if (!Number.isInteger(resolvedSettings.trendEntryConfirmationDays)) {
    throw new Error(`${name}: trendEntryConfirmationDays must be an integer.`);
  }
  if (resolvedSettings.trendEntryConfirmationDays < 1) {
    throw new Error(`${name}: trendEntryConfirmationDays must be at least 1.`);
  }
  const timeline = buildSnowballTimeline({
    qqqBars,
    riskBars,
    parkingBars: resolvedSettings.useSgovParking ? sgovBars : null,
    parkingFallbackBars: resolvedSettings.useSgovParking ? parkingFallbackBars : null,
    startDate: resolvedSettings.startDate
  });

  const trendSmaDays = resolvedSettings.trendSmaDays || resolvedSettings.gcLong;
  const requiredLookback = Math.max(resolvedSettings.gcLong, trendSmaDays);

  if (timeline.length < requiredLookback) {
    throw new Error(
      `${name}: common timeline is shorter than ${requiredLookback} trading days.`
    );
  }

  const signalMap = buildSignalMap(
    qqqBars,
    resolvedSettings.startDate,
    resolvedSettings.qqqLookbackDays
  );
  const enrichedTimeline = timeline.flatMap((row) => {
    const signal = signalMap.get(row.date);
    if (!signal) {
      return [];
    }

    return [{ ...row, ...signal }];
  });

  const riskCloses = enrichedTimeline.map((row) => row.risk.adjClose);
  const smaShort = calculateSMA(riskCloses, resolvedSettings.gcShort);
  const smaLong = calculateSMA(riskCloses, resolvedSettings.gcLong);
  const trendSma = calculateSMA(riskCloses, trendSmaDays);
  const rsi = calculateRSI(riskCloses, resolvedSettings.rsiPeriod);
  const cashDailyRate = (1 + annualCashYield) ** (1 / 252) - 1;
  const contributionsByDate = buildContributionBuckets(
    enrichedTimeline,
    contributionPlan,
    initialCapital
  );

  const state = {
    cash: 0,
    riskShares: 0,
    sgovShares: 0,
    riskTracker: createAverageCostTracker(),
    sgovTracker: createAverageCostTracker(),
    events: [],
    trades: [],
    activeCycle: null,
    tpBaseShares: 0,
    tp1Done: false,
    tp2Done: false,
    dip1Consumed: false,
    dip2Consumed: false,
    bonusConsumed: false,
    tp3LockActive: false,
    hasGoldCrossSinceDeadCross: false,
    cooldownUntilIndex: -1,
    pendingGoldCross: false
  };

  const realizedByYear = new Map();
  const dailyValues = [];
  let annualTaxPaid = 0;
  let principalContributed = 0;
  let contributionCount = 0;
  let exposureDays = 0;
  let cashDays = 0;
  let sgovDays = 0;
  let navUnits = 0;
  let currentTaxYear = yearOf(enrichedTimeline[0].date);
  const eventCounts = {
    dip1: 0,
    dip2: 0,
    bonus: 0,
    tp1: 0,
    tp2: 0,
    tp3: 0,
    gc: 0,
    dc: 0
  };
  const usTaxBasicDeduction =
    valuationCurrency === "USD"
      ? US_FOREIGN_BASIC_DEDUCTION_USD
      : US_FOREIGN_BASIC_DEDUCTION_KRW;

  for (let index = 0; index < enrichedTimeline.length; index += 1) {
    const row = enrichedTimeline[index];
    const year = yearOf(row.date);
    const price = row.risk.adjClose;

    if (taxMode === "taxed" && year !== currentTaxYear) {
      const taxDue = computeUsAnnualTax(
        realizedByYear.get(currentTaxYear) || 0,
        usTaxBasicDeduction
      );
      if (taxDue > 0) {
        const deducted = deductTaxFromState(
          state,
          taxDue,
          price,
          row.sgov?.adjClose || 0
        );
        annualTaxPaid += deducted;
        state.events.push({
          date: row.date,
          type: "annual-tax",
          taxYear: currentTaxYear,
          amount: deducted
        });
      }
      currentTaxYear = year;
    }

    if (index > 0 && state.cash > 0) {
      state.cash *= 1 + cashDailyRate;
    }

    const parkingPrice = row.sgov?.adjClose || 0;
    const preValue = getTotalPortfolioValue(state, price, parkingPrice);
    const preNav = navUnits > 0 ? preValue / navUnits : 1;
    let externalEndValueToday = 0;
    const pending = contributionsByDate.get(row.date) || [];

    for (const item of pending) {
      principalContributed += item.amount;
      contributionCount += 1;
      if (resolvedSettings.useSgovParking && parkingPrice > 0) {
        state.cash += item.amount;
        const parkingFill = parkCashInSgov(state, parkingPrice, feeRate, slippagePerShare);
        externalEndValueToday += parkingFill
          ? positionValue(parkingFill.shares, parkingPrice)
          : item.amount;
        state.events.push({
          date: row.date,
          type: "contribution-sgov",
          amount: item.amount,
          sourceDate: item.sourceDate
        });
      } else {
        state.cash += item.amount;
        externalEndValueToday += item.amount;
        state.events.push({
          date: row.date,
          type: "contribution-cash",
          amount: item.amount,
          sourceDate: item.sourceDate
        });
      }
    }

    const drawdown =
      row.qqqRollingHigh > 0 ? row.qqqClose / row.qqqRollingHigh - 1 : null;
    const inCooldown = index <= state.cooldownUntilIndex;
    const goldCross = resolveTrendEntrySignal({
      entryMode: resolvedSettings.trendEntryMode,
      index,
      smaShort,
      smaLong,
      closes: riskCloses,
      trendSma,
      confirmationDays: resolvedSettings.trendEntryConfirmationDays
    });
    const deadCross = resolveTrendExitSignal({
      exitMode: resolvedSettings.trendExitMode,
      index,
      smaShort,
      smaLong,
      closes: riskCloses,
      trendSma
    });
    const trendStillBullish =
      resolvedSettings.trendEntryMode === "sma-cross"
        ? smaShort[index] !== null && smaLong[index] !== null && smaShort[index] > smaLong[index]
        : trendSma[index] !== null && riskCloses[index] > trendSma[index];

    const newHighSignalValue =
      resolvedSettings.resetDipOnNewHighSource === "high" ? row.qqqHigh : row.qqqClose;

    if (newHighSignalValue >= row.qqqRollingHigh * (1 - 1e-9)) {
      resetDipState(state);
    }

    let fullExitToday = false;

    if (state.riskShares > 0 && deadCross) {
      executeSell({
        state,
        date: row.date,
        index,
        price,
        sharesToSell: state.riskShares,
        reason: "dead-cross",
        feeRate,
        slippagePerShare,
        realizedByYear,
        parkingPrice,
        useSgovParking: resolvedSettings.useSgovParking
      });
      state.cooldownUntilIndex = index + resolvedSettings.cooldownDays;
      state.tp3LockActive = false;
      state.hasGoldCrossSinceDeadCross = false;
      state.pendingGoldCross = false;
      resetDipState(state);
      eventCounts.dc += 1;
      fullExitToday = true;
    }

    if (!fullExitToday && state.riskShares > 0) {
      const averageCost =
        state.riskTracker.shares > 0 ? state.riskTracker.totalCost / state.riskTracker.shares : null;

      if (averageCost && price >= averageCost * (1 + resolvedSettings.tp3Threshold)) {
        executeSell({
          state,
          date: row.date,
          index,
          price,
          sharesToSell: state.riskShares,
          reason: "tp3",
          feeRate,
          slippagePerShare,
          realizedByYear,
          parkingPrice,
          useSgovParking: resolvedSettings.useSgovParking
        });
        resetDipState(state);
        state.tp3LockActive = true;
        eventCounts.tp3 += 1;
        fullExitToday = true;
      }
    }

    if (
      resolvedSettings.prioritizeGoldCrossOverTpSameDay &&
      !fullExitToday &&
      goldCross &&
      getParkingValue(state, parkingPrice) > 0 &&
      !state.tp3LockActive &&
      !state.hasGoldCrossSinceDeadCross &&
      (!inCooldown || resolvedSettings.allowGoldCrossDuringCooldown)
    ) {
      const buy = executeBuy({
        state,
        date: row.date,
        index,
        price,
        amount: getParkingValue(state, parkingPrice),
        reason: "gold-cross",
        feeRate,
        slippagePerShare,
        parkingPrice,
        useSgovParking: resolvedSettings.useSgovParking,
        realizedByYear
      });
      if (buy) {
        state.hasGoldCrossSinceDeadCross = true;
        state.pendingGoldCross = false;
        eventCounts.gc += 1;
      }
    }

    if (
      !fullExitToday &&
      state.riskShares > 0 &&
      (
        !state.hasGoldCrossSinceDeadCross ||
        resolvedSettings.allowTpAfterGoldCross ||
        (
          Number.isFinite(resolvedSettings.postGoldCrossTp2Threshold) &&
          resolvedSettings.postGoldCrossTp2SellFractionOfBase > 0
        )
      )
    ) {
      const averageCost =
        state.riskTracker.shares > 0 ? state.riskTracker.totalCost / state.riskTracker.shares : null;

      if (
        averageCost &&
        !state.tp1Done &&
        price >= averageCost * (1 + resolvedSettings.tp1Threshold)
      ) {
        const sale = executeSell({
          state,
          date: row.date,
          index,
          price,
          sharesToSell: Math.min(
            state.riskShares,
            state.tpBaseShares * resolvedSettings.tp1SellFractionOfBase
          ),
          reason: "tp1",
          feeRate,
          slippagePerShare,
          realizedByYear,
          parkingPrice,
          useSgovParking: resolvedSettings.useSgovParking
        });
        if (sale) {
          state.tp1Done = true;
          eventCounts.tp1 += 1;
        }
      }

      if (
        state.riskShares > 0 &&
        averageCost &&
        state.tp1Done &&
        !state.tp2Done &&
        price >= averageCost * (1 + resolvedSettings.tp2Threshold)
      ) {
        const sale = executeSell({
          state,
          date: row.date,
          index,
          price,
          sharesToSell: Math.min(
            state.riskShares,
            state.tpBaseShares * resolvedSettings.tp2SellFractionOfBase
          ),
          reason: "tp2",
          feeRate,
          slippagePerShare,
          realizedByYear,
          parkingPrice,
          useSgovParking: resolvedSettings.useSgovParking
        });
        if (sale) {
          state.tp2Done = true;
          eventCounts.tp2 += 1;
        }
      }

      if (
        state.riskShares > 0 &&
        averageCost &&
        state.hasGoldCrossSinceDeadCross &&
        !state.tp2Done &&
        Number.isFinite(resolvedSettings.postGoldCrossTp2Threshold) &&
        resolvedSettings.postGoldCrossTp2SellFractionOfBase > 0 &&
        price >= averageCost * (1 + resolvedSettings.postGoldCrossTp2Threshold)
      ) {
        const sale = executeSell({
          state,
          date: row.date,
          index,
          price,
          sharesToSell: Math.min(
            state.riskShares,
            state.tpBaseShares * resolvedSettings.postGoldCrossTp2SellFractionOfBase
          ),
          reason: "post-gc-tp2",
          feeRate,
          slippagePerShare,
          realizedByYear,
          parkingPrice,
          useSgovParking: resolvedSettings.useSgovParking
        });
        if (sale) {
          state.tp2Done = true;
          eventCounts.tp2 += 1;
        }
      }
    }

    if (
      !fullExitToday &&
      !inCooldown &&
      drawdown !== null &&
      !(state.hasGoldCrossSinceDeadCross && state.riskShares > 0)
    ) {
      const equity = getTotalPortfolioValue(state, price, parkingPrice);
      const currentWeight = equity > 0 ? positionValue(state.riskShares, price) / equity : 0;
      const canDipBuy = drawdown > resolvedSettings.stopDrawdown;

      if (canDipBuy && drawdown <= resolvedSettings.dip1Drawdown && !state.dip1Consumed) {
        const targetWeight = resolvedSettings.dip1Weight;
        if (currentWeight < targetWeight && getParkingValue(state, parkingPrice) > 0) {
          const desiredValue = equity * targetWeight - positionValue(state.riskShares, price);
          const buy = executeBuy({
            state,
            date: row.date,
            index,
            price,
            amount: desiredValue,
            reason: "dip1",
            feeRate,
            slippagePerShare,
            parkingPrice,
            useSgovParking: resolvedSettings.useSgovParking,
            realizedByYear
          });
          if (buy) {
            eventCounts.dip1 += 1;
          }
        }
        state.dip1Consumed = true;
      }

      const equityAfterDip1 = getTotalPortfolioValue(state, price, parkingPrice);
      const currentWeightAfterDip1 =
        equityAfterDip1 > 0 ? positionValue(state.riskShares, price) / equityAfterDip1 : 0;

      if (
        !state.tp3LockActive &&
        canDipBuy &&
        drawdown <= resolvedSettings.dip2Drawdown &&
        !state.dip2Consumed
      ) {
        const targetWeight = resolvedSettings.dip2Weight;
        if (currentWeightAfterDip1 < targetWeight && getParkingValue(state, parkingPrice) > 0) {
          const desiredValue =
            equityAfterDip1 * targetWeight - positionValue(state.riskShares, price);
          const buy = executeBuy({
            state,
            date: row.date,
            index,
            price,
            amount: desiredValue,
            reason: "dip2",
            feeRate,
            slippagePerShare,
            parkingPrice,
            useSgovParking: resolvedSettings.useSgovParking,
            realizedByYear
          });
          if (buy) {
            eventCounts.dip2 += 1;
          }
        }
        state.dip2Consumed = true;
      }

      const equityAfterDip2 = getTotalPortfolioValue(state, price, parkingPrice);
      const currentWeightAfterDip2 =
        equityAfterDip2 > 0 ? positionValue(state.riskShares, price) / equityAfterDip2 : 0;

      if (
        !state.tp3LockActive &&
        canDipBuy &&
        drawdown <= resolvedSettings.dip1Drawdown &&
        rsi[index] !== null &&
        rsi[index] <= resolvedSettings.rsiBonusThreshold &&
        !state.bonusConsumed
      ) {
        const baseTarget =
          drawdown <= resolvedSettings.dip2Drawdown
            ? resolvedSettings.dip2Weight
            : resolvedSettings.dip1Weight;
        const targetWeight = baseTarget + resolvedSettings.bonusWeight;
        if (currentWeightAfterDip2 < targetWeight && getParkingValue(state, parkingPrice) > 0) {
          const desiredValue =
            equityAfterDip2 * targetWeight - positionValue(state.riskShares, price);
          const buy = executeBuy({
            state,
            date: row.date,
            index,
            price,
            amount: desiredValue,
            reason: "bonus",
            feeRate,
            slippagePerShare,
            parkingPrice,
            useSgovParking: resolvedSettings.useSgovParking,
            realizedByYear
          });
          if (buy) {
            eventCounts.bonus += 1;
          }
        }
        state.bonusConsumed = true;
      }
    }

    if (
      !fullExitToday &&
      goldCross &&
      getParkingValue(state, parkingPrice) > 0 &&
      !state.tp3LockActive &&
      !state.hasGoldCrossSinceDeadCross &&
      (!inCooldown || resolvedSettings.allowGoldCrossDuringCooldown)
    ) {
      const buy = executeBuy({
        state,
        date: row.date,
        index,
        price,
        amount: getParkingValue(state, parkingPrice),
        reason: "gold-cross",
        feeRate,
        slippagePerShare,
        parkingPrice,
        useSgovParking: resolvedSettings.useSgovParking,
        realizedByYear
      });
      if (buy) {
        state.hasGoldCrossSinceDeadCross = true;
        state.pendingGoldCross = false;
        eventCounts.gc += 1;
      }
    }

    if (
      !fullExitToday &&
      inCooldown &&
      goldCross &&
      getParkingValue(state, parkingPrice) > 0 &&
      !state.tp3LockActive &&
      !state.hasGoldCrossSinceDeadCross &&
      resolvedSettings.deferGoldCrossUntilCooldownEnds
    ) {
      state.pendingGoldCross = true;
    }

    if (
      !fullExitToday &&
      !inCooldown &&
      state.pendingGoldCross &&
      getParkingValue(state, parkingPrice) > 0 &&
      !state.tp3LockActive &&
      !state.hasGoldCrossSinceDeadCross &&
      trendStillBullish
    ) {
      const buy = executeBuy({
        state,
        date: row.date,
        index,
        price,
        amount: getParkingValue(state, parkingPrice),
        reason: "gold-cross",
        feeRate,
        slippagePerShare,
        parkingPrice,
        useSgovParking: resolvedSettings.useSgovParking,
        realizedByYear
      });
      if (buy) {
        state.hasGoldCrossSinceDeadCross = true;
        state.pendingGoldCross = false;
        eventCounts.gc += 1;
      }
    }

    const value = getTotalPortfolioValue(state, price, parkingPrice);
    navUnits = allocateExternalUnits(navUnits, preNav, externalEndValueToday, value);
    const nav = navUnits > 0 ? value / navUnits : 1;

    if (state.riskShares > 0) {
      exposureDays += 1;
    }
    if (state.sgovShares > 0) {
      sgovDays += 1;
    }
    if (state.cash > 0) {
      cashDays += 1;
    }

    dailyValues.push({ date: row.date, value, nav, principalContributed });
  }

  if (taxMode === "taxed" && dailyValues.length > 0) {
    const lastRow = enrichedTimeline[enrichedTimeline.length - 1];
    const finalTax = computeUsAnnualTax(
      realizedByYear.get(currentTaxYear) || 0,
      usTaxBasicDeduction
    );

    if (finalTax > 0) {
      const deducted = deductTaxFromState(
        state,
        finalTax,
        lastRow.risk.adjClose,
        lastRow.sgov?.adjClose || 0
      );
      annualTaxPaid += deducted;
      state.events.push({
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

  const lastRow = enrichedTimeline[enrichedTimeline.length - 1];
  const metrics = buildMetrics({
    dailyValues,
    trades: state.trades,
    initialCapital,
    principalContributed,
    contributionCount,
    exposureDays,
    cashDays,
    sgovDays,
    annualTaxPaid,
    riskShares: state.riskShares,
    finalRiskPrice: lastRow.risk.adjClose,
    cash: getParkingValue(state, lastRow.sgov?.adjClose || 0),
    eventCounts,
    activeCycle: state.activeCycle
  });

  return {
    meta: {
      strategyName: name,
      scenarioLabel: `snowball`,
      startDate: enrichedTimeline[0].date,
      endDate: enrichedTimeline[enrichedTimeline.length - 1].date,
      currency: valuationCurrency,
      feeRate,
      annualCashYield,
      slippagePerShare,
      taxMode,
      settings: resolvedSettings
    },
    metrics,
    trades: state.trades,
    events: state.events,
    dailyValues
  };
}
