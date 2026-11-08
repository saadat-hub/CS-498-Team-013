import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import { drizzle as embeddedDrizzle } from 'drizzle-orm/pglite';
// Convert our numbered SQL templates into Drizzle parameters. SQL text is always
// authored in this repository; request data only enters through bound values.
function statement(text: string, params: any[]) {
  const chunks = text
    .split(/(\$\d+)/g)
    .map((part) =>
      /^\$\d+$/.test(part)
        ? drizzleSql`${drizzleSql.param(params[Number(part.slice(1)) - 1])}`
        : drizzleSql.raw(part),
    );
  return drizzleSql.join(chunks, drizzleSql.raw(''));
}
export interface Query {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}
export class Database implements Query {
  private pool?: pg.Pool;
  private embedded?: PGlite;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(url: string) {
    if (url.startsWith('pglite://')) {
      const path = url.slice(9);
      if (path) mkdirSync(dirname(path), { recursive: true });
      this.embedded = new PGlite(path || undefined);
    } else
      this.pool = new pg.Pool({
        connectionString: url,
        max: Number(process.env.DATABASE_POOL_MAX || 20),
      });
  }
  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => {});
    return result;
  }
  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[] }> {
    if (this.pool)
      return pgDrizzle(this.pool).execute(statement(sql, params)) as unknown as Promise<{
        rows: T[];
      }>;
    return this.serial(
      () =>
        embeddedDrizzle(this.embedded!).execute(statement(sql, params)) as unknown as Promise<{
          rows: T[];
        }>,
    );
  }
  async tx<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    if (this.embedded)
      return this.serial(() =>
        this.embedded!.transaction((t) =>
          fn({ query: (s, p = []) => embeddedDrizzle(t as any).execute(statement(s, p)) as any }),
        ),
      );
    const c = await this.pool!.connect();
    try {
      await c.query('BEGIN');
      const value = await fn({
        query: (s, p = []) => pgDrizzle(c).execute(statement(s, p)) as any,
      });
      await c.query('COMMIT');
      return value;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async migrate() {
    const folder = fileURLToPath(new URL('../migrations/', import.meta.url));
    const files = (await readdir(folder)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
    await this.tx(async (q) => {
      await q.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz DEFAULT now())',
      );
      await q.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
      for (const file of files) {
        const version = Number(file.split('_')[0]);
        if (
          (await q.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version])).rows.length
        )
          continue;
        let source = await readFile(`${folder}/${file}`, 'utf8');
        if (this.embedded)
          source = source.replace(/CREATE EXTENSION[^;]+;/g, '').replace(/\bcitext\b/g, 'text');
        for (const statement of source
          .replace(/--[^\n]*/g, '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean))
          await q.query(statement);
        await q.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
      }
    });
  }
  async close() {
    await this.tail;
    await this.pool?.end();
    await this.embedded?.close();
  }
}
export async function one(q: Query, sql: string, params: any[] = []) {
  return (await q.query(sql, params)).rows[0] ?? null;
}
