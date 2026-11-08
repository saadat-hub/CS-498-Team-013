import { createApp } from './app.js';
const { app, db, config } = await createApp();
if (config.NODE_ENV === 'test') {
  await db.migrate();
  const { syncContent, seedBase } = await import('../../../packages/db/src/content.js');
  await syncContent(db);
  await seedBase(db);
}
await app.listen({
  host: config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
  port: config.API_PORT,
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => app.close().then(() => process.exit(0)));
