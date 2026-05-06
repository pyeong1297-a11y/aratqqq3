const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS positions (
    strategy_key TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    entry_price REAL,
    shares REAL,
    active INTEGER NOT NULL DEFAULT 0,
    opened_at TEXT,
    closed_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_key TEXT NOT NULL,
    cycle_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    start_date TEXT NOT NULL,
    start_reason TEXT NOT NULL,
    start_price REAL,
    end_date TEXT,
    end_reason TEXT,
    end_price REAL,
    entry_price REAL,
    shares REAL,
    total_return REAL,
    realized_profit REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cycles_strategy_status
    ON cycles(strategy_key, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cycles_strategy_number
    ON cycles(strategy_key, cycle_number)`,
  `CREATE TABLE IF NOT EXISTS cycle_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id INTEGER,
    strategy_key TEXT NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    price REAL,
    gain_pct REAL,
    shares REAL,
    amount REAL,
    message TEXT,
    details TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (cycle_id) REFERENCES cycles(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cycle_events_cycle
    ON cycle_events(cycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cycle_events_strategy_date
    ON cycle_events(strategy_key, event_date)`,
  `CREATE TABLE IF NOT EXISTS alert_logs (
    alert_key TEXT PRIMARY KEY,
    strategy_key TEXT NOT NULL,
    cycle_id INTEGER,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
     message TEXT NOT NULL,
     sent_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trade_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id INTEGER,
    strategy_key TEXT NOT NULL,
    source_symbol TEXT NOT NULL,
    action_type TEXT NOT NULL,
    tp_label TEXT,
    trade_date TEXT NOT NULL,
    sell_shares REAL NOT NULL,
    sell_price REAL NOT NULL,
    sell_amount REAL NOT NULL,
    entry_price REAL,
    realized_profit REAL,
    realized_return REAL,
    replacement_symbol TEXT,
    replacement_shares REAL,
    replacement_price REAL,
    replacement_amount REAL,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (cycle_id) REFERENCES cycles(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trade_records_strategy_date
    ON trade_records(strategy_key, trade_date DESC, id DESC)`,
];

const STRATEGY_SYMBOLS = {
  tqqq: 'TQQQ',
  bulz: 'BULZ',
};

let schemaReady = false;

export async function ensureSchema(db) {
  if (!db) throw new Error('D1 DB binding is missing.');
  if (schemaReady) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady = true;
}

export function normalizeStrategyKey(strategyKey) {
  const key = `${strategyKey || ''}`.toLowerCase();
  if (!STRATEGY_SYMBOLS[key]) throw new Error(`Unsupported strategy: ${strategyKey}`);
  return key;
}

export async function listPositions(db) {
  await ensureSchema(db);
  const { results = [] } = await db.prepare(
    `SELECT strategy_key, symbol, entry_price, shares, active, opened_at, closed_at, updated_at
     FROM positions
     ORDER BY strategy_key`
  ).all();

  return results.map((row) => ({
    strategyKey: row.strategy_key,
    symbol: row.symbol,
    entryPrice: row.entry_price,
    shares: row.shares,
    active: row.active === 1,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    updatedAt: row.updated_at,
  }));
}

export async function getActivePositionsMap(db) {
  const positions = await listPositions(db);
  return new Map(positions.filter((position) => position.active).map((position) => [position.strategyKey, position]));
}

export async function upsertPosition(db, { strategyKey, entryPrice, shares }) {
  await ensureSchema(db);
  const key = normalizeStrategyKey(strategyKey);
  const symbol = STRATEGY_SYMBOLS[key];
  const now = new Date().toISOString();
  const entry = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : null;
  const qty = Number.isFinite(shares) && shares > 0 ? shares : null;
  const active = entry !== null || qty !== null ? 1 : 0;

  await db.prepare(
    `INSERT INTO positions (
       strategy_key, symbol, entry_price, shares, active, opened_at, closed_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(strategy_key) DO UPDATE SET
       entry_price = excluded.entry_price,
       shares = excluded.shares,
       active = excluded.active,
       opened_at = CASE
         WHEN positions.active = 0 AND excluded.active = 1 THEN excluded.opened_at
         ELSE positions.opened_at
       END,
       closed_at = CASE
         WHEN excluded.active = 1 THEN NULL
         ELSE positions.closed_at
       END,
       updated_at = excluded.updated_at`
  ).bind(key, symbol, entry, qty, active, now, now).run();

  return {
    strategyKey: key,
    symbol,
    entryPrice: entry,
    shares: qty,
    active: active === 1,
    updatedAt: now,
  };
}

export async function clearPosition(db, strategyKey) {
  await ensureSchema(db);
  const key = normalizeStrategyKey(strategyKey);
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO positions (
       strategy_key, symbol, entry_price, shares, active, opened_at, closed_at, updated_at
     ) VALUES (?, ?, NULL, NULL, 0, NULL, ?, ?)
     ON CONFLICT(strategy_key) DO UPDATE SET
       entry_price = NULL,
       shares = NULL,
       active = 0,
       closed_at = excluded.closed_at,
       updated_at = excluded.updated_at`
  ).bind(key, STRATEGY_SYMBOLS[key], now, now).run();

  return { strategyKey: key, active: false, updatedAt: now };
}

export async function getOpenCycle(db, strategyKey) {
  await ensureSchema(db);
  const key = normalizeStrategyKey(strategyKey);
  return await db.prepare(
    `SELECT *
     FROM cycles
     WHERE strategy_key = ? AND status = 'open'
     ORDER BY id DESC
     LIMIT 1`
  ).bind(key).first();
}

export async function createCycle(db, { strategyKey, startDate, startReason, startPrice, position }) {
  await ensureSchema(db);
  const key = normalizeStrategyKey(strategyKey);
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT COALESCE(MAX(cycle_number), 0) + 1 AS next_number
     FROM cycles
     WHERE strategy_key = ?`
  ).bind(key).first();
  const cycleNumber = Number(row?.next_number || 1);

  await db.prepare(
    `INSERT INTO cycles (
       strategy_key, cycle_number, status, start_date, start_reason, start_price,
       entry_price, shares, created_at, updated_at
     ) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    key,
    cycleNumber,
    startDate,
    startReason,
    startPrice ?? null,
    position?.entryPrice ?? null,
    position?.shares ?? null,
    now,
    now
  ).run();

  const created = await db.prepare(
    `SELECT * FROM cycles WHERE strategy_key = ? AND cycle_number = ?`
  ).bind(key, cycleNumber).first();

  return created;
}

export async function closeCycle(db, { cycle, endDate, endReason, endPrice, totalReturn = null, realizedProfit = null }) {
  await ensureSchema(db);
  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE cycles
     SET status = 'closed',
         end_date = ?,
         end_reason = ?,
         end_price = ?,
         total_return = ?,
         realized_profit = ?,
         updated_at = ?
     WHERE id = ? AND status = 'open'`
  ).bind(
    endDate,
    endReason,
    endPrice ?? null,
    totalReturn,
    realizedProfit,
    now,
    cycle.id
  ).run();
}

export async function insertEventIfNew(db, event) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  const result = await db.prepare(
    `INSERT OR IGNORE INTO cycle_events (
       cycle_id, strategy_key, event_key, event_type, event_date, price,
       gain_pct, shares, amount, message, details, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    event.cycleId ?? null,
    normalizeStrategyKey(event.strategyKey),
    event.eventKey,
    event.eventType,
    event.eventDate,
    event.price ?? null,
    event.gainPct ?? null,
    event.shares ?? null,
    event.amount ?? null,
    event.message ?? null,
    event.details ? JSON.stringify(event.details) : null,
    now
  ).run();

  return (result.meta?.changes || 0) > 0;
}

export async function insertAlertLog(db, alert) {
  await ensureSchema(db);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO alert_logs (
       alert_key, strategy_key, cycle_id, event_type, event_date, message, sent_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    alert.alertKey,
    normalizeStrategyKey(alert.strategyKey),
    alert.cycleId ?? null,
    alert.eventType,
    alert.eventDate,
    alert.message,
    now
  ).run();
}

function positiveOrNull(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeTradeRow(row) {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    strategyKey: row.strategy_key,
    sourceSymbol: row.source_symbol,
    actionType: row.action_type,
    tpLabel: row.tp_label,
    tradeDate: row.trade_date,
    sellShares: row.sell_shares,
    sellPrice: row.sell_price,
    sellAmount: row.sell_amount,
    entryPrice: row.entry_price,
    realizedProfit: row.realized_profit,
    realizedReturn: row.realized_return,
    replacementSymbol: row.replacement_symbol,
    replacementShares: row.replacement_shares,
    replacementPrice: row.replacement_price,
    replacementAmount: row.replacement_amount,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function listTradeRecords(db, strategyKey = null) {
  await ensureSchema(db);

  const key = strategyKey ? normalizeStrategyKey(strategyKey) : null;
  const statement = key
    ? db.prepare(
        `SELECT *
         FROM trade_records
         WHERE strategy_key = ?
         ORDER BY trade_date DESC, id DESC
         LIMIT 50`
      ).bind(key)
    : db.prepare(
        `SELECT *
         FROM trade_records
         ORDER BY trade_date DESC, id DESC
         LIMIT 100`
      );

  const { results = [] } = await statement.all();
  return results.map(normalizeTradeRow);
}

export async function recordTakeProfitTrade(db, input) {
  await ensureSchema(db);

  const key = normalizeStrategyKey(input.strategyKey);
  const symbol = STRATEGY_SYMBOLS[key];
  const sellShares = positiveOrNull(input.sellShares);
  const sellPrice = positiveOrNull(input.sellPrice);

  if (!sellShares) throw new Error('Sell shares must be greater than 0.');
  if (!sellPrice) throw new Error('Sell price must be greater than 0.');

  const position = await db.prepare(
    `SELECT strategy_key, symbol, entry_price, shares, active
     FROM positions
     WHERE strategy_key = ?`
  ).bind(key).first();

  const currentShares = positiveOrNull(position?.shares) || 0;
  if (sellShares > currentShares) {
    throw new Error('Sell shares exceed current position shares.');
  }

  const entryPrice = positiveOrNull(input.entryPrice) || positiveOrNull(position?.entry_price);
  const sellAmount = sellShares * sellPrice;
  const realizedProfit = entryPrice ? (sellPrice - entryPrice) * sellShares : null;
  const realizedReturn = entryPrice ? sellPrice / entryPrice - 1 : null;
  const replacementSymbol = `${input.replacementSymbol || 'SPYM'}`.trim().toUpperCase() || 'SPYM';
  const replacementShares = positiveOrNull(input.replacementShares);
  const replacementPrice = positiveOrNull(input.replacementPrice);
  const replacementAmount = replacementShares && replacementPrice
    ? replacementShares * replacementPrice
    : sellAmount;
  const tradeDate = input.tradeDate || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const cycle = await getOpenCycle(db, key);

  await db.prepare(
    `INSERT INTO trade_records (
       cycle_id, strategy_key, source_symbol, action_type, tp_label, trade_date,
       sell_shares, sell_price, sell_amount, entry_price, realized_profit, realized_return,
       replacement_symbol, replacement_shares, replacement_price, replacement_amount,
       notes, created_at
     ) VALUES (?, ?, ?, 'take_profit_rebuy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    cycle?.id ?? null,
    key,
    symbol,
    input.tpLabel || null,
    tradeDate,
    sellShares,
    sellPrice,
    sellAmount,
    entryPrice ?? null,
    realizedProfit,
    realizedReturn,
    replacementSymbol,
    replacementShares,
    replacementPrice,
    replacementAmount,
    input.notes || null,
    now
  ).run();

  const nextShares = Math.max(0, currentShares - sellShares);
  const active = nextShares > 0 ? 1 : 0;

  await db.prepare(
    `UPDATE positions
     SET shares = ?,
         active = ?,
         closed_at = CASE WHEN ? = 0 THEN ? ELSE NULL END,
         updated_at = ?
     WHERE strategy_key = ?`
  ).bind(nextShares, active, active, now, now, key).run();

  const saved = await db.prepare(
    `SELECT *
     FROM trade_records
     WHERE strategy_key = ?
     ORDER BY id DESC
     LIMIT 1`
  ).bind(key).first();

  return {
    record: normalizeTradeRow(saved),
    position: {
      strategyKey: key,
      symbol,
      entryPrice: entryPrice ?? null,
      shares: nextShares,
      active: active === 1,
      updatedAt: now,
    },
  };
}
