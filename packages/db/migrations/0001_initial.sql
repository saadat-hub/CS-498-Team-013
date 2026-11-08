CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Users & auth ────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('learner', 'author', 'admin');

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE NOT NULL,
  email_verified  timestamptz,
  display_name    text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  handle          citext UNIQUE NOT NULL CHECK (handle ~ '^[a-z0-9_]{3,20}$'),
  avatar_url      text,
  role            user_role NOT NULL DEFAULT 'learner',
  timezone        text NOT NULL DEFAULT 'UTC',          -- IANA name, validated in app
  leaderboard_opt_in boolean NOT NULL DEFAULT true,
  banned_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz                            -- soft delete; purge job hard-deletes after 30 days
);

CREATE TABLE accounts (                                  -- OAuth links (Auth.js shape)
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text NOT NULL,                     -- 'github' | 'google' | 'email'
  provider_account_id text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE sessions (
  id            text PRIMARY KEY,                        -- random 32 bytes, base64url; store SHA-256 hash if you prefer
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  user_agent    text,
  ip_hash       text
);
CREATE INDEX ON sessions (user_id);

CREATE TABLE verification_tokens (                       -- magic links
  identifier  citext NOT NULL,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (identifier, token_hash)
);

-- ── Content ─────────────────────────────────────────────────────
CREATE TABLE levels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,                      -- 'say-what-you-want'
  position    int  UNIQUE NOT NULL,                      -- 1..5
  code        text NOT NULL,                             -- '01'
  name        text NOT NULL,
  blurb       text NOT NULL,
  tip         text NOT NULL,
  accent      text NOT NULL DEFAULT 'lime',              -- 'lime' | 'cyan' (UI token, not a hex)
  unlock_rule jsonb NOT NULL DEFAULT '{"type":"none"}',  -- see 10.5
  published   boolean NOT NULL DEFAULT true
);

CREATE TABLE challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,                    -- 'hello-function'
  level_id      uuid NOT NULL REFERENCES levels(id),
  position      int  NOT NULL,                           -- order inside the level (1-based)
  current_version_id uuid,                               -- FK added below
  published     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (level_id, position)
);

CREATE TABLE challenge_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  version       int  NOT NULL,
  title         text NOT NULL,
  brief         text NOT NULL,
  hint          text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',            -- 'token-budget','must-include','format-lock',...
  token_budget  int  NOT NULL CHECK (token_budget BETWEEN 1 AND 4000),
  xp            int  NOT NULL CHECK (xp BETWEEN 0 AND 10000),
  difficulty    smallint NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
  context       jsonb NOT NULL DEFAULT '{}',             -- extra material shown to learner (e.g., an error log, a prior AI answer)
  run_config    jsonb,                                   -- null = prompt is never sent to a model (see 9.4)
  content_hash  text NOT NULL,                           -- sha256 of the source YAML; sync skips unchanged
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, version)
);
ALTER TABLE challenges
  ADD CONSTRAINT challenges_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES challenge_versions(id);

CREATE TYPE check_type AS ENUM (
  'token_budget', 'must_include', 'must_exclude', 'regex', 'min_length',
  'output_format', 'output_contains', 'llm_judge', 'code_tests', 'revision_scope'
);
CREATE TYPE check_phase AS ENUM ('instant', 'model');      -- instant = no model call

CREATE TABLE challenge_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_version_id uuid NOT NULL REFERENCES challenge_versions(id) ON DELETE CASCADE,
  key                 text NOT NULL,                     -- stable id inside the challenge: 'names-language'
  position            int  NOT NULL,
  type                check_type NOT NULL,
  phase               check_phase NOT NULL,
  label               text NOT NULL,                     -- shown in the UI: 'Names the language (Python)'
  config              jsonb NOT NULL,                    -- shape depends on type (section 9)
  client_visible      boolean NOT NULL DEFAULT true,     -- false = hidden test; UI shows label only after submit
  weight              real NOT NULL DEFAULT 1.0,
  required            boolean NOT NULL DEFAULT true,     -- all required checks must pass
  UNIQUE (challenge_version_id, key),
  UNIQUE (challenge_version_id, position)
);

-- ── Learner work ────────────────────────────────────────────────
CREATE TABLE drafts (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id  uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  prompt        text NOT NULL CHECK (char_length(prompt) <= 20000),
  token_estimate int NOT NULL DEFAULT 0,
  instant_passed int NOT NULL DEFAULT 0,                 -- how many instant checks pass (for "2 of 4 checks")
  instant_total  int NOT NULL DEFAULT 0,
  rev           int NOT NULL DEFAULT 1,                  -- optimistic concurrency
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, challenge_id)
);
CREATE INDEX drafts_recent ON drafts (user_id, updated_at DESC);

CREATE TYPE submission_status AS ENUM ('queued', 'grading', 'passed', 'failed', 'error');

CREATE TABLE submissions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id         uuid NOT NULL REFERENCES challenges(id),
  challenge_version_id uuid NOT NULL REFERENCES challenge_versions(id),
  idempotency_key      text NOT NULL,
  prompt               text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 20000),
  prompt_sha256        text NOT NULL,
  token_count          int  NOT NULL,                    -- exact, from the provider
  token_counter        text NOT NULL,                    -- 'anthropic:<model>' or 'estimate:v1' (fallback)
  token_budget         int  NOT NULL,                    -- copied from the version at submit time
  status               submission_status NOT NULL DEFAULT 'queued',
  passed               boolean,
  score                real,                             -- 0..1, weighted
  model_output         text,                             -- truncated to 50k chars
  model_output_tokens  int,
  model_name           text,
  error_code           text,
  xp_awarded           int NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  graded_at            timestamptz,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX submissions_user_recent ON submissions (user_id, created_at DESC);
CREATE INDEX submissions_user_challenge ON submissions (user_id, challenge_id, created_at DESC);
CREATE INDEX submissions_status ON submissions (status) WHERE status IN ('queued','grading');

CREATE TABLE submission_check_results (
  submission_id  uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  check_key      text NOT NULL,
  type           check_type NOT NULL,
  label          text NOT NULL,
  passed         boolean NOT NULL,
  score          real NOT NULL,                          -- 0..1
  message        text,                                   -- short, learner-facing
  details        jsonb NOT NULL DEFAULT '{}',            -- matched terms, judge rationale, test output...
  duration_ms    int,
  PRIMARY KEY (submission_id, check_key)
);

CREATE TYPE progress_status AS ENUM ('not_started', 'in_progress', 'cleared');

CREATE TABLE progress (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id     uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  status           progress_status NOT NULL DEFAULT 'in_progress',
  attempts         int NOT NULL DEFAULT 0,
  best_token_count int,                                  -- lowest token count among passing submissions
  first_cleared_at timestamptz,
  first_cleared_submission_id uuid REFERENCES submissions(id),
  last_attempt_at  timestamptz,
  PRIMARY KEY (user_id, challenge_id)
);
CREATE INDEX progress_user_status ON progress (user_id, status);

-- ── Gamification ────────────────────────────────────────────────
CREATE TYPE xp_reason AS ENUM ('challenge_clear', 'daily_bonus', 'efficiency_bonus', 'badge', 'admin_adjust');

CREATE TABLE xp_events (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        int  NOT NULL,                           -- may be negative only for admin_adjust
  reason        xp_reason NOT NULL,
  challenge_id  uuid REFERENCES challenges(id),
  submission_id uuid REFERENCES submissions(id),
  badge_id      uuid,
  dedupe_key    text NOT NULL,                           -- e.g. 'clear:<user>:<challenge>'
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)                           -- makes awards idempotent
);
CREATE INDEX xp_user_time ON xp_events (user_id, created_at DESC);
CREATE INDEX xp_time ON xp_events (created_at);

CREATE TABLE user_stats (                                -- denormalized; rebuilt by job if drift
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp         int NOT NULL DEFAULT 0,
  cleared_count    int NOT NULL DEFAULT 0,
  current_streak   int NOT NULL DEFAULT 0,
  best_streak      int NOT NULL DEFAULT 0,
  last_active_date date,                                 -- in the user's timezone
  avg_budget_used  real,                                 -- mean(token_count/token_budget) over first clears
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE badges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,                      -- 'under-budget-5'
  name        text NOT NULL,                             -- 'Under budget ×5'
  mark        text NOT NULL,                             -- short glyph shown in the tile: '≤', '{ }', 'err'
  description text NOT NULL,
  rule        jsonb NOT NULL,                            -- section 10.4
  xp          int NOT NULL DEFAULT 0,
  position    int NOT NULL
);

CREATE TABLE user_badges (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at  timestamptz NOT NULL DEFAULT now(),
  submission_id uuid REFERENCES submissions(id),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE daily_challenges (
  date          date PRIMARY KEY,                        -- UTC date
  challenge_id  uuid NOT NULL REFERENCES challenges(id),
  bonus_xp      int NOT NULL DEFAULT 25,
  title_override text                                    -- e.g. 'Explain a regex in under 30 tokens'
);

-- ── Prompt library & notifications ──────────────────────────────
CREATE TABLE saved_prompts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES submissions(id) ON DELETE SET NULL,
  title         text NOT NULL CHECK (char_length(title) <= 80),
  prompt        text NOT NULL CHECK (char_length(prompt) <= 20000),
  tags          text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON saved_prompts (user_id, created_at DESC);

CREATE TABLE example_prompts (                           -- curated, read-only for learners
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid REFERENCES challenges(id),
  title         text NOT NULL,
  prompt        text NOT NULL,
  explanation   text NOT NULL,
  reveal_after  text NOT NULL DEFAULT 'clear'            -- 'clear' | 'always'
);

CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,                             -- 'badge_earned','streak_risk','level_complete',...
  payload     jsonb NOT NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC);

-- ── Ops ─────────────────────────────────────────────────────────
CREATE TABLE llm_usage (                                 -- cost accounting per call
  id             bigserial PRIMARY KEY,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  submission_id  uuid REFERENCES submissions(id) ON DELETE SET NULL,
  purpose        text NOT NULL,                          -- 'count_tokens' | 'run_prompt' | 'judge'
  model          text NOT NULL,
  input_tokens   int NOT NULL DEFAULT 0,
  output_tokens  int NOT NULL DEFAULT 0,
  cost_micros    bigint NOT NULL DEFAULT 0,              -- USD × 1e6, from a price table in config
  latency_ms     int,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON llm_usage (created_at);
CREATE INDEX ON llm_usage (user_id, created_at);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,                              -- 'challenge.publish','user.ban','xp.adjust',...
  target     text,
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
