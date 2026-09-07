-- Narm Pack vending machine — database schema (SQLite)

CREATE TABLE IF NOT EXISTS machines (
  id              TEXT PRIMARY KEY,        -- e.g. "machine-01" — also used as MQTT topic prefix
  name            TEXT NOT NULL,
  location        TEXT,
  last_heartbeat_at TEXT,                  -- ISO timestamp, updated by heartbeat feed
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compartments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id      TEXT NOT NULL REFERENCES machines(id),
  compartment_no  INTEGER NOT NULL,        -- 1-30
  product_name    TEXT NOT NULL,
  price           INTEGER NOT NULL,        -- stored in satang (บาท * 100) to avoid float issues
  status          TEXT NOT NULL DEFAULT 'available', -- available | sold | maintenance
  UNIQUE(machine_id, compartment_no)
);

CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,        -- order_id (uuid)
  compartment_id  INTEGER NOT NULL REFERENCES compartments(id),
  machine_id      TEXT NOT NULL REFERENCES machines(id),
  amount          INTEGER NOT NULL,        -- satang
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | paid | unlock_sent | unlocked | failed | expired
  payment_ref     TEXT,                    -- provider's own reference id
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at         TEXT,
  unlocked_at     TEXT
);

CREATE TABLE IF NOT EXISTS hardware_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id      TEXT NOT NULL,
  compartment_no  INTEGER,
  transaction_id  TEXT,
  event           TEXT NOT NULL,           -- unlock_sent | ack_ok | ack_fail | retry | manual_override | heartbeat
  detail          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'admin',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_machine ON transactions(machine_id);
CREATE INDEX IF NOT EXISTS idx_hardware_logs_machine ON hardware_logs(machine_id);
