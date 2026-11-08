export type Mode = 'word' | 'prefix' | 'substring' | 'phrase';
export interface Check {
  key: string;
  type: string;
  phase: string;
  label: string;
  config: any;
  required: boolean;
  weight: number;
  client_visible?: boolean;
}
export interface Result {
  key: string;
  passed: boolean;
  score: number;
  message?: string;
  details?: any;
  skipped?: boolean;
}
export const normalise = (s: string) =>
  s.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
export const estimate = (s: string) => Math.ceil(s.trim().length / 4);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function matches(text: string, term: string, mode: Mode = 'word') {
  const s = normalise(text),
    t = normalise(term);
  if (mode === 'substring') return s.includes(t);
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escape(t)}${mode === 'prefix' ? '' : '(?![\\p{L}\\p{N}_])'}`,
    'u',
  ).test(s);
}
export function includes(text: string, c: any) {
  return (
    (!c.any || c.any.filter((x: string) => matches(text, x, c.match)).length >= (c.min ?? 1)) &&
    (!c.all || c.all.every((x: string) => matches(text, x, c.match)))
  );
}
export function instant(check: Check, prompt: string, count: number, budget: number): Result {
  let passed = false;
  switch (check.type) {
    case 'token_budget':
      passed = count > 0 && count <= budget;
      break;
    case 'must_include':
      passed = includes(prompt, check.config);
      break;
    case 'must_exclude':
      passed = !check.config.any.some((x: string) => matches(prompt, x, check.config.match));
      break;
    case 'min_length':
      passed = normalise(prompt).split(' ').filter(Boolean).length >= check.config.words;
      break;
    default:
      throw new Error(`Use the server runner for ${check.type}`);
  }
  return {
    key: check.key,
    passed,
    score: passed ? 1 : 0,
    message:
      check.type === 'token_budget'
        ? `${count} / ${budget} tokens`
        : passed
          ? 'Check passed'
          : `Check failed: ${check.label}`,
  };
}
