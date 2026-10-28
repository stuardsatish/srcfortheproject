// node --test src/services/returns/__tests__/returnsService.test.mjs   (npm run test:unit)
// This file holds the tests of everything the RN app twin (Ecommerce-App-v2-main/src/services/returns.js) also has: it is run against BOTH
// copies (tools/browser-test/Run-RnParity.ps1). The admin half lives in returnsService.admin.test.mjs (website only).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createReturnsService, toReturnsError, isReturnsUnavailable, EVIDENCE_BUCKET } from '../returnsService.js'
import { fakeClient, photo } from './fakeClient.mjs'

describe('error mapping', () => {
  it('keeps the database message; translates the infrastructure cases', () => {
    assert.equal(toReturnsError({ message: 'Only 1 unit(s) of "Shirt" can still be returned', code: '22023' }).message, 'Only 1 unit(s) of "Shirt" can still be returned')
    assert.match(toReturnsError({ code: 'PGRST202', message: 'x' }).message, /not available on the server yet/)
    assert.equal(toReturnsError({ code: '23505', message: 'duplicate key' }).message, 'A request for one of these items already exists.')
    assert.equal(toReturnsError({ code: '42501', message: 'permission denied for function x' }).message, 'You do not have permission to do that.')
    assert.equal(toReturnsError({}).message, 'Something went wrong')
    assert.equal(toReturnsError({ code: '22023', details: 'ACTIVE_REQUEST', message: 'm' }).detail, 'ACTIVE_REQUEST')
  })
  it('recognises a server without the returns feature', () => {
    for (const e of [{ code: 'PGRST202' }, { code: 'PGRST205' }, { code: '42883' }, { code: '42P01' }, { code: '42703' }, { message: 'Could not find the function public.get_order_eligibility(p_order_id)' },
                     { message: 'relation "public.return_requests" does not exist' }]) assert.equal(isReturnsUnavailable(e), true, JSON.stringify(e))
    assert.equal(isReturnsUnavailable({ code: '42501', message: 'permission denied' }), false)
    assert.equal(isReturnsUnavailable(null), false)
  })
})

describe('customer calls', () => {
  it('eligibility: the RPC answer; null when the feature is not on the server; other errors throw', async () => {
    const ok = fakeClient({ rpcs: { get_order_eligibility: { data: { items: [] }, error: null } } })
    assert.deepEqual(await createReturnsService(ok).eligibility('o1'), { items: [] })
    assert.deepEqual(ok.log[0], ['rpc', 'get_order_eligibility', { p_order_id: 'o1' }])
    const missing = fakeClient({ rpcs: { get_order_eligibility: { data: null, error: { code: 'PGRST202', message: 'x' } } } })
    assert.equal(await createReturnsService(missing).eligibility('o1'), null)
    const denied = fakeClient({ rpcs: { get_order_eligibility: { data: null, error: { code: 'P0002', message: 'Order not found' } } } })
    await assert.rejects(() => createReturnsService(denied).eligibility('o1'), /Order not found/)
  })
  it('reasons: rows; [] when the table is missing', async () => {
    const c = fakeClient({ tables: { request_reasons: { data: [{ code: 'damaged' }], error: null } } })
    assert.deepEqual(await createReturnsService(c).reasons(), [{ code: 'damaged' }])
    const m = fakeClient({ tables: { request_reasons: { data: null, error: { code: '42P01', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(m).reasons(), [])
  })
  it('uploadEvidence: puts every photo in <uid>/<request>/ of the PRIVATE bucket and returns what the RPC needs', async () => {
    const c = fakeClient()
    const out = await createReturnsService(c).uploadEvidence({ uid: 'u1', requestId: 'r1', files: [photo('a b.jpg'), photo('c.png', { type: 'image/png' })] })
    assert.deepEqual(out, [{ path: 'u1/r1/1-a-b.jpg', mime: 'image/jpeg', size: 1000 }, { path: 'u1/r1/2-c.png', mime: 'image/png', size: 1000 }])
    assert.ok(c.log.some((l) => l[0] === 'bucket' && l[1] === EVIDENCE_BUCKET))
    assert.deepEqual(c.log.filter((l) => l[0] === 'upload').map((l) => l[2]), [{ contentType: 'image/jpeg', upsert: false }, { contentType: 'image/png', upsert: false }])
    assert.equal(EVIDENCE_BUCKET, 'return-evidence')
  })
  it('uploadEvidence: extra photos continue the numbering (never reuse a stored file name) and still respect the 6 photo limit', async () => {
    const c = fakeClient()
    const out = await createReturnsService(c).uploadEvidence({ uid: 'u1', requestId: 'r1', files: [photo('a.jpg')], startIndex: 2 })
    assert.equal(out[0].path, 'u1/r1/3-a.jpg')
    await assert.rejects(() => createReturnsService(fakeClient()).uploadEvidence({ uid: 'u', requestId: 'r', files: [photo('a.jpg'), photo('b.jpg')], startIndex: 5 }), /At most 6/)
  })
  it('uploadEvidence: refuses bad files before uploading anything, and rolls back when one upload fails', async () => {
    const svc = (c) => createReturnsService(c)
    const c1 = fakeClient()
    await assert.rejects(() => svc(c1).uploadEvidence({ uid: 'u', requestId: 'r', files: [photo('a.jpg'), photo('b.pdf', { type: 'application/pdf' })] }), /JPEG, PNG or WebP/)
    assert.equal(c1.log.filter((l) => l[0] === 'upload').length, 0, 'nothing was uploaded')
    await assert.rejects(() => svc(fakeClient()).uploadEvidence({ uid: 'u', requestId: 'r', files: Array.from({ length: 7 }, (_, i) => photo(`p${i}.jpg`)) }), /At most 6/)
    const c2 = fakeClient({ storage: { uploadError: (p) => (p.includes('/2-') ? { message: 'bucket full' } : null) } })
    await assert.rejects(() => svc(c2).uploadEvidence({ uid: 'u', requestId: 'r', files: [photo('a.jpg'), photo('b.jpg')] }), /bucket full/)
    assert.deepEqual(c2.log.find((l) => l[0] === 'remove')[1], ['u/r/1-a.jpg'], 'the photo that did go up is removed again')
    assert.deepEqual(await svc(fakeClient()).uploadEvidence({ uid: 'u', requestId: 'r', files: [] }), [])
  })
  it('submit / cancel / respond / tracking call their RPCs and map the answer', async () => {
    const c = fakeClient({ rpcs: {
      create_return_request: { data: { ok: true, created: true, request_id: 'r1', request_no: 'RET-2026-000001', status: 'pending_review' }, error: null },
      cancel_return_request: { data: { ok: true, already: false, status: 'cancelled' }, error: null },
      respond_to_request: { data: { ok: true, status: 'pending_review' }, error: null },
      customer_submit_return_shipment: { data: { ok: true, status: 'return_in_transit', shipment_id: 's1' }, error: null },
    } })
    const svc = createReturnsService(c)
    assert.deepEqual(await svc.submit({ p_request_id: 'r1' }), { created: true, requestId: 'r1', requestNo: 'RET-2026-000001', status: 'pending_review' })
    assert.deepEqual(await svc.cancel('r1', 'changed my mind'), { already: false, status: 'cancelled' })
    assert.deepEqual(await svc.respond('r1', 'here', [{ path: 'p' }]), { status: 'pending_review' })
    assert.deepEqual(await svc.submitReturnTracking({ requestId: 'r1', courierName: 'India Post', trackingNumber: 'RR1' }), { status: 'return_in_transit', shipmentId: 's1' })
    assert.deepEqual(c.log[2], ['rpc', 'respond_to_request', { p_request_id: 'r1', p_message: 'here', p_evidence: [{ path: 'p' }] }])
    assert.deepEqual(c.log[3][2], { p_request_id: 'r1', p_courier_name: 'India Post', p_tracking_number: 'RR1', p_tracking_url: null, p_shipped_at: null })
  })
  it('an RPC error becomes a thrown Error with the database message', async () => {
    const c = fakeClient({ rpcs: { create_return_request: { data: null, error: { code: '22023', message: 'Please add at least one photo (required for this reason)' } } } })
    await assert.rejects(() => createReturnsService(c).submit({}), (e) => e.message.startsWith('Please add at least one photo') && e.code === '22023')
  })
  it('lists map rows; a missing table is an empty list', async () => {
    const row = { id: 'r1', request_no: 'RET-1', order_id: 'o1', type: 'return', status: 'approved', reason_code: 'damaged' }
    const c = fakeClient({ tables: { return_requests: { data: [row], error: null } } })
    assert.deepEqual((await createReturnsService(c).listForOrder('o1')).map((r) => r.requestNo), ['RET-1'])
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'order_id' && l[3] === 'o1'))
    assert.ok(c.log.some((l) => l[1] === 'select' && String(l[2]).includes('return_request_events(id, item_id') && !String(l[2]).includes('return_request_private')))
    assert.equal((await createReturnsService(c).listMine()).length, 1)
    const m = fakeClient({ tables: { return_requests: { data: null, error: { code: 'PGRST205', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(m).listMine(), [])
  })
  it('signed links for the private photos', async () => {
    const c = fakeClient()
    assert.deepEqual(await createReturnsService(c).signedEvidenceUrls(['u/r/1-a.jpg']), { 'u/r/1-a.jpg': 'https://signed/u/r/1-a.jpg' })
    assert.deepEqual(c.log.find((l) => l[0] === 'sign'), ['sign', ['u/r/1-a.jpg'], 3600])
    assert.deepEqual(await createReturnsService(c).signedEvidenceUrls([]), {})
  })
  it('refunds of requests: the customer columns only, mapped; [] for no ids or a server without the feature', async () => {
    const c = fakeClient({ tables: { refunds: { data: [{ id: 'f1', refund_no: 'RFD-1', order_id: 'o1', request_id: 'r1', amount: '100.00', method: 'manual', status: 'pending' }], error: null } } })
    const out = await createReturnsService(c).refundsForRequests(['r1'])
    assert.deepEqual([out[0].refundNo, out[0].amount, out[0].status, out[0].requestId], ['RFD-1', 100, 'pending', 'r1'])
    assert.ok(c.log.some((l) => l[0] === 'refunds' && l[1] === 'in' && l[2] === 'request_id'))
    assert.ok(c.log.some((l) => l[0] === 'refunds' && l[1] === 'select' && !String(l[2]).includes('gateway') && !String(l[2]).includes('refund_private') && String(l[2]).includes('failure_reason')))
    assert.deepEqual(await createReturnsService(fakeClient()).refundsForRequests([]), [])
    const m = fakeClient({ tables: { refunds: { data: null, error: { code: 'PGRST205', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(m).refundsForRequests(['r1']), [])
    const denied = fakeClient({ tables: { refunds: { data: null, error: { code: '42501', message: 'permission denied for table refunds' } } } })
    await assert.rejects(() => createReturnsService(denied).refundsForRequests(['r1']), /permission/)
  })
  it('order-level refunds and the cancellation of ONE order: the customer columns (with the reason), never the staff side; empty / null without the feature', async () => {
    const c = fakeClient({ tables: {
      refunds: { data: [{ id: 'f1', refund_no: 'RFD-1', order_id: 'o1', request_id: null, kind: 'order', amount: '1100.00', method: 'razorpay', status: 'pending', reason: 'your cancelled order' }], error: null },
      order_cancellations: { data: [{ order_id: 'o1', reason: 'We cannot supply it', refund_id: 'f1', cancelled_at: '2026-10-18T10:00:00Z' }], error: null },
    } })
    const svc = createReturnsService(c)
    const refunds = await svc.refundsForOrder('o1')
    assert.deepEqual([refunds[0].kind, refunds[0].reason, refunds[0].amount, refunds[0].requestId], ['order', 'your cancelled order', 1100, null])
    assert.ok(c.log.some((l) => l[0] === 'refunds' && l[1] === 'eq' && l[2] === 'kind' && l[3] === 'order'))
    assert.ok(c.log.some((l) => l[0] === 'refunds' && l[1] === 'select' && String(l[2]).endsWith(', reason') && !/gateway|private/.test(String(l[2]))))
    assert.deepEqual(await svc.cancellationForOrder('o1'), { orderId: 'o1', reason: 'We cannot supply it', refundId: 'f1', cancelledAt: '2026-10-18T10:00:00Z' })
    assert.ok(c.log.some((l) => l[0] === 'order_cancellations' && l[1] === 'select' && !/private|cancelled_by|internal/.test(String(l[2]))))
    assert.deepEqual(await svc.refundsForOrder(''), [])
    assert.equal(await svc.cancellationForOrder(null), null)
    assert.equal(await createReturnsService(fakeClient()).cancellationForOrder('o9'), null)
    // a server without the cancellation migration: the missing table / column means "nothing", any other error is thrown
    const old = fakeClient({ tables: { refunds: { data: null, error: { code: '42703', message: 'column refunds.reason does not exist' } }, order_cancellations: { data: null, error: { code: 'PGRST205', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(old).refundsForOrder('o1'), [])
    assert.equal(await createReturnsService(old).cancellationForOrder('o1'), null)
    const denied = fakeClient({ tables: { order_cancellations: { data: null, error: { code: '42501', message: 'permission denied for table order_cancellations' } } } })
    await assert.rejects(() => createReturnsService(denied).cancellationForOrder('o1'), /permission/)
  })
  it('replacements of exchanges: the record, the price difference and the live parcel by request; never the reservations or the staff notes', async () => {
    const c = fakeClient({ tables: {
      replacement_fulfillments: { data: [{ id: 'f1', request_id: 'r1', order_id: 'o1', status: 'shipped', shipment_id: 's2', replacement_fulfillment_items: [{ id: 'fi1', title: 'Shirt', variant_name: 'White', quantity: 1 }] }], error: null },
      exchange_adjustments: { data: [{ request_id: 'r1', kind: 'refund_due', amount: '100.00', status: 'open' }], error: null },
      shipments: { data: [{ id: 's1', direction: 'replacement', request_id: 'r1', status: 'cancelled', created_at: '2026-10-18T10:00:00Z' }, { id: 's2', direction: 'replacement', request_id: 'r1', status: 'in_transit', tracking_number: 'T1', created_at: '2026-10-18T12:00:00Z' }], error: null },
    } })
    const out = await createReturnsService(c).replacementsFor(['r1'])
    assert.deepEqual(Object.keys(out), ['r1'])
    assert.deepEqual([out.r1.fulfilment.status, out.r1.fulfilment.lines[0].variantName, out.r1.adjustment.kind, out.r1.adjustment.amount, out.r1.shipment.id, out.r1.shipment.trackingNumber], ['shipped', 'White', 'refund_due', 100, 's2', 'T1'])
    assert.ok(c.log.some((l) => l[0] === 'replacement_fulfillments' && l[1] === 'in' && l[2] === 'request_id'))
    assert.ok(c.log.some((l) => l[0] === 'shipments' && l[1] === 'eq' && l[2] === 'direction' && l[3] === 'replacement'))
    // customer columns only: no staff reference / note, no reservations table, no shipment_private
    assert.ok(c.log.some((l) => l[0] === 'exchange_adjustments' && l[1] === 'select' && !/reference|internal|private/.test(String(l[2]))))
    assert.ok(!c.log.some((l) => l[0] === 'exchange_reservations'))
    assert.ok(!c.log.some((l) => l[0] === 'shipments' && l[1] === 'select' && String(l[2]).includes('shipment_private')))
    assert.deepEqual(await createReturnsService(fakeClient()).replacementsFor([]), {})
    assert.deepEqual(await createReturnsService(fakeClient()).replacementsFor(null), {})
    // a server without the exchange tables: nothing (the feature stays hidden); any other error is thrown
    const m = fakeClient({ tables: { replacement_fulfillments: { data: null, error: { code: 'PGRST205', message: 'x' } } } })
    assert.deepEqual(await createReturnsService(m).replacementsFor(['r1']), {})
    const denied = fakeClient({ tables: { exchange_adjustments: { data: null, error: { code: '42501', message: 'permission denied for table exchange_adjustments' } } } })
    await assert.rejects(() => createReturnsService(denied).replacementsFor(['r1']), /permission/)
  })
  it('the customer view of return parcels never selects the admin-only table', async () => {
    const c = fakeClient({ tables: { shipments: { data: [{ id: 's1', direction: 'return', request_id: 'r1' }], error: null } } })
    const out = await createReturnsService(c).returnShipmentsFor(['r1'])
    assert.equal(out[0].requestId, 'r1')
    assert.ok(c.log.some((l) => l[1] === 'select' && !String(l[2]).includes('shipment_private') && String(l[2]).includes('shipment_events(id, event_type')))
    assert.deepEqual(await createReturnsService(fakeClient()).returnShipmentsFor([]), [])
  })
})