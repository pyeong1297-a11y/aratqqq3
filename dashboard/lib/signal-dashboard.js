const SNOWBALL_TP_RULES = [
  {
    label: 'TP1',
    threshold: 0.37,
    sellFraction: 0.53,
    roundedThreshold: 0.35,
    roundedSellFraction: 0.5,
    sellBasis: 'base',
  },
  {
    label: 'TP2',
    threshold: 0.87,
    sellFraction: 0.47,
    roundedThreshold: 0.85,
    roundedSellFraction: 0.5,
    sellBasis: 'base',
  },
  {
    label: 'TP3',
    threshold: 3.55,
    sellFraction: 1,
    fullExit: true,
  },
];

const BULZ_TP_RULES = [
  {
    label: 'TP1',
    threshold: 0.5,
    sellFraction: 0.1,
    sellBasis: 'current',
  },
  {
    label: 'TP2',
    threshold: 1.0,
    sellFraction: 1,
    fullExit: true,
  },
];

const SNOWBALL_SETTINGS = {
  dip1Drawdown: -0.11,
  dip2Drawdown: -0.22,
  tp1Threshold: SNOWBALL_TP_RULES[0].threshold,
  tp2Threshold: SNOWBALL_TP_RULES[1].threshold,
  tp3Threshold: SNOWBALL_TP_RULES[2].threshold,
  gcShort: 5,
  gcLong: 220,
  qqqLookbackDays: 252,
  rsiPeriod: 14,
};

const BULZ_SETTINGS = {
  confirmDays: 2,
  smaPeriod: 200,
  tpRules: BULZ_TP_RULES,
};

function calcSMA(values, period) {
  const result = new Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }

  return result;
}

function lastItem(items) {
  return items[items.length - 1] || null;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function calcRSI(values, period) {
  const rsi = new Array(values.length).fill(null);
  if (values.length <= period) return rsi;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }

  avgGain /= period;
  avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

function calcRollingHigh(values, period) {
  return values.map((_, index) => {
    const start = Math.max(0, index - period + 1);
    let high = -Infinity;
    for (let i = start; i <= index; i++) {
      if (Number.isFinite(values[i]) && values[i] > high) high = values[i];
    }
    return high > 0 ? high : null;
  });
}

function findIndexOnOrBefore(bars, date) {
  let lo = 0;
  let hi = bars.length - 1;
  let answer = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return answer;
}

function aboveStreak(closes, movingAverage) {
  let streak = 0;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (movingAverage[i] === null || closes[i] <= movingAverage[i]) break;
    streak += 1;
  }
  return streak;
}

function downsample(items, maxPoints) {
  if (items.length <= maxPoints) return items;
  const step = Math.ceil(items.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < items.length; i += step) sampled.push(items[i]);
  if (sampled[sampled.length - 1] !== items[items.length - 1]) sampled.push(items[items.length - 1]);
  return sampled;
}

function buildChart(bars, seriesMap, range = 180) {
  const start = Math.max(0, bars.length - range);
  const rows = [];

  for (let i = start; i < bars.length; i++) {
    const row = {
      date: bars[i].date,
      price: finiteOrNull(bars[i].adjClose),
    };

    for (const [key, values] of Object.entries(seriesMap)) {
      row[key] = finiteOrNull(values[i]);
    }

    rows.push(row);
  }

  return downsample(rows, 160);
}

function changeFromPrevious(bars) {
  if (bars.length < 2) return null;
  const current = bars[bars.length - 1].adjClose;
  const previous = bars[bars.length - 2].adjClose;
  return previous > 0 ? current / previous - 1 : null;
}

function buildBulzSignal(bars) {
  if (!bars.length) throw new Error('BULZ price data is unavailable.');

  const closes = bars.map((bar) => bar.adjClose);
  const sma200 = calcSMA(closes, BULZ_SETTINGS.smaPeriod);
  const latest = lastItem(bars);
  const latestIndex = bars.length - 1;
  const price = latest.adjClose;
  const ma200Value = sma200[latestIndex];
  const distanceToMa = ma200Value ? price / ma200Value - 1 : null;
  const streak = aboveStreak(closes, sma200);
  const isAbove = ma200Value !== null && price > ma200Value;

  let status = {
    label: '데이터 부족',
    tone: 'neutral',
    detail: '200일선 계산 대기',
  };

  if (ma200Value !== null && !isAbove) {
    status = {
      label: '대기 / 청산',
      tone: 'danger',
      detail: 'BULZ가 200일선 아래',
    };
  } else if (streak >= BULZ_SETTINGS.confirmDays) {
    status = {
      label: '매수 / 보유',
      tone: 'positive',
      detail: `${streak}거래일 연속 200일선 상회`,
    };
  } else if (isAbove) {
    status = {
      label: '확인 중',
      tone: 'watch',
      detail: `${BULZ_SETTINGS.confirmDays - streak}거래일 추가 확인`,
    };
  }

  return {
    key: 'bulz',
    symbol: 'BULZ',
    title: 'BULZ 200MA',
    updatedDate: latest.date,
    price,
    previousChange: changeFromPrevious(bars),
    ma200: ma200Value,
    distanceToMa,
    aboveStreak: streak,
    confirmDays: BULZ_SETTINGS.confirmDays,
    tpRules: BULZ_SETTINGS.tpRules,
    tpThresholds: BULZ_SETTINGS.tpRules.map((rule) => rule.threshold),
    status,
    metrics: [
      { label: '현재가', value: price, type: 'currency' },
      { label: '200일선', value: ma200Value, type: 'currency' },
      { label: '200MA 괴리', value: distanceToMa, type: 'percent' },
      { label: '연속 상회', value: streak, suffix: '일' },
    ],
    chart: buildChart(bars, { ma200: sma200 }),
  };
}

function buildSnowballSignal(tqqqBars, qqqBars) {
  if (!tqqqBars.length) throw new Error('TQQQ price data is unavailable.');

  const qqqSource = qqqBars.length ? qqqBars : tqqqBars;
  const qqqBasis = qqqBars.length ? 'QQQ' : 'TQQQ proxy';
  const tqqqCloses = tqqqBars.map((bar) => bar.adjClose);
  const tqqqLatest = lastItem(tqqqBars);
  const tqqqLatestIndex = tqqqBars.length - 1;

  const sma5 = calcSMA(tqqqCloses, SNOWBALL_SETTINGS.gcShort);
  const sma200 = calcSMA(tqqqCloses, 200);
  const sma220 = calcSMA(tqqqCloses, SNOWBALL_SETTINGS.gcLong);
  const rsi = calcRSI(tqqqCloses, SNOWBALL_SETTINGS.rsiPeriod);

  const qqqIndex = findIndexOnOrBefore(qqqSource, tqqqLatest.date);
  const qqqHighs = qqqSource.map((bar) => bar.adjHigh || bar.adjClose);
  const qqqRollingHighs = calcRollingHigh(qqqHighs, SNOWBALL_SETTINGS.qqqLookbackDays);
  const qqqBar = qqqSource[Math.max(0, qqqIndex)];
  const qqqRollingHigh = qqqRollingHighs[Math.max(0, qqqIndex)];
  const qqqCurrentHigh = qqqBar?.adjHigh || qqqBar?.adjClose || null;
  const qqqPrice = qqqBar?.adjClose || null;
  const qqqDrawdown = qqqRollingHigh && qqqCurrentHigh
    ? qqqCurrentHigh / qqqRollingHigh - 1
    : null;

  const ma5Value = sma5[tqqqLatestIndex];
  const ma220Value = sma220[tqqqLatestIndex];
  const prevMa5 = sma5[tqqqLatestIndex - 1];
  const prevMa220 = sma220[tqqqLatestIndex - 1];
  const goldCross = prevMa5 !== null && prevMa220 !== null && ma5Value !== null && ma220Value !== null && prevMa5 <= prevMa220 && ma5Value > ma220Value;
  const deadCross = prevMa5 !== null && prevMa220 !== null && ma5Value !== null && ma220Value !== null && prevMa5 >= prevMa220 && ma5Value < ma220Value;

  let status = {
    label: '현금 대기',
    tone: 'neutral',
    detail: '5MA가 220MA 아래',
  };

  if (deadCross) {
    status = {
      label: 'DC 청산',
      tone: 'danger',
      detail: '5MA가 220MA 아래로 전환',
    };
  } else if (qqqDrawdown !== null && qqqDrawdown <= SNOWBALL_SETTINGS.dip2Drawdown) {
    status = {
      label: 'DIP2 매수권',
      tone: 'action',
      detail: `${qqqBasis} 고점 대비 깊은 조정`,
    };
  } else if (qqqDrawdown !== null && qqqDrawdown <= SNOWBALL_SETTINGS.dip1Drawdown) {
    status = {
      label: 'DIP1 매수권',
      tone: 'watch',
      detail: `${qqqBasis} 고점 대비 조정`,
    };
  } else if (goldCross) {
    status = {
      label: 'GC 매수',
      tone: 'positive',
      detail: '5MA가 220MA 위로 전환',
    };
  } else if (ma5Value !== null && ma220Value !== null && ma5Value > ma220Value) {
    status = {
      label: '추세 보유',
      tone: 'positive',
      detail: '5MA가 220MA 위',
    };
  }

  return {
    key: 'tqqq',
    symbol: 'TQQQ',
    title: '눈덩이 TQQQ',
    updatedDate: tqqqLatest.date,
    price: tqqqLatest.adjClose,
    previousChange: changeFromPrevious(tqqqBars),
    ma5: ma5Value,
    ma200: sma200[tqqqLatestIndex],
    ma220: ma220Value,
    rsi: rsi[tqqqLatestIndex],
    qqqBasis,
    qqqPrice,
    qqqRollingHigh,
    qqqDrawdown,
    dipLevels: [
      {
        key: 'dip1',
        label: 'DIP1',
        drawdown: SNOWBALL_SETTINGS.dip1Drawdown,
        price: qqqRollingHigh ? qqqRollingHigh * (1 + SNOWBALL_SETTINGS.dip1Drawdown) : null,
      },
      {
        key: 'dip2',
        label: 'DIP2',
        drawdown: SNOWBALL_SETTINGS.dip2Drawdown,
        price: qqqRollingHigh ? qqqRollingHigh * (1 + SNOWBALL_SETTINGS.dip2Drawdown) : null,
      },
    ],
    tpRules: SNOWBALL_TP_RULES,
    tpThresholds: SNOWBALL_TP_RULES.map((rule) => rule.threshold),
    goldCross,
    deadCross,
    status,
    metrics: [
      { label: 'TQQQ 현재가', value: tqqqLatest.adjClose, type: 'currency' },
      { label: 'TQQQ 200일선', value: sma200[tqqqLatestIndex], type: 'currency' },
      { label: '5MA / 220MA', value: ma5Value, secondValue: ma220Value, type: 'currencyPair' },
      { label: `${qqqBasis} 낙폭`, value: qqqDrawdown, type: 'percent' },
      { label: 'RSI', value: rsi[tqqqLatestIndex], decimals: 1 },
    ],
    chart: buildChart(tqqqBars, { ma5: sma5, ma220: sma220, ma200: sma200 }),
  };
}

function attachLiveQuote(strategy, liveQuote) {
  if (!liveQuote) {
    return {
      ...strategy,
      markPrice: strategy.price,
      markChange: strategy.previousChange,
      markPriceLabel: '종가',
    };
  }

  return {
    ...strategy,
    liveQuote,
    markPrice: finiteOrNull(liveQuote.price) ?? strategy.price,
    markChange: finiteOrNull(liveQuote.changePercent) ?? strategy.previousChange,
    markPriceLabel: liveQuote.label || '현재가',
  };
}

export function buildSignalDashboard({ tqqqBars, bulzBars, qqqBars, liveQuotes = {} }) {
  const snowball = attachLiveQuote(buildSnowballSignal(tqqqBars, qqqBars), liveQuotes.tqqq);
  const bulz = attachLiveQuote(buildBulzSignal(bulzBars), liveQuotes.bulz);

  return {
    generatedAt: new Date().toISOString(),
    strategies: {
      tqqq: snowball,
      bulz,
    },
  };
}
