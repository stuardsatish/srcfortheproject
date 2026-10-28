// node --test src/features/returns/__tests__/refundModel.test.mjs   (npm run test:unit)
// Also run against the RN copy of the module (src/utils/refundModel.js) by tools/browser-test/Run-RnParity.ps1.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  REFUND_STATUSES, REFUND_METHODS, refundStatusMeta, refundMethodLabel, formatMoney, customerRefundLine, refundsToShow, REFUNDS_COLUMNS_CUSTOMER, REFUNDS_COLUMNS_ORDER, REFUNDS_SELECT_ADMIN,
  mapRefundRow, mapRefundRows, mapCalculation, refundBreakdownRows, refundAdminActions, gatewayStateLabel, validateRefundForm,
} from '../refundModel.js'

const row = (o = {}) => ({
  id: 'f1', refund_no: 'RFD-2026-000001', order_id: 'o1', request_id: 'r1', kind: 'return', amount: '1200.00', currency: 'INR', items_amount: '1227.78', shipping_amount: '0.00',
  adjustment_amount: '-27.78', adjustment_note: 'Return courier cost deducted', method: 'manual', status: 'pending', reference: null, failure_reason: null,
  initiated_at: '2026-10-17T10:00:00Z', completed_at: null, created_at: '2026-10-17T10:00:00Z', ...o,
})

describe('states and wording', () => {
  it('every database status has a customer label, a tone and a final flag', () => {
    for (const s of REFUND_STATUSES) { const m = refundStatusMeta(s); assert.ok(m.label && m.tone, s) }
    assert.deepEqual(REFUND_STATUSES.map((s) => refundStatusMeta(s).label), ['Refund processing', 'Refund completed', 'Refund failed - contact support'])
    assert.deepEqual(REFUND_STATUSES.map((s) => refundStatusMeta(s).final), [false, true, true])
    assert.deepEqual(REFUND_METHODS, ['razorpay', 'manual'])
  })
  it('an unknown status degrades gracefully', () => {
    assert.deepEqual([refundStatusMeta('weird').label, refundStatusMeta('weird').tone, refundStatusMeta('weird').final], ['Weird', 'neutral', false])
    assert.equal(refundStatusMeta(undefined).label, 'Unknown')
  })
  it('method wording', () => {
    assert.equal(refundMethodLabel('razorpay'), 'Original payment method (Razorpay)')
    assert.equal(refundMethodLabel('manual'), 'Bank / UPI transfer')
    assert.equal(refundMethodLabel('store_credit'), 'Store credit')
  })
  it('money: Indian grouping, two decimals, rupee sign, other currencies by code, garbage as zero', () => {
    assert.equal(formatMoney(1227.78), '₹1,227.78')
    assert.equal(formatMoney('100000'), '₹1,00,000.00')
    assert.equal(formatMoney(49), '₹49.00')
    assert.equal(formatMoney(12.5, 'USD'), 'USD 12.50')
    assert.equal(formatMoney(undefined), '₹0.00')
    assert.equal(formatMoney('abc'), '₹0.00')
  })
})

describe('what the customer reads (spec 9.3)', () => {
  it('Refund Processing', () => {
    const l = customerRefundLine(mapRefundRow(row({ method: 'razorpay' })))
    assert.deepEqual([l.headline, l.tone, l.final], ['Refund processing', 'accent', false])
    assert.equal(l.detail, '₹1,200.00 is being refunded to your original payment method. We will tell you as soon as it is done.')
    assert.match(customerRefundLine(mapRefundRow(row())).detail, /by bank \/ UPI transfer/)
  })
  it('Refund Completed (with the date in IST and the reference)', () => {
    const l = customerRefundLine(mapRefundRow(row({ status: 'succeeded', completed_at: '2026-10-18T20:00:00Z', reference: 'UTR-889977' })))
    assert.deepEqual([l.headline, l.tone, l.final], ['Refund completed', 'success', true])
    assert.equal(l.detail, '₹1,200.00 was refunded on 19 Oct 2026 by bank / UPI transfer. Reference: UTR-889977.')       // 20:00 UTC = 01:30 IST the next day
    assert.equal(customerRefundLine(mapRefundRow(row({ status: 'succeeded', method: 'razorpay', completed_at: null }))).detail, '₹1,200.00 was refunded to your original payment method.')
  })
  it('Refund Failed - contact support (the stored reason, never an optimistic status)', () => {
    const l = customerRefundLine(mapRefundRow(row({ status: 'failed', failure_reason: 'The bank rejected the transfer' })))
    assert.deepEqual([l.headline, l.tone, l.final], ['Refund failed - contact support', 'danger', true])
    assert.equal(l.detail, 'The bank rejected the transfer Please contact us and we will sort it out.')
    assert.match(customerRefundLine(mapRefundRow(row({ status: 'failed' }))).detail, /could not complete the refund of ₹1,200\.00/)
  })
  it('the refund of an exchange price difference says what it is for (same three states)', () => {
    const d = (o) => customerRefundLine(mapRefundRow(row({ kind: 'exchange_difference', amount: '100.00', method: 'razorpay', adjustment_amount: '0', adjustment_note: null, items_amount: '100.00', ...o })))
    assert.equal(d({}).detail, '₹100.00 (the price difference of your exchange) is being refunded to your original payment method. We will tell you as soon as it is done.')
    assert.equal(d({ status: 'succeeded', completed_at: '2026-10-18T06:00:00Z' }).detail, '₹100.00 (the price difference of your exchange) was refunded on 18 Oct 2026 to your original payment method.')
    assert.match(d({ status: 'failed' }).detail, /could not complete the refund of ₹100\.00 \(the price difference of your exchange\)\./)
    assert.equal(d({ status: 'failed' }).headline, 'Refund failed - contact support')
  })
  it('an order-level refund (a cancelled order, an exchange cancelled after the item came back) says what it is for; without a reason it is just the amount', () => {
    const o = (x) => customerRefundLine(mapRefundRow(row({ kind: 'order', request_id: null, amount: '1100.00', method: 'razorpay', adjustment_amount: '0', adjustment_note: null, items_amount: '1100.00', reason: 'your cancelled order', ...x })))
    assert.equal(o({}).detail, '₹1,100.00 (your cancelled order) is being refunded to your original payment method. We will tell you as soon as it is done.')
    assert.equal(o({ status: 'succeeded', completed_at: '2026-10-18T06:00:00Z', method: 'manual', reason: 'the item you returned' }).detail, '₹1,100.00 (the item you returned) was refunded on 18 Oct 2026 by bank / UPI transfer.')
    assert.match(o({ status: 'failed' }).detail, /could not complete the refund of ₹1,100\.00 \(your cancelled order\)\./)
    assert.equal(o({ reason: null }).detail, '₹1,100.00 is being refunded to your original payment method. We will tell you as soon as it is done.')
    assert.equal(mapRefundRow(row({ reason: 'goodwill' })).reason, 'goodwill')
    assert.equal(mapRefundRow(row()).reason, '')
  })
  it('the order-refund columns add the reason and nothing admin-only; the generic list stays free of it (a server without the cancellation migration has no such column)', () => {
    assert.ok(REFUNDS_COLUMNS_ORDER.startsWith(REFUNDS_COLUMNS_CUSTOMER) && REFUNDS_COLUMNS_ORDER.endsWith(', reason'))
    assert.ok(!/(^|, )reason($|,)/.test(REFUNDS_COLUMNS_CUSTOMER))
    assert.ok(!/gateway|private|idempotency/.test(REFUNDS_COLUMNS_ORDER))
  })
  it('nothing for no refund', () => {
    assert.deepEqual(customerRefundLine(null), { headline: '', detail: '', tone: 'neutral', final: false })
  })
  it('refundsToShow: the live refund wins; only failures -> the latest failure', () => {
    const a = mapRefundRow(row({ id: 'a', status: 'failed', created_at: '2026-10-17T09:00:00Z' }))
    const b = mapRefundRow(row({ id: 'b', status: 'failed', created_at: '2026-10-17T11:00:00Z' }))
    const c = mapRefundRow(row({ id: 'c', status: 'pending', created_at: '2026-10-17T12:00:00Z' }))
    assert.deepEqual(refundsToShow([a, b, c]).map((r) => r.id), ['c'])
    assert.deepEqual(refundsToShow([a, b]).map((r) => r.id), ['b'])
    assert.deepEqual(refundsToShow([]), [])
    assert.deepEqual(refundsToShow(null), [])
    assert.deepEqual(refundsToShow([null, a]).map((r) => r.id), ['a'])
  })
})

describe('mapping rows', () => {
  it('maps a customer row (numbers as numbers, absent embeds tolerated)', () => {
    const r = mapRefundRow(row())
    assert.deepEqual([r.refundNo, r.requestId, r.kind, r.amount, r.itemsAmount, r.shippingAmount, r.adjustmentAmount, r.adjustmentNote, r.method, r.status],
      ['RFD-2026-000001', 'r1', 'return', 1200, 1227.78, 0, -27.78, 'Return courier cost deducted', 'manual', 'pending'])
    assert.deepEqual([r.lines, r.events, r.internalNote, r.attempts, r.gatewayError, r.gatewayState], [[], [], '', 0, '', ''])
    assert.equal(mapRefundRow(null), null)
    assert.deepEqual(mapRefundRows([null, row()]).map((x) => x.id), ['f1'])
  })
  it('reads the admin-only embeds (object or one-element array) and sorts the history newest first', () => {
    const r = mapRefundRow(row({
      method: 'razorpay', gateway_state: 'unknown', gateway_refund_id: 'rfnd_1', gateway_status: 'pending',
      refund_items: [{ id: 'i1', order_item_id: 'oi1', request_item_id: 'ri1', quantity: 2, amount: '944.45' }],
      refund_private: [{ internal_note: 'VIP', initiated_by: 'adm', attempts: 2, gateway_error: 'timeout' }],
      refund_events: [{ id: 'a', event_type: 'created', actor_role: 'admin', created_at: '2026-10-17T10:00:00Z' }, { id: 'b', event_type: 'gateway_unknown', actor_role: 'system', created_at: '2026-10-17T11:00:00Z', note: 'timeout' }],
    }))
    assert.deepEqual([r.gatewayState, r.gatewayRefundId, r.gatewayStatus, r.internalNote, r.attempts, r.gatewayError], ['unknown', 'rfnd_1', 'pending', 'VIP', 2, 'timeout'])
    assert.deepEqual(r.lines, [{ id: 'i1', orderItemId: 'oi1', requestItemId: 'ri1', quantity: 2, amount: 944.45 }])
    assert.deepEqual(r.events.map((e) => e.id), ['b', 'a'])
    assert.equal(mapRefundRow(row({ refund_private: { internal_note: 'x' } })).internalNote, 'x')
  })
  it('the customer columns never name an admin-only field; the admin select does', () => {
    for (const c of ['gateway', 'idempotency', 'internal', 'refund_private', 'payload']) assert.ok(!REFUNDS_COLUMNS_CUSTOMER.includes(c), c)
    assert.ok(REFUNDS_COLUMNS_CUSTOMER.includes('failure_reason') && REFUNDS_COLUMNS_CUSTOMER.includes('completed_at'))
    assert.ok(REFUNDS_SELECT_ADMIN.includes('refund_private') && REFUNDS_SELECT_ADMIN.includes('refund_events') && REFUNDS_SELECT_ADMIN.includes('refund_items'))
  })
})

describe('the calculation table', () => {
  const calc = mapCalculation({
    request_id: 'r2', order_id: 'o1', currency: 'INR', paid_total: 1749, refunded_so_far: 1200, refundable_remaining: 549, paid_for_goods: 1700, shipping_charge: 49,
    seller_fault: true, shipping_eligible: true, shipping_reason: 'Every item of the order is returned for a seller-fault reason',
    lines: [{ order_item_id: 'oi1', request_item_id: 'ri1', title: 'Classic Cotton Shirt', variant_name: null, quantity: 1, ordered: 3, already_refunded_units: 2, paid_share: 1416.67, amount: 472.22 }],
    items_amount: 472.22, shipping_amount: 49, adjustment_amount: 0, amount: 521.22, razorpay_possible: true, payment_method: 'Razorpay',
  })
  it('maps the server answer', () => {
    assert.deepEqual([calc.paidTotal, calc.refundedSoFar, calc.refundableRemaining, calc.paidForGoods, calc.shippingEligible, calc.sellerFault, calc.amount, calc.razorpayPossible],
      [1749, 1200, 549, 1700, true, true, 521.22, true])
    assert.deepEqual([calc.lines[0].title, calc.lines[0].paidShare, calc.lines[0].amount, calc.lines[0].alreadyRefundedUnits], ['Classic Cotton Shirt', 1416.67, 472.22, 2])
    assert.equal(mapCalculation(null), null)
  })
  it('the rows: lines, shipping, (adjustment), total - each with the sentence that explains it', () => {
    const rows = refundBreakdownRows(calc)
    assert.deepEqual(rows.map((r) => r.key), ['oi1', 'shipping', 'total'])
    assert.deepEqual(rows.map((r) => r.amount), [472.22, 49, 521.22])
    assert.equal(rows[0].label, 'Classic Cotton Shirt x1')
    assert.match(rows[0].note, /₹1,416\.67 was paid for the 3 unit\(s\) of this line; 2 already refunded/)
    assert.match(rows[2].note, /₹549\.00 of ₹1,749\.00 can still be refunded/)
    const adj = refundBreakdownRows({ ...calc, adjustmentAmount: -27.78 })
    assert.deepEqual(adj.map((r) => r.key), ['oi1', 'shipping', 'adjustment', 'total'])
    assert.equal(adj[2].label, 'Adjustment (deducted)')
    assert.equal(refundBreakdownRows({ ...calc, adjustmentAmount: 10 })[2].label, 'Adjustment (added)')
    assert.deepEqual(refundBreakdownRows(null), [])
  })
})

describe('the admin side', () => {
  const r = (o) => mapRefundRow(row(o))
  it('buttons follow the state: manual, not sent, in flight, finished', () => {
    assert.deepEqual(refundAdminActions(r({ method: 'manual' })), ['mark_paid', 'mark_failed', 'void'])
    assert.deepEqual(refundAdminActions(r({ method: 'razorpay', gateway_state: 'not_sent' })), ['send', 'void'])
    for (const s of ['submitting', 'submitted', 'unknown']) assert.deepEqual(refundAdminActions(r({ method: 'razorpay', gateway_state: s })), ['check_status'], s)
    assert.deepEqual(refundAdminActions(r({ status: 'succeeded' })), [])
    assert.deepEqual(refundAdminActions(r({ status: 'failed' })), [])
    assert.deepEqual(refundAdminActions(null), [])
  })
  it('gateway state wording', () => {
    assert.equal(gatewayStateLabel('unknown'), 'Razorpay did not confirm - check the status')
    assert.equal(gatewayStateLabel('submitted'), 'Accepted by Razorpay - waiting for it to complete')
    assert.equal(gatewayStateLabel(''), '')
  })
  it('the form: method, adjustment (+ needs a reason), shipping choice', () => {
    const good = validateRefundForm({ method: 'manual', adjustment: '-27.78', adjustmentNote: ' Return courier cost deducted ', note: ' ok ' })
    assert.equal(good.ok, true)
    assert.deepEqual(good.args, { method: 'manual', includeShipping: null, adjustment: -27.78, adjustmentNote: 'Return courier cost deducted', note: 'ok' })
    assert.deepEqual(validateRefundForm({ method: 'razorpay', includeShipping: false }).args, { method: 'razorpay', includeShipping: false, adjustment: 0, adjustmentNote: '', note: '' })
    assert.equal(validateRefundForm({ method: 'razorpay', includeShipping: true }).args.includeShipping, true)
    assert.equal(validateRefundForm({ method: 'cheque' }).errors.method, 'Choose how the refund is paid')
    assert.equal(validateRefundForm({}).ok, false)
    assert.match(validateRefundForm({ method: 'manual', adjustment: 'abc' }).errors.adjustment, /as a number/)
    assert.match(validateRefundForm({ method: 'manual', adjustment: 99999999 }).errors.adjustment, /too large/)
    assert.match(validateRefundForm({ method: 'manual', adjustment: '5' }).errors.adjustmentNote, /Explain the adjustment/)
    assert.equal(validateRefundForm({ method: 'manual', adjustment: '0', adjustmentNote: 'ignored' }).args.adjustmentNote, '')
    assert.match(validateRefundForm({ method: 'manual', adjustment: 5, adjustmentNote: 'x'.repeat(301) }).errors.adjustmentNote, /300/)
    assert.match(validateRefundForm({ method: 'manual', note: 'x'.repeat(1001) }).errors.note, /1000/)
    assert.equal(validateRefundForm({ method: 'manual', adjustment: '12.345', adjustmentNote: 'tip' }).args.adjustment, 12.35)
  })
})