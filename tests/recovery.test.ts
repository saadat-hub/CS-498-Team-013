import { beforeAll, afterAll, it, expect } from 'vitest';
import { Database, one } from '../packages/db/src/db.js';
import { syncContent, seedBase } from '../packages/db/src/content.js';
import { newUser } from '../apps/api/src/auth.js';
import { loadConfig } from '../packages/shared/src/config.js';
import { LlmService, FakeProvider, MemoryCache } from '../packages/llm/src/provider.js';
import { GradingService } from '../apps/api/src/services/grading.js';
import { dispatchSubmissions } from '../apps/worker/src/maintenance.js';
import type { Queue } from 'bullmq';
let db: Database, user: any, version: any;
beforeAll(async () => {
  db = new Database('pglite://');
  await db.migrate();
  await syncContent(db);
  await db.tx(seedBase);
  user = await newUser(db, 'recovery@example.com');
  version = await one(
    db,
    "SELECT c.id,v.id version,v.token_budget FROM challenges c JOIN challenge_versions v ON v.id=c.current_version_id WHERE c.slug='json-only'",
  );
}, 60000);
afterAll(async () => {
  await db.close();
});
async function submission(key: string) {
  return one(
    db,
    "INSERT INTO submissions(user_id,challenge_id,challenge_version_id,idempotency_key,prompt,prompt_sha256,token_count,token_counter,token_budget) VALUES($1,$2,$3,$4,'Return JSON only','hash',4,'estimate:v1',$5) RETURNING *",
    [user.id, version.id, version.version, key, version.token_budget],
  );
}
it('retries transient failures without double awarding XP or consuming a second reservation', async () => {
  const s = await submission('recover-provider'),
    provider = new FakeProvider();
  let calls = 0;
  provider.complete = async () => {
    if (++calls === 1) throw new Error('temporary outage');
    return {
      text: '{"ok":true}',
      inputTokens: 10,
      outputTokens: 5,
      model: 'test',
      stopReason: 'end_turn',
    };
  };
  const grading = new GradingService(
    db,
    new LlmService(loadConfig({ NODE_ENV: 'test' }), db, new MemoryCache(), provider),
  );
  await expect(grading.grade(s.id, { retryOnError: true })).rejects.toThrow('temporary outage');
  expect((await one(db, 'SELECT status FROM submissions WHERE id=$1', [s.id])).status).toBe(
    'queued',
  );
  await grading.grade(s.id);
  await grading.grade(s.id);
  expect(calls).toBe(2);
  expect((await one(db, 'SELECT status FROM submissions WHERE id=$1', [s.id])).status).toBe(
    'passed',
  );
  expect(
    (
      await one(
        db,
        "SELECT count(*)::int n FROM xp_events WHERE submission_id=$1 AND reason='challenge_clear'",
        [s.id],
      )
    ).n,
  ).toBe(1);
  expect(
    (await one(db, 'SELECT count(*)::int n FROM model_reservations WHERE submission_id=$1', [s.id]))
      .n,
  ).toBe(1);
});
it('retains durable delivery after a queue outage and dispatches the same submission when available', async () => {
  const s = await submission('recover-dispatch');
  await db.query('INSERT INTO submission_dispatch(submission_id) VALUES($1)', [s.id]);
  const unavailable = {
    add: async () => {
      throw new Error('redis offline');
    },
  } as unknown as Queue;
  await expect(dispatchSubmissions(db, unavailable)).rejects.toThrow('redis offline');
  expect(
    await one(db, 'SELECT submission_id FROM submission_dispatch WHERE submission_id=$1', [s.id]),
  ).toBeTruthy();
  const ids: string[] = [];
  const available = {
    add: async (_name: string, data: any) => {
      ids.push(data.submissionId);
    },
  } as unknown as Queue;
  expect((await dispatchSubmissions(db, available)).dispatched).toBe(1);
  expect((await dispatchSubmissions(db, available)).dispatched).toBe(0);
  expect(ids).toEqual([s.id]);
});
it('accepts a zero-cost reservation once when the daily quota is one', async () => {
  const u = await newUser(db, 'single-quota@example.com');
  const s = await submission('single-quota');
  await db.query('UPDATE submissions SET user_id=$2 WHERE id=$1', [s.id, u.id]);
  const config = loadConfig({ NODE_ENV: 'test', USER_DAILY_MODEL_RUNS: 1 });
  const llm = new LlmService(config, db, new MemoryCache(), new FakeProvider());
  const a = await llm.reserve(u.id, s.id, { run_config: null }, []);
  const b = await llm.reserve(u.id, s.id, { run_config: null }, []);
  expect(a).toBe(b);
});
