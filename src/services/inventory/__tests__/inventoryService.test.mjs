// node --test src/services/inventory/__tests__/inventoryService.test.mjs   (npm run test:unit)
// The admin service of the stock ledger / reports / payment exceptions / order lifecycle, against a fake Supabase client (no network).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createInventoryService, toInventoryError, isInventoryUnavailable } from '../inventoryService.js'

/** chainable + awaitable stand-in for a query builder; `result` may be a function of the log so far (to answer differently per table / select) */
function builder(result, log, table) {
  const b = {}
  for (const m of ['select', 'order', 'eq', 'in', 'limit', 'lt', 'gte']) b[m] = (...args) => { log.push([table, m, ...args]); return b }
  b.then = (res, rej) => Promise.resolve(typeof result === 'function' ? result(log) : result).then(res, rej)
  return b
}
function fakeClient({ tables = {}, rpcs = {} } = {}) {
  const log = []
  return {
    log,
    from: (t) => builder(tables[t] ?? { data: [], error: null }, log, t),
    rpc: async (name, args) => { log.push(['rpc', name, args]); const r = rpcs[name]; return typeof r === 'function' ? r(args) : (r ?? { data: null, error: null }) },
  }
}
const row = (seq, o = {}) => ({ id: `l${seq}`, seq, product_id: 'p1', variant_id: '', change: -1, reason: 'order', order_id: 'o1', movement_type: 'sale', bucket: 'sellable', created_at: '2026-10-17T10:00:00Z', products: { title: 'Shirt' }, ...o })

describe('errors', () => {
  it('keeps the database words; translates the infrastructure cases', () => {
    assert.equal(toInventoryError({ code: '22023', message: 'This order was paid: choose how it is refunded' }).message, 'This order was paid: choose how it is refunded')
    assert.match(toInventoryError({ code: 'PGRST202', message: 'x' }).message, /not available on the server yet/)
    assert.equal(toInventoryError({ code: '42501', message: 'permission denied for table x' }).message, 'You do not have permission to do that.')
    assert.equal(toInventoryError({ code: 'X', message: 'm', details: 'd' }).detail, 'd')
    for (const code of ['PGRST202', 'PGRST205', '42883', '42P01']) assert.equal(isInventoryUnavailable({ code }), true)
    assert.deepEqual([isInventoryUnavailable({ code: '42501' }), isInventoryUnavailable(null)], [false, false])
  })
})

describe('the ledger', () => {
  it('a page, newest first by seq, with the filters and the variant names; the cursor for the next page', async () => {
    const data = [row(30, { variant_id: 'v1' }), row(29), row(28)]
    const c = fakeClient({ tables: { inventory_logs: { data, error: null }, product_variants: { data: [{ id: 'v1', name: 'Pink' }], error: null } } })
    const out = await createInventoryService(c).ledger({ filters: { type: 'sale', bucket: 'sellable', orderId: 'o1', productId: 'p1', from: '2026-10-01', to: '2026-10-17' }, before: 31, limit: 3 })
    assert.deepEqual(out.rows.map((r) => r.seq), [30, 29, 28])
    assert.equal(out.rows[0].option, 'Shirt · Pink')
    assert.equal(out.nextBefore, 28)                                                       // a full page: more may follow
    assert.equal(out.ordered, true)
    assert.ok(c.log.some((l) => l[0] === 'inventory_logs' && l[1] === 'order' && l[2] === 'seq' && l[3].ascending === false))
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'movement_type' && l[3] === 'sale'))
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'bucket' && l[3] === 'sellable'))
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'order_id' && l[3] === 'o1'))
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'product_id' && l[3] === 'p1'))
    assert.ok(c.log.some((l) => l[1] === 'gte' && l[2] === 'created_at' && l[3] === '2026-10-01T00:00:00Z'))
    assert.ok(c.log.some((l) => l[1] === 'lt' && l[2] === 'created_at' && l[3] === '2026-10-18T00:00:00Z'))        // "to" is inclusive: strictly before the next day
    assert.ok(c.log.some((l) => l[1] === 'lt' && l[2] === 'seq' && l[3] === 31))
    assert.ok(c.log.some((l) => l[0] === 'product_variants' && l[1] === 'in' && l[2] === 'id' && l[3].length === 1))
  })
  it('a short page has no next page; unknown filters are ignored', async () => {
    const c = fakeClient({ tables: { inventory_logs: { data: [row(2), row(1)], error: null } } })
    const out = await createInventoryService(c).ledger({ filters: { type: 'bogus' }, limit: 5 })
    assert.equal(out.nextBefore, null)
    assert.ok(!c.log.some((l) => l[1] === 'eq' && l[2] === 'movement_type'))
    assert.ok(!c.log.some((l) => l[0] === 'product_variants'))
  })
  it('without the seq column (migration not applied) it falls back to time order and offers no paging', async () => {
    let calls = 0
    const c = fakeClient({ tables: { inventory_logs: () => (++calls === 1 ? { data: null, error: { code: '42703', message: 'column inventory_logs.seq does not exist' } } : { data: [row(null)], error: null }) } })
    const out = await createInventoryService(c).ledger({ limit: 1, before: 5 })
    assert.deepEqual([out.ordered, out.nextBefore, out.rows.length], [false, null, 1])
    assert.ok(c.log.some((l) => l[1] === 'order' && l[2] === 'created_at'))
    assert.ok(!c.log.some((l) => l[1] === 'lt' && l[2] === 'seq' && c.log.indexOf(l) > c.log.findIndex((x) => x[1] === 'order' && x[2] === 'created_at')))
  })
  it('another error is thrown with the database words; a failing name lookup only costs the label', async () => {
    await assert.rejects(() => createInventoryService(fakeClient({ tables: { inventory_logs: { data: null, error: { code: '42501', message: 'permission denied for table inventory_logs' } } } })).ledger(), /permission/)
    const c = fakeClient({ tables: { inventory_logs: { data: [row(1, { variant_id: 'v1' })], error: null }, product_variants: { data: null, error: { code: '42501', message: 'x' } } } })
    assert.equal((await createInventoryService(c).ledger()).rows[0].option, 'Shirt · v1')
  })
})

describe('the reports', () => {
  it('reconcile / gaps / unsellable call their RPCs and map the rows', async () => {
    const c = fakeClient({ rpcs: {
      inventory_reconcile: { data: [{ product_id: 'p1', variant_id: '', title: 'Shirt', actual_stock: 55, ledger_stock: 50, drift: 5, movements: 3 }], error: null },
      inventory_gaps: { data: [{ product_id: 'p1', variant_id: '', seq: 9, movement_type: 'sale', change: -1, previous_after: 50, stock_after: 54, missing: 5 }], error: null },
      inventory_unsellable_summary: { data: [{ product_id: 'p1', variant_id: 'v1', title: 'Shirt', variant_name: 'Pink', units: 2, movements: 2 }], error: null },
    } })
    const svc = createInventoryService(c)
    assert.equal((await svc.reconcile())[0].drift, 5)
    assert.deepEqual(c.log[0], ['rpc', 'inventory_reconcile', { p_only_drift: true }])
    await svc.reconcile(false)
    assert.deepEqual(c.log[1][2], { p_only_drift: false })
    assert.equal((await svc.gaps(50))[0].missing, 5)
    assert.deepEqual(c.log[2], ['rpc', 'inventory_gaps', { p_limit: 50 }])
    assert.equal((await svc.unsellable())[0].option, 'Shirt · Pink')
    assert.deepEqual(await createInventoryService(fakeClient()).reconcile(), [])                       // an empty answer (null data) is an empty list
  })
  it('an RPC error reaches the screen (not a missing-feature message when it is a permission problem)', async () => {
    const c = fakeClient({ rpcs: { inventory_reconcile: { data: null, error: { code: '42501', message: 'Admin access required' } } } })
    await assert.rejects(() => createInventoryService(c).reconcile(), (e) => e.message === 'Admin access required' && e.code === '42501')
  })
})

describe('payments that could not become an order', () => {
  it('list (optionally by status) and close', async () => {
    const c = fakeClient({ tables: { payment_exceptions: { data: [{ id: 'e1', razorpay_order_id: 'o', razorpay_payment_id: 'p', amount: '10', status: 'open', items: [] }], error: null } },
      rpcs: { resolve_payment_exception: { data: { ok: true, already: false, status: 'refunded' }, error: null } } })
    const svc = createInventoryService(c)
    assert.equal((await svc.paymentExceptions({ status: 'open' }))[0].status, 'open')
    assert.ok(c.log.some((l) => l[0] === 'payment_exceptions' && l[1] === 'eq' && l[2] === 'status' && l[3] === 'open'))
    assert.deepEqual(await svc.resolvePaymentException('e1', { status: 'refunded', reference: 'rfnd_1' }), { already: false, status: 'refunded' })
    assert.deepEqual(c.log.at(-1), ['rpc', 'resolve_payment_exception', { p_id: 'e1', p_status: 'refunded', p_reference: 'rfnd_1', p_note: null }])
    const missing = fakeClient({ tables: { payment_exceptions: { data: null, error: { code: 'PGRST205', message: 'x' } } } })
    assert.deepEqual(await createInventoryService(missing).paymentExceptions(), [])
  })
})

describe('the order lifecycle', () => {
  it('cancelOrder sends the right arguments and maps the answer', async () => {
    const c = fakeClient({ rpcs: { cancel_order: { data: { ok: true, already: false, order_status: 'cancelled', stock_restored: [{ product_id: 'p1', variant_id: '', quantity: 2 }], refund_id: 'f1', refund_no: 'RFD-1', refund_amount: '1100.00', refund_method: 'razorpay' }, error: null } } })
    const r = await createInventoryService(c).cancelOrder({ orderId: 'o1', reason: 'sold out', refundMethod: 'razorpay', key: 'cancel-k-123456', note: 'supplier' })
    assert.deepEqual(c.log[0], ['rpc', 'cancel_order', { p_order_id: 'o1', p_reason: 'sold out', p_refund_method: 'razorpay', p_idempotency_key: 'cancel-k-123456', p_internal_note: 'supplier' }])
    assert.deepEqual([r.already, r.orderStatus, r.refundId, r.refundNo, r.refundAmount, r.refundMethod, r.stockRestored.length], [false, 'cancelled', 'f1', 'RFD-1', 1100, 'razorpay', 1])
    const plain = await createInventoryService(fakeClient({ rpcs: { cancel_order: { data: { ok: true, already: true, legacy: true, order_status: 'cancelled' }, error: null } } })).cancelOrder({ orderId: 'o2', reason: 'x' })
    assert.deepEqual([plain.already, plain.legacy, plain.refundId, plain.refundAmount, plain.stockRestored], [true, true, null, null, []])
  })
  it('a refusal (shipped order, paid without a method ...) reaches the screen in the database words', async () => {
    const c = fakeClient({ rpcs: { cancel_order: { data: null, error: { code: '22023', message: 'This order is already on its way, so it cannot be cancelled.' } } } })
    await assert.rejects(() => createInventoryService(c).cancelOrder({ orderId: 'o1', reason: 'x' }), (e) => /already on its way/.test(e.message) && e.code === '22023')
  })
  it('createOrderRefund (idempotent key, optional request link) and orderOperations', async () => {
    const c = fakeClient({ rpcs: {
      create_order_refund: { data: { ok: true, created: true, refund_id: 'f2', refund_no: 'RFD-2', status: 'pending', amount: '300.00', method: 'manual' }, error: null },
      get_order_operations: { data: { stage: 'before_shipment', cancel: { allowed: true } }, error: null },
    } })
    const svc = createInventoryService(c)
    assert.deepEqual(await svc.createOrderRefund({ orderId: 'o1', amount: '300', method: 'manual', reason: 'the item you returned', key: 'order-refund-k1', requestId: 'r1' }),
      { created: true, refundId: 'f2', refundNo: 'RFD-2', status: 'pending', amount: 300, method: 'manual' })
    assert.deepEqual(c.log[0], ['rpc', 'create_order_refund', { p_order_id: 'o1', p_amount: 300, p_method: 'manual', p_reason: 'the item you returned', p_idempotency_key: 'order-refund-k1', p_request_id: 'r1', p_note: null }])
    assert.equal((await svc.orderOperations('o1')).stage, 'before_shipment')
    assert.deepEqual(c.log[1], ['rpc', 'get_order_operations', { p_order_id: 'o1' }])
  })
  it('the cancellation record (with the staff side) and every refund of the order (with the staff columns)', async () => {
    const c = fakeClient({ tables: {
      order_cancellations: { data: [{ order_id: 'o1', reason: 'sold out', refund_id: 'f1', stock_restored: [{ product_id: 'p1', quantity: 2 }], cancelled_at: '2026-10-17T10:00:00Z', order_cancellation_private: [{ cancelled_by: 'a1', internal_note: 'supplier' }] }], error: null },
      refunds: { data: [{ id: 'f1', refund_no: 'RFD-1', order_id: 'o1', kind: 'order', amount: '1100.00', method: 'razorpay', status: 'pending', gateway_state: 'not_sent', reason: 'your cancelled order', refund_private: [{ internal_note: 'n', attempts: 0 }] }], error: null },
    } })
    const svc = createInventoryService(c)
    const k = await svc.orderCancellation('o1')
    assert.deepEqual([k.reason, k.refundId, k.stockRestored.length, k.cancelledBy, k.internalNote], ['sold out', 'f1', 1, 'a1', 'supplier'])
    assert.ok(c.log.some((l) => l[0] === 'order_cancellations' && l[1] === 'select' && String(l[2]).includes('order_cancellation_private')))
    const refunds = await svc.orderRefunds('o1')
    assert.deepEqual([refunds[0].kind, refunds[0].reason, refunds[0].gatewayState, refunds[0].internalNote], ['order', 'your cancelled order', 'not_sent', 'n'])
    assert.ok(c.log.some((l) => l[0] === 'refunds' && l[1] === 'select' && String(l[2]).includes('refund_private') && String(l[2]).includes('refund_events')))
    assert.equal(await createInventoryService(fakeClient()).orderCancellation('nope'), null)
    const old = fakeClient({ tables: { order_cancellations: { data: null, error: { code: 'PGRST205', message: 'x' } }, refunds: { data: null, error: { code: '42P01', message: 'x' } } } })
    assert.equal(await createInventoryService(old).orderCancellation('o1'), null)
    assert.deepEqual(await createInventoryService(old).orderRefunds('o1'), [])
  })
})