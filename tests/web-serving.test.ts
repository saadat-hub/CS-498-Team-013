import { it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { Database } from '../packages/db/src/db.js';
import { syncContent, seedBase } from '../packages/db/src/content.js';
import { loadConfig } from '../packages/shared/src/config.js';
it.skipIf(!existsSync(new URL('../dist/web/index.html', import.meta.url)))(
  'serves built frontend assets and deep links without swallowing unknown API routes',
  async () => {
    const { createApp } = await import(
      new URL('../dist/apps/api/src/app.js', import.meta.url).href
    );
    const db = new Database('pglite://');
    await db.migrate();
    await syncContent(db);
    await db.tx(seedBase);
    const ctx = await createApp({ db, config: loadConfig({ NODE_ENV: 'test' }), logger: false });
    try {
      const html = await ctx.app.inject({ method: 'GET', url: '/' });
      expect(html.statusCode).toBe(200);
      expect(html.headers['content-type']).toContain('text/html');
      expect(html.body).toContain('Prompt Lab');
      const asset = html.body.match(/src="([^"]+\.js)"/)![1];
      const js = await ctx.app.inject({ method: 'GET', url: asset });
      expect(js.statusCode).toBe(200);
      expect(js.headers['content-type']).toMatch(/javascript/);
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/challenge/hello-function' })).headers[
          'content-type'
        ],
      ).toContain('text/html');
      const missing = await ctx.app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('not_found');
      const meta = (await ctx.app.inject({ method: 'GET', url: '/api/v1/config' })).json();
      expect(meta.catalog).toEqual({ challenges: 20, levels: 5 });
      expect((await ctx.app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
    } finally {
      await ctx.app.close();
      await db.close();
    }
  },
  60000,
);
