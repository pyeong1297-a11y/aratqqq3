CREATE TABLE IF NOT EXISTS positions (
  strategy_key TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  entry_price REAL,
  shares REAL,
  active INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  closed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cycles (
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
);

CREATE INDEX IF NOT EXISTS idx_cycles_strategy_status
  ON cycles(strategy_key, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cycles_strategy_number
  ON cycles(strategy_key, cycle_number);

CREATE TABLE IF NOT EXISTS cycle_events (
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
);

CREATE INDEX IF NOT EXISTS idx_cycle_events_cycle
  ON cycle_events(cycle_id);

CREATE INDEX IF NOT EXISTS idx_cycle_events_strategy_date
  ON cycle_events(strategy_key, event_date);

CREATE TABLE IF NOT EXISTS alert_logs (
  alert_key TEXT PRIMARY KEY,
  strategy_key TEXT NOT NULL,
  cycle_id INTEGER,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_at TEXT NOT NULL
);
