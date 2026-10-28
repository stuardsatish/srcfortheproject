// node --test src/features/orders/__tests__/shipmentModel.test.mjs   (npm run test:unit)
// Also run against the RN copy of the module (src/utils/shipmentModel.js) by tools/browser-test/Run-RnParity.ps1.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  shipmentStatusMeta, eventLabel, mapShipmentRow, mapShipmentRows, customerEvents, activeShipments, summarizeTracking, trackingHeadline,
  trackingSteps, urlEncode, trackingUrlFromTemplate, isHttpUrl, remainingByLine, validateShipForm, ADMIN_EVENT_CHOICES, formatDay,
  SHIPMENT_STATUSES, SHIPMENT_EVENT_TYPES, SHIPMENTS_SELECT_CUSTOMER, SHIPMENTS_SELECT_ADMIN,
} from '../shipmentModel.js'

const row = (o = {}) => ({
  id: 's1', order_id: 'o1', direction: 'outbound', courier_code: 'dtdc', courier_name: 'DTDC', tracking_number: 'AWB1', tracking_url: 'https://t.test/AWB1',
  shipped_at: '2026-10-10T10:00:00Z', expected_delivery_date: '2026-10-15', delivered_at: null, status: 'created', last_event_at: '2026-10-10T10:00:00Z',
  created_at: '2026-10-10T10:00:00Z', shipment_items: [{ order_item_id: 'i1', quantity: 2 }], shipment_events: [
    { id: 'e1', event_type: 'created', occurred_at: '2026-10-10T10:00:00Z', location: null, description: 'Shipment created', created_at: '2026-10-10T10:00:00Z' },
  ], ...o,
})
const order = (o = {}) => ({
  id: 'o1', orderStatus: 'shipped', deliveredAt: null, shipments: [mapShipmentRow(row())],
  products: [{ id: 'i1', title: 'Shirt', variantName: 'Pink', quantity: 2 }, { id: 'i2', title: 'Mug', quantity: 1 }], ...o,
})

describe('status metadata', () => {
  it('has a label, tone and step for every status the database allows', () => {
    for (const s of SHIPMENT_STATUSES) {
      const m = shipmentStatusMeta(s)
      assert.ok(m.label && m.tone, s)
      assert.equal(m.status, s)
    }
    assert.equal(shipmentStatusMeta('delivered').tone, 'success')
    assert.equal(shipmentStatusMeta('delivery_failed').tone, 'warning')
    assert.equal(shipmentStatusMeta('returned_to_sender').tone, 'danger')
  })
  it('does not throw on an unknown status (a newer server)', () => {
    assert.deepEqual([shipmentStatusMeta('weird_state').label, shipmentStatusMeta('weird_state').tone], ['Weird state', 'neutral'])
    assert.equal(shipmentStatusMeta(undefined).label, 'Unknown')
  })
  it('labels every event type', () => {
    for (const t of SHIPMENT_EVENT_TYPES) assert.ok(eventLabel(t), t)
    assert.equal(eventLabel('created'), 'Shipped')
    assert.equal(eventLabel('brand_new'), 'Brand new')
  })
})

describe('mapShipmentRow', () => {
  it('maps a row with embeds to camelCase and sorts events newest first', () => {
    const s = mapShipmentRow(row({ shipment_events: [
      { id: 'a', event_type: 'created', occurred_at: '2026-10-10T10:00:00Z' },
      { id: 'c', event_type: 'delivered', occurred_at: '2026-10-12T10:00:00Z', location: 'Home' },
      { id: 'b', event_type: 'in_transit', occurred_at: '2026-10-11T10:00:00Z' },
    ] }))
    assert.deepEqual(s.events.map((e) => e.id), ['c', 'b', 'a'])
    assert.equal(s.events[0].location, 'Home')
    assert.equal(s.trackingNumber, 'AWB1')
    assert.deepEqual(s.items, [{ orderItemId: 'i1', quantity: 2 }])
    assert.equal(s.charges, null)
    assert.equal(s.note, '')
  })
  it('reads the admin-only embed as object or one-element array, and tolerates its absence', () => {
    assert.equal(mapShipmentRow(row({ shipment_private: { charges: '55.50', note: 'fragile' } })).charges, 55.5)
    assert.equal(mapShipmentRow(row({ shipment_private: [{ charges: 10, note: 'x' }] })).note, 'x')
    assert.equal(mapShipmentRow(row({ shipment_private: [] })).charges, null)
  })
  it('a return shipment carries its request and the pickup reference', () => {
    const s = mapShipmentRow(row({ direction: 'return', request_id: 'req-1', pickup_reference: 'PK-9' }))
    assert.deepEqual([s.direction, s.requestId, s.pickupReference], ['return', 'req-1', 'PK-9'])
    const o = mapShipmentRow(row())
    assert.deepEqual([o.requestId, o.pickupReference], [null, ''])
  })
  it('null in, null out; list helper drops nulls', () => {
    assert.equal(mapShipmentRow(null), null)
    assert.deepEqual(mapShipmentRows([null, row()]).map((s) => s.id), ['s1'])
    assert.deepEqual(mapShipmentRows(undefined), [])
  })
  it('customers do not see staff "details updated" notes', () => {
    const s = mapShipmentRow(row({ shipment_events: [
      { id: 'a', event_type: 'created', occurred_at: '2026-10-10T10:00:00Z' }, { id: 'n', event_type: 'note', occurred_at: '2026-10-10T11:00:00Z', description: 'Shipment details updated' },
    ] }))
    assert.deepEqual(customerEvents(s).map((e) => e.id), ['a'])
  })
  it('the embed strings never ask the events table for columns customers cannot read', () => {
    for (const sel of [SHIPMENTS_SELECT_CUSTOMER, SHIPMENTS_SELECT_ADMIN]) {
      assert.ok(!/shipment_events\(\*/.test(sel))
      assert.ok(!/payload|provider|created_by/.test(sel))
    }
    assert.ok(SHIPMENTS_SELECT_ADMIN.includes('shipment_private') && !SHIPMENTS_SELECT_CUSTOMER.includes('shipment_private'))
  })
})

describe('summarizeTracking', () => {
  it('an order without shipment rows: legacy shipped is flagged, nothing is invented', () => {
    const t = summarizeTracking({ orderStatus: 'shipped', shipments: [] })
    assert.deepEqual([t.hasShipments, t.legacyShipped, t.trackingNumber, t.status], [false, true, '', null])
    assert.equal(summarizeTracking({ orderStatus: 'confirmed' }).legacyShipped, false)
    assert.equal(summarizeTracking(null).hasShipments, false)
  })
  it('one parcel: courier, number, link, status, expected date', () => {
    const t = summarizeTracking(order())
    assert.deepEqual([t.hasShipments, t.total, t.courierName, t.trackingNumber, t.trackingUrl, t.status, t.expectedDeliveryDate],
      [true, 1, 'DTDC', 'AWB1', 'https://t.test/AWB1', 'created', '2026-10-15'])
    assert.equal(t.meta.label, 'Shipped')
    assert.equal(t.lastEvent.type, 'created')
  })
  it('cancelled and non-outbound shipments are ignored', () => {
    const o = order({ shipments: [mapShipmentRow(row({ id: 'x', status: 'cancelled' })), mapShipmentRow(row({ id: 'y', direction: 'return' }))] })
    assert.equal(activeShipments(o).length, 0)
    assert.equal(summarizeTracking(o).hasShipments, false)
  })
  it('two parcels: the least advanced open one is the focus; delivered ones are counted', () => {
    const a = mapShipmentRow(row({ id: 'a', status: 'delivered', delivered_at: '2026-10-12T00:00:00Z', created_at: '2026-10-10T10:00:00Z', tracking_number: 'A' }))
    const b = mapShipmentRow(row({ id: 'b', status: 'in_transit', created_at: '2026-10-10T11:00:00Z', tracking_number: 'B' }))
    const c = mapShipmentRow(row({ id: 'c', status: 'out_for_delivery', created_at: '2026-10-10T12:00:00Z', tracking_number: 'C' }))
    const t = summarizeTracking(order({ shipments: [a, c, b] }))
    assert.deepEqual([t.total, t.deliveredCount, t.multiple, t.trackingNumber, t.status], [3, 1, true, 'B', 'in_transit'])
    assert.equal(trackingHeadline(order({ shipments: [a, c, b] })), '3 parcels · 1 delivered')
  })
  it('all parcels delivered: delivered, the order delivery time is used', () => {
    const a = mapShipmentRow(row({ id: 'a', status: 'delivered', delivered_at: '2026-10-12T00:00:00Z' }))
    const t = summarizeTracking(order({ orderStatus: 'delivered', deliveredAt: '2026-10-12T00:00:00Z', shipments: [a] }))
    assert.deepEqual([t.status, t.expectedDeliveryDate, t.deliveredAt], ['delivered', null, '2026-10-12T00:00:00Z'])
  })
  it('a failed attempt needs attention', () => {
    const t = summarizeTracking(order({ shipments: [mapShipmentRow(row({ status: 'delivery_failed' }))] }))
    assert.equal(t.needsAttention, true)
    assert.equal(summarizeTracking(order()).needsAttention, false)
  })
})

describe('trackingHeadline and trackingSteps', () => {
  it('headline without shipment rows follows the order status', () => {
    assert.equal(trackingHeadline({ orderStatus: 'placed' }), 'Processing')
    assert.equal(trackingHeadline({ orderStatus: 'confirmed' }), 'Confirmed')
    assert.equal(trackingHeadline({ orderStatus: 'shipped' }), 'Shipped')
    assert.equal(trackingHeadline({ orderStatus: 'delivered' }), 'Delivered')
    assert.equal(trackingHeadline({ orderStatus: 'cancelled' }), 'Cancelled')
  })
  it('headline with a parcel is the courier status', () => {
    assert.equal(trackingHeadline(order({ shipments: [mapShipmentRow(row({ status: 'out_for_delivery' }))] })), 'Out for delivery')
  })
  const done = (steps) => steps.filter((s) => s.done).map((s) => s.key)
  it('stepper: placed / confirmed / shipped / out for delivery / delivered', () => {
    assert.deepEqual(done(trackingSteps({ orderStatus: 'placed' })), ['placed'])
    assert.deepEqual(done(trackingSteps({ orderStatus: 'confirmed' })), ['placed', 'confirmed'])
    assert.deepEqual(done(trackingSteps({ orderStatus: 'shipped' })), ['placed', 'confirmed', 'shipped'])
    assert.deepEqual(done(trackingSteps(order({ shipments: [mapShipmentRow(row({ status: 'out_for_delivery' }))] }))), ['placed', 'confirmed', 'shipped', 'out_for_delivery'])
    assert.deepEqual(done(trackingSteps({ orderStatus: 'delivered' })), ['placed', 'confirmed', 'shipped', 'out_for_delivery', 'delivered'])
    assert.equal(trackingSteps({ orderStatus: 'shipped' }).find((s) => s.current).key, 'shipped')
  })
  it('stepper flags a failed delivery attempt on its step', () => {
    const steps = trackingSteps(order({ shipments: [mapShipmentRow(row({ status: 'delivery_failed' }))] }))
    assert.deepEqual(steps.filter((s) => s.warn).map((s) => s.key), ['out_for_delivery'])
  })
})

describe('tracking link (twin of the SQL helper)', () => {
  it('encodes like app_urlencode: only A-Z a-z 0-9 _ . ~ - are kept', () => {
    assert.equal(urlEncode('AB 12/3'), 'AB%2012%2F3')
    assert.equal(urlEncode('x&y=z'), 'x%26y%3Dz')
    assert.equal(urlEncode("a!'()*b"), 'a%21%27%28%29%2Ab')
    assert.equal(urlEncode('Rs.5~x_y-z'), 'Rs.5~x_y-z')
    assert.equal(urlEncode(''), '')
  })
  it('fills {tracking}; no template / no number / no placeholder -> null', () => {
    assert.equal(trackingUrlFromTemplate('https://t.test/dtdc?awb={tracking}', ' AB 12/3 '), 'https://t.test/dtdc?awb=AB%2012%2F3')
    assert.equal(trackingUrlFromTemplate('https://t.test/{tracking}/x/{tracking}', 'Q1'), 'https://t.test/Q1/x/Q1')
    assert.equal(trackingUrlFromTemplate(null, 'Q1'), null)
    assert.equal(trackingUrlFromTemplate('https://t.test/x', 'Q1'), null)
    assert.equal(trackingUrlFromTemplate('https://t.test/{tracking}', '  '), null)
  })
  it('isHttpUrl accepts http(s) without spaces only', () => {
    assert.deepEqual(['https://a.test/x?y=1', 'http://a', 'HTTPS://A.TEST'].map(isHttpUrl), [true, true, true])
    assert.deepEqual(['ftp://a', 'javascript:alert(1)', 'https://a b', '', 'a.test'].map(isHttpUrl), [false, false, false, false, false])
  })
})

describe('remainingByLine', () => {
  it('counts units already on an active outbound shipment', () => {
    const r = remainingByLine(order())
    assert.deepEqual(r.map((x) => [x.orderItemId, x.quantity, x.shipped, x.remaining]), [['i1', 2, 2, 0], ['i2', 1, 0, 1]])
    assert.equal(r[0].variantName, 'Pink')
  })
  it('a cancelled shipment releases its units; lines without an id are skipped', () => {
    const o = order({ shipments: [mapShipmentRow(row({ status: 'cancelled' }))], products: [{ id: 'i1', title: 'Shirt', quantity: 2 }, { title: 'legacy line', quantity: 1 }] })
    assert.deepEqual(remainingByLine(o).map((x) => x.remaining), [2])
  })
})

describe('validateShipForm', () => {
  const couriers = [{ code: 'dtdc', name: 'DTDC' }, { code: 'manual', name: 'Other' }, { code: 'pickup', name: 'Pickup' }]
  const ctx = { orderId: 'o1', couriers, now: '2026-10-17T10:00:00Z', remaining: { i1: 2, i2: 1 } }
  const ok = (form) => validateShipForm({ courierCode: 'dtdc', trackingNumber: 'AWB1', ...form }, ctx)

  it('a minimal valid form builds the RPC arguments', () => {
    const r = ok({})
    assert.equal(r.ok, true)
    assert.deepEqual(r.payload, {
      p_order_id: 'o1', p_courier_code: 'dtdc', p_tracking_number: 'AWB1', p_tracking_url: null, p_shipped_at: null, p_charges: null, p_note: null,
      p_items: null, p_courier_name: null, p_expected_delivery_date: null,
    })
    assert.deepEqual(r.warnings, {})
  })
  it('trims, rounds charges, converts the date to ISO, passes the expected date', () => {
    const r = ok({ trackingNumber: '  AWB 9  ', charges: '55.555', shippedAt: '2026-10-16T09:30:00Z', expectedDeliveryDate: '2026-10-20', note: ' fragile ', courierName: ' Rider ' })
    assert.equal(r.ok, true)
    assert.deepEqual([r.payload.p_tracking_number, r.payload.p_charges, r.payload.p_shipped_at, r.payload.p_expected_delivery_date, r.payload.p_note, r.payload.p_courier_name],
      ['AWB 9', 55.56, '2026-10-16T09:30:00.000Z', '2026-10-20', 'fragile', 'Rider'])
  })
  it('requires a known courier', () => {
    assert.ok(validateShipForm({ courierCode: '' }, ctx).errors.courierCode)
    assert.equal(validateShipForm({ courierCode: 'nope' }, ctx).errors.courierCode, 'Unknown courier')
  })
  it('a missing tracking number is a warning, not an error (no courier API is assumed); pickup never warns', () => {
    const r = validateShipForm({ courierCode: 'manual' }, ctx)
    assert.equal(r.ok, true)
    assert.ok(r.warnings.trackingNumber)
    assert.deepEqual(validateShipForm({ courierCode: 'pickup' }, ctx).warnings, {})
  })
  it('rejects bad links, negative / non-numeric charges, future shipping date, expected date before shipping', () => {
    assert.ok(ok({ trackingUrl: 'ftp://x' }).errors.trackingUrl)
    assert.ok(ok({ trackingUrl: 'https://a b' }).errors.trackingUrl)
    assert.ok(ok({ charges: '-1' }).errors.charges)
    assert.ok(ok({ charges: 'abc' }).errors.charges)
    assert.equal(ok({ charges: '0' }).payload.p_charges, 0)
    assert.ok(ok({ shippedAt: '2026-10-19T10:00:00Z' }).errors.shippedAt)
    assert.ok(ok({ shippedAt: 'not a date' }).errors.shippedAt)
    assert.ok(ok({ expectedDeliveryDate: '2026-10-01' }).errors.expectedDeliveryDate)
    assert.ok(ok({ expectedDeliveryDate: '20/10/2026' }).errors.expectedDeliveryDate)
    assert.ok(ok({ note: 'x'.repeat(501) }).errors.note)
    assert.ok(ok({ trackingNumber: 'x'.repeat(81) }).errors.trackingNumber)
  })
  it('partial shipment: quantities are checked against what is left; an empty selection is refused', () => {
    const good = ok({ items: [{ orderItemId: 'i1', quantity: 1 }, { orderItemId: 'i2', quantity: 0 }] })
    assert.equal(good.ok, true)
    assert.deepEqual(good.payload.p_items, [{ order_item_id: 'i1', quantity: 1 }])
    assert.ok(ok({ items: [{ orderItemId: 'i1', quantity: 3 }] }).errors.items)
    assert.ok(ok({ items: [{ orderItemId: 'i1', quantity: 1.5 }] }).errors.items)
    assert.ok(ok({ items: [] }).errors.items)
    assert.ok(ok({ items: [{ orderItemId: 'i1', quantity: 0 }] }).errors.items)
    assert.ok(ok({ items: [{ orderItemId: 'i1', quantity: 1 }, { orderItemId: 'i1', quantity: 1 }] }).errors.items)
  })
})

describe('small helpers', () => {
  it('admin event choices are the tracking events the database accepts (minus created / cancelled)', () => {
    const types = ADMIN_EVENT_CHOICES.map((c) => c.type)
    for (const t of types) assert.ok(SHIPMENT_EVENT_TYPES.includes(t), t)
    assert.ok(!types.includes('created') && !types.includes('cancelled'))
    assert.ok(types.includes('delivered') && types.includes('note'))
  })
  it('formatDay formats a day or a timestamp and survives garbage', () => {
    assert.match(formatDay('2026-10-25'), /25/)
    assert.match(formatDay('2026-10-25T08:00:00Z'), /2[45]/)
    assert.equal(formatDay(''), '')
    assert.equal(formatDay('nonsense'), '')
    assert.equal(formatDay(null), '')
  })
})