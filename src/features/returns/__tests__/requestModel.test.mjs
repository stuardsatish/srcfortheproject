// node --test src/features/returns/__tests__/requestModel.test.mjs   (npm run test:unit)
// Also run against the RN copy of the module (src/utils/requestModel.js) by tools/browser-test/Run-RnParity.ps1.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  REQUEST_STATUSES, FINAL_STATUSES, requestStatusMeta, requestTypeLabel, adminStatusLabel, itemStatusLabel, ELIGIBILITY_CODES, eligibilityMessage,
  formatDeadline, describeEligibility, anyEligible, reasonOptions, EVIDENCE_MIME, EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES, evidenceFileError, evidencePath,
  validateRequestForm, mapRequestRow, mapRequestRows, mapRequestItem, canCustomerCancel, canCustomerRespond, canSubmitReturnTracking, adminActions,
  requestProgress, requestSummaryLine, REQUESTS_SELECT_CUSTOMER, REQUESTS_SELECT_ADMIN, REQUESTS_COLUMNS_CUSTOMER, REQUEST_ITEM_COLUMNS_CUSTOMER, effectivePrice, replacementOptions, defaultReplacement,
} from '../requestModel.js'

const REASONS = [
  { code: 'damaged', label: 'Damaged product', applies_to: ['return', 'exchange'], requires_evidence: true, requires_description: false, active: true, sort_order: 10 },
  { code: 'incorrect_size', label: 'Incorrect size', applies_to: ['return', 'exchange'], requires_evidence: false, requires_description: false, active: true, sort_order: 50 },
  { code: 'missing_item', label: 'Missing item', applies_to: ['return'], requires_evidence: false, requires_description: true, active: true, sort_order: 30 },
  { code: 'old_reason', label: 'Old', applies_to: ['return', 'exchange'], active: false, sort_order: 1 },
]
const ok = (o = {}) => ({ eligible: true, reasons: [], window_days: 7, deadline: '2026-10-17T18:29:59.999Z', remaining_qty: 2, active_request_id: null, ...o })
const no = (reasons, o = {}) => ({ eligible: false, reasons, window_days: 7, deadline: '2026-10-17T18:29:59.999Z', remaining_qty: 0, active_request_id: null, ...o })
const ELIG = {
  order_id: 'o1', order_status: 'delivered',
  items: [
    { order_item_id: 'i1', title: 'Shirt', return: ok(), exchange: ok() },
    { order_item_id: 'i2', title: 'Mug', return: no(['POLICY_DISABLED']), exchange: ok({ remaining_qty: 1 }) },
    { order_item_id: 'i3', title: 'Cap', return: no(['WINDOW_EXPIRED']), exchange: no(['WINDOW_EXPIRED']) },
  ],
}
const CTX = { orderId: 'o1', requestId: 'req-1', eligibility: ELIG, reasons: REASONS }

describe('statuses', () => {
  it('every database status has a customer label and a tone; final ones are flagged', () => {
    for (const s of REQUEST_STATUSES) { const m = requestStatusMeta(s); assert.ok(m.label && m.tone, s); assert.equal(m.final, FINAL_STATUSES.includes(s)) }
    assert.equal(requestStatusMeta('pending_review').label, 'Pending admin review')
    assert.equal(requestStatusMeta('refund_pending').label, 'Refund processing')
    assert.equal(requestStatusMeta('refunded').label, 'Refund completed')
    assert.deepEqual(FINAL_STATUSES.slice().sort(), ['cancelled', 'closed', 'rejected'])
  })
  it('an unknown status (newer server) degrades gracefully', () => {
    assert.deepEqual([requestStatusMeta('weird_state').label, requestStatusMeta('weird_state').tone, requestStatusMeta('weird_state').final], ['Weird state', 'neutral', false])
    assert.equal(requestStatusMeta(undefined).label, 'Unknown')
  })
  it('labels', () => {
    assert.deepEqual([requestTypeLabel('exchange'), requestTypeLabel('return'), requestTypeLabel('x')], ['Exchange', 'Return', 'Return'])
    assert.equal(adminStatusLabel('awaiting_return_shipment'), 'Awaiting return shipment')
    assert.deepEqual(['pending', 'passed', 'failed', 'mystery'].map(itemStatusLabel), ['Waiting for review', 'Accepted', 'Not accepted', 'Mystery'])
  })
})

describe('eligibility text', () => {
  it('has a sentence for every server reason code', () => {
    for (const c of ELIGIBILITY_CODES) assert.ok(eligibilityMessage(c) && eligibilityMessage(c) !== 'Not available' || c === 'POLICY_DISABLED', c)
    assert.equal(eligibilityMessage('SOMETHING_NEW'), 'Not available')
  })
  it('formats the deadline as an IST day', () => {
    assert.equal(formatDeadline('2026-10-17T18:29:59.999Z'), '17 Oct 2026')        // 23:59:59.999 IST
    assert.equal(formatDeadline('2026-10-17T18:30:00.000Z'), '18 Oct 2026')
    assert.equal(formatDeadline(''), '')
    assert.equal(formatDeadline('nope'), '')
  })
  it('an eligible line says what and until when', () => {
    const d = describeEligibility(ok(), 'return')
    assert.deepEqual([d.eligible, d.label, d.hint, d.remaining], [true, 'Return', 'Until 17 Oct 2026', 2])
    assert.equal(describeEligibility(ok(), 'exchange').label, 'Exchange')
  })
  it('an ineligible line gives the most useful single reason', () => {
    assert.equal(describeEligibility(no(['WINDOW_EXPIRED']), 'return').hint, 'The return period ended on 17 Oct 2026')
    assert.equal(describeEligibility(no(['WINDOW_EXPIRED']), 'exchange').hint, 'The exchange period ended on 17 Oct 2026')
    assert.equal(describeEligibility(no(['POLICY_DISABLED']), 'return').hint, 'Not available for this item')
    assert.equal(describeEligibility(no(['NO_REMAINING_QTY', 'ACTIVE_REQUEST']), 'return').hint, 'A request for this item is in progress')
    assert.equal(describeEligibility(no(['NOT_DELIVERED', 'POLICY_DISABLED']), 'return').hint, 'Available after the order is delivered')
    assert.equal(describeEligibility(no(['NEW_CODE']), 'return').hint, 'Not available')
    const d = describeEligibility(no(['POLICY_DISABLED']), 'return')
    assert.deepEqual([d.eligible, d.label], [false, 'Return unavailable'])
  })
  it('missing data never throws', () => {
    assert.equal(describeEligibility(null, 'return').eligible, false)
    assert.equal(describeEligibility({ eligible: false }, 'return').hint, 'Not available')
  })
  it('anyEligible tells whether to show the section at all', () => {
    assert.equal(anyEligible(ELIG, 'return'), true)
    assert.equal(anyEligible({ items: [{ return: no(['POLICY_DISABLED']), exchange: no(['POLICY_DISABLED']) }] }, 'exchange'), false)
    assert.equal(anyEligible(null, 'return'), false)
  })
})

describe('exchange replacement options', () => {
  const NOW = Date.parse('2026-10-17T10:00:00Z')
  const shirt = { id: 'p1', title: 'Designer Shirt', price: 500, discount: 10, discount_expiry: '2026-12-01T00:00:00Z', has_variants: true, main_option_enabled: true, stock: 4, track_inventory: true, status: 'active' }
  const variants = [
    { id: 'var_pink', name: 'Pink', price: 300, stock: 0, track_inventory: true, status: 'active' },
    { id: 'var_white', name: 'White', price: 200, stock: 5, track_inventory: true, status: 'active' },
    { id: 'var_old', name: 'Old', price: 100, stock: 9, track_inventory: true, status: 'inactive' },
    { id: 'var_free', name: 'Made to order', price: 250, stock: 0, track_inventory: false, status: 'active' },
  ]
  it('the effective price follows the discount and its expiry (like the database function)', () => {
    assert.equal(effectivePrice(500, 10, '2026-12-01T00:00:00Z', NOW), 450)
    assert.equal(effectivePrice(500, 10, '2026-01-01T00:00:00Z', NOW), 500)            // expired
    assert.equal(effectivePrice(500, 10, null, NOW), 450)
    assert.equal(effectivePrice(500, 0, null, NOW), 500)
    assert.equal(effectivePrice('99.995', 0, null, NOW), 100)
    assert.equal(effectivePrice(undefined, undefined, undefined, NOW), 0)
  })
  it('main option + active variants of the SAME product, with stock and the price difference to what was bought', () => {
    const o = replacementOptions(shirt, variants, { variantId: 'var_pink', unitPrice: 300 }, NOW)
    assert.deepEqual(o.map((x) => x.variantId), ['', 'var_pink', 'var_white', 'var_free'])
    assert.deepEqual(o.map((x) => x.inStock), [true, false, true, true])
    assert.deepEqual(o.map((x) => x.difference), [150, 0, -100, -50])
    assert.deepEqual(o.map((x) => x.isSame), [false, true, false, false])
    assert.equal(o[0].label, 'Main option')
  })
  it('a single product offers itself again (the replacement of a defective unit); a switched-off main option is not offered', () => {
    const mug = { id: 'p2', title: 'Mug', price: 150, discount: 0, has_variants: false, main_option_enabled: true, stock: 3, track_inventory: true, status: 'active' }
    const o = replacementOptions(mug, [], { variantId: '', unitPrice: 150 }, NOW)
    assert.deepEqual([o.length, o[0].label, o[0].isSame, o[0].difference], [1, 'Mug', true, 0])
    const noMain = replacementOptions({ ...shirt, main_option_enabled: false }, variants, { variantId: 'var_white', unitPrice: 200 }, NOW)
    assert.ok(!noMain.some((x) => x.variantId === ''))
  })
  it('nothing for a missing or draft product', () => {
    assert.deepEqual(replacementOptions(null, variants, { variantId: '', unitPrice: 1 }), [])
    assert.deepEqual(replacementOptions({ ...shirt, status: 'draft' }, variants, { variantId: '', unitPrice: 1 }), [])
  })
  it('the default is the same option when it is in stock, else the first one that is', () => {
    const base = replacementOptions(shirt, variants, { variantId: 'var_white', unitPrice: 200 }, NOW)
    assert.equal(defaultReplacement(base), 'var_white')
    const pinkOut = replacementOptions(shirt, variants, { variantId: 'var_pink', unitPrice: 300 }, NOW)
    assert.equal(defaultReplacement(pinkOut), '')                      // the main option comes first and is in stock
    assert.equal(defaultReplacement([{ variantId: 'a', inStock: false, isSame: true }]), null)
    assert.equal(defaultReplacement([]), null)
    assert.equal(defaultReplacement(undefined), null)
  })
})

describe('reasons and evidence', () => {
  it('reasonOptions: active, for the type, in the admin order', () => {
    assert.deepEqual(reasonOptions(REASONS, 'return').map((r) => r.code), ['damaged', 'missing_item', 'incorrect_size'])
    assert.deepEqual(reasonOptions(REASONS, 'exchange').map((r) => r.code), ['damaged', 'incorrect_size'])
    assert.deepEqual(reasonOptions(undefined, 'return'), [])
  })
  it('accepts only JPEG / PNG / WebP up to 5 MB', () => {
    assert.deepEqual(EVIDENCE_MIME, ['image/jpeg', 'image/png', 'image/webp'])
    assert.equal(EVIDENCE_MAX_BYTES, 5242880)
    assert.equal(evidenceFileError({ type: 'image/png', size: 1000 }), '')
    assert.match(evidenceFileError({ type: 'application/pdf', size: 1000 }), /JPEG, PNG or WebP/)
    assert.match(evidenceFileError({ type: 'image/jpeg', size: EVIDENCE_MAX_BYTES + 1 }), /5 MB/)
    assert.match(evidenceFileError({ type: 'image/jpeg', size: 0 }), /empty/)
    assert.equal(evidenceFileError({ type: 'image/jpeg', size: EVIDENCE_MAX_BYTES }), '')
    assert.equal(evidenceFileError(null), 'No file')
  })
  it('builds the storage path the policy and the RPC demand', () => {
    assert.equal(evidencePath('uid-1', 'req-1', 0, { name: 'My Photo (1).JPG', type: 'image/jpeg' }), 'uid-1/req-1/1-My-Photo-1.jpg')
    assert.equal(evidencePath('uid-1', 'req-1', 2, { name: '../../etc/passwd', type: 'image/png' }), 'uid-1/req-1/3-passwd.png')       // only the last path segment is used
    assert.equal(evidencePath('uid-1', 'req-1', 0, { name: 'C:\\Users\\me\\IMG 001.png', type: 'image/png' }), 'uid-1/req-1/1-IMG-001.png')
    assert.equal(evidencePath('u', 'r', 0, { name: '', type: 'image/webp' }), 'u/r/1-photo.webp')
    assert.match(evidencePath('u', 'r', 0, { name: 'x'.repeat(300) + '.jpg', type: 'image/jpeg' }), /^u\/r\/1-x{60}\.jpg$/)
    // exactly what the RPC accepts: <uid>/<request>/<[A-Za-z0-9._-]{1,120}>
    assert.match(evidencePath('u', 'r', 0, { name: 'a b&c.jpg', type: 'image/jpeg' }), /^u\/r\/[A-Za-z0-9._-]{1,120}$/)
    assert.equal(EVIDENCE_MAX_FILES, 6)
  })
})

describe('validateRequestForm', () => {
  const line = (id, q, o = {}) => ({ orderItemId: id, quantity: q, selected: true, ...o })
  const good = (o = {}) => validateRequestForm({ type: 'return', reasonCode: 'incorrect_size', lines: [line('i1', 1)], ...o }, CTX)

  it('a valid return builds the RPC arguments', () => {
    const r = good({ description: ' too small ', contactPhone: ' +91 98765 43210 ' })
    assert.equal(r.ok, true)
    assert.deepEqual(r.payload, {
      p_request_id: 'req-1', p_order_id: 'o1', p_type: 'return', p_items: [{ order_item_id: 'i1', quantity: 1 }], p_reason_code: 'incorrect_size',
      p_description: 'too small', p_contact_phone: '+91 98765 43210', p_evidence: [],
    })
  })
  it('only the ticked lines, with their quantities', () => {
    const r = good({ lines: [line('i1', 2), { orderItemId: 'i2', quantity: 1, selected: false }] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.payload.p_items, [{ order_item_id: 'i1', quantity: 2 }])
  })
  it('needs at least one line, and every line must still be eligible and within what is left', () => {
    assert.match(good({ lines: [] }).errors.items, /at least one item/)
    assert.match(good({ lines: [{ orderItemId: 'i1', quantity: 1, selected: false }] }).errors.items, /at least one item/)
    assert.match(good({ lines: [line('i2', 1)] }).errors.items, /cannot be requested any more/)         // returns off for the Mug
    assert.match(good({ lines: [line('i3', 1)] }).errors.items, /cannot be requested any more/)
    assert.match(good({ lines: [line('i9', 1)] }).errors.items, /cannot be requested any more/)         // not part of the order
    assert.match(good({ lines: [line('i1', 3)] }).errors.items, /Only 2 unit/)
    assert.match(good({ lines: [line('i1', 0)] }).errors.items, /whole numbers/)
    assert.match(good({ lines: [line('i1', 1.5)] }).errors.items, /whole numbers/)
  })
  it('the same line can be exchanged where it cannot be returned', () => {
    const r = validateRequestForm({ type: 'exchange', reasonCode: 'incorrect_size', lines: [line('i2', 1, { replacementVariantId: 'var_x' })] }, CTX)
    assert.equal(r.ok, true)
    assert.deepEqual(r.payload.p_items, [{ order_item_id: 'i2', quantity: 1, replacement_variant_id: 'var_x' }])
    assert.equal(r.payload.p_type, 'exchange')
  })
  it('an exchange must say what it wants instead ("" = the main option is a valid choice)', () => {
    assert.match(validateRequestForm({ type: 'exchange', reasonCode: 'incorrect_size', lines: [line('i1', 1)] }, CTX).errors.replacement, /instead/)
    assert.equal(validateRequestForm({ type: 'exchange', reasonCode: 'incorrect_size', lines: [line('i1', 1, { replacementVariantId: '' })] }, CTX).ok, true)
  })
  it('the reason is required and must come from the list', () => {
    assert.equal(good({ reasonCode: '' }).errors.reasonCode, 'Choose a reason')
    assert.equal(good({ reasonCode: 'made_up' }).errors.reasonCode, 'Choose a reason from the list')
  })
  it('a reason can require a description or a photo', () => {
    assert.match(good({ reasonCode: 'missing_item' }).errors.description, /describe/)
    assert.equal(good({ reasonCode: 'missing_item', description: 'the charger was missing' }).ok, true)
    assert.match(good({ reasonCode: 'damaged' }).errors.photos, /at least one photo/)
    const withPhoto = validateRequestForm({ type: 'return', reasonCode: 'damaged', lines: [line('i1', 1)], description: 'cracked' },
      { ...CTX, uploaded: [{ path: 'u/req-1/1-a.jpg', mime: 'image/jpeg', size: 1000 }] })
    assert.equal(withPhoto.ok, true)
    assert.deepEqual(withPhoto.payload.p_evidence, [{ path: 'u/req-1/1-a.jpg', mime: 'image/jpeg', size: 1000 }])
  })
  it('photos: type, size and count', () => {
    assert.match(good({ photos: [{ type: 'application/pdf', size: 10 }] }).errors.photos, /JPEG, PNG or WebP/)
    assert.match(good({ photos: [{ type: 'image/jpeg', size: EVIDENCE_MAX_BYTES + 1 }] }).errors.photos, /5 MB/)
    assert.match(good({ photos: Array.from({ length: 7 }, () => ({ type: 'image/jpeg', size: 10 })) }).errors.photos, /At most 6/)
    assert.equal(good({ photos: [{ type: 'image/jpeg', size: 10 }] }).ok, true)
  })
  it('description length and phone format', () => {
    assert.match(good({ description: 'x'.repeat(2001) }).errors.description, /2000/)
    assert.match(good({ contactPhone: 'call me' }).errors.contactPhone, /valid phone/)
    assert.equal(good({ contactPhone: '98765-43210' }).ok, true)
  })
})

describe('mapRequestRow', () => {
  const row = {
    id: 'r1', request_no: 'RET-2026-000001', order_id: 'o1', user_id: 'u1', type: 'return', status: 'approved', reason_code: 'damaged', description: 'cracked', contact_phone: '98765',
    delivered_at: '2026-10-10T04:30:00Z', customer_note: 'Please keep the box', return_method: 'courier_pickup', return_instructions: 'A courier will call',
    decided_at: '2026-10-11T00:00:00Z', received_at: null, closed_at: null, created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-11T00:00:00Z',
    return_request_items: [{ id: 'ri1', order_item_id: 'i1', quantity: 1, unit_price: '500', item_status: 'approved', decision_note: null, price_difference: '-100.00', replacement_variant_id: '',
      policy_deadline: '2026-10-17T18:29:59.999Z', order_items: { title: 'Shirt [Pink]', product_title: 'Shirt', variant_name: 'Pink', image: 'p.jpg', quantity: 3 } }],
    return_request_evidence: [{ id: 'e1', storage_path: 'u1/r1/1-a.jpg', mime: 'image/jpeg', size_bytes: 1234, created_at: '2026-10-10T10:00:00Z' }],
    return_request_events: [
      { id: 'a', to_status: 'pending_review', actor_role: 'customer', created_at: '2026-10-10T10:00:00Z' },
      { id: 'b', from_status: 'pending_review', to_status: 'approved', actor_role: 'admin', note: 'ok', created_at: '2026-10-11T00:00:00Z' },
    ],
  }
  it('maps the request, its lines (with the order line embed), photos and a newest-first history', () => {
    const r = mapRequestRow(row)
    assert.deepEqual([r.requestNo, r.type, r.status, r.reasonCode, r.returnMethod, r.customerNote], ['RET-2026-000001', 'return', 'approved', 'damaged', 'courier_pickup', 'Please keep the box'])
    assert.deepEqual([r.items[0].title, r.items[0].variantName, r.items[0].quantity, r.items[0].orderedQuantity, r.items[0].unitPrice, r.items[0].priceDifference], ['Shirt', 'Pink', 1, 3, 500, -100])
    assert.deepEqual(r.evidence, [{ id: 'e1', path: 'u1/r1/1-a.jpg', mime: 'image/jpeg', size: 1234, createdAt: '2026-10-10T10:00:00Z' }])
    assert.deepEqual(r.events.map((e) => e.id), ['b', 'a'])
    assert.equal(r.internalNote, '')
    assert.equal(r.order, null)
  })
  it('reads the admin-only embeds when present (object or one-element array)', () => {
    const r = mapRequestRow({ ...row, return_request_private: [{ internal_note: 'VIP', decided_by: 'adm' }], orders: { id: 'o1', customer_name: 'Alice', payment_method: 'Razorpay', total: '999' } })
    assert.deepEqual([r.internalNote, r.decidedBy, r.order.customerName, r.order.paymentMethod, r.order.total], ['VIP', 'adm', 'Alice', 'Razorpay', 999])
    assert.equal(mapRequestRow({ ...row, return_request_private: { internal_note: 'x' } }).internalNote, 'x')
  })
  it('null in, null out; tolerates missing embeds and an unknown line shape', () => {
    assert.equal(mapRequestRow(null), null)
    assert.deepEqual(mapRequestRows([null, row]).map((x) => x.id), ['r1'])
    const bare = mapRequestRow({ id: 'r2', request_no: 'X', order_id: 'o', type: 'exchange', status: 'pending_review', reason_code: 'other' })
    assert.deepEqual([bare.items, bare.evidence, bare.events], [[], [], []])
    assert.equal(mapRequestItem({ id: 'z', order_item_id: 'i', quantity: 1, unit_price: 1, item_status: 'pending' }).title, 'Item')
  })
  it('the select strings never ask the customer for admin-only tables', () => {
    assert.ok(!REQUESTS_SELECT_CUSTOMER.includes('return_request_private') && !REQUESTS_SELECT_CUSTOMER.includes('orders('))
    assert.ok(REQUESTS_SELECT_ADMIN.includes('return_request_private') && REQUESTS_SELECT_ADMIN.includes('orders('))
  })
  it('the customer lists the columns of a line one by one: the staff-only stock handling (disposition / stock_effect) is never asked for; the admin takes the whole row', () => {
    assert.ok(!/\*, return_request_items\(\*/.test(REQUESTS_COLUMNS_CUSTOMER))
    assert.ok(!REQUESTS_COLUMNS_CUSTOMER.includes('disposition') && !REQUESTS_COLUMNS_CUSTOMER.includes('stock_effect'))
    for (const c of ['item_status', 'decision_note', 'inspection_note', 'replacement_variant_id', 'price_difference', 'policy_deadline']) assert.ok(REQUEST_ITEM_COLUMNS_CUSTOMER.includes(c), c)
    assert.ok(REQUESTS_SELECT_ADMIN.includes('return_request_items(*'))
    const i = mapRequestItem({ id: 'z', order_item_id: 'i', quantity: 1, unit_price: 1, item_status: 'passed', disposition: 'unsellable', stock_effect: 'unsellable' })
    assert.deepEqual([i.disposition, i.stockEffect], ['unsellable', 'unsellable'])
    const c = mapRequestItem({ id: 'z', order_item_id: 'i', quantity: 1, unit_price: 1, item_status: 'passed' })
    assert.deepEqual([c.disposition, c.stockEffect], ['', ''])
  })
})

describe('what each side may do', () => {
  const req = (status, o = {}) => ({ type: 'return', status, returnMethod: '', ...o })
  it('customer actions', () => {
    assert.deepEqual(['pending_review', 'needs_info', 'approved', 'awaiting_return_shipment', 'return_in_transit', 'inspection_pending', 'refunded', 'cancelled'].map((s) => canCustomerCancel(req(s))),
      [true, true, true, true, false, false, false, false])
    assert.deepEqual([canCustomerRespond(req('needs_info')), canCustomerRespond(req('pending_review')), canCustomerRespond(null)], [true, false, false])
    assert.equal(canSubmitReturnTracking(req('awaiting_return_shipment', { returnMethod: 'customer_arranged' })), true)
    assert.equal(canSubmitReturnTracking(req('awaiting_return_shipment', { returnMethod: 'courier_pickup' })), false)
    assert.equal(canSubmitReturnTracking(req('approved', { returnMethod: 'customer_arranged' })), false)
  })
  it('admin actions follow the state machine', () => {
    assert.deepEqual(adminActions(req('pending_review')), ['decide', 'needs_info', 'cancel', 'message', 'note'])
    assert.deepEqual(adminActions(req('needs_info')), ['decide', 'back_to_review', 'cancel', 'message', 'note'])
    assert.deepEqual(adminActions(req('approved')), ['logistics', 'cancel', 'message', 'note'])
    assert.deepEqual(adminActions(req('awaiting_return_shipment')), ['logistics', 'in_transit', 'received', 'cancel', 'message', 'note'])
    assert.deepEqual(adminActions(req('return_in_transit')), ['received', 'cancel', 'message', 'note'])
    assert.deepEqual(adminActions(req('inspection_pending')), ['inspect', 'message', 'note'])
    assert.deepEqual(adminActions(req('inspection_passed')), ['refund', 'message', 'note'])
    assert.deepEqual(adminActions(req('refund_pending')), ['refund', 'message', 'note'])                    // retry after a failed refund / check a pending one
    assert.deepEqual(adminActions(req('refund_pending', { type: 'exchange' })), ['message', 'note'])
    assert.deepEqual(adminActions(req('inspection_passed', { type: 'exchange' })), ['replacement_pending', 'message', 'note'])
    // the replacement steps (Phase 10): the panel ships / settles / delivers; an admin can still give up before it ships
    assert.deepEqual(adminActions(req('replacement_pending', { type: 'exchange' })), ['replacement', 'cancel', 'message', 'note'])
    assert.deepEqual(adminActions(req('replacement_shipped', { type: 'exchange' })), ['replacement', 'message', 'note'])
    assert.deepEqual(adminActions(req('replacement_delivered', { type: 'exchange' })), ['replacement', 'close', 'message', 'note'])
    assert.deepEqual(adminActions(req('inspection_failed')), ['close', 'message', 'note'])
    assert.deepEqual(adminActions(req('refunded')), ['close', 'message', 'note'])
    for (const s of FINAL_STATUSES) assert.deepEqual(adminActions(req(s)), [])
    assert.deepEqual(adminActions(null), [])
  })
})

describe('progress and summary', () => {
  const steps = (status, o = {}) => requestProgress({ type: 'return', status, ...o })
  const done = (s) => s.filter((x) => x.done).map((x) => x.key)
  it('a return: submitted, approved, received, checked, refund', () => {
    assert.deepEqual(steps('pending_review').map((s) => s.key), ['submitted', 'approved', 'received', 'checked', 'refund'])
    assert.deepEqual(done(steps('pending_review')), [])
    assert.equal(steps('pending_review').find((s) => s.current).key, 'submitted')
    assert.deepEqual(done(steps('approved')), ['submitted'])
    assert.equal(steps('awaiting_return_shipment').find((s) => s.current).key, 'approved')
    assert.deepEqual(done(steps('inspection_pending')), ['submitted', 'approved'])
    assert.deepEqual(done(steps('refund_pending')), ['submitted', 'approved', 'received', 'checked'])
    assert.deepEqual(done(steps('refunded')), ['submitted', 'approved', 'received', 'checked', 'refund'])
  })
  it('an exchange ends with the replacement', () => {
    assert.equal(requestProgress({ type: 'exchange', status: 'approved' }).at(-1).key, 'replacement')
  })
  it('a rejected / cancelled / failed request shows where it stopped', () => {
    assert.equal(steps('rejected').find((s) => s.stopped).key, 'submitted')
    assert.equal(steps('inspection_failed').find((s) => s.stopped).key, 'checked')
    assert.equal(steps('refund_pending').some((s) => s.stopped), false)
  })
  it('summary line', () => {
    assert.equal(requestSummaryLine({ type: 'exchange', status: 'replacement_shipped' }), 'Exchange · Replacement on its way')
    assert.equal(requestSummaryLine({ type: 'return', status: 'refunded' }), 'Return · Refund completed')
    assert.equal(requestSummaryLine(null), '')
    assert.equal(requestProgress(null).length, 0)
  })
})