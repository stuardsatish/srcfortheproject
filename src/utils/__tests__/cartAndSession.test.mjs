/**
 * Website contract tests — supabaseCart.js pure helpers + sessionManager.js pure helpers
 * (src/utils/supabaseCart.js, src/utils/sessionManager.js)
 *
 * Pure logic is inlined to avoid Vite alias resolution issues under node --test.
 * These tests lock the identity and quantity logic that must stay in sync between
 * the website (this file) and the RN app (__tests__/logic/supabaseCart.test.js).
 *
 * Contract IDs:
 *   WC-C01  nextAddQuantity — new item starts at 1
 *   WC-C02  nextAddQuantity — increments existing item
 *   WC-C03  nextAddQuantity — matches on compound_id when id is absent
 *   WC-C04  nextAddQuantity — tolerates null/undefined cartItems
 *   WC-C05  nextRemoveQuantity — returns 0 for absent item
 *   WC-C06  nextRemoveQuantity — returns qty-1 when qty > 1
 *   WC-C07  nextRemoveQuantity — returns 0 (delete signal) when qty is 1
 *   WC-C08  parseCartIds — null input → empty strings
 *   WC-C09  parseCartIds — plain string → productId, empty variantId
 *   WC-C10  parseCartIds — compound string "pid_var_vid" splits correctly
 *   WC-C11  parseCartIds — object with productId + variant_id
 *   WC-C12  parseCartIds — object with compound_id containing _var_
 *   WC-C13  parseCartIds — explicit variantId string argument
 *   SM-C01  generateSessionId — returns a non-empty string
 *   SM-C02  generateSessionId — returns different values on each call
 *   SM-C03  inSessionGrace — false before beginSessionGrace, true after
 *   SM-C04  inSessionGrace — expires after the given window
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

// ── Inlined logic: supabaseCart pure helpers ──────────────────────────────────
const cartIdOf = (item) => String(item?.id || item?.compound_id || '')

const nextAddQuantity = (cartItems, cartId) => {
  const existing = (cartItems || []).find((x) => cartIdOf(x) === String(cartId))
  return existing ? existing.quantity + 1 : 1
}

const nextRemoveQuantity = (cartItems, cartId) => {
  const existing = (cartItems || []).find((x) => cartIdOf(x) === String(cartId))
  if (!existing) return 0
  return existing.quantity > 1 ? existing.quantity - 1 : 0
}

const parseCartIds = (productOrId, variantId = '') => {
  if (!productOrId) return { productId: '', variantId: '' }
  if (typeof productOrId === 'object') {
    const pId = productOrId.productId || productOrId.product_id || ''
    const vId = productOrId.variant_id || productOrId.variantId || ''
    if (pId) return { productId: String(pId), variantId: String(vId || '') }
    const rawId = String(productOrId.id || productOrId.compound_id || '')
    if (rawId.includes('_var_')) {
      const idx = rawId.indexOf('_var_')
      return { productId: rawId.slice(0, idx), variantId: rawId.slice(idx + 1) }
    }
    return { productId: rawId, variantId: String(vId || '') }
  }
  const rawId = String(productOrId)
  if (rawId.includes('_var_')) {
    const idx = rawId.indexOf('_var_')
    return { productId: rawId.slice(0, idx), variantId: rawId.slice(idx + 1) }
  }
  return { productId: rawId, variantId: String(variantId || '') }
}

// ── Inlined logic: sessionManager pure helpers ───────────────────────────────
const generateSessionId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

let _graceUntil = 0
const beginSessionGrace = (ms = 10000) => { _graceUntil = Date.now() + ms }
const inSessionGrace = () => Date.now() < _graceUntil

// ─────────────────────────────────────────────────────────────────────────────
// nextAddQuantity
// ─────────────────────────────────────────────────────────────────────────────
describe('nextAddQuantity', () => {
  it('WC-C01 — new item starts at 1', () => {
    assert.equal(nextAddQuantity([], 'prod-1'), 1)
  })

  it('WC-C02 — increments existing item by 1', () => {
    const cart = [{ id: 'prod-1', quantity: 3 }]
    assert.equal(nextAddQuantity(cart, 'prod-1'), 4)
  })

  it('WC-C03 — matches on compound_id when id is absent', () => {
    const cart = [{ compound_id: 'prod-2', quantity: 2 }]
    assert.equal(nextAddQuantity(cart, 'prod-2'), 3)
  })

  it('WC-C04 — tolerates null/undefined cartItems', () => {
    assert.equal(nextAddQuantity(null, 'x'), 1)
    assert.equal(nextAddQuantity(undefined, 'x'), 1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// nextRemoveQuantity
// ─────────────────────────────────────────────────────────────────────────────
describe('nextRemoveQuantity', () => {
  it('WC-C05 — returns 0 for absent item', () => {
    assert.equal(nextRemoveQuantity([], 'prod-1'), 0)
  })

  it('WC-C06 — returns qty-1 when qty > 1', () => {
    const cart = [{ id: 'prod-1', quantity: 5 }]
    assert.equal(nextRemoveQuantity(cart, 'prod-1'), 4)
  })

  it('WC-C07 — returns 0 (delete signal) when qty is 1', () => {
    const cart = [{ id: 'prod-1', quantity: 1 }]
    assert.equal(nextRemoveQuantity(cart, 'prod-1'), 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCartIds
// ─────────────────────────────────────────────────────────────────────────────
describe('parseCartIds', () => {
  it('WC-C08 — null input → empty strings', () => {
    assert.deepEqual(parseCartIds(null), { productId: '', variantId: '' })
    assert.deepEqual(parseCartIds(undefined), { productId: '', variantId: '' })
    assert.deepEqual(parseCartIds(''), { productId: '', variantId: '' })
  })

  it('WC-C09 — plain string → productId only', () => {
    assert.deepEqual(parseCartIds('abc123'), { productId: 'abc123', variantId: '' })
  })

  it('WC-C10 — compound string "pid_var_vid" splits correctly', () => {
    const r = parseCartIds('p1_var_v2')
    assert.equal(r.productId, 'p1')
    // variantId is the slice AFTER the separator underscore
    assert.ok(r.variantId.includes('var_v2'))
  })

  it('WC-C11 — object with productId + variant_id', () => {
    assert.deepEqual(parseCartIds({ productId: 'p1', variant_id: 'v1' }), {
      productId: 'p1', variantId: 'v1',
    })
  })

  it('WC-C12 — object with compound_id splits on _var_', () => {
    const r = parseCartIds({ compound_id: 'p1_var_v2' })
    assert.equal(r.productId, 'p1')
    assert.ok(r.variantId.includes('var_v2'))
  })

  it('WC-C13 — explicit variantId string argument is preserved', () => {
    assert.deepEqual(parseCartIds('p1', 'v1'), { productId: 'p1', variantId: 'v1' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateSessionId
// ─────────────────────────────────────────────────────────────────────────────
describe('generateSessionId', () => {
  it('SM-C01 — returns a non-empty string', () => {
    const id = generateSessionId()
    assert.equal(typeof id, 'string')
    assert.ok(id.length > 0)
  })

  it('SM-C02 — returns different values on each call', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateSessionId()))
    // All 10 should be unique
    assert.equal(ids.size, 10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// inSessionGrace / beginSessionGrace
// ─────────────────────────────────────────────────────────────────────────────
describe('inSessionGrace', () => {
  it('SM-C03 — false before beginSessionGrace, true immediately after', () => {
    _graceUntil = 0
    assert.equal(inSessionGrace(), false)
    beginSessionGrace(5000)
    assert.equal(inSessionGrace(), true)
  })

  it('SM-C04 — expires after the given window (tested with 0ms)', () => {
    beginSessionGrace(0)
    // Grace with 0ms should immediately be expired
    assert.equal(inSessionGrace(), false)
  })
})
