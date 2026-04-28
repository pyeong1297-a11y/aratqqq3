import {
  average,
  calculateCagr,
  calculateMaxDrawdown,
  calculateWinRate,
  findLatestIndexBefore
} from "./metrics.js";
import {
  addUtcYears,
  alignKrBars,
  buildFixedDayDate,
  buildQqqReturnMap,
  buildSignalSeries,
  findFirstTradingDateOnOrAfter,
  firstMonthlyTargetOnOrAfter,
  nextMonthlyTarget,
  resolveKodexTradePrice,
  resolveContributionTarget,
  yearOf
} from "./isa-helpers.js";
import {
  applyIsaContribution,
  createIsaAccount,
  enterIsaRiskPosition,
  exitIsaRiskPosition,
  getIsaAccountValue,
  isIsaInRisk,
  liquidateIsaAccount,
  takeIsaProfitIntoSp500
} from "./isa-portfolio.js";
import { computeIsaExitTax } from "./tax.js";
import {
  buildUsTimeline,
  createUsSleeve,
  depositIntoUsSleeve,
  finalizeUsTax,
  getUsSgovValue,
  getUsValue,
  isUsOut,
  processUsTradingDate,
  withdrawFromUsSgov
} from "./us-sleeve.js";

function makeDateMap(rows) {
  return new Map(rows.map((row, index) => [row.date, { row, index }]));
}

function getTotalValue(activeIsaAccount, latestKrRow, usEngine, pendingUsTransferBalance) {
  const isaValue = activeIsaAccount && latestKrRow ? getIsaAccountValue(activeIsaAccount, latestKrRow) : 0;
  return isaValue + getUsValue(usEngine) + pendingUsTransferBalance;
}

function startIsaCycle(
  activeIsaAccount,
  latestKrRow,
  activeIsaCycle,
  date,
  index,
  entryTradePrice,
  signalEntryPrice
) {
  if (activeIsaCycle || !activeIsaAccount || !latestKrRow || !isIsaInRisk(activeIsaAccount)) {
    return activeIsaCycle;
  }

  return {
    entryDate: date,
    entryIndex: index,
    startValue: getIsaAccountValue(activeIsaAccount, latestKrRow),
    contributed: 0,
    entryTradePrice: entryTradePrice ?? null,
    signalEntryPrice: signalEntryPrice ?? null,
    nextIsaProfitTakeIndex: 0
  };
}

function closeIsaCycle(activeIsaCycle, trades, activeIsaAccount, latestKrRow, date, index) {
  if (!activeIsaCycle || !activeIsaAccount || !latestKrRow) {
    return null;
  }

  const endValue = getIsaAccountValue(activeIsaAccount, latestKrRow);
  const baseCapital = activeIsaCycle.startValue + activeIsaCycle.contributed;
  trades.push({
    entryDate: activeIsaCycle.entryDate,
    exitDate: date,
    holdDays: index - activeIsaCycle.entryIndex,
    pnl: endValue - baseCapital,
    returnPct: baseCapital <= 0 ? 0 : endValue / baseCapital - 1,
    sleeve: "isa"
  });

  return null;
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

function normalizeIsaProfitTakeSteps(signalMode) {
  if (!Array.isArray(signalMode?.isaProfitTakeSteps)) {
    return [];
  }

  return signalMode.isaProfitTakeSteps
    .filter((step) => Number.isFinite(step.threshold) && Number.isFinite(step.sellFraction))
    .map((step) => ({
      threshold: step.threshold,
      sellFraction: step.sellFraction,
      destination: step.destination || "sp500",
      triggerSource: step.triggerSource || "kodex"
    }))
    .sort((left, right) => left.threshold - right.threshold);
}

export function runIsaStrategy({
  name,
  signalBars,
  qqqBars,
  kodexBars,
  tigerSp500Bars,
  riskBars,
  spymBars,
  sgovBars,
  fxBars,
  initialCapital,
  signalMode,
  scenario,
  feeRate,
  annualCashYield,
  taxMode,
  contributionPlan,
  bulzStrategy,
  usSlippageRate
}) {
  const rawKrTimeline = alignKrBars(kodexBars, annualCashYield);
  const sp500Map = new Map(tigerSp500Bars.map((bar) => [bar.date, bar]));
  const krTimeline = rawKrTimeline
    .filter((row) => sp500Map.has(row.date))
    .map((row) => ({
      ...row,
      sp500: sp500Map.get(row.date)
    }));
  const usTimeline = buildUsTimeline(riskBars, spymBars, sgovBars, fxBars);
  if (krTimeline.length === 0) {
    throw new Error(`${name}: common KR timeline is empty.`);
  }
  if (usTimeline.length < 200) {
    throw new Error(`${name}: common US timeline is too short.`);
  }

  const krDates = krTimeline.map((row) => row.date);
  const usDates = usTimeline.map((row) => row.date);
  const krMap = makeDateMap(krTimeline);
  const usMap = makeDateMap(usTimeline);
  const calendarDates = [...new Set([...krDates, ...usDates])].sort((a, b) => a.localeCompare(b));

  const signalSeries = buildSignalSeries(signalBars, signalMode);
  const signalDates = signalSeries.map((item) => item.date);
  const qqqReturnMap = buildQqqReturnMap(qqqBars);
  const isaProfitTakeSteps = normalizeIsaProfitTakeSteps(signalMode);

  const effectiveContributionPlan = {
    initialContribution: initialCapital,
    legacyMonthlyContribution: 0,
    rolloverYearsFromStart: Number.POSITIVE_INFINITY,
    renewalInitialContribution: 0,
    renewalAnnualContribution: 0,
    renewalAnnualContributionMonth: 1,
    renewalAnnualContributionDay: 2,
    renewalContributionLimit: 0,
    ...contributionPlan,
    initialContribution:
      contributionPlan?.initialContribution !== undefined
        ? contributionPlan.initialContribution
        : initialCapital
  };

  const usEngine = createUsSleeve({
    timeline: usTimeline,
    confirmationDays: bulzStrategy.confirmationDays,
    feeRate: bulzStrategy.feeRate,
    slippageRate: usSlippageRate,
    profitTakeSteps: bulzStrategy.profitTakeSteps,
    profitTakeParking: bulzStrategy.profitTakeParking,
    taxMode
  });

  const startDate = krTimeline[0].date;
  const legacyCloseEligibleDate = Number.isFinite(effectiveContributionPlan.rolloverYearsFromStart)
    ? findFirstTradingDateOnOrAfter(
        krDates,
        addUtcYears(startDate, effectiveContributionPlan.rolloverYearsFromStart)
      )
    : null;

  let nextAccountId = 1;
  let activeIsaAccount = createIsaAccount(nextAccountId, startDate, "legacy");
  let activeIsaCycle = null;
  let pendingUsTransferBalance = 0;
  let latestKrRow = null;
  let nextLegacyContributionTarget = firstMonthlyTargetOnOrAfter(
    startDate,
    21
  );
  let nextLegacyContributionDate = findFirstTradingDateOnOrAfter(
    krDates,
    nextLegacyContributionTarget
  );
  let nextRenewalAnnualTargetDate = null;
  let renewalGrossContributed = 0;

  let navUnits = 0;
  let marketExposureDays = 0;
  let isaCashDays = 0;
  let exitTaxPaid = 0;
  let externalPrincipalContributed = 0;
  let isaGrossContributed = 0;
  let internalIsaFunding = 0;
  let closedIsaNetProceeds = 0;
  let contributionCount = 0;
  let accountCount = 1;
  let isaProfitTakeCount = 0;

  const pendingUsDeposits = new Map();
  const dailyValues = [];
  const events = [];
  const trades = [];

  for (const date of calendarDates) {
    const krEntry = krMap.get(date);
    const usEntry = usMap.get(date);

    if (krEntry) {
      let skipIsaEntryToday = false;
      let isaEntryTradePriceHint = null;
      latestKrRow = krEntry.row;
      const prevKodexBar = krEntry.index > 0 ? krTimeline[krEntry.index - 1].kodex : null;
      const latestSignalIndex = findLatestIndexBefore(signalDates, date);
      const latestSignal = latestSignalIndex >= 0 ? signalSeries[latestSignalIndex] : null;
      const desiredRisk = latestSignal ? latestSignal.invested : false;
      const qqqReturn = latestSignal ? qqqReturnMap.get(latestSignal.date) ?? 0 : 0;
      const baseContributionTarget = desiredRisk ? "kodex" : "cash";
      const ongoingContributionTarget = resolveContributionTarget(latestSignal);

      if (activeIsaAccount.phase === "legacy") {
        const shouldCloseLegacy =
          legacyCloseEligibleDate !== null &&
          date >= legacyCloseEligibleDate &&
          latestSignal !== null &&
          latestSignal.sma200 !== null &&
          latestSignal.close <= latestSignal.sma200;

        if (shouldCloseLegacy) {
          if (activeIsaCycle && isIsaInRisk(activeIsaAccount)) {
            activeIsaCycle = closeIsaCycle(
              activeIsaCycle,
              trades,
              activeIsaAccount,
              latestKrRow,
              date,
              krEntry.index
            );
          }

          const liquidation = liquidateIsaAccount({
            account: activeIsaAccount,
            row: latestKrRow,
            prevKodexBar,
            qqqReturn,
            scenario,
            feeRate
          });

          let rolloverTax = 0;
          if (taxMode === "taxed") {
            rolloverTax = computeIsaExitTax(liquidation.proceeds, activeIsaAccount.principal);
            exitTaxPaid += rolloverTax;
            events.push({
              date,
              type: "isa-rollover-tax",
              accountId: activeIsaAccount.id,
              amount: rolloverTax
            });
          }

          const netProceeds = liquidation.proceeds - rolloverTax;
          closedIsaNetProceeds += netProceeds;
          pendingUsTransferBalance += netProceeds;
          events.push({
            date,
            type: "isa-rollover-close",
            accountId: activeIsaAccount.id,
            grossProceeds: liquidation.proceeds,
            proceeds: netProceeds,
            taxPaid: rolloverTax,
            tradePrice: liquidation.kodexTradePrice
          });

          const usTransferDate = findFirstTradingDateOnOrAfter(usDates, date);
          if (usTransferDate) {
            pendingUsDeposits.set(usTransferDate, (pendingUsDeposits.get(usTransferDate) || 0) + netProceeds);
          }

          nextAccountId += 1;
          activeIsaAccount = createIsaAccount(nextAccountId, date, "renewal");
          accountCount += 1;
          skipIsaEntryToday = true;
          events.push({
            date,
            type: "isa-rollover-open",
            accountId: activeIsaAccount.id
          });

          const preValue = getTotalValue(
            activeIsaAccount,
            latestKrRow,
            usEngine,
            pendingUsTransferBalance
          );
          const preNav = navUnits > 0 ? preValue / navUnits : 1;
          const grossAmount = Math.min(
            effectiveContributionPlan.renewalInitialContribution,
            effectiveContributionPlan.renewalContributionLimit
          );
          const contribution = applyIsaContribution({
            account: activeIsaAccount,
            amount: grossAmount,
            allocationTarget: baseContributionTarget,
            row: latestKrRow,
            prevKodexBar,
            qqqReturn,
            scenario,
            feeRate
          });

          renewalGrossContributed += grossAmount;
          isaGrossContributed += grossAmount;
          externalPrincipalContributed += grossAmount;
          contributionCount += 1;
          navUnits = allocateExternalUnits(navUnits, preNav, contribution.endValue, getTotalValue(
            activeIsaAccount,
            latestKrRow,
            usEngine,
            pendingUsTransferBalance
          ));

          events.push({
            date,
            type: "renewal-initial-contribution",
            accountId: activeIsaAccount.id,
            amount: grossAmount,
            externalAmount: grossAmount,
            internalAmount: 0,
            allocation: contribution.allocation,
            tradePrice: contribution.tradePrice,
            shares: contribution.shares
          });

          if (contribution.allocation === "kodex" && !activeIsaCycle) {
            isaEntryTradePriceHint = contribution.tradePrice;
          }

          nextRenewalAnnualTargetDate = findFirstTradingDateOnOrAfter(
            krDates,
            buildFixedDayDate(
              yearOf(date) + 1,
              effectiveContributionPlan.renewalAnnualContributionMonth,
              effectiveContributionPlan.renewalAnnualContributionDay
            )
          );
        }
      }

      const currentlyInRisk = isIsaInRisk(activeIsaAccount);
      if (!currentlyInRisk && desiredRisk && !skipIsaEntryToday) {
        const entry = enterIsaRiskPosition({
          account: activeIsaAccount,
          row: latestKrRow,
          prevKodexBar,
          qqqReturn,
          scenario,
          feeRate
        });

        if (entry) {
          isaEntryTradePriceHint = entry.tradePrice;
          events.push({
            date,
            type: "entry-kodex",
            accountId: activeIsaAccount.id,
            signalDate: latestSignal?.date ?? null,
            tradePrice: entry.tradePrice,
            shares: entry.shares
          });
        }
      } else if (currentlyInRisk && !desiredRisk) {
        const exit = exitIsaRiskPosition({
          account: activeIsaAccount,
          row: latestKrRow,
          prevKodexBar,
          qqqReturn,
          scenario,
          feeRate
        });

        if (exit) {
          events.push({
            date,
            type: "exit-kodex",
            accountId: activeIsaAccount.id,
            signalDate: latestSignal?.date ?? null,
            tradePrice: exit.tradePrice,
            cashShares: exit.cashShares
          });
          activeIsaCycle = closeIsaCycle(
            activeIsaCycle,
            trades,
            activeIsaAccount,
            latestKrRow,
            date,
            krEntry.index
          );
        }
      }

      if (
        desiredRisk &&
        activeIsaCycle &&
        activeIsaCycle.entryTradePrice > 0 &&
        activeIsaCycle.nextIsaProfitTakeIndex < isaProfitTakeSteps.length
      ) {
        while (activeIsaCycle.nextIsaProfitTakeIndex < isaProfitTakeSteps.length) {
          const nextStep = isaProfitTakeSteps[activeIsaCycle.nextIsaProfitTakeIndex];
          if (nextStep.destination !== "sp500" || activeIsaAccount.kodexShares <= 0) {
            activeIsaCycle.nextIsaProfitTakeIndex += 1;
            continue;
          }

          let currentReturn = null;
          if (nextStep.triggerSource === "signal") {
            currentReturn =
              latestSignal && activeIsaCycle.signalEntryPrice > 0
                ? latestSignal.close / activeIsaCycle.signalEntryPrice - 1
                : null;
          } else {
            const currentKodexTradePrice = resolveKodexTradePrice({
              mode: scenario.mode,
              tradeSide: "sell",
              kodexBar: latestKrRow.kodex,
              prevKodexBar,
              qqqReturn,
              slipRate: scenario.slipRate
            });
            currentReturn = currentKodexTradePrice / activeIsaCycle.entryTradePrice - 1;
          }

          if (currentReturn === null) {
            break;
          }
          if (currentReturn < nextStep.threshold) {
            break;
          }

          const profitTake = takeIsaProfitIntoSp500({
            account: activeIsaAccount,
            row: latestKrRow,
            prevKodexBar,
            qqqReturn,
            scenario,
            feeRate,
            sellFraction: nextStep.sellFraction
          });
          activeIsaCycle.nextIsaProfitTakeIndex += 1;

          if (!profitTake) {
            continue;
          }

          isaProfitTakeCount += 1;
          events.push({
            date,
            type: "isa-profit-take",
            accountId: activeIsaAccount.id,
            threshold: nextStep.threshold,
            sellFraction: nextStep.sellFraction,
            triggerSource: nextStep.triggerSource,
            kodexTradePrice: profitTake.kodexTradePrice,
            sp500TradePrice: profitTake.sp500TradePrice,
            soldShares: profitTake.soldShares,
            boughtShares: profitTake.boughtShares,
            proceeds: profitTake.proceeds
          });
        }
      }

      const preValue = getTotalValue(activeIsaAccount, latestKrRow, usEngine, pendingUsTransferBalance);
      const preNav = navUnits > 0 ? preValue / navUnits : 1;
      let externalEndValueToday = 0;

      if (date === startDate) {
        const grossAmount = effectiveContributionPlan.initialContribution;
        const contribution = applyIsaContribution({
          account: activeIsaAccount,
          amount: grossAmount,
          allocationTarget: baseContributionTarget,
          row: latestKrRow,
          prevKodexBar,
          qqqReturn,
          scenario,
          feeRate
        });

        externalPrincipalContributed += grossAmount;
        isaGrossContributed += grossAmount;
        contributionCount += 1;
        externalEndValueToday += contribution.endValue;

        events.push({
          date,
          type: "initial-contribution",
          accountId: activeIsaAccount.id,
          amount: grossAmount,
          externalAmount: grossAmount,
          internalAmount: 0,
          allocation: contribution.allocation,
          tradePrice: contribution.tradePrice,
          shares: contribution.shares
        });

        if (contribution.allocation === "kodex" && !activeIsaCycle) {
          isaEntryTradePriceHint = contribution.tradePrice;
        }
      }

      if (activeIsaAccount.phase === "legacy" && nextLegacyContributionDate === date) {
        const grossAmount = effectiveContributionPlan.legacyMonthlyContribution;
        const contribution = applyIsaContribution({
          account: activeIsaAccount,
          amount: grossAmount,
          allocationTarget: ongoingContributionTarget,
          row: latestKrRow,
          prevKodexBar,
          qqqReturn,
          scenario,
          feeRate
        });

        externalPrincipalContributed += grossAmount;
        isaGrossContributed += grossAmount;
        contributionCount += 1;
        externalEndValueToday += contribution.endValue;
        if (activeIsaCycle) {
          activeIsaCycle.contributed += grossAmount;
        }

        events.push({
          date,
          type: "legacy-monthly-contribution",
          accountId: activeIsaAccount.id,
          amount: grossAmount,
          externalAmount: grossAmount,
          internalAmount: 0,
          allocation: contribution.allocation,
          tradePrice: contribution.tradePrice,
          shares: contribution.shares
        });

        nextLegacyContributionTarget = nextMonthlyTarget(nextLegacyContributionTarget, 21);
        nextLegacyContributionDate = findFirstTradingDateOnOrAfter(
          krDates,
          nextLegacyContributionTarget
        );
      }

      if (
        activeIsaAccount.phase === "renewal" &&
        nextRenewalAnnualTargetDate === date &&
        renewalGrossContributed < effectiveContributionPlan.renewalContributionLimit
      ) {
        const grossAmount = Math.min(
          effectiveContributionPlan.renewalAnnualContribution,
          effectiveContributionPlan.renewalContributionLimit - renewalGrossContributed
        );

        let internalAmount = 0;
        if (grossAmount > 0 && isUsOut(usEngine) && usEngine.lastRow) {
          internalAmount = withdrawFromUsSgov({
            engine: usEngine,
            row: usEngine.lastRow,
            amountKrw: Math.min(grossAmount, getUsSgovValue(usEngine)),
            reason: "renewal-annual-contribution",
            events
          });
        }

        const externalAmount = Math.max(0, grossAmount - internalAmount);
        const contribution = applyIsaContribution({
          account: activeIsaAccount,
          amount: grossAmount,
          allocationTarget: ongoingContributionTarget,
          row: latestKrRow,
          prevKodexBar,
          qqqReturn,
          scenario,
          feeRate
        });

        renewalGrossContributed += grossAmount;
        isaGrossContributed += grossAmount;
        internalIsaFunding += internalAmount;
        externalPrincipalContributed += externalAmount;
        contributionCount += 1;
        if (grossAmount > 0) {
          externalEndValueToday += contribution.endValue * (externalAmount / grossAmount);
        }
        if (activeIsaCycle) {
          activeIsaCycle.contributed += grossAmount;
        }

        events.push({
          date,
          type: "renewal-annual-contribution",
          accountId: activeIsaAccount.id,
          amount: grossAmount,
          externalAmount,
          internalAmount,
          allocation: contribution.allocation,
          tradePrice: contribution.tradePrice,
          shares: contribution.shares
        });

        nextRenewalAnnualTargetDate = findFirstTradingDateOnOrAfter(
          krDates,
          buildFixedDayDate(
            yearOf(date) + 1,
            effectiveContributionPlan.renewalAnnualContributionMonth,
            effectiveContributionPlan.renewalAnnualContributionDay
          )
        );
      }

      activeIsaCycle = startIsaCycle(
        activeIsaAccount,
        latestKrRow,
        activeIsaCycle,
        date,
        krEntry.index,
        isaEntryTradePriceHint ?? latestKrRow.kodex.adjOpen,
        latestSignal?.close ?? null
      );
      navUnits = allocateExternalUnits(
        navUnits,
        preNav,
        externalEndValueToday,
        getTotalValue(activeIsaAccount, latestKrRow, usEngine, pendingUsTransferBalance)
      );
    }

    if (usEntry) {
      processUsTradingDate({
        engine: usEngine,
        row: usEntry.row,
        index: usEntry.index,
        trades,
        events
      });

      const pendingDeposit = pendingUsDeposits.get(date) || 0;
      if (pendingDeposit > 0) {
        depositIntoUsSleeve({
          engine: usEngine,
          row: usEntry.row,
          index: usEntry.index,
          amountKrw: pendingDeposit,
          source: "closed-isa",
          events
        });
        pendingUsTransferBalance -= pendingDeposit;
        pendingUsDeposits.delete(date);
      }
    }

    const totalValue = getTotalValue(activeIsaAccount, latestKrRow, usEngine, pendingUsTransferBalance);
    const nav = navUnits > 0 ? totalValue / navUnits : 1;

    if ((activeIsaAccount && isIsaInRisk(activeIsaAccount)) || !isUsOut(usEngine)) {
      marketExposureDays += 1;
    }
    if (activeIsaAccount && !isIsaInRisk(activeIsaAccount)) {
      isaCashDays += 1;
    }

    dailyValues.push({
      date,
      value: totalValue,
      nav,
      principalContributed: externalPrincipalContributed,
      isaGrossContributed,
      internalIsaFunding,
      closedIsaNetProceeds
    });
  }

  const finalUsTax = finalizeUsTax(usEngine, events);
  const finalIsaTax =
    taxMode === "taxed" && activeIsaAccount && latestKrRow
      ? computeIsaExitTax(getIsaAccountValue(activeIsaAccount, latestKrRow), activeIsaAccount.principal)
      : 0;
  exitTaxPaid += finalIsaTax;

  if (finalIsaTax > 0) {
    events.push({
      date: dailyValues[dailyValues.length - 1].date,
      type: "isa-final-exit-tax",
      accountId: activeIsaAccount.id,
      amount: finalIsaTax
    });
  }

  const endingValue =
    getTotalValue(activeIsaAccount, latestKrRow, usEngine, pendingUsTransferBalance) - finalIsaTax;
  const endingNav = navUnits > 0 ? endingValue / navUnits : 1;
  dailyValues[dailyValues.length - 1].value = endingValue;
  dailyValues[dailyValues.length - 1].nav = endingNav;

  const metrics = {
    endingValue,
    totalReturn: endingNav - 1,
    cagr: calculateCagr(1, endingNav, dailyValues[0].date, dailyValues[dailyValues.length - 1].date),
    maxDrawdown: calculateMaxDrawdown(dailyValues.map((item) => item.nav)),
    tradeCount: trades.length,
    winRate: calculateWinRate(trades),
    avgHoldDays: average(trades.map((trade) => trade.holdDays)),
    marketExposure: marketExposureDays / dailyValues.length,
    cashHoldingRatio: isaCashDays / dailyValues.length,
    annualTaxPaid: usEngine.annualTaxPaid,
    exitTaxPaid,
    principalContributed: externalPrincipalContributed,
    netProfit: endingValue - externalPrincipalContributed,
    settledCash: closedIsaNetProceeds,
    contributionCount,
    accountCount,
    isaGrossContributed,
    internalIsaFunding,
    isaProfitTakeCount,
    usProfitTakeCount: usEngine.profitTakeCount,
    profitTakeCount: isaProfitTakeCount + usEngine.profitTakeCount
  };

  return {
    meta: {
      strategyName: name,
      scenarioLabel: scenario.label,
      startDate: dailyValues[0].date,
      endDate: dailyValues[dailyValues.length - 1].date,
      mode: scenario.mode,
      slipRate: scenario.slipRate,
      feeRate,
      annualCashYield,
      taxMode,
      signalMode,
      contributionPlan: effectiveContributionPlan
    },
    metrics,
    trades,
    events,
    dailyValues
  };
}
