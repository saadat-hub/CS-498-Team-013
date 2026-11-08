# Running and deploying Prompt Lab

## Start locally

Install Node.js 22.15 or newer (a current Node 22 or 24 release is recommended). From the repository root:

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. Choose **Start your journey → Start local session**. No Docker, payment, email account, or API credential is required to explore the app and grade the original introductory exercises. Your account, drafts, submissions, and progress persist in `.data/promptlab`, which is ignored by Git. Stop with Ctrl+C.

Local mode is an explicit development entry point. It binds both services to loopback, uses an embedded PostgreSQL engine, and never pretends to perform AI grading. Model-dependent submissions receive `503 ai_not_configured` until a real provider is configured. Development magic links are printed to the terminal. Local sessions cannot be enabled in production. Existing sessions persist with local data; CSRF tokens refresh automatically after a restart.

Optional local environment variables: `WEB_PORT` (default 3000), `API_PORT` (8080), and `DATABASE_URL` (default `pglite://.data/promptlab`). A supplied PostgreSQL URL uses that database instead; use a dedicated development database because migrations and catalog synchronization run at startup. Do not point local mode at production data.

For real AI grading, create an ignored `.env` containing `ANTHROPIC_API_KEY`, `TOKEN_COUNT_MODEL`, `RUN_MODEL`, `JUDGE_MODEL`, and `PRICES_JSON`. Select model IDs and prices from the provider's current documentation. Set `LLM_DAILY_BUDGET_USD` and `USER_DAILY_MODEL_RUNS` to your desired limits. Local AI work runs in the API process; production uses the durable worker.

## Verify changes

```sh
npm run check
npm run lint
npx playwright install chromium
npm run test:e2e
```

Browser tests start an isolated app on ports 3010/8090 with an in-memory database and disabled AI. They cover desktop and mobile navigation, draft reloads, passing submissions, library creation/deletion, profile updates, search, filters, and honest AI-unavailable feedback. Playwright reports are local ignored artifacts.

Run `npm run test:services` with `TEST_DATABASE_URL` and `TEST_REDIS_URL` pointing to dedicated disposable test services to verify real PostgreSQL/Redis delivery. These two tests skip when the URLs are absent. Provider credentials are never required for CI. Real OAuth, email delivery, provider evaluation quality, and backup restoration must be checked in staging before launch.

## Production architecture

The React/Vite frontend builds to `dist/web`. The Fastify API serves the built assets and supports direct navigation to frontend routes. The worker is a separate long-running process. Both need PostgreSQL 16, Redis 7, and the same validated service configuration.

```sh
npm ci
npm run build
npm run release
npm start
# In a separate service/process:
npm run worker
```

`npm run release` applies migrations, synchronizes versioned YAML, and initializes badges and daily assignments. It does not create demo users. Apply releases once before starting new API/worker instances. The image in `infra/Dockerfile` contains the frontend and both backend entry points.

Copy `.env.example` to `.env` and supply the production values. Use the public **same HTTPS origin** for `APP_ORIGIN` and `API_URL`, for example `https://learn.example.com`. Configure the reverse proxy to send `/api/*` and all other routes to the API service. Session cookies have no explicit Domain, so they remain on the public origin. The frontend makes relative credentialed requests.

Required: PostgreSQL/Redis URLs, independent random session/IP-hash secrets, Anthropic model configuration and price entries, and Resend sender credentials. OAuth is optional; if enabled, supply each provider's complete credential pair and register these public callbacks:

```text
https://learn.example.com/api/v1/auth/callback/github
https://learn.example.com/api/v1/auth/callback/google
```

Use a verified sending domain and test magic-link delivery. No secrets are exposed in frontend bundles. `LOCAL_DEVELOPMENT` must remain `false` or unset. Code execution remains disabled.

`infra/compose.production.yml` runs release/API/worker against externally managed Postgres and Redis. For a single Linux server, `infra/compose.selfhost.yml` also includes Postgres, Redis, and Caddy for HTTPS. Set `SITE_DOMAIN`, `POSTGRES_PASSWORD` (URL-safe), and the remaining production variables in `.env`, point DNS at the server, and run:

```sh
docker compose --env-file .env -f infra/compose.selfhost.yml up -d --build
```

The self-hosted configuration overrides database/Redis addresses to the private container network. Only ports 80/443 are public. Secure the host and arrange off-server backups before real users join. Named volumes survive container restarts; deleting them destroys data.

Vercel can host the static frontend, but the existing BullMQ worker and persistent service connections still require a separate backend host. A single container host is the simplest initial topology. If splitting later, keep an `/api/*` reverse proxy on the frontend origin and update the public callback URLs. No hosting purchase or deployment is necessary for local testing.

## Operations

- `/healthz` checks the process. `/readyz` checks schema version 4 and Redis connectivity.
- A PostgreSQL outbox records model-submission delivery. The worker dispatches pending rows every five seconds. Queue publication is idempotent by submission ID. A sweeper recovers stuck work once, then marks a timeout.
- Worker retries requeue transient model failures and preserve the reservation; terminal failures release it. Previously stored model output is reused when a later judge step fails. XP finalization remains transactional and deduplicated.
- Leaderboard sorted sets are rebuildable; the current API uses SQL for authoritative ranking reads. Set-based Redis updates and nightly rebuilds remain available. Optimize reads only after measuring real traffic.
- Configure `OTEL_EXPORTER_OTLP_ENDPOINT` to export traces and metrics to an OTLP collector. Set `SENTRY_DSN` for server error events. Add hosting alerts for readiness failures, queue wait, grading errors, spend, and failed scheduled jobs.
- Back up PostgreSQL daily with point-in-time recovery when available. Exercise a restore into a separate staging database. Redis outages are recoverable from committed submissions/XP records.
- Promote an initial administrator using a controlled database command: `UPDATE users SET role='admin' WHERE email='your-verified-email';`. Sign out/in afterward. There is no public role-promotion endpoint. Authors and admins can open `/admin` from Settings.

Untrusted code is never executed. Model feedback does not prove a learner's tests ran.
