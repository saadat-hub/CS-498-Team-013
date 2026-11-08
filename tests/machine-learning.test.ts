import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Database, one } from '../packages/db/src/db.js';
import { syncContent, seedBase } from '../packages/db/src/content.js';
import { createApp } from '../apps/api/src/app.js';
import { newUser } from '../apps/api/src/auth.js';
import { getChallenge } from '../apps/api/src/services/queries.js';
import { loadConfig } from '../packages/shared/src/config.js';
import { FakeProvider } from '../packages/llm/src/provider.js';
import { loadContent } from '../packages/content/src/loader.js';
import { rollupUsage, reconcileStats, purgeUsers } from '../apps/worker/src/maintenance.js';
let db: Database, ctx: Awaited<ReturnType<typeof createApp>>, user: any;
let failVerification = false;
beforeAll(async () => {
  db = new Database('pglite://');
  await db.migrate();
  await syncContent(db);
  await seedBase(db);
  user = await newUser(db, 'ml-review@example.com', 'ML Reviewer');
  const provider = new FakeProvider();
  provider.judge = async (args: any) => {
    const part = args.system.split('Criteria: ')[1].split('\nContext: ')[0];
    const criteria = JSON.parse(part).map((c: any, i: number) => ({
      id: c.id,
      met: !(failVerification && i === 1),
      reason:
        failVerification && i === 1
          ? 'Required verification is missing'
          : 'The supplied requirement is covered',
    }));
    return {
      result: {
        criteria,
        overall_reason: failVerification
          ? 'Verification criterion failed'
          : 'All required criteria covered',
      },
      inputTokens: 20,
      outputTokens: 30,
    };
  };
  ctx = await createApp({ db, config: loadConfig({ NODE_ENV: 'test' }), provider, logger: false });
  await ctx.app.ready();
}, 60000);
afterAll(async () => {
  await ctx?.app.close();
  await db?.close();
});
it('preserves the foundational catalog and exposes ten ML exercises without private criteria', async () => {
  const all = await ctx.app.inject({ method: 'GET', url: '/api/v1/challenges?limit=100' });
  expect(all.json().items).toHaveLength(20);
  const foundational = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/challenges?track=foundational',
  });
  expect(foundational.json().items).toHaveLength(10);
  const ml = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/challenges?track=machine-learning',
  });
  expect(ml.json().items).toHaveLength(10);
  for (const challenge of ml.json().items) {
    const result = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/challenges/${challenge.slug}`,
    });
    expect(result.json().context.references.length).toBeGreaterThan(0);
    expect(result.json().context.evaluation_mode).toBe('static-and-model-review');
    expect(result.json().checks.find((c: any) => c.type === 'llm_judge').config).toBeNull();
  }
});
it('requires every structured criterion rather than accepting keyword-only passes', async () => {
  const content = await loadContent(),
    examples = JSON.parse(
      await readFile(
        new URL('../packages/content/challenges/__golden__/machine-learning.json', import.meta.url),
        'utf8',
      ),
    );
  for (const c of content.challenges.filter((c) => c.tags.includes('machine-learning'))) {
    const loaded = await getChallenge(db, c.slug);
    failVerification = false;
    const good = await ctx.grading.dryRun(loaded, examples[c.slug].pass[0], user.id);
    expect(good.passed, c.slug).toBe(true);
    failVerification = true;
    const incomplete = await ctx.grading.dryRun(loaded, examples[c.slug].pass[1], user.id);
    expect(incomplete.passed, c.slug).toBe(false);
  }
  expect(
    (await one(db, 'SELECT count(*)::int n FROM submissions WHERE user_id=$1', [user.id])).n,
  ).toBe(0);
  expect(
    (await one(db, 'SELECT total_xp FROM user_stats WHERE user_id=$1', [user.id])).total_xp,
  ).toBe(0);
});
it('rolls usage up idempotently and reconciles ledger totals', async () => {
  const first = await rollupUsage(db, ctx.config),
    second = await rollupUsage(db, ctx.config);
  expect(first.costMicros).toBe(second.costMicros);
  await db.query('UPDATE user_stats SET total_xp=999 WHERE user_id=$1', [user.id]);
  const result = await reconcileStats(db);
  expect(result.drift).toBe(1);
  expect(
    (await one(db, 'SELECT total_xp FROM user_stats WHERE user_id=$1', [user.id])).total_xp,
  ).toBe(0);
});
it('purges expired deleted accounts while preserving active learner records', async () => {
  const deleted = await newUser(db, 'expired@example.com');
  await db.query("UPDATE users SET deleted_at=now()-interval '31 days' WHERE id=$1", [deleted.id]);
  const result = await purgeUsers(db);
  expect(result.purged).toBe(1);
  expect(await one(db, 'SELECT id FROM users WHERE id=$1', [user.id])).toBeTruthy();
});
