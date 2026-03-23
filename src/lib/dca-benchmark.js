import { buyWithCash, positionValue } from "./portfolio.js";
import { computeIsaExitTax, computeUsAnnualTax } from "./tax.js";
import {
  calculateCagr,
  calculateMaxDrawdown
} from "./metrics.js";
import {
  findFirstTradingDateOnOrAfter,
  firstMonthlyTargetOnOrAfter,
  nextMonthlyTarget
} from "./isa-helpers.js";
import { resolveKodexTradePrice } from "./isa-helpers.js";

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

export function buildSingleIsaContributionSchedule(krDates, contributionPlan) {
  if (!krDates || krDates.length === 0) {
    return [];
  }

  const schedule = [];
  const startDate = krDates[0];
  const endDate = krDates[krDates.length - 1];

  schedule.push({
    sourceDate: startDate,
    amount: contributionPlan.initialContribution
  });

  let monthlyTarget = firstMonthlyTargetOnOrAfter(startDate, 21);
  let nextMonthlyDate = findFirstTradingDateOnOrAfter(krDates, monthlyTarget);

  while (nextMonthlyDate && nextMonthlyDate <= endDate) {
    schedule.push({
      sourceDate: nextMonthlyDate,
      amount: contributionPlan.legacyMonthlyContribution
    });

    monthlyTarget = nextMonthlyTarget(monthlyTarget, 21);
    nextMonthlyDate = findFirstTradingDateOnOrAfter(krDates, monthlyTarget);
  }

  return schedule.filter((item) => item.amount > 0);
}

export function mapContributionScheduleToTradeDates(schedule, assetDates) {
  const mapped = [];

  for (const item of schedule) {
    const tradeDate = findFirstTradingDateOnOrAfter(assetDates, item.sourceDate);
    if (!tradeDate) {
      continue;
    }

    mapped.push({
      ...item,
      tradeDate
    });
  }

  return mapped;
}

export function runSingleAssetDcaBenchmark({
  name,
  label,
  bars,
  contributionSchedule,
  feeRate,
  taxMode,
  tradePriceResolver,
  taxKind,
  principalLabel
}) {
  if (!bars || bars.length === 0) {
    throw new Error(`${name}: benchmark bars are empty.`);
  }

  const assetDates = bars.map((bar) => bar.date);
  const datedSchedule = mapContributionScheduleToTradeDates(contributionSchedule, assetDates);
  const contributionsByDate = new Map();

  for (const item of datedSchedule) {
    const bucket = contributionsByDate.get(item.tradeDate) || [];
    bucket.push(item);
    contributionsByDate.set(item.tradeDate, bucket);
  }

  let shares = 0;
  let principalContributed = 0;
  let contributionCount = 0;
  let navUnits = 0;
  const dailyValues = [];
  const events = [];

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const pending = contributionsByDate.get(bar.date) || [];
    const preValue = positionValue(shares, bar.adjClose);
    const preNav = navUnits > 0 ? preValue / navUnits : 1;
    let externalEndValueToday = 0;

    for (const item of pending) {
      const tradePrice = tradePriceResolver({ bar, index });
      const buy = buyWithCash(item.amount, tradePrice, feeRate, 0);
      shares += buy.shares;
      principalContributed += item.amount;
      contributionCount += 1;
      externalEndValueToday += positionValue(buy.shares, bar.adjClose);

      events.push({
        date: bar.date,
        type: "benchmark-contribution",
        amount: item.amount,
        tradePrice,
        shares: buy.shares,
        sourceDate: item.sourceDate
      });
    }

    const totalValue = positionValue(shares, bar.adjClose);
    navUnits = allocateExternalUnits(navUnits, preNav, externalEndValueToday, totalValue);
    const nav = navUnits > 0 ? totalValue / navUnits : 1;

    dailyValues.push({
      date: bar.date,
      value: totalValue,
      nav,
      principalContributed
    });
  }

  const preTaxEndingValue = dailyValues[dailyValues.length - 1].value;
  const taxPaid =
    taxMode === "taxed"
      ? taxKind === "isa"
        ? computeIsaExitTax(preTaxEndingValue, principalContributed)
        : computeUsAnnualTax(preTaxEndingValue - principalContributed)
      : 0;
  const endingValue = preTaxEndingValue - taxPaid;
  const endingNav = navUnits > 0 ? endingValue / navUnits : 1;
  dailyValues[dailyValues.length - 1].value = endingValue;
  dailyValues[dailyValues.length - 1].nav = endingNav;

  const metrics = {
    endingValue,
    totalReturn: endingNav - 1,
    cagr: calculateCagr(1, endingNav, dailyValues[0].date, dailyValues[dailyValues.length - 1].date),
    maxDrawdown: calculateMaxDrawdown(dailyValues.map((item) => item.nav)),
    tradeCount: 0,
    winRate: 0,
    avgHoldDays: 0,
    marketExposure: 1,
    principalContributed,
    netProfit: endingValue - principalContributed,
    contributionCount
  };

  if (taxKind === "isa") {
    metrics.exitTaxPaid = taxPaid;
  } else {
    metrics.annualTaxPaid = taxPaid;
  }

  return {
    meta: {
      strategyName: name,
      scenarioLabel: label,
      startDate: dailyValues[0].date,
      endDate: dailyValues[dailyValues.length - 1].date,
      benchmarkAsset: principalLabel,
      taxMode
    },
    metrics,
    trades: [],
    events,
    dailyValues
  };
}

export function resolveBenchmarkKodexTradePrice({
  bar,
  index,
  bars,
  qqqReturnMap,
  scenario
}) {
  const prevBar = index > 0 ? bars[index - 1] : null;
  const qqqReturn = qqqReturnMap.get(bar.date) ?? 0;
  return resolveKodexTradePrice({
    mode: scenario.mode,
    tradeSide: "buy",
    kodexBar: bar,
    prevKodexBar: prevBar,
    qqqReturn,
    slipRate: scenario.slipRate
  });
}

export function resolveBenchmarkUsOpenTradePrice({ bar, slippageRate }) {
  return bar.adjOpen * (1 + slippageRate);
}
