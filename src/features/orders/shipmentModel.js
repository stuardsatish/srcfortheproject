// Shipment / tracking model shared by the website (customer pages + admin orders) and the React Native app (customer only).
//
// PURE: no imports, no I/O, no framework. This file exists TWICE and the two copies must stay byte-identical:
//   website  src/features/orders/shipmentModel.js      (tests: src/features/orders/__tests__/shipmentModel.test.mjs)
//   RN app   src/utils/shipmentModel.js                 (the same test file is run against this copy: tools/browser-test/Run-RnParity.ps1)
// It mirrors the database (migration 20261017_03_shipping.sql): the shipment statuses, the tracking-link builder (the SQL function
// app_courier_tracking_url) and the rules the ship_order() RPC enforces, so the admin form can say "no" before a round trip.
//
// Internal order status (orders.order_status: placed / confirmed / shipped / delivered / cancelled) and the courier's tracking status
// (shipments.status) are DIFFERENT things on purpose; the helpers below combine them only for display.

/** Column lists for PostgREST embeds. The events table only grants the customer-safe columns, so `*` would be refused there. */
export const SHIPMENT_EVENT_COLUMNS = 'id, event_type, occurred_at, location, description, created_at'
export const SHIPMENTS_SELECT_CUSTOMER = `shipments(*, shipment_items(order_item_id, quantity), shipment_events(${SHIPMENT_EVENT_COLUMNS}))`
export const SHIPMENTS_SELECT_ADMIN = `shipments(*, shipment_items(order_item_id, quantity), shipment_private(charges, note), shipment_events(${SHIPMENT_EVENT_COLUMNS}))`

export const SHIPMENT_STATUSES = ['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned_to_sender', 'cancelled']
export const SHIPMENT_EVENT_TYPES = ['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned_to_sender', 'cancelled', 'note']

// step = how far along the 5-step customer stepper (placed, confirmed, shipped, out for delivery, delivered) a shipment in this status is
const STATUS_META = {
  created: { label: 'Shipped', tone: 'info', step: 2 },
  picked_up: { label: 'Picked up by courier', tone: 'info', step: 2 },
  in_transit: { label: 'In transit', tone: 'info', step: 2 },
  out_for_delivery: { label: 'Out for delivery', tone: 'accent', step: 3 },
  delivered: { label: 'Delivered', tone: 'success', step: 4 },
  delivery_failed: { label: 'Delivery attempt failed', tone: 'warning', step: 3 },
  returned_to_sender: { label: 'Returned to sender', tone: 'danger', step: 3 },
  cancelled: { label: 'Cancelled', tone: 'neutral', step: 0 },
}
const EVENT_LABEL = {
  created: 'Shipped', picked_up: 'Picked up by courier', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  delivery_failed: 'Delivery attempt failed', returned_to_sender: 'Returned to sender', cancelled: 'Shipment cancelled', note: 'Update',
}
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** @returns {{status:string,label:string,tone:'info'|'accent'|'success'|'warning'|'danger'|'neutral',step:number}} */
export const shipmentStatusMeta = (status) => ({ status, ...(STATUS_META[status] || { label: titleCase(status) || 'Unknown', tone: 'neutral', step: 0 }) })
export const eventLabel = (type) => EVENT_LABEL[type] || titleCase(type) || 'Update'

const time = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? 0 : t }
export const sortEventsNewestFirst = (events) => (events || []).slice().sort((a, b) => time(b.occurredAt) - time(a.occurredAt) || time(b.createdAt) - time(a.createdAt))

/** One `shipments` row (with its embeds) -> camelCase. Tolerates missing embeds (older clients / customers have no shipment_private). */
export function mapShipmentRow(row) {
  if (!row) return null
  const priv = Array.isArray(row.shipment_private) ? row.shipment_private[0] : row.shipment_private
  return {
    id: row.id,
    orderId: row.order_id,
    direction: row.direction || 'outbound',
    requestId: row.request_id || null,                 // a return shipment belongs to a return / exchange request
    pickupReference: row.pickup_reference || '',
    courierCode: row.courier_code || '',
    courierName: row.courier_name || '',
    trackingNumber: row.tracking_number || '',
    trackingUrl: row.tracking_url || '',
    shippedAt: row.shipped_at || null,
    expectedDeliveryDate: row.expected_delivery_date || null,
    deliveredAt: row.delivered_at || null,
    status: row.status || 'created',
    lastEventAt: row.last_event_at || null,
    createdAt: row.created_at || null,
    items: (row.shipment_items || []).map((i) => ({ orderItemId: i.order_item_id, quantity: Number(i.quantity) || 0 })),
    events: sortEventsNewestFirst((row.shipment_events || []).map((e) => ({
      id: e.id, type: e.event_type, occurredAt: e.occurred_at, location: e.location || '', description: e.description || '', createdAt: e.created_at || null,
    }))),
    // admin-only (the customer's query never selects shipment_private): what the parcel cost and the staff note
    charges: priv && priv.charges != null ? Number(priv.charges) : null,
    note: (priv && priv.note) || '',
  }
}
export const mapShipmentRows = (rows) => (rows || []).map(mapShipmentRow).filter(Boolean)

/** Customers see the courier's history, not the staff's internal "details updated" notes. */
export const customerEvents = (shipment) => (shipment?.events || []).filter((e) => e.type !== 'note')

/** Outbound parcels that still count (a cancelled parcel is history, not a shipment), oldest first. */
export function activeShipments(order) {
  return (order?.shipments || [])
    .filter((s) => (s.direction || 'outbound') === 'outbound' && s.status !== 'cancelled')
    .slice()
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
}

/**
 * Everything a screen needs to describe where an order's parcel(s) are.
 * `focus` is the parcel that still matters: the LEAST advanced one that is not delivered yet (an order is only done when every parcel is),
 * or the last one when all are delivered.
 */
export function summarizeTracking(order) {
  const orderStatus = String(order?.orderStatus || '').toLowerCase()
  const ships = activeShipments(order)
  if (!ships.length) {
    return {
      hasShipments: false, orderStatus, shipments: [], total: 0, deliveredCount: 0, multiple: false, focus: null, status: null, meta: null,
      courierName: '', trackingNumber: '', trackingUrl: '', expectedDeliveryDate: null, deliveredAt: order?.deliveredAt || null, lastEvent: null,
      // shipped before shipment tracking existed: the order says shipped, nothing else is known
      legacyShipped: orderStatus === 'shipped', needsAttention: false,
    }
  }
  const deliveredCount = ships.filter((s) => s.status === 'delivered').length
  const open = ships.filter((s) => s.status !== 'delivered')
  const focus = open.length
    ? open.slice().sort((a, b) => shipmentStatusMeta(a.status).step - shipmentStatusMeta(b.status).step || time(a.createdAt) - time(b.createdAt))[0]
    : ships[ships.length - 1]
  const allEvents = ships.flatMap((s) => customerEvents(s)).sort((a, b) => time(b.occurredAt) - time(a.occurredAt))
  return {
    hasShipments: true,
    orderStatus,
    shipments: ships,
    total: ships.length,
    deliveredCount,
    multiple: ships.length > 1,
    focus,
    status: focus.status,
    meta: shipmentStatusMeta(focus.status),
    courierName: focus.courierName || '',
    trackingNumber: focus.trackingNumber || '',
    trackingUrl: focus.trackingUrl || '',
    expectedDeliveryDate: open.length ? (focus.expectedDeliveryDate || null) : null,
    deliveredAt: order?.deliveredAt || (deliveredCount === ships.length ? focus.deliveredAt : null),
    lastEvent: allEvents[0] || null,
    legacyShipped: false,
    needsAttention: open.some((s) => s.status === 'delivery_failed' || s.status === 'returned_to_sender'),
  }
}

/** The one-line status shown under / next to an order: "Out for delivery", "2 parcels · 1 delivered", "Processing" ... */
export function trackingHeadline(order) {
  const t = summarizeTracking(order)
  if (t.orderStatus === 'cancelled') return 'Cancelled'
  if (!t.hasShipments) {
    if (t.orderStatus === 'delivered') return 'Delivered'
    if (t.orderStatus === 'shipped') return 'Shipped'
    return t.orderStatus === 'confirmed' ? 'Confirmed' : 'Processing'
  }
  if (t.multiple) return t.deliveredCount === t.total ? 'Delivered' : `${t.total} parcels · ${t.deliveredCount} delivered`
  return t.meta.label
}

/** 5 steps for the customer stepper. `warn` marks a step whose last news is bad (failed attempt / returned). */
export function trackingSteps(order) {
  const t = summarizeTracking(order)
  const st = t.orderStatus
  const labels = [['placed', 'Order placed'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered']]
  let reached = st === 'delivered' ? 4 : st === 'shipped' ? 2 : st === 'confirmed' ? 1 : 0
  if (st === 'shipped' && t.hasShipments) reached = Math.max(2, t.meta.step)
  const warn = st === 'shipped' && t.needsAttention
  return labels.map(([key, label], i) => ({ key, label, done: i <= reached, current: i === reached, warn: warn && i === reached }))
}

// ───────────── tracking link (twin of the SQL function app_courier_tracking_url / app_urlencode) ─────────────
/** Percent-encodes everything except A-Z a-z 0-9 _ . ~ - (exactly like the SQL helper, which also escapes ! ' ( ) *). */
export const urlEncode = (s) => encodeURIComponent(String(s ?? '')).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
export function trackingUrlFromTemplate(template, tracking) {
  const t = String(tracking ?? '').trim()
  if (!template || !t || !String(template).includes('{tracking}')) return null
  return String(template).split('{tracking}').join(urlEncode(t))
}
export const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || '').trim())

// ───────────── what is still left to ship (partial shipments) ─────────────
/** One row per order line that has an id: ordered / already on an active shipment / left. */
export function remainingByLine(order) {
  const onShipments = {}
  for (const s of activeShipments(order)) for (const it of s.items || []) onShipments[it.orderItemId] = (onShipments[it.orderItemId] || 0) + it.quantity
  return (order?.products || []).filter((p) => p && p.id).map((p) => {
    const quantity = Number(p.quantity) || 0
    const shipped = onShipments[p.id] || 0
    return { orderItemId: p.id, title: p.title || '', variantName: p.variantName || '', quantity, shipped, remaining: Math.max(0, quantity - shipped) }
  })
}

// ───────────── the admin "ship this order" form ─────────────
const pad2 = (n) => String(n).padStart(2, '0')
const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
/**
 * Validates the form the same way ship_order() will, and builds the RPC arguments.
 * @param form {{courierCode, courierName?, trackingNumber?, trackingUrl?, shippedAt?, charges?, note?, expectedDeliveryDate?, items?}}
 *        items = null (everything not yet shipped) or [{ orderItemId, quantity }]; shippedAt = anything `new Date()` parses (e.g. datetime-local)
 * @param ctx  {{orderId, couriers?, remaining?: {[orderItemId]: number}, now?}}
 * @returns {{ok:boolean, errors:Object, warnings:Object, payload:Object}}  payload keys are the RPC parameter names
 */
export function validateShipForm(form, ctx = {}) {
  const f = form || {}
  const now = ctx.now ? new Date(ctx.now) : new Date()
  const errors = {}
  const warnings = {}

  const code = String(f.courierCode || '').trim()
  const couriers = ctx.couriers || []
  if (!code) errors.courierCode = 'Choose a courier'
  else if (couriers.length && !couriers.some((c) => c.code === code)) errors.courierCode = 'Unknown courier'

  const courierName = String(f.courierName || '').trim()
  if (courierName.length > 80) errors.courierName = 'At most 80 characters'

  const tracking = String(f.trackingNumber || '').trim()
  if (tracking.length > 80) errors.trackingNumber = 'At most 80 characters'
  else if (!tracking && code && code !== 'pickup') warnings.trackingNumber = 'No tracking number: the customer will only see the courier name.'

  const url = String(f.trackingUrl || '').trim()
  if (url && !isHttpUrl(url)) errors.trackingUrl = 'Must start with http:// or https:// and contain no spaces'
  else if (url.length > 1000) errors.trackingUrl = 'At most 1000 characters'

  let charges = null
  const chargesRaw = String(f.charges ?? '').trim()
  if (chargesRaw !== '') {
    const n = Number(chargesRaw)
    if (!Number.isFinite(n) || n < 0 || n > 10000000) errors.charges = 'Enter an amount of 0 or more'
    else charges = Math.round(n * 100) / 100
  }

  let shippedAt = null
  if (f.shippedAt) {
    const d = new Date(f.shippedAt)
    if (Number.isNaN(d.getTime())) errors.shippedAt = 'Not a valid date'
    else if (d.getTime() > now.getTime() + 24 * 3600 * 1000) errors.shippedAt = 'The shipping date cannot be in the future'
    else shippedAt = d.toISOString()
  }

  let expected = null
  if (f.expectedDeliveryDate) {
    const raw = String(f.expectedDeliveryDate)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) errors.expectedDeliveryDate = 'Not a valid date'
    else {
      expected = raw
      if (raw < localDay(shippedAt ? new Date(shippedAt) : now)) errors.expectedDeliveryDate = 'Cannot be before the shipping date'
    }
  }

  const note = String(f.note || '').trim()
  if (note.length > 500) errors.note = 'At most 500 characters'

  let items = null
  if (Array.isArray(f.items)) {
    const picked = f.items.filter((i) => i && Number(i.quantity) > 0)
    const seen = new Set()
    for (const i of picked) {
      const q = Number(i.quantity)
      const left = ctx.remaining ? ctx.remaining[i.orderItemId] : undefined
      if (!Number.isInteger(q) || q < 1) errors.items = 'Quantities must be whole numbers'
      else if (left !== undefined && q > left) errors.items = `Only ${left} unit(s) are left to ship for one of the items`
      if (seen.has(i.orderItemId)) errors.items = 'An item appears twice'
      seen.add(i.orderItemId)
    }
    if (!picked.length) errors.items = 'Select at least one item to ship'
    items = picked.map((i) => ({ order_item_id: i.orderItemId, quantity: Number(i.quantity) }))
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    warnings,
    payload: {
      p_order_id: ctx.orderId,
      p_courier_code: code || null,
      p_tracking_number: tracking || null,
      p_tracking_url: url || null,
      p_shipped_at: shippedAt,
      p_charges: charges,
      p_note: note || null,
      p_items: items,
      p_courier_name: courierName || null,
      p_expected_delivery_date: expected,
    },
  }
}

/** The tracking updates an admin can record by hand (what the courier's own site shows). */
export const ADMIN_EVENT_CHOICES = [
  { type: 'picked_up', label: 'Picked up by courier' },
  { type: 'in_transit', label: 'In transit' },
  { type: 'out_for_delivery', label: 'Out for delivery' },
  { type: 'delivered', label: 'Delivered' },
  { type: 'delivery_failed', label: 'Delivery attempt failed' },
  { type: 'returned_to_sender', label: 'Returned to sender' },
  { type: 'note', label: 'Note (no status change)' },
]

/** "Sat, 25 Oct" for a YYYY-MM-DD day (or a timestamp); '' when it is not a date. */
export function formatDay(v) {
  if (!v) return ''
  const s = String(v)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}