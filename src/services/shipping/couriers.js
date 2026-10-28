// Courier catalogue helpers + the provider registry.
//
// RULE (spec 5.2): courier-specific logic must not spread through the order screens. Everything a screen needs to know about
// "a courier" is in this folder and in the `couriers` table:
//   * the catalogue (name, tracking-link template, active) lives in the DATABASE and is edited by the admin (Optimization -> Couriers);
//   * a provider ADAPTER (`providers` below) is only needed for a courier whose API / webhook we integrate. None is integrated today
//     (that needs the courier's account and credentials - BLOCKED-CREDENTIALS); `manual` is the one adapter that exists.
// Nothing here invents tracking data: with no API the admin records the courier's updates by hand.
import { trackingUrlFromTemplate } from '../../features/orders/shipmentModel.js'
import { manualCourier } from './manualCourier.js'

export const MANUAL_COURIER = 'manual'
export const PICKUP_COURIER = 'pickup'

/** `couriers` row -> camelCase */
export const mapCourierRow = (r) => ({
  code: r.code,
  name: r.name,
  trackingUrlTemplate: r.tracking_url_template || '',
  supportsApi: !!r.supports_api,
  active: r.active !== false,
  sortOrder: Number(r.sort_order) || 0,
})

/** Active couriers (or all), in the admin's order; "manual" is always offered first-class even if the table is empty. */
export function courierOptions(couriers, { includeInactive = false } = {}) {
  const list = (couriers || []).filter((c) => includeInactive || c.active)
  const sorted = list.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  return sorted.some((c) => c.code === MANUAL_COURIER) ? sorted : [{ code: MANUAL_COURIER, name: 'Other courier (manual)', trackingUrlTemplate: '', supportsApi: false, active: true, sortOrder: 0 }, ...sorted]
}

/** "Anjani Courier & Cargo" -> "anjani_courier_cargo" (the courier's primary key; the admin may edit it while the courier is new). */
export const slugCourierCode = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

/** Admin form -> { ok, errors, value } using the SAME rules as the table's CHECK constraints (so the form can say no before the round trip). */
export function validateCourier(draft, { existing = [], isNew = false } = {}) {
  const errors = {}
  const name = String(draft?.name || '').trim()
  const code = String(draft?.code || '').trim().toLowerCase()
  const template = String(draft?.trackingUrlTemplate || '').trim()
  if (!name) errors.name = 'Enter the courier name'
  else if (name.length > 80) errors.name = 'At most 80 characters'
  if (!/^[a-z0-9_]{2,40}$/.test(code)) errors.code = 'Use 2-40 lowercase letters, digits or underscores'
  else if (isNew && existing.some((c) => c.code === code)) errors.code = 'A courier with this code already exists'
  if (template) {
    if (!/^https?:\/\/\S+$/i.test(template)) errors.trackingUrlTemplate = 'Must start with http:// or https:// and contain no spaces'
    else if (!template.includes('{tracking}')) errors.trackingUrlTemplate = 'Put {tracking} where the tracking number goes'
  }
  const active = draft?.active !== false
  if (code === MANUAL_COURIER && !active) errors.active = 'The "manual" courier cannot be switched off (it is the fallback)'
  const sortOrder = Number.isFinite(Number(draft?.sortOrder)) ? Math.round(Number(draft.sortOrder)) : 100
  return { ok: Object.keys(errors).length === 0, errors, value: { code, name, trackingUrlTemplate: template, supportsApi: !!draft?.supportsApi, active, sortOrder } }
}

/** The link the customer will get for this courier + number (null when the courier has no template). Mirrors the database function. */
export const previewTrackingUrl = (courier, trackingNumber) => trackingUrlFromTemplate(courier?.trackingUrlTemplate, trackingNumber)

/** True for couriers whose status must be typed in by hand (everything today). */
export const isManualTracking = (courier) => !courier || !courier.supportsApi

/** code -> adapter. An adapter turns a provider's raw webhook payload into add_shipment_event() arguments. */
export const providers = { [MANUAL_COURIER]: manualCourier }
export const getProvider = (code) => providers[code] || null