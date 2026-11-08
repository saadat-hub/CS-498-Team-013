import { Redis } from 'ioredis';
import { Database, one } from './db.js';
import { randomUUID } from 'node:crypto';
export async function leaderboardKeys(db: Database) {
  return {
    all: 'lb:alltime',
    week: `lb:week:${(await one(db, `SELECT to_char(now() AT TIME ZONE 'UTC','IYYY-"W"IW') key`)).key}`,
  };
}
export async function updateLeaderboard(db: Database, redis: Redis, user: string) {
  const keys = await leaderboardKeys(db),
    u = await one(db, 'SELECT * FROM users WHERE id=$1', [user]);
  if (!u || !u.leaderboard_opt_in || !u.email_verified || u.banned_at || u.deleted_at) {
    await redis.zrem(keys.all, user);
    await redis.zrem(keys.week, user);
    return;
  }
  const scores = await one(
    db,
    `SELECT COALESCE(sum(amount),0)::int total,COALESCE(sum(amount) FILTER(WHERE created_at>=date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::int week FROM xp_events WHERE user_id=$1`,
    [user],
  );
  // Absolute scores make replays safe even if the process crashes after a commit.
  await redis
    .multi()
    .zadd(keys.all, scores.total, user)
    .zadd(keys.week, scores.week, user)
    .expire(keys.week, 21 * 86400)
    .exec();
}
export async function rebuildLeaderboards(db: Database, redis: Redis) {
  const keys = await leaderboardKeys(db),
    suffix = randomUUID(),
    a = `${keys.all}:tmp:${suffix}`,
    w = `${keys.week}:tmp:${suffix}`;
  const rows = (
    await db.query(
      `SELECT u.id,COALESCE(sum(x.amount),0)::int total,COALESCE(sum(x.amount) FILTER(WHERE x.created_at>=date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::int week FROM users u LEFT JOIN xp_events x ON x.user_id=u.id WHERE u.email_verified IS NOT NULL AND u.leaderboard_opt_in AND u.banned_at IS NULL AND u.deleted_at IS NULL GROUP BY u.id`,
    )
  ).rows;
  if (!rows.length) {
    await redis.del(keys.all, keys.week);
    return;
  }
  const write = redis.multi();
  for (const r of rows) {
    write.zadd(a, r.total, r.id);
    write.zadd(w, r.week, r.id);
  }
  write.expire(a, 3600).expire(w, 3600);
  await write.exec();
  await redis
    .multi()
    .rename(a, keys.all)
    .persist(keys.all)
    .rename(w, keys.week)
    .expire(keys.week, 21 * 86400)
    .exec();
}
