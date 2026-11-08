import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../apps/api/src/app.js';
import { Database, one } from '../packages/db/src/db.js';
import { syncContent, seedBase } from '../packages/db/src/content.js';
import { loadConfig } from '../packages/shared/src/config.js';
import { hash, token } from '../packages/shared/src/utils.js';
import { FakeProvider } from '../packages/llm/src/provider.js';
let ctx: Awaited<ReturnType<typeof createApp>>,
  db: Database,
  cookie = '',
  csrf = '',
  uid = '',
  sid = '';
const body = (r: any) => r.json();
async function req(method: any, url: string, payload?: any, cookies = cookie) {
  return ctx.app.inject({
    method,
    url,
    payload,
    headers: { cookie: cookies, 'x-csrf-token': csrf, origin: 'http://localhost:3000' },
  });
}
async function login(email: string) {
  const s = token();
  await db.query(
    "INSERT INTO verification_tokens(identifier,token_hash,expires_at) VALUES($1,$2,now()+interval '15 minutes')",
    [email, hash(s)],
  );
  const r = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/auth/callback/email?email=${email}&token=${s}`,
  });
  const cs = r.cookies.map((x: any) => `${x.name}=${x.value}`).join('; ');
  return { cookie: cs, csrf: r.cookies.find((x: any) => x.name === 'pl_csrf')!.value, link: s };
}
beforeAll(async () => {
  db = new Database('pglite://');
  await db.migrate();
  await syncContent(db);
  await seedBase(db);
  ctx = await createApp({
    db,
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite://',
      REDIS_URL: '',
      LLM_PROVIDER: 'fake',
    }),
    logger: false,
    provider: new FakeProvider({
      [hash('Return a user profile as JSON only.')]: '{"name":"Test"}',
    }),
  });
  await ctx.app.ready();
  const auth = await login('learner@example.com');
  cookie = auth.cookie;
  csrf = auth.csrf;
  uid = (await req('GET', '/api/v1/me')).json().id;
}, 60000);
afterAll(async () => {
  await ctx?.app.close();
  await db?.close();
});
describe('API end to end', () => {
  it('has health, ready, request ids and public content', async () => {
    expect((await req('GET', '/readyz')).statusCode).toBe(200);
    const r = await req('GET', '/api/v1/levels');
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(body(r).items).toHaveLength(5);
    expect(
      body(await req('GET', '/api/v1/levels/say-what-you-want/challenges')).items,
    ).toHaveLength(4);
    expect(
      body(await req('GET', '/api/v1/challenges/json-only')).checks.find(
        (x: any) => x.phase === 'model',
      ).config,
    ).toBeNull();
  });
  it('rejects missing auth, CSRF, and foreign origin', async () => {
    expect((await req('GET', '/api/v1/me', undefined, '')).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/v1/submissions', payload: {} }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/tokens/count',
          headers: { cookie, 'x-csrf-token': csrf, origin: 'https://evil.example' },
          payload: { text: 'x' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('single-use magic links', async () => {
    const a = await login('other@example.com');
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/auth/callback/email?email=other@example.com&token=${a.link}`,
        })
      ).statusCode,
    ).toBe(400);
  });
  it('saves and revises drafts without trusting client totals', async () => {
    const r = await req('PUT', '/api/v1/drafts/hello-function', {
      prompt: 'Write a Python function to reverse a string.',
      rev: 0,
      instantPassed: 999,
    });
    expect(r.statusCode).toBe(200);
    expect(body(r).instantPassed).toBe(3);
    expect(body(r).rev).toBe(1);
    expect(
      (await req('PUT', '/api/v1/drafts/hello-function', { prompt: 'x', rev: 0 })).statusCode,
    ).toBe(409);
    expect(body(await req('GET', '/api/v1/drafts/latest')).challenge.slug).toBe('hello-function');
  });
  it('grades synchronously and awards XP once', async () => {
    const r = await req('POST', '/api/v1/submissions', {
      challengeSlug: 'hello-function',
      prompt: 'Write a Python function to reverse a string.',
      idempotencyKey: 'first-attempt',
    });
    expect(r.statusCode).toBe(200);
    const s = body(r);
    sid = s.id;
    expect(s.status).toBe('passed');
    expect(s.xpAwarded).toBeGreaterThanOrEqual(50);
    const xp = (await one(db, 'SELECT sum(amount)::int xp FROM xp_events WHERE user_id=$1', [uid]))
      .xp;
    const again = await req('POST', '/api/v1/submissions', {
      challengeSlug: 'hello-function',
      prompt: 'Write a Python function to reverse a string.',
      idempotencyKey: 'first-attempt',
    });
    expect(body(again).id).toBe(sid);
    await ctx.grading.grade(sid);
    expect(
      (await one(db, 'SELECT sum(amount)::int xp FROM xp_events WHERE user_id=$1', [uid])).xp,
    ).toBe(xp);
    expect(body(await req('GET', '/api/v1/drafts/latest'))).toBeNull();
  });
  it('re-clears improve progress without duplicating clear XP', async () => {
    const r = await req('POST', '/api/v1/submissions', {
      challengeSlug: 'hello-function',
      prompt: 'Python reverse function',
      idempotencyKey: 'second-attempt',
    });
    expect(body(r).passed).toBe(true);
    expect(
      (
        await one(
          db,
          "SELECT count(*)::int n FROM xp_events WHERE user_id=$1 AND reason='challenge_clear'",
          [uid],
        )
      ).n,
    ).toBe(1);
  });
  it('protects ownership and admin roles', async () => {
    const a = await login('third@example.com');
    expect((await req('GET', `/api/v1/submissions/${sid}`, undefined, a.cookie)).statusCode).toBe(
      404,
    );
    expect((await req('GET', '/api/v1/admin/users')).statusCode).toBe(403);
  });
  it('grades model output via asynchronous path', async () => {
    const r = await req('POST', '/api/v1/submissions', {
      challengeSlug: 'json-only',
      prompt: 'Return a user profile as JSON only.',
      idempotencyKey: 'json-attempt',
    });
    expect(r.statusCode).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = body(await req('GET', `/api/v1/submissions/${body(r).id}`));
    expect(result.status).toBe('passed');
    expect(result.modelOutput).toContain('Test');
  });
  it('provides dashboard, library, search and privacy export', async () => {
    const d = body(await req('GET', '/api/v1/dashboard'));
    expect(d.stats.cleared.count).toBe(2);
    expect(d.weeklyXp).toHaveLength(7);
    expect(d.badges.some((x: any) => x.slug === 'first-clear' && x.earned)).toBe(true);
    expect(body(await req('GET', '/api/v1/search?q=Python')).items.length).toBeGreaterThan(0);
    const saved = await req('POST', '/api/v1/library', {
      title: 'Reverse',
      prompt: 'Python reverse function',
      submissionId: sid,
    });
    expect(saved.statusCode).toBe(200);
    expect(
      body(await req('GET', '/api/v1/library')).items.filter((x: any) => x.kind === 'saved'),
    ).toHaveLength(1);
    expect(body(await req('GET', '/api/v1/me/export')).submissions.length).toBeGreaterThan(1);
  });
  it('validates and rejects mismatched idempotency', async () => {
    expect(
      (
        await req('POST', '/api/v1/submissions', {
          challengeSlug: 'hello-function',
          prompt: '',
          idempotencyKey: 'invalid-input',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await req('POST', '/api/v1/submissions', {
          challengeSlug: 'hello-function',
          prompt: 'different',
          idempotencyKey: 'first-attempt',
        })
      ).statusCode,
    ).toBe(409);
    expect((await req('PATCH', '/api/v1/me', { timezone: 'Fake/Zone' })).statusCode).toBe(400);
  });
  it('coalesces 20 concurrent attempts and applies the route limit', async () => {
    const a = await login('concurrent@example.com');
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/v1/submissions',
          headers: { cookie: a.cookie, 'x-csrf-token': a.csrf },
          payload: {
            challengeSlug: 'hello-function',
            prompt: 'Python reverse function',
            idempotencyKey: 'concurrent-same-key',
          },
        }),
      ),
    );
    const accepted = responses.filter((r) => r.statusCode === 200);
    expect(accepted.length).toBeGreaterThan(0);
    expect(new Set(accepted.map((r) => r.json().id)).size).toBe(1);
    expect(responses.every((r) => [200, 429].includes(r.statusCode))).toBe(true);
    const row = await one(
      db,
      "SELECT count(*)::int n FROM submissions WHERE idempotency_key='concurrent-same-key'",
    );
    expect(row.n).toBe(1);
  });
  it('extends streaks in the learner timezone, once per day', async () => {
    const a = await login('timezone@example.com'),
      u = await one(db, "SELECT id FROM users WHERE email='timezone@example.com'");
    await db.query("UPDATE users SET timezone='Pacific/Kiritimati' WHERE id=$1", [u.id]);
    await db.query(
      "UPDATE user_stats SET current_streak=5,best_streak=9,last_active_date=(now() AT TIME ZONE 'Pacific/Kiritimati')::date-1 WHERE user_id=$1",
      [u.id],
    );
    const submit = async (key: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/submissions',
        headers: { cookie: a.cookie, 'x-csrf-token': a.csrf },
        payload: {
          challengeSlug: 'hello-function',
          prompt: 'Python reverse function',
          idempotencyKey: key,
        },
      });
    expect((await submit('timezone-first')).json().streak.current).toBe(6);
    expect((await submit('timezone-second')).json().streak.current).toBe(6);
    await db.query(
      "UPDATE user_stats SET last_active_date=(now() AT TIME ZONE 'Pacific/Kiritimati')::date-2 WHERE user_id=$1",
      [u.id],
    );
    expect((await submit('timezone-reset')).json().streak.current).toBe(1);
  });
  it('enforces model quota and supports audited dry-run without submissions', async () => {
    await db.query("UPDATE users SET role='author' WHERE id=$1", [uid]);
    const before = (await one(db, 'SELECT count(*)::int n FROM submissions')).n;
    const result = await req('POST', '/api/v1/admin/challenges/json-only/dry-run', {
      prompt: 'Return a user profile as JSON only.',
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().passed).toBe(true);
    expect(result.json().xpAwarded).toBe(0);
    expect((await one(db, 'SELECT count(*)::int n FROM submissions')).n).toBe(before);
    ctx.config.USER_DAILY_MODEL_RUNS = 1;
    try {
      const r = await req('POST', '/api/v1/submissions', {
        challengeSlug: 'json-only',
        prompt: 'Return a user profile as JSON only.',
        idempotencyKey: 'quota-limited',
      });
      expect(r.statusCode).toBe(429);
    } finally {
      ctx.config.USER_DAILY_MODEL_RUNS = 40;
    }
  });
  it('soft deletion revokes sessions immediately', async () => {
    const a = await login('delete@example.com');
    const r = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: { cookie: a.cookie, 'x-csrf-token': a.csrf },
    });
    expect(r.statusCode).toBe(204);
    expect((await req('GET', '/api/v1/me', undefined, a.cookie)).statusCode).toBe(401);
  });
});
