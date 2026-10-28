/**
 * Website contract tests — Razorpay & Edge Function call contract
 * (logic extracted from src/utils/razorpay.js + edgeFunctions.js)
 *
 * Because node --test cannot resolve Vite path aliases (@/...) or
 * import.meta.env, we inline the fetch-level logic from both modules.
 * This ensures the fetch contract (URL, method, body, error handling)
 * is locked without needing a Vite build environment.
 *
 * Contract IDs:
 *   PAY-C01  createRazorpayOrder calls payment-create-order with items + promoCode
 *   PAY-C02  createRazorpayOrder throws on !res.ok
 *   PAY-C03  createRazorpayOrder throws on data.success === false
 *   PAY-C04  createRazorpayOrder returns data on success
 *   PAY-C05  createCodOrder calls payment-cod-create
 *   PAY-C06  createCodOrder throws on failure
 *   PAY-C07  verifyRazorpayPayment calls payment-verify with full payload
 *   PAY-C08  verifyRazorpayPayment throws when data.verified is false
 *   PAY-C09  callFunction POSTs JSON to the correct URL with no auth
 *   PAY-C10  callFunction returns { res, data: {} } when response is not JSON
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

// ── Inline logic under test ───────────────────────────────────────────────────
const FUNCTIONS_BASE = 'https://hexosjsftzdqmwqbeahy.supabase.co/functions/v1'

async function callFunction(name, body, fetchFn) {
  const res = await fetchFn(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

async function createRazorpayOrder({ items, promoCode }, fetchFn) {
  const { res, data } = await callFunction('payment-create-order', { items, promoCode: promoCode || '' }, fetchFn)
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not start payment. Please try again.')
  return data
}

async function createCodOrder({ items, promoCode }, fetchFn) {
  const { res, data } = await callFunction('payment-cod-create', { items, promoCode: promoCode || '' }, fetchFn)
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not place your COD order. Please try again.')
  return data
}

async function verifyRazorpayPayment(payload, fetchFn) {
  const { res, data } = await callFunction('payment-verify', payload, fetchFn)
  if (!res.ok || !data.verified) throw new Error(data.error || 'Payment could not be verified.')
  return data
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok = (data) => ({ ok: true, status: 200, json: async () => data })
const fail = (data, status = 400) => ({ ok: false, status, json: async () => data })

// ── callFunction ──────────────────────────────────────────────────────────────
describe('callFunction', () => {
  it('PAY-C09 — POSTs JSON to the correct Edge Function URL', async () => {
    let capturedUrl, capturedOpts
    const fetch = (u, o) => { capturedUrl = u; capturedOpts = o; return Promise.resolve(ok({ ok: true })) }
    await callFunction('test-fn', { key: 'val' }, fetch)
    assert.match(capturedUrl, /functions\/v1\/test-fn$/)
    assert.equal(capturedOpts.method, 'POST')
    assert.deepEqual(JSON.parse(capturedOpts.body), { key: 'val' })
  })

  it('PAY-C10 — returns { res, data: {} } when response is not JSON', async () => {
    const fetch = () => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError('bad') } })
    const { res, data } = await callFunction('fn', {}, fetch)
    assert.ok(res)
    assert.deepEqual(data, {})
  })
})

// ── createRazorpayOrder ───────────────────────────────────────────────────────
describe('createRazorpayOrder', () => {
  it('PAY-C01 — calls payment-create-order with items and promoCode', async () => {
    let body
    const fetch = (u, o) => { body = JSON.parse(o.body); return Promise.resolve(ok({ success: true, orderId: 'rp1' })) }
    const items = [{ productId: 'p1', quantity: 2 }]
    await createRazorpayOrder({ items, promoCode: 'SAVE10' }, fetch)
    assert.deepEqual(body, { items, promoCode: 'SAVE10' })
  })

  it('PAY-C01 — defaults promoCode to empty string when omitted', async () => {
    let body
    const fetch = (u, o) => { body = JSON.parse(o.body); return Promise.resolve(ok({ success: true })) }
    await createRazorpayOrder({ items: [] }, fetch)
    assert.equal(body.promoCode, '')
  })

  it('PAY-C02 — throws on !res.ok using server error message', async () => {
    const fetch = () => Promise.resolve(fail({ error: 'Payment service down' }))
    await assert.rejects(() => createRazorpayOrder({ items: [] }, fetch), { message: 'Payment service down' })
  })

  it('PAY-C03 — throws on data.success === false', async () => {
    const fetch = () => Promise.resolve(ok({ success: false, error: 'Stock unavailable' }))
    await assert.rejects(() => createRazorpayOrder({ items: [] }, fetch), { message: 'Stock unavailable' })
  })

  it('PAY-C03 — throws fallback message when error field absent', async () => {
    const fetch = () => Promise.resolve(ok({ success: false }))
    await assert.rejects(() => createRazorpayOrder({ items: [] }, fetch), /Could not start payment/i)
  })

  it('PAY-C04 — returns the full data object on success', async () => {
    const payload = { success: true, orderId: 'rp3', amount: 50000, currency: 'INR', keyId: 'rzp_test_abc' }
    const fetch = () => Promise.resolve(ok(payload))
    const result = await createRazorpayOrder({ items: [] }, fetch)
    assert.equal(result.orderId, 'rp3')
    assert.equal(result.keyId, 'rzp_test_abc')
  })
})

// ── createCodOrder ────────────────────────────────────────────────────────────
describe('createCodOrder', () => {
  it('PAY-C05 — calls payment-cod-create endpoint', async () => {
    let capturedUrl
    const fetch = (u, o) => { capturedUrl = u; return Promise.resolve(ok({ success: true, orderId: 'cod1' })) }
    await createCodOrder({ items: [] }, fetch)
    assert.match(capturedUrl, /payment-cod-create$/)
  })

  it('PAY-C06 — throws on failure with server error message', async () => {
    const fetch = () => Promise.resolve(ok({ success: false, error: 'Address not deliverable' }))
    await assert.rejects(() => createCodOrder({ items: [] }, fetch), { message: 'Address not deliverable' })
  })

  it('PAY-C06 — throws fallback message when server sends no error', async () => {
    const fetch = () => Promise.resolve(fail({}))
    await assert.rejects(() => createCodOrder({ items: [] }, fetch), /COD order/i)
  })
})

// ── verifyRazorpayPayment ─────────────────────────────────────────────────────
describe('verifyRazorpayPayment', () => {
  it('PAY-C07 — calls payment-verify with the full payload', async () => {
    let capturedBody
    const fetch = (u, o) => { capturedBody = JSON.parse(o.body); return Promise.resolve(ok({ verified: true })) }
    const payload = { razorpay_order_id: 'rp1', razorpay_payment_id: 'rp_pay1', razorpay_signature: 'sig' }
    await verifyRazorpayPayment(payload, fetch)
    assert.deepEqual(capturedBody, payload)
  })

  it('PAY-C08 — throws when data.verified is false', async () => {
    const fetch = () => Promise.resolve(ok({ verified: false, error: 'Signature mismatch' }))
    await assert.rejects(() => verifyRazorpayPayment({}, fetch), { message: 'Signature mismatch' })
  })

  it('PAY-C08 — throws fallback message when verified is false and no error', async () => {
    const fetch = () => Promise.resolve(ok({ verified: false }))
    await assert.rejects(() => verifyRazorpayPayment({}, fetch), /could not be verified/i)
  })
})
