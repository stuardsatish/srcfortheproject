// node --test src/features/returns/__tests__/exchangeModel.test.mjs   (npm run test:unit)
// Also run against the RN copy of the module (src/utils/exchangeModel.js) by tools/browser-test/Run-RnParity.ps1.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FULFILMENT_STATUSES, ADJUSTMENT_KINDS, ADJUSTMENT_STATUSES, money, fulfilmentStatusMeta, replacementLineText, customerAdjustmentLine, adjustmentAdminLine,
  REPLACEMENT_COLUMNS_CUSTOMER, ADJUSTMENT_COLUMNS_CUSTOMER, ADJUSTMENT_SELECT_ADMIN, RESERVATIONS_COLUMNS_ADMIN, mapFulfilmentRow, mapFulfilmentRows, mapAdjustmentRow,
  mapAdjustmentRows, mapReservationRow, mapReservationRows, reservationLabel, buildReplacementMap, customerReplacement, replacementAdminState, replacementAdminActions,
  validateSettleForm, validateExchangeRefundForm, shipReplacementArgs,
} from '../exchangeModel.js'

const fRow = (o = {}) => ({
  id: 'f1', request_id: 'r1', order_id: 'o1', status: 'pending', shipment_id: null, shipped_at: null, delivered_at: null, cancelled_at: null, created_at: '2026-10-17T10:00:00Z',
  replacement_fulfillment_items: [{
    id: 'fi1', request_item_id: 'ri1', order_item_id: 'oi1', product_id: 'p1', variant_id: 'v-white', title: 'Designer Shirt', variant_name: 'White', sku: 'DS-W', image: 'https://img/w.jpg',
    quantity: 2, original_unit_price: '300.00', replacement_unit_price: '200.00', price_difference: '-200.00',
  }],
  ...o,
})
const aRow = (o = {}) => ({ request_id: 'r1', kind: 'refund_due', amount: '100.00', status: 'open', refund_id: null, settled_at: null, created_at: '2026-10-17T10:00:00Z', updated_at: '2026-10-17T10:00:00Z', ...o })
const ship = (o = {}) => ({ id: 's1', requestId: 'r1', direction: 'replacement', status: 'in_transit', courierName: 'Local courier', trackingNumber: 'TRK1', trackingUrl: 'https://t.example/TRK1', createdAt: '2026-10-18T10:00:00Z', ...o })
const exch = (status, o = {}) => ({ id: 'r1', type: 'exchange', status, ...o })

describe('wording and states', () => {
  it('money: Indian grouping, two decimals, garbage as zero', () => {
    assert.equal(money(1227.78), '₹1,227.78')
    assert.equal(money('100000'), '₹1,00,000.00')
    assert.equal(money(undefined), '₹0.00')
  })
  it('every database status has a label, a tone and a final flag; unknown ones degrade', () => {
    assert.deepEqual(FULFILMENT_STATUSES.map((s) => fulfilmentStatusMeta(s).label), ['Being prepared', 'On its way', 'Delivered', 'Cancelled'])
    assert.deepEqual(FULFILMENT_STATUSES.map((s) => fulfilmentStatusMeta(s).final), [false, false, true, true])
    for (const s of FULFILMENT_STATUSES) assert.ok(fulfilmentStatusMeta(s).tone)
    assert.deepEqual([fulfilmentStatusMeta('weird').label, fulfilmentStatusMeta('weird').tone], ['Weird', 'neutral'])
    assert.equal(fulfilmentStatusMeta(undefined).label, 'Unknown')
    assert.deepEqual(ADJUSTMENT_KINDS, ['none', 'balance_due', 'refund_due'])
    assert.deepEqual(ADJUSTMENT_STATUSES, ['open', 'collected', 'refunded', 'waived', 'not_needed'])
  })
  it('a line of the replacement', () => {
    assert.equal(replacementLineText({ title: 'Designer Shirt', variantName: 'White', quantity: 2 }), 'Designer Shirt · White x2')
    assert.equal(replacementLineText({ title: 'Mug', variantName: '', quantity: 1 }), 'Mug x1')
    assert.equal(replacementLineText(null), '')
  })
})

describe('the price difference as the customer reads it', () => {
  const adj = (o) => mapAdjustmentRow(aRow(o))
  it('same price: nothing to say', () => {
    assert.equal(customerAdjustmentLine(adj({ kind: 'none', amount: '0.00', status: 'not_needed' })), null)
    assert.equal(customerAdjustmentLine(null), null)
  })
  it('the customer owes: to pay, paid, waived', () => {
    const open = customerAdjustmentLine(adj({ kind: 'balance_due', amount: '50.00' }))
    assert.deepEqual([open.headline, open.tone, open.open], ['Price difference to pay', 'warning', true])
    assert.equal(open.detail, 'The replacement costs ₹50.00 more than the item you return. We will contact you to collect it before we send it.')
    const paid = customerAdjustmentLine(adj({ kind: 'balance_due', amount: '50.00', status: 'collected' }))
    assert.deepEqual([paid.headline, paid.detail, paid.open], ['Price difference paid', 'We received the ₹50.00 difference. Thank you.', false])
    assert.equal(customerAdjustmentLine(adj({ kind: 'balance_due', amount: '50.00', status: 'waived' })).headline, 'Price difference waived')
  })
  it('a refund is due: promised, refunded, closed - never "refunded" before the server says so', () => {
    const open = customerAdjustmentLine(adj({}))
    assert.deepEqual([open.headline, open.tone, open.open], ['Price difference refund', 'accent', true])
    assert.equal(open.detail, 'The replacement costs ₹100.00 less than the item you return. We will refund the difference.')
    assert.equal(customerAdjustmentLine(adj({ status: 'refunded' })).detail, '₹100.00 was refunded to you.')
    const waived = customerAdjustmentLine(adj({ status: 'waived' }))
    assert.deepEqual([waived.headline, waived.open], ['No refund due', false])
    assert.doesNotMatch(open.detail, /was refunded/)
  })
  it('staff wording', () => {
    assert.equal(adjustmentAdminLine(adj({ kind: 'balance_due', amount: '50' })), 'Customer owes ₹50.00 - not settled yet')
    assert.equal(adjustmentAdminLine(adj({})), 'Customer is owed ₹100.00 - not settled yet')
    assert.equal(adjustmentAdminLine(adj({ status: 'refunded' })), 'Customer is owed ₹100.00 - refunded')
    assert.equal(adjustmentAdminLine(adj({ kind: 'none', amount: '0', status: 'not_needed' })), 'Same price: nothing to settle')
    assert.equal(adjustmentAdminLine(null), '')
  })
})

describe('mapping rows', () => {
  it('the select lists name the right tables', () => {
    assert.match(REPLACEMENT_COLUMNS_CUSTOMER, /replacement_fulfillment_items/)
    assert.doesNotMatch(ADJUSTMENT_COLUMNS_CUSTOMER, /reference|internal/)         // the customer never asks for staff fields
    assert.match(ADJUSTMENT_SELECT_ADMIN, /exchange_adjustment_private\(reference, internal_note/)
    assert.match(RESERVATIONS_COLUMNS_ADMIN, /stock_moved/)
  })
  it('maps a fulfilment with its lines (numbers as numbers)', () => {
    const f = mapFulfilmentRow(fRow())
    assert.deepEqual([f.id, f.requestId, f.orderId, f.status, f.shipmentId], ['f1', 'r1', 'o1', 'pending', null])
    assert.deepEqual(f.lines[0], {
      id: 'fi1', requestItemId: 'ri1', orderItemId: 'oi1', productId: 'p1', variantId: 'v-white', title: 'Designer Shirt', variantName: 'White', sku: 'DS-W', image: 'https://img/w.jpg',
      quantity: 2, originalUnitPrice: 300, replacementUnitPrice: 200, priceDifference: -200,
    })
    assert.equal(mapFulfilmentRow(null), null)
    assert.deepEqual(mapFulfilmentRows([null, fRow()]).map((x) => x.id), ['f1'])
    assert.deepEqual(mapFulfilmentRow(fRow({ replacement_fulfillment_items: undefined })).lines, [])
  })
  it('maps an adjustment; the staff fields only when the admin asked for them', () => {
    const a = mapAdjustmentRow(aRow())
    assert.deepEqual([a.requestId, a.kind, a.amount, a.status, a.refundId, a.reference, a.internalNote], ['r1', 'refund_due', 100, 'open', null, '', ''])
    const b = mapAdjustmentRow(aRow({ exchange_adjustment_private: [{ reference: 'UPI 4488', internal_note: 'paid at the counter' }] }))
    assert.deepEqual([b.reference, b.internalNote], ['UPI 4488', 'paid at the counter'])
    assert.equal(mapAdjustmentRow(aRow({ exchange_adjustment_private: { reference: 'x' } })).reference, 'x')
    assert.equal(mapAdjustmentRow(undefined), null)
    assert.equal(mapAdjustmentRows([aRow(), null]).length, 1)
  })
  it('maps a reservation and words its state for staff', () => {
    const r = mapReservationRow({ request_item_id: 'ri1', request_id: 'r1', product_id: 'p1', variant_id: '', quantity: 1, unit_price: '200', stock_moved: true, status: 'reserved' })
    assert.deepEqual([r.requestItemId, r.variantId, r.quantity, r.unitPrice, r.stockMoved, r.status], ['ri1', '', 1, 200, true, 'reserved'])
    assert.equal(reservationLabel(r), 'Stock reserved')
    assert.equal(reservationLabel({ ...r, status: 'released' }), 'Stock released')
    assert.equal(reservationLabel({ ...r, status: 'fulfilled' }), 'Shipped')
    assert.equal(reservationLabel({ ...r, stockMoved: false }), 'Stock reserved (stock not tracked)')
    assert.equal(reservationLabel(null), 'No stock held')
    assert.equal(mapReservationRows([null, { request_item_id: 'x', quantity: 1 }]).length, 1)
  })
})

describe('the customer card', () => {
  const bundle = (o = {}) => ({ fulfilment: mapFulfilmentRow(fRow()), adjustment: mapAdjustmentRow(aRow()), shipment: null, ...o })
  it('buildReplacementMap: by request, the newest live parcel, cancelled ones ignored', () => {
    const f1 = mapFulfilmentRow(fRow()); const f2 = mapFulfilmentRow(fRow({ id: 'f2', request_id: 'r2' }))
    const m = buildReplacementMap([f1, f2, null], [mapAdjustmentRow(aRow())], [
      ship({ id: 'old', status: 'cancelled', createdAt: '2026-10-19T10:00:00Z' }), ship({ id: 'a', createdAt: '2026-10-18T10:00:00Z' }), ship({ id: 'b', createdAt: '2026-10-18T12:00:00Z' }),
      ship({ id: 'other', requestId: 'r3' }), ship({ id: 'orphan', requestId: null }),
    ])
    assert.deepEqual(Object.keys(m).sort(), ['r1', 'r2', 'r3'])
    assert.equal(m.r1.fulfilment.id, 'f1'); assert.equal(m.r1.adjustment.kind, 'refund_due'); assert.equal(m.r1.shipment.id, 'b')
    assert.equal(m.r2.adjustment, null); assert.equal(m.r2.shipment, null)
    assert.equal(m.r3.fulfilment, null); assert.equal(m.r3.shipment.id, 'other')
    assert.deepEqual(buildReplacementMap(null, null, null), {})
  })
  it('being prepared, with the lines and the price difference; no tracking yet', () => {
    const c = customerReplacement(exch('replacement_pending'), bundle())
    assert.equal(c.headline, 'Your replacement is being prepared')
    assert.deepEqual(c.status.label, 'Being prepared')
    assert.deepEqual(c.lines, [{ id: 'fi1', text: 'Designer Shirt · White x2' }])
    assert.equal(c.tracking, null)
    assert.equal(c.adjustment.headline, 'Price difference refund')
  })
  it('on its way: the courier and tracking of the parcel', () => {
    const c = customerReplacement(exch('replacement_shipped'), bundle({ fulfilment: mapFulfilmentRow(fRow({ status: 'shipped' })), shipment: ship() }))
    assert.equal(c.headline, 'Your replacement is on its way')
    assert.deepEqual(c.tracking, { courier: 'Local courier', number: 'TRK1', url: 'https://t.example/TRK1', status: 'in_transit' })
    assert.equal(customerReplacement(exch('replacement_shipped'), bundle({ fulfilment: mapFulfilmentRow(fRow({ status: 'shipped' })), shipment: ship({ courierName: '', trackingNumber: '' }) })).tracking.courier, 'Courier')
  })
  it('delivered', () => {
    assert.equal(customerReplacement(exch('closed'), bundle({ fulfilment: mapFulfilmentRow(fRow({ status: 'delivered' })) })).headline, 'Your replacement was delivered')
  })
  it('nothing for a return, a missing / cancelled record, or no bundle', () => {
    assert.equal(customerReplacement({ type: 'return', status: 'refunded' }, bundle()), null)
    assert.equal(customerReplacement(exch('replacement_pending'), undefined), null)
    assert.equal(customerReplacement(exch('replacement_pending'), { fulfilment: null }), null)
    assert.equal(customerReplacement(exch('cancelled'), bundle({ fulfilment: mapFulfilmentRow(fRow({ status: 'cancelled' })) })), null)
    assert.equal(customerReplacement(null, bundle()), null)
  })
  it('the same price shows no price difference block', () => {
    assert.equal(customerReplacement(exch('replacement_pending'), bundle({ adjustment: mapAdjustmentRow(aRow({ kind: 'none', amount: '0', status: 'not_needed' })) })).adjustment, null)
  })
})

describe('what the admin may do', () => {
  const st = (status, o = {}, refunds = []) => replacementAdminState(exch(status), { fulfilment: mapFulfilmentRow(fRow(o.f)), adjustment: o.a === null ? null : mapAdjustmentRow(aRow(o.a)) }, refunds)
  it('replacement pending, nothing owed: ship it; a refund due can be paid or waived', () => {
    const s = st('replacement_pending')
    assert.deepEqual([s.canShip, s.shipBlocked, s.canRefund, s.canWaive, s.canCollect, s.canMarkDelivered], [true, '', true, true, false, false])
    assert.deepEqual(replacementAdminActions(s), ['ship', 'refund', 'waive'])
  })
  it('the customer owes money: shipping is blocked until collected or waived', () => {
    const s = st('replacement_pending', { a: { kind: 'balance_due', amount: '50.00' } })
    assert.deepEqual([s.canShip, s.canCollect, s.canWaive, s.canRefund], [false, true, true, false])
    assert.equal(s.shipBlocked, 'Collect or waive the price difference of ₹50.00 before the replacement ships')
    assert.deepEqual(replacementAdminActions(s), ['collect', 'waive'])
    assert.equal(st('replacement_pending', { a: { kind: 'balance_due', amount: '50.00', status: 'collected' } }).canShip, true)
    assert.equal(st('replacement_pending', { a: { kind: 'balance_due', amount: '50.00', status: 'waived' } }).canShip, true)
  })
  it('a refund in progress: no second refund, no waiver', () => {
    const s = st('replacement_pending', {}, [{ kind: 'exchange_difference', status: 'pending' }])
    assert.deepEqual([s.refundActive, s.canRefund, s.canWaive], [true, false, false])
    // a failed one does not count: the admin may try again
    assert.deepEqual([st('replacement_pending', {}, [{ kind: 'exchange_difference', status: 'failed' }]).canRefund, st('replacement_pending', {}, [{ kind: 'return', status: 'pending' }]).canRefund], [true, true])
  })
  it('shipped: mark delivered; delivered with an open difference: waiting to close', () => {
    const shipped = st('replacement_shipped', { f: { status: 'shipped' } })
    assert.deepEqual([shipped.canShip, shipped.canMarkDelivered, shipped.waitingToClose], [false, true, false])
    const delivered = st('replacement_delivered', { f: { status: 'delivered' } })
    assert.deepEqual([delivered.canMarkDelivered, delivered.waitingToClose, delivered.canRefund], [false, true, true])
    assert.equal(st('replacement_delivered', { f: { status: 'delivered' }, a: { status: 'refunded' } }).waitingToClose, false)
  })
  it('no record / no adjustment / a return: nothing', () => {
    assert.deepEqual(replacementAdminActions(replacementAdminState(exch('replacement_pending'), null)), [])
    const none = replacementAdminState(exch('replacement_pending'), { fulfilment: mapFulfilmentRow(fRow()), adjustment: null })
    assert.deepEqual([none.hasRecord, none.canShip], [true, true])
    assert.equal(replacementAdminState({ type: 'return', status: 'replacement_pending' }, { fulfilment: mapFulfilmentRow(fRow()), adjustment: null }).canShip, false)
    assert.deepEqual(replacementAdminActions(null), [])
  })
})

describe('forms', () => {
  it('settle: collected needs the payment reference, waived needs a reason', () => {
    assert.deepEqual(validateSettleForm({ resolution: 'collected', reference: '  UPI 4488  ', note: 'at the counter' }), { ok: true, errors: {}, args: { resolution: 'collected', reference: 'UPI 4488', note: 'at the counter' } })
    assert.equal(validateSettleForm({ resolution: 'collected' }).errors.reference, 'Enter the payment reference (how and when the customer paid)')
    assert.equal(validateSettleForm({ resolution: 'waived' }).errors.note, 'Say why the difference is waived')
    const w = validateSettleForm({ resolution: 'waived', reference: 'ignored', note: 'goodwill' })
    assert.deepEqual([w.ok, w.args.reference, w.args.note], [true, '', 'goodwill'])
    assert.equal(validateSettleForm({ resolution: 'paid' }).errors.resolution, 'Choose collected or waived')
    assert.equal(validateSettleForm(null).ok, false)
    assert.equal(validateSettleForm({ resolution: 'collected', reference: 'x'.repeat(201) }).errors.reference, 'At most 200 characters')
    assert.equal(validateSettleForm({ resolution: 'waived', note: 'x'.repeat(1001) }).errors.note, 'At most 1000 characters')
  })
  it('refund of the difference: a method, an optional note', () => {
    assert.deepEqual(validateExchangeRefundForm({ method: 'manual', note: ' paid by UPI ' }), { ok: true, errors: {}, args: { method: 'manual', note: 'paid by UPI' } })
    assert.equal(validateExchangeRefundForm({ method: 'razorpay' }).ok, true)
    assert.equal(validateExchangeRefundForm({}).errors.method, 'Choose how the refund is paid')
    assert.equal(validateExchangeRefundForm({ method: 'cheque' }).ok, false)
    assert.equal(validateExchangeRefundForm({ method: 'manual', note: 'x'.repeat(1001) }).errors.note, 'At most 1000 characters')
  })
  it('ship_replacement() arguments from the shipping form payload (the order and items are dropped)', () => {
    const payload = { p_order_id: 'o1', p_courier_code: 'delhivery', p_tracking_number: 'T1', p_tracking_url: null, p_shipped_at: '2026-10-18T10:00:00.000Z', p_charges: 40, p_note: 'boxed', p_items: null, p_courier_name: 'Delhivery', p_expected_delivery_date: '2026-10-22' }
    assert.deepEqual(shipReplacementArgs('r1', payload), {
      p_request_id: 'r1', p_courier_code: 'delhivery', p_courier_name: 'Delhivery', p_tracking_number: 'T1', p_tracking_url: null, p_shipped_at: '2026-10-18T10:00:00.000Z',
      p_charges: 40, p_note: 'boxed', p_expected_delivery_date: '2026-10-22',
    })
    assert.equal(Object.hasOwn(shipReplacementArgs('r1', payload), 'p_order_id'), false)
    assert.equal(shipReplacementArgs('r1', payload).p_items, undefined)
    const empty = shipReplacementArgs('r1', {})
    assert.deepEqual([empty.p_courier_code, empty.p_charges, empty.p_tracking_number], ['manual', null, null])
    assert.equal(shipReplacementArgs('r1', { p_charges: 0 }).p_charges, 0)                     // a free parcel is 0, not "unknown"
  })
})