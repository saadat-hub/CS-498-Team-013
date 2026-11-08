import { one, type Query } from '../../../../packages/db/src/db.js';
export async function badgeProgress(q: Query, user: string, rule: any) {
  const target = rule.gte ?? rule.count ?? rule.slugs?.length ?? 1;
  let current = 0;
  switch (rule.type) {
    case 'cleared_count':
      current = (
        await one(q, "SELECT count(*)::int n FROM progress WHERE user_id=$1 AND status='cleared'", [
          user,
        ])
      ).n;
      break;
    case 'clears_with_budget_ratio':
      current = (
        await one(
          q,
          `SELECT count(*)::int n FROM progress p JOIN submissions s ON s.id=p.first_cleared_submission_id WHERE p.user_id=$1 AND s.token_count::float/s.token_budget<=$2`,
          [user, rule.lte],
        )
      ).n;
      break;
    case 'clear_challenges':
      current = (
        await one(
          q,
          `SELECT count(*)::int n FROM progress p JOIN challenges c ON c.id=p.challenge_id JOIN submissions s ON s.id=p.first_cleared_submission_id WHERE p.user_id=$1 AND p.status='cleared' AND c.slug=ANY($2::text[]) AND ($3::boolean=false OR NOT EXISTS(SELECT 1 FROM submissions old WHERE old.user_id=p.user_id AND old.challenge_id=p.challenge_id AND old.created_at<s.created_at AND old.status<>'error')) AND ($4::float IS NULL OR s.token_count::float/s.token_budget<=$4)`,
          [user, rule.slugs, !!rule.first_try, rule.budget_ratio_lte ?? null],
        )
      ).n;
      break;
    case 'level_complete': {
      const r = await one(
        q,
        `SELECT count(*)::int total,count(p.first_cleared_at)::int n FROM challenges c JOIN levels l ON l.id=c.level_id LEFT JOIN progress p ON p.challenge_id=c.id AND p.user_id=$1 WHERE l.slug=$2 AND c.published`,
        [user, rule.level],
      );
      return { current: r.n, target: r.total, met: r.total > 0 && r.n === r.total };
    }
    case 'streak_gte':
      current =
        (await one(q, 'SELECT current_streak n FROM user_stats WHERE user_id=$1', [user]))?.n ?? 0;
      break;
    case 'total_xp_gte':
      current = Number(
        (await one(q, 'SELECT COALESCE(sum(amount),0) n FROM xp_events WHERE user_id=$1', [user]))
          .n,
      );
      break;
  }
  return { current, target, met: current >= target };
}
export async function refreshStats(q: Query, user: string) {
  await q.query(`INSERT INTO user_stats(user_id) VALUES($1) ON CONFLICT DO NOTHING`, [user]);
  await q.query(
    `UPDATE user_stats SET total_xp=(SELECT COALESCE(sum(amount),0) FROM xp_events WHERE user_id=$1), cleared_count=(SELECT count(*) FROM progress WHERE user_id=$1 AND status='cleared'), avg_budget_used=(SELECT avg(s.token_count::float/s.token_budget) FROM progress p JOIN submissions s ON s.id=p.first_cleared_submission_id WHERE p.user_id=$1),updated_at=now() WHERE user_id=$1`,
    [user],
  );
}
export async function award(
  q: Query,
  user: string,
  amount: number,
  reason: string,
  key: string,
  challenge: string | null = null,
  submission: string | null = null,
  badge: string | null = null,
) {
  return one(
    q,
    `INSERT INTO xp_events(user_id,amount,reason,dedupe_key,challenge_id,submission_id,badge_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,dedupe_key) DO NOTHING RETURNING amount`,
    [user, amount, reason, key, challenge, submission, badge],
  );
}
export async function finalize(q: Query, submission: any, checks: any[], results: any[]) {
  // Caller owns a user row lock: two submissions clearing the same challenge cannot both win.
  const s = await one(q, 'SELECT * FROM submissions WHERE id=$1 FOR UPDATE', [submission.id]);
  if (['passed', 'failed', 'error'].includes(s.status)) return;
  const required = checks.filter((c) => c.required && c.type !== 'code_tests');
  const passed = required.every((c) => results.some((r) => r.key === c.key && r.passed));
  const scored = checks.filter((c) => c.type !== 'code_tests');
  const score =
    scored.reduce((n, c) => n + c.weight * (results.find((r) => r.key === c.key)?.score ?? 0), 0) /
    Math.max(
      scored.reduce((n, c) => n + c.weight, 0),
      1,
    );
  for (const r of results) {
    const c = checks.find((x) => x.key === r.key);
    await q.query(
      'INSERT INTO submission_check_results(submission_id,check_key,type,label,passed,score,message,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
      [
        s.id,
        r.key,
        c.type,
        c.label,
        r.passed,
        r.score,
        r.message ?? null,
        JSON.stringify(r.details ?? (r.skipped ? { skipped: true } : {})),
      ],
    );
  }
  await q.query(
    `INSERT INTO progress(user_id,challenge_id,attempts,last_attempt_at) VALUES($1,$2,0,now()) ON CONFLICT DO NOTHING`,
    [s.user_id, s.challenge_id],
  );
  const previous = await one(
    q,
    'SELECT * FROM progress WHERE user_id=$1 AND challenge_id=$2 FOR UPDATE',
    [s.user_id, s.challenge_id],
  );
  const first = passed && !previous.first_cleared_at;
  await q.query(
    `UPDATE progress SET attempts=attempts+1,last_attempt_at=now(),status=CASE WHEN $3 THEN 'cleared'::progress_status ELSE status END,best_token_count=CASE WHEN $3 THEN LEAST(COALESCE(best_token_count,$4),$4) ELSE best_token_count END,first_cleared_at=CASE WHEN $3 THEN COALESCE(first_cleared_at,now()) ELSE first_cleared_at END,first_cleared_submission_id=CASE WHEN $3 THEN COALESCE(first_cleared_submission_id,$5) ELSE first_cleared_submission_id END WHERE user_id=$1 AND challenge_id=$2`,
    [s.user_id, s.challenge_id, passed, s.token_count, s.id],
  );
  let xp = 0;
  const give = async (amount: number, reason: string, key: string, badge: string | null = null) => {
    const x = await award(q, s.user_id, amount, reason, key, s.challenge_id, s.id, badge);
    xp += x?.amount ?? 0;
  };
  if (first) {
    const v = await one(q, 'SELECT xp FROM challenge_versions WHERE id=$1', [
      s.challenge_version_id,
    ]);
    await give(v.xp, 'challenge_clear', `clear:${s.challenge_id}`);
    if (s.token_count <= s.token_budget * 0.5)
      await give(Math.round(v.xp * 0.2), 'efficiency_bonus', `efficiency:${s.challenge_id}`);
  }
  await q.query('UPDATE submissions SET status=$2,passed=$3,score=$4,graded_at=now() WHERE id=$1', [
    s.id,
    passed ? 'passed' : 'failed',
    passed,
    score,
  ]);
  if (passed) {
    const daily = await one(
      q,
      "SELECT * FROM daily_challenges WHERE date=(now() AT TIME ZONE 'UTC')::date AND challenge_id=$1",
      [s.challenge_id],
    );
    if (daily)
      await give(
        daily.bonus_xp,
        'daily_bonus',
        `daily:${new Date(daily.date).toISOString().slice(0, 10)}`,
      );
    await q.query('INSERT INTO user_stats(user_id) VALUES($1) ON CONFLICT DO NOTHING', [s.user_id]);
    const previousActivity = await one(
      q,
      'SELECT last_active_date FROM user_stats WHERE user_id=$1',
      [s.user_id],
    );
    await q.query(
      `UPDATE user_stats SET current_streak=CASE WHEN last_active_date=(now() AT TIME ZONE u.timezone)::date THEN current_streak WHEN last_active_date=(now() AT TIME ZONE u.timezone)::date-1 THEN current_streak+1 ELSE 1 END, last_active_date=(now() AT TIME ZONE u.timezone)::date FROM users u WHERE user_stats.user_id=u.id AND u.id=$1`,
      [s.user_id],
    );
    await q.query(
      'UPDATE user_stats SET best_streak=GREATEST(best_streak,current_streak) WHERE user_id=$1',
      [s.user_id],
    );
    const currentActivity = await one(
      q,
      'SELECT last_active_date FROM user_stats WHERE user_id=$1',
      [s.user_id],
    );
    if (String(previousActivity?.last_active_date) !== String(currentActivity?.last_active_date))
      await q.query("INSERT INTO events(user_id,kind,payload) VALUES($1,'streak_extended',$2)", [
        s.user_id,
        JSON.stringify({ submissionId: s.id }),
      ]);
    await refreshStats(q, s.user_id);
    for (const b of (
      await q.query(
        'SELECT b.* FROM badges b WHERE NOT EXISTS(SELECT 1 FROM user_badges ub WHERE ub.badge_id=b.id AND ub.user_id=$1) ORDER BY position',
        [s.user_id],
      )
    ).rows) {
      if ((await badgeProgress(q, s.user_id, b.rule)).met) {
        await q.query(
          'INSERT INTO user_badges(user_id,badge_id,submission_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [s.user_id, b.id, s.id],
        );
        if (b.xp) await give(b.xp, 'badge', `badge:${b.id}`, b.id);
        await q.query(
          "INSERT INTO notifications(user_id,kind,payload) VALUES($1,'badge_earned',$2)",
          [s.user_id, JSON.stringify({ slug: b.slug, name: b.name, mark: b.mark })],
        );
        await q.query("INSERT INTO events(user_id,kind,payload) VALUES($1,'badge_earned',$2)", [
          s.user_id,
          JSON.stringify({ badgeId: b.id, submissionId: s.id }),
        ]);
      }
    }
  }
  await q.query('UPDATE submissions SET xp_awarded=$2 WHERE id=$1', [s.id, xp]);
  await refreshStats(q, s.user_id);
  await q.query('INSERT INTO events(user_id,kind,payload) VALUES($1,$2,$3)', [
    s.user_id,
    passed ? 'submission_passed' : 'submission_failed',
    JSON.stringify({ submissionId: s.id }),
  ]);
}
