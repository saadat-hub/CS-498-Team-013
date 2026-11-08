import { loadContent, loadDailyOverrides } from './loader.js';
const c = await loadContent();
const overrides = await loadDailyOverrides();
if (new Set(overrides.map((o) => o.date)).size !== overrides.length)
  throw new Error('Duplicate daily override date');
for (const override of overrides)
  if (!c.challenges.some((ch) => ch.slug === override.challengeSlug && ch.published))
    throw new Error(`Invalid daily challenge: ${override.challengeSlug}`);
console.log(`Validated ${c.levels.length} levels and ${c.challenges.length} challenges.`);
