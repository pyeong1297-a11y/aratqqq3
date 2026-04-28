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

  for (let index = 0; index < kodexBars.length; index += 1) {
    const days = index === 0 ? 0 : dayDiff(kodexBars[index - 1].date, kodexBars[index].date);
    const growth = Math.pow(1 + annualCashYield, days / 365.2425);
    const open = lastClose;
    const close = index === 0 ? lastClose : lastClose * growth;

    bars.push({
      date: kodexBars[index].date,
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
    const has200 = sma200Value !== null;
    const has220 = sma220Value !== null;
    const below200 = has200 && close < sma200Value;
    const above200 = has200 && close > sma200Value;
    const below220 = has220 && close < sma220Value;
    const above220 = has220 && close > sma220Value;
    const belowBoth = has200 && has220 && below200 && below220;
    const exitLine =
      invested &&
      protectedExitDaysRemaining > 0 &&
      signalMode.whipsawExitSma === 220 &&
      has220
        ? sma220Value
        : sma200Value;

    if (invested && exitLine !== null && close < exitLine) {
      invested = false;
      armed = signalMode.mode === "dual-both-entry" ? belowBoth : below200;
      breakoutCount = 0;
      protectedExitDaysRemaining = 0;
    }

    if (!invested) {
      if (signalMode.mode === "sma200-entry") {
        if (below200) {
          armed = true;
          breakoutCount = 0;
        }

        if (armed && above200) {
          breakoutCount += 1;
        } else if (armed && !below200) {
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
      } else if (signalMode.mode === "dual-both-entry") {
        if (belowBoth) {
          armed = true;
          breakoutCount = 0;
        }

        if (armed && above220) {
          breakoutCount += 1;
        } else if (armed && !belowBoth) {
          breakoutCount = 0;
        }

        if (
          armed &&
          signalMode.confirmationDays > 0 &&
          breakoutCount >= signalMode.confirmationDays &&
          above200
        ) {
          invested = true;
          armed = false;
          breakoutCount = 0;
          protectedExitDaysRemaining = signalMode.whipsawExitDays || 0;
        }
      } else {
        throw new Error(`Unsupported ISA signal mode: ${signalMode.mode}`);
      }
    }

    const protectionDaysRemaining = invested ? protectedExitDaysRemaining : 0;
    const exitSmaUsed =
      invested &&
      protectionDaysRemaining > 0 &&
      signalMode.whipsawExitSma === 220 &&
      has220
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
  for (let index = 1; index < qqqBars.length; index += 1) {
    map.set(qqqBars[index].date, qqqBars[index].adjClose / qqqBars[index - 1].adjClose - 1);
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

export function resolveContributionTarget(latestSignal) {
  if (!latestSignal || !latestSignal.invested) {
    return "cash";
  }

  return "sp500";
}
