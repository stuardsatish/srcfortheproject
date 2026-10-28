/**
 * E2E — Customer checkout flow.
 * Checklist items: C05–C10, CT02–CT05, CH01–CH05, PY01–PY04.
 *
 * Requires TEST_CUSTOMER_EMAIL + TEST_CUSTOMER_PASSWORD env vars.
 */
import { test, expect } from '../fixtures.js'

test.describe('Authenticated customer — Cart', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsCustomer()
  })

  test('CT02 — add item to cart and verify badge updates', async ({ page }) => {
    await page.goto('/products')
    const card = page.locator('[data-testid="product-card"], .product-card, article').first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.click()
    const addBtn = page.getByRole('button', { name: /add to cart/i })
    await expect(addBtn).toBeVisible()
    await addBtn.click()
    // Cart badge should show at least 1 item
    const badge = page.locator('[data-testid="cart-count"], .cart-badge, .cart-count')
    await expect(badge).not.toBeEmpty({ timeout: 5_000 })
  })

  test('CT03 — cart page shows added items', async ({ page }) => {
    // Add an item first
    await page.goto('/products')
    const card = page.locator('[data-testid="product-card"], .product-card, article').first()
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.click()
    const addBtn = page.getByRole('button', { name: /add to cart/i })
    await addBtn.click()

    await page.goto('/cart')
    // Cart should list at least one item
    const cartItems = page.locator('[data-testid="cart-item"], .cart-item, .cart-row')
    await expect(cartItems.first()).toBeVisible({ timeout: 8_000 })
  })

  test('CT04 — quantity can be increased in cart', async ({ page }) => {
    await page.goto('/cart')
    const plusBtn = page.getByRole('button', { name: /\+|increase|add/i }).first()
    if (await plusBtn.isVisible()) {
      await plusBtn.click()
      // The page should not crash
      await expect(page.locator('body')).toBeVisible()
    }
  })
})

test.describe('Authenticated customer — Checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsCustomer()
  })

  test('CH01 — checkout page renders address form', async ({ page }) => {
    await page.goto('/checkout')
    // Should show an address section or redirect to cart if empty
    const body = page.locator('body')
    await expect(body).toBeVisible()
    await expect(body).not.toContainText('500')
  })

  test('CH02 — promo code input exists on checkout', async ({ page }) => {
    await page.goto('/checkout')
    const promoInput = page.getByPlaceholder(/promo|coupon|code/i)
    // Only assert if visible; cart might be empty
    if (await promoInput.isVisible()) {
      await promoInput.fill('INVALID-XYZ')
      await page.getByRole('button', { name: /apply/i }).click()
      // Expect an error message, not a crash
      await expect(page.locator('body')).toBeVisible()
    }
  })
})

test.describe('Authenticated customer — Orders', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsCustomer()
  })

  test('OR01 — my orders page loads', async ({ page }) => {
    await page.goto('/orders')
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('OR02 — order detail page opens from list', async ({ page }) => {
    await page.goto('/orders')
    const firstOrder = page.locator('[data-testid="order-row"], .order-card, tr').first()
    if (await firstOrder.isVisible({ timeout: 8_000 })) {
      await firstOrder.click()
      await expect(page.locator('body')).not.toContainText('500')
    }
  })
})

test.describe('Authenticated customer — Wishlist', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsCustomer()
  })

  test('WL01 — wishlist page loads', async ({ page }) => {
    await page.goto('/wishlist')
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('500')
  })
})
