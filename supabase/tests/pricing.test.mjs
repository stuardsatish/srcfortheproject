// Unit tests for supabase/functions/_shared/cartPricing.ts and the order payload builder.
// The REAL TypeScript source is imported (Node strips the types) — no copies, no mocks.
//   cd supabase/tests && node --test pricing.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  priceCartItems, parseCartItemRef, collectProductIds, activeProductDiscount, resolveOptionByTitle,
  unitGst, applyGstToItems, sumGstTotals, resolveInterState, round2,
} from '../functions/_shared/cartPricing.ts'
import { toOrderItemsJson } from '../functions/_shared/orderWriter.ts'

const DAY = 86400000
const future = new Date(Date.now() + 30 * DAY).toISOString()
const past = new Date(Date.now() - 2 * DAY).toISOString()

const product = (o = {}) => ({
  id: 'prod_shirt', title: 'Designer Shirt', category: 'shirts', sku: 'DESIGNER-SHIRT', price: 500, stock: 10,
  discount: 0, discount_expiry: null, gst_rate: 12, hsn_code: '6105',
  has_variants: true, main_option_enabled: true, track_inventory: true, variants: [], ...o,
})
const variant = (id, name, price, stock, o = {}) => ({
  id, product_id: 'prod_shirt', name, sku: `DS-${name.toUpperCase()}`, price, stock, track_inventory: true, status: 'active', ...o,
})
const PINK = variant('var_1700000000001_0', 'Pink', 300, 20)
const WHITE = variant('var_1700000000001_1', 'White', 200, 30)
const VIOLET = variant('var_1700000000001_2', 'Violet', 350, 15)

const catalog = (p = product(), vs = [PINK, WHITE, VIOLET]) => ({
  products: new Map([[p.id, p]]),
  variants: new Map([[p.id, vs]]),
})
const price = (items, c = catalog(), opts) => priceCartItems(items, c.products, c.variants, opts)
const line = (productId, variantId, quantity = 1) => ({ productId, variantId, quantity })

describe('purchasable options — main and variants are independent', () => {
  it('prices the main option at the MAIN price and each variant at its OWN price', () => {
    const r = price([line('prod_shirt', '', 1), line('prod_shirt', PINK.id, 1), line('prod_shirt', WHITE.id, 1), line('prod_shirt', VIOLET.id, 1)])
    assert.ok(r.ok)
    assert.deepEqual(r.lineItems.map((l) => [l.itemType, l.variantId ?? null, l.finalPrice]),
      [['main', null, 500], ['variant', PINK.id, 300], ['variant', WHITE.id, 200], ['variant', VIOLET.id, 350]])
    assert.equal(r.subtotal, 1350)
  })

  it('the main price is never derived from the variants (changing variants cannot move it, and vice versa)', () => {
    const cheap = price([line('prod_shirt', '')], catalog(product(), [variant('v1', 'A', 1, 5), variant('v2', 'B', 2, 5)]))
    const dear = price([line('prod_shirt', '')], catalog(product(), [variant('v1', 'A', 9999, 5)]))
    assert.equal(cheap.lineItems[0].finalPrice, 500); assert.equal(dear.lineItems[0].finalPrice, 500)
    const moved = price([line('prod_shirt', PINK.id)], catalog(product({ price: 12345 })))
    assert.equal(moved.lineItems[0].finalPrice, 300)
  })

  it('a single product (no variants) is one main-less option: itemType single', () => {
    const p = product({ id: 'prod_single', has_variants: false })
    const r = price([line('prod_single', '', 3)], { products: new Map([[p.id, p]]), variants: new Map() })
    assert.equal(r.lineItems[0].itemType, 'single')
    assert.equal(r.lineItems[0].variantId, undefined)
    assert.equal(r.subtotal, 1500)
  })

  it('titles and SKUs follow the option; the cart line identity is (product, variant)', () => {
    const r = price([line('prod_shirt', ''), line('prod_shirt', PINK.id)])
    assert.deepEqual(r.lineItems.map((l) => l.title), ['Designer Shirt', 'Designer Shirt [Pink]'])
    assert.deepEqual(r.lineItems.map((l) => l.sku), ['DESIGNER-SHIRT', 'DS-PINK'])
    assert.deepEqual(r.lineItems.map((l) => l.variantName ?? null), [null, 'Pink'])
  })

  it('does NOT add every variant when the main product is bought, nor the main when a variant is bought', () => {
    assert.equal(price([line('prod_shirt', '')]).lineItems.length, 1)
    const v = price([line('prod_shirt', WHITE.id)])
    assert.equal(v.lineItems.length, 1); assert.equal(v.lineItems[0].variantId, WHITE.id)
  })

  it('product-level discount applies to the option\'s own price (main and variant alike)', () => {
    const c = catalog(product({ discount: 10, discount_expiry: future }))
    const r = price([line('prod_shirt', ''), line('prod_shirt', PINK.id)], c)
    assert.deepEqual(r.lineItems.map((l) => [l.originalPrice, l.discount, l.finalPrice]), [[500, 10, 450], [300, 10, 270]])
  })

  it('an expired discount is ignored — except where billing deliberately keeps the legacy quirk', () => {
    const c = catalog(product({ discount: 10, discount_expiry: past }))
    assert.equal(price([line('prod_shirt', '')], c).lineItems[0].finalPrice, 500)
    assert.equal(price([line('prod_shirt', '')], c, { honorDiscountExpiry: false }).lineItems[0].finalPrice, 450)
    assert.equal(activeProductDiscount({ discount: 10, discount_expiry: past }), 0)
    assert.equal(activeProductDiscount({ discount: 10, discount_expiry: null }), 10)
  })
})

describe('availability rules', () => {
  it('main_option_enabled = false: the main option is refused (409), variants still sell', () => {
    const c = catalog(product({ main_option_enabled: false }))
    const main = price([line('prod_shirt', '')], c)
    assert.equal(main.ok, false); assert.equal(main.status, 409); assert.match(main.error, /choose an option/i)
    assert.ok(price([line('prod_shirt', PINK.id)], c).ok)
  })

  it('stock is per option: main out of stock does not block a variant and vice versa', () => {
    const c = catalog(product({ stock: 0 }), [variant('v1', 'A', 100, 5)])
    assert.equal(price([line('prod_shirt', '')], c).status, 409)
    assert.ok(price([line('prod_shirt', 'v1', 5)], c).ok)
    const c2 = catalog(product({ stock: 10 }), [variant('v1', 'A', 100, 0)])
    assert.ok(price([line('prod_shirt', '', 10)], c2).ok)
    const r = price([line('prod_shirt', 'v1')], c2)
    assert.equal(r.status, 409); assert.match(r.error, /Not enough stock for Designer Shirt \(variant A\)/)
  })

  it('track_inventory = false skips the stock check on that option only', () => {
    const c = catalog(product({ stock: 0, track_inventory: false }), [variant('v1', 'A', 100, 0)])
    assert.ok(price([line('prod_shirt', '', 999)], c).ok)
    assert.equal(price([line('prod_shirt', 'v1')], c).status, 409)
    const c2 = catalog(product(), [variant('v1', 'A', 100, 0, { track_inventory: false })])
    assert.ok(price([line('prod_shirt', 'v1', 50)], c2).ok)
  })

  it('inactive variant -> 409; unknown variant -> 400; variant id on a product without variants -> 400', () => {
    const c = catalog(product(), [PINK, variant('var_off', 'Off', 100, 5, { status: 'inactive' })])
    assert.equal(price([line('prod_shirt', 'var_off')], c).status, 409)
    assert.equal(price([line('prod_shirt', 'var_nope')], c).status, 400)
    const p = product({ id: 'prod_plain', has_variants: false })
    const r = priceCartItems([line('prod_plain', PINK.id)], new Map([[p.id, p]]), new Map())
    assert.equal(r.status, 400); assert.match(r.error, /Variant not found/)
  })

  it('invalid lines, unknown product, non-positive price', () => {
    assert.equal(price([{ productId: '', quantity: 1 }]).status, 400)
    assert.equal(price([line('prod_shirt', '', 0)]).status, 400)
    assert.equal(price([line('prod_shirt', '', -2)]).status, 400)
    assert.equal(price([line('prod_missing', '', 1)]).error, 'Product not found: prod_missing')
    assert.match(price([line('prod_shirt', '')], catalog(product({ price: 0 }))).error, /not purchasable/)
    assert.equal(price([line('prod_shirt', '', 2.9)]).lineItems[0].quantity, 2, 'fractional quantity is floored')
  })
})

describe('cart / bill line identity', () => {
  it('parseCartItemRef understands productId+variantId, snake_case, and the legacy compound id', () => {
    assert.deepEqual(parseCartItemRef({ productId: 'prod_1', variantId: 'var_9', quantity: 2 }), { pid: 'prod_1', variantId: 'var_9', qty: 2 })
    assert.deepEqual(parseCartItemRef({ product_id: 'prod_1', variant_id: 'var_9', quantity: 1 }), { pid: 'prod_1', variantId: 'var_9', qty: 1 })
    assert.deepEqual(parseCartItemRef({ id: 'prod_1_var_1700000000001_0', quantity: 1 }), { pid: 'prod_1', variantId: 'var_1700000000001_0', qty: 1 })
    assert.deepEqual(parseCartItemRef({ id: 'prod_1700000000000', quantity: 1 }), { pid: 'prod_1700000000000', variantId: '', qty: 1 }, 'product ids contain underscores — never split on a bare "_"')
    assert.deepEqual(parseCartItemRef({ productId: 'prod_1', variantId: null, quantity: '3' }), { pid: 'prod_1', variantId: '', qty: 3 })
  })

  it('collectProductIds de-duplicates and drops empties', () => {
    assert.deepEqual(collectProductIds([line('a', ''), line('a', 'var_1'), { id: 'b_var_2', quantity: 1 }, { quantity: 1 }]), ['a', 'b'])
  })

  it('the same product as main and as a variant are two independent lines', () => {
    const r = price([line('prod_shirt', '', 1), line('prod_shirt', PINK.id, 2)])
    assert.deepEqual(r.lineItems.map((l) => [l.variantId ?? '', l.quantity]), [['', 1], [PINK.id, 2]])
  })
})

describe('LEGACY mode (Edge Function deployed before migration M1): behaves exactly as before', () => {
  const legacyProduct = product({ variants: [{ id: 'var_a', name: 'A', price: 40, stock: 3, sku: 'S-A' }] })
  const legacy = (items) => priceCartItems(items, new Map([[legacyProduct.id, legacyProduct]]))

  it('prices variants from the jsonb, main from the product', () => {
    const r = legacy([line('prod_shirt', 'var_a', 2), line('prod_shirt', '', 1)])
    assert.deepEqual(r.lineItems.map((l) => [l.title, l.finalPrice]), [['Designer Shirt [A]', 40], ['Designer Shirt', 500]])
  })
  it('unknown variant on a product that HAS variants -> 400; on one without -> priced as main (legacy quirk, variantId kept)', () => {
    assert.equal(legacy([line('prod_shirt', 'var_zzz')]).status, 400)
    const plain = product({ id: 'prod_plain', has_variants: false, variants: [] })
    const r = priceCartItems([line('prod_plain', 'var_zzz')], new Map([[plain.id, plain]]))
    assert.equal(r.lineItems[0].finalPrice, 500); assert.equal(r.lineItems[0].variantId, 'var_zzz')
  })
  it('variant stock from the jsonb is checked', () => {
    assert.equal(legacy([line('prod_shirt', 'var_a', 4)]).status, 409)
  })
})

describe('text resolution (WhatsApp paste / bulk order import)', () => {
  const shirt = product()
  const hoodie = product({ id: 'prod_hoodie', title: 'Hoodie', sku: 'HOOD', main_option_enabled: false })
  const pen = product({ id: 'prod_pen', title: 'Pen [Limited Edition]', has_variants: false, sku: 'PEN' })
  const products = [shirt, hoodie, pen]
  const variants = new Map([
    ['prod_shirt', [PINK, WHITE, variant('var_dupe_a', 'White', 210, 1)]],
    ['prod_hoodie', [variant('var_h1', 'Red / L', 400, 5, { product_id: 'prod_hoodie' }), variant('var_h2', 'Retired', 400, 5, { product_id: 'prod_hoodie', status: 'inactive' })]],
  ])
  const res = (t) => resolveOptionByTitle(t, products, variants)

  it('plain title -> the main option', () => {
    const r = res('Designer Shirt'); assert.ok(r.ok); assert.equal(r.variant, null); assert.equal(r.product.id, 'prod_shirt')
  })
  it('"Title [Variant]" -> that variant (case-insensitive, exact variant name)', () => {
    const r = res('designer shirt [pink]'); assert.ok(r.ok); assert.equal(r.variant.id, PINK.id)
  })
  it('a product whose own title ends in brackets matches as a whole, before the bracket split', () => {
    const r = res('Pen [Limited Edition]'); assert.ok(r.ok); assert.equal(r.product.id, 'prod_pen'); assert.equal(r.variant, null)
  })
  it('refuses to guess: unknown variant, inactive variant, duplicate variant names, unknown product', () => {
    assert.match(res('Designer Shirt [Green]').error, /Variant not found: "Green"/)
    assert.match(res('Hoodie [Retired]').error, /Variant not found/)
    assert.match(res('Designer Shirt [White]').error, /Ambiguous variant "White"/)
    assert.match(res('Nothing Here').error, /Product not found/)
    assert.match(res('Nothing Here [X]').error, /Product not found/)
  })
  it('main option disabled -> must name a variant', () => {
    assert.match(res('Hoodie').error, /no main option/)
    assert.ok(res('Hoodie [Red / L]').ok)
  })
  it('startsWith fallback is kept, ambiguity is reported', () => {
    assert.equal(res('Designer').product.id, 'prod_shirt')
    assert.match(resolveOptionByTitle('Hood', [hoodie, product({ id: 'prod_hood2', title: 'Hoodie Pro' })], new Map()).error, /Ambiguous product title/)
  })
})

describe('GST maths (moved verbatim — regression guard)', () => {
  it('inclusive split', () => {
    assert.deepEqual(unitGst(1180, 18), { taxableValue: 1000, gstAmount: 180 })
    assert.deepEqual(unitGst(500, 0), { taxableValue: 500, gstAmount: 0 })
  })
  it('CGST is the ceiling and SGST the floor of half the line GST, so they always add up', () => {
    const [it] = applyGstToItems([{ productId: 'p', title: 't', category: 'c', quantity: 1, originalPrice: 105, discount: 0, finalPrice: 105, gstRate: 5, hsnCode: '' }], false)
    assert.equal(it.cgstAmount + it.sgstAmount, it.gstAmount)
    assert.ok(it.cgstAmount >= it.sgstAmount)
    const [ig] = applyGstToItems([{ productId: 'p', title: 't', category: 'c', quantity: 2, originalPrice: 1180, discount: 0, finalPrice: 1180, gstRate: 18, hsnCode: '' }], true)
    assert.deepEqual([ig.igstAmount, ig.cgstAmount, ig.sgstAmount], [360, 0, 0])
    assert.deepEqual(sumGstTotals([ig]), { taxableTotal: 2000, totalCgst: 0, totalSgst: 0, totalIgst: 360 })
  })
  it('inter-state needs both states and a difference', () => {
    assert.equal(resolveInterState('Tamil Nadu', 'tamil nadu'), false)
    assert.equal(resolveInterState('Kerala', 'Tamil Nadu'), true)
    assert.equal(resolveInterState('', 'Tamil Nadu'), false)
    assert.equal(round2(1.005 * 100) / 1, 100.5)
  })
})

describe('order payload for create_order_tx (toOrderItemsJson)', () => {
  it('carries variant id/name and the purchase-time snapshot keys the v2 RPC reads', () => {
    const priced = price([line('prod_shirt', PINK.id, 2), line('prod_shirt', '', 1)], catalog(product({ discount: 10, discount_expiry: future })))
    const json = toOrderItemsJson(applyGstToItems(priced.lineItems, false))
    assert.deepEqual(Object.keys(json[0]).sort(),
      ['cgst', 'discount', 'gst_rate', 'hsn_code', 'igst', 'line_total', 'mrp', 'product_id', 'quantity', 'sgst', 'title', 'unit_price', 'variant_id', 'variant_name'])
    assert.deepEqual([json[0].variant_id, json[0].variant_name, json[0].mrp, json[0].unit_price, json[0].line_total, json[0].gst_rate, json[0].hsn_code],
      [PINK.id, 'Pink', 300, 270, 540, 12, '6105'])
    assert.deepEqual([json[1].variant_id, json[1].variant_name, json[1].mrp, json[1].unit_price], [null, null, 500, 450])
  })
})