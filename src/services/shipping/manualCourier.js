// The "manual" courier adapter: there is no API to call, the admin copies what the courier's own tracking page says.
// An adapter has the same shape for every courier, so a future DTDC / aggregator adapter only has to implement `normalizeEvent`.
//
//   normalizeEvent(raw) -> { type, occurredAt, location, description, eventKey } | null
//     type       one of the shipment event types (see shipmentModel.SHIPMENT_EVENT_TYPES)
//     eventKey   the provider's own id for the event; a repeat of the same key is ignored by the database (idempotent webhooks)
import { SHIPMENT_EVENT_TYPES } from '../../features/orders/shipmentModel.js'

/** A fresh retry-safe key for one admin action (re-sent unchanged when the request is retried). */
export function newEventKey() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export const manualCourier = {
  code: 'manual',
  name: 'Manual',
  supportsApi: false,
  normalizeEvent(raw) {
    if (!raw || !SHIPMENT_EVENT_TYPES.includes(raw.type) || raw.type === 'created' || raw.type === 'cancelled') return null
    return {
      type: raw.type,
      occurredAt: raw.occurredAt || null,
      location: raw.location || null,
      description: raw.description || null,
      eventKey: raw.eventKey || newEventKey(),
    }
  },
}