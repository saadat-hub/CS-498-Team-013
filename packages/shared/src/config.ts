import 'dotenv/config';
import { z } from 'zod';
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  APP_ORIGIN: z.url(),
  API_URL: z.url(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  TRUST_PROXY: z.string().default(''),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(20),
  REDIS_URL: z.string(),
  SESSION_SECRET: z.string().min(32),
  IP_HASH_SECRET: z.string().min(32),
  LLM_PROVIDER: z.enum(['fake', 'anthropic']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().default(''),
  TOKEN_COUNT_MODEL: z.string().default(''),
  RUN_MODEL: z.string().default(''),
  JUDGE_MODEL: z.string().default(''),
  PRICES_JSON: z.string().default('{}'),
  LLM_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
  USER_DAILY_MODEL_RUNS: z.coerce.number().int().positive().default(40),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('resend'),
  EMAIL_FROM: z.string().min(1),
  EMAIL_API_KEY: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  FEATURE_CODE_TESTS: z.enum(['true', 'false']).default('false'),
  SENTRY_DSN: z.union([z.url(), z.literal('')]).default(''),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.union([z.url(), z.literal('')]).default(''),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(overrides: Record<string, unknown> = {}): Config {
  const testing = overrides.NODE_ENV === 'test';
  const testConfig = testing
    ? {
        APP_ORIGIN: 'http://localhost:3000',
        API_URL: 'http://localhost:8080',
        DATABASE_URL: 'pglite://',
        REDIS_URL: '',
        SESSION_SECRET: 'automated-test-session-secret-123456789',
        IP_HASH_SECRET: 'automated-test-ip-secret-1234567890123',
        LLM_PROVIDER: 'fake',
        EMAIL_PROVIDER: 'console',
        EMAIL_FROM: 'tests@example.com',
        SENTRY_DSN: '',
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
        TRUST_PROXY: '',
      }
    : {};
  const c = configSchema.parse({ ...process.env, ...testConfig, ...overrides });
  if (c.FEATURE_CODE_TESTS === 'true')
    throw new Error('Phase 2 sandbox is not configured; FEATURE_CODE_TESTS must be false.');
  if (
    c.LLM_PROVIDER === 'anthropic' &&
    (!c.ANTHROPIC_API_KEY || !c.RUN_MODEL || !c.JUDGE_MODEL || !c.TOKEN_COUNT_MODEL)
  )
    throw new Error('Anthropic requires API key and all three model settings.');
  if (c.NODE_ENV !== 'test') {
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET', 'IP_HASH_SECRET'] as const)
      if (!process.env[key] && !overrides[key])
        throw new Error(`${key} must be explicitly configured in production`);
    if (
      !/^postgres(ql)?:\/\//.test(c.DATABASE_URL) ||
      !/^rediss?:\/\//.test(c.REDIS_URL) ||
      c.LLM_PROVIDER === 'fake' ||
      c.EMAIL_PROVIDER === 'console' ||
      !c.EMAIL_API_KEY ||
      !c.APP_ORIGIN.startsWith('https://') ||
      !c.API_URL.startsWith('https://') ||
      /^(local-|automated-test-|change|replace)/i.test(c.SESSION_SECRET) ||
      /^(local-|automated-test-|change|replace)/i.test(c.IP_HASH_SECRET) ||
      c.SESSION_SECRET === c.IP_HASH_SECRET
    )
      throw new Error(
        'Production requires PostgreSQL, Redis, real AI/email, HTTPS and unique secrets.',
      );
    z.email().parse(c.EMAIL_FROM.match(/<([^>]+)>$/)?.[1] ?? c.EMAIL_FROM);
    for (const provider of ['GITHUB', 'GOOGLE'] as const)
      if (Boolean(c[`${provider}_CLIENT_ID`]) !== Boolean(c[`${provider}_CLIENT_SECRET`]))
        throw new Error(`${provider} requires both client ID and client secret`);
  }
  return c;
}
