/**
 * Shared Playwright test fixtures and helpers for the Ecommerce-website E2E suite.
 *
 * Usage:
 *   import { test, expect } from '../fixtures'
 *
 * Adds:
 *   - `loginAsAdmin(page)`   — signs in with admin credentials
 *   - `loginAsCustomer(page)` — signs in with a test customer account
 *   - Page Object helpers for common UI sections
 */
import { test as base, expect } from '@playwright/test'

// ── Credentials (override via environment variables in CI) ──────────────────
export const TEST_ACCOUNTS = {
  admin: {
    email: process.env.TEST_ADMIN_EMAIL || 'admin@test.local',
    password: process.env.TEST_ADMIN_PASSWORD || 'TestAdmin@123',
  },
  customer: {
    email: process.env.TEST_CUSTOMER_EMAIL || 'customer@test.local',
    password: process.env.TEST_CUSTOMER_PASSWORD || 'TestCustomer@123',
  },
}

// ── Login helpers ────────────────────────────────────────────────────────────
export async function loginAsAdmin(page) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(TEST_ACCOUNTS.admin.email)
  await page.getByLabel(/password/i).fill(TEST_ACCOUNTS.admin.password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  // Wait until redirected away from /login
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 })
}

export async function loginAsCustomer(page) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(TEST_ACCOUNTS.customer.email)
  await page.getByLabel(/password/i).fill(TEST_ACCOUNTS.customer.password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 })
}

// ── Extended test fixture ─────────────────────────────────────────────────────
export const test = base.extend({
  /** Page with test-account helpers attached */
  page: async ({ page }, use) => {
    page.loginAsAdmin = () => loginAsAdmin(page)
    page.loginAsCustomer = () => loginAsCustomer(page)
    await use(page)
  },
})

export { expect }
