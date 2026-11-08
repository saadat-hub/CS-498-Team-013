import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Database, one } from '../../../packages/db/src/db.js';
import { Config } from '../../../packages/shared/src/config.js';
import { token, hash, fail, camel } from '../../../packages/shared/src/utils.js';
import { Cache } from '../../../packages/llm/src/provider.js';
import type { EmailSender } from '../../../packages/shared/src/email.js';
declare module 'fastify' {
  interface FastifyRequest {
    user: any;
  }
}
export function publicUser(u: any) {
  if (!u) return null;
  const {
    id,
    email,
    display_name,
    handle,
    avatar_url,
    role,
    timezone,
    leaderboard_opt_in,
    created_at,
  } = u;
  return camel({
    id,
    email,
    display_name,
    handle,
    avatar_url,
    role,
    timezone,
    leaderboard_opt_in,
    created_at,
  });
}
export function requireUser(r: FastifyRequest) {
  if (!r.user) fail(401, 'unauthorized', 'Sign in first');
  return r.user;
}
export const role = (r: FastifyRequest, roles = ['admin']) => {
  const u = requireUser(r);
  if (!roles.includes(u.role)) fail(403, 'forbidden', 'Insufficient permissions');
  return u;
};
export async function newUser(q: any, email: string, name = 'New learner') {
  const u = await one(
    q,
    `INSERT INTO users(email,email_verified,display_name,handle) VALUES($1,now(),$2,$3) ON CONFLICT(email) DO UPDATE SET email_verified=COALESCE(users.email_verified,now()) RETURNING *`,
    [
      email.toLowerCase(),
      name.slice(0, 40),
      `learner_${token()
        .slice(0, 10)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, 'x')}`,
    ],
  );
  await q.query('INSERT INTO user_stats(user_id) VALUES($1) ON CONFLICT DO NOTHING', [u.id]);
  return u;
}
export async function installAuth(
  app: FastifyInstance,
  db: Database,
  c: Config,
  cache: Cache,
  emailSender: EmailSender,
) {
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    secure: c.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  };
  const sign = (s: string) => createHmac('sha256', c.SESSION_SECRET).update(s).digest('hex');
  const validCsrf = (s: string) => {
    const [v, sig] = s.split('.');
    return (
      !!v &&
      !!sig &&
      /^[a-f0-9]{64}$/.test(sig) &&
      timingSafeEqual(Buffer.from(sign(v)), Buffer.from(sig))
    );
  };
  const csrf = (reply: FastifyReply) => {
    const v = token(),
      s = `${v}.${sign(v)}`;
    reply.setCookie('pl_csrf', s, { ...cookieOpts, httpOnly: false });
    return s;
  };
  const session = async (reply: FastifyReply, u: any, r: FastifyRequest) => {
    if (u.deleted_at) fail(403, 'account_deleted', 'Account is pending deletion');
    const s = token();
    await db.query(
      `INSERT INTO sessions(id,user_id,expires_at,user_agent,ip_hash) VALUES($1,$2,now()+interval '30 days',$3,$4)`,
      [
        hash(s),
        u.id,
        r.headers['user-agent'] ?? null,
        createHmac('sha256', c.IP_HASH_SECRET).update(r.ip).digest('hex'),
      ],
    );
    reply.setCookie('pl_session', s, { ...cookieOpts, maxAge: 30 * 86400 });
    csrf(reply);
  };
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (r, reply) => {
    const s = r.cookies.pl_session;
    if (s) {
      r.user = await one(
        db,
        `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND u.deleted_at IS NULL`,
        [hash(s)],
      );
      if (r.user) {
        const renewed = await db.query(
          `UPDATE sessions SET last_seen_at=now(),expires_at=now()+interval '30 days' WHERE id=$1 AND last_seen_at<now()-interval '24 hours' RETURNING id`,
          [hash(s)],
        );
        if (renewed.rows.length)
          reply.setCookie('pl_session', s, { ...cookieOpts, maxAge: 30 * 86400 });
      }
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)) {
      const origin = r.headers.origin;
      if (origin && origin !== c.APP_ORIGIN && origin !== new URL(c.API_URL).origin)
        fail(403, 'invalid_origin', 'Origin is not allowed');
      const supplied = r.headers['x-csrf-token'];
      if (typeof supplied !== 'string' || supplied !== r.cookies.pl_csrf || !validCsrf(supplied))
        fail(
          403,
          'csrf_failed',
          'Fetch /api/v1/auth/session first, then send its csrfToken and cookies',
        );
      if (
        r.user?.banned_at &&
        !(r.method === 'DELETE' && r.url.split('?')[0] === '/api/v1/me') &&
        r.url.split('?')[0] !== '/api/v1/auth/logout'
      )
        fail(403, 'banned', 'Account is banned');
    }
  });
  app.get('/api/v1/auth/session', async (r, reply) => ({
    user: publicUser(r.user),
    csrfToken: csrf(reply),
  }));
  app.post(
    '/api/v1/auth/magic-link',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (r, reply) => {
      const { email } = z.object({ email: z.email().max(254) }).parse(r.body);
      const normalized = email.toLowerCase();
      // Email throttle persists across API replicas. No enumeration in the response.
      const recent = await one(
        db,
        `SELECT count(*)::int n FROM verification_tokens WHERE identifier=$1 AND expires_at>now()-interval '45 minutes'`,
        [normalized],
      );
      if (recent.n < 5) {
        const s = token(),
          url = `${c.API_URL}/api/v1/auth/callback/email?email=${encodeURIComponent(normalized)}&token=${s}`;
        await db.query(
          `INSERT INTO verification_tokens(identifier,token_hash,expires_at) VALUES($1,$2,now()+interval '15 minutes')`,
          [normalized, hash(s)],
        );
        await emailSender.sendMagicLink({ email: normalized, url });
      }
      return reply.code(204).send();
    },
  );
  app.get('/api/v1/auth/callback/email', async (r, reply) => {
    const a = z.object({ email: z.email(), token: z.string().min(32).max(100) }).parse(r.query);
    const u = await db.tx(async (q) => {
      const t = await one(
        q,
        'DELETE FROM verification_tokens WHERE identifier=$1 AND token_hash=$2 AND expires_at>now() RETURNING identifier',
        [a.email.toLowerCase(), hash(a.token)],
      );
      if (!t) fail(400, 'invalid_link', 'This link is invalid or expired');
      return newUser(q, a.email);
    });
    await session(reply, u, r);
    return reply.redirect(`${c.APP_ORIGIN}/dashboard`);
  });
  app.post('/api/v1/auth/logout', async (r, reply) => {
    if (r.cookies.pl_session)
      await db.query('DELETE FROM sessions WHERE id=$1', [hash(r.cookies.pl_session)]);
    reply.clearCookie('pl_session', { path: '/' });
    return reply.code(204).send();
  });
  const providers = {
    github: {
      id: c.GITHUB_CLIENT_ID,
      secret: c.GITHUB_CLIENT_SECRET,
      authorize: 'https://github.com/login/oauth/authorize',
      exchange: 'https://github.com/login/oauth/access_token',
      scope: 'read:user user:email',
    },
    google: {
      id: c.GOOGLE_CLIENT_ID,
      secret: c.GOOGLE_CLIENT_SECRET,
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      exchange: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    },
  };
  app.get('/api/v1/auth/oauth/:provider', async (r, reply) => {
    const p = z.enum(['github', 'google']).parse((r.params as any).provider),
      cfg = providers[p];
    if (!cfg.id || !cfg.secret)
      fail(503, 'oauth_not_configured', `${p} OAuth needs client credentials`);
    const state = token(),
      verifier = token();
    await cache.set(`oauth:${hash(state)}`, JSON.stringify({ p, verifier }), 600);
    reply.setCookie('pl_oauth', state, { ...cookieOpts, maxAge: 600 });
    const url = new URL(cfg.authorize);
    url.search = new URLSearchParams({
      client_id: cfg.id,
      redirect_uri: `${c.API_URL}/api/v1/auth/callback/${p}`,
      scope: cfg.scope,
      state,
      response_type: 'code',
      code_challenge: Buffer.from(hash(verifier), 'hex').toString('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return reply.redirect(url.toString());
  });
  app.get('/api/v1/auth/callback/:provider', async (r, reply) => {
    const p = z.enum(['github', 'google']).parse((r.params as any).provider),
      cfg = providers[p];
    const { state, code } = z.object({ state: z.string(), code: z.string() }).parse(r.query);
    if (state !== r.cookies.pl_oauth)
      fail(400, 'invalid_oauth_state', 'OAuth state does not match');
    const data = await cache.get(`oauth:${hash(state)}`);
    if (!data) fail(400, 'invalid_oauth_state', 'OAuth request expired');
    await cache.del(`oauth:${hash(state)}`);
    const saved = JSON.parse(data!);
    if (saved.p !== p) fail(400, 'invalid_oauth_state', 'OAuth provider mismatch');
    const response = await fetch(cfg.exchange, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.id,
        client_secret: cfg.secret,
        code,
        code_verifier: saved.verifier,
        redirect_uri: `${c.API_URL}/api/v1/auth/callback/${p}`,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10000),
    });
    const auth: any = await response.json();
    if (!response.ok || !auth.access_token) fail(400, 'oauth_failed', 'OAuth exchange failed');
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'application/json',
      'User-Agent': 'Prompt-Lab',
    };
    let email: string, name: string, account: string;
    if (p === 'github') {
      const [profileRes, emailRes] = await Promise.all([
        fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(10000) }),
        fetch('https://api.github.com/user/emails', {
          headers,
          signal: AbortSignal.timeout(10000),
        }),
      ]);
      if (!profileRes.ok || !emailRes.ok)
        fail(400, 'oauth_failed', 'Cannot verify GitHub identity');
      const profile: any = await profileRes.json(),
        emails: any = await emailRes.json();
      const verified =
        emails.find((e: any) => e.verified && e.primary) ?? emails.find((e: any) => e.verified);
      if (!verified) fail(403, 'email_unverified', 'A verified email is required');
      email = verified.email;
      name = profile.name ?? profile.login;
      account = String(profile.id);
    } else {
      const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      const profile: any = await res.json();
      if (!res.ok || !profile.email_verified)
        fail(403, 'email_unverified', 'A verified email is required');
      email = profile.email;
      name = profile.name ?? 'Learner';
      account = profile.sub;
    }
    const u = await db.tx(async (q) => {
      const existing = await one(
        q,
        'SELECT u.* FROM accounts a JOIN users u ON u.id=a.user_id WHERE a.provider=$1 AND a.provider_account_id=$2',
        [p, account],
      );
      if (existing) return existing;
      const byEmail = await one(q, 'SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
      if (byEmail && !byEmail.email_verified)
        fail(403, 'email_unverified', 'Existing account must verify its email before linking');
      const user = byEmail ?? (await newUser(q, email, name));
      await q.query('INSERT INTO accounts(user_id,provider,provider_account_id) VALUES($1,$2,$3)', [
        user.id,
        p,
        account,
      ]);
      return user;
    });
    reply.clearCookie('pl_oauth', { path: '/' });
    await session(reply, u, r);
    return reply.redirect(`${c.APP_ORIGIN}/dashboard`);
  });
}
