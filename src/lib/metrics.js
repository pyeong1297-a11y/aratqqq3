export function calculateSMA(values, period) {
  const result = new Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }

  return result;
}

export function intersectBars(seriesMap) {
  const entries = Object.entries(seriesMap);
  if (entries.length === 0) {
    return [];
  }

  const dateSets = entries.map(([, bars]) => new Set(bars.map((bar) => bar.date)));
  const commonDates = entries[0][1]
    .map((bar) => bar.date)
    .filter((date) => dateSets.every((set) => set.has(date)));

  return commonDates.map((date) => {
    const item = { date };
    for (const [key, bars] of entries) {
      item[key] = bars.find((bar) => bar.date === date);
    }
    return item;
  });
}

export function buildDateIndex(bars) {
  return new Map(bars.map((bar, index) => [bar.date, index]));
}

export function findLatestIndexBefore(sortedDates, targetDate) {
  let lo = 0;
  let hi = sortedDates.length - 1;
  let answer = -1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sortedDates[mid] < targetDate) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return answer;
}

export function calculateMaxDrawdown(values) {
  let peak = -Infinity;
  let maxDrawdown = 0;

  for (const value of values) {
    if (value > peak) {
      peak = value;
    }

    if (peak > 0) {
      const drawdown = value / peak - 1;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  return maxDrawdown;
}

export function calculateCagr(startValue, endValue, startDate, endDate) {
  if (startValue <= 0 || endValue <= 0) {
    return null;
  }

  const days = Math.max(
    1,
    Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000)
  );
  const years = days / 365.2425;
  return years <= 0 ? null : (endValue / startValue) ** (1 / years) - 1;
}

export function calculateWinRate(trades) {
  if (trades.length === 0) {
    return 0;
  }

  const wins = trades.filter((trade) => trade.pnl > 0).length;
  return wins / trades.length;
}

export function average(values) {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}
