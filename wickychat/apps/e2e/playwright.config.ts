import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a real stack: API + web + Postgres + Mailpit.
 * Start infrastructure with `pnpm infra:up`; Playwright starts the app servers
 * (or reuses ones already running).
 */
const WEB_PORT = '3100'
const API_PORT = '4100'
const PLUGINS_PORT = '4300'
const OFFICIAL_KEY = 'e2e-official-plugins-key'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Tests share the seeded people (Ada, Ben…), and each person can only be in one call or meeting at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // Dedicated servers on their own ports, always using the local test inbox (Mailpit),
  // so tests never send real email, whatever .env says.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          // Quid's official plugins (apps/plugins), so tests can install and run them.
          command:
            'pnpm --filter @quid/plugins exec tsx --env-file-if-exists=../../.env src/main.ts',
          url: `http://localhost:${PLUGINS_PORT}/healthz`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
          env: { PORT: PLUGINS_PORT, OFFICIAL_PLUGINS_KEY: OFFICIAL_KEY },
        },
        {
          command: 'pnpm --filter @quid/api exec tsx --env-file-if-exists=../../.env src/main.ts',
          url: `http://localhost:${API_PORT}/healthz`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: '../..',
          env: {
            PORT: API_PORT,
            WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
            PUBLIC_WS_URL: `ws://localhost:${API_PORT}/ws`,
            EMAIL_PROVIDER: 'smtp',
            AUTH_RATE_LIMIT_PER_MINUTE: '200',
            RATE_LIMIT_PER_MINUTE: '20000',
            // Placeholder Google client: shows the buttons; tests stop at the redirect to Google.
            GOOGLE_CLIENT_ID: 'e2e-placeholder.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'e2e-placeholder',
            // Billing on with placeholder PayPal settings (the seeded demo workspace is exempt).
            BILLING_PROVIDER: 'paypal',
            PLATFORM_ADMIN_EMAILS: 'ada@dev.quid.local',
            OFFICIAL_PLUGINS_URL: `http://localhost:${PLUGINS_PORT}`,
            OFFICIAL_PLUGINS_KEY: OFFICIAL_KEY,
            PAYPAL_CLIENT_ID: 'e2e-placeholder',
            PAYPAL_CLIENT_SECRET: 'e2e-placeholder',
            PAYPAL_WEBHOOK_ID: 'WH-E2E',
            PAYPAL_PLAN_MONTHLY: 'P-E2EMONTHLY',
            PAYPAL_PLAN_YEARLY: 'P-E2EYEARLY',
            PAYPAL_PLAN_ENT_MONTHLY: 'P-E2EENTMONTHLY',
            PAYPAL_PLAN_ENT_YEARLY: 'P-E2EENTYEARLY',
            PAYPAL_PLAN_INTRO_MONTHLY: 'P-E2EINTRO',
            PAYPAL_PLAN_ENT_INTRO_MONTHLY: 'P-E2EENTINTRO',
            PAYPAL_PROMO_PLANS: 'PH10P:pro:P-E2EPH10P,PH10P:enterprise:P-E2EPH10PENT',
            SMTP_URL: 'smtp://localhost:1025',
            LOG_LEVEL: 'warn',
          },
        },
        {
          command: `pnpm --filter @quid/web exec next dev --port ${WEB_PORT}`,
          url: `http://localhost:${WEB_PORT}/login`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          cwd: '../..',
          env: { API_URL: `http://localhost:${API_PORT}`, NEXT_DIST_DIR: '.next-e2e' },
        },
      ],
})
