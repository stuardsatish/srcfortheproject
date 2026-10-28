// Unit tests for supabase/functions/_shared/refundGateway.ts - the refund <-> Razorpay glue of the refund-create function and the payment webhook.
// The REAL TypeScript source is imported (Node strips the types), the Supabase client and the Razorpay SDK are FAKES: no network, no Deno.
//   cd supabase/tests && node --test refundGateway.test.mjs        (also part of  node run-all.mjs)
// What this does NOT prove: that the real Razorpay accepts these parameters / answers like the fake (BLOCKED-CREDENTIALS - TESTING_CHECKLIST G21).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapRazorpayRefundStatus, refundStatusFromEvent, sanitizeNotes, buildRefundParams, safeRefundPayload, classifyGatewayError, findOurRefund, sendRefund, reconcileRefund,
} from '../functions/_shared/refundGateway.ts'

const REFUND_ID = '11111111-2222-4333-8444-555555555555'

/** a fake service-role client: rpc(name, args) answers from `answers[name]` (a value or a function) and records every call */
function fakeAdmin(answers = {}) {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args])
      const a = answers[name]
      return typeof a === 'function' ? a(args) : (a ?? { data: null, error: null })
    },
  }
}
const BEGIN = { data: { proceed: true, refund_id: REFUND_ID, refund_no: 'RFD-2026-000001', amount_paise: 100000, currency: 'INR', razorpay_payment_id: 'pay_T4', receipt: 'RFD-2026-000001', notes: { refund_id: REFUND_ID, refund_no: 'RFD-2026-000001', order_id: 'o1' } }, error: null }
const fakeRazorpay = (o = {}) => {
  const calls = []
  return {
    calls,
    payments: {
      refund: async (...a) => { calls.push(['refund', ...a]); if (o.refundError) throw o.refundError; return o.entity ?? { id: 'rfnd_1', status: 'pending', amount: 100000, currency: 'INR', payment_id: 'pay_T4', receipt: 'RFD-2026-000001', notes: {} } },
      fetchMultipleRefund: async (...a) => { calls.push(['list', ...a]); if (o.listError) throw o.listError; return { items: o.items ?? [] } },
    },
    refunds: { fetch: async (id) => { calls.push(['fetch', id]); if (o.fetchError) throw o.fetchError; return o.fetched ?? { id, status: 'processed', amount: 100000 } } },
  }
}

describe('pure helpers', () => {
  it('Razorpay status words map to the three the database knows', () => {
    assert.deepEqual(['processed', 'PROCESSED', 'failed', 'pending', 'created', undefined, 'weird'].map(mapRazorpayRefundStatus), ['processed', 'processed', 'failed', 'pending', 'pending', 'pending', 'pending'])
  })
  it('webhook event names decide the status; the entity status is the fallback', () => {
    assert.equal(refundStatusFromEvent('refund.processed'), 'processed')
    assert.equal(refundStatusFromEvent('refund.failed', 'pending'), 'failed')
    assert.equal(refundStatusFromEvent('refund.created', 'pending'), 'created')
    assert.equal(refundStatusFromEvent('refund.created', 'processed'), 'processed')
    assert.equal(refundStatusFromEvent('refund.created'), 'created')
  })
  it('notes: strings only, 15 keys at most, values cut at 256, nulls dropped', () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))
    assert.equal(Object.keys(sanitizeNotes(many)).length, 15)
    assert.deepEqual(sanitizeNotes({ a: 1, b: null, c: undefined, d: 'x'.repeat(300) }), { a: '1', d: 'x'.repeat(256) })
    assert.deepEqual(sanitizeNotes(null), {})
    assert.deepEqual(sanitizeNotes('x'), {})
  })
  it('refund parameters: integer paise, normal speed, our receipt (<= 40 chars) and our ids as notes', () => {
    const p = buildRefundParams({ amount_paise: 100000.4, receipt: 'RFD-2026-000001', notes: { refund_id: REFUND_ID } })
    assert.deepEqual(p, { amount: 100000, speed: 'normal', receipt: 'RFD-2026-000001', notes: { refund_id: REFUND_ID } })
    assert.equal(buildRefundParams({ amount_paise: 5, receipt: 'x'.repeat(80) }).receipt.length, 40)
    for (const bad of [0, -5, 'abc', undefined, NaN]) assert.throws(() => buildRefundParams({ amount_paise: bad }), /not valid/)
  })
  it('only a few safe fields of the gateway entity are kept', () => {
    const p = safeRefundPayload({ id: 'rfnd_1', status: 'processed', amount: 1, currency: 'INR', payment_id: 'pay_1', receipt: 'r', secret: 'nope', acquirer_data: { rrn: '1' } })
    assert.deepEqual(Object.keys(p).sort(), ['amount', 'created_at', 'currency', 'id', 'payment_id', 'receipt', 'speed_processed', 'speed_requested', 'status'])
    assert.equal(p.secret, undefined)
    assert.equal(safeRefundPayload(null).id, null)
  })
  it('a gateway error is "rejected" only when the request itself was refused (4xx); anything else is "unknown"', () => {
    const rz = (statusCode, description) => ({ statusCode, error: { code: 'BAD_REQUEST_ERROR', description, field: 'amount' } })
    const rej = classifyGatewayError(rz(400, 'The refund amount provided is greater than amount captured'))
    assert.deepEqual([rej.outcome, rej.message], ['rejected', 'The refund amount provided is greater than amount captured'])
    assert.deepEqual([rej.payload.statusCode, rej.payload.field], [400, 'amount'])
    for (const s of [401, 403, 404, 422]) assert.equal(classifyGatewayError(rz(s, 'x')).outcome, 'rejected', String(s))
    for (const s of [408, 429, 500, 502, 503]) assert.equal(classifyGatewayError(rz(s, 'x')).outcome, 'unknown', String(s))
    assert.equal(classifyGatewayError(new Error('connect ETIMEDOUT')).outcome, 'unknown')
    assert.equal(classifyGatewayError(null).outcome, 'unknown')
    assert.equal(classifyGatewayError({ response: { status: 400, data: { error: { description: 'bad' } } } }).outcome, 'rejected')
  })
  it('a key never reaches a message the customer might read', () => {
    const c = classifyGatewayError({ statusCode: 401, error: { description: 'Authentication failed for rzp_live_AbC123xyz with key' } })
    assert.ok(!c.message.includes('rzp_live_'), c.message)
    assert.ok(c.message.includes('[key]'))
    assert.ok(classifyGatewayError({ message: 'x'.repeat(500) }).message.length <= 200)
  })
  it('our refund among a payment\'s refunds: by the id in the notes, else by the receipt', () => {
    const items = [{ id: 'rfnd_a', notes: {}, receipt: 'other' }, { id: 'rfnd_b', notes: { refund_id: REFUND_ID }, receipt: null }, { id: 'rfnd_c', notes: [], receipt: 'RFD-1' }]
    assert.equal(findOurRefund(items, REFUND_ID, 'RFD-1').id, 'rfnd_b')
    assert.equal(findOurRefund(items.filter((x) => x.id !== 'rfnd_b'), REFUND_ID, 'RFD-1').id, 'rfnd_c')
    assert.equal(findOurRefund(items, 'nope', 'zzz'), null)
    assert.equal(findOurRefund(undefined, REFUND_ID, 'RFD-1'), null)
  })
})

describe('sendRefund', () => {
  it('claims, calls Razorpay ONCE with the right payment and parameters, records the answer', async () => {
    const admin = fakeAdmin({ refund_begin_gateway: BEGIN, refund_record_gateway_result: { data: { ok: true, status: 'pending', gateway_state: 'submitted' }, error: null } })
    const rz = fakeRazorpay()
    const r = await sendRefund(admin, rz, REFUND_ID)
    assert.equal(r.http, 200)
    assert.deepEqual([r.body.success, r.body.status, r.body.gatewayState], [true, 'pending', 'submitted'])
    assert.match(r.body.message, /Sent to Razorpay/)
    assert.equal(rz.calls.length, 1)
    assert.deepEqual(rz.calls[0], ['refund', 'pay_T4', { amount: 100000, speed: 'normal', receipt: 'RFD-2026-000001', notes: { refund_id: REFUND_ID, refund_no: 'RFD-2026-000001', order_id: 'o1' } }])
    assert.deepEqual(admin.calls.map((c) => c[0]), ['refund_begin_gateway', 'refund_record_gateway_result'])
    assert.deepEqual(admin.calls[1][1], { p_refund_id: REFUND_ID, p_outcome: 'accepted', p_gateway_refund_id: 'rfnd_1', p_gateway_status: 'pending', p_payload: safeRefundPayload({ id: 'rfnd_1', status: 'pending', amount: 100000, currency: 'INR', payment_id: 'pay_T4', receipt: 'RFD-2026-000001' }) })
  })
  it('a refund that Razorpay already processed is reported as succeeded', async () => {
    const admin = fakeAdmin({ refund_begin_gateway: BEGIN, refund_record_gateway_result: { data: { ok: true, status: 'succeeded', gateway_state: 'submitted' }, error: null } })
    const r = await sendRefund(admin, fakeRazorpay({ entity: { id: 'rfnd_9', status: 'processed' } }), REFUND_ID)
    assert.deepEqual([r.http, r.body.status, r.body.message], [200, 'succeeded', 'Razorpay has refunded it.'])
    assert.equal(admin.calls[1][1].p_gateway_status, 'processed')
  })
  it('NEVER sends twice: when the database refuses the claim the gateway is not called at all', async () => {
    const admin = fakeAdmin({ refund_begin_gateway: { data: { proceed: false, reason: 'ALREADY_SENT', gateway_state: 'submitted' }, error: null } })
    const rz = fakeRazorpay()
    const r = await sendRefund(admin, rz, REFUND_ID)
    assert.equal(r.http, 409)
    assert.deepEqual([r.body.success, r.body.code, r.body.gatewayState], [false, 'ALREADY_SENT', 'submitted'])
    assert.match(r.body.error, /already sent to Razorpay/)
    assert.equal(rz.calls.length, 0)
    assert.equal(admin.calls.length, 1)
    for (const reason of ['NOT_PENDING', 'WRONG_METHOD', 'NO_PAYMENT_ID']) {
      const a = fakeAdmin({ refund_begin_gateway: { data: { proceed: false, reason }, error: null } })
      const x = await sendRefund(a, fakeRazorpay(), REFUND_ID)
      assert.deepEqual([x.http, x.body.code], [409, reason])
    }
  })
  it('a definitive 4xx fails the refund (rejected) - nothing was created at Razorpay', async () => {
    const admin = fakeAdmin({ refund_begin_gateway: BEGIN, refund_record_gateway_result: { data: { ok: true, status: 'failed', gateway_state: 'not_sent' }, error: null } })
    const rz = fakeRazorpay({ refundError: { statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description: 'The payment has been fully refunded already' } } })
    const r = await sendRefund(admin, rz, REFUND_ID)
    assert.deepEqual([r.http, r.body.code, r.body.status, r.body.gatewayState], [422, 'GATEWAY_REJECTED', 'failed', 'not_sent'])
    assert.match(r.body.error, /fully refunded already/)
    assert.deepEqual(admin.calls[1][1].p_outcome, 'rejected')
  })
  it('no usable answer = "unknown": the refund stays pending and must be CHECKED, never re-sent', async () => {
    const admin = fakeAdmin({ refund_begin_gateway: BEGIN, refund_record_gateway_result: { data: { ok: true, status: 'pending', gateway_state: 'unknown' }, error: null } })
    const r = await sendRefund(admin, fakeRazorpay({ refundError: new Error('connect ETIMEDOUT 1.2.3.4:443') }), REFUND_ID)
    assert.deepEqual([r.http, r.body.code, r.body.status, r.body.gatewayState], [502, 'GATEWAY_UNKNOWN', 'pending', 'unknown'])
    assert.match(r.body.error, /Do not send it again/)
    assert.equal(admin.calls[1][1].p_outcome, 'unknown')
  })
  it('Razorpay accepted but saving failed: says so and points to "Check status"', async () => {
    const admin = fakeAdmin({ refund_begin_gateway: BEGIN, refund_record_gateway_result: { data: null, error: { message: 'db down' } } })
    const r = await sendRefund(admin, fakeRazorpay(), REFUND_ID)
    assert.deepEqual([r.http, r.body.code, r.body.gatewayState], [502, 'RECORD_FAILED', 'submitting'])
    assert.match(r.body.error, /Check status/)
  })
  it('unknown refund -> 404; any other database error -> 500; an invalid amount never reaches the gateway and does not leave the claim hanging', async () => {
    const rz = fakeRazorpay()
    assert.equal((await sendRefund(fakeAdmin({ refund_begin_gateway: { data: null, error: { code: 'P0002', message: 'Refund not found' } } }), rz, REFUND_ID)).http, 404)
    assert.equal((await sendRefund(fakeAdmin({ refund_begin_gateway: { data: null, error: { code: 'XX000', message: 'boom' } } }), rz, REFUND_ID)).http, 500)
    const admin = fakeAdmin({ refund_begin_gateway: { data: { ...BEGIN.data, amount_paise: 0 }, error: null }, refund_record_gateway_result: { data: { ok: true, status: 'failed', gateway_state: 'not_sent' }, error: null } })
    const r = await sendRefund(admin, rz, REFUND_ID)
    assert.deepEqual([r.http, r.body.code, r.body.status], [422, 'GATEWAY_REJECTED', 'failed'])
    assert.deepEqual(admin.calls.map((c) => c[0]), ['refund_begin_gateway', 'refund_record_gateway_result'])
    assert.equal(admin.calls[1][1].p_outcome, 'rejected')
    assert.equal(rz.calls.length, 0)
  })
})

describe('reconcileRefund (status check)', () => {
  const ctx = (o = {}) => ({ data: { refund_id: REFUND_ID, refund_no: 'RFD-2026-000001', method: 'razorpay', status: 'pending', gateway_state: 'unknown', gateway_refund_id: null, razorpay_payment_id: 'pay_T4', state_age_seconds: 600, ...o }, error: null })
  const saved = (status, state = 'submitted') => ({ data: { ok: true, status, gateway_state: state }, error: null })

  it('nothing to ask when the refund is finished, was never sent, or is not a gateway refund', async () => {
    const rz = fakeRazorpay()
    const a = await reconcileRefund(fakeAdmin({ refund_gateway_context: ctx({ status: 'succeeded' }) }), rz, REFUND_ID)
    assert.deepEqual([a.http, a.body.status, a.body.message], [200, 'succeeded', 'This refund is already succeeded.'])
    const b = await reconcileRefund(fakeAdmin({ refund_gateway_context: ctx({ gateway_state: 'not_sent' }) }), rz, REFUND_ID)
    assert.match(b.body.message, /not been sent/)
    const c = await reconcileRefund(fakeAdmin({ refund_gateway_context: ctx({ method: 'manual' }) }), rz, REFUND_ID)
    assert.deepEqual([c.http, c.body.code], [409, 'WRONG_METHOD'])
    assert.equal(rz.calls.length, 0)
  })
  it('a known gateway id: fetches that refund and records its status', async () => {
    const admin = fakeAdmin({ refund_gateway_context: ctx({ gateway_state: 'submitted', gateway_refund_id: 'rfnd_1' }), refund_record_gateway_result: saved('succeeded') })
    const rz = fakeRazorpay({ fetched: { id: 'rfnd_1', status: 'processed' } })
    const r = await reconcileRefund(admin, rz, REFUND_ID)
    assert.deepEqual([r.http, r.body.status, r.body.message], [200, 'succeeded', 'Razorpay has paid it out.'])
    assert.deepEqual(rz.calls, [['fetch', 'rfnd_1']])
    assert.deepEqual([admin.calls[1][1].p_outcome, admin.calls[1][1].p_gateway_status], ['accepted', 'processed'])
  })
  it('a lost answer: finds OUR refund in the payment\'s refunds by the id we put in the notes', async () => {
    const admin = fakeAdmin({ refund_gateway_context: ctx(), refund_record_gateway_result: saved('pending') })
    const rz = fakeRazorpay({ items: [{ id: 'rfnd_other', notes: {} }, { id: 'rfnd_ours', status: 'pending', notes: { refund_id: REFUND_ID } }] })
    const r = await reconcileRefund(admin, rz, REFUND_ID)
    assert.deepEqual([r.http, r.body.status, r.body.message], [200, 'pending', 'Razorpay has it and is still processing it.'])
    assert.equal(admin.calls[1][1].p_gateway_refund_id, 'rfnd_ours')
    assert.deepEqual(rz.calls, [['list', 'pay_T4', { count: 100 }]])
  })
  it('a failed refund at Razorpay is recorded as failed', async () => {
    const admin = fakeAdmin({ refund_gateway_context: ctx({ gateway_state: 'submitted', gateway_refund_id: 'rfnd_1' }), refund_record_gateway_result: saved('failed') })
    const r = await reconcileRefund(admin, fakeRazorpay({ fetched: { id: 'rfnd_1', status: 'failed' } }), REFUND_ID)
    assert.equal(r.body.message, 'Razorpay reports that the refund failed.')
  })
  it('Razorpay knows nothing of it: after the grace period it was never created (rejected -> a new refund can be made); before it, wait', async () => {
    const old = fakeAdmin({ refund_gateway_context: ctx({ state_age_seconds: 600 }), refund_record_gateway_result: saved('failed', 'not_sent') })
    const r = await reconcileRefund(old, fakeRazorpay({ items: [] }), REFUND_ID)
    assert.deepEqual([r.http, r.body.status, r.body.gatewayState], [200, 'failed', 'not_sent'])
    assert.match(r.body.message, /never created/)
    assert.equal(old.calls[1][1].p_outcome, 'rejected')
    const fresh = fakeAdmin({ refund_gateway_context: ctx({ state_age_seconds: 30 }) })
    const w = await reconcileRefund(fresh, fakeRazorpay({ items: [] }), REFUND_ID)
    assert.deepEqual([w.http, w.body.status], [200, 'pending'])
    assert.match(w.body.message, /Try again in a few minutes/)
    assert.equal(fresh.calls.length, 1)                                          // nothing was recorded
    const stale = fakeAdmin({ refund_gateway_context: ctx({ gateway_state: 'submitting', state_age_seconds: 400 }), refund_record_gateway_result: saved('failed', 'not_sent') })
    assert.equal((await reconcileRefund(stale, fakeRazorpay({ items: [] }), REFUND_ID)).body.status, 'failed')            // the function died mid-call
    const young = fakeAdmin({ refund_gateway_context: ctx({ gateway_state: 'submitting', state_age_seconds: 100 }) })
    assert.equal((await reconcileRefund(young, fakeRazorpay({ items: [] }), REFUND_ID)).body.status, 'pending')           // maybe still in flight
  })
  it('Razorpay unreachable: says so, changes nothing', async () => {
    const admin = fakeAdmin({ refund_gateway_context: ctx() })
    const r = await reconcileRefund(admin, fakeRazorpay({ listError: new Error('ECONNRESET') }), REFUND_ID)
    assert.deepEqual([r.http, r.body.code], [502, 'GATEWAY_UNAVAILABLE'])
    assert.equal(admin.calls.length, 1)
  })
  it('database errors are passed on', async () => {
    assert.equal((await reconcileRefund(fakeAdmin({ refund_gateway_context: { data: null, error: { code: 'P0002', message: 'Refund not found' } } }), fakeRazorpay(), REFUND_ID)).http, 404)
    const admin = fakeAdmin({ refund_gateway_context: ctx({ gateway_state: 'submitted', gateway_refund_id: 'rfnd_1' }), refund_record_gateway_result: { data: null, error: { message: 'db down' } } })
    assert.deepEqual([(await reconcileRefund(admin, fakeRazorpay(), REFUND_ID)).http], [500])
  })
})