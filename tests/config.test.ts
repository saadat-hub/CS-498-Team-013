import { describe, it, expect } from 'vitest';
import { loadConfig } from '../packages/shared/src/config.js';
const service = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://learn.promptlab.edu',
  API_URL: 'https://api.promptlab.edu',
  DATABASE_URL: 'postgres://service:secret@database/promptlab',
  REDIS_URL: 'rediss://cache:6379',
  SESSION_SECRET: 'a'.repeat(48),
  IP_HASH_SECRET: 'b'.repeat(48),
  LLM_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'credential-supplied-by-test',
  TOKEN_COUNT_MODEL: 'count-model',
  RUN_MODEL: 'run-model',
  JUDGE_MODEL: 'judge-model',
  EMAIL_PROVIDER: 'resend',
  EMAIL_API_KEY: 'credential-supplied-by-test',
  EMAIL_FROM: 'Prompt Lab <signin@promptlab.edu>',
  GITHUB_CLIENT_ID: '',
  GITHUB_CLIENT_SECRET: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
};
describe('service configuration boundaries', () => {
  it('accepts explicitly configured services', () =>
    expect(loadConfig(service).LLM_PROVIDER).toBe('anthropic'));
  it.each([
    { DATABASE_URL: 'pglite://' },
    { REDIS_URL: '' },
    { LLM_PROVIDER: 'fake' },
    { EMAIL_PROVIDER: 'console' },
    { SESSION_SECRET: 'local-development-secret-1234567890' },
    { IP_HASH_SECRET: 'a'.repeat(48) },
    { APP_ORIGIN: 'http://learn.promptlab.edu' },
  ])('rejects runtime substitutions %j', (change) =>
    expect(() => loadConfig({ ...service, ...change })).toThrow(),
  );
  it('rejects missing model credentials and incomplete OAuth credentials', () => {
    expect(() => loadConfig({ ...service, ANTHROPIC_API_KEY: '' })).toThrow('Anthropic');
    expect(() => loadConfig({ ...service, GITHUB_CLIENT_ID: 'only-id' })).toThrow('GITHUB');
  });
  it('isolates scripted and embedded adapters to explicit automated test configuration', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect(c.DATABASE_URL).toBe('pglite://');
    expect(c.LLM_PROVIDER).toBe('fake');
    expect(c.REDIS_URL).toBe('');
  });
});
