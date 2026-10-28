// Unit tests for supabase/functions/_shared/paymentException.ts - the "captured payment without an order" recorder (known issue K-8) that finalizeOrder() calls
// before it rethrows a StockError. The REAL source is imported; the Supabase client is a FAKE: no network, no Deno.
//   cd supabase/tests && node --test paymentException.test.mjs        (also part of  node run-all.mjs)
//   no Node: .\tools\browser-test\Run-TsLiteTests.ps1 -Test <this file> -Ts <the .ts above>
// What this does NOT prove: that finalizeOrder's .catch() wiring compiles / runs on Deno (NEEDS-NODE: npm run typecheck; NEEDS-LIVE).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { recordUnfulfilledPayment, summarizeItems } from '../functions/_shared/paymentException.ts'

function fakeAdmin(answer) {
  const calls = []
  return { calls, rpc: async (name, args) => { calls.push([name, args]); if (answer instanceof Error) throw answer; return typeof answer === 'function' ? answer(args) : answer } }
}
const P = { razorpayOrderId: 'order_RZP1', razorpayPaymentId: 'pay_RZP1', userId: 'u1', amount: 1100.5, reason: 'Insufficient stock for product p1 (variant main)',
  items: [{ productId: 'p1', variantId: '', quantity: 2, title: 'Cotton Shirt', unitPrice: 500, address: 'secret' }, { productId: 'p2', variantId: 'v9', quantity: 1 }] }

describe('summarizeItems', () => {
  it('keeps only product, variant, quantity and a short title - no prices, no addresses', () => {
    assert.deepEqual(summarizeItems(P.items), [
      { product_id: 'p1', variant_id: '', quantity: 2, title: 'Cotton Shirt' },
      { product_id: 'p2', variant_id: 'v9', quantity: 1, title: '' },
    ])
  })
  it('garbage in, an empty list out; at most 50 lines; a long title is cut', () => {
    assert.deepEqual(summarizeItems(null), [])
    assert.deepEqual(summarizeItems('x'), [])
    assert.deepEqual(summarizeItems([null, {}]), [{ product_id: '', variant_id: '', quantity: 0, title: '' }, { product_id: '', variant_id: '', quantity: 0, title: '' }])
    assert.equal(summarizeItems(Array.from({ length: 80 }, () => ({ productId: 'p', quantity: 1 }))).length, 50)
    assert.equal(summarizeItems([{ productId: 'p', title: 'x'.repeat(500) }])[0].title.length, 120)
  })
})

describe('recordUnfulfilledPayment', () => {
  it('calls record_payment_exception with the payment, the customer, the amount, the reason and the cart summary', async () => {
    const admin = fakeAdmin({ data: { ok: true, recorded: true, id: 'e1' }, error: null })
    const r = await recordUnfulfilledPayment(admin, P)
    assert.deepEqual(r, { recorded: true, id: 'e1' })
    assert.equal(admin.calls.length, 1)
    assert.deepEqual(admin.calls[0], ['record_payment_exception', {
      p_razorpay_order_id: 'order_RZP1', p_razorpay_payment_id: 'pay_RZP1', p_user_id: 'u1', p_amount: 1100.5, p_reason: P.reason,
      p_items: [{ product_id: 'p1', variant_id: '', quantity: 2, title: 'Cotton Shirt' }, { product_id: 'p2', variant_id: 'v9', quantity: 1, title: '' }],
    }])
  })
  it('a retry of the same payment answers recorded: false (the database is idempotent)', async () => {
    const r = await recordUnfulfilledPayment(fakeAdmin({ data: { ok: true, recorded: false }, error: null }), P)
    assert.deepEqual(r, { recorded: false, id: null })
  })
  it('a guest checkout (no user) and a missing amount are tolerated; a long reason is cut to 500', async () => {
    const admin = fakeAdmin({ data: { ok: true, recorded: true, id: 'e2' }, error: null })
    await recordUnfulfilledPayment(admin, { razorpayOrderId: 'o', razorpayPaymentId: 'p', reason: 'x'.repeat(900) })
    const a = admin.calls[0][1]
    assert.deepEqual([a.p_user_id, a.p_amount, a.p_reason.length, a.p_items], [null, 0, 500, []])
  })
  it('NEVER throws: a database error, a missing function or a network failure is logged and reported', async () => {
    const noFn = await recordUnfulfilledPayment(fakeAdmin({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }), P)
    assert.deepEqual([noFn.recorded, noFn.error], [false, 'Could not find the function'])
    const boom = await recordUnfulfilledPayment(fakeAdmin(new Error('socket hang up')), P)
    assert.deepEqual([boom.recorded, boom.error], [false, 'socket hang up'])
    const odd = await recordUnfulfilledPayment(fakeAdmin({ data: null, error: 'plain string' }), P)
    assert.deepEqual([odd.recorded, odd.error], [false, 'plain string'])
  })
})