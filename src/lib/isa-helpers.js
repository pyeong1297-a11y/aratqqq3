import { calculateSMA } from "./metrics.js";

export function parseUtcDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addUtcYears(dateString, years) {
  const date = parseUtcDate(dateString);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return formatUtcDate(date);
}

export function buildFixedDayDate(year, month, day) {
  return formatUtcDate(new Date(Date.UTC(year, month - 1, day)));
}

export function yearOf(dateString) {
  return Number(String(dateString).slice(0, 4));
}

export function dayOfMonth(dateString) {
  return Number(String(dateString).slice(8, 10));
}

export function dayDiff(fromDate, toDate) {
  return Math.max(
    0,
    Math.round((parseUtcDate(toDate).getTime() - parseUtcDate(fromDate).getTime()) / 86_400_000)
  );
}

export function firstMonthlyTargetOnOrAfter(startDate, targetDay) {
  const date = parseUtcDate(startDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  if (dayOfMonth(startDate) <= targetDay) {
    return buildFixedDayDate(year, month, targetDay);
  }

  const nextMonthDate = new Date(Date.UTC(year, month - 1, targetDay));
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  return buildFixedDayDate(
    nextMonthDate.getUTCFullYear(),
    nextMonthDate.getUTCMonth() + 1,
    targetDay
  );
}

export function nextMonthlyTarget(targetDate, targetDay) {
  const nextDate = parseUtcDate(targetDate);
  nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
  return buildFixedDayDate(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, targetDay);
}

export function findFirstTradingDateOnOrAfter(sortedDates, targetDate) {
  for (const date of sortedDates) {
    if (date >= targetDate) {
      return date;
    }
  }

  return null;
}

export function buildSyntheticCashBars(kodexBars, annualCashYield) {
  if (kodexBars.length === 0) {
    return [];
  }

  const bars = [];
  let lastClose = 100;

  for (let i = 0; i < kodexBars.length; i += 1) {
    const days = i === 0 ? 0 : dayDiff(kodexBars[i - 1].date, kodexBars[i].date);
    const growth = Math.pow(1 + annualCashYield, days / 365.2425);
    const open = lastClose;
    const close = i === 0 ? lastClose : lastClose * growth;

    bars.push({
      date: kodexBars[i].date,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      adjClose: close,
      adjOpen: open,
      adjHigh: Math.max(open, close),
      adjLow: Math.min(open, close),
      volume: 0
    });

    lastClose = close;
  }

  return bars;
}

export function alignKrBars(kodexBars, annualCashYield) {
  const cashBars = buildSyntheticCashBars(kodexBars, annualCashYield);
  return kodexBars.map((bar, index) => ({
    date: bar.date,
    kodex: bar,
    cash: cashBars[index]
  }));
}

export function buildSignalSeries(signalBars, signalMode) {
  const closes = signalBars.map((bar) => bar.adjClose);
  const sma200 = calculateSMA(closes, 200);
  const sma220 = calculateSMA(closes, 220);

  let invested = false;
  let armed = false;
  let breakoutCount = 0;
  let protectedExitDaysRemaining = 0;

  return signalBars.map((bar, index) => {
    const close = bar.adjClose;
    const sma200Value = sma200[index];
    const sma220Value = sma220[index];
    const hasBoth = sma200Value !== null && sma220Value !== null;
    const belowBoth = hasBoth && close < sma200Value && close < sma220Value;
    const aboveEarlyLine = hasBoth && close > Math.min(sma200Value, sma220Value);
    const above220Line = sma220Value !== null && close > sma220Value;

    if (signalMode.mode === "long-only") {
      invested = true;
    } else {
      const protectedExitActive =
        protectedExitDaysRemaining > 0 &&
        signalMode.whipsawExitSma === 220 &&
        sma220Value !== null;
      const exitLine = protectedExitActive ? sma220Value : sma200Value;

      if (invested && exitLine !== null && close < exitLine) {
        invested = false;
        armed = belowBoth;
        breakoutCount = 0;
        protectedExitDaysRemaining = 0;
      }

      if (!invested) {
        if (belowBoth) {
          armed = true;
          breakoutCount = 0;
        }

        if (signalMode.mode === "dual-both-entry") {
          if (armed && above220Line) {
            breakoutCount += 1;
          } else if (armed && !belowBoth) {
            breakoutCount = 0;
          }

          if (
            armed &&
            signalMode.confirmationDays > 0 &&
            breakoutCount >= signalMode.confirmationDays &&
            sma200Value !== null &&
            close > sma200Value
          ) {
            invested = true;
            armed = false;
            breakoutCount = 0;
            protectedExitDaysRemaining = signalMode.whipsawExitDays || 0;
          }
        } else {
          if (armed && aboveEarlyLine) {
            breakoutCount += 1;
          } else if (armed && !belowBoth) {
            breakoutCount = 0;
          }

          if (
            armed &&
            signalMode.confirmationDays > 0 &&
            breakoutCount >= signalMode.confirmationDays
          ) {
            invested = true;
            armed = false;
            breakoutCount = 0;
            protectedExitDaysRemaining = signalMode.whipsawExitDays || 0;
          }
        }
      }
    }

    const protectionDaysRemaining = invested ? protectedExitDaysRemaining : 0;
    const exitSmaUsed =
      invested && protectionDaysRemaining > 0 && signalMode.whipsawExitSma === 220 && sma220Value !== null
        ? 220
        : invested
          ? 200
          : null;

    if (invested && protectedExitDaysRemaining > 0) {
      protectedExitDaysRemaining -= 1;
    }

    return {
      date: bar.date,
      close,
      sma: sma200Value,
      sma200: sma200Value,
      sma220: sma220Value,
      invested,
      protectionDaysRemaining,
      exitSmaUsed
    };
  });
}

export function buildQqqReturnMap(qqqBars) {
  const map = new Map();
  for (let i = 1; i < qqqBars.length; i += 1) {
    map.set(qqqBars[i].date, qqqBars[i].adjClose / qqqBars[i - 1].adjClose - 1);
  }
  return map;
}

export function resolveKodexTradePrice({ mode, tradeSide, kodexBar, prevKodexBar, qqqReturn, slipRate }) {
  if (mode === "fair-value") {
    if (!prevKodexBar) {
      return kodexBar.adjOpen;
    }
    return prevKodexBar.adjClose * (1 + 2 * qqqReturn);
  }

  const basePrice = kodexBar.adjOpen;
  return tradeSide === "buy" ? basePrice * (1 + slipRate) : basePrice * (1 - slipRate);
}

export function resolveContributionTarget(latestSignal, allocationMode) {
  if (!latestSignal || !latestSignal.invested) {
    return "cash";
  }

  if (allocationMode.mode === "always-cash-when-risk-on") {
    return "cash";
  }

  if (allocationMode.mode === "risk-on-additions-sp500") {
    return "sp500";
  }

  if (allocationMode.mode === "always-risk") {
    return "kodex";
  }

  if (allocationMode.envelopePct === null || allocationMode.envelopePct === undefined) {
    return "kodex";
  }

  return latestSignal.close <= latestSignal.sma * (1 + allocationMode.envelopePct)
    ? "kodex"
    : "cash";
}
