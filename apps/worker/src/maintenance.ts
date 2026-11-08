import type { Queue } from 'bullmq';
import { Database, one } from '../../../packages/db/src/db.js';
import type { Config } from '../../../packages/shared/src/config.js';
import { seedBase } from '../../../packages/db/src/content.js';
import { refreshStats } from '../../api/src/services/progress.js';
export const schedules = [
  { name: 'grade.dispatch', repeat: { every: 5000 } },
  { name: 'grade.sweep', repeat: { every: 300000 } },
  { name: 'leaderboard.rebuild', repeat: { pattern: '10 3 * * *', tz: 'UTC' } },
  { name: 'stats.reconcile', repeat: { pattern: '30 3 * * *', tz: 'UTC' } },
  { name: 'daily.pick', repeat: { pattern: '5 0 * * *', tz: 'UTC' } },
  { name: 'streak.risk', repeat: { pattern: '7 * * * *', tz: 'UTC' } },
  { name: 'users.purge', repeat: { pattern: '0 4 * * *', tz: 'UTC' } },
  { name: 'usage.rollup', repeat: { pattern: '5 * * * *', tz: 'UTC' } },
];
export async function dispatchSubmissions(db: Database, queue: Queue) {
  const pending = (
    await db.query(
      "SELECT d.submission_id FROM submission_dispatch d JOIN submissions s ON s.id=d.submission_id WHERE s.status='queued' ORDER BY d.created_at LIMIT 100",
    )
  ).rows;
  for (const row of pending) {
    await queue.add(
      'grade',
      { submissionId: row.submission_id },
      {
        jobId: row.submission_id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
      },
    );
    await db.query('DELETE FROM submission_dispatch WHERE submission_id=$1', [row.submission_id]);
  }
  await db.query(
    "DELETE FROM submission_dispatch d USING submissions s WHERE s.id=d.submission_id AND s.status IN ('passed','failed','error')",
  );
  return { dispatched: pending.length };
}
export async function sweepSubmissions(db: Database, gradeQueue: Queue) {
  const recovered = await db.tx(async (q) => {
    await q.query(
      "UPDATE submissions SET status='error',error_code='grading_timeout',graded_at=now() WHERE status IN ('queued','grading') AND COALESCE(grading_started_at,created_at)<now()-interval '3 minutes' AND recovery_count>=1",
    );
    await q.query(
      "UPDATE model_reservations r SET reserved_micros=0 FROM submissions s WHERE s.id=r.submission_id AND s.status='error'",
    );
    return (
      await q.query(
        "UPDATE submissions SET status='queued',recovery_count=recovery_count+1,grading_started_at=now() WHERE status IN ('queued','grading') AND COALESCE(grading_started_at,created_at)<now()-interval '3 minutes' AND recovery_count<1 RETURNING id,user_id,recovery_count",
      )
    ).rows;
  });
  for (const s of recovered)
    await gradeQueue.add(
      'grade',
      { submissionId: s.id },
      {
        jobId: `${s.id}-recovery-${s.recovery_count}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
      },
    );
  return { recovered: recovered.length };
}
export async function reconcileStats(db: Database) {
  let drift = 0;
  for (const u of (await db.query('SELECT id FROM users WHERE deleted_at IS NULL')).rows) {
    await db.tx(async (q) => {
      await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id]);
      const before = await one(
        q,
        'SELECT total_xp,cleared_count,avg_budget_used FROM user_stats WHERE user_id=$1',
        [u.id],
      );
      await refreshStats(q, u.id);
      const after = await one(
        q,
        'SELECT total_xp,cleared_count,avg_budget_used FROM user_stats WHERE user_id=$1',
        [u.id],
      );
      if (JSON.stringify(before) !== JSON.stringify(after)) drift++;
    });
  }
  return { drift };
}
export async function notifyStreakRisk(db: Database) {
  const result = await db.query(
    `INSERT INTO notifications(user_id,kind,payload) SELECT u.id,'streak_risk',jsonb_build_object('dedupeKey',((now() AT TIME ZONE u.timezone)::date)::text) FROM users u JOIN user_stats s ON s.user_id=u.id WHERE u.deleted_at IS NULL AND u.banned_at IS NULL AND s.current_streak>=3 AND s.last_active_date=(now() AT TIME ZONE u.timezone)::date-1 AND extract(hour FROM now() AT TIME ZONE u.timezone)=20 ON CONFLICT DO NOTHING RETURNING id`,
  );
  return { notifications: result.rows.length };
}
export async function purgeUsers(db: Database) {
  return db.tx(async (q) => {
    await q.query('DELETE FROM sessions WHERE expires_at<now()');
    await q.query("DELETE FROM verification_tokens WHERE expires_at<now()-interval '1 hour'");
    await q.query("UPDATE llm_usage SET user_id=NULL WHERE created_at<now()-interval '180 days'");
    await q.query(
      "UPDATE audit_log SET actor_id=NULL WHERE actor_id IN(SELECT id FROM users WHERE deleted_at<now()-interval '30 days')",
    );
    const removed = await q.query(
      "DELETE FROM users WHERE deleted_at<now()-interval '30 days' RETURNING id",
    );
    return { purged: removed.rows.length };
  });
}
export async function rollupUsage(db: Database, config: Config) {
  return db.tx(async (q) => {
    await q.query(
      `INSERT INTO usage_daily(date,purpose,model,calls,input_tokens,output_tokens,cost_micros) SELECT (created_at AT TIME ZONE 'UTC')::date,purpose,model,count(*),sum(input_tokens),sum(output_tokens),sum(cost_micros) FROM llm_usage GROUP BY 1,2,3 ON CONFLICT(date,purpose,model) DO UPDATE SET calls=excluded.calls,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,cost_micros=excluded.cost_micros,updated_at=now()`,
    );
    const usage = await one(
      q,
      `SELECT COALESCE(sum(cost_micros),0)::bigint micros FROM usage_daily WHERE date=(now() AT TIME ZONE 'UTC')::date`,
    );
    const fraction = Number(usage.micros) / (config.LLM_DAILY_BUDGET_USD * 1e6);
    if (fraction >= 0.8)
      await q.query(
        `INSERT INTO notifications(user_id,kind,payload) SELECT id,'budget_alert',jsonb_build_object('dedupeKey',(now() AT TIME ZONE 'UTC')::date::text,'fraction',$1::float) FROM users WHERE role='admin' AND deleted_at IS NULL ON CONFLICT DO NOTHING`,
        [fraction],
      );
    return { costMicros: Number(usage.micros), fraction };
  });
}
export const pickDaily = (db: Database) => db.tx(seedBase);
