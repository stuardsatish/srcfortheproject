// @ts-check
import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for Ecommerce-website.
 *
 * CI behaviour (when process.env.CI is set):
 *   - Uses `vite preview` on port 4173 (the pre-built bundle from `npm run build`)
 *   - Retries flaky tests twice
 *   - Records traces and videos on failure for later debugging
 *
 * Local behaviour:
 *   - Uses `vite dev` on port 5173 (hot-reload dev server)
 *   - Reuses an already-running dev server
 *   - No retries
 *
 * @see https://playwright.dev/docs/test-configuration
 */
const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',

  /* Maximum time per test */
  timeout: isCI ? 60_000 : 30_000,

  /* Fail the build on CI if test.only is left in source */
  forbidOnly: isCI,

  /* Retry flaky tests on CI */
  retries: isCI ? 2 : 0,

  /* Single worker on CI to avoid port conflicts; parallel locally */
  workers: isCI ? 1 : 2,

  /* Reporter: list always, HTML always, GitHub annotations on CI */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ...(isCI ? [['github']] : []),
  ],

  /* Shared settings for all projects */
  use: {
    /* Base URL: CI uses preview server, local uses dev server */
    baseURL: process.env.PLAYWRIGHT_BASE_URL
      || (isCI ? 'http://localhost:4173' : 'http://localhost:5173'),

    /* Always capture screenshot on failure */
    screenshot: 'only-on-failure',

    /* Trace on every failure (not just first retry) in CI */
    trace: isCI ? 'retain-on-failure' : 'on-first-retry',

    /* Video on retry so we can replay what happened */
    video: isCI ? 'on-first-retry' : 'off',

    /* Timeouts */
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  /* Test projects: Desktop Chrome, Firefox, and mobile Chrome */
  projects: [
    { name: 'chromium',      use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',       use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],

  /*
   * Web server:
   *   CI   → `vite preview` on port 4173 (serve the pre-built bundle)
   *   Local → `vite dev`    on port 5173 (hot-reload dev server)
   *
   * The CI workflow calls `npm run build` before running Playwright, so
   * `vite preview` finds an already-built `dist/` folder.
   */
  webServer: {
    command: isCI ? 'npm run preview -- --port 4173' : 'npm run dev',
    port: isCI ? 4173 : 5173,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
