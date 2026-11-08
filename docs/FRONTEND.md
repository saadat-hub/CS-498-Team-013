# Frontend integration

The application lives in `apps/web` and uses React, TypeScript, Vite, and React Router. It shares deterministic grading functions with the backend. Fonts are bundled locally; the app has no third-party font/network dependency. The design uses warm neutral surfaces, teal actions, restrained typography, responsive cards, and accessible native form controls.

## Screens

- `/`: overview with real XP, streak, progress, weekly activity, latest draft, roadmap, badges, and recent submissions. Visitors can browse with a clearly empty personal history.
- `/roadmap`: all five levels, counts, completion, and access state.
- `/challenges`: catalog with track/level/text filters; no sign-in required.
- `/challenge/:slug`: brief, context and references, hints, live deterministic checks, prompt editor, autosave, token counting, asynchronous feedback, output, and save-to-library action.
- `/leaderboard`: weekly and all-time public rankings and the caller's position.
- `/library`: saved prompts and unlocked examples, search, creation, copy, pagination, and deletion confirmation.
- `/settings`: profile, handle, timezone, leaderboard participation, JSON export, and account deletion.
- `/signin`: magic links, configured OAuth providers, and the explicit local session option in development.
- `/admin`: author content publishing/synchronization/dry-run; administrators also have user moderation, XP adjustments, and metrics.

## API and sessions

All requests use the same public origin at `/api/v1`. `src/api.ts` bootstraps `/auth/session`, holds its signed CSRF token in memory, sends cookies, and retries a write once after refreshing a stale token. Errors retain their API code/status/details. Never put service keys in frontend environment variables.

The challenge editor debounces draft saves by 800 ms and serializes writes with revision numbers. A 409 preserves the unsaved text and offers an explicit action to load the server version. A browser unload warning protects text not yet saved. The server recomputes draft check totals. Submissions reuse an idempotency key across a failed network request for the same text; grading errors allow a new attempt. The UI polls model submissions and distinguishes pending, passed, failed, unavailable, and terminal error states. The API also provides SSE for future clients.

Browser token estimates are labeled with `~`. Provider counts and fallback estimates remain distinguishable in results. Model rubrics and hidden test source stay off the challenge response. Context and model outputs render as escaped text, never HTML. Curated examples remain locked until the server allows them.

When changing catalog metadata, read challenge slugs from server responses; recent submissions include `challengeSlug`. Avoid hardcoding navigation from challenge numbers. Catalog extensions must preserve historical version references.

Run `npm run dev` for the combined local API/Vite preview. Run `npm run build` for the same-origin production bundle. Deep links are handled by the API's SPA fallback; unknown `/api/*` paths always return JSON errors.
