import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import { createApp } from '../apps/api/src/app.js';
import { loadConfig } from '../packages/shared/src/config.js';
import { Database } from '../packages/db/src/db.js';
import { syncContent, seedBase } from '../packages/db/src/content.js';

// This entry point explicitly opts into local adapters; production never uses it.
const webPort = Number(process.env.WEB_PORT || 3000);
const config = loadConfig({
  NODE_ENV: 'development',
  LOCAL_DEVELOPMENT: 'true',
  APP_ORIGIN: `http://localhost:${webPort}`,
  API_URL: `http://localhost:${webPort}`,
  API_PORT: Number(process.env.API_PORT || 8080),
  TRUST_PROXY: '',
  DATABASE_URL: process.env.DATABASE_URL || 'pglite://.data/promptlab',
  REDIS_URL: '',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  IP_HASH_SECRET: randomBytes(32).toString('hex'),
  LLM_PROVIDER: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'disabled',
  EMAIL_PROVIDER: 'console',
  EMAIL_FROM: 'local@promptlab.test',
});
const db = new Database(config.DATABASE_URL);
await db.migrate();
await syncContent(db);
await db.tx(seedBase);
const ctx = await createApp({ config, db });
await ctx.app.listen({ port: config.API_PORT, host: '127.0.0.1' });
const vite = await createServer({ configFile: 'apps/web/vite.config.ts' });
await vite.listen();
console.log(
  `\nPrompt Lab → http://localhost:${webPort}\nLocal data persists at ${config.DATABASE_URL}. AI grading: ` +
    (config.LLM_PROVIDER === 'anthropic' ? 'enabled' : 'not configured') +
    '\n',
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await vite.close();
    await ctx.app.close();
    await db.close();
    process.exit(0);
  });
