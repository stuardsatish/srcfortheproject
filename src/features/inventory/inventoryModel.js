// Admin stock-ledger / order-lifecycle model (WEBSITE ONLY - the RN app has no admin screens). PURE: no imports, no I/O, no framework.
// It mirrors migration 20261017_08_inventory_cancellation.sql (+ the ledger of 20261014_01): what each ledger movement means in words, the shape of the
// reconciliation / gap / unsellable reports, the payments that could not become an order, and the forms of "cancel an order" and "refund an order".
// THE DATABASE REMAINS THE AUTHORITY: every rule here is only a pre-check so a form can say "no" before the round trip.
import { formatMoney } from '../returns/refundModel.js'

const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0)

// ───────────── the ledger ─────────────
export const MOVEMENT_TYPES = [
  'sale', 'cancel_restock', 'return_restock', 'return_unsellable', 'exchange_reserve', 'exchange_release', 'adjustment_in', 'adjustment_out', 'import_initial',
]
const MOVEMENT = {
  sale: ['Sold', 'info'],
  cancel_restock: ['Order cancelled: stock back', 'success'],
  return_restock: ['Return: put back on sale', 'success'],
  return_unsellable: ['Return: kept, not resellable', 'danger'],
  exchange_reserve: ['Replacement reserved', 'accent'],
  exchange_release: ['Replacement released', 'neutral'],
  adjustment_in: ['Stock added by hand', 'warning'],
  adjustment_out: ['Stock removed by hand', 'warning'],
  import_initial: ['Opening stock (import)', 'neutral'],
}
/** @returns {{type:string,label:string,tone:string}} - an unknown type (a newer server, or a legacy row) degrades to its own name */
export const movementMeta = (type) => ({ type, label: (MOVEMENT[type] || [])[0] || titleCase(type) || 'Legacy movement', tone: (MOVEMENT[type] || [])[1] || 'neutral' })

export const BUCKETS = ['sellable', 'unsellable']
export const bucketLabel = (b) => (b === 'unsellable' ? 'Not resellable' : 'Sellable')

/** "Designer Shirt · Pink" / "Designer Shirt (main option)" */
export const optionLabel = (title, variantName, variantId = '') => `${title || 'Product'}${variantName ? ` · ${variantName}` : variantId ? ` · ${variantId}` : ''}`

// the select asks for `seq` (the strict order of the ledger, migration 20261017_08) and `products(title)`; variants have no foreign key, their names are fetched separately
export const LEDGER_SELECT = 'id, seq, product_id, variant_id, change, reason, order_id, movement_type, bucket, ref_type, ref_id, actor_kind, stock_after, created_at, products(title)'
export const LEDGER_SELECT_LEGACY = 'id, product_id, variant_id, change, reason, order_id, movement_type, bucket, ref_type, ref_id, actor_kind, stock_after, created_at, products(title)'
export const LEDGER_PAGE = 100

/** one `inventory_logs` row -> camelCase; `variantNames` = { [variantId]: name } */
export function mapLedgerRow(r, variantNames = {}) {
  if (!r) return null
  const product = Array.isArray(r.products) ? r.products[0] : r.products
  const variantId = r.variant_id || ''
  return {
    id: r.id,
    seq: r.seq == null ? null : Number(r.seq),
    productId: r.product_id,
    variantId,
    option: optionLabel(product && product.title, variantId ? variantNames[variantId] : '', variantId),
    change: num(r.change),
    movement: movementMeta(r.movement_type || (r.reason === 'order' ? 'sale' : '')),
    bucket: r.bucket || 'sellable',
    orderId: r.order_id || '',
    refType: r.ref_type || '',
    refId: r.ref_id || '',
    reason: r.reason || '',
    actorKind: r.actor_kind || '',
    stockAfter: r.stock_after == null ? null : num(r.stock_after),
    createdAt: r.created_at || null,
  }
}

/** "+3" / "-1" */
export const signed = (n) => `${num(n) > 0 ? '+' : ''}${num(n)}`

/**
 * Normalises the ledger filters (empty strings dropped, an unknown movement type / bucket ignored, a bad date ignored).
 * @param f {{type?, bucket?, orderId?, productId?, from?, to?}}   from / to = YYYY-MM-DD
 */
export function ledgerFilters(f) {
  const x = f || {}
  const out = {}
  if (MOVEMENT_TYPES.includes(x.type)) out.type = x.type
  if (BUCKETS.includes(x.bucket)) out.bucket = x.bucket
  const order = String(x.orderId || '').trim()
  if (order) out.orderId = order
  const product = String(x.productId || '').trim()
  if (product) out.productId = product
  const day = /^\d{4}-\d{2}-\d{2}$/
  if (day.test(String(x.from || '')) && !Number.isNaN(Date.parse(x.from))) out.from = x.from
  if (day.test(String(x.to || '')) && !Number.isNaN(Date.parse(x.to))) out.to = x.to
  return out
}

// ───────────── what happens to the stock of a returned item (the inspection) ─────────────
const DISPOSITIONS = {
  passed: [
    { value: 'restock', label: 'Put back on sale', hint: 'The unit(s) are added back to the stock customers can buy.' },
    { value: 'unsellable', label: 'Keep - not resellable (damaged / defective)', hint: 'Accepted and refunded / replaced, but never added to the sellable stock.' },
  ],
  failed: [
    { value: 'unsellable', label: 'Keep - not resellable', hint: 'We hold the parcel; it is recorded as not resellable.' },
    { value: 'none', label: 'Do not record (sent back to the customer)', hint: 'No stock record at all.' },
  ],
}
/** what was recorded for an inspected line (return_request_items.stock_effect), in words; '' when nothing was recorded (inspected before the stock handling existed) */
export const stockEffectText = (effect) => ({ restocked: 'put back on sale', unsellable: 'kept, not resellable', none: 'no stock record' }[effect] || '')
/** the choices for where the units go after an inspection result; the FIRST one is the default (and what the server does when none is sent) */
export const dispositionOptions = (result) => (DISPOSITIONS[result] || []).slice()
export const defaultDisposition = (result) => (DISPOSITIONS[result] ? DISPOSITIONS[result][0].value : '')
/** true when `value` is one of the legal choices for the result (the server refuses the others) */
export const isDispositionAllowed = (result, value) => (DISPOSITIONS[result] || []).some((d) => d.value === value)

// ───────────── the reports ─────────────
export const mapReconcileRow = (r) => (r ? {
  productId: r.product_id, variantId: r.variant_id || '', option: optionLabel(r.title, r.variant_name, r.variant_id), actualStock: num(r.actual_stock),
  ledgerStock: num(r.ledger_stock), drift: num(r.drift), movements: num(r.movements), lastMovementAt: r.last_movement_at || null,
} : null)
export const mapGapRow = (r) => (r ? {
  productId: r.product_id, variantId: r.variant_id || '', seq: num(r.seq), createdAt: r.created_at || null, movement: movementMeta(r.movement_type), change: num(r.change),
  previousAfter: num(r.previous_after), stockAfter: num(r.stock_after), missing: num(r.missing),
} : null)
export const mapUnsellableRow = (r) => (r ? {
  productId: r.product_id, variantId: r.variant_id || '', option: optionLabel(r.title, r.variant_name, r.variant_id), units: num(r.units), movements: num(r.movements), lastMovementAt: r.last_movement_at || null,
} : null)
/** how the screen says it: "5 more than the ledger" / "2 fewer than the ledger" / "matches the ledger" */
export const driftText = (drift) => {
  const d = num(drift)
  return d === 0 ? 'matches the ledger' : d > 0 ? `${d} more than the ledger says` : `${-d} fewer than the ledger says`
}
/** a gap in plain words: "5 units appeared outside the ledger" / "3 units disappeared outside the ledger" */
export const gapText = (g) => {
  const m = num(g && g.missing)
  return m > 0 ? `${m} unit(s) appeared outside the ledger before this movement` : m < 0 ? `${-m} unit(s) disappeared outside the ledger before this movement` : 'no gap'
}

// ───────────── payments that could not become an order (K-8) ─────────────
export const PAYMENT_EXCEPTION_COLUMNS = 'id, razorpay_order_id, razorpay_payment_id, user_id, amount, reason, items, status, refund_reference, resolution_note, resolved_at, created_at'
const PX = { open: ['Needs a refund', 'danger'], refunded: ['Refunded', 'success'], resolved: ['Resolved', 'neutral'] }
export const paymentExceptionMeta = (status) => ({ status, label: (PX[status] || [])[0] || titleCase(status) || 'Unknown', tone: (PX[status] || [])[1] || 'neutral', open: status === 'open' })
export const mapPaymentException = (r) => (r ? {
  id: r.id, razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, userId: r.user_id || null, amount: num(r.amount), reason: r.reason || '',
  items: Array.isArray(r.items) ? r.items.map((i) => ({ productId: i.product_id || '', variantId: i.variant_id || '', quantity: num(i.quantity), title: i.title || '' })) : [],
  status: r.status, refundReference: r.refund_reference || '', resolutionNote: r.resolution_note || '', resolvedAt: r.resolved_at || null, createdAt: r.created_at || null,
} : null)

/** "Refunded" needs the Razorpay refund id / bank reference; "Resolved" needs a note of how it was handled. */
export function validateResolveForm(f) {
  const x = f || {}
  const errors = {}
  const reference = String(x.reference || '').trim()
  const note = String(x.note || '').trim()
  if (x.status !== 'refunded' && x.status !== 'resolved') errors.status = 'Choose refunded or resolved'
  if (x.status === 'refunded' && !reference) errors.reference = 'Enter the Razorpay refund id (or the bank reference) of the refund you made'
  if (reference.length > 200) errors.reference = 'At most 200 characters'
  if (x.status === 'resolved' && !note) errors.note = 'Say how this was handled'
  if (note.length > 1000) errors.note = 'At most 1000 characters'
  return { ok: Object.keys(errors).length === 0, errors, args: { status: x.status, reference: x.status === 'refunded' ? reference : '', note } }
}

// ───────────── cancel an order / refund an order ─────────────
const lower = (v) => String(v || '').trim().toLowerCase()
/** Why this order cannot be cancelled (mirrors cancel_order); '' = it can. Only the statuses are known here: the server checks the rest. */
export function cancelBlockedReason(order) {
  const s = lower(order && order.orderStatus)
  if (s === 'shipped') return 'The order is already on its way. It cannot be cancelled; once it is delivered the customer can return or exchange it.'
  if (s === 'delivered') return 'The order was delivered. The customer returns or exchanges it (see the return and exchange requests).'
  if (s === 'cancelled') return 'The order is already cancelled.'
  const active = ((order && order.shipments) || []).some((x) => x && (x.direction || 'outbound') === 'outbound' && x.status !== 'cancelled')
  if (active) return 'A shipment is on record: cancel the shipment first.'
  return ''
}
export const canCancelOrder = (order) => !!order && cancelBlockedReason(order) === ''
export const isPaidOrder = (order) => lower(order && order.paymentStatus) === 'paid'
/** can this order's payment go back through Razorpay? (it was paid through Razorpay and we hold the payment id) */
export const razorpayRefundPossible = (order) => !!order && lower(order.paymentMethod) === 'razorpay' && !!order.razorpayPaymentId

/**
 * Validates the "cancel this order" form like cancel_order() will.
 * @param f {{reason, refundMethod?, note?}}   ctx {{paid:boolean, razorpayPossible:boolean}}
 * @returns {{ok:boolean, errors:Object, args:{reason:string, refundMethod:string|null, note:string}}}
 */
export function validateCancelForm(f, ctx = {}) {
  const x = f || {}
  const errors = {}
  const reason = String(x.reason || '').trim()
  const note = String(x.note || '').trim()
  if (!reason) errors.reason = 'Give the customer a reason (they read it)'
  else if (reason.length > 500) errors.reason = 'At most 500 characters'
  if (note.length > 1000) errors.note = 'At most 1000 characters'
  let method = null
  if (ctx.paid) {
    if (x.refundMethod !== 'razorpay' && x.refundMethod !== 'manual') errors.refundMethod = 'This order was paid: choose how it is refunded'
    else if (x.refundMethod === 'razorpay' && !ctx.razorpayPossible) errors.refundMethod = 'This order was not paid through Razorpay: choose a manual refund'
    else method = x.refundMethod
  }
  return { ok: Object.keys(errors).length === 0, errors, args: { reason, refundMethod: method, note } }
}

/**
 * Validates the order-level refund form like create_order_refund() will.
 * @param f {{amount, reason, method, note?}}   ctx {{remaining:number, razorpayPossible:boolean}}
 */
export function validateOrderRefundForm(f, ctx = {}) {
  const x = f || {}
  const errors = {}
  const amount = Math.round(Number(x.amount) * 100) / 100
  if (x.amount === '' || x.amount == null || !Number.isFinite(amount) || amount <= 0) errors.amount = 'Enter the amount to refund'
  else if (Number.isFinite(ctx.remaining) && amount > ctx.remaining + 0.005) errors.amount = `At most ${formatMoney(ctx.remaining)} can still be refunded for this order`
  const reason = String(x.reason || '').trim()
  if (reason.length < 3 || reason.length > 300) errors.reason = 'Say what the refund is for (3 to 300 characters, the customer reads it)'
  if (x.method !== 'razorpay' && x.method !== 'manual') errors.method = 'Choose how the refund is paid'
  else if (x.method === 'razorpay' && ctx.razorpayPossible === false) errors.method = 'This order was not paid through Razorpay: choose a manual refund'
  const note = String(x.note || '').trim()
  if (note.length > 1000) errors.note = 'At most 1000 characters'
  return { ok: Object.keys(errors).length === 0, errors, args: { amount: Number.isFinite(amount) ? amount : 0, reason, method: x.method, note } }
}

/** the answer of cancel_order() in a sentence for the toast */
export function cancelResultText(r) {
  if (!r) return 'Order cancelled'
  if (r.already) return 'This order was already cancelled'
  const parts = [`Order cancelled; stock restored for ${(r.stockRestored || []).length} option(s)`]
  if (r.refundNo) parts.push(`refund ${r.refundNo} of ${formatMoney(r.refundAmount)} created - send or record it in the order's Refund section`)
  return parts.join('; ')
}