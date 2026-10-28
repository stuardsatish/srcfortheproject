// node --test src/features/inventory/__tests__/inventoryModel.test.mjs   (npm run test:unit)
// Admin-only model (website): the stock ledger in words, the reports, the payments that could not become an order, cancel-an-order and order-refund forms.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MOVEMENT_TYPES, movementMeta, BUCKETS, bucketLabel, optionLabel, LEDGER_SELECT, LEDGER_SELECT_LEGACY, LEDGER_PAGE, mapLedgerRow, signed, ledgerFilters,
  dispositionOptions, defaultDisposition, isDispositionAllowed, stockEffectText,
  mapReconcileRow, mapGapRow, mapUnsellableRow, driftText, gapText, PAYMENT_EXCEPTION_COLUMNS, paymentExceptionMeta, mapPaymentException, validateResolveForm,
  cancelBlockedReason, canCancelOrder, isPaidOrder, razorpayRefundPossible, validateCancelForm, validateOrderRefundForm, cancelResultText,
} from '../inventoryModel.js'

describe('the ledger in words', () => {
  it('every movement type the database allows has a label and a tone; unknown ones degrade to their own name', () => {
    assert.equal(MOVEMENT_TYPES.length, 9)
    for (const t of MOVEMENT_TYPES) { const m = movementMeta(t); assert.ok(m.label && m.tone, t); assert.equal(m.type, t) }
    assert.deepEqual([movementMeta('sale').label, movementMeta('return_unsellable').label, movementMeta('return_unsellable').tone], ['Sold', 'Return: kept, not resellable', 'danger'])
    assert.deepEqual([movementMeta('weird_thing').label, movementMeta('weird_thing').tone], ['Weird thing', 'neutral'])
    assert.equal(movementMeta('').label, 'Legacy movement')
    assert.deepEqual(BUCKETS.map(bucketLabel), ['Sellable', 'Not resellable'])
  })
  it('names an option', () => {
    assert.equal(optionLabel('Designer Shirt', 'Pink'), 'Designer Shirt · Pink')
    assert.equal(optionLabel('Designer Shirt', '', 'var_9'), 'Designer Shirt · var_9')
    assert.equal(optionLabel('Mug', '', ''), 'Mug')
    assert.equal(optionLabel(null, null), 'Product')
    assert.equal(signed(3), '+3'); assert.equal(signed(-1), '-1'); assert.equal(signed(0), '0'); assert.equal(signed('x'), '0')
  })
  it('maps a ledger row (a legacy row without movement_type is a sale when its reason says so)', () => {
    const r = mapLedgerRow({ id: 'l1', seq: '42', product_id: 'p1', variant_id: 'v1', change: -2, reason: 'order', order_id: 'o1', movement_type: 'sale', bucket: 'sellable', ref_type: 'order', ref_id: 'o1',
      actor_kind: 'user', stock_after: 8, created_at: '2026-10-17T10:00:00Z', products: { title: 'Designer Shirt' } }, { v1: 'Pink' })
    assert.deepEqual([r.seq, r.option, r.change, r.movement.label, r.bucket, r.orderId, r.stockAfter], [42, 'Designer Shirt · Pink', -2, 'Sold', 'sellable', 'o1', 8])
    const legacy = mapLedgerRow({ id: 'l2', product_id: 'p1', change: -1, reason: 'order', order_id: 'o0', created_at: '2026-01-01T00:00:00Z', products: [{ title: 'Mug' }] })
    assert.deepEqual([legacy.seq, legacy.variantId, legacy.movement.type, legacy.stockAfter, legacy.option], [null, '', 'sale', null, 'Mug'])
    assert.equal(mapLedgerRow(null), null)
  })
  it('the selects name the strict order column; the legacy one does not; a page is 100', () => {
    assert.match(LEDGER_SELECT, /\bseq\b/); assert.doesNotMatch(LEDGER_SELECT_LEGACY, /\bseq\b/)
    assert.match(LEDGER_SELECT, /products\(title\)/)
    assert.equal(LEDGER_PAGE, 100)
  })
  it('filters: unknown values are dropped, text is trimmed, only real dates survive', () => {
    assert.deepEqual(ledgerFilters({ type: 'sale', bucket: 'unsellable', orderId: '  o1 ', productId: 'p1', from: '2026-10-01', to: '2026-10-17' }),
      { type: 'sale', bucket: 'unsellable', orderId: 'o1', productId: 'p1', from: '2026-10-01', to: '2026-10-17' })
    assert.deepEqual(ledgerFilters({ type: 'nope', bucket: 'x', orderId: ' ', from: '17/10/2026', to: '2026-13-45' }), {})
    assert.deepEqual(ledgerFilters(null), {})
  })
})

describe('where the units of an inspected return go', () => {
  it('a passed line goes back on sale by default, a failed one is kept as not resellable; the illegal combinations are not offered', () => {
    assert.deepEqual(dispositionOptions('passed').map((d) => d.value), ['restock', 'unsellable'])
    assert.deepEqual(dispositionOptions('failed').map((d) => d.value), ['unsellable', 'none'])
    assert.deepEqual([defaultDisposition('passed'), defaultDisposition('failed'), defaultDisposition('x')], ['restock', 'unsellable', ''])
    assert.deepEqual(dispositionOptions('x'), [])
    // what the server accepts (record_inspection): passed -> restock | unsellable, failed -> unsellable | none
    assert.deepEqual([isDispositionAllowed('passed', 'none'), isDispositionAllowed('failed', 'restock'), isDispositionAllowed('passed', 'restock'), isDispositionAllowed('failed', 'none'), isDispositionAllowed('x', 'none')], [false, false, true, true, false])
    for (const r of ['passed', 'failed']) for (const d of dispositionOptions(r)) assert.ok(d.label && d.hint)
  })
  it('what was recorded, in words; nothing for a line inspected before the stock handling existed', () => {
    assert.deepEqual(['restocked', 'unsellable', 'none', '', undefined, 'x'].map(stockEffectText), ['put back on sale', 'kept, not resellable', 'no stock record', '', '', ''])
  })
})

describe('the reports', () => {
  it('reconciliation row, gap row, unsellable row', () => {
    const r = mapReconcileRow({ product_id: 'p1', variant_id: '', title: 'Shirt', variant_name: null, actual_stock: 55, ledger_stock: 50, drift: 5, movements: 7, last_movement_at: '2026-10-17T10:00:00Z' })
    assert.deepEqual([r.option, r.actualStock, r.ledgerStock, r.drift, r.movements], ['Shirt', 55, 50, 5, 7])
    const g = mapGapRow({ product_id: 'p1', variant_id: 'v1', seq: 9, created_at: '2026-10-17T10:00:00Z', movement_type: 'sale', change: -1, previous_after: 50, stock_after: 54, missing: 5 })
    assert.deepEqual([g.seq, g.movement.label, g.previousAfter, g.stockAfter, g.missing], [9, 'Sold', 50, 54, 5])
    const u = mapUnsellableRow({ product_id: 'p1', variant_id: 'v1', title: 'Shirt', variant_name: 'Pink', units: '3', movements: '3', last_movement_at: null })
    assert.deepEqual([u.option, u.units, u.movements], ['Shirt · Pink', 3, 3])
    assert.deepEqual([mapReconcileRow(null), mapGapRow(null), mapUnsellableRow(undefined)], [null, null, null])
  })
  it('says it in words', () => {
    assert.equal(driftText(0), 'matches the ledger'); assert.equal(driftText(5), '5 more than the ledger says'); assert.equal(driftText(-2), '2 fewer than the ledger says')
    assert.equal(gapText({ missing: 5 }), '5 unit(s) appeared outside the ledger before this movement')
    assert.equal(gapText({ missing: -3 }), '3 unit(s) disappeared outside the ledger before this movement')
    assert.equal(gapText({ missing: 0 }), 'no gap'); assert.equal(gapText(null), 'no gap')
  })
})

describe('payments that could not become an order', () => {
  it('states and mapping', () => {
    assert.deepEqual([paymentExceptionMeta('open').label, paymentExceptionMeta('open').open, paymentExceptionMeta('refunded').tone, paymentExceptionMeta('weird').label], ['Needs a refund', true, 'success', 'Weird'])
    assert.doesNotMatch(PAYMENT_EXCEPTION_COLUMNS, /\*/)
    const p = mapPaymentException({ id: 'e1', razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', user_id: 'u1', amount: '1100.50', reason: 'Insufficient stock', status: 'open',
      items: [{ product_id: 'p1', variant_id: '', quantity: 2, title: 'Shirt' }], created_at: '2026-10-17T10:00:00Z' })
    assert.deepEqual([p.amount, p.status, p.items[0].quantity, p.items[0].title, p.refundReference, p.resolvedAt], [1100.5, 'open', 2, 'Shirt', '', null])
    assert.deepEqual(mapPaymentException({ id: 'e2', items: null, amount: null }).items, [])
    assert.equal(mapPaymentException(null), null)
  })
  it('closing one: refunded needs the reference, resolved needs a note', () => {
    assert.deepEqual(validateResolveForm({ status: 'refunded', reference: ' rfnd_1 ', note: 'dashboard' }), { ok: true, errors: {}, args: { status: 'refunded', reference: 'rfnd_1', note: 'dashboard' } })
    assert.equal(validateResolveForm({ status: 'refunded' }).errors.reference, 'Enter the Razorpay refund id (or the bank reference) of the refund you made')
    assert.equal(validateResolveForm({ status: 'resolved' }).errors.note, 'Say how this was handled')
    const r = validateResolveForm({ status: 'resolved', reference: 'ignored', note: 'order made by hand' })
    assert.deepEqual([r.ok, r.args.reference], [true, ''])
    assert.equal(validateResolveForm({}).errors.status, 'Choose refunded or resolved')
    assert.equal(validateResolveForm({ status: 'refunded', reference: 'x'.repeat(201) }).errors.reference, 'At most 200 characters')
    assert.equal(validateResolveForm({ status: 'resolved', note: 'x'.repeat(1001) }).errors.note, 'At most 1000 characters')
  })
})

describe('cancel an order', () => {
  const order = (o = {}) => ({ orderStatus: 'placed', paymentStatus: 'paid', paymentMethod: 'Razorpay', razorpayPaymentId: 'pay_1', shipments: [], ...o })
  it('who can be cancelled: before shipment only, with the reason why not', () => {
    assert.equal(canCancelOrder(order()), true)
    assert.equal(canCancelOrder(order({ orderStatus: 'confirmed' })), true)
    assert.equal(canCancelOrder(order({ orderStatus: 'pending' })), true)
    assert.match(cancelBlockedReason(order({ orderStatus: 'shipped' })), /already on its way/)
    assert.match(cancelBlockedReason(order({ orderStatus: 'delivered' })), /returns or exchanges/)
    assert.match(cancelBlockedReason(order({ orderStatus: 'cancelled' })), /already cancelled/)
    assert.match(cancelBlockedReason(order({ shipments: [{ direction: 'outbound', status: 'in_transit' }] })), /shipment is on record/)
    assert.equal(cancelBlockedReason(order({ shipments: [{ direction: 'outbound', status: 'cancelled' }, { direction: 'return', status: 'in_transit' }] })), '')
    assert.equal(canCancelOrder(null), false)
  })
  it('paid? Razorpay possible?', () => {
    assert.deepEqual([isPaidOrder(order()), isPaidOrder(order({ paymentStatus: 'pending' })), isPaidOrder(null)], [true, false, false])
    assert.deepEqual([razorpayRefundPossible(order()), razorpayRefundPossible(order({ razorpayPaymentId: '' })), razorpayRefundPossible(order({ paymentMethod: 'COD' }))], [true, false, false])
  })
  it('the form: a reason always; a refund method only for a paid order', () => {
    const unpaid = validateCancelForm({ reason: '  out of stock  ', note: ' n ' }, { paid: false })
    assert.deepEqual([unpaid.ok, unpaid.args], [true, { reason: 'out of stock', refundMethod: null, note: 'n' }])
    assert.equal(validateCancelForm({ reason: ' ' }, { paid: false }).errors.reason, 'Give the customer a reason (they read it)')
    assert.equal(validateCancelForm({ reason: 'x'.repeat(501) }, { paid: false }).errors.reason, 'At most 500 characters')
    assert.equal(validateCancelForm({ reason: 'x', note: 'y'.repeat(1001) }, { paid: false }).errors.note, 'At most 1000 characters')
    assert.equal(validateCancelForm({ reason: 'x' }, { paid: true, razorpayPossible: true }).errors.refundMethod, 'This order was paid: choose how it is refunded')
    assert.equal(validateCancelForm({ reason: 'x', refundMethod: 'razorpay' }, { paid: true, razorpayPossible: false }).errors.refundMethod, 'This order was not paid through Razorpay: choose a manual refund')
    assert.deepEqual(validateCancelForm({ reason: 'x', refundMethod: 'razorpay' }, { paid: true, razorpayPossible: true }).args.refundMethod, 'razorpay')
    assert.deepEqual(validateCancelForm({ reason: 'x', refundMethod: 'manual' }, { paid: true, razorpayPossible: false }).args.refundMethod, 'manual')
    assert.equal(validateCancelForm({ reason: 'x', refundMethod: 'razorpay' }, { paid: false }).args.refundMethod, null)          // nothing to refund: a stray method is ignored
  })
  it('the toast sentence', () => {
    assert.equal(cancelResultText({ already: true }), 'This order was already cancelled')
    assert.equal(cancelResultText({ stockRestored: [{}, {}] }), 'Order cancelled; stock restored for 2 option(s)')
    assert.equal(cancelResultText({ stockRestored: [{}], refundNo: 'RFD-1', refundAmount: 1100 }), "Order cancelled; stock restored for 1 option(s); refund RFD-1 of ₹1,100.00 created - send or record it in the order's Refund section")
    assert.equal(cancelResultText(null), 'Order cancelled')
  })
})

describe('refund an order', () => {
  it('amount, reason, method', () => {
    const ok = validateOrderRefundForm({ amount: '300.456', reason: '  the item you returned ', method: 'manual', note: ' n ' }, { remaining: 300.46, razorpayPossible: false })
    assert.deepEqual([ok.ok, ok.args], [true, { amount: 300.46, reason: 'the item you returned', method: 'manual', note: 'n' }])
    assert.equal(validateOrderRefundForm({ amount: '', reason: 'abc', method: 'manual' }, {}).errors.amount, 'Enter the amount to refund')
    assert.equal(validateOrderRefundForm({ amount: '0', reason: 'abc', method: 'manual' }, {}).errors.amount, 'Enter the amount to refund')
    assert.equal(validateOrderRefundForm({ amount: 'abc', reason: 'abc', method: 'manual' }, {}).errors.amount, 'Enter the amount to refund')
    assert.equal(validateOrderRefundForm({ amount: '301', reason: 'abc', method: 'manual' }, { remaining: 300 }).errors.amount, 'At most ₹300.00 can still be refunded for this order')
    assert.equal(validateOrderRefundForm({ amount: '10', reason: 'ab', method: 'manual' }, {}).errors.reason, 'Say what the refund is for (3 to 300 characters, the customer reads it)')
    assert.equal(validateOrderRefundForm({ amount: '10', reason: 'x'.repeat(301), method: 'manual' }, {}).errors.reason, 'Say what the refund is for (3 to 300 characters, the customer reads it)')
    assert.equal(validateOrderRefundForm({ amount: '10', reason: 'abc' }, {}).errors.method, 'Choose how the refund is paid')
    assert.equal(validateOrderRefundForm({ amount: '10', reason: 'abc', method: 'razorpay' }, { razorpayPossible: false }).errors.method, 'This order was not paid through Razorpay: choose a manual refund')
    assert.equal(validateOrderRefundForm({ amount: '10', reason: 'abc', method: 'razorpay' }, {}).ok, true)           // unknown = the server decides
    assert.equal(validateOrderRefundForm({ amount: '10', reason: 'abc', method: 'manual', note: 'x'.repeat(1001) }, {}).errors.note, 'At most 1000 characters')
    assert.equal(validateOrderRefundForm(null, {}).ok, false)
  })
})