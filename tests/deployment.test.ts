import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { schedules } from '../apps/worker/src/maintenance.js';
it('defines separate release, API and worker processes with a release dependency', async () => {
  const compose = parse(
    await readFile(new URL('../infra/compose.production.yml', import.meta.url), 'utf8'),
    { merge: true },
  );
  expect(compose.services.api.depends_on.release.condition).toBe('service_completed_successfully');
  expect(compose.services.worker.depends_on.release.condition).toBe(
    'service_completed_successfully',
  );
  expect(compose.services.api.read_only).toBe(true);
  expect(compose.services.worker.cap_drop).toContain('ALL');
  expect(compose.services.release.command.at(-1)).toBe('dist/packages/db/src/release.js');
});
it('declares the specified independent maintenance schedules', () => {
  expect(schedules.map((s) => s.name).sort()).toEqual([
    'daily.pick',
    'grade.dispatch',
    'grade.sweep',
    'leaderboard.rebuild',
    'stats.reconcile',
    'streak.risk',
    'usage.rollup',
    'users.purge',
  ]);
});
