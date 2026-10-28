/**
 * E2E — Admin panel flows.
 * Checklist items: A01–A04, P01–P05, B01–B05, D01–D06.
 *
 * Requires TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env vars.
 * Skip gracefully in CI when credentials are not provided.
 */
import { test, expect } from '../fixtures.js'

test.describe('Admin authentication', () => {
  test('A01 — admin can sign in and reach the dashboard', async ({ page }) => {
    await page.loginAsAdmin()
    await expect(page).toHaveURL(/admin|dashboard/i)
  })

  test('A03 — admin logout returns to login page', async ({ page }) => {
    await page.loginAsAdmin()
    const logoutBtn = page.getByRole('button', { name: /log ?out|sign ?out/i })
    await expect(logoutBtn).toBeVisible({ timeout: 8_000 })
    await logoutBtn.click()
    await expect(page).toHaveURL(/login/i, { timeout: 8_000 })
  })
})

test.describe('Admin — Product management', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsAdmin()
  })

  test('P01 — products list page loads', async ({ page }) => {
    await page.goto('/admin/products')
    await expect(page.locator('table, [data-testid="product-table"]').first()).toBeVisible({ timeout: 15_000 })
  })

  test('P02 — add product page renders the form', async ({ page }) => {
    await page.goto('/admin/add-product')
    await expect(page.getByLabel(/product name|title/i)).toBeVisible()
    await expect(page.getByLabel(/price/i)).toBeVisible()
    await expect(page.getByLabel(/category/i)).toBeVisible()
  })

  test('P03 — add product form validates required fields', async ({ page }) => {
    await page.goto('/admin/add-product')
    // Submit without filling in anything
    await page.getByRole('button', { name: /add product|save|submit/i }).click()
    // Expect at least one validation error to appear
    const error = page.locator('[class*="error"], [data-testid*="error"], .error-text, [role="alert"]').first()
    await expect(error).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Admin — Bulk import', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsAdmin()
  })

  test('B01 — bulk import page is accessible', async ({ page }) => {
    await page.goto('/admin/bulk-import')
    // The file input or upload area should be present
    const uploader = page.locator('input[type="file"], [data-testid="file-upload"]').first()
    await expect(uploader).toBeAttached({ timeout: 10_000 })
  })
})

test.describe('Admin — Discounts', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsAdmin()
  })

  test('D01 — discounts / promo codes page loads', async ({ page }) => {
    await page.goto('/admin/discounts')
    await expect(page.locator('body')).not.toContainText('404')
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Admin — Orders', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsAdmin()
  })

  test('O01 — admin orders page loads the list', async ({ page }) => {
    await page.goto('/admin/orders')
    await expect(page.locator('table, [data-testid="orders-table"]').first()).toBeVisible({ timeout: 15_000 })
  })
})
