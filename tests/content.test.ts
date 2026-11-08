import { it, expect } from 'vitest';
import { loadContent } from '../packages/content/src/loader.js';
import { runInstant } from '../packages/grading/src/server.js';
import { estimate } from '../packages/grading/src/instant.js';
import { readFile } from 'node:fs/promises';
const cases: Record<string, { pass: string[]; fail: string[] }> = {
  'hello-function': {
    pass: [
      'Write a Python function to reverse a string.',
      'Python: reverse the input string using a function.',
      'In Python implement reversed text.',
    ],
    fail: ['Write code.', 'Reverse a string in JavaScript.', 'Python sorting function.'],
  },
  'return-the-max': {
    pass: [
      'Write a JavaScript maximum function; empty arrays return null.',
      'In JS return the max and handle an empty input.',
      'JavaScript array max: empty means null.',
    ],
    fail: ['Return the max.', 'JS array max.', 'Handle empty arrays in Python.'],
  },
  'no-libraries': {
    pass: [
      'Python todo app using standard library: add, list, delete.',
      'Python stdlib task list with add and remove.',
      'Python CLI: no external packages; list tasks.',
    ],
    fail: ['Python task manager.', 'Use React to add tasks.', 'Python standard library only.'],
  },
  'edge-case-hunter': {
    pass: [
      'Validate emails; handle empty input and whitespace.',
      'Write email validation for the edge case with two @ signs.',
      'Validate missing email addresses.',
    ],
    fail: ['Validate email.', 'Handle empty input.', 'Write a hello function.'],
  },
  'json-only': {
    pass: [
      'Return a user profile as JSON only.',
      'JSON user data, nothing else.',
      'Generate JSON with no prose.',
    ],
    fail: ['Return data.', 'Write JSON please.', 'Only text please.'],
  },
  'one-file-no-chatter': {
    pass: [
      'HTML single file, code only.',
      'Return one file of HTML, no explanation.',
      'Generate a single HTML file, nothing else.',
    ],
    fail: ['Generate HTML.', 'One file please.', 'HTML one file with explanation.'],
  },
  'read-the-error': {
    pass: [
      'Explain why the TypeError happened and fix it.',
      'Fix undefined data; explain the cause.',
      'TypeError: fix it and explain why.',
    ],
    fail: ['Fix this.', 'TypeError fix please.', 'Explain the TypeError.'],
  },
  'one-change-at-a-time': {
    pass: [
      'Replace var with let only.',
      'Change var to const, nothing else.',
      'Replace var with let, keep everything else unchanged.',
    ],
    fail: ['Refactor the code.', 'Replace var declarations.', 'Use const instead of var.'],
  },
  'weekend-app-spec': {
    pass: [
      'Use React. Feature: tasks; feature: filtering. Include file structure.',
      'Build a Flask app with a login feature and folder structure.',
      'Use Node; describe each feature and file.',
    ],
    fail: ['Build an app.', 'React app feature list.', 'Feature and file structure please.'],
  },
  'make-it-testable': {
    pass: [
      'Write a function with test cases for missed inputs.',
      'Create a function and test cases; describe any gap.',
      'Add a function and test what might break.',
    ],
    fail: ['Write a function.', 'Write a test.', 'Function with test cases.'],
  },
};
it('has three positive and three negative instant golden prompts per challenge', async () => {
  const content = await loadContent();
  const mlCases = JSON.parse(
    await readFile(
      new URL('../packages/content/challenges/__golden__/machine-learning.json', import.meta.url),
      'utf8',
    ),
  );
  for (const c of content.challenges) {
    const fixture = cases[c.slug] ?? mlCases[c.slug];
    expect(fixture).toBeDefined();
    const checks = [
      {
        key: 'token_budget',
        type: 'token_budget',
        phase: 'instant',
        config: {},
        label: 'budget',
        required: true,
        weight: 1,
      },
      ...c.checks.filter((k) => k.phase === 'instant'),
    ];
    for (const p of fixture.pass)
      expect(
        checks.every((k) => runInstant(k, p, estimate(p), c.token_budget).passed),
        `${c.slug}: ${p}`,
      ).toBe(true);
    for (const p of fixture.fail)
      expect(
        checks.every((k) => runInstant(k, p, estimate(p), c.token_budget).passed),
        `${c.slug}: ${p}`,
      ).toBe(false);
  }
});
