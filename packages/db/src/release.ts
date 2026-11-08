import { Database } from './db.js';
import { loadConfig } from '../../shared/src/config.js';
import { syncContent, seedBase } from './content.js';
const config = loadConfig();
const db = new Database(config.DATABASE_URL);
try {
  await db.migrate();
  const content = await syncContent(db);
  await db.tx(seedBase);
  console.log(JSON.stringify({ event: 'release.completed', content }));
} finally {
  await db.close();
}
