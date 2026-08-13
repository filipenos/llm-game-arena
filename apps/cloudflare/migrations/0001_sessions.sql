CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  status TEXT NOT NULL,
  white_name TEXT,
  black_name TEXT,
  winner TEXT,
  finish_reason TEXT,
  ply INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS sessions_status_updated_at
  ON sessions (status, updated_at DESC);
