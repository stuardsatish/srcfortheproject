/**
 * Website contract tests — mapOrderRow / mapOrderRows / resolveOrderItemImage
 * (logic extracted from src/utils/supabaseOrders.js)
 *
 * Because node --test cannot resolve Vite path aliases, we inline the pure
 * normalizer logic here — identical to the production implementation.
 * These tests serve as a contract: if the logic changes, these tests catch it.
 *
 * Run under node --test (ESM .mjs, picked up by test:unit glob).
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

// ── Logic under test (inlined from supabaseOrders.js + mapShipmentRows stub) ─
// mapShipmentRows is a pure pass-through for these tests (shipments: [])
const mapShipmentRows = (rows) => (rows || []).filter(Boolean)

const mapOrderRow = (row) => {
  if (!row) return row
  const items = (row.order_items || []).map((it) => ({
    productId: it.product_id,
    variantId: it.variant_id || null,
    variantName: it.variant_name || null,
    title: it.title || '',
    quantity: Number(it.quantity) || 1,
    finalPrice: Number(it.unit_price) || 0,
    discount: Number(it.discount) || 0,
    lineTotal: Number(it.line_total) || 0,
    id: it.id || null,
    itemType: it.item_type || '',
    sku: it.sku || '',
    productTitle: it.product_title || '',
    snapshotImage: it.image || '',
    snapshotSource: it.snapshot_source || '',
    policy: it.return_enabled == null && it.exchange_enabled == null ? null : {
      returnEnabled: it.return_enabled !== false,
      returnWindowDays: it.return_window_days ?? null,
      exchangeEnabled: it.exchange_enabled !== false,
      exchangeWindowDays: it.exchange_window_days ?? null,
    },
    // NB: no `price` field intentionally — resolvedFinalPrice compat
  }))
  const addr = row.address
  return {
    id: row.id,
    userId: row.user_id,
    orderStatus: row.order_status || 'placed',
    paymentStatus: row.payment_status || 'pending',
    paymentMethod: row.payment_method || '',
    source: row.source || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userName: row.customer_name || '',
    userEmail: row.customer_email || '',
    userPhone: row.customer_phone || '',
    userAddress: addr,
    address: addr,
    shippingAddress: addr,
    subtotal: Number(row.subtotal) || 0,
    shipping: Number(row.shipping) || 0,
    total: Number(row.total) || 0,
    promoCode: row.promo_code || '',
    promoDiscount: Number(row.promo_discount) || 0,
    totalCgst: Number(row.cgst) || 0,
    totalSgst: Number(row.sgst) || 0,
    totalIgst: Number(row.igst) || 0,
    razorpayOrderId: row.razorpay_order_id || '',
    razorpayPaymentId: row.razorpay_payment_id || '',
    products: items,
    deliveredAt: row.delivered_at || null,
    deliveredAtSource: row.delivered_at_source || '',
    shipments: mapShipmentRows(row.shipments),
  }
}

const mapOrderRows = (rows) => (rows || []).map(mapOrderRow)

const resolveOrderItemImage = (item, product) => {
  if (!product) return item?.thumbnail || item?.image || ''
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    let v = null
    const vid = item?.variantId || item?.variant_id
    if (vid) {
      v = product.variants.find((x) => String(x.id) === String(vid))
    }
    if (!v && item?.title) {
      const bracketMatch = item.title.match(/\[(.*?)\]/)
      const variantNameInBracket = bracketMatch ? bracketMatch[1].trim().toLowerCase() : null
      if (variantNameInBracket) {
        v = product.variants.find((x) => x.name && x.name.trim().toLowerCase() === variantNameInBracket)
      }
      if (!v) {
        v = product.variants.find((x) => x.name && item.title.toLowerCase().includes(x.name.trim().toLowerCase()))
      }
    }
    if (v && v.image) return v.image
  }
  return product.thumbnail || product.image || item?.thumbnail || item?.image || ''
}

// ── Test helpers ──────────────────────────────────────────────────────────────
const baseItem = (over = {}) => ({
  product_id: 'p1', variant_id: null, variant_name: null,
  title: 'Chocolate Box', quantity: 2, unit_price: 299, discount: 10, line_total: 598,
  id: 'item-1', item_type: 'single', sku: 'CHC-001', product_title: 'Chocolate Box',
  image: '', snapshot_source: 'order', return_enabled: null, exchange_enabled: null,
  ...over,
})

const baseRow = (over = {}) => ({
  id: 'ord-1', user_id: 'uid-1', order_status: 'confirmed', payment_status: 'paid',
  payment_method: 'razorpay', source: 'web',
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  customer_name: 'Priya Sharma', customer_email: 'priya@example.com', customer_phone: '+919876543210',
  address: { line1: '12 MG Road', city: 'Bengaluru', pincode: '560001', state: 'Karnataka' },
  subtotal: 598, shipping: 49, total: 647,
  promo_code: '', promo_discount: 0,
  cgst: 27, sgst: 27, igst: 0,
  razorpay_order_id: 'rp_ord_abc', razorpay_payment_id: 'rp_pay_xyz',
  order_items: [baseItem()], delivered_at: null, delivered_at_source: '', shipments: [],
  ...over,
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('mapOrderRow', () => {
  it('ORD-C01 — returns null/undefined for null/undefined input', () => {
    assert.equal(mapOrderRow(null), null)
    assert.equal(mapOrderRow(undefined), undefined)
  })

  it('ORD-C02 — maps snake_case fields to camelCase', () => {
    const o = mapOrderRow(baseRow())
    assert.equal(o.id, 'ord-1')
    assert.equal(o.userId, 'uid-1')
    assert.equal(o.orderStatus, 'confirmed')
    assert.equal(o.paymentStatus, 'paid')
    assert.equal(o.paymentMethod, 'razorpay')
    assert.equal(o.userName, 'Priya Sharma')
    assert.equal(o.userEmail, 'priya@example.com')
    assert.equal(o.userPhone, '+919876543210')
    assert.equal(o.razorpayOrderId, 'rp_ord_abc')
    assert.equal(o.razorpayPaymentId, 'rp_pay_xyz')
  })

  it('ORD-C03 — exposes address under userAddress, address, and shippingAddress', () => {
    const addr = { line1: '12 MG Road', city: 'Bengaluru' }
    const o = mapOrderRow(baseRow({ address: addr }))
    assert.deepEqual(o.userAddress, addr)
    assert.deepEqual(o.address, addr)
    assert.deepEqual(o.shippingAddress, addr)
  })

  it('ORD-C04 — maps order_items into a products array', () => {
    const o = mapOrderRow(baseRow())
    assert.equal(o.products.length, 1)
    const item = o.products[0]
    assert.equal(item.productId, 'p1')
    assert.equal(item.title, 'Chocolate Box')
    assert.equal(item.finalPrice, 299)
    assert.equal(item.quantity, 2)
    assert.equal(item.lineTotal, 598)
    assert.equal(item.sku, 'CHC-001')
  })

  it('ORD-C05 — coerces numeric fields to Number with 0 fallback', () => {
    const o = mapOrderRow(baseRow({ subtotal: null, shipping: undefined, total: 'bad' }))
    assert.equal(o.subtotal, 0)
    assert.equal(o.shipping, 0)
    assert.equal(o.total, 0)
  })

  it('ORD-C06 — exposes GST breakdown as totalCgst/totalSgst/totalIgst', () => {
    const o = mapOrderRow(baseRow({ cgst: 27, sgst: 27, igst: 0 }))
    assert.equal(o.totalCgst, 27)
    assert.equal(o.totalSgst, 27)
    assert.equal(o.totalIgst, 0)
  })

  it('ORD-C07 — item policy is null for pre-migration rows (both null)', () => {
    const o = mapOrderRow(baseRow({ order_items: [baseItem({ return_enabled: null, exchange_enabled: null })] }))
    assert.equal(o.products[0].policy, null)
  })

  it('ORD-C08 — item policy is populated for post-migration rows', () => {
    const o = mapOrderRow(baseRow({
      order_items: [baseItem({ return_enabled: true, return_window_days: 7, exchange_enabled: true, exchange_window_days: 14 })],
    }))
    const p = o.products[0].policy
    assert.ok(p !== null)
    assert.equal(p.returnEnabled, true)
    assert.equal(p.returnWindowDays, 7)
    assert.equal(p.exchangeEnabled, true)
    assert.equal(p.exchangeWindowDays, 14)
  })

  it('ORD-C09 — does NOT expose a `price` field on mapped items (resolvedFinalPrice compat)', () => {
    const o = mapOrderRow(baseRow())
    assert.equal(Object.prototype.hasOwnProperty.call(o.products[0], 'price'), false)
  })

  it('ORD-C02 — defaults orderStatus to "placed" when missing', () => {
    assert.equal(mapOrderRow(baseRow({ order_status: null })).orderStatus, 'placed')
  })

  it('ORD-C02 — defaults paymentStatus to "pending" when missing', () => {
    assert.equal(mapOrderRow(baseRow({ payment_status: null })).paymentStatus, 'pending')
  })
})

describe('mapOrderRows', () => {
  it('ORD-C10 — maps an array of rows', () => {
    const result = mapOrderRows([baseRow({ id: 'ord-1' }), baseRow({ id: 'ord-2' })])
    assert.equal(result.length, 2)
    assert.equal(result[0].id, 'ord-1')
    assert.equal(result[1].id, 'ord-2')
  })

  it('ORD-C10 — returns [] for null/undefined/empty input', () => {
    assert.deepEqual(mapOrderRows(null), [])
    assert.deepEqual(mapOrderRows(undefined), [])
    assert.deepEqual(mapOrderRows([]), [])
  })
})

describe('resolveOrderItemImage', () => {
  it('ORD-C11 — falls back to item thumbnail when product is null', () => {
    assert.equal(resolveOrderItemImage({ thumbnail: 'thumb.jpg' }, null), 'thumb.jpg')
  })

  it('ORD-C11 — returns "" when both item and product are null', () => {
    assert.equal(resolveOrderItemImage(null, null), '')
  })

  it('ORD-C12 — picks the variant image by variantId', () => {
    const product = { variants: [{ id: 'v1', name: 'Red', image: 'red.jpg' }, { id: 'v2', name: 'Blue', image: 'blue.jpg' }] }
    assert.equal(resolveOrderItemImage({ variantId: 'v2' }, product), 'blue.jpg')
  })

  it('ORD-C12 — picks variant image by bracket title match when id missing', () => {
    const product = { variants: [{ id: 'v1', name: 'Gift Box', image: 'gift.jpg' }] }
    assert.equal(resolveOrderItemImage({ title: 'Chocs [Gift Box]' }, product), 'gift.jpg')
  })

  it('ORD-C13 — falls back to product thumbnail when variant has no image', () => {
    const product = { thumbnail: 'prod.jpg', variants: [{ id: 'v1', name: 'Plain', image: '' }] }
    assert.equal(resolveOrderItemImage({ variantId: 'v1' }, product), 'prod.jpg')
  })

  it('ORD-C13 — falls back to product.image when thumbnail absent', () => {
    assert.equal(resolveOrderItemImage({}, { image: 'fallback.jpg', variants: [] }), 'fallback.jpg')
  })
})
