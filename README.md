# Prompt Lab

A focused learning workspace for better prompts, clearer thinking, and practical programming. The app includes a responsive React frontend and a TypeScript backend, with twenty guided challenges across five levels.

## Try it locally

With Node.js 22.15 or newer installed:

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**, select **Start your journey**, then **Start local session**. On Windows, you can also run `Start-PromptLab.ps1`.

Your work persists locally in `.data/promptlab`. Introductory grading, drafts, progress, saved prompts, search, and settings work without paid services. Model-dependent challenges require real Anthropic configuration; the app clearly explains when AI grading is unavailable. The local session shortcut is disabled in production.

See [Deployment](docs/DEPLOYMENT.md) for optional AI configuration, production containers, HTTPS, and hosting choices. No server purchase is needed to test the app.

## Frontend

The clean, responsive workspace includes an overview dashboard, five-level roadmap, searchable challenge catalog, live challenge editor, draft autosave, grading feedback, submission history, weekly/all-time leaderboard, prompt library, notifications, account settings, and author/admin tools. Fonts are served locally. Desktop and mobile browser flows are covered by Playwright.

Prompt Lab is a learning platform for programming and debugging. Learners investigate problems, consult library documentation, implement solutions, inspect failures and strengthen their tests. AI-assisted exercises teach learners to express precise requirements and evaluate the resulting code rather than accept an answer without evidence.

The backend manages accounts, challenge content, submissions, grading, progress and administrative operations. The catalog contains twenty exercises across five learning levels: ten foundational programming exercises and ten machine-learning extensions.

## Architecture

The application runs as an API service and a background worker. PostgreSQL 16 stores durable records. Redis 7 supports job delivery, rate limits, caches and leaderboard projections. Anthropic provides model-backed evaluation through a provider interface. Transactional sign-in email is delivered through a queued email adapter.

| Component          | Responsibility                                                                 |
| ------------------ | ------------------------------------------------------------------------------ |
| `apps/api`         | Versioned REST API, authentication, authorization and request validation       |
| `apps/worker`      | Model grading, email delivery and scheduled maintenance                        |
| `packages/db`      | Drizzle-bound SQL, versioned migrations, initialization and ledger projections |
| `packages/content` | Challenge definitions, validation, research references and content versioning  |
| `packages/grading` | Shared deterministic rules and server-side output evaluation                   |
| `packages/llm`     | Token counting, structured judging, caching and spending controls              |
| `packages/shared`  | Configuration, request contracts, email interfaces and telemetry               |

## Learning experience

Learners progress from narrowly scoped functions to library-based data preparation, structured evaluation reports, debugging workflows and small applications. Machine-learning exercises cover NumPy feature scaling, classification metrics, pandas missing-data handling, scikit-learn pipelines, reproducible training, leakage diagnosis, failing pytest cases, inference services and model comparison.

Each exercise defines its objective, supporting evidence, constraints, deliverables, references and evaluation criteria. Research-based exercises require learners to explain how a documented library behavior informed the implementation. Tests and evaluation results must remain distinguishable from unsupported claims.

The original ten challenge identities remain available. Additional exercises extend the catalog without replacing historical challenge versions or progress records. Catalog counts are derived from published content.

## Service configuration

Use Node.js 22.15 or newer. Production requires the PostgreSQL, Redis, HTTPS origins, provider credentials and independently generated secrets documented in `.env.example`. The explicit local development entry point supports persistent embedded data and disabled AI; scripted providers remain restricted to automated tests.

```sh
npm ci
npm run build
npm run release
npm start
```

Run the worker as a separate process:

```sh
npm run worker
```

`npm run release` applies database migrations and synchronizes challenge definitions, badges and daily assignments. It does not create demonstration accounts or award synthetic progress. The retained reference-dashboard seeder is restricted to test configuration.

Container definitions are provided in `infra/Dockerfile` and `infra/compose.production.yml`. Deployment topology, runtime variables, release ordering and operational checks are described in [Deployment](docs/DEPLOYMENT.md).

## API

Resources are served under `/api/v1`. Sessions use HttpOnly cookies. State-changing requests require a signed CSRF token and a matching allowed Origin. Model-dependent submissions are processed asynchronously; clients can poll a submission or consume its event stream.

The API includes authentication, profiles, levels, challenges, drafts, token counts, submissions, dashboard aggregates, leaderboards, badges, saved prompts, examples, notifications, search and administrative operations. [Frontend integration](docs/FRONTEND.md) describes request flows and error handling.

## Verification

```sh
npm run check
npm run lint
npx playwright install chromium
npm run test:e2e
```

The checks compile TypeScript, validate challenge definitions and exercise grading, authentication, ownership, idempotency, concurrency, progress, quotas and reference data. PostgreSQL and Redis service checks are configured in the integration workflow. External-provider validation is performed against the deployment's registered OAuth applications, transactional email domain and model account.

## Documentation

- [Backend specification](backend.md): domain model, database schema, endpoint contracts and acceptance requirements.
- [Curriculum and content authoring](docs/CONTENT.md): exercise structure, machine-learning objectives and evaluation policy.
- [Frontend integration](docs/FRONTEND.md): authenticated API calls, drafts and asynchronous results.
- [Deployment](docs/DEPLOYMENT.md): service requirements, release commands and operations.
- [Engineering collaboration](docs/GITHUB.md): ownership boundaries, change review and interface coordination.
