// Shipping service: the ONE place the website talks to the shipping tables / RPCs (migration 20261017_03_shipping.sql).
// The Supabase client is INJECTED (createShippingService(client)), so this file has no npm imports and is unit-tested with a fake
// client (src/services/shipping/__tests__/shippingService.test.mjs). services/shipping/index.js wires the real client.
import { SHIPMENTS_SELECT_ADMIN, SHIPMENTS_SELECT_CUSTOMER, mapShipmentRow } from '../../features/orders/shipmentModel.js'
import { mapCourierRow } from './couriers.js'
import { newEventKey } from './manualCourier.js'

/** A PostgREST error -> an Error whose message is fit to show in a toast. The database messages are already readable. */
export function toShippingError(err) {
  const e = new Error(friendly(err))
  e.code = err?.code || ''
  e.details = err?.details || ''
  e.original = err
  return e
}
function friendly(err) {
  const code = err?.code
  const msg = String(err?.message || 'Something went wrong')
  if (code === 'PGRST202' || code === '42883') return 'Shipping is not available on the server yet: the database update (shipping migration) has not been applied.'
  if (code === '42501' && /permission denied/i.test(msg)) return 'You do not have permission to do that.'
  return msg
}

/** PostgREST says an embed does not exist when the shipping migration is not applied yet (so a new site can run before the SQL). */
export function isMissingShipmentsRelation(error) {
  if (!error) return false
  if (['PGRST200', 'PGRST205', '42P01'].includes(error.code)) return true
  const m = String(error.message || '')
  return /shipments|shipment_/i.test(m) && /relationship|not find|does not exist/i.test(m)
}

/**
 * Runs an orders query WITH the shipment embeds, and falls back to the old select when the server has no shipping tables yet.
 * @param makeQuery (select:string) => PromiseLike<{data, error}>   e.g. (s) => supabase.from('orders').select(s).eq('id', id).single()
 */
export async function queryOrdersWithShipments(makeQuery, { admin = false } = {}) {
  const first = await makeQuery(`*, order_items(*), ${admin ? SHIPMENTS_SELECT_ADMIN : SHIPMENTS_SELECT_CUSTOMER}`)
  if (!first.error || !isMissingShipmentsRelation(first.error)) return first
  return makeQuery('*, order_items(*)')
}

/** camelCase admin edits -> the snake_case keys update_shipment() accepts (only the keys that are present). */
export function toShipmentPatch(fields) {
  const map = {
    courierCode: 'courier_code', courierName: 'courier_name', trackingNumber: 'tracking_number', trackingUrl: 'tracking_url',
    shippedAt: 'shipped_at', expectedDeliveryDate: 'expected_delivery_date', charges: 'charges', note: 'note',
  }
  const patch = {}
  for (const [k, v] of Object.entries(fields || {})) if (map[k]) patch[map[k]] = v === '' ? null : v
  return patch
}

export function createShippingService(client) {
  const unwrap = (res) => { if (res.error) throw toShippingError(res.error); return res.data }
  const rpc = async (name, args) => unwrap(await client.rpc(name, args))

  return {
    /** Couriers for the ship form (active only) or the settings card (all). */
    async listCouriers({ includeInactive = false } = {}) {
      let q = client.from('couriers').select('code, name, tracking_url_template, supports_api, active, sort_order').order('sort_order', { ascending: true }).order('name', { ascending: true })
      if (!includeInactive) q = q.eq('active', true)
      return (unwrap(await q) || []).map(mapCourierRow)
    },
    /** Admin catalogue edit (RLS limits it to admins). `code` is the primary key; the rest is editable. */
    async saveCourier(c) {
      const row = {
        code: String(c.code || '').trim().toLowerCase(),
        name: String(c.name || '').trim(),
        tracking_url_template: String(c.trackingUrlTemplate || '').trim() || null,
        supports_api: !!c.supportsApi,
        active: c.active !== false,
        sort_order: Number.isFinite(Number(c.sortOrder)) ? Number(c.sortOrder) : 100,
        updated_at: new Date().toISOString(),
      }
      return mapCourierRow(unwrap(await client.from('couriers').upsert(row, { onConflict: 'code' }).select().single()))
    },

    /** payload = validateShipForm(...).payload. Safe to retry: the same courier + tracking number is the same parcel. */
    async shipOrder(payload) {
      const d = await rpc('ship_order', payload)
      return { created: !!d.created, shipment: mapShipmentRow(d.shipment), orderStatus: d.order_status }
    },
    /** One tracking update. `eventKey` makes a retry harmless (generate it ONCE per click and reuse it when retrying). */
    async addEvent({ shipmentId, type, occurredAt = null, location = null, description = null, eventKey = null }) {
      const d = await rpc('add_shipment_event', {
        p_shipment_id: shipmentId, p_event_type: type, p_occurred_at: occurredAt, p_location: location || null,
        p_description: description || null, p_provider_event_id: eventKey || newEventKey(),
      })
      return { inserted: !!d.inserted, status: d.status, orderStatus: d.order_status }
    },
    async markDelivered(orderId, deliveredAt = null) {
      const d = await rpc('mark_delivered', { p_order_id: orderId, p_delivered_at: deliveredAt })
      return { already: !!d.already, orderStatus: d.order_status, deliveredAt: d.delivered_at || null }
    },
    async updateShipment(shipmentId, fields) {
      const d = await rpc('update_shipment', { p_shipment_id: shipmentId, p_patch: toShipmentPatch(fields) })
      return mapShipmentRow({ ...d.shipment, shipment_private: [{ charges: d.charges, note: d.note }] })
    },
    async cancelShipment(shipmentId, reason = null) {
      const d = await rpc('cancel_shipment', { p_shipment_id: shipmentId, p_reason: reason || null })
      return { already: !!d.already, orderStatus: d.order_status }
    },
  }
}