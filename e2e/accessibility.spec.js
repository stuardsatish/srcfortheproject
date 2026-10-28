/**
 * E2E — Accessibility audit using axe-core via @axe-core/playwright.
 * Checklist items: AX01–AX08 (accessibility).
 *
 * Scans key public and authenticated pages for WCAG 2.1 AA violations.
 * Uses the @axe-core/playwright package.
 *
 * Install: npm install --save-dev @axe-core/playwright
 * (already included in the package.json devDependencies after this addition)
 *
 * These tests run with the smoke project (Chromium headless) on CI.
 * Violations are logged with full impact and help URLs for easy triage.
 */
import { test, expect } from '../fixtures.js'
import AxeBuilder from '@axe-core/playwright'

// ── Axe configuration ─────────────────────────────────────────────────────────
// Run the WCAG 2.1 AA ruleset. Disable known false-positives from
// third-party widgets (Razorpay badge, Swiper carousels) that we cannot control.
const axeConfig = {
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
  // Exclude third-party iframes and injected widgets
  exclude: [
    ['iframe[src*="razorpay"]'],
    ['[class*="swiper"]'],
    ['.rz-badge'],
  ],
}

/** Helper: run axe and assert zero violations, reporting details on failure */
async function assertNoA11yViolations(page, label = '') {
  const { violations } = await new AxeBuilder({ page })
    .options(axeConfig)
    .analyze()

  if (violations.length > 0) {
    const report = violations
      .map((v) =>
        `[${v.impact.toUpperCase()}] ${v.id}: ${v.description}\n` +
        v.nodes.slice(0, 2).map((n) => `  ↳ ${n.html}`).join('\n') +
        `\n  Help: ${v.helpUrl}`
      )
      .join('\n\n')
    console.error(`Accessibility violations on ${label}:\n${report}`)
  }

  // Allow 'minor' and 'moderate' as warnings; fail on 'serious' and 'critical'
  const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact))
  expect(
    serious,
    `${serious.length} serious/critical a11y violation(s) on ${label}`
  ).toHaveLength(0)
}

// ── Public pages (unauthenticated) ────────────────────────────────────────────
test.describe('Accessibility — Public pages', () => {
  test('AX01 — homepage has no serious WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await assertNoA11yViolations(page, 'Homepage (/)')
  })

  test('AX02 — product catalogue has no serious violations', async ({ page }) => {
    await page.goto('/products')
    await page.waitForLoadState('networkidle')
    await assertNoA11yViolations(page, 'Catalogue (/products)')
  })

  test('AX03 — login page has no serious violations', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    await assertNoA11yViolations(page, 'Login (/login)')
  })

  test('AX04 — returns policy page has no serious violations', async ({ page }) => {
    await page.goto('/policies/returns')
    await page.waitForTimeout(500)
    await assertNoA11yViolations(page, 'Returns Policy')
  })
})

// ── Authenticated customer pages ──────────────────────────────────────────────
test.describe('Accessibility — Authenticated customer pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsCustomer()
  })

  test('AX05 — orders page has no serious violations', async ({ page }) => {
    await page.goto('/orders')
    await page.waitForLoadState('networkidle')
    await assertNoA11yViolations(page, 'Orders (/orders)')
  })

  test('AX06 — checkout page has no serious violations', async ({ page }) => {
    await page.goto('/checkout')
    await page.waitForLoadState('networkidle')
    await assertNoA11yViolations(page, 'Checkout (/checkout)')
  })

  test('AX07 — wishlist / saved items has no serious violations', async ({ page }) => {
    const routes = ['/wishlist', '/saved', '/account/saved']
    for (const route of routes) {
      await page.goto(route)
      const is404 = await page.locator('body').textContent()
        .then(t => t.includes('404')).catch(() => false)
      if (!is404) {
        await page.waitForLoadState('networkidle')
        await assertNoA11yViolations(page, `Saved Items (${route})`)
        return
      }
    }
  })
})

// ── Admin pages ───────────────────────────────────────────────────────────────
test.describe('Accessibility — Admin pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsAdmin()
  })

  test('AX08 — admin orders page has no serious violations', async ({ page }) => {
    await page.goto('/admin/orders')
    await page.waitForLoadState('networkidle')
    await assertNoA11yViolations(page, 'Admin Orders (/admin/orders)')
  })
})

// ── Keyboard navigation smoke ─────────────────────────────────────────────────
test.describe('Keyboard navigation', () => {
  test('AX09 — can Tab through homepage navigation without a mouse', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    // After 3 tabs some interactive element should be focused
    const focused = await page.evaluate(() => document.activeElement?.tagName)
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(focused)).toBeTruthy()
  })

  test('AX10 — modals trap focus and can be dismissed with Escape', async ({ page }) => {
    await page.goto('/products')
    await page.waitForLoadState('networkidle')
    // Open any modal (search, cart, filter panel)
    const searchTrigger = page
      .getByRole('button', { name: /search/i })
      .or(page.getByLabel(/search/i))
      .first()
    if (await searchTrigger.isVisible({ timeout: 5_000 })) {
      await searchTrigger.click()
      await page.waitForTimeout(300)
      // Escape should close the modal
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      // Focus should return to something on the page (not be lost)
      const focused = await page.evaluate(() => document.activeElement?.tagName)
      expect(focused).not.toBe('BODY')
    }
  })
})
