// Refund model shared by the website (customer pages + admin) and the React Native app (customer only).
//
// PURE: no imports, no I/O, no framework. This file exists TWICE and the two copies must stay byte-identical:
//   website  src/features/returns/refundModel.js      (tests: src/features/returns/__tests__/refundModel.test.mjs)
//   RN app   src/utils/refundModel.js                  (the same test file runs against this copy: tools/browser-test/Run-RnParity.ps1)
// It mirrors the database (migration 20261017_06_refunds.sql): the three refund states, what the customer is told in each, which
// buttons the admin may offer next, and the arguments of the RPCs. THE DATABASE REMAINS THE AUTHORITY for every amount and every state:
// nothing here calculates a refund - the server's refund_calculate() answer is only displayed.

// ───────────── states, wording ─────────────
export const REFUND_STATUSES = ['pending', 'succeeded', 'failed']
export const REFUND_METHODS = ['razorpay', 'manual']
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const CUSTOMER_LABEL = { pending: 'Refund processing', succeeded: 'Refund completed', failed: 'Refund failed - contact support' }
const TONE = { pending: 'accent', succeeded: 'success', failed: 'danger' }
/** @returns {{status:string,label:string,tone:string,final:boolean}} - an unknown status (newer server) degrades to its own name */
export const refundStatusMeta = (status) => ({
  status, label: CUSTOMER_LABEL[status] || titleCase(status) || 'Unknown', tone: TONE[status] || 'neutral', final: status === 'succeeded' || status === 'failed',
})

/** How the money goes back, in the customer's words */
export const refundMethodLabel = (method) => (method === 'razorpay' ? 'Original payment method (Razorpay)' : method === 'manual' ? 'Bank / UPI transfer' : titleCase(method))

/** "₹1,227.78" (Indian digit grouping); another currency shows its code */
export function formatMoney(amount, currency = 'INR') {
  const n = Number(amount)
  const text = (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return !currency || currency === 'INR' ? `₹${text}` : `${currency} ${text}`
}
const dateText = (iso) => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : ''
}

// ───────────── what the customer sees ─────────────
/**
 * The three statements of the customer's refund status (spec 9.3). `refund` = a mapped row (mapRefundRow).
 * @returns {{headline:string, detail:string, tone:string, final:boolean}}
 */
export function customerRefundLine(refund) {
  if (!refund) return { headline: '', detail: '', tone: 'neutral', final: false }
  const meta = refundStatusMeta(refund.status)
  // an exchange's price difference / an order-level refund (a cancelled order, an exchange cancelled after the item came back) is refunded like any
  // refund, but the customer is told what it is for
  const amount = formatMoney(refund.amount, refund.currency)
  const subject = refund.kind === 'exchange_difference' ? `${amount} (the price difference of your exchange)`
    : refund.kind === 'order' && refund.reason ? `${amount} (${refund.reason})` : amount
  if (refund.status === 'succeeded') {
    const when = dateText(refund.completedAt)
    const how = refund.method === 'razorpay' ? 'to your original payment method' : 'by bank / UPI transfer'
    return { headline: meta.label, detail: `${subject} was refunded${when ? ` on ${when}` : ''} ${how}.${refund.reference ? ` Reference: ${refund.reference}.` : ''}`, tone: meta.tone, final: true }
  }
  if (refund.status === 'failed') {
    return { headline: meta.label, detail: `${refund.failureReason || 'We could not complete the refund of ' + subject + '.'} Please contact us and we will sort it out.`, tone: meta.tone, final: true }
  }
  const how = refund.method === 'razorpay' ? 'to your original payment method' : 'by bank / UPI transfer'
  return { headline: meta.label, detail: `${subject} is being refunded ${how}. We will tell you as soon as it is done.`, tone: meta.tone, final: false }
}

/**
 * Which of a request's refunds the customer should see: the pending / completed one (at most one exists per request); only when every
 * attempt failed, the latest failure - so "Refund failed - contact support" is never hidden behind an older attempt.
 */
export function refundsToShow(refunds) {
  const time = (r) => { const t = r && r.createdAt ? new Date(r.createdAt).getTime() : 0; return Number.isNaN(t) ? 0 : t }
  const list = (refunds || []).filter(Boolean).slice().sort((a, b) => time(b) - time(a))
  const live = list.filter((r) => r.status !== 'failed')
  return live.length ? live : list.slice(0, 1)
}

// ───────────── mapping rows ─────────────
/** the columns a customer may read (the other refund tables are admin-only) */
export const REFUNDS_COLUMNS_CUSTOMER = 'id, refund_no, order_id, request_id, kind, amount, currency, items_amount, shipping_amount, adjustment_amount, adjustment_note, method, status, reference, failure_reason, initiated_at, completed_at, created_at'
// the order-level refunds (a cancelled order, an exchange cancelled after the item came back) also carry the customer-readable reason (migration 20261017_08, so it is NOT in the list above)
export const REFUNDS_COLUMNS_ORDER = `${REFUNDS_COLUMNS_CUSTOMER}, reason`
export const REFUNDS_SELECT_ADMIN = '*, refund_items(*), refund_private(internal_note, initiated_by, attempts, gateway_error), refund_events(id, event_type, from_status, to_status, actor_role, note, created_at)'

const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0)
export function mapRefundRow(row) {
  if (!row) return null
  const priv = Array.isArray(row.refund_private) ? row.refund_private[0] : row.refund_private
  return {
    id: row.id,
    refundNo: row.refund_no,
    orderId: row.order_id,
    requestId: row.request_id || null,
    kind: row.kind || 'return',
    amount: num(row.amount),
    currency: row.currency || 'INR',
    itemsAmount: num(row.items_amount),
    shippingAmount: num(row.shipping_amount),
    adjustmentAmount: num(row.adjustment_amount),
    adjustmentNote: row.adjustment_note || '',
    method: row.method,
    status: row.status,
    reference: row.reference || '',
    failureReason: row.failure_reason || '',
    reason: row.reason || '',                // what an order-level refund is for, in the customer's words (only selected for those)
    initiatedAt: row.initiated_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    // admin only (the customer's select never asks for these)
    gatewayState: row.gateway_state || '',
    gatewayRefundId: row.gateway_refund_id || '',
    gatewayStatus: row.gateway_status || '',
    lines: (row.refund_items || []).map((i) => ({ id: i.id, orderItemId: i.order_item_id, requestItemId: i.request_item_id || null, quantity: num(i.quantity), amount: num(i.amount) })),
    internalNote: (priv && priv.internal_note) || '',
    attempts: priv ? num(priv.attempts) : 0,
    gatewayError: (priv && priv.gateway_error) || '',
    events: (row.refund_events || []).map((e) => ({ id: e.id, type: e.event_type, from: e.from_status || '', to: e.to_status || '', actorRole: e.actor_role, note: e.note || '', createdAt: e.created_at }))
      .sort((a, b) => (new Date(b.createdAt).getTime() || 0) - (new Date(a.createdAt).getTime() || 0)),
  }
}
export const mapRefundRows = (rows) => (rows || []).map(mapRefundRow).filter(Boolean)

/** refund_calculate() answer -> camelCase for the admin panel */
export function mapCalculation(j) {
  if (!j) return null
  return {
    requestId: j.request_id, orderId: j.order_id, currency: j.currency || 'INR',
    paidTotal: num(j.paid_total), refundedSoFar: num(j.refunded_so_far), refundableRemaining: num(j.refundable_remaining),
    paidForGoods: num(j.paid_for_goods), shippingCharge: num(j.shipping_charge),
    sellerFault: !!j.seller_fault, shippingEligible: !!j.shipping_eligible, shippingReason: j.shipping_reason || '',
    lines: (j.lines || []).map((l) => ({ orderItemId: l.order_item_id, requestItemId: l.request_item_id, title: l.title || 'Item', variantName: l.variant_name || '',
      quantity: num(l.quantity), ordered: num(l.ordered), alreadyRefundedUnits: num(l.already_refunded_units), paidShare: num(l.paid_share), amount: num(l.amount) })),
    itemsAmount: num(j.items_amount), shippingAmount: num(j.shipping_amount), adjustmentAmount: num(j.adjustment_amount), amount: num(j.amount),
    razorpayPossible: !!j.razorpay_possible, paymentMethod: j.payment_method || '',
  }
}

/** The rows of the calculation table the admin reads before creating a refund: [{ key, label, amount, note }] */
export function refundBreakdownRows(calc) {
  if (!calc) return []
  const rows = (calc.lines || []).map((l) => ({
    key: l.orderItemId, label: `${l.title}${l.variantName ? ` · ${l.variantName}` : ''} x${l.quantity}`, amount: l.amount,
    note: `${formatMoney(l.paidShare, calc.currency)} was paid for the ${l.ordered} unit(s) of this line${l.alreadyRefundedUnits ? `; ${l.alreadyRefundedUnits} already refunded` : ''}`,
  }))
  rows.push({ key: 'shipping', label: 'Shipping charge', amount: calc.shippingAmount, note: calc.shippingReason })
  if (calc.adjustmentAmount) rows.push({ key: 'adjustment', label: calc.adjustmentAmount > 0 ? 'Adjustment (added)' : 'Adjustment (deducted)', amount: calc.adjustmentAmount, note: '' })
  rows.push({ key: 'total', label: 'Refund total', amount: calc.amount, note: `${formatMoney(calc.refundableRemaining, calc.currency)} of ${formatMoney(calc.paidTotal, calc.currency)} can still be refunded` })
  return rows
}

// ───────────── the admin's next steps ─────────────
/** Buttons the admin may show for ONE refund (the server re-checks every one of them). */
export function refundAdminActions(refund) {
  if (!refund || refund.status !== 'pending') return []
  if (refund.method === 'manual') return ['mark_paid', 'mark_failed', 'void']
  if (refund.gatewayState === 'not_sent') return ['send', 'void']
  return ['check_status']           // submitting | submitted | unknown: ask the gateway, never send again
}
const GATEWAY_STATE_LABEL = {
  not_sent: 'Not sent to Razorpay yet', submitting: 'Being sent to Razorpay', submitted: 'Accepted by Razorpay - waiting for it to complete',
  unknown: 'Razorpay did not confirm - check the status',
}
export const gatewayStateLabel = (s) => GATEWAY_STATE_LABEL[s] || ''

/**
 * Validates the "create refund" form like create_refund() will and builds the RPC arguments.
 * @param f {{method, includeShipping?: boolean|null, adjustment?: string|number, adjustmentNote?: string, note?: string}}
 * @returns {{ok:boolean, errors:Object, args:Object}}
 */
export function validateRefundForm(f) {
  const x = f || {}
  const errors = {}
  if (!REFUND_METHODS.includes(x.method)) errors.method = 'Choose how the refund is paid'
  const raw = x.adjustment === '' || x.adjustment == null ? 0 : Number(x.adjustment)
  if (!Number.isFinite(raw)) errors.adjustment = 'Enter the adjustment as a number (use - for a deduction)'
  else if (Math.abs(raw) > 1000000) errors.adjustment = 'The adjustment is too large'
  const adjustment = Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0
  const adjustmentNote = String(x.adjustmentNote || '').trim()
  if (adjustment !== 0 && !adjustmentNote) errors.adjustmentNote = 'Explain the adjustment - the customer can read it'
  if (adjustmentNote.length > 300) errors.adjustmentNote = 'At most 300 characters'
  const note = String(x.note || '').trim()
  if (note.length > 1000) errors.note = 'At most 1000 characters'
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    args: { method: x.method, includeShipping: x.includeShipping === true ? true : x.includeShipping === false ? false : null, adjustment, adjustmentNote: adjustment !== 0 ? adjustmentNote : '', note },
  }
}