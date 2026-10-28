// node --test src/services/returns/__tests__/returnsService.admin.test.mjs   (npm run test:unit)
// The admin half of the service (website only - the RN app has no admin screens). The customer half is in returnsService.test.mjs.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createReturnsService, logisticsArgs } from '../returnsService.js'
import { fakeClient } from './fakeClient.mjs'

describe('admin calls', () => {
  it('list: filters by type / status, asks for the admin columns', async () => {
    const c = fakeClient({ tables: { return_requests: { data: [{ id: 'r1', request_no: 'X', order_id: 'o', type: 'exchange', status: 'approved', reason_code: 'a', return_request_private: [{ internal_note: 'VIP' }] }], error: null } } })
    const out = await createReturnsService(c).adminList({ type: 'exchange', status: 'approved' })
    assert.equal(out[0].internalNote, 'VIP')
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'type' && l[3] === 'exchange'))
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'status' && l[3] === 'approved'))
    assert.ok(c.log.some((l) => l[1] === 'select' && String(l[2]).includes('return_request_private')))
  })
  it('decide / transition / logistics / received / inspect / messages call the right RPCs', async () => {
    const c = fakeClient({ rpcs: {
      decide_request_items: { data: { status: 'approved', approved: 1, rejected: 1, pending: 0 }, error: null },
      request_transition: { data: { status: 'needs_info' }, error: null },
      set_return_logistics: { data: { status: 'awaiting_return_shipment', method: 'courier_pickup', shipment_id: 's1' }, error: null },
      record_return_received: { data: { status: 'inspection_pending' }, error: null },
      record_inspection: { data: { status: 'inspection_passed', passed: 1, failed: 0, waiting: 0 }, error: null },
    } })
    const svc = createReturnsService(c)
    assert.deepEqual(await svc.decide('r1', [{ item_id: 'i1', decision: 'approve' }], { internalNote: 'ok' }), { status: 'approved', approved: 1, rejected: 1, pending: 0 })
    assert.deepEqual(c.log[0][2], { p_request_id: 'r1', p_decisions: [{ item_id: 'i1', decision: 'approve' }], p_internal_note: 'ok', p_customer_note: null })
    assert.deepEqual(await svc.transition('r1', 'needs_info', { customerNote: 'which size?' }), { status: 'needs_info' })
    assert.deepEqual(c.log[1][2], { p_request_id: 'r1', p_to_status: 'needs_info', p_note: null, p_customer_note: 'which size?' })
    assert.deepEqual(await svc.setLogistics('r1', { method: 'courier_pickup', courierCode: 'dtdc', trackingNumber: 'P1', charges: '40' }), { status: 'awaiting_return_shipment', method: 'courier_pickup', shipmentId: 's1' })
    assert.equal(c.log[2][2].p_charges, 40)
    assert.deepEqual(await svc.markReceived('r1', { note: 'intact' }), { status: 'inspection_pending' })
    assert.deepEqual(await svc.inspect('r1', [{ item_id: 'i1', result: 'passed' }]), { status: 'inspection_passed', passed: 1, failed: 0, waiting: 0 })
    await svc.message('r1', 'hello'); await svc.internalNote('r1', 'note')
    assert.deepEqual(c.log.slice(-2).map((l) => l[1]), ['send_request_message', 'set_request_internal_note'])
  })
  it('refunds: calculate, create (idempotent key), mark, void, and the two gateway calls', async () => {
    const sent = []
    const callFunction = async (name, body) => { sent.push([name, body]); return { res: { ok: true }, data: { success: true, status: 'pending', gatewayState: 'submitted', message: 'Sent to Razorpay', refundId: body.refundId } } }
    const c = fakeClient({ rpcs: {
      refund_calculate: { data: { request_id: 'r1', order_id: 'o1', lines: [], amount: 100, items_amount: 100, shipping_amount: 0, adjustment_amount: 0 }, error: null },
      create_refund: { data: { ok: true, created: true, refund_id: 'f1', refund_no: 'RFD-1', status: 'pending', amount: 100, method: 'manual', request_status: 'refund_pending' }, error: null },
      refund_mark_manual: { data: { ok: true, status: 'succeeded', already: false }, error: null },
      refund_void: { data: { ok: true, status: 'failed', already: false }, error: null },
    } })
    const svc = createReturnsService(c, { callFunction })
    assert.equal((await svc.refundCalculate('r1', { includeShipping: false, adjustment: '-5' })).amount, 100)
    assert.deepEqual(c.log[0][2], { p_request_id: 'r1', p_include_shipping: false, p_adjustment: -5 })
    assert.deepEqual(await svc.createRefund({ requestId: 'r1', key: 'k-123456789', method: 'manual', adjustment: -5, adjustmentNote: 'courier' }),
      { created: true, refundId: 'f1', refundNo: 'RFD-1', status: 'pending', amount: 100, method: 'manual', requestStatus: 'refund_pending' })
    assert.deepEqual(c.log[1][2], { p_request_id: 'r1', p_idempotency_key: 'k-123456789', p_method: 'manual', p_include_shipping: null, p_adjustment: -5, p_adjustment_note: 'courier', p_note: null })
    assert.deepEqual(await svc.markRefund('f1', 'succeeded', { reference: 'UTR1' }), { status: 'succeeded', already: false })
    assert.deepEqual(c.log[2][2], { p_refund_id: 'f1', p_outcome: 'succeeded', p_reference: 'UTR1', p_note: null, p_completed_at: null })
    assert.deepEqual(await svc.voidRefund('f1', 'changed'), { status: 'failed', already: false })
    assert.deepEqual(c.log[3][2], { p_refund_id: 'f1', p_reason: 'changed' })
    assert.deepEqual(await svc.sendRefund('f1'), { status: 'pending', gatewayState: 'submitted', message: 'Sent to Razorpay', refundId: 'f1' })
    await svc.checkRefund('f1')
    assert.deepEqual(sent, [['refund-create', { refundId: 'f1', action: 'send' }], ['refund-create', { refundId: 'f1', action: 'reconcile' }]])
  })
  it('a failing gateway call throws the server\'s own words and code; without the wiring it says so', async () => {
    const bad = async () => ({ res: { ok: false }, data: { success: false, error: 'This refund was already sent to Razorpay', code: 'ALREADY_SENT' } })
    await assert.rejects(() => createReturnsService(fakeClient(), { callFunction: bad }).sendRefund('f1'), (e) => e.message === 'This refund was already sent to Razorpay' && e.code === 'ALREADY_SENT')
    await assert.rejects(() => createReturnsService(fakeClient()).sendRefund('f1'), /not connected/)
    const empty = async () => ({ res: { ok: false }, data: null })
    await assert.rejects(() => createReturnsService(fakeClient(), { callFunction: empty }).checkRefund('f1'), /could not be processed/)
  })
  it('the admin list of a request\'s refunds asks for the staff columns and maps them', async () => {
    const c = fakeClient({ tables: { refunds: { data: [{ id: 'f1', refund_no: 'RFD-1', order_id: 'o1', request_id: 'r1', amount: 100, method: 'razorpay', status: 'pending', gateway_state: 'unknown', refund_private: [{ internal_note: 'VIP', attempts: 1 }] }], error: null } } })
    const out = await createReturnsService(c).adminRefundsForRequest('r1')
    assert.deepEqual([out[0].gatewayState, out[0].internalNote, out[0].attempts], ['unknown', 'VIP', 1])
    assert.ok(c.log.some((l) => l[0] === 'refunds' && l[1] === 'select' && String(l[2]).includes('refund_private') && String(l[2]).includes('refund_events')))
    assert.ok(c.log.some((l) => l[0] === 'refunds' && l[1] === 'eq' && l[2] === 'request_id' && l[3] === 'r1'))
    const m = fakeClient({ tables: { refunds: { data: null, error: { code: '42P01', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(m).adminRefundsForRequest('r1'), [])
  })
  it('logisticsArgs: empty values become nulls, charges become numbers', () => {
    assert.deepEqual(logisticsArgs('r1', { method: 'manual', instructions: 'Bring it', charges: '' }), {
      p_request_id: 'r1', p_method: 'manual', p_instructions: 'Bring it', p_courier_code: null, p_courier_name: null, p_tracking_number: null, p_tracking_url: null,
      p_pickup_reference: null, p_shipped_at: null, p_charges: null, p_note: null,
    })
    assert.equal(logisticsArgs('r1', { method: 'manual', charges: '12.5' }).p_charges, 12.5)
  })
  it('counts per type and status; an empty answer when the feature is missing', async () => {
    const c = fakeClient({ tables: { return_requests: { data: [{ type: 'return', status: 'pending_review' }, { type: 'return', status: 'pending_review' }, { type: 'exchange', status: 'approved' }], error: null } } })
    assert.deepEqual(await createReturnsService(c).adminCounts(), { return: { pending_review: 2 }, exchange: { approved: 1 } })
    const m = fakeClient({ tables: { return_requests: { data: null, error: { code: '42P01', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(m).adminCounts(), { return: {}, exchange: {} })
  })
  it('exchange replacement: ship / deliver / settle / refund call the right RPCs with the right arguments', async () => {
    const c = fakeClient({ rpcs: {
      ship_replacement: { data: { ok: true, created: true, shipment_id: 's9', status: 'replacement_shipped' }, error: null },
      mark_replacement_delivered: { data: { ok: true, already: false, status: 'closed' }, error: null },
      settle_exchange_adjustment: { data: { ok: true, already: false, status: 'collected' }, error: null },
      create_exchange_refund: { data: { ok: true, created: true, refund_id: 'f9', refund_no: 'RFD-9', status: 'pending', amount: '100.00', method: 'manual' }, error: null },
    } })
    const svc = createReturnsService(c)
    assert.deepEqual(await svc.shipReplacement('r1', { p_order_id: 'o1', p_courier_code: 'manual', p_tracking_number: 'T1', p_charges: 40, p_items: null, p_courier_name: 'Local' }), { created: true, shipmentId: 's9', status: 'replacement_shipped' })
    assert.deepEqual(c.log[0], ['rpc', 'ship_replacement', {
      p_request_id: 'r1', p_courier_code: 'manual', p_courier_name: 'Local', p_tracking_number: 'T1', p_tracking_url: null, p_shipped_at: null, p_charges: 40, p_note: null, p_expected_delivery_date: null,
    }])
    assert.deepEqual(await svc.markReplacementDelivered('r1', { note: 'left with the neighbour' }), { already: false, status: 'closed' })
    assert.deepEqual(c.log[1], ['rpc', 'mark_replacement_delivered', { p_request_id: 'r1', p_delivered_at: null, p_note: 'left with the neighbour' }])
    assert.deepEqual(await svc.settleAdjustment('r1', 'collected', { reference: 'UPI 1' }), { already: false, status: 'collected' })
    assert.deepEqual(c.log[2], ['rpc', 'settle_exchange_adjustment', { p_request_id: 'r1', p_resolution: 'collected', p_reference: 'UPI 1', p_note: null }])
    assert.deepEqual(await svc.createExchangeRefund({ requestId: 'r1', key: 'key-12345678', method: 'manual' }), { created: true, refundId: 'f9', refundNo: 'RFD-9', status: 'pending', amount: 100, method: 'manual' })
    assert.deepEqual(c.log[3], ['rpc', 'create_exchange_refund', { p_request_id: 'r1', p_idempotency_key: 'key-12345678', p_method: 'manual', p_note: null }])
  })
  it('variant names for the request view: ids de-duplicated, {} on no ids or any error', async () => {
    const c = fakeClient({ tables: { product_variants: { data: [{ id: 'v1', name: 'White' }, { id: 'v2', name: 'Red / L' }], error: null } } })
    assert.deepEqual(await createReturnsService(c).variantNames(['v1', 'v2', 'v1', '', null]), { v1: 'White', v2: 'Red / L' })
    assert.ok(c.log.some((l) => l[0] === 'product_variants' && l[1] === 'in' && l[2] === 'id' && l[3].length === 2))
    assert.deepEqual(await createReturnsService(fakeClient()).variantNames([]), {})
    assert.deepEqual(await createReturnsService(fakeClient()).variantNames(null), {})
    const bad = fakeClient({ tables: { product_variants: { data: null, error: { code: '42501', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(bad).variantNames(['v1']), {})
  })
  it('a database refusal reaches the screen in the server\'s own words', async () => {
    const c = fakeClient({ rpcs: { ship_replacement: { data: null, error: { code: '22023', message: 'The customer owes a price difference of ₹50.00 - collect it (or waive it) before the replacement ships' } } } })
    await assert.rejects(() => createReturnsService(c).shipReplacement('r1', {}), (e) => /owes a price difference/.test(e.message) && e.code === '22023')
    const missing = fakeClient({ rpcs: { ship_replacement: { data: null, error: { code: 'PGRST202', message: 'x' } } } })
    await assert.rejects(() => createReturnsService(missing).shipReplacement('r1', {}), /not available on the server yet/)
  })
  it('the admin replacement view: record + adjustment with the staff fields + reservations + parcels with charges; empty while the tables are missing', async () => {
    const c = fakeClient({ tables: {
      replacement_fulfillments: { data: [{ id: 'f1', request_id: 'r1', order_id: 'o1', status: 'pending', replacement_fulfillment_items: [{ id: 'fi1', quantity: 1, title: 'Shirt' }] }], error: null },
      exchange_adjustments: { data: [{ request_id: 'r1', kind: 'balance_due', amount: '50.00', status: 'open', exchange_adjustment_private: [{ reference: 'UPI 1', internal_note: 'n' }] }], error: null },
      exchange_reservations: { data: [{ request_item_id: 'ri1', request_id: 'r1', product_id: 'p1', variant_id: 'v1', quantity: 1, unit_price: '350', stock_moved: true, status: 'reserved' }], error: null },
      shipments: { data: [{ id: 's1', direction: 'replacement', request_id: 'r1', status: 'created', shipment_private: [{ charges: '40.00' }] }], error: null },
    } })
    const out = await createReturnsService(c).adminReplacement('r1')
    assert.deepEqual([out.fulfilment.id, out.adjustment.reference, out.adjustment.amount, out.reservations[0].status, out.shipments[0].charges], ['f1', 'UPI 1', 50, 'reserved', 40])
    assert.ok(c.log.some((l) => l[0] === 'exchange_adjustments' && l[1] === 'select' && String(l[2]).includes('exchange_adjustment_private')))
    assert.ok(c.log.some((l) => l[0] === 'shipments' && l[1] === 'eq' && l[2] === 'direction' && l[3] === 'replacement'))
    const m = fakeClient({ tables: { exchange_reservations: { data: null, error: { code: '42P01', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(m).adminReplacement('r1'), { fulfilment: null, adjustment: null, reservations: [], shipments: [] })
    const none = await createReturnsService(fakeClient()).adminReplacement('r1')
    assert.deepEqual([none.fulfilment, none.adjustment, none.reservations, none.shipments], [null, null, [], []])
  })
  it('return shipments of a request (mapped, with the admin-only charges)', async () => {
    const c = fakeClient({ tables: { shipments: { data: [{ id: 's1', order_id: 'o1', direction: 'return', request_id: 'r1', pickup_reference: 'PK-9', shipment_private: [{ charges: '40.00', note: 'n' }] }], error: null } } })
    const out = await createReturnsService(c).returnShipments('r1')
    assert.deepEqual([out[0].id, out[0].requestId, out[0].pickupReference, out[0].charges], ['s1', 'r1', 'PK-9', 40])
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'direction' && l[3] === 'return'))
  })
})

describe('the reasons editor (admin)', () => {
  it('saveReason upserts ONE request_reasons row by code and returns it mapped; the admin list sees the switched-off ones too', async () => {
    const c = fakeClient({ tables: { request_reasons: { data: { code: 'arrived_late', label: 'Arrived late', applies_to: ['return'], seller_fault: true, requires_evidence: false, requires_description: true, active: false, sort_order: 55 }, error: null } } })
    const out = await createReturnsService(c).saveReason({ code: 'arrived_late', label: 'Arrived late', appliesTo: ['return'], sellerFault: true, requiresEvidence: false, requiresDescription: true, active: false, sortOrder: 55 })
    assert.deepEqual(out, { code: 'arrived_late', label: 'Arrived late', appliesTo: ['return'], sellerFault: true, requiresEvidence: false, requiresDescription: true, active: false, sortOrder: 55 })
    const up = c.log.find((l) => l[0] === 'request_reasons' && l[1] === 'upsert')
    assert.ok(up, 'an upsert was sent')
    assert.deepEqual({ ...up[2], updated_at: '-' }, { code: 'arrived_late', label: 'Arrived late', applies_to: ['return'], seller_fault: true, requires_evidence: false, requires_description: true, active: false, sort_order: 55, updated_at: '-' })
    assert.deepEqual(up[3], { onConflict: 'code' })
    assert.ok(c.log.some((l) => l[0] === 'request_reasons' && l[1] === 'select') && c.log.some((l) => l[1] === 'single'))
    assert.equal(c.log.some((l) => l[0] === 'rpc'), false, 'a plain table write: RLS (admin only) is the gate')
  })
  it('a database refusal (not an admin, a failed CHECK) is thrown with the database message', async () => {
    const c = fakeClient({ tables: { request_reasons: { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "request_reasons"' } } } })
    await assert.rejects(() => createReturnsService(c).saveReason({ code: 'x1', label: 'X', appliesTo: ['return'], sortOrder: 1 }), /violates row-level security|permission/)
  })
})