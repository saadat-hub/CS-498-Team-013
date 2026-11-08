import { cp, mkdir } from 'node:fs/promises';
for (const dir of ['packages/db/migrations', 'packages/content/challenges']) {
  await mkdir(`dist/${dir}`, { recursive: true });
  await cp(dir, `dist/${dir}`, { recursive: true });
}
