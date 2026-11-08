import { Database, one } from './db.js';
import { syncContent, seedBase } from './content.js';
import { loadConfig } from '../../shared/src/config.js';
import { seedDemo } from './demo.js';
const config = loadConfig();
const db = new Database(config.DATABASE_URL);
try {
  const command = process.argv[2];
  if (command === 'migrate') await db.migrate();
  else if (command === 'sync') console.log(await syncContent(db));
  else if (command === 'seed') {
    await syncContent(db);
    await seedBase(db);
    console.log('Synchronized challenge content, badges and daily assignments.');
  } else if (command === 'demo') {
    if (config.NODE_ENV !== 'test')
      throw new Error('Reference dashboard fixtures are restricted to automated tests.');
    await seedDemo(db);
  } else throw new Error('Expected migrate, sync, or seed');
} finally {
  await db.close();
}
