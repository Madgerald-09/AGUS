CREATE TABLE IF NOT EXISTS workflow_state (
  id integer PRIMARY KEY CHECK (id = 1),
  revision integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_sessions (
  token_hash text PRIMARY KEY,
  operator_id text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  reset_at timestamptz NOT NULL
);
