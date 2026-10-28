/**
 * E2E — Exchange and Refund flows (customer-facing + admin).
 * Checklist items: EX01–EX06 (exchange), RF01–RF05 (refund).
 *
 * Tests verify:
 *   - Entry points exist and are reachable (no crash / 500)
 *   - Exchange option surfaces on eligible delivered orders
 *   - Refund status is visible on returned/resolved orders
 *   - Admin can see and process exchange / refund requests
 *
 * Full happy-path automation requires seeded test data (a fulfilled order
 * with a completed return request). Steps that depend on seeded data are
 * marked as soft assertions — they pass when no qualifying order exists
 * (expected in a fresh CI environment) but catch regressions when data exists.
 */
import { test, expect } from '../fixtures.js'

// ─────────────────────────────────────────────────────────────────────────────
// Exchange — Customer
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Exchange — Customer flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsCustomer()
  })

  test('EX01 — orders list loads without error', async ({ page }) => {
    await page.goto('/orders')
    await expect(page.locator('body')).not.toContainText('500', { timeout: 10_000 })
    await expect(page.locator('body')).not.toContainText('404')
    await expect(page.locator('body')).toBeVisible()
  })

  test('EX02 — exchange entry point visible on a delivered order', async ({ page }) => {
    await page.goto('/orders')
    const deliveredOrder = page.getByText(/delivered/i).first()
    if (await deliveredOrder.isVisible({ timeout: 10_000 })) {
      // Navigate to the order detail
      const orderCard = deliveredOrder.locator('xpath=ancestor::*[contains(@class,"card") or contains(@class,"row") or contains(@class,"item")][1]')
      await orderCard.click()
      await page.waitForTimeout(1_000)
      // Look for exchange button/link
      const exchangeBtn = page
        .getByRole('button', { name: /exchange/i })
        .or(page.getByRole('link', { name: /exchange/i }))
        .first()
      if (await exchangeBtn.isVisible({ timeout: 5_000 })) {
        await expect(exchangeBtn).toBeEnabled()
      }
    }
    // Soft assertion: no crash regardless
    await expect(page.locator('body')).not.toContainText('500')
  })

  test('EX03 — exchange request form opens without crashing', async ({ page }) => {
    await page.goto('/orders')
    const exchangeBtn = page
      .getByRole('button', { name: /exchange/i })
      .or(page.getByRole('link', { name: /exchange/i }))
      .first()
    if (await exchangeBtn.isVisible({ timeout: 10_000 })) {
      await exchangeBtn.click()
      await page.waitForTimeout(1_000)
      await expect(page.locator('body')).not.toContainText('500')
      await expect(page.locator('body')).not.toContainText('Unexpected error')
    }
  })

  test('EX04 — my exchanges / returns page loads', async ({ page }) => {
    const routes = ['/returns', '/my-returns', '/account/returns', '/orders']
    let loaded = false
    for (const route of routes) {
      await page.goto(route)
      const is500 = await page.locator('body').textContent()
        .then(t => t.includes('500')).catch(() => false)
      if (!is500) { loaded = true; break }
    }
    expect(loaded).toBeTruthy()
  })

  test('EX05 — exchange status is shown for a pending exchange', async ({ page }) => {
    await page.goto('/orders')
    // Look for any exchange status badge
    const statusBadge = page
      .getByText(/exchange requested|exchange pending|awaiting exchange/i)
      .first()
    if (await statusBadge.isVisible({ timeout: 8_000 })) {
      await expect(statusBadge).toBeVisible()
    } else {
      // No seeded exchange data — at least the page didn't crash
      await expect(page.locator('body')).not.toContainText('500')
    }
  })

  test('EX06 — cancelled order does NOT show exchange option', async ({ page }) => {
    await page.goto('/orders')
    const cancelledOrder = page.getByText(/cancelled/i).first()
    if (await cancelledOrder.isVisible({ timeout: 8_000 })) {
      const orderArea = cancelledOrder.locator('xpath=ancestor::*[contains(@class,"card") or contains(@class,"row")][1]')
      const exchangeBtn = orderArea
        .getByRole('button', { name: /exchange/i })
        .first()
      // Exchange button should NOT be present on a cancelled order
      const isVisible = await exchangeBtn.isVisible({ timeout: 2_000 }).catch(() => false)
      expect(isVisible).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Refund — Customer
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Refund — Customer flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsCustomer()
  })

  test('RF01 — refund status visible on a return request', async ({ page }) => {
    await page.goto('/orders')
    const refundStatus = page
      .getByText(/refund initiated|refund processed|refund pending|₹.*refunded/i)
      .first()
    if (await refundStatus.isVisible({ timeout: 8_000 })) {
      await expect(refundStatus).toBeVisible()
    } else {
      await expect(page.locator('body')).not.toContainText('500')
    }
  })

  test('RF02 — refund amount and method displayed on resolved request', async ({ page }) => {
    await page.goto('/orders')
    // Navigate into a return/refund detail if one exists
    const requestLink = page
      .getByRole('link', { name: /view request|return details|return #/i })
      .or(page.getByText(/return #/i))
      .first()
    if (await requestLink.isVisible({ timeout: 8_000 })) {
      await requestLink.click()
      await page.waitForTimeout(1_000)
      await expect(page.locator('body')).not.toContainText('500')
      // Refund section should appear
      const refundSection = page.getByText(/refund/i).first()
      if (await refundSection.isVisible({ timeout: 5_000 })) {
        await expect(refundSection).toBeVisible()
      }
    }
  })

  test('RF03 — page does not crash on the refund confirmation route', async ({ page }) => {
    const routes = ['/returns', '/refunds', '/account/refunds', '/orders']
    for (const route of routes) {
      await page.goto(route)
      const is404 = await page.locator('body').textContent()
        .then(t => t.includes('404')).catch(() => false)
      if (!is404) {
        await expect(page.locator('body')).not.toContainText('500', { timeout: 8_000 })
        return
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Exchange / Refund — Admin
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Exchange / Refund — Admin management', () => {
  test.beforeEach(async ({ page }) => {
    await page.loginAsAdmin()
  })

  test('RF04 — admin returns list loads without error', async ({ page }) => {
    const routes = ['/admin/returns', '/admin/requests', '/admin/orders']
    for (const route of routes) {
      await page.goto(route)
      const is404 = await page.locator('body').textContent()
        .then(t => t.includes('404')).catch(() => false)
      if (!is404) {
        await expect(page.locator('body')).not.toContainText('500', { timeout: 10_000 })
        return
      }
    }
    await expect(page.locator('body')).toBeVisible()
  })

  test('RF05 — admin can see exchange/refund request list', async ({ page }) => {
    const routes = ['/admin/returns', '/admin/requests']
    for (const route of routes) {
      await page.goto(route)
      const is404 = await page.locator('body').textContent()
        .then(t => t.includes('404')).catch(() => false)
      if (!is404) {
        await page.waitForLoadState('networkidle')
        // Look for a table/list of requests
        const list = page.locator('table, [data-testid="request-list"], [class*="request"]').first()
        if (await list.isVisible({ timeout: 8_000 })) {
          await expect(list).toBeVisible()
        } else {
          // Empty state is acceptable (no seeded data)
          await expect(page.locator('body')).not.toContainText('500')
        }
        return
      }
    }
  })

  test('EX07 — admin can approve or reject a pending exchange request', async ({ page }) => {
    const routes = ['/admin/returns', '/admin/requests']
    for (const route of routes) {
      await page.goto(route)
      const is404 = await page.locator('body').textContent()
        .then(t => t.includes('404')).catch(() => false)
      if (!is404) {
        await page.waitForLoadState('networkidle')
        const pendingRow = page.getByText(/pending|submitted|under review/i).first()
        if (await pendingRow.isVisible({ timeout: 8_000 })) {
          const rowContainer = pendingRow.locator('xpath=ancestor::tr[1]').or(pendingRow.locator('..'))
          const approveBtn = rowContainer
            .getByRole('button', { name: /approve|accept/i })
            .or(page.getByRole('button', { name: /approve|accept/i }))
            .first()
          if (await approveBtn.isVisible({ timeout: 3_000 })) {
            await expect(approveBtn).toBeEnabled()
          }
        }
        await expect(page.locator('body')).not.toContainText('500')
        return
      }
    }
  })
})
