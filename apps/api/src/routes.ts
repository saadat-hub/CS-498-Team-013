import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Database, one } from '../../../packages/db/src/db.js';
import { LlmService } from '../../../packages/llm/src/provider.js';
import { camel, fail, hash } from '../../../packages/shared/src/utils.js';
import { estimate } from '../../../packages/grading/src/instant.js';
import { runInstant } from '../../../packages/grading/src/server.js';
import { requireUser, role, publicUser } from './auth.js';
import { GradingService } from './services/grading.js';
import {
  getChallenge,
  levels,
  latestDraft,
  submissionResult,
  badges,
  leaderboard,
  pagination,
  page,
  unlocked,
} from './services/queries.js';
import { syncContent } from '../../../packages/db/src/content.js';
import { refreshStats } from './services/progress.js';
const prompt = z
  .string()
  .min(1)
  .max(20000)
  .refine((s) => s.trim().length > 0, 'Prompt must not be blank');
const profile = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    handle: z
      .string()
      .regex(/^[a-z0-9_]{3,20}$/)
      .optional(),
    timezone: z
      .string()
      .refine((s) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: s });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone')
      .optional(),
    leaderboardOptIn: z.boolean().optional(),
    avatarUrl: z.url().startsWith('https://').nullable().optional(),
  })
  .strict();
export async function routes(
  app: FastifyInstance,
  db: Database,
  llm: LlmService,
  grading: GradingService,
  enqueue: (id: string) => Promise<void>,
) {
  const get = (path: string, fn: any) => app.get(`/api/v1${path}`, fn);
  const post = (path: string, fn: any) => app.post(`/api/v1${path}`, fn);
  get('/me', async (r: any) => publicUser(requireUser(r)));
  app.patch('/api/v1/me', async (r) => {
    const u = requireUser(r),
      b = profile.parse(r.body),
      columns: Record<string, string> = {
        displayName: 'display_name',
        handle: 'handle',
        timezone: 'timezone',
        leaderboardOptIn: 'leaderboard_opt_in',
        avatarUrl: 'avatar_url',
      };
    const entries = Object.entries(b);
    if (entries.length) {
      await db.query(
        `UPDATE users SET ${entries.map(([k], i) => `${columns[k]}=$${i + 2}`).join(',')},updated_at=now() WHERE id=$1`,
        [u.id, ...entries.map(([, v]) => v)],
      );
    }
    return publicUser(await one(db, 'SELECT * FROM users WHERE id=$1', [u.id]));
  });
  post('/me/onboarding', async (r: any) => {
    const u = requireUser(r),
      b = profile
        .extend({
          displayName: z.string().min(1).max(40),
          handle: z.string().regex(/^[a-z0-9_]{3,20}$/),
          timezone: profile.shape.timezone.unwrap(),
          experience: z.enum(['new', 'some', 'pro']),
        })
        .parse(r.body);
    await db.query(
      'UPDATE users SET display_name=$2,handle=$3,timezone=$4,updated_at=now() WHERE id=$1',
      [u.id, b.displayName, b.handle, b.timezone],
    );
    return publicUser(await one(db, 'SELECT * FROM users WHERE id=$1', [u.id]));
  });
  get('/me/export', async (r: any) => {
    const u = requireUser(r),
      data: any = { user: publicUser(u) };
    for (const table of [
      'drafts',
      'submissions',
      'progress',
      'xp_events',
      'user_stats',
      'user_badges',
      'saved_prompts',
      'notifications',
      'llm_usage',
      'events',
    ])
      data[table] = camel((await db.query(`SELECT * FROM ${table} WHERE user_id=$1`, [u.id])).rows);
    data.checkResults = camel(
      (
        await db.query(
          'SELECT r.* FROM submission_check_results r JOIN submissions s ON s.id=r.submission_id WHERE s.user_id=$1',
          [u.id],
        )
      ).rows,
    );
    return data;
  });
  app.delete('/api/v1/me', async (r, reply) => {
    const u = requireUser(r);
    await db.tx(async (q) => {
      await q.query('UPDATE users SET deleted_at=now(),leaderboard_opt_in=false WHERE id=$1', [
        u.id,
      ]);
      await q.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    });
    reply.clearCookie('pl_session', { path: '/' });
    return reply.code(204).send();
  });
  get('/levels', async (r: any) => ({ items: await levels(db, r.user?.id ?? null) }));
  get('/challenges', async (r: any) => {
    const filters = z
      .object({
        track: z.enum(['machine-learning', 'foundational']).optional(),
        tag: z.string().max(80).optional(),
        level: z.string().max(100).optional(),
        limit: z.string().optional(),
        cursor: z.string().optional(),
      })
      .parse(r.query);
    const { limit, offset } = pagination(filters);
    const rows = (
      await db.query(
        `SELECT c.slug,l.slug level_slug,l.position||'.'||c.position code,v.title,v.brief,v.tags,v.token_budget,v.xp,COALESCE(v.context->>'track','foundational') track FROM challenges c JOIN challenge_versions v ON v.id=c.current_version_id JOIN levels l ON l.id=c.level_id WHERE c.published AND l.published AND ($1::text IS NULL OR COALESCE(v.context->>'track','foundational')=$1) AND ($2::text IS NULL OR $2=ANY(v.tags)) AND ($3::text IS NULL OR l.slug=$3) ORDER BY l.position,c.position LIMIT $4 OFFSET $5`,
        [filters.track ?? null, filters.tag ?? null, filters.level ?? null, limit + 1, offset],
      )
    ).rows;
    return page(rows, limit, offset);
  });
  get('/levels/:slug/challenges', async (r: any) => {
    const l = await one(db, 'SELECT * FROM levels WHERE slug=$1 AND published', [r.params.slug]);
    if (!l) fail(404, 'not_found', 'Level not found');
    const items = (
      await db.query(
        `SELECT c.slug,l.position||'.'||c.position code,v.title,v.token_budget,v.xp,v.tags,json_build_object('status',COALESCE(p.status::text,'not_started'),'bestTokenCount',p.best_token_count,'attempts',COALESCE(p.attempts,0)) me FROM challenges c JOIN levels l ON l.id=c.level_id JOIN challenge_versions v ON v.id=c.current_version_id LEFT JOIN progress p ON p.challenge_id=c.id AND p.user_id=$1 WHERE c.level_id=$2 AND c.published AND c.position<100 ORDER BY c.position`,
        [r.user?.id ?? null, l.id],
      )
    ).rows;
    return { level: camel(l), items: camel(items) };
  });
  get('/challenges/:slug', async (r: any) => {
    const c = await getChallenge(db, r.params.slug),
      u = r.user?.id ?? null;
    if (u)
      await db.query("INSERT INTO events(user_id,kind,payload) VALUES($1,'challenge_viewed',$2)", [
        u,
        JSON.stringify({ challengeId: c.challenge_id }),
      ]);
    const progress = u
      ? await one(db, 'SELECT * FROM progress WHERE user_id=$1 AND challenge_id=$2', [
          u,
          c.challenge_id,
        ])
      : null;
    const draft = u
      ? await one(db, 'SELECT * FROM drafts WHERE user_id=$1 AND challenge_id=$2', [
          u,
          c.challenge_id,
        ])
      : null;
    const neighbours = (
      await db.query(
        `SELECT c.slug FROM challenges c JOIN levels l ON l.id=c.level_id WHERE c.published ORDER BY l.position,c.position`,
      )
    ).rows;
    const index = neighbours.findIndex((x) => x.slug === c.slug);
    return {
      slug: c.slug,
      code: `${Number(c.level_code)}.${c.position}`,
      version: c.version,
      level: { slug: c.level_slug, code: c.level_code, name: c.level_name },
      title: c.title,
      brief: c.brief,
      hint: c.hint,
      tags: c.tags,
      tokenBudget: c.token_budget,
      xp: c.xp,
      context: c.context,
      runsModel: !!c.run_config,
      checks: c.checks
        .filter((x: any) => x.client_visible)
        .map((x: any) => ({
          key: x.key,
          type: x.type,
          phase: x.phase,
          label: x.label,
          config: x.phase === 'instant' ? x.config : null,
          required: x.required,
        })),
      me: {
        status: progress?.status ?? 'not_started',
        draft: camel(draft),
        bestTokenCount: progress?.best_token_count ?? null,
        locked: !(await unlocked(db, c, u)),
      },
      prev: neighbours[index - 1] ?? null,
      next: neighbours[index + 1] ?? null,
    };
  });
  app.post(
    '/api/v1/tokens/count',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (r) => {
      const b = z.object({ text: z.string().max(20000) }).parse(r.body);
      return llm.count(b.text, r.user?.id ?? null);
    },
  );
  get('/drafts/latest', async (r: any) => latestDraft(db, requireUser(r).id));
  get('/drafts/:slug', async (r: any) => {
    const c = await getChallenge(db, r.params.slug);
    return camel(
      await one(db, 'SELECT * FROM drafts WHERE user_id=$1 AND challenge_id=$2', [
        requireUser(r).id,
        c.challenge_id,
      ]),
    );
  });
  app.put(
    '/api/v1/drafts/:slug',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (r) => {
      const u = requireUser(r),
        c = await getChallenge(db, (r.params as any).slug),
        b = z
          .object({
            prompt: z.string().max(20000),
            rev: z.number().int().nonnegative(),
            tokenEstimate: z.number().optional(),
            instantPassed: z.number().optional(),
            instantTotal: z.number().optional(),
          })
          .parse(r.body);
      const count = estimate(b.prompt),
        results = c.checks
          .filter((k: any) => k.phase === 'instant')
          .map((k: any) => runInstant(k, b.prompt, count, c.token_budget));
      return db.tx(async (q) => {
        await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id]);
        const old = await one(q, 'SELECT * FROM drafts WHERE user_id=$1 AND challenge_id=$2', [
          u.id,
          c.challenge_id,
        ]);
        if (b.rev !== (old?.rev ?? 0))
          fail(409, 'draft_conflict', 'The draft changed in another tab', { draft: camel(old) });
        return camel(
          await one(
            q,
            `INSERT INTO drafts(user_id,challenge_id,prompt,token_estimate,instant_passed,instant_total) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,challenge_id) DO UPDATE SET prompt=excluded.prompt,token_estimate=excluded.token_estimate,instant_passed=excluded.instant_passed,instant_total=excluded.instant_total,rev=drafts.rev+1,updated_at=now() RETURNING *`,
            [
              u.id,
              c.challenge_id,
              b.prompt,
              count,
              results.filter((x: any) => x.passed).length,
              results.length,
            ],
          ),
        );
      });
    },
  );
  app.delete('/api/v1/drafts/:slug', async (r, reply) => {
    const c = await getChallenge(db, (r.params as any).slug);
    await db.query('DELETE FROM drafts WHERE user_id=$1 AND challenge_id=$2', [
      requireUser(r).id,
      c.challenge_id,
    ]);
    return reply.code(204).send();
  });
  app.post(
    '/api/v1/submissions',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (r: any) => r.user?.id ?? r.ip,
        },
      },
    },
    async (r, reply) => {
      const u = requireUser(r),
        b = z
          .object({ challengeSlug: z.string(), prompt, idempotencyKey: z.string().min(8).max(100) })
          .parse(r.body);
      let existing = await one(
        db,
        'SELECT * FROM submissions WHERE user_id=$1 AND idempotency_key=$2',
        [u.id, b.idempotencyKey],
      );
      if (existing) {
        if (
          existing.prompt !== b.prompt ||
          existing.challenge_id !== (await getChallenge(db, b.challengeSlug)).challenge_id
        )
          fail(409, 'idempotency_conflict', 'Use a new idempotency key for a different prompt');
        return reply
          .code(['queued', 'grading'].includes(existing.status) ? 202 : 200)
          .send(await submissionResult(db, existing.id));
      }
      const c = await getChallenge(db, b.challengeSlug);
      if (!(await unlocked(db, c, u.id)))
        fail(403, 'level_locked', 'Complete the preceding level first');
      const count = await llm.count(b.prompt, u.id),
        model = c.checks.some((x: any) => x.phase === 'model' && x.type !== 'code_tests');
      if (model && llm.config.LLM_PROVIDER === 'disabled')
        fail(
          503,
          'ai_not_configured',
          'This challenge needs AI grading. Configure Anthropic to submit, or try a foundational level 1 or 2 challenge.',
        );
      const created = await db.tx(async (q) => {
        await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id]);
        existing = await one(
          q,
          'SELECT * FROM submissions WHERE user_id=$1 AND idempotency_key=$2',
          [u.id, b.idempotencyKey],
        );
        if (existing) {
          if (existing.prompt !== b.prompt || existing.challenge_id !== c.challenge_id)
            fail(409, 'idempotency_conflict', 'Use a new idempotency key for a different request');
          return { s: existing, fresh: false };
        }
        const quota = await one(
          q,
          `SELECT count(*)::int n FROM submissions WHERE user_id=$1 AND status<>'error' AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
          [u.id],
        );
        if (quota.n >= 200) fail(429, 'daily_submission_quota', 'Daily submission limit reached');
        const s = await one(
          q,
          `INSERT INTO submissions(user_id,challenge_id,challenge_version_id,idempotency_key,prompt,prompt_sha256,token_count,token_counter,token_budget) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            u.id,
            c.challenge_id,
            c.id,
            b.idempotencyKey,
            b.prompt,
            hash(b.prompt),
            count.count,
            count.counter,
            c.token_budget,
          ],
        );
        await q.query(
          "INSERT INTO events(user_id,kind,payload) VALUES($1,'submission_created',$2)",
          [u.id, JSON.stringify({ submissionId: s.id, challengeId: c.challenge_id })],
        );
        if (model)
          await q.query(
            'INSERT INTO submission_dispatch(submission_id) VALUES($1) ON CONFLICT DO NOTHING',
            [s.id],
          );
        return { s, fresh: true };
      });
      if (created.fresh) {
        if (model) {
          try {
            const blocked = c.checks.some(
              (k: any) =>
                k.required &&
                k.phase === 'instant' &&
                !runInstant(k, b.prompt, count.count, c.token_budget).passed,
            );
            if (!blocked) await llm.reserve(u.id, created.s.id, c, c.checks);
            try {
              await enqueue(created.s.id);
              await db.query('DELETE FROM submission_dispatch WHERE submission_id=$1', [
                created.s.id,
              ]);
            } catch {
              r.log.warn(
                { submissionId: created.s.id },
                'Queue delivery deferred to durable dispatcher',
              );
            }
          } catch (e) {
            await db.query(
              "UPDATE submissions SET status='error',error_code='grading_paused',graded_at=now() WHERE id=$1",
              [created.s.id],
            );
            await db.query(
              'UPDATE model_reservations SET reserved_micros=0 WHERE submission_id=$1',
              [created.s.id],
            );
            throw e;
          }
        } else await grading.grade(created.s.id);
      }
      const result = await submissionResult(db, created.s.id);
      if (['queued', 'grading'].includes(result.status))
        result.instantChecks = c.checks
          .filter((k: any) => k.phase === 'instant')
          .map((k: any) => ({
            ...runInstant(k, b.prompt, count.count, c.token_budget),
            label: k.label,
          }));
      return reply.code(['queued', 'grading'].includes(result.status) ? 202 : 200).send(result);
    },
  );
  const own = async (r: any) => {
    const u = requireUser(r),
      s = await one(db, 'SELECT * FROM submissions WHERE id=$1', [z.uuid().parse(r.params.id)]);
    if (!s || (s.user_id !== u.id && u.role !== 'admin'))
      fail(404, 'not_found', 'Submission not found');
    return s;
  };
  get('/submissions/:id', async (r: any) => {
    await own(r);
    return submissionResult(db, r.params.id);
  });
  get('/submissions/:id/events', async (r: any, reply: any) => {
    await own(r);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Request-Id': r.id,
    });
    let closed = false,
      busy = false,
      ticks = 0;
    const stop = () => {
      closed = true;
      clearInterval(timer);
    };
    reply.raw.on('close', stop);
    const deliveredChecks = new Set<string>();
    const tick = async () => {
      if (closed || busy) return;
      busy = true;
      try {
        const s = await submissionResult(db, r.params.id);
        const interim = await llm.cache.get(`submission:${r.params.id}:checks`);
        for (const check of interim ? JSON.parse(interim) : s.checks)
          if (!deliveredChecks.has(check.key)) {
            reply.raw.write(`event: check\ndata: ${JSON.stringify(check)}\n\n`);
            deliveredChecks.add(check.key);
          }
        reply.raw.write(
          `event: ${['passed', 'failed'].includes(s.status) ? 'done' : s.status === 'error' ? 'error' : 'status'}\ndata: ${JSON.stringify(s)}\n\n`,
        );
        if (['passed', 'failed', 'error'].includes(s.status)) {
          stop();
          reply.raw.end();
        } else if (++ticks % 15 === 0) reply.raw.write(': heartbeat\n\n');
      } catch {
        stop();
        reply.raw.end();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, 1000);
    await tick();
  });
  get('/submissions', async (r: any) => {
    const u = requireUser(r),
      { limit, offset } = pagination(r.query),
      rows = (
        await db.query(
          `SELECT s.id,c.slug challenge_slug,l.position||'.'||c.position code,v.title challenge_title,s.token_count,s.token_budget,s.created_at,CASE WHEN s.status='passed' THEN 'pass' WHEN s.status='error' THEN 'error' WHEN s.status IN ('queued','grading') THEN 'pending' WHEN s.token_count>s.token_budget AND NOT EXISTS(SELECT 1 FROM submission_check_results cr JOIN challenge_checks ck ON ck.challenge_version_id=s.challenge_version_id AND ck.key=cr.check_key WHERE cr.submission_id=s.id AND ck.required AND NOT cr.passed AND cr.type<>'token_budget') THEN 'over' ELSE 'fail' END result FROM submissions s JOIN challenges c ON c.id=s.challenge_id JOIN challenge_versions v ON v.id=s.challenge_version_id JOIN levels l ON l.id=c.level_id WHERE s.user_id=$1 AND ($2::text IS NULL OR c.slug=$2) ORDER BY s.created_at DESC,s.id DESC LIMIT $3 OFFSET $4`,
          [u.id, r.query.challengeSlug ?? null, limit + 1, offset],
        )
      ).rows;
    return page(rows, limit, offset);
  });
  get('/badges', async (r: any) => ({ items: await badges(db, requireUser(r).id) }));
  get('/leaderboard', async (r: any) =>
    leaderboard(
      db,
      r.user?.id ?? null,
      z.enum(['week', 'alltime']).default('week').parse(r.query.scope),
      pagination(r.query).limit,
    ),
  );
  get('/daily', async (r: any) => daily(r.user?.id ?? null));
  async function daily(user: string | null) {
    return camel(
      await one(
        db,
        `SELECT d.*,c.slug challenge_slug,COALESCE(d.title_override,v.title) title,EXISTS(SELECT 1 FROM xp_events x WHERE x.user_id=$1 AND x.dedupe_key='daily:'||d.date::text) done_today FROM daily_challenges d JOIN challenges c ON c.id=d.challenge_id JOIN challenge_versions v ON v.id=c.current_version_id WHERE d.date=(now() AT TIME ZONE 'UTC')::date AND c.published`,
        [user],
      ),
    );
  }
  get('/search', async (r: any) => {
    const q = z.string().trim().min(1).max(200).parse(r.query.q);
    return {
      items: camel(
        (
          await db.query(
            `SELECT c.slug,v.title,v.brief,v.tags FROM challenges c JOIN challenge_versions v ON v.id=c.current_version_id WHERE c.published AND (to_tsvector('english',v.title||' '||v.brief) @@ plainto_tsquery('english',$1) OR $1=ANY(v.tags)) LIMIT 50`,
            [q],
          )
        ).rows,
      ),
    };
  });
  get('/library', async (r: any) => {
    const u = requireUser(r),
      { limit, offset } = pagination(r.query);
    return page(
      (
        await db.query(
          `SELECT * FROM (
SELECT id,title,prompt,tags,created_at,'saved' kind,submission_id FROM saved_prompts WHERE user_id=$1
UNION ALL
SELECT e.id,e.title,e.prompt,'{}'::text[] tags, '2000-01-01'::timestamptz created_at,'example' kind,NULL::uuid submission_id FROM example_prompts e WHERE e.reveal_after='always' OR EXISTS(SELECT 1 FROM progress p WHERE p.user_id=$1 AND p.challenge_id=e.challenge_id AND p.status='cleared')
) library WHERE ($2::text IS NULL OR title ILIKE '%'||$2||'%' OR prompt ILIKE '%'||$2||'%') AND ($3::text IS NULL OR $3=ANY(tags)) ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
          [u.id, r.query.q ?? null, r.query.tag ?? null, limit + 1, offset],
        )
      ).rows,
      limit,
      offset,
    );
  });
  post('/library', async (r: any) => {
    const u = requireUser(r),
      b = z
        .object({
          title: z.string().min(1).max(80),
          prompt,
          tags: z.array(z.string().max(40)).max(20).default([]),
          submissionId: z.uuid().optional(),
        })
        .parse(r.body);
    if (
      b.submissionId &&
      !(await one(db, 'SELECT id FROM submissions WHERE id=$1 AND user_id=$2', [
        b.submissionId,
        u.id,
      ]))
    )
      fail(404, 'not_found', 'Submission not found');
    return camel(
      await one(
        db,
        'INSERT INTO saved_prompts(user_id,title,prompt,tags,submission_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [u.id, b.title, b.prompt, b.tags, b.submissionId ?? null],
      ),
    );
  });
  app.delete('/api/v1/library/:id', async (r, reply) => {
    await db.query('DELETE FROM saved_prompts WHERE user_id=$1 AND id=$2', [
      requireUser(r).id,
      z.uuid().parse((r.params as any).id),
    ]);
    return reply.code(204).send();
  });
  get('/challenges/:slug/examples', async (r: any) => {
    const c = await getChallenge(db, r.params.slug),
      u = r.user?.id ?? null;
    if (u)
      await db.query("INSERT INTO events(user_id,kind,payload) VALUES($1,'challenge_viewed',$2)", [
        u,
        JSON.stringify({ challengeId: c.challenge_id }),
      ]);
    const cleared = await one(
      db,
      "SELECT 1 FROM progress WHERE user_id=$1 AND challenge_id=$2 AND status='cleared'",
      [u, c.challenge_id],
    );
    const rows = (
      await db.query('SELECT * FROM example_prompts WHERE challenge_id=$1', [c.challenge_id])
    ).rows;
    if (!cleared && rows.some((x) => x.reveal_after === 'clear'))
      fail(403, 'not_cleared', 'Clear this challenge to reveal examples');
    return { items: camel(rows) };
  });
  get('/notifications', async (r: any) => {
    const u = requireUser(r),
      { limit, offset } = pagination(r.query);
    return page(
      (
        await db.query(
          'SELECT * FROM notifications WHERE user_id=$1 AND ($2=false OR read_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4',
          [u.id, r.query.unread === 'true', limit + 1, offset],
        )
      ).rows,
      limit,
      offset,
    );
  });
  post('/notifications/read', async (r: any) => {
    const u = requireUser(r),
      b = z
        .union([
          z.object({ all: z.literal(true) }),
          z.object({ ids: z.array(z.number().int().positive()).max(100) }),
        ])
        .parse(r.body);
    await db.query(
      'UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND ($2 OR id=ANY($3::bigint[]))',
      [u.id, 'all' in b, 'ids' in b ? b.ids : []],
    );
    return { ok: true };
  });
  get('/dashboard', async (r: any) => {
    const u = requireUser(r),
      cached = await llm.cache.get(`dashboard:${u.id}`);
    if (cached) return JSON.parse(cached);
    const stats = await one(
      db,
      `SELECT s.*,CASE WHEN last_active_date<(now() AT TIME ZONE $2)::date-1 THEN 0 ELSE current_streak END visible_streak FROM user_stats s WHERE user_id=$1`,
      [u.id, u.timezone],
    );
    const roadmap = await levels(db, u.id),
      xp = stats?.total_xp ?? 0,
      ranks = [
        { xp: 0, title: 'prompt rookie' },
        { xp: 150, title: 'prompt apprentice' },
        { xp: 300, title: 'prompt smith' },
        { xp: 600, title: 'prompt engineer' },
        { xp: 1000, title: 'prompt architect' },
      ];
    const weeklyXp = camel(
      (
        await db.query(
          `SELECT d::date date,to_char(d,'Dy') dow,COALESCE((SELECT sum(x.amount) FROM xp_events x WHERE x.user_id=$1 AND (x.created_at AT TIME ZONE $2)::date=d::date),0)::int xp FROM generate_series((now() AT TIME ZONE $2)::date-6,(now() AT TIME ZONE $2)::date,interval '1 day') d`,
          [u.id, u.timezone],
        )
      ).rows,
    );
    const response = {
      user: {
        ...publicUser(u),
        initials: u.display_name
          .split(' ')
          .map((x: string) => x[0])
          .slice(0, 2)
          .join(''),
        roadmapLevelCode: roadmap.find((x) => x.me.status !== 'done')?.code ?? '05',
        rankTitle: ranks.filter((x) => xp >= x.xp).at(-1)!.title,
      },
      today: new Intl.DateTimeFormat('en-CA', { timeZone: u.timezone }).format(new Date()),
      stats: {
        totalXp: xp,
        nextRankXp: ranks.find((x) => x.xp > xp)?.xp ?? null,
        streak: { current: stats?.visible_streak ?? 0, best: stats?.best_streak ?? 0 },
        cleared: {
          count: stats?.cleared_count ?? 0,
          total: roadmap.reduce((n, x) => n + x.challengeCount, 0),
          levelsTouched: roadmap.filter((x) => x.me.clearedCount > 0).length,
        },
        avgBudgetUsed: stats?.avg_budget_used ?? null,
      },
      continue: await latestDraft(db, u.id),
      nextChallenge: camel(
        await one(
          db,
          "SELECT c.slug,v.title,v.brief,v.token_budget,v.xp,l.position||'.'||c.position code FROM challenges c JOIN levels l ON l.id=c.level_id JOIN challenge_versions v ON v.id=c.current_version_id LEFT JOIN progress p ON p.challenge_id=c.id AND p.user_id=$1 WHERE c.published AND l.published AND p.first_cleared_at IS NULL AND c.position<100 ORDER BY l.position,c.position LIMIT 1",
          [u.id],
        ),
      ),
      weeklyXp,
      weeklyXpTotal: weeklyXp.reduce((n: number, x: any) => n + x.xp, 0),
      roadmap: roadmap.map((x) => ({
        slug: x.slug,
        code: x.code,
        name: x.name,
        challengeCount: x.challengeCount,
        ...x.me,
      })),
      recentSubmissions: camel(
        (
          await db.query(
            `SELECT s.id,c.slug challenge_slug,l.position||'.'||c.position code,s.status,s.token_count,s.token_budget,s.created_at,v.title challenge_title,CASE WHEN s.status='passed' THEN 'pass' WHEN s.status='error' THEN 'error' WHEN s.status IN ('queued','grading') THEN 'pending' WHEN s.token_count>s.token_budget AND NOT EXISTS(SELECT 1 FROM submission_check_results cr JOIN challenge_checks ck ON ck.challenge_version_id=s.challenge_version_id AND ck.key=cr.check_key WHERE cr.submission_id=s.id AND ck.required AND NOT cr.passed AND cr.type<>'token_budget') THEN 'over' ELSE 'fail' END result FROM submissions s JOIN challenge_versions v ON v.id=s.challenge_version_id JOIN challenges c ON c.id=s.challenge_id JOIN levels l ON l.id=c.level_id WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT 5`,
            [u.id],
          )
        ).rows,
      ),
      leaderboard: await leaderboard(db, u.id, 'week', 3),
      badges: await badges(db, u.id),
      daily: await daily(u.id),
      unreadNotifications: (
        await one(
          db,
          'SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL',
          [u.id],
        )
      ).n,
    };
    await llm.cache.set(`dashboard:${u.id}`, JSON.stringify(response), 15);
    return response;
  });
  // All admin writes are audited, including content operations and moderation.
  app.addHook('onResponse', async (r) => {
    if (r.url.startsWith('/api/v1/admin/') && r.method !== 'GET' && r.user && r.routeOptions.url)
      await db.query('INSERT INTO audit_log(actor_id,action,target,data) VALUES($1,$2,$3,$4)', [
        r.user.id,
        `${r.method} ${r.routeOptions.url}`,
        r.url.split('?')[0],
        JSON.stringify({ requestId: r.id }),
      ]);
  });
  post('/admin/content/sync', async (r: any) => {
    role(r, ['author', 'admin']);
    return syncContent(db, r.user.id);
  });
  get('/admin/challenges', async (r: any) => {
    role(r, ['author', 'admin']);
    return {
      items: camel(
        (
          await db.query(
            'SELECT c.slug,c.published,v.title,v.version,v.token_budget,v.xp,l.code level_code FROM challenges c JOIN challenge_versions v ON v.id=c.current_version_id JOIN levels l ON l.id=c.level_id ORDER BY l.position,c.position',
          )
        ).rows,
      ),
    };
  });
  for (const action of ['publish', 'unpublish'])
    post(`/admin/challenges/:slug/${action}`, async (r: any) => {
      role(r, ['author', 'admin']);
      const c = await one(
        db,
        'UPDATE challenges SET published=$2 WHERE slug=$1 RETURNING slug,published',
        [r.params.slug, action === 'publish'],
      );
      if (!c) fail(404, 'not_found', 'Challenge not found');
      return c;
    });
  post('/admin/challenges/:slug/dry-run', async (r: any) => {
    role(r, ['author', 'admin']);
    const c = await getChallenge(db, r.params.slug, true),
      b = z.object({ prompt }).parse(r.body);
    return grading.dryRun(c, b.prompt, r.user.id);
  });
  get('/admin/users', async (r: any) => {
    role(r);
    const { limit, offset } = pagination(r.query);
    return page(
      (
        await db.query(
          "SELECT id,display_name,handle,role,banned_at,created_at FROM users WHERE ($1::text IS NULL OR handle ILIKE '%'||$1||'%' OR display_name ILIKE '%'||$1||'%') ORDER BY created_at DESC LIMIT $2 OFFSET $3",
          [r.query.q ?? null, limit + 1, offset],
        )
      ).rows,
      limit,
      offset,
    );
  });
  for (const action of ['ban', 'unban'])
    post(`/admin/users/:id/${action}`, async (r: any) => {
      role(r);
      const id = z.uuid().parse(r.params.id);
      await db.tx(async (q) => {
        await q.query(
          `UPDATE users SET banned_at=${action === 'ban' ? 'now()' : 'NULL'} WHERE id=$1`,
          [id],
        );
        if (action === 'ban') await q.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      });
      return { ok: true };
    });
  post('/admin/users/:id/xp', async (r: any) => {
    role(r);
    const b = z
      .object({ amount: z.number().int().min(-10000).max(10000), note: z.string().min(1).max(500) })
      .parse(r.body);
    await db.tx(async (q) => {
      const u = await one(q, 'SELECT id FROM users WHERE id=$1 FOR UPDATE', [
        z.uuid().parse(r.params.id),
      ]);
      if (!u) fail(404, 'not_found', 'User not found');
      await q.query(
        "INSERT INTO xp_events(user_id,amount,reason,dedupe_key) VALUES($1,$2,'admin_adjust',$3)",
        [u.id, b.amount, `admin:${r.id}`],
      );
      await refreshStats(q, u.id);
      await q.query(
        "INSERT INTO audit_log(actor_id,action,target,data) VALUES($1,'xp.adjust',$2,$3)",
        [r.user.id, u.id, JSON.stringify(b)],
      );
    });
    return { ok: true };
  });
  post('/admin/leaderboard/rebuild', async (r: any) => {
    role(r);
    if (llm.scheduleLeaderboardRebuild) await llm.scheduleLeaderboardRebuild();
    else await llm.rebuildLeaderboards?.();
    return {
      ok: true,
      source: 'PostgreSQL ledger',
      queued: !!llm.scheduleLeaderboardRebuild,
      redisRebuilt: !llm.scheduleLeaderboardRebuild && !!llm.rebuildLeaderboards,
    };
  });
  get('/admin/metrics', async (r: any) => {
    role(r);
    return {
      dailyActiveUsers: camel(
        (
          await db.query(
            `SELECT date,count(DISTINCT user_id)::int users FROM (SELECT (created_at AT TIME ZONE 'UTC')::date date,user_id FROM submissions UNION ALL SELECT (created_at AT TIME ZONE 'UTC')::date date,user_id FROM events) activity GROUP BY date ORDER BY date DESC LIMIT 30`,
          )
        ).rows,
      ),
      challenges: camel(
        (
          await db.query(
            `SELECT c.slug,count(s.id)::int attempts,avg(CASE WHEN s.status='passed' THEN 1.0 WHEN s.status='failed' THEN 0.0 ELSE NULL END) pass_rate,(SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY p.attempts) FROM progress p WHERE p.challenge_id=c.id) median_attempts FROM challenges c LEFT JOIN submissions s ON s.challenge_id=c.id GROUP BY c.id,c.slug ORDER BY c.slug`,
          )
        ).rows,
      ),
      submissions: camel(
        (
          await db.query(
            "SELECT created_at::date date,count(*)::int total,avg(CASE WHEN passed THEN 1.0 ELSE 0 END) pass_rate,count(*) FILTER(WHERE status='error')::int errors FROM submissions GROUP BY 1 ORDER BY 1 DESC LIMIT 30",
          )
        ).rows,
      ),
      llm: camel(
        (
          await db.query(
            'SELECT created_at::date date,sum(cost_micros) cost_micros FROM llm_usage GROUP BY 1 ORDER BY 1 DESC LIMIT 30',
          )
        ).rows,
      ),
    };
  });
  get('/admin/submissions', async (r: any) => {
    role(r);
    const { limit, offset } = pagination(r.query);
    return page(
      (
        await db.query(
          'SELECT s.* FROM submissions s JOIN challenges c ON c.id=s.challenge_id WHERE ($1::text IS NULL OR s.status::text=$1) AND ($2::uuid IS NULL OR s.user_id=$2) AND ($5::text IS NULL OR c.slug=$5) ORDER BY s.created_at DESC LIMIT $3 OFFSET $4',
          [
            r.query.status ?? null,
            r.query.userId ?? null,
            limit + 1,
            offset,
            r.query.challengeSlug ?? null,
          ],
        )
      ).rows,
      limit,
      offset,
    );
  });
}
