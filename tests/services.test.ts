import { it, expect } from 'vitest';
import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Database, one } from '../packages/db/src/db.js';
import { syncContent, seedBase } from '../packages/db/src/content.js';
import { loadConfig } from '../packages/shared/src/config.js';
import { createApp } from '../apps/api/src/app.js';
import { newUser } from '../apps/api/src/auth.js';
import { FakeProvider } from '../packages/llm/src/provider.js';
import { hash } from '../packages/shared/src/utils.js';
import { rebuildLeaderboards } from '../packages/db/src/leaderboard.js';
it.skipIf(!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)(
  'persists, queues, grades and projects a submission across PostgreSQL and Redis',
  async () => {
    const db = new Database(process.env.TEST_DATABASE_URL!),
      redis = new Redis(process.env.TEST_REDIS_URL!, { maxRetriesPerRequest: null });
    let ctx: Awaited<ReturnType<typeof createApp>> | undefined,
      worker: Worker | undefined,
      queue: Queue | undefined;
    try {
      await db.migrate();
      await syncContent(db);
      await seedBase(db);
      const config = loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        REDIS_URL: process.env.TEST_REDIS_URL,
      });
      const prompt = 'Return a user profile as JSON only.';
      ctx = await createApp({
        db,
        config,
        provider: new FakeProvider({ [hash(prompt)]: '{"name":"Service test"}' }),
        logger: false,
      });
      const user = await newUser(db, `services-${randomUUID()}@example.com`, 'Service test');
      const version = await one(
        db,
        "SELECT c.id,c.current_version_id,v.token_budget FROM challenges c JOIN challenge_versions v ON v.id=c.current_version_id WHERE c.slug='json-only'",
      );
      const s = await one(
        db,
        `INSERT INTO submissions(user_id,challenge_id,challenge_version_id,idempotency_key,prompt,prompt_sha256,token_count,token_counter,token_budget) VALUES($1,$2,$3,$4,$5,$6,10,'estimate:v1',$7) RETURNING id`,
        [
          user.id,
          version.id,
          version.current_version_id,
          randomUUID(),
          prompt,
          hash(prompt),
          version.token_budget,
        ],
      );
      worker = new Worker(
        'grade',
        async (job) => {
          await ctx!.grading.grade(job.data.submissionId);
        },
        { connection: redis as any, concurrency: 1 },
      );
      queue = new Queue('grade', { connection: redis as any });
      await queue.add('grade', { submissionId: s.id }, { jobId: s.id, removeOnComplete: true });
      const deadline = Date.now() + 15000;
      let result: any;
      do {
        result = await one(db, 'SELECT * FROM submissions WHERE id=$1', [s.id]);
        if (['passed', 'failed', 'error'].includes(result.status)) break;
        await new Promise((r) => setTimeout(r, 50));
      } while (Date.now() < deadline);
      expect(result.status).toBe('passed');
      expect(result.model_output).toContain('Service test');
      expect(
        (
          await one(
            db,
            "SELECT count(*)::int n FROM xp_events WHERE user_id=$1 AND reason='challenge_clear'",
            [user.id],
          )
        ).n,
      ).toBe(1);
      await rebuildLeaderboards(db, redis);
      expect(Number(await redis.zscore('lb:alltime', user.id))).toBeGreaterThanOrEqual(100);
    } finally {
      await worker?.close();
      await queue?.close();
      await ctx?.app.close();
      await redis.quit();
      await db.close();
    }
  },
  60000,
);
