import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function signIn(page: Page) {
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Start local session' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
}
test('learner can save a draft, grade, keep a prompt, and see real progress', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.goto('/challenge/hello-function');
  await page
    .getByRole('textbox', { name: 'Your prompt', exact: true })
    .fill('Write a Python function to reverse a string.');
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your prompt', exact: true })).toHaveValue(
    'Write a Python function to reverse a string.',
  );
  await page.getByRole('button', { name: 'Submit for feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Clear thinking. Well done.' })).toBeVisible();
  await page.getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByRole('status')).toContainText('Saved to your prompt library');
  await page.goto('/library');
  await expect(
    page.getByRole('heading', { name: 'Hello, function', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save a prompt' }).click();
  await page.getByLabel('Title', { exact: true }).fill(`Browser test ${testInfo.project.name}`);
  await page
    .getByLabel('Prompt', { exact: true })
    .fill('Explain recursion with a small Python example.');
  await page.getByRole('button', { name: 'Save prompt', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `Browser test ${testInfo.project.name}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `Delete Browser test ${testInfo.project.name}`, exact: true })
    .click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `Browser test ${testInfo.project.name}`, exact: true }),
  ).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('link', { name: /1\.1 Hello, function/ }).first()).toBeVisible();
  await expect
    .poll(async () =>
      Number((await page.locator('.stat-card .stat-value').first().innerText()).replace(/\D/g, '')),
    )
    .toBeGreaterThanOrEqual(50);
  await page.screenshot({
    path: `test-results/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('anonymous browsing, search, track filtering, and responsive navigation work', async ({
  page,
}, testInfo) => {
  await page.goto('/challenges');
  await expect(page.locator('.challenge-tile')).toHaveCount(20);
  await page.getByRole('button', { name: 'Machine learning', exact: true }).click();
  await expect(page.locator('.challenge-tile')).toHaveCount(10);
  await page.getByRole('textbox', { name: 'Filter challenges', exact: true }).fill('NumPy');
  await expect(page.locator('.challenge-tile')).toHaveCount(1);
  await page.getByRole('link', { name: /Scale numeric features/ }).click();
  await expect(page.getByText('Challenge context', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to submit' })).toBeVisible();
  await page.goto('/');
  const search = page.getByRole('textbox', { name: 'Search challenges', exact: true });
  await search.fill('Python');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'Results for “Python”' })).toBeVisible();
  await expect(page.locator('.search-result').first()).toBeVisible();
  for (const path of [
    '/',
    '/roadmap',
    '/challenges',
    '/challenge/json-only',
    '/leaderboard',
    '/signin',
  ]) {
    await page.goto(path);
    await expect(page.locator('h1,h2').filter({ visible: true }).first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
  await page.goto('/');
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('link', { name: 'Learning roadmap', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Build your understanding.' })).toBeVisible();
  }
});
test('settings persist and AI-disabled grading gives an actionable message', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto('/settings');
  await page.getByLabel('Display name', { exact: true }).fill('Curious Learner');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.reload();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Curious Learner');
  await page.goto('/challenge/json-only');
  await page
    .getByRole('textbox', { name: 'Your prompt', exact: true })
    .fill('Return a user profile as JSON only.');
  await page.getByRole('button', { name: 'Submit for feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('Configure Anthropic');
  await page.screenshot({
    path: `test-results/workbench-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test('key screens meet automated WCAG A and AA checks', async ({ page }) => {
  for (const path of ['/', '/challenge/hello-function', '/signin']) {
    await page.goto(path);
    await expect(page.locator('h1,h2').filter({ visible: true }).first()).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        description: v.help,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
      path,
    ).toEqual([]);
  }
});
