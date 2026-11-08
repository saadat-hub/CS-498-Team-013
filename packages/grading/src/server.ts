import { RE2 } from 're2-wasm';
import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';
import { instant, includes, type Check, type Result } from './instant.js';
const ajv = new Ajv.default({ strict: false });
export function runInstant(c: Check, prompt: string, count: number, budget: number): Result {
  if (c.type !== 'regex') return instant(c, prompt, count, budget);
  const passed =
    new RE2(c.config.pattern, `${c.config.flags?.replace('u', '') ?? ''}u`).test(prompt) ===
    c.config.mustMatch;
  return { key: c.key, passed, score: passed ? 1 : 0 };
}
export function outputCheck(c: Check, output: string, context: any): Result {
  let passed = false,
    message = 'Output does not meet the requested format';
  if (c.type === 'output_contains') passed = includes(output, c.config);
  else if (c.type === 'revision_scope') {
    const extract = (s: string) => s.match(/```[^\n]*\n([\s\S]*?)```/)?.[1] ?? s;
    const before = extract(context.previous_answer ?? ''),
      after = extract(output);
    const canonical = (s: string) =>
      s
        .replace(/\b(var|let|const)\b/g, 'DECL')
        .replace(/\s+/g, ' ')
        .trim();
    // Token edit distance detects changes beyond declaration replacements.
    const a = canonical(before).split(' '),
      b = canonical(after).split(' ');
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(
          next[j - 1] + 1,
          row[j] + 1,
          row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      row = next;
    }
    const similarity = 1 - row[b.length] / Math.max(a.length, b.length, 1);
    passed =
      !/\bvar\b/.test(after) &&
      /\b(let|const)\b/.test(after) &&
      similarity >= 1 - (c.config.tolerance ?? 0.1);
    message = `Unrelated code similarity: ${Math.round(similarity * 100)}%`;
  } else if (c.type === 'output_format') {
    const raw = output.trim(),
      fences = [...raw.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];
    const onlyFence = fences.length === 1 && fences[0][0] === raw;
    const content = onlyFence ? fences[0][2] : raw;
    try {
      switch (c.config.format) {
        case 'json': {
          const value = JSON.parse(content);
          passed = c.config.schema ? !!ajv.validate(c.config.schema, value) : true;
          break;
        }
        case 'yaml': {
          const value = parseYaml(content);
          passed = value !== null && typeof value === 'object';
          break;
        }
        case 'csv': {
          const lines = content.split(/\r?\n/);
          passed =
            lines.length > 1 &&
            lines.every((x) => x.split(',').length === lines[0].split(',').length);
          break;
        }
        case 'single_code_block':
          passed =
            fences.length === 1 &&
            (!c.config.noProse || onlyFence) &&
            (!c.config.lang ||
              fences[0][1].trim().toLowerCase().replace(/^htm$/, 'html') ===
                c.config.lang.toLowerCase());
          break;
      }
    } catch {
      passed = false;
    }
  }
  return {
    key: c.key,
    passed,
    score: passed ? 1 : 0,
    message: passed ? 'Output check passed' : message,
  };
}
export const manipulation = (s: string) =>
  /ignore\s+(all|the|previous)[\s\S]*(instruction|rubric)|\b(grader|rubric)\b|mark\s+(this|it)\s+as\s+pass/i.test(
    s,
  );
