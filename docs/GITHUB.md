# Engineering collaboration

Use feature branches and focused commits. Run `npm run check`, `npm run lint`, and `npm run test:e2e` before review. CI additionally exercises dedicated PostgreSQL/Redis services and the production container build.

Keep frontend UI/API integration in `apps/web`; HTTP authorization and transport in `apps/api`; worker delivery/recovery in `apps/worker`; and reusable rules, provider calls, content, and durable data in their existing packages. Coordinate schema and response changes with all consumers.

Do not commit `.env`, `.data`, credentials, test reports, dependencies, or generated bundles. Use additive migrations and immutable content versions. Explain behavioral changes, validation evidence, and any unverified external integration in pull requests. Never claim a simulated provider verifies a real model's quality.
