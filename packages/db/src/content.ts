import { loadContent, loadDailyOverrides } from '../../content/src/loader.js';
import { hash, canonicalJson } from '../../shared/src/utils.js';
import { Database, one, type Query } from './db.js';
export async function syncContent(db: Database, actor: string | null = null) {
  const content = await loadContent();
  return db.tx(async (q) => {
    await q.query('LOCK TABLE challenges IN EXCLUSIVE MODE');
    const summary = { created: 0, updated: 0, unpublished: 0 };
    for (const l of content.levels)
      await q.query(
        `INSERT INTO levels(slug,position,code,name,blurb,tip,accent,unlock_rule) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,blurb=excluded.blurb,tip=excluded.tip,accent=excluded.accent,unlock_rule=excluded.unlock_rule`,
        [l.slug, l.position, l.code, l.name, l.blurb, l.tip, l.accent, JSON.stringify(l.unlock)],
      );
    for (const c of content.challenges) {
      const l = await one(q, 'SELECT id FROM levels WHERE slug=$1', [c.level]);
      let row = await one(
        q,
        `SELECT c.*,v.content_hash FROM challenges c LEFT JOIN challenge_versions v ON v.id=c.current_version_id WHERE c.slug=$1`,
        [c.slug],
      );
      if (!row) {
        row = await one(
          q,
          'INSERT INTO challenges(slug,level_id,position,published) VALUES($1,$2,$3,$4) RETURNING *',
          [c.slug, l.id, c.position, c.published],
        );
        summary.created++;
      } else
        await q.query('UPDATE challenges SET level_id=$2,position=$3,published=$4 WHERE id=$1', [
          row.id,
          l.id,
          c.position,
          c.published,
        ]);
      const digest = hash(canonicalJson(c));
      if (row.content_hash === digest) continue;
      const ver = await one(
        q,
        'SELECT COALESCE(max(version),0)+1 AS n FROM challenge_versions WHERE challenge_id=$1',
        [row.id],
      );
      const v = await one(
        q,
        `INSERT INTO challenge_versions(challenge_id,version,title,brief,hint,tags,token_budget,xp,difficulty,context,run_config,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          row.id,
          ver.n,
          c.title,
          c.brief,
          c.hint,
          c.tags,
          c.token_budget,
          c.xp,
          c.difficulty,
          JSON.stringify(c.context),
          c.run ? JSON.stringify(c.run) : null,
          digest,
        ],
      );
      const checks = [
        {
          key: 'token_budget',
          type: 'token_budget',
          phase: 'instant',
          label: `Under ${c.token_budget} tokens`,
          config: {},
          required: true,
          weight: 1,
          client_visible: true,
        },
        ...c.checks,
      ];
      for (const [i, k] of checks.entries())
        await q.query(
          'INSERT INTO challenge_checks(challenge_version_id,key,position,type,phase,label,config,client_visible,weight,required) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            v.id,
            k.key,
            i,
            k.type,
            k.phase,
            k.label,
            JSON.stringify(k.config),
            k.client_visible,
            k.weight,
            k.required,
          ],
        );
      await q.query('UPDATE challenges SET current_version_id=$2 WHERE id=$1', [row.id, v.id]);
      if (row.content_hash) summary.updated++;
    }
    const missing = await q.query(
      'UPDATE challenges SET published=false WHERE published=true AND NOT(slug=ANY($1::text[])) RETURNING id',
      [content.challenges.map((c) => c.slug)],
    );
    summary.unpublished = missing.rows.length;
    await q.query('INSERT INTO audit_log(actor_id,action,data) VALUES($1,$2,$3)', [
      actor,
      'content.sync',
      JSON.stringify(summary),
    ]);
    return summary;
  });
}
export const badgeSeeds = [
  ['first-clear', 'First clear', '01', { type: 'cleared_count', gte: 1 }],
  [
    'under-budget-5',
    'Under budget ×5',
    '≤',
    { type: 'clears_with_budget_ratio', lte: 0.6, count: 5 },
  ],
  [
    'json-whisperer',
    'JSON whisperer',
    '{ }',
    { type: 'clear_challenges', slugs: ['json-only'], first_try: true },
  ],
  ['bug-hunter', 'Bug hunter', 'err', { type: 'level_complete', level: 'iterate-and-debug' }],
  [
    'surgeon',
    'Surgeon',
    'Δ',
    { type: 'clear_challenges', slugs: ['one-change-at-a-time'], budget_ratio_lte: 0.75 },
  ],
  ['shipper', 'Shipper', 'app', { type: 'level_complete', level: 'ship-a-full-program' }],
] as const;
export async function seedBase(q: Query) {
  for (const [i, b] of badgeSeeds.entries())
    await q.query(
      'INSERT INTO badges(slug,name,mark,description,rule,position) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(slug) DO NOTHING',
      [b[0], b[1], b[2], b[1], JSON.stringify(b[3]), i],
    );
  await q.query(
    `INSERT INTO daily_challenges(date,challenge_id) SELECT (now() AT TIME ZONE 'UTC')::date + n, c.id FROM generate_series(0,30) n JOIN (SELECT id,row_number() OVER(ORDER BY slug)-1 r FROM challenges WHERE published) c ON c.r=mod(((now() AT TIME ZONE 'UTC')::date-date '2000-01-01')+n,(SELECT count(*)::int FROM challenges WHERE published)) ON CONFLICT(date) DO NOTHING`,
  );
  for (const override of await loadDailyOverrides()) {
    const c = await one(q, 'SELECT id FROM challenges WHERE slug=$1 AND published', [
      override.challengeSlug,
    ]);
    if (!c)
      throw new Error(
        `Daily override references an unpublished or unknown challenge: ${override.challengeSlug}`,
      );
    await q.query(
      'INSERT INTO daily_challenges(date,challenge_id,bonus_xp,title_override) VALUES($1,$2,$3,$4) ON CONFLICT(date) DO UPDATE SET challenge_id=excluded.challenge_id,bonus_xp=excluded.bonus_xp,title_override=excluded.title_override',
      [override.date, c.id, override.bonusXp, override.title ?? null],
    );
  }
  await q.query(
    `INSERT INTO example_prompts(challenge_id,title,prompt,explanation) SELECT id,'Reverse a string','Write a Python function to reverse a string.','Names the language and the required action explicitly.' FROM challenges WHERE slug='hello-function' AND NOT EXISTS(SELECT 1 FROM example_prompts WHERE challenge_id=challenges.id)`,
  );
}
