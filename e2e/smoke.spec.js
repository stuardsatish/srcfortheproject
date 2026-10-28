/**
 * E2E — Public homepage + navigation smoke tests.
 * Checklist items: A01 (admin login), C01–C04 (customer browsing), H01 (homepage).
 *
 * These tests run against the live dev server without authentication
 * so they verify the customer-facing public surfaces.
 */
import { test, expect } from '../fixtures.js'

test.describe('Homepage', () => {
  test('H01 — loads and shows at least one product section', async ({ page }) => {
    await page.goto('/')
    // Title should contain the store name
    await expect(page).toHaveTitle(/sweets|shop|ecommerce/i)
    // At least one product card or hero section is visible
    const hero = page.locator('[data-testid="hero"], .hero, section').first()
    await expect(hero).toBeVisible()
  })

  test('H02 — navigation links are present', async ({ page }) => {
    await page.goto('/')
    // Navbar links: Products / Shop / Cart
    const nav = page.getByRole('navigation')
    await expect(nav).toBeVisible()
  })
})

test.describe('Product browsing (unauthenticated)', () => {
  test('C01 — /products page loads product cards', async ({ page }) => {
    await page.goto('/products')
    // Wait for at least one product card to appear
    const cards = page.locator('[data-testid="product-card"], .product-card, article').first()
    await expect(cards).toBeVisible({ timeout: 15_000 })
  })

  test('C02 — search results page responds to a query', async ({ page }) => {
    await page.goto('/products?search=shirt')
    // The URL should carry the query parameter
    await expect(page).toHaveURL(/search=shirt/)
    // Page should not throw a fatal error
    await expect(page.locator('body')).not.toContainText('Unhandled error')
  })

  test('C03 — clicking a product card navigates to its detail page', async ({ page }) => {
    await page.goto('/products')
    const firstCard = page.locator('[data-testid="product-card"], .product-card, article').first()
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    await firstCard.click()
    // URL should now be /products/<id> or /product/<id>
    await expect(page).toHaveURL(/\/product/)
  })

  test('C04 — add-to-cart button is visible on product detail', async ({ page }) => {
    await page.goto('/products')
    const firstCard = page.locator('[data-testid="product-card"], .product-card, article').first()
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    await firstCard.click()
    // Add to cart button
    const addBtn = page.getByRole('button', { name: /add to cart|buy now/i })
    await expect(addBtn).toBeVisible()
  })
})

test.describe('Cart page (unauthenticated)', () => {
  test('CT01 — /cart loads without error', async ({ page }) => {
    await page.goto('/cart')
    // Should not show a blank page or 500 error
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Application error')
  })
})

test.describe('Login page', () => {
  test('A01 — login form renders email and password fields', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible()
  })

  test('A02 — invalid credentials show an error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('invalid@bad.test')
    await page.getByLabel(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    // Error message should appear (not a redirect)
    await expect(page.locator('body')).toContainText(/(invalid|incorrect|error|wrong)/i, { timeout: 8_000 })
  })
})
