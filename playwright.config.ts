import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 8000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1050 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3010',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      NODE_ENV: 'development',
      WEB_PORT: '3010',
      API_PORT: '8090',
      DATABASE_URL: 'pglite://',
      ANTHROPIC_API_KEY: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      SENTRY_DSN: '',
    },
  },
});
