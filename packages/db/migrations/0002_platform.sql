CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS model_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  reserved_micros bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenges_search ON challenge_versions USING GIN (to_tsvector('english', title || ' ' || brief));
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS grading_started_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS recovery_count int NOT NULL DEFAULT 0;
