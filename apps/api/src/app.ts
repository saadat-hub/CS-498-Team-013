import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { Database } from '../../../packages/db/src/db.js';
import { loadConfig, Config } from '../../../packages/shared/src/config.js';
import { AppError } from '../../../packages/shared/src/utils.js';
import {
  LlmService,
  MemoryCache,
  AnthropicProvider,
  FakeProvider,
  type LlmProvider,
  type Cache,
} from '../../../packages/llm/src/provider.js';
import { installAuth } from './auth.js';
import { routes } from './routes.js';
import { GradingService } from './services/grading.js';
import { updateLeaderboard, rebuildLeaderboards } from '../../../packages/db/src/leaderboard.js';
import { requestContracts } from '../../../packages/shared/src/contracts.js';
import { installTelemetry } from '../../../packages/shared/src/telemetry.js';
import { QueuedEmailSender, ConsoleEmailSender } from '../../../packages/shared/src/email.js';
export async function createApp(
  options: { config?: Config; db?: Database; provider?: LlmProvider; logger?: boolean } = {},
) {
  const c = options.config ?? loadConfig(),
    db = options.db ?? new Database(c.DATABASE_URL);
  if (
    c.NODE_ENV !== 'test' &&
    (!c.REDIS_URL || c.DATABASE_URL.startsWith('pglite:') || c.LLM_PROVIDER !== 'anthropic')
  )
    throw new Error(
      'Application services require PostgreSQL, Redis and Anthropic. Test adapters are restricted to automated tests.',
    );
  if (c.NODE_ENV !== 'test' && (options.provider || options.db))
    throw new Error(
      'Runtime services use validated service connections; injected adapters are reserved for tests.',
    );
  const app = Fastify({
    trustProxy: c.TRUST_PROXY ? c.TRUST_PROXY.split(',').map((s) => s.trim()) : false,
    logger:
      options.logger === false
        ? false
        : {
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.body',
              'res.headers.set-cookie',
              'req.query',
            ],
            serializers: {
              req: (r: any) => ({
                method: r.method,
                url: r.url?.split('?')[0],
                hostname: r.hostname,
                remoteAddress: undefined,
              }),
            },
          },
    bodyLimit: 100000,
    requestIdHeader: false,
  });
  await installTelemetry(app, c);
  let redis: Redis | undefined,
    queue: Queue | undefined,
    emailQueue: Queue | undefined,
    maintenanceQueue: Queue | undefined,
    cache: Cache = new MemoryCache();
  if (c.REDIS_URL) {
    redis = new Redis(c.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 2500 });
    cache = {
      get: (k) => redis!.get(k).catch(() => null),
      set: async (k, v, ttl) => {
        await redis!.set(k, v, 'EX', ttl).catch(() => undefined);
      },
      del: (k) => redis!.del(k).catch(() => undefined),
    };
    queue = new Queue('grade', { connection: redis as any });
    emailQueue = new Queue('email', { connection: redis as any });
    maintenanceQueue = new Queue('maintenance', { connection: redis as any });
  }
  const llm = new LlmService(
    c,
    db,
    cache,
    options.provider ??
      (c.LLM_PROVIDER === 'anthropic'
        ? new AnthropicProvider(c.ANTHROPIC_API_KEY)
        : new FakeProvider()),
  );
  if (maintenanceQueue)
    llm.scheduleLeaderboardRebuild = async () => {
      await maintenanceQueue!.add('leaderboard.rebuild', {}, { removeOnComplete: 100 });
    };
  if (redis) {
    llm.afterFinalize = (user) => updateLeaderboard(db, redis!, user);
    llm.rebuildLeaderboards = () => rebuildLeaderboards(db, redis!);
  }
  const grading = new GradingService(db, llm),
    pending = new Set<Promise<unknown>>();
  const enqueue = async (id: string) => {
    if (queue) {
      await queue.add(
        'grade',
        { submissionId: id },
        {
          jobId: id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
        },
      );
    } else if (c.NODE_ENV === 'test') {
      const task = new Promise<void>((resolve) => setTimeout(resolve, 10)).then(() =>
        grading.grade(id),
      );
      pending.add(task);
      task.finally(() => pending.delete(task));
    } else throw new Error('Redis grading queue is unavailable');
  };
  await app.register(cookie);
  await app.register(cors, {
    origin: [c.APP_ORIGIN],
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });
  await app.register(helmet, {
    contentSecurityPolicy:
      c.NODE_ENV === 'production'
        ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }
        : false,
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    hook: 'preHandler',
    ...(redis ? { redis } : {}),
    keyGenerator: (r) => r.user?.id ?? r.ip,
  });
  if (c.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: {
        info: { title: 'Prompt Lab API', version: '0.1.0' },
        components: {
          securitySchemes: {
            session: { type: 'apiKey', in: 'cookie', name: 'pl_session' },
            csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
          },
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/v1/')) return;
    const method = Array.isArray(route.method) ? route.method[0] : route.method;
    const contract = requestContracts[`${method} ${route.url}`];
    const segment = route.url.split('/')[3];
    route.schema = {
      ...route.schema,
      tags: [segment],
      summary: `${method} ${route.url.replace('/api/v1/', '')}`,
      ...(contract ? { body: z.toJSONSchema(contract, { target: 'draft-7' }) } : {}),
      security: [{ session: [], csrf: [] }],
    };
  });
  app.addHook('onRequest', async (r, reply) => {
    reply.header('X-Request-Id', r.id);
  });
  app.setErrorHandler((error: any, r, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Invalid request',
          details: error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        requestId: r.id,
      });
    if (error.code === '23505' || error.cause?.code === '23505')
      return reply.code(409).send({
        error: { code: 'conflict', message: 'This value is already in use', details: {} },
        requestId: r.id,
      });
    const status = error instanceof AppError ? error.status : (error.statusCode ?? 500);
    if (status >= 500)
      r.log.error(
        { errorName: error.name, errorCode: error.code ?? error.cause?.code },
        'Request failed',
      );
    reply.code(status).send({
      error: {
        code:
          error instanceof AppError
            ? error.code
            : status === 429
              ? 'rate_limited'
              : status < 500
                ? 'invalid_request'
                : 'internal_error',
        message:
          error instanceof AppError
            ? error.message
            : status < 500
              ? error.message
              : 'An internal error occurred',
        details: error instanceof AppError ? error.details : {},
      },
      requestId: r.id,
    });
  });
  app.setNotFoundHandler((r, reply) =>
    reply.code(404).send({
      error: { code: 'not_found', message: 'Route not found', details: {} },
      requestId: r.id,
    }),
  );
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => {
    const schema = await db.query<{ version: number }>(
      'SELECT max(version)::int version FROM schema_migrations',
    );
    if (!schema.rows[0] || schema.rows[0].version < 3)
      throw new Error('Required database migrations have not been applied');
    if (redis) await redis.ping();
    return {
      status: 'ready',
      database: c.DATABASE_URL.startsWith('pglite') ? 'embedded-postgres' : 'postgres',
      queue: redis ? 'redis' : 'in-process-development-only',
      ai: c.LLM_PROVIDER,
    };
  });
  await installAuth(
    app,
    db,
    c,
    cache,
    emailQueue ? new QueuedEmailSender(emailQueue) : new ConsoleEmailSender(),
  );
  await routes(app, db, llm, grading, enqueue);
  app.addHook('onClose', async () => {
    await Promise.allSettled([...pending]);
    await queue?.close();
    await emailQueue?.close();
    await maintenanceQueue?.close();
    await redis?.quit();
    if (!options.db) await db.close();
  });
  return { app, db, grading, llm, config: c };
}
