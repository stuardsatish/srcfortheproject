// Return / exchange REQUEST model shared by the website (customer pages + admin) and the React Native app (customer only).
//
// PURE: no imports, no I/O, no framework. This file exists TWICE and the two copies must stay byte-identical:
//   website  src/features/returns/requestModel.js      (tests: src/features/returns/__tests__/requestModel.test.mjs)
//   RN app   src/utils/requestModel.js                  (the same test file runs against this copy: tools/browser-test/Run-RnParity.ps1)
// It mirrors the database (migrations 20261017_04_return_requests.sql and 20261017_05_return_workflow.sql): the statuses and who may do
// what in each, the reason codes of get_order_eligibility(), and the checks create_return_request() makes - so a form can say "no"
// before the round trip. THE DATABASE REMAINS THE AUTHORITY: nothing here decides eligibility, it only explains the server's answer.

// ───────────── statuses ─────────────
export const REQUEST_STATUSES = [
  'pending_review', 'needs_info', 'approved', 'rejected', 'awaiting_return_shipment', 'return_in_transit', 'return_received', 'inspection_pending',
  'inspection_passed', 'inspection_failed', 'refund_pending', 'refunded', 'replacement_pending', 'replacement_shipped', 'replacement_delivered', 'closed', 'cancelled',
]
export const FINAL_STATUSES = ['rejected', 'closed', 'cancelled']

// What the CUSTOMER reads (plain words, not the internal state names). `tone` drives the chip colour.
const CUSTOMER_LABEL = {
  pending_review: 'Pending admin review',
  needs_info: 'More information needed',
  approved: 'Approved',
  rejected: 'Not approved',
  awaiting_return_shipment: 'Awaiting the returned product',
  return_in_transit: 'Return on its way to us',
  return_received: 'Return received',
  inspection_pending: 'Being checked',
  inspection_passed: 'Return accepted',
  inspection_failed: 'Return not accepted',
  refund_pending: 'Refund processing',
  refunded: 'Refund completed',
  replacement_pending: 'Replacement being prepared',
  replacement_shipped: 'Replacement on its way',
  replacement_delivered: 'Replacement delivered',
  closed: 'Closed',
  cancelled: 'Cancelled',
}
const TONE = {
  pending_review: 'info', needs_info: 'warning', approved: 'success', rejected: 'danger', awaiting_return_shipment: 'accent', return_in_transit: 'info',
  return_received: 'info', inspection_pending: 'info', inspection_passed: 'success', inspection_failed: 'danger', refund_pending: 'accent', refunded: 'success',
  replacement_pending: 'accent', replacement_shipped: 'info', replacement_delivered: 'success', closed: 'neutral', cancelled: 'neutral',
}
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** @returns {{status:string,label:string,tone:string,final:boolean}} - an unknown status (newer server) degrades to its own name */
export const requestStatusMeta = (status) => ({
  status, label: CUSTOMER_LABEL[status] || titleCase(status) || 'Unknown', tone: TONE[status] || 'neutral', final: FINAL_STATUSES.includes(status),
})
export const requestTypeLabel = (type) => (type === 'exchange' ? 'Exchange' : 'Return')

/** Staff wording (the admin screens use the real state names) */
export const adminStatusLabel = (status) => titleCase(status)

// item-level states
const ITEM_LABEL = { pending: 'Waiting for review', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled', received: 'Received', passed: 'Accepted', failed: 'Not accepted', resolved: 'Completed' }
export const itemStatusLabel = (s) => ITEM_LABEL[s] || titleCase(s)

// ───────────── eligibility (explaining get_order_eligibility) ─────────────
export const ELIGIBILITY_CODES = ['NOT_DELIVERED', 'NO_DELIVERY_DATE', 'POLICY_DISABLED', 'WINDOW_EXPIRED', 'NO_REMAINING_QTY', 'ACTIVE_REQUEST']
const CODE_TEXT = {
  NOT_DELIVERED: 'Available after the order is delivered',
  NO_DELIVERY_DATE: 'The delivery date is missing - please contact us',
  POLICY_DISABLED: 'Not available for this item',
  WINDOW_EXPIRED: 'The request period has ended',
  NO_REMAINING_QTY: 'Already requested',
  ACTIVE_REQUEST: 'A request for this item is in progress',
}
export const eligibilityMessage = (code) => CODE_TEXT[code] || 'Not available'

/** "17 Oct 2026" in the store's time zone (the deadline is an IST day, so it is shown as one) */
export function formatDeadline(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

/**
 * One order line + one type -> what the screen shows. `verdict` is item.return or item.exchange from get_order_eligibility().
 * @returns {{eligible:boolean, label:string, hint:string, codes:string[], remaining:number, deadline:string}}
 */
export function describeEligibility(verdict, type = 'return') {
  const noun = type === 'exchange' ? 'Exchange' : 'Return'
  if (!verdict) return { eligible: false, label: `${noun} unavailable`, hint: '', codes: [], remaining: 0, deadline: '' }
  const codes = Array.isArray(verdict.reasons) ? verdict.reasons : []
  const deadline = formatDeadline(verdict.deadline)
  const remaining = Number(verdict.remaining_qty) || 0
  if (verdict.eligible) return { eligible: true, label: noun, hint: deadline ? `Until ${deadline}` : '', codes: [], remaining, deadline }
  // the most useful single sentence: a request in progress beats everything; an expired window says when it ended
  const first = ['ACTIVE_REQUEST', 'NOT_DELIVERED', 'NO_DELIVERY_DATE', 'POLICY_DISABLED', 'WINDOW_EXPIRED', 'NO_REMAINING_QTY'].find((c) => codes.includes(c)) || codes[0]
  const hint = first === 'WINDOW_EXPIRED' && deadline ? `The ${type} period ended on ${deadline}` : eligibilityMessage(first)
  return { eligible: false, label: `${noun} unavailable`, hint, codes, remaining, deadline }
}

/** True when at least one line of the order can be returned / exchanged - the screens show the section only then. */
export const anyEligible = (eligibility, type) => !!eligibility && (eligibility.items || []).some((i) => i && i[type] && i[type].eligible)

// ───────────── reasons ─────────────
/** Reasons for one request type, active first in the admin's order (the server re-checks `applies_to`). */
export function reasonOptions(reasons, type) {
  return (reasons || [])
    .filter((r) => r && r.active !== false && (!Array.isArray(r.applies_to) || r.applies_to.includes(type)))
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.label).localeCompare(String(b.label)))
}

// ───────────── exchange: what can it be swapped for? ─────────────
const round2 = (n) => Math.round(Number(n) * 100) / 100
/** the price a customer pays today for the MAIN option of a product (same rule as app_effective_price in the database) */
export function effectivePrice(price, discount, discountExpiry, now = Date.now()) {
  const p = Number(price) || 0
  const d = Number(discount) || 0
  const live = d > 0 && (!discountExpiry || new Date(discountExpiry).getTime() > now)
  return live ? round2(p - (p * d) / 100) : round2(p)
}
/**
 * The choices for "what would you like instead" for ONE purchased line: the product's main option (when it can be sold) and every active
 * variant. An exchange is for the SAME product (another size / colour, or the same item again for a defective unit).
 * @param product   a `products` row (id, title, price, discount, discount_expiry, has_variants, main_option_enabled, stock, track_inventory, status)
 * @param variants  `product_variants` rows of that product (id, name, price, stock, track_inventory, status)
 * @param purchased {{variantId:string, unitPrice:number}}  the line being exchanged
 * @returns {{variantId:string,label:string,price:number,inStock:boolean,isSame:boolean,difference:number}[]}
 */
export function replacementOptions(product, variants, purchased, now = Date.now()) {
  if (!product || product.status === 'draft') return []
  const bought = (purchased && purchased.variantId) || ''
  const unit = Number(purchased && purchased.unitPrice) || 0
  const sellable = (stock, track) => track === false || Number(stock) > 0
  const out = []
  if (!product.has_variants || product.main_option_enabled) {
    out.push({
      variantId: '', label: product.has_variants ? 'Main option' : (product.title || 'This item'), price: effectivePrice(product.price, product.discount, product.discount_expiry, now),
      inStock: sellable(product.stock, product.track_inventory), isSame: bought === '',
    })
  }
  for (const v of variants || []) {
    if (!v || v.status !== 'active') continue
    out.push({ variantId: v.id, label: v.name, price: round2(v.price), inStock: sellable(v.stock, v.track_inventory), isSame: v.id === bought })
  }
  return out.map((o) => ({ ...o, difference: round2(o.price - unit) }))
}
/** The sensible default: the same option again if it is in stock, otherwise the first one that is. '' (the main option) is a valid answer, null = nothing available. */
export function defaultReplacement(options) {
  const pick = (options || []).find((o) => o.isSame && o.inStock) || (options || []).find((o) => o.inStock)
  return pick ? pick.variantId : null
}

// ───────────── evidence (photos) ─────────────
export const EVIDENCE_MIME = ['image/jpeg', 'image/png', 'image/webp']
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024
export const EVIDENCE_MAX_FILES = 6
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** @returns {string} '' when the file is acceptable, else the reason */
export function evidenceFileError(file) {
  if (!file) return 'No file'
  if (!EVIDENCE_MIME.includes(file.type)) return 'Photos must be JPEG, PNG or WebP'
  if (!(file.size > 0)) return 'The photo is empty'
  if (file.size > EVIDENCE_MAX_BYTES) return 'Each photo must be 5 MB or smaller'
  return ''
}
/** `<uid>/<request id>/<n>-<safe name>.<ext>` - exactly the folder the storage policy and create_return_request() demand. */
export function evidencePath(uid, requestId, index, file) {
  const leaf = String(file?.name || '').split(/[\\/]/).pop()          // never trust a path inside the name
  const base = leaf.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'photo'
  return `${uid}/${requestId}/${index + 1}-${base}.${EXT[file?.type] || 'jpg'}`
}

// ───────────── the customer's request form ─────────────
const PHONE_RE = /^[0-9+()\- ]{6,30}$/
/**
 * Validates the form like create_return_request() will, and builds the RPC arguments.
 * @param form {{type, reasonCode, description?, contactPhone?, lines:[{orderItemId, quantity, selected, replacementVariantId?, condition?}], photos?: File-like[]}}
 * @param ctx  {{orderId, requestId, eligibility, reasons, uploaded?:[{path, mime, size}]}}   eligibility = get_order_eligibility() result
 * @returns {{ok:boolean, errors:Object, payload:Object}}
 */
export function validateRequestForm(form, ctx = {}) {
  const f = form || {}
  const type = f.type === 'exchange' ? 'exchange' : 'return'
  const errors = {}
  const byId = new Map(((ctx.eligibility && ctx.eligibility.items) || []).map((i) => [i.order_item_id, i]))

  const picked = (f.lines || []).filter((l) => l && l.selected)
  if (!picked.length) errors.items = `Select at least one item to ${type === 'exchange' ? 'exchange' : 'return'}`
  const items = []
  for (const l of picked) {
    const line = byId.get(l.orderItemId)
    const verdict = line && line[type]
    const q = Number(l.quantity)
    if (!line || !verdict || !verdict.eligible) { errors.items = 'One of the selected items cannot be requested any more'; continue }
    if (!Number.isInteger(q) || q < 1) { errors.items = 'Quantities must be whole numbers of at least 1'; continue }
    if (q > Number(verdict.remaining_qty)) { errors.items = `Only ${verdict.remaining_qty} unit(s) of "${line.title}" can still be requested`; continue }
    const entry = { order_item_id: l.orderItemId, quantity: q }
    if (l.condition) entry.condition = l.condition
    if (type === 'exchange') {
      if (l.replacementVariantId === undefined || l.replacementVariantId === null) { errors.replacement = 'Choose what you would like instead'; continue }
      entry.replacement_variant_id = String(l.replacementVariantId)
    }
    items.push(entry)
  }

  const reasons = ctx.reasons || []
  const reason = reasons.find((r) => r.code === f.reasonCode)
  if (!f.reasonCode) errors.reasonCode = 'Choose a reason'
  else if (!reason) errors.reasonCode = 'Choose a reason from the list'

  const description = String(f.description || '').trim()
  if (description.length > 2000) errors.description = 'At most 2000 characters'
  else if (reason && reason.requires_description && !description) errors.description = 'Please describe the problem'

  const phone = String(f.contactPhone || '').trim()
  if (phone && !PHONE_RE.test(phone)) errors.contactPhone = 'Enter a valid phone number'

  const photos = f.photos || []
  const uploaded = ctx.uploaded || []
  const count = uploaded.length || photos.length
  if (count > EVIDENCE_MAX_FILES) errors.photos = `At most ${EVIDENCE_MAX_FILES} photos`
  for (const p of photos) { const e = evidenceFileError(p); if (e) { errors.photos = e; break } }
  if (reason && reason.requires_evidence && count === 0) errors.photos = 'Please add at least one photo'

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    payload: {
      p_request_id: ctx.requestId,
      p_order_id: ctx.orderId,
      p_type: type,
      p_items: items,
      p_reason_code: f.reasonCode || null,
      p_description: description || null,
      p_contact_phone: phone || null,
      p_evidence: uploaded.map((u) => ({ path: u.path, mime: u.mime, size: u.size })),
    },
  }
}

// ───────────── mapping rows ─────────────
/** columns the customer may read from the events table (the internal flag decides which rows RLS lets through) */
export const REQUEST_EVENT_COLUMNS = 'id, item_id, from_status, to_status, actor_role, note, created_at'
// the lines are listed column by column (not `*`): the stock handling of an inspected line (disposition / stock_effect, migration 20261017_08) is staff information and is not sent to the customer's screens
export const REQUEST_ITEM_COLUMNS_CUSTOMER = 'id, request_id, order_item_id, quantity, reason_code, item_condition, item_status, decision_note, inspection_note, unit_price, policy_window_days, policy_deadline, replacement_product_id, replacement_variant_id, replacement_qty, price_difference, decided_at, inspected_at, created_at'
export const REQUESTS_COLUMNS_CUSTOMER = `*, return_request_items(${REQUEST_ITEM_COLUMNS_CUSTOMER}, order_items(title, product_title, variant_name, image, unit_price, quantity)), return_request_evidence(id, storage_path, mime, size_bytes, created_at), return_request_events(${REQUEST_EVENT_COLUMNS})`
export const REQUESTS_SELECT_CUSTOMER = `return_requests(${REQUESTS_COLUMNS_CUSTOMER})`      // as an embed inside an orders select
export const REQUESTS_SELECT_ADMIN = `*, orders(id, customer_name, customer_email, customer_phone, payment_method, payment_status, total, delivered_at, address, user_id), return_request_private(internal_note, decided_by), return_request_items(*, order_items(title, product_title, variant_name, image, unit_price, quantity, product_id, variant_id)), return_request_evidence(id, storage_path, mime, size_bytes, created_at), return_request_events(*)`

const time = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? 0 : t }
export function mapRequestItem(i) {
  const oi = Array.isArray(i.order_items) ? i.order_items[0] : i.order_items
  return {
    id: i.id,
    orderItemId: i.order_item_id,
    title: (oi && (oi.product_title || oi.title)) || 'Item',
    variantName: (oi && oi.variant_name) || '',
    image: (oi && oi.image) || '',
    productId: (oi && oi.product_id) || '',
    quantity: Number(i.quantity) || 0,
    orderedQuantity: oi ? Number(oi.quantity) || 0 : 0,
    unitPrice: Number(i.unit_price) || (oi && Number(oi.unit_price ?? oi.price)) || 0,
    status: i.item_status,
    reasonCode: i.reason_code || '',
    condition: i.item_condition || '',
    decisionNote: i.decision_note || '',
    inspectionNote: i.inspection_note || '',
    policyDeadline: i.policy_deadline || null,
    policyWindowDays: i.policy_window_days ?? null,
    replacementProductId: i.replacement_product_id || '',
    replacementVariantId: i.replacement_variant_id ?? '',
    replacementQty: i.replacement_qty ?? null,
    priceDifference: i.price_difference == null ? null : Number(i.price_difference),
    decidedAt: i.decided_at || null,
    inspectedAt: i.inspected_at || null,
    // staff only (the customer's select never asks for these): where the returned units went at the inspection (migration 20261017_08)
    disposition: i.disposition || '',
    stockEffect: i.stock_effect || '',
  }
}
export function mapRequestRow(row) {
  if (!row) return null
  const priv = Array.isArray(row.return_request_private) ? row.return_request_private[0] : row.return_request_private
  const order = Array.isArray(row.orders) ? row.orders[0] : row.orders
  const items = (row.return_request_items || []).map(mapRequestItem)
  const itemsTotal = items.reduce((sum, it) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0)
  const orderTotal = order ? Number(order.total) || 0 : 0
  const refundAmount = itemsTotal > 0 ? itemsTotal : orderTotal
  const reason = row.description || (row.reason_code ? row.reason_code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Customer return')

  return {
    id: row.id,
    requestNo: row.request_no,
    orderId: row.order_id,
    userId: row.user_id || null,
    type: row.type || 'return',
    status: row.status,
    reasonCode: row.reason_code,
    reason,
    refundAmount,
    description: row.description || '',
    contactPhone: row.contact_phone || '',
    deliveredAt: row.delivered_at || null,
    customerNote: row.customer_note || '',
    returnMethod: row.return_method || '',
    returnInstructions: row.return_instructions || '',
    decidedAt: row.decided_at || null,
    receivedAt: row.received_at || null,
    closedAt: row.closed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    items,
    evidence: (row.return_request_evidence || []).map((e) => ({ id: e.id, path: e.storage_path, mime: e.mime, size: Number(e.size_bytes) || 0, createdAt: e.created_at || null })),
    events: (row.return_request_events || [])
      .map((e) => ({ id: e.id, itemId: e.item_id || null, from: e.from_status || '', to: e.to_status || '', actorRole: e.actor_role, note: e.note || '', internal: !!e.internal, createdAt: e.created_at }))
      .sort((a, b) => time(b.createdAt) - time(a.createdAt)),
    // admin only (the customer's query never selects these)
    internalNote: (priv && priv.internal_note) || '',
    decidedBy: (priv && priv.decided_by) || null,
    order: order ? { id: order.id, customerName: order.customer_name || '', customerEmail: order.customer_email || '', customerPhone: order.customer_phone || '',
      paymentMethod: order.payment_method || '', paymentStatus: order.payment_status || '', total: Number(order.total) || 0, deliveredAt: order.delivered_at || null, address: order.address || null } : null,
  }
}
export const mapRequestRows = (rows) => (rows || []).map(mapRequestRow).filter(Boolean)

// ───────────── what each side may do next (mirrors request_status_transitions; the server still enforces it) ─────────────
const CUSTOMER_CANCEL_FROM = ['pending_review', 'needs_info', 'approved', 'awaiting_return_shipment']
export const canCustomerCancel = (req) => !!req && CUSTOMER_CANCEL_FROM.includes(req.status)
export const canCustomerRespond = (req) => !!req && req.status === 'needs_info'
export const canSubmitReturnTracking = (req) => !!req && req.status === 'awaiting_return_shipment' && req.returnMethod === 'customer_arranged'

/** The admin's next steps for a request: each entry is a button the screen may show. */
export function adminActions(req) {
  if (!req || FINAL_STATUSES.includes(req.status)) return []
  const a = []
  const isReturn = req.type === 'return'
  switch (req.status) {
    case 'pending_review': a.push('decide', 'needs_info', 'cancel'); break
    case 'needs_info': a.push('decide', 'back_to_review', 'cancel'); break
    case 'approved': a.push('logistics', 'cancel'); break
    case 'awaiting_return_shipment': a.push('logistics', 'in_transit', 'received', 'cancel'); break
    case 'return_in_transit': a.push('received', 'cancel'); break
    case 'inspection_pending': a.push('inspect'); break
    // a return goes on to its refund (the refund panel creates it and moves the request to "refund pending" itself - see refundModel.js)
    case 'inspection_passed': a.push(isReturn ? 'refund' : 'replacement_pending'); break
    case 'refund_pending': if (isReturn) a.push('refund'); break           // retry after a failed refund / check a pending one
    // an exchange goes on to its replacement: the Replacement panel ships it, settles the price difference and marks it delivered (see exchangeModel.js);
    // the server closes the exchange by itself once it is delivered and settled - 'close' stays for the admin who wants to do it by hand
    case 'replacement_pending': a.push('replacement', 'cancel'); break
    case 'replacement_shipped': a.push('replacement'); break
    case 'replacement_delivered': a.push('replacement', 'close'); break
    case 'inspection_failed': a.push('close'); break
    case 'refunded': a.push('close'); break
    default: break
  }
  a.push('message', 'note')
  return a
}

/** Steps of the customer's progress bar for ONE request. */
export function requestProgress(req) {
  if (!req) return []
  const isReturn = req.type === 'return'
  const labels = isReturn
    ? [['submitted', 'Submitted'], ['approved', 'Approved'], ['received', 'Received'], ['checked', 'Checked'], ['refund', 'Refund']]
    : [['submitted', 'Submitted'], ['approved', 'Approved'], ['received', 'Received'], ['checked', 'Checked'], ['replacement', 'Replacement']]
  const reached = { pending_review: 0, needs_info: 0, approved: 1, awaiting_return_shipment: 1, return_in_transit: 1, return_received: 2, inspection_pending: 2,
    inspection_passed: 3, inspection_failed: 3, refund_pending: 4, refunded: 5, replacement_pending: 4, replacement_shipped: 4, replacement_delivered: 5, closed: 5 }[req.status]
  const stopped = req.status === 'rejected' || req.status === 'cancelled' || req.status === 'inspection_failed'
  const idx = reached === undefined ? 0 : reached
  return labels.map(([key, label], i) => ({ key, label, done: i < idx || (i === idx && idx === 5), current: i === idx && idx < 5, stopped: stopped && i === idx }))
}

/** One line for an order card: "Return · Approved" (the newest request first). */
export function requestSummaryLine(req) {
  if (!req) return ''
  return `${requestTypeLabel(req.type)} · ${requestStatusMeta(req.status).label}`
}