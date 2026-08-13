ALTER TABLE sessions ADD COLUMN white_identity_id TEXT;
ALTER TABLE sessions ADD COLUMN white_player TEXT;
ALTER TABLE sessions ADD COLUMN white_provider TEXT;
ALTER TABLE sessions ADD COLUMN white_model TEXT;
ALTER TABLE sessions ADD COLUMN black_identity_id TEXT;
ALTER TABLE sessions ADD COLUMN black_player TEXT;
ALTER TABLE sessions ADD COLUMN black_provider TEXT;
ALTER TABLE sessions ADD COLUMN black_model TEXT;

CREATE INDEX IF NOT EXISTS sessions_white_identity
  ON sessions (white_identity_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS sessions_black_identity
  ON sessions (black_identity_id, updated_at DESC);
