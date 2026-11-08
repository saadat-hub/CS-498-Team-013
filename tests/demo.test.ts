import { it, expect } from 'vitest';
import { Database, one } from '../packages/db/src/db.js';
import { syncContent, seedBase } from '../packages/db/src/content.js';
import { seedDemo } from '../packages/db/src/demo.js';
it('seeds the dashboard fixture idempotently', async () => {
  const db = new Database('pglite://');
  try {
    await db.migrate();
    await syncContent(db);
    await seedBase(db);
    await seedDemo(db);
    await seedDemo(db);
    const u = await one(
      db,
      "SELECT u.id,s.* FROM users u JOIN user_stats s ON s.user_id=u.id WHERE email='alex@example.com'",
    );
    expect(u.total_xp).toBe(425);
    expect(u.cleared_count).toBe(5);
    expect(u.current_streak).toBe(6);
    expect(u.best_streak).toBe(9);
    expect(
      (await one(db, 'SELECT count(*)::int n FROM user_badges WHERE user_id=$1', [u.id])).n,
    ).toBe(3);
    const before = (await one(db, 'SELECT count(*)::int n FROM challenge_versions')).n;
    await syncContent(db);
    expect((await one(db, 'SELECT count(*)::int n FROM challenge_versions')).n).toBe(before);
  } finally {
    await db.close();
  }
}, 60000);
