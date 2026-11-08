import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { RE2 } from 're2-wasm';
import Ajv from 'ajv';
const match = z.enum(['word', 'prefix', 'substring', 'phrase']).default('word');
const words = z.array(z.string().min(1)).min(1);
const include = z
  .object({
    any: words.optional(),
    all: words.optional(),
    match,
    min: z.number().int().positive().optional(),
  })
  .refine((c) => !!c.any || !!c.all, 'any or all is required');
const configs: Record<string, z.ZodType> = {
  token_budget: z.object({}),
  must_include: include,
  must_exclude: z.object({ any: words, match }),
  regex: z.object({
    pattern: z.string().min(1).max(200),
    flags: z.enum(['i', 'u', 'iu']).default('u'),
    mustMatch: z.boolean(),
  }),
  min_length: z.object({ words: z.number().int().positive() }),
  output_format: z.object({
    format: z.enum(['json', 'single_code_block', 'yaml', 'csv']),
    lang: z.string().optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    noProse: z.boolean().default(true),
  }),
  output_contains: include,
  llm_judge: z.object({
    rubric: z.string().min(1),
    passThreshold: z.number().min(0).max(1),
    criteria: z
      .array(z.object({ id: z.string(), description: z.string(), weight: z.number().positive() }))
      .min(1),
  }),
  code_tests: z.object({
    language: z.enum(['python', 'javascript']),
    extract: z.enum(['first_code_block', 'named_block']),
    tests: z.string(),
    timeoutMs: z.number().positive().max(5000),
  }),
  revision_scope: z.object({
    mustChange: words,
    mustKeep: z.literal('everything_else'),
    tolerance: z.number().min(0).max(1).default(0.1),
  }),
};
const check = z
  .object({
    key: z.string().min(1),
    type: z.string(),
    label: z.string().min(1),
    config: z.any(),
    required: z.boolean().default(true),
    weight: z.number().positive().default(1),
    client_visible: z.boolean().default(true),
  })
  .transform((c, ctx) => {
    const schema = configs[c.type];
    if (!schema) {
      ctx.addIssue({ code: 'custom', message: `Unknown check ${c.type}` });
      return z.NEVER;
    }
    const parsed = schema.safeParse(c.config);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: parsed.error.message });
      return z.NEVER;
    }
    if (c.type === 'regex') new RE2(c.config.pattern, `${c.config.flags?.replace('u', '') ?? ''}u`);
    if (c.type === 'output_format' && c.config.schema)
      new Ajv.default({ strict: false }).compile(c.config.schema);
    return {
      ...c,
      config: parsed.data,
      phase: ['token_budget', 'must_include', 'must_exclude', 'regex', 'min_length'].includes(
        c.type,
      )
        ? 'instant'
        : 'model',
    };
  });
const challenge = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    level: z.string(),
    position: z.number().int().positive(),
    published: z.boolean().default(true),
    title: z.string(),
    brief: z.string(),
    hint: z.string(),
    tags: z.array(z.string()).default([]),
    token_budget: z.number().int().min(1).max(4000),
    xp: z.number().int().min(0).max(10000),
    difficulty: z.number().int().min(1).max(5).default(1),
    context: z.record(z.string(), z.any()).default({}),
    run: z
      .object({
        model: z.literal('default'),
        max_output_tokens: z.number().int().positive().max(2000),
        temperature: z.literal(0),
        system: z.string(),
        prefix_messages: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
          .default([]),
      })
      .nullable()
      .default(null),
    checks: z.array(check),
  })
  .superRefine((c, ctx) => {
    if (
      new Set(c.checks.map((x) => x.key)).size !== c.checks.length ||
      c.checks.some((x) => x.key === 'token_budget')
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate/reserved check key' });
  });
const unlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('previous_level_cleared'), min_fraction: z.number().min(0).max(1) }),
]);
const level = z.object({
  slug: z.string(),
  position: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  blurb: z.string(),
  tip: z.string(),
  accent: z.string(),
  unlock,
});
export const contentDir = fileURLToPath(new URL('../challenges/', import.meta.url));
export async function loadContent() {
  const levels = z.array(level).parse(parse(await readFile(`${contentDir}/levels.yaml`, 'utf8')));
  const files = (await readdir(contentDir))
    .filter((x) => x.endsWith('.yaml') && !['levels.yaml', 'daily-overrides.yaml'].includes(x))
    .sort();
  const challenges = [];
  for (const file of files) {
    try {
      challenges.push(challenge.parse(parse(await readFile(`${contentDir}/${file}`, 'utf8'))));
    } catch (e) {
      throw new Error(`${file}: ${e}`);
    }
  }
  const slugs = new Set(),
    positions = new Set();
  for (const c of challenges) {
    const pos = `${c.level}:${c.position}`;
    if (slugs.has(c.slug) || positions.has(pos) || !levels.some((l) => l.slug === c.level))
      throw new Error(`Duplicate slug/position or invalid level: ${c.slug}`);
    slugs.add(c.slug);
    positions.add(pos);
  }
  if (
    new Set(levels.map((l) => l.position)).size !== levels.length ||
    new Set(levels.map((l) => l.slug)).size !== levels.length
  )
    throw new Error('Duplicate level');
  return { levels, challenges };
}
export async function loadDailyOverrides() {
  return z
    .array(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(
            (s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
            'Invalid calendar date',
          ),
        challengeSlug: z.string().min(1),
        bonusXp: z.number().int().nonnegative().max(10000).default(25),
        title: z.string().min(1).optional(),
      }),
    )
    .parse(parse(await readFile(`${contentDir}/daily-overrides.yaml`, 'utf8')));
}
