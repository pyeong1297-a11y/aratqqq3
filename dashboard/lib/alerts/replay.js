import { getActivePositionsMap, hasAlertLog, insertAlertLog } from './db.js';
import { sendTelegramMessage } from './telegram.js';
import { loadAndSyncData } from '../csvLoader.js';
import { loadLiveQuotes } from '../live-quotes.js';
import { buildSignalDashboard } from '../signal-dashboard.js';

const DEFAULT_BASE_URL = 'https://aratqqq3final.pyeong1297.workers.dev';

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

function getKstDateKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function loadSignals(env, baseUrl = null) {
  const signalBaseUrl = baseUrl || env.SIGNALS_BASE_URL || DEFAULT_BASE_URL;
  const [tqqqBars, bulzBars, qqqBars, liveQuotes] = await Promise.all([
    loadAndSyncData('tqqq', { baseUrl: signalBaseUrl }),
    loadAndSyncData('bulz', { baseUrl: signalBaseUrl }),
    loadAndSyncData('qqq', { baseUrl: signalBaseUrl }),
    loadLiveQuotes(['TQQQ', 'BULZ', 'QQQ']),
  ]);

  return buildSignalDashboard({ tqqqBars, bulzBars, qqqBars, liveQuotes });
}

function buildBulzTp1ReplayMessage({ strategy, position, rule, markPrice, reason }) {
  const entryPrice = position?.entryPrice;
  const shares = position?.shares;
  const targetPrice = isFiniteNumber(entryPrice) && isFiniteNumber(rule?.threshold)
    ? entryPrice * (1 + rule.threshold)
    : null;
  const gainPct = isFiniteNumber(entryPrice) && isFiniteNumber(markPrice)
    ? markPrice / entryPrice - 1
    : null;
  const sellShares = isFiniteNumber(shares) && isFiniteNumber(rule?.sellFraction)
    ? shares * rule.sellFraction
    : null;
  const reached = isFiniteNumber(markPrice) && isFiniteNumber(targetPrice) && markPrice >= targetPrice;
  const label = reason === 'scheduled-1500' ? '15:00 KST 테스트 재전송' : '테스트 재전송';

  return [
    `[BULZ] TP1 도달 (${label})`,
    `날짜: ${strategy.updatedDate}`,
    `현재가: ${formatCurrency(markPrice)}`,
    `매수가: ${formatCurrency(entryPrice)}`,
    `수익률: ${formatPercent(gainPct, 2)}`,
    `기준: ${formatPercent(rule?.threshold, 0, false)} / ${formatCurrency(targetPrice)}`,
    `익절: 현재 보유량 ${formatPercent(rule?.sellFraction, 0, false)} 매도`,
    `예상 매도 수량: ${isFiniteNumber(sellShares) ? sellShares.toFixed(2) : '-'}`,
    `현재 기준: ${reached ? '도달' : '미도달'}`,
  ].join('\n');
}

export async function replayBulzTp1Alert({ env, baseUrl = null, reason = 'manual' }) {
  if (!env?.DB) {
    throw new Error('D1 DB binding is missing. Connect a D1 database with binding name DB.');
  }

  const [signals, positions] = await Promise.all([
    loadSignals(env, baseUrl),
    getActivePositionsMap(env.DB),
  ]);
  const strategy = signals.strategies?.bulz;
  const position = positions.get('bulz');
  const rule = strategy?.tpRules?.find((item) => item.label === 'TP1');
  const markPrice = isFiniteNumber(strategy?.markPrice) ? strategy.markPrice : strategy?.price;

  if (!strategy || !rule || !position) {
    return {
      ok: true,
      sent: false,
      skipped: true,
      reason: 'BULZ position or TP1 rule is missing.',
    };
  }

  const kstDate = getKstDateKey();
  const alertKey = reason === 'scheduled-1500'
    ? `replay:scheduled-1500:bulz:tp1:${kstDate}`
    : `replay:manual:bulz:tp1:${Date.now()}`;

  if (reason === 'scheduled-1500' && await hasAlertLog(env.DB, alertKey)) {
    return {
      ok: true,
      sent: false,
      skipped: true,
      reason: 'Replay already sent for this KST date.',
      alertKey,
    };
  }

  const message = buildBulzTp1ReplayMessage({ strategy, position, rule, markPrice, reason });
  await sendTelegramMessage({
    token: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    text: message,
  });

  await insertAlertLog(env.DB, {
    alertKey,
    strategyKey: 'bulz',
    cycleId: null,
    eventType: 'replay_bulz_tp1',
    eventDate: strategy.updatedDate || kstDate,
    message,
  });

  return {
    ok: true,
    sent: true,
    skipped: false,
    alertKey,
    generatedAt: signals.generatedAt,
    checkedAt: new Date().toISOString(),
  };
}
