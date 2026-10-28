// Exchange / replacement model shared by the website (customer pages + admin) and the React Native app (customer only).
//
// PURE: no imports, no I/O, no framework. This file exists TWICE and the two copies must stay byte-identical:
//   website  src/features/returns/exchangeModel.js      (tests: src/features/returns/__tests__/exchangeModel.test.mjs)
//   RN app   src/utils/exchangeModel.js                  (the same test file runs against this copy: tools/browser-test/Run-RnParity.ps1)
// It mirrors the database (migration 20261017_07_exchange_fulfilment.sql): the replacement record, the price difference of an exchange
// (none / balance due / refund due) and how it is settled, what the customer is told, which buttons the admin may offer next and the
// arguments of the RPCs. THE DATABASE REMAINS THE AUTHORITY: every amount shown here was calculated by the server (nothing is added up here).

const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0)
const time = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? 0 : t }

/** "₹1,227.78" (Indian digit grouping) */
export function money(amount) {
  const n = Number(amount)
  return `₹${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ───────────── the replacement record ─────────────
export const FULFILMENT_STATUSES = ['pending', 'shipped', 'delivered', 'cancelled']
const FULFILMENT_LABEL = { pending: 'Being prepared', shipped: 'On its way', delivered: 'Delivered', cancelled: 'Cancelled' }
const FULFILMENT_TONE = { pending: 'accent', shipped: 'info', delivered: 'success', cancelled: 'neutral' }
/** @returns {{status:string,label:string,tone:string,final:boolean}} - an unknown status (newer server) degrades to its own name */
export const fulfilmentStatusMeta = (status) => ({
  status, label: FULFILMENT_LABEL[status] || titleCase(status) || 'Unknown', tone: FULFILMENT_TONE[status] || 'neutral', final: status === 'delivered' || status === 'cancelled',
})

/** "Designer Shirt · White x1" */
export const replacementLineText = (l) => (l ? `${l.title || 'Item'}${l.variantName ? ` · ${l.variantName}` : ''} x${num(l.quantity)}` : '')

// ───────────── the price difference ─────────────
export const ADJUSTMENT_KINDS = ['none', 'balance_due', 'refund_due']
export const ADJUSTMENT_STATUSES = ['open', 'collected', 'refunded', 'waived', 'not_needed']

/**
 * What the CUSTOMER reads about the price difference of her exchange. `adj` = a mapped adjustment (mapAdjustmentRow).
 * Nothing is said for an exchange at the same price. A refund that is due is never described as paid until the server says so.
 * @returns {{headline:string, detail:string, tone:string, open:boolean}|null}
 */
export function customerAdjustmentLine(adj) {
  if (!adj || adj.kind === 'none' || adj.status === 'not_needed') return null
  const m = money(adj.amount)
  if (adj.kind === 'balance_due') {
    if (adj.status === 'collected') return { headline: 'Price difference paid', detail: `We received the ${m} difference. Thank you.`, tone: 'success', open: false }
    if (adj.status === 'waived') return { headline: 'Price difference waived', detail: `You do not need to pay the ${m} difference.`, tone: 'success', open: false }
    return { headline: 'Price difference to pay', detail: `The replacement costs ${m} more than the item you return. We will contact you to collect it before we send it.`, tone: 'warning', open: true }
  }
  if (adj.status === 'refunded') return { headline: 'Price difference refunded', detail: `${m} was refunded to you.`, tone: 'success', open: false }
  if (adj.status === 'waived') return { headline: 'No refund due', detail: `No refund is due for the ${m} price difference.`, tone: 'neutral', open: false }
  return { headline: 'Price difference refund', detail: `The replacement costs ${m} less than the item you return. We will refund the difference.`, tone: 'accent', open: true }
}

/** Staff wording for the same row ("Customer owes ₹50.00 - open") */
export function adjustmentAdminLine(adj) {
  if (!adj) return ''
  if (adj.kind === 'none') return 'Same price: nothing to settle'
  const m = money(adj.amount)
  const who = adj.kind === 'balance_due' ? `Customer owes ${m}` : `Customer is owed ${m}`
  return `${who} - ${adj.status === 'open' ? 'not settled yet' : adj.status}`
}

// ───────────── mapping rows ─────────────
/** columns the customer may read (the reservations and the staff notes are admin-only) */
export const REPLACEMENT_COLUMNS_CUSTOMER = '*, replacement_fulfillment_items(*)'
export const ADJUSTMENT_COLUMNS_CUSTOMER = 'request_id, kind, amount, status, refund_id, settled_at, created_at, updated_at'
export const ADJUSTMENT_SELECT_ADMIN = '*, exchange_adjustment_private(reference, internal_note, settled_by)'
export const RESERVATIONS_COLUMNS_ADMIN = 'request_item_id, request_id, product_id, variant_id, quantity, unit_price, stock_moved, status, release_reason, reserved_at, released_at, fulfilled_at'

export function mapFulfilmentRow(row) {
  if (!row) return null
  return {
    id: row.id,
    requestId: row.request_id,
    orderId: row.order_id,
    status: row.status,
    shipmentId: row.shipment_id || null,
    shippedAt: row.shipped_at || null,
    deliveredAt: row.delivered_at || null,
    cancelledAt: row.cancelled_at || null,
    createdAt: row.created_at || null,
    lines: (row.replacement_fulfillment_items || []).map((i) => ({
      id: i.id, requestItemId: i.request_item_id, orderItemId: i.order_item_id, productId: i.product_id, variantId: i.variant_id || '',
      title: i.title || 'Item', variantName: i.variant_name || '', sku: i.sku || '', image: i.image || '', quantity: num(i.quantity),
      originalUnitPrice: num(i.original_unit_price), replacementUnitPrice: num(i.replacement_unit_price), priceDifference: num(i.price_difference),
    })),
  }
}
export const mapFulfilmentRows = (rows) => (rows || []).map(mapFulfilmentRow).filter(Boolean)

export function mapAdjustmentRow(row) {
  if (!row) return null
  const priv = Array.isArray(row.exchange_adjustment_private) ? row.exchange_adjustment_private[0] : row.exchange_adjustment_private
  return {
    requestId: row.request_id,
    kind: row.kind,
    amount: num(row.amount),
    status: row.status,
    refundId: row.refund_id || null,
    settledAt: row.settled_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    // admin only (the customer's select never asks for these)
    reference: (priv && priv.reference) || '',
    internalNote: (priv && priv.internal_note) || '',
  }
}
export const mapAdjustmentRows = (rows) => (rows || []).map(mapAdjustmentRow).filter(Boolean)

export const mapReservationRow = (r) => (r ? {
  requestItemId: r.request_item_id, requestId: r.request_id, productId: r.product_id, variantId: r.variant_id || '', quantity: num(r.quantity), unitPrice: num(r.unit_price),
  stockMoved: r.stock_moved !== false, status: r.status, releaseReason: r.release_reason || '', reservedAt: r.reserved_at || null, releasedAt: r.released_at || null, fulfilledAt: r.fulfilled_at || null,
} : null)
export const mapReservationRows = (rows) => (rows || []).map(mapReservationRow).filter(Boolean)

/** Staff wording of a reservation's state */
const RESERVATION_LABEL = { reserved: 'Stock reserved', released: 'Stock released', fulfilled: 'Shipped' }
export const reservationLabel = (r) => (r ? `${RESERVATION_LABEL[r.status] || titleCase(r.status)}${r.status !== 'released' && r.stockMoved === false ? ' (stock not tracked)' : ''}` : 'No stock held')

/**
 * Everything the customer's request card needs about the replacements of her requests, by request id:
 *   { [requestId]: { fulfilment, adjustment, shipment } }
 * `shipment` = the live (not cancelled) replacement parcel, the newest one.
 * @param fulfilments mapped fulfilments; adjustments mapped adjustments; shipments mapped shipments (direction 'replacement')
 */
export function buildReplacementMap(fulfilments, adjustments, shipments) {
  const out = {}
  const slot = (id) => out[id] || (out[id] = { fulfilment: null, adjustment: null, shipment: null })
  for (const f of fulfilments || []) if (f && f.requestId) slot(f.requestId).fulfilment = f
  for (const a of adjustments || []) if (a && a.requestId) slot(a.requestId).adjustment = a
  const live = (shipments || []).filter((s) => s && s.requestId && s.status !== 'cancelled').slice().sort((a, b) => time(a.createdAt) - time(b.createdAt))
  for (const s of live) slot(s.requestId).shipment = s          // a later one replaces an earlier one: the newest wins
  return out
}

// ───────────── what the customer sees ─────────────
/**
 * The "Your replacement" block of the customer's request card, or null when there is nothing to show yet (the exchange was not accepted
 * for replacement, or it was cancelled before a replacement existed).
 * @param request a mapped request; bundle = buildReplacementMap(...)[request.id]
 */
export function customerReplacement(request, bundle) {
  const f = bundle && bundle.fulfilment
  if (!request || request.type !== 'exchange' || !f || f.status === 'cancelled') return null
  const meta = fulfilmentStatusMeta(f.status)
  const s = bundle.shipment || null
  const headline = f.status === 'delivered' ? 'Your replacement was delivered' : f.status === 'shipped' ? 'Your replacement is on its way' : 'Your replacement is being prepared'
  const tracking = s ? { courier: s.courierName || 'Courier', number: s.trackingNumber || '', url: s.trackingUrl || '', status: s.status } : null
  return {
    status: meta,
    headline,
    lines: (f.lines || []).map((l) => ({ id: l.id, text: replacementLineText(l) })),
    tracking,
    adjustment: customerAdjustmentLine(bundle.adjustment),
  }
}

// ───────────── the admin's next steps ─────────────
/**
 * What the admin may do with the replacement of ONE exchange (the server re-checks every one of them).
 * @param request mapped request; bundle { fulfilment, adjustment }; refunds = mapped refunds of the request
 */
export function replacementAdminState(request, bundle, refunds = []) {
  const f = bundle && bundle.fulfilment
  const a = bundle && bundle.adjustment
  const refundActive = (refunds || []).some((r) => r && r.kind === 'exchange_difference' && r.status !== 'failed')
  const open = !!a && a.status === 'open'
  const owes = open && a.kind === 'balance_due'
  const due = open && a.kind === 'refund_due'
  const pending = !!request && request.type === 'exchange' && request.status === 'replacement_pending' && !!f && f.status === 'pending'
  return {
    hasRecord: !!f,
    canShip: pending && !owes,
    shipBlocked: pending && owes ? `Collect or waive the price difference of ${money(a.amount)} before the replacement ships` : '',
    canMarkDelivered: !!request && request.type === 'exchange' && request.status === 'replacement_shipped',
    canCollect: owes,
    canWaive: open && !refundActive,
    canRefund: due && !refundActive,
    refundActive,
    waitingToClose: !!request && request.status === 'replacement_delivered' && open,
  }
}
/** the state above as a list of button keys, in the order the panel shows them */
export function replacementAdminActions(state) {
  if (!state) return []
  const a = []
  if (state.canShip) a.push('ship')
  if (state.canMarkDelivered) a.push('mark_delivered')
  if (state.canCollect) a.push('collect')
  if (state.canRefund) a.push('refund')
  if (state.canWaive) a.push('waive')
  return a
}

// ───────────── forms ─────────────
/**
 * "Collected" (needs the payment reference) / "Waived" (needs a reason) for a price difference the customer owes (or a waiver of one owed to them).
 * @returns {{ok:boolean, errors:Object, args:{resolution:string, reference:string, note:string}}}
 */
export function validateSettleForm(f) {
  const x = f || {}
  const errors = {}
  const resolution = x.resolution
  const reference = String(x.reference || '').trim()
  const note = String(x.note || '').trim()
  if (resolution !== 'collected' && resolution !== 'waived') errors.resolution = 'Choose collected or waived'
  if (resolution === 'collected' && !reference) errors.reference = 'Enter the payment reference (how and when the customer paid)'
  if (reference.length > 200) errors.reference = 'At most 200 characters'
  if (resolution === 'waived' && !note) errors.note = 'Say why the difference is waived'
  if (note.length > 1000) errors.note = 'At most 1000 characters'
  return { ok: Object.keys(errors).length === 0, errors, args: { resolution, reference: resolution === 'collected' ? reference : '', note } }
}

/** "Refund the difference": how it is paid back (the same two ways as any refund) */
export function validateExchangeRefundForm(f) {
  const x = f || {}
  const errors = {}
  if (x.method !== 'razorpay' && x.method !== 'manual') errors.method = 'Choose how the refund is paid'
  const note = String(x.note || '').trim()
  if (note.length > 1000) errors.note = 'At most 1000 characters'
  return { ok: Object.keys(errors).length === 0, errors, args: { method: x.method, note } }
}

/**
 * The RPC arguments of ship_replacement() from the shipping form's payload (shipmentModel.validateShipForm builds that payload with the
 * order's parameter names; the replacement takes the same fields except the order and the items).
 */
export function shipReplacementArgs(requestId, payload) {
  const p = payload || {}
  return {
    p_request_id: requestId,
    p_courier_code: p.p_courier_code || 'manual',
    p_courier_name: p.p_courier_name || null,
    p_tracking_number: p.p_tracking_number || null,
    p_tracking_url: p.p_tracking_url || null,
    p_shipped_at: p.p_shipped_at || null,
    p_charges: p.p_charges == null ? null : p.p_charges,
    p_note: p.p_note || null,
    p_expected_delivery_date: p.p_expected_delivery_date || null,
  }
}