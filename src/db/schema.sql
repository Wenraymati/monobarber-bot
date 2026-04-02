CREATE TABLE IF NOT EXISTS availability (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  time         TEXT NOT NULL,
  is_available INTEGER DEFAULT 1,
  UNIQUE(date, time)
);

CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id        TEXT NOT NULL,
  client_name  TEXT,
  service_id   TEXT,
  date         TEXT NOT NULL,
  time         TEXT NOT NULL,
  status       TEXT DEFAULT 'confirmed',
  reminded_24h INTEGER DEFAULT 0,
  reminded_1h  INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  wa_id         TEXT PRIMARY KEY,
  state         TEXT DEFAULT 'IDLE',
  context_json  TEXT DEFAULT '{}',
  last_activity INTEGER,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
