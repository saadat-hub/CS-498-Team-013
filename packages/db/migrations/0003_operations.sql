CREATE TABLE IF NOT EXISTS usage_daily (
  date date NOT NULL,
  purpose text NOT NULL,
  model text NOT NULL,
  calls bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_micros bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(date,purpose,model)
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_deduplication
  ON notifications(user_id,kind,(payload->>'dedupeKey'))
  WHERE payload ? 'dedupeKey';
