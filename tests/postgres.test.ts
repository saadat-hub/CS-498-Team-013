import { it, expect } from 'vitest';
import { Database, one } from '../packages/db/src/db.js';
import { syncContent, seedBase } from '../packages/db/src/content.js';
import { createApp } from '../apps/api/src/app.js';
import { loadConfig } from '../packages/shared/src/config.js';
it.skipIf(!process.env.TEST_DATABASE_URL)(
  'migrates and serves content against PostgreSQL 16',
  async () => {
    const db = new Database(process.env.TEST_DATABASE_URL!);
    try {
      await Promise.all([db.migrate(), db.migrate()]);
      await syncContent(db);
      await seedBase(db);
      expect((await one(db, 'SELECT count(*)::int n FROM levels')).n).toBe(5);
      const ctx = await createApp({
        db,
        config: loadConfig({
          NODE_ENV: 'test',
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          REDIS_URL: '',
          LLM_PROVIDER: 'fake',
        }),
        logger: false,
      });
      try {
        const r = await ctx.app.inject({ method: 'GET', url: '/api/v1/challenges/hello-function' });
        expect(r.statusCode).toBe(200);
        expect(r.json().checks).toHaveLength(3);
      } finally {
        await ctx.app.close();
      }
    } finally {
      await db.close();
    }
  },
  60000,
);
