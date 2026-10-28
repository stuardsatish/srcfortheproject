// node --test src/utils/__tests__/pricing.test.mjs
// Tests for src/utils/pricing.js — formatCurrency, isDiscountActive, effectivePrice, activeDiscountPercent
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatCurrency, isDiscountActive, effectivePrice, activeDiscountPercent } from '../pricing.js'

// ── formatCurrency ──────────────────────────────────────────────────────────
describe('formatCurrency', () => {
  it('formats an integer', () => assert.equal(formatCurrency(500), '₹500.00'))
  it('formats a decimal', () => assert.equal(formatCurrency(499.5), '₹499.50'))
  it('formats zero', () => assert.equal(formatCurrency(0), '₹0.00'))
  it('null / undefined -> ₹0.00', () => {
    assert.equal(formatCurrency(null), '₹0.00')
    assert.equal(formatCurrency(undefined), '₹0.00')
  })
  it('uses the rupee symbol, never $', () => assert.ok(formatCurrency(100).startsWith('₹')))
})

// ── isDiscountActive ────────────────────────────────────────────────────────
const FUTURE = new Date(Date.now() + 86400 * 1000 * 30).toISOString()
const PAST   = new Date(Date.now() - 86400 * 1000).toISOString()

describe('isDiscountActive', () => {
  it('no discount -> false', () => assert.equal(isDiscountActive({ discount: 0 }), false))
  it('null item -> false', () => assert.equal(isDiscountActive(null), false))
  it('undefined -> false', () => assert.equal(isDiscountActive(undefined), false))
  it('discount > 0, no expiry -> true (never expires)', () =>
    assert.equal(isDiscountActive({ discount: 10 }), true))
  it('discount > 0, future ISO expiry -> true', () =>
    assert.equal(isDiscountActive({ discount: 10, discountExpiry: FUTURE }), true))
  it('discount > 0, past ISO expiry -> false', () =>
    assert.equal(isDiscountActive({ discount: 10, discountExpiry: PAST }), false))
  it('discount > 0, epoch number (future) -> true', () =>
    assert.equal(isDiscountActive({ discount: 5, discountExpiry: Date.now() + 999999 }), true))
  it('discount > 0, epoch number (past) -> false', () =>
    assert.equal(isDiscountActive({ discount: 5, discountExpiry: Date.now() - 1 }), false))
  it('Firestore-style { toDate() } future -> true', () => {
    const val = { toDate: () => new Date(Date.now() + 9999999) }
    assert.equal(isDiscountActive({ discount: 20, discountExpiry: val }), true)
  })
  it('Firestore-style { toDate() } past -> false', () => {
    const val = { toDate: () => new Date(Date.now() - 9999999) }
    assert.equal(isDiscountActive({ discount: 20, discountExpiry: val }), false)
  })
  it('discount = 0 with future expiry is still false', () =>
    assert.equal(isDiscountActive({ discount: 0, discountExpiry: FUTURE }), false))
  it('string discount is coerced ("10" -> 10)', () =>
    assert.equal(isDiscountActive({ discount: '10' }), true))
})

// ── effectivePrice ──────────────────────────────────────────────────────────
describe('effectivePrice', () => {
  it('no discount -> full price', () =>
    assert.equal(effectivePrice({ price: 500, discount: 0 }), 500))
  it('10 % active discount on 500 -> 450', () =>
    assert.equal(effectivePrice({ price: 500, discount: 10 }), 450))
  it('expired discount -> full price', () =>
    assert.equal(effectivePrice({ price: 500, discount: 10, discountExpiry: PAST }), 500))
  it('null item -> 0', () => assert.equal(effectivePrice(null), 0))
  it('100 % discount -> 0', () =>
    assert.equal(effectivePrice({ price: 200, discount: 100 }), 0))
  it('price coerced from string', () =>
    assert.equal(effectivePrice({ price: '400', discount: 25 }), 300))
})

// ── activeDiscountPercent ───────────────────────────────────────────────────
describe('activeDiscountPercent', () => {
  it('returns 0 when no discount', () =>
    assert.equal(activeDiscountPercent({ price: 100, discount: 0 }), 0))
  it('returns the percent when active', () =>
    assert.equal(activeDiscountPercent({ price: 100, discount: 15 }), 15))
  it('returns 0 when expired', () =>
    assert.equal(activeDiscountPercent({ price: 100, discount: 15, discountExpiry: PAST }), 0))
  it('null item -> 0', () => assert.equal(activeDiscountPercent(null), 0))
})
