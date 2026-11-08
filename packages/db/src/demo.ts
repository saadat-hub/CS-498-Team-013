import { Database, one } from './db.js';
import { newUser } from '../../../apps/api/src/auth.js';
import { refreshStats } from '../../../apps/api/src/services/progress.js';
export async function seedDemo(db: Database) {
  await db.tx(async (q) => {
    if (await one(q, "SELECT 1 FROM users WHERE email='alex@example.com'")) return;
    const u = await newUser(q, 'alex@example.com', 'Alex Rivera');
    await q.query("UPDATE users SET handle='alex_rivera' WHERE id=$1", [u.id]);
    const cs = (
      await q.query(
        `SELECT c.id,v.id version_id,v.token_budget,v.xp FROM challenges c JOIN levels l ON l.id=c.level_id JOIN challenge_versions v ON v.id=c.current_version_id WHERE c.slug=ANY(ARRAY['hello-function','return-the-max','no-libraries','edge-case-hunter','json-only']) ORDER BY l.position,c.position`,
      )
    ).rows;
    for (const [i, c] of cs.entries()) {
      const date = new Date(Date.now() - (5 - i) * 86400000).toISOString();
      const s = await one(
        q,
        `INSERT INTO submissions(user_id,challenge_id,challenge_version_id,idempotency_key,prompt,prompt_sha256,token_count,token_counter,token_budget,status,passed,score,xp_awarded,created_at,graded_at) VALUES($1,$2,$3,$4,'Demo fixture (not a graded learner attempt)','demo',$5,'estimate:v1',$6,'passed',true,1,$7,$8,$8) RETURNING id`,
        [
          u.id,
          c.id,
          c.version_id,
          `demo-${i}`,
          Math.ceil(c.token_budget * 0.62),
          c.token_budget,
          c.xp,
          date,
        ],
      );
      await q.query(
        "INSERT INTO progress(user_id,challenge_id,status,attempts,best_token_count,first_cleared_at,first_cleared_submission_id) VALUES($1,$2,'cleared',1,$3,$4,$5)",
        [u.id, c.id, Math.ceil(c.token_budget * 0.62), date, s.id],
      );
      await q.query(
        "INSERT INTO xp_events(user_id,amount,reason,challenge_id,submission_id,dedupe_key,created_at) VALUES($1,$2,'challenge_clear',$3,$4,$5,$6)",
        [u.id, c.xp, c.id, s.id, `clear:${c.id}`, date],
      );
    }
    // The design asks for 425 XP although the five base clears total 350. Explicit fixture adjustment keeps the ledger honest.
    await q.query(
      "INSERT INTO xp_events(user_id,amount,reason,dedupe_key) VALUES($1,75,'admin_adjust','demo-fixture-adjustment')",
      [u.id],
    );
    await q.query(
      'UPDATE user_stats SET current_streak=6,best_streak=9,last_active_date=current_date WHERE user_id=$1',
      [u.id],
    );
    await refreshStats(q, u.id);
    await q.query(
      'INSERT INTO user_badges(user_id,badge_id) SELECT $1,id FROM badges WHERE slug=ANY($2::text[])',
      [u.id, ['first-clear', 'under-budget-5', 'json-whisperer']],
    );
    await q.query(
      "INSERT INTO drafts(user_id,challenge_id,prompt,token_estimate,instant_passed,instant_total) SELECT $1,id,'Write a single file HTML page. Code only, no explanation.',17,2,4 FROM challenges WHERE slug='one-file-no-chatter'",
      [u.id],
    );
  });
}
