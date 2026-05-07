import {
  closeCycle,
  createCycle,
  getActivePositionsMap,
  getOpenCycle,
  hasAlertLog,
  insertAlertLog,
  insertEventIfNew,
} from './db.js';
import { sendTelegramMessage } from './telegram.js';

const DEFAULT_BASE_URL = 'https://aratqqq3final.pyeong1297.workers.dev';

const STRATEGY_NAMES = {
  tqqq: '눈덩이 TQQQ',
  bulz: 'BULZ',
};

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function formatCurrency(value) {
  if (!isFiniteNumber(value)) return '-';
  const digits = Math.abs(value) >= 1000 ? 0 : 2;
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatPercent(value, decimals = 1, signed = true) {
  if (!isFiniteNumber(value)) return '-';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(decimals)}%`;
}

function formatTpThreshold(rule) {
  const base = formatPercent(rule.threshold, 0, false);
  if (!isFiniteNumber(rule.roundedThreshold) || rule.roundedThreshold === rule.threshold) {
    return base;
  }
  return `${base}(${formatPercent(rule.roundedThreshold, 0, false)})`;
}

function describeSellRule(rule) {
  if (rule.fullExit || rule.sellFraction >= 1) return '전액 익절';
  if (!isFiniteNumber(rule.sellFraction)) return '';

  const basis = rule.sellBasis === 'base' ? '기본 보유량' : '현재 보유량';
  const rounded = isFiniteNumber(rule.roundedSellFraction) && rule.roundedSellFraction !== rule.sellFraction
    ? `(${formatPercent(rule.roundedSellFraction, 0, false)})`
    : '';
  return `${basis} ${formatPercent(rule.sellFraction, 0, false)}${rounded} 익절`;
}

function getEventDate(strategy) {
  return strategy?.updatedDate || new Date().toISOString().slice(0, 10);
}

function getPositionSnapshot(position, cycle) {
  const entryPrice = isFiniteNumber(position?.entryPrice) ? position.entryPrice : cycle?.entry_price;
  const shares = isFiniteNumber(position?.shares) ? position.shares : cycle?.shares;
  return {
    entryPrice: isFiniteNumber(entryPrice) ? entryPrice : null,
    shares: isFiniteNumber(shares) ? shares : null,
  };
}

function calcGain(position, price) {
  if (!isFiniteNumber(position?.entryPrice) || !isFiniteNumber(price)) return null;
  return price / position.entryPrice - 1;
}

function calcProfit(position, price) {
  if (!isFiniteNumber(position?.entryPrice) || !isFiniteNumber(position?.shares) || !isFiniteNumber(price)) {
    return null;
  }
  return (price - position.entryPrice) * position.shares;
}

function getDip(strategy, key) {
  return strategy?.dipLevels?.find((level) => level.key === key) || null;
}

function isDipActive(strategy, key) {
  const level = getDip(strategy, key);
  return isFiniteNumber(strategy?.qqqPrice) && isFiniteNumber(level?.price) && strategy.qqqPrice <= level.price;
}

async function fetchSignals(env, preferredBaseUrl = null) {
  const baseUrls = [preferredBaseUrl, env.SIGNALS_BASE_URL, DEFAULT_BASE_URL]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  const errors = [];

  for (const baseUrl of baseUrls) {
    const url = new URL('/api/signals', baseUrl).toString();

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cf: { cacheTtl: 0, cacheEverything: false },
      });

      if (response.ok) {
        return await response.json();
      }

      errors.push(`${url} -> ${response.status}`);
    } catch (err) {
      errors.push(`${url} -> ${err.message}`);
    }
  }

  throw new Error(`Signal API failed: ${errors.join(', ')}`);
}

async function emitAlert(ctx, event) {
  const inserted = await insertEventIfNew(ctx.db, event);
  const alreadySent = inserted ? false : await hasAlertLog(ctx.db, event.eventKey);

  if (!inserted && alreadySent) {
    return { eventType: event.eventType, sent: false, skipped: true };
  }

  const result = {
    eventType: event.eventType,
    strategyKey: event.strategyKey,
    eventDate: event.eventDate,
    sent: false,
    skipped: false,
  };

  if (!ctx.telegramToken || !ctx.telegramChatId) {
    result.error = 'Telegram secrets are missing.';
    return result;
  }

  try {
    await sendTelegramMessage({
      token: ctx.telegramToken,
      chatId: ctx.telegramChatId,
      text: event.message,
    });
    await insertAlertLog(ctx.db, {
      alertKey: event.eventKey,
      strategyKey: event.strategyKey,
      cycleId: event.cycleId,
      eventType: event.eventType,
      eventDate: event.eventDate,
      message: event.message,
    });
    result.sent = true;
  } catch (err) {
    console.error('[signal-alert:telegram]', err);
    result.error = err.message;
  }

  return result;
}

async function emitTpAlerts(ctx, { strategyKey, strategy, cycle, position }) {
  const snapshot = getPositionSnapshot(position, cycle);
  if (!isFiniteNumber(snapshot.entryPrice) || !Array.isArray(strategy?.tpRules)) return;

  const events = [];
  const price = strategy.price;
  const eventDate = getEventDate(strategy);
  const gainPct = calcGain(snapshot, price);

  for (const rule of strategy.tpRules) {
    if (!isFiniteNumber(rule.threshold)) continue;
    const targetPrice = snapshot.entryPrice * (1 + rule.threshold);
    if (!isFiniteNumber(price) || price < targetPrice) continue;

    const label = (rule.label || 'TP').toLowerCase();
    const sellAmount = isFiniteNumber(snapshot.shares) && isFiniteNumber(rule.sellFraction)
      ? price * snapshot.shares * Math.min(rule.sellFraction, 1)
      : null;

    events.push(await emitAlert(ctx, {
      cycleId: cycle.id,
      strategyKey,
      eventKey: `${strategyKey}:${cycle.id}:${label}`,
      eventType: label,
      eventDate,
      price,
      gainPct,
      shares: snapshot.shares,
      amount: sellAmount,
      details: { rule, targetPrice },
      message: [
        `[${STRATEGY_NAMES[strategyKey]}] ${rule.label} 도달`,
        `날짜: ${eventDate}`,
        `현재가: ${formatCurrency(price)}`,
        `매수가: ${formatCurrency(snapshot.entryPrice)}`,
        `수익률: ${formatPercent(gainPct, 2)}`,
        `기준: ${formatTpThreshold(rule)} / ${formatCurrency(targetPrice)}`,
        `익절: ${describeSellRule(rule)}`,
      ].join('\n'),
    }));
  }

  return events;
}

async function processBulz(ctx, strategy, position) {
  const events = [];
  let cycle = await getOpenCycle(ctx.db, 'bulz');
  const eventDate = getEventDate(strategy);
  const price = strategy?.price;
  const aboveMa = isFiniteNumber(price) && isFiniteNumber(strategy?.ma200) && price > strategy.ma200;
  const confirmedBreakout = aboveMa && strategy.aboveStreak >= (strategy.confirmDays || 2);

  if (!cycle && confirmedBreakout) {
    cycle = await createCycle(ctx.db, {
      strategyKey: 'bulz',
      startDate: eventDate,
      startReason: 'ma200_breakout_2d',
      startPrice: price,
      position,
    });
  }

  if (!cycle) return events;

  if (confirmedBreakout) {
    events.push(await emitAlert(ctx, {
      cycleId: cycle.id,
      strategyKey: 'bulz',
      eventKey: `bulz:${cycle.id}:ma200_breakout`,
      eventType: 'ma200_breakout',
      eventDate,
      price,
      details: { ma200: strategy.ma200, aboveStreak: strategy.aboveStreak },
      message: [
        '[BULZ] 200일선 2일 돌파 / 매수 신호',
        `날짜: ${eventDate}`,
        `현재가: ${formatCurrency(price)}`,
        `200MA: ${formatCurrency(strategy.ma200)}`,
        `연속 상회: ${strategy.aboveStreak}거래일`,
      ].join('\n'),
    }));
  }

  events.push(...(await emitTpAlerts(ctx, {
    strategyKey: 'bulz',
    strategy,
    cycle,
    position,
  }) || []));

  if (!aboveMa && isFiniteNumber(strategy?.ma200)) {
    const snapshot = getPositionSnapshot(position, cycle);
    const totalReturn = calcGain(snapshot, price);
    const realizedProfit = calcProfit(snapshot, price);

    events.push(await emitAlert(ctx, {
      cycleId: cycle.id,
      strategyKey: 'bulz',
      eventKey: `bulz:${cycle.id}:ma200_breakdown`,
      eventType: 'ma200_breakdown',
      eventDate,
      price,
      gainPct: totalReturn,
      amount: realizedProfit,
      details: { ma200: strategy.ma200 },
      message: [
        '[BULZ] 200일선 이탈 / 사이클 종료',
        `날짜: ${eventDate}`,
        `현재가: ${formatCurrency(price)}`,
        `200MA: ${formatCurrency(strategy.ma200)}`,
        `수익률: ${formatPercent(totalReturn, 2)}`,
        `평가손익: ${formatCurrency(realizedProfit)}`,
      ].join('\n'),
    }));

    await closeCycle(ctx.db, {
      cycle,
      endDate: eventDate,
      endReason: 'ma200_breakdown',
      endPrice: price,
      totalReturn,
      realizedProfit,
    });
  }

  return events;
}

async function processTqqq(ctx, strategy, position) {
  const events = [];
  let cycle = await getOpenCycle(ctx.db, 'tqqq');
  const eventDate = getEventDate(strategy);
  const price = strategy?.price;
  const dip1 = getDip(strategy, 'dip1');
  const dip2 = getDip(strategy, 'dip2');
  const dip1Active = isDipActive(strategy, 'dip1');
  const dip2Active = isDipActive(strategy, 'dip2');

  if (!cycle && (dip1Active || strategy?.goldCross)) {
    cycle = await createCycle(ctx.db, {
      strategyKey: 'tqqq',
      startDate: eventDate,
      startReason: dip1Active ? 'dip1' : 'gold_cross',
      startPrice: price,
      position,
    });
  }

  if (!cycle) return events;

  if (dip1Active) {
    events.push(await emitAlert(ctx, {
      cycleId: cycle.id,
      strategyKey: 'tqqq',
      eventKey: `tqqq:${cycle.id}:dip1`,
      eventType: 'dip1',
      eventDate,
      price,
      details: { qqqPrice: strategy.qqqPrice, qqqDrawdown: strategy.qqqDrawdown, dipPrice: dip1?.price },
      message: [
        '[눈덩이 TQQQ] DIP1 매수 신호',
        `날짜: ${eventDate}`,
        `TQQQ: ${formatCurrency(price)}`,
        `${strategy.qqqBasis}: ${formatCurrency(strategy.qqqPrice)}`,
        `DIP1 기준: ${formatCurrency(dip1?.price)}`,
        `낙폭: ${formatPercent(strategy.qqqDrawdown, 1)}`,
      ].join('\n'),
    }));
  }

  if (dip2Active) {
    events.push(await emitAlert(ctx, {
      cycleId: cycle.id,
      strategyKey: 'tqqq',
      eventKey: `tqqq:${cycle.id}:dip2`,
      eventType: 'dip2',
      eventDate,
      price,
      details: { qqqPrice: strategy.qqqPrice, qqqDrawdown: strategy.qqqDrawdown, dipPrice: dip2?.price },
      message: [
        '[눈덩이 TQQQ] DIP2 추가 매수 신호',
        `날짜: ${eventDate}`,
        `TQQQ: ${formatCurrency(price)}`,
        `${strategy.qqqBasis}: ${formatCurrency(strategy.qqqPrice)}`,
        `DIP2 기준: ${formatCurrency(dip2?.price)}`,
        `낙폭: ${formatPercent(strategy.qqqDrawdown, 1)}`,
      ].join('\n'),
    }));
  }

  if (strategy?.goldCross) {
    events.push(await emitAlert(ctx, {
      cycleId: cycle.id,
      strategyKey: 'tqqq',
      eventKey: `tqqq:${cycle.id}:gold_cross`,
      eventType: 'gold_cross',
      eventDate,
      price,
      details: { ma5: strategy.ma5, ma220: strategy.ma220 },
      message: [
        '[눈덩이 TQQQ] 골든크로스 / 매수 신호',
        `날짜: ${eventDate}`,
        `현재가: ${formatCurrency(price)}`,
        `5MA: ${formatCurrency(strategy.ma5)}`,
        `220MA: ${formatCurrency(strategy.ma220)}`,
      ].join('\n'),
    }));
  }

  events.push(...(await emitTpAlerts(ctx, {
    strategyKey: 'tqqq',
    strategy,
    cycle,
    position,
  }) || []));

  if (strategy?.deadCross) {
    const snapshot = getPositionSnapshot(position, cycle);
    const totalReturn = calcGain(snapshot, price);
    const realizedProfit = calcProfit(snapshot, price);

    events.push(await emitAlert(ctx, {
      cycleId: cycle.id,
      strategyKey: 'tqqq',
      eventKey: `tqqq:${cycle.id}:dead_cross`,
      eventType: 'dead_cross',
      eventDate,
      price,
      gainPct: totalReturn,
      amount: realizedProfit,
      details: { ma5: strategy.ma5, ma220: strategy.ma220 },
      message: [
        '[눈덩이 TQQQ] 데드크로스 / 사이클 종료',
        `날짜: ${eventDate}`,
        `현재가: ${formatCurrency(price)}`,
        `5MA: ${formatCurrency(strategy.ma5)}`,
        `220MA: ${formatCurrency(strategy.ma220)}`,
        `수익률: ${formatPercent(totalReturn, 2)}`,
        `평가손익: ${formatCurrency(realizedProfit)}`,
      ].join('\n'),
    }));

    await closeCycle(ctx.db, {
      cycle,
      endDate: eventDate,
      endReason: 'dead_cross',
      endPrice: price,
      totalReturn,
      realizedProfit,
    });
  }

  return events;
}

export async function runSignalAlerts({ env, baseUrl = null }) {
  if (!env?.DB) {
    throw new Error('D1 DB binding is missing. Connect a D1 database with binding name DB.');
  }

  const [signals, positions] = await Promise.all([
    fetchSignals(env, baseUrl),
    getActivePositionsMap(env.DB),
  ]);

  const ctx = {
    db: env.DB,
    telegramToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
  };

  const events = [
    ...(await processTqqq(ctx, signals.strategies?.tqqq, positions.get('tqqq'))),
    ...(await processBulz(ctx, signals.strategies?.bulz, positions.get('bulz'))),
  ];

  return {
    ok: true,
    generatedAt: signals.generatedAt,
    checkedAt: new Date().toISOString(),
    events,
  };
}
