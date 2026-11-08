import { Database, one } from '../../../../packages/db/src/db.js';
import { camel, fail } from '../../../../packages/shared/src/utils.js';
import { badgeProgress } from './progress.js';
import { z } from 'zod';
export async function getChallenge(db: Database, slug: string, includeUnpublished = false) {
  const c = await one(
    db,
    `SELECT c.id,c.slug,c.level_id,c.position,c.published,v.*,l.slug level_slug,l.code level_code,l.name level_name,l.unlock_rule FROM challenges c JOIN challenge_versions v ON v.id=c.current_version_id JOIN levels l ON l.id=c.level_id WHERE c.slug=$1 AND ($2 OR (c.published AND l.published))`,
    [slug, includeUnpublished],
  );
  if (!c) fail(404, 'challenge_not_found', 'Challenge not found');
  // v.id is the version id; stable challenge id is available as v.challenge_id.
  c.checks = (
    await db.query(
      'SELECT * FROM challenge_checks WHERE challenge_version_id=$1 ORDER BY position',
      [c.id],
    )
  ).rows;
  return c;
}
export async function unlocked(db: Database, c: any, user: string | null) {
  if (c.unlock_rule.type === 'none') return true;
  const previous = await one(
    db,
    'SELECT id FROM levels WHERE position=(SELECT position-1 FROM levels WHERE id=$1)',
    [c.level_id],
  );
  if (!previous) return true;
  const result = await one(
    db,
    `SELECT count(*)::float total,count(p.first_cleared_at)::float cleared FROM challenges c LEFT JOIN progress p ON p.challenge_id=c.id AND p.user_id=$1 WHERE c.level_id=$2 AND c.published`,
    [user, previous.id],
  );
  return result.total > 0 && result.cleared / result.total >= c.unlock_rule.min_fraction;
}
export async function levels(db: Database, user: string | null) {
  const rows = (
    await db.query(
      `SELECT l.*,count(c.id)::int challenge_count,count(p.first_cleared_at)::int cleared_count, EXISTS(SELECT 1 FROM drafts d JOIN challenges dc ON dc.id=d.challenge_id WHERE d.user_id=$1 AND dc.level_id=l.id) has_draft FROM levels l LEFT JOIN challenges c ON c.level_id=l.id AND c.published AND c.position<100 LEFT JOIN progress p ON p.challenge_id=c.id AND p.user_id=$1 WHERE l.published GROUP BY l.id ORDER BY l.position`,
      [user],
    )
  ).rows;
  return Promise.all(
    rows.map(async (l) => ({
      ...camel(l),
      me: {
        clearedCount: l.cleared_count,
        status:
          l.challenge_count > 0 && l.cleared_count === l.challenge_count
            ? 'done'
            : l.cleared_count || l.has_draft
              ? 'active'
              : 'queued',
        locked: !(await unlocked(db, { level_id: l.id, unlock_rule: l.unlock_rule }, user)),
        pct: l.challenge_count ? Math.round((100 * l.cleared_count) / l.challenge_count) : 0,
      },
    })),
  );
}
export async function latestDraft(db: Database, user: string) {
  return camel(
    await one(
      db,
      `SELECT d.*,v.token_budget,json_build_object('slug',c.slug,'code',l.position||'.'||c.position,'title',v.title,'brief',v.brief,'tags',v.tags) challenge FROM drafts d JOIN challenges c ON c.id=d.challenge_id JOIN levels l ON l.id=c.level_id JOIN challenge_versions v ON v.id=c.current_version_id LEFT JOIN progress p ON p.user_id=d.user_id AND p.challenge_id=d.challenge_id WHERE d.user_id=$1 AND c.published AND p.first_cleared_at IS NULL ORDER BY d.updated_at DESC LIMIT 1`,
      [user],
    ),
  );
}
export async function submissionResult(db: Database, id: string) {
  const s = await one(db, 'SELECT * FROM submissions WHERE id=$1', [id]);
  if (!s) fail(404, 'not_found', 'Submission not found');
  const checks = (
    await db.query(
      'SELECT check_key key,type,label,passed,score,message,details FROM submission_check_results WHERE submission_id=$1 ORDER BY check_key',
      [id],
    )
  ).rows;
  const p = await one(db, 'SELECT * FROM progress WHERE user_id=$1 AND challenge_id=$2', [
    s.user_id,
    s.challenge_id,
  ]);
  const stats = await one(
    db,
    'SELECT current_streak current,best_streak best FROM user_stats WHERE user_id=$1',
    [s.user_id],
  );
  const badges = (
    await db.query(
      'SELECT b.slug,b.name,b.mark FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.submission_id=$1',
      [id],
    )
  ).rows;
  const next = await one(
    db,
    `SELECT c.slug challenge_slug,l.code level_code,l.position||'.'||c.position code FROM challenges c JOIN levels l ON l.id=c.level_id WHERE c.published AND (l.position,c.position)>(SELECT l2.position,c2.position FROM challenges c2 JOIN levels l2 ON l2.id=c2.level_id WHERE c2.id=$1) ORDER BY l.position,c.position LIMIT 1`,
    [s.challenge_id],
  );
  return {
    ...camel(s),
    instantChecks: [] as any[],
    checks: camel(checks),
    firstClear: p?.first_cleared_submission_id === id,
    newBadges: badges,
    streak: stats ?? { current: 0, best: 0 },
    next: camel(next),
    pollUrl: `/api/v1/submissions/${id}`,
    streamUrl: `/api/v1/submissions/${id}/events`,
  };
}
export async function badges(db: Database, user: string) {
  const rows = (
    await db.query(
      'SELECT b.*,ub.earned_at FROM badges b LEFT JOIN user_badges ub ON ub.badge_id=b.id AND ub.user_id=$1 ORDER BY b.position',
      [user],
    )
  ).rows;
  return Promise.all(
    rows.map(async (b) => ({
      slug: b.slug,
      name: b.name,
      mark: b.mark,
      description: b.description,
      earned: !!b.earned_at,
      earnedAt: b.earned_at,
      progress: await badgeProgress(db, user, b.rule),
    })),
  );
}
export async function leaderboard(db: Database, user: string | null, scope = 'week', limit = 50) {
  const rows = (
    await db.query(
      `SELECT u.id,u.display_name,COALESCE(sum(x.amount),0)::int xp,max(x.created_at) reached FROM users u LEFT JOIN xp_events x ON x.user_id=u.id AND ($1='alltime' OR x.created_at>=date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') WHERE u.email_verified IS NOT NULL AND u.banned_at IS NULL AND u.deleted_at IS NULL AND (u.leaderboard_opt_in OR u.id=$2) GROUP BY u.id ORDER BY xp DESC,reached ASC NULLS LAST,u.id`,
      [scope, user],
    )
  ).rows;
  const visible = rows.filter((r) => r.id !== user || true); // Keep caller in ranking even when opted out.
  const all = visible.map((r, i) => ({
    rank: i + 1,
    userId: r.id,
    displayName: r.display_name,
    xp: r.xp,
  }));
  const me = all.find((r) => r.userId === user) ?? null;
  const privacy = (await db.query('SELECT id FROM users WHERE leaderboard_opt_in=false')).rows.map(
    (r) => r.id,
  );
  const top = all.filter((r) => !privacy.includes(r.userId)).slice(0, limit);
  return {
    scope,
    top,
    me,
    neighbours: me
      ? all.filter((r) => Math.abs(r.rank - me.rank) === 1 && !privacy.includes(r.userId))
      : [],
  };
}
export function pagination(query: any) {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(query.limit ?? 20);
  let offset = 0;
  if (query.cursor) {
    try {
      if (typeof query.cursor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(query.cursor))
        fail(400, 'invalid_cursor', 'Invalid cursor');
      const decoded = Buffer.from(query.cursor, 'base64url').toString();
      if (!/^(0|[1-9]\d*)$/.test(decoded)) fail(400, 'invalid_cursor', 'Invalid cursor');
      offset = Number(decoded);
    } catch {
      fail(400, 'invalid_cursor', 'Invalid cursor');
    }
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'invalid_cursor', 'Invalid cursor');
  }
  return { limit, offset };
}
export function page(rows: any[], limit: number, offset: number) {
  return {
    items: camel(rows.slice(0, limit)),
    nextCursor:
      rows.length > limit ? Buffer.from(String(offset + limit)).toString('base64url') : null,
  };
}
