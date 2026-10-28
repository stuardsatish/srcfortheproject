// node --test src/services/shipping/__tests__/shippingService.test.mjs   (npm run test:unit)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createShippingService, toShippingError, isMissingShipmentsRelation, queryOrdersWithShipments, toShipmentPatch } from '../shippingService.js'
import { mapCourierRow, courierOptions, previewTrackingUrl, isManualTracking, getProvider, providers, MANUAL_COURIER, slugCourierCode, validateCourier } from '../couriers.js'
import { manualCourier, newEventKey } from '../manualCourier.js'

/** a chainable, awaitable stand-in for a supabase query builder */
function builder(result, log, table) {
  const b = {}
  for (const m of ['select', 'order', 'eq', 'upsert', 'single', 'maybeSingle']) b[m] = (...args) => { log.push([table, m, ...args]); return b }
  b.then = (res, rej) => Promise.resolve(result).then(res, rej)
  return b
}
function fakeClient({ tables = {}, rpcs = {} } = {}) {
  const log = []
  return {
    log,
    from: (t) => builder(tables[t] ?? { data: [], error: null }, log, t),
    rpc: async (name, args) => { log.push(['rpc', name, args]); const r = rpcs[name]; return typeof r === 'function' ? r(args) : (r ?? { data: null, error: null }) },
  }
}
const shipmentRow = { id: 's1', order_id: 'o1', direction: 'outbound', courier_code: 'dtdc', courier_name: 'DTDC', tracking_number: 'A1', status: 'created', created_at: '2026-10-10T10:00:00Z' }

describe('couriers', () => {
  it('maps a row, treats active as default-on', () => {
    assert.deepEqual(mapCourierRow({ code: 'dtdc', name: 'DTDC', tracking_url_template: 'https://t/{tracking}', supports_api: false, sort_order: 30 }),
      { code: 'dtdc', name: 'DTDC', trackingUrlTemplate: 'https://t/{tracking}', supportsApi: false, active: true, sortOrder: 30 })
    assert.equal(mapCourierRow({ code: 'x', name: 'X', active: false }).active, false)
  })
  it('options: active only, in the admin order, and "manual" is always offered', () => {
    const list = [
      { code: 'b', name: 'B', active: true, sortOrder: 2 }, { code: 'a', name: 'A', active: true, sortOrder: 2 }, { code: 'z', name: 'Z', active: false, sortOrder: 1 },
    ]
    assert.deepEqual(courierOptions(list).map((c) => c.code), ['manual', 'a', 'b'])
    assert.deepEqual(courierOptions(list, { includeInactive: true }).map((c) => c.code), ['manual', 'z', 'a', 'b'])
    // a catalogue that already contains "manual" is used as it is (no duplicate is added)
    assert.deepEqual(courierOptions([{ code: 'manual', name: 'M', active: true, sortOrder: 5 }, ...list]).map((c) => c.code), ['a', 'b', 'manual'])
    assert.deepEqual(courierOptions(undefined).map((c) => c.code), ['manual'])
  })
  it('previews the link the database will generate; manual tracking unless the courier has an API', () => {
    assert.equal(previewTrackingUrl({ trackingUrlTemplate: 'https://t.test/?q={tracking}' }, 'A 1'), 'https://t.test/?q=A%201')
    assert.equal(previewTrackingUrl({ trackingUrlTemplate: '' }, 'A1'), null)
    assert.equal(previewTrackingUrl(null, 'A1'), null)
    assert.equal(isManualTracking({ supportsApi: false }), true)
    assert.equal(isManualTracking({ supportsApi: true }), false)
  })
  it('the registry only knows the manual adapter (no courier API is integrated)', () => {
    assert.deepEqual(Object.keys(providers), [MANUAL_COURIER])
    assert.equal(getProvider('dtdc'), null)
    assert.equal(getProvider('manual'), manualCourier)
  })
})

describe('courier admin form', () => {
  it('makes a database-safe code from a name', () => {
    assert.equal(slugCourierCode('Anjani Courier & Cargo'), 'anjani_courier_cargo')
    assert.equal(slugCourierCode('  DTDC  '), 'dtdc')
    assert.equal(slugCourierCode('***'), '')
    assert.equal(slugCourierCode('x'.repeat(60)).length, 40)
  })
  it('accepts a valid new courier and normalizes it', () => {
    const r = validateCourier({ name: ' Acme ', code: 'ACME', trackingUrlTemplate: ' https://t.test/{tracking} ', active: true }, { existing: [{ code: 'dtdc' }], isNew: true })
    assert.equal(r.ok, true)
    assert.deepEqual(r.value, { code: 'acme', name: 'Acme', trackingUrlTemplate: 'https://t.test/{tracking}', supportsApi: false, active: true, sortOrder: 100 })
  })
  it('applies the same rules as the table constraints', () => {
    assert.ok(validateCourier({ name: '', code: 'ab' }).errors.name)
    assert.ok(validateCourier({ name: 'x'.repeat(81), code: 'ab' }).errors.name)
    assert.ok(validateCourier({ name: 'A', code: 'B' }).errors.code)
    assert.ok(validateCourier({ name: 'A', code: 'has space' }).errors.code)
    assert.ok(validateCourier({ name: 'A', code: 'dtdc' }, { existing: [{ code: 'dtdc' }], isNew: true }).errors.code)
    assert.equal(validateCourier({ name: 'A', code: 'dtdc' }, { existing: [{ code: 'dtdc' }], isNew: false }).ok, true)
    assert.ok(validateCourier({ name: 'A', code: 'ab', trackingUrlTemplate: 'ftp://x/{tracking}' }).errors.trackingUrlTemplate)
    assert.ok(validateCourier({ name: 'A', code: 'ab', trackingUrlTemplate: 'https://x/track' }).errors.trackingUrlTemplate)
    assert.ok(validateCourier({ name: 'A', code: 'ab', trackingUrlTemplate: 'https://x /{tracking}' }).errors.trackingUrlTemplate)
    assert.equal(validateCourier({ name: 'A', code: 'ab', trackingUrlTemplate: '' }).ok, true)
  })
  it('the manual courier can never be switched off', () => {
    assert.ok(validateCourier({ name: 'Other', code: 'manual', active: false }).errors.active)
    assert.equal(validateCourier({ name: 'Other', code: 'manual', active: true }).ok, true)
  })
})

describe('manual courier adapter', () => {
  it('normalizes a hand-entered event and gives it a retry key; refuses system-only types', () => {
    const e = manualCourier.normalizeEvent({ type: 'in_transit', occurredAt: '2026-10-11T10:00:00Z', location: 'Hub' })
    assert.deepEqual([e.type, e.occurredAt, e.location, e.description], ['in_transit', '2026-10-11T10:00:00Z', 'Hub', null])
    assert.ok(e.eventKey.length >= 8)
    assert.equal(manualCourier.normalizeEvent({ type: 'created' }), null)
    assert.equal(manualCourier.normalizeEvent({ type: 'cancelled' }), null)
    assert.equal(manualCourier.normalizeEvent({ type: 'bogus' }), null)
    assert.equal(manualCourier.normalizeEvent(null), null)
    assert.equal(manualCourier.normalizeEvent({ type: 'delivered', eventKey: 'mine' }).eventKey, 'mine')
  })
  it('event keys are unique', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newEventKey()))
    assert.equal(keys.size, 50)
  })
})

describe('error mapping', () => {
  it('keeps the readable database message; translates the two infrastructure cases', () => {
    assert.equal(toShippingError({ message: 'An order that is "delivered" cannot be shipped', code: '22023' }).message, 'An order that is "delivered" cannot be shipped')
    assert.match(toShippingError({ message: 'Could not find the function public.ship_order', code: 'PGRST202' }).message, /not available on the server yet/)
    assert.equal(toShippingError({ message: 'permission denied for function ship_order', code: '42501' }).message, 'You do not have permission to do that.')
    assert.equal(toShippingError({ message: 'Admin access required', code: '42501' }).message, 'Admin access required')
    assert.equal(toShippingError({}).message, 'Something went wrong')
    assert.equal(toShippingError({ message: 'x', code: '22023' }).code, '22023')
  })
  it('recognises a server without the shipping tables', () => {
    assert.equal(isMissingShipmentsRelation({ code: 'PGRST200', message: "Could not find a relationship between 'orders' and 'shipments'" }), true)
    assert.equal(isMissingShipmentsRelation({ code: 'PGRST205' }), true)
    assert.equal(isMissingShipmentsRelation({ message: 'relation "public.shipments" does not exist' }), true)
    assert.equal(isMissingShipmentsRelation({ code: '42501', message: 'permission denied for table orders' }), false)
    assert.equal(isMissingShipmentsRelation(null), false)
  })
})

describe('queryOrdersWithShipments', () => {
  it('asks for the shipment embeds first (customer vs admin column lists)', async () => {
    const seen = []
    await queryOrdersWithShipments(async (s) => { seen.push(s); return { data: [], error: null } })
    await queryOrdersWithShipments(async (s) => { seen.push(s); return { data: [], error: null } }, { admin: true })
    assert.ok(seen[0].includes('shipments(') && !seen[0].includes('shipment_private'))
    assert.ok(seen[1].includes('shipment_private'))
  })
  it('falls back to the old select when the server has no shipping tables yet', async () => {
    const seen = []
    const r = await queryOrdersWithShipments(async (s) => { seen.push(s); return s.includes('shipments(') ? { data: null, error: { code: 'PGRST200', message: 'no relationship' } } : { data: [{ id: 'o1' }], error: null } })
    assert.deepEqual(seen, [seen[0], '*, order_items(*)'])
    assert.deepEqual(r.data, [{ id: 'o1' }])
  })
  it('does NOT swallow other errors', async () => {
    let calls = 0
    const r = await queryOrdersWithShipments(async () => { calls++; return { data: null, error: { code: '42501', message: 'permission denied for table orders' } } })
    assert.equal(calls, 1)
    assert.equal(r.error.code, '42501')
  })
})

describe('shipping service', () => {
  it('toShipmentPatch maps only the known keys; empty strings clear', () => {
    assert.deepEqual(toShipmentPatch({ trackingNumber: 'X', note: '', charges: 5, unknown: 1 }), { tracking_number: 'X', note: null, charges: 5 })
    assert.deepEqual(toShipmentPatch(null), {})
  })
  it('listCouriers: active by default, ordered, mapped', async () => {
    const c = fakeClient({ tables: { couriers: { data: [{ code: 'manual', name: 'M', active: true, sort_order: 1 }], error: null } } })
    const out = await createShippingService(c).listCouriers()
    assert.deepEqual(out.map((x) => x.code), ['manual'])
    assert.ok(c.log.some((l) => l[1] === 'eq' && l[2] === 'active' && l[3] === true))
    const c2 = fakeClient()
    await createShippingService(c2).listCouriers({ includeInactive: true })
    assert.ok(!c2.log.some((l) => l[1] === 'eq'))
  })
  it('saveCourier upserts a normalized row', async () => {
    const c = fakeClient({ tables: { couriers: { data: { code: 'acme', name: 'Acme', tracking_url_template: 'https://x/{tracking}', active: true }, error: null } } })
    const saved = await createShippingService(c).saveCourier({ code: ' ACME ', name: ' Acme ', trackingUrlTemplate: ' https://x/{tracking} ', active: true })
    const up = c.log.find((l) => l[1] === 'upsert')
    assert.deepEqual([up[2].code, up[2].name, up[2].tracking_url_template, up[3]], ['acme', 'Acme', 'https://x/{tracking}', { onConflict: 'code' }])
    assert.equal(saved.trackingUrlTemplate, 'https://x/{tracking}')
  })
  it('shipOrder passes the payload through and maps the answer', async () => {
    const c = fakeClient({ rpcs: { ship_order: { data: { ok: true, created: true, shipment: shipmentRow, order_status: 'shipped' }, error: null } } })
    const r = await createShippingService(c).shipOrder({ p_order_id: 'o1', p_courier_code: 'dtdc' })
    assert.deepEqual(c.log[0], ['rpc', 'ship_order', { p_order_id: 'o1', p_courier_code: 'dtdc' }])
    assert.deepEqual([r.created, r.shipment.trackingNumber, r.orderStatus], [true, 'A1', 'shipped'])
  })
  it('addEvent sends a retry key (the same one when the caller supplies it)', async () => {
    const c = fakeClient({ rpcs: { add_shipment_event: { data: { inserted: true, status: 'in_transit', order_status: 'shipped' }, error: null } } })
    const svc = createShippingService(c)
    await svc.addEvent({ shipmentId: 's1', type: 'in_transit', location: 'Hub' })
    await svc.addEvent({ shipmentId: 's1', type: 'in_transit', eventKey: 'my-key' })
    const [first, second] = c.log.map((l) => l[2])
    assert.ok(first.p_provider_event_id.length >= 8)
    assert.equal(second.p_provider_event_id, 'my-key')
    assert.deepEqual([first.p_shipment_id, first.p_event_type, first.p_location, first.p_occurred_at], ['s1', 'in_transit', 'Hub', null])
  })
  it('markDelivered / cancelShipment / updateShipment call their RPCs', async () => {
    const c = fakeClient({ rpcs: {
      mark_delivered: { data: { ok: true, already: false, order_status: 'delivered', delivered_at: '2026-10-17T00:00:00Z' }, error: null },
      cancel_shipment: { data: { ok: true, already: false, order_status: 'confirmed' }, error: null },
      update_shipment: { data: { ok: true, shipment: shipmentRow, charges: '42.00', note: 'n' }, error: null },
    } })
    const svc = createShippingService(c)
    assert.deepEqual(await svc.markDelivered('o1'), { already: false, orderStatus: 'delivered', deliveredAt: '2026-10-17T00:00:00Z' })
    assert.deepEqual(await svc.cancelShipment('s1', 'wrong parcel'), { already: false, orderStatus: 'confirmed' })
    const u = await svc.updateShipment('s1', { trackingNumber: 'NEW', note: '' })
    assert.deepEqual(c.log[2], ['rpc', 'update_shipment', { p_shipment_id: 's1', p_patch: { tracking_number: 'NEW', note: null } }])
    assert.deepEqual([u.charges, u.note], [42, 'n'])
  })
  it('an RPC error becomes a thrown Error with the database message', async () => {
    const c = fakeClient({ rpcs: { ship_order: { data: null, error: { code: '22023', message: 'Every item of this order is already on a shipment' } } } })
    await assert.rejects(() => createShippingService(c).shipOrder({}), (e) => e.message === 'Every item of this order is already on a shipment' && e.code === '22023')
  })
})