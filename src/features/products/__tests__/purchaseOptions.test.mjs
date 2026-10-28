// node --test src/features/products/__tests__/purchaseOptions.test.mjs   (npm run test:unit)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  listVariants, getMainOption, getVariantOption, getPurchaseOptions, isAvailable, defaultOption, optionForVariantId,
  cartCompoundId, buildCartPayload, policyLine, policySummary, listPriceSummary, hasAvailableOption, formatINR,
  needsOptionChoice, listStockSummary,
} from '../purchaseOptions.js'

// what mapProductRow() produces for the Designer Shirt example from the brief
const shirt = (o = {}) => ({
  id: 'prod_shirt', title: 'Designer Shirt', price: 500, stock: 10, sku: 'DESIGNER-SHIRT', thumbnail: 'main.jpg',
  hasVariants: true, mainOptionEnabled: true, trackInventory: true,
  returnEnabled: true, returnWindowDays: 7, exchangeEnabled: true, exchangeWindowDays: 5,
  variants: [
    { id: 'var_1_0', name: 'Pink', price: 300, stock: 20, sku: 'DS-PINK', image: 'pink.jpg' },
    { id: 'var_1_1', name: 'White', price: 200, stock: 30, sku: 'DS-WHITE', image: '', return_enabled: false, exchange_enabled: true, exchange_window_days: 3 },
    { id: 'var_1_2', name: 'Violet', price: 350, stock: 15, sku: 'DS-VIOLET', image: '' },
  ],
  ...o,
})
const single = (o = {}) => ({ id: 'prod_one', title: 'Classic Cotton Shirt', price: 500, stock: 50, sku: 'SHIRT-001', hasVariants: false, variants: [], mainOptionEnabled: true, trackInventory: true, returnEnabled: true, returnWindowDays: 7, exchangeEnabled: false, exchangeWindowDays: null, ...o })

describe('the options of a product', () => {
  it('SINGLE: exactly one option — the product itself, no fake variant', () => {
    const o = getPurchaseOptions(single())
    assert.equal(o.length, 1)
    assert.deepEqual([o[0].kind, o[0].variantId, o[0].price, o[0].stock, o[0].sku], ['single', '', 500, 50, 'SHIRT-001'])
  })

  it('WITH VARIANTS: the main product is a purchasable option of its OWN, followed by every variant', () => {
    const o = getPurchaseOptions(shirt())
    assert.deepEqual(o.map((x) => [x.kind, x.name, x.price, x.stock, x.sku]), [
      ['main', 'Designer Shirt', 500, 10, 'DESIGNER-SHIRT'], ['variant', 'Pink', 300, 20, 'DS-PINK'],
      ['variant', 'White', 200, 30, 'DS-WHITE'], ['variant', 'Violet', 350, 15, 'DS-VIOLET']])
    assert.equal(o[0].label, 'Main product')
  })

  it('prices and stock are independent: nothing is summed, averaged or minimised', () => {
    const o = getPurchaseOptions(shirt({ price: 999, stock: 0 }))
    assert.deepEqual(o.map((x) => x.price), [999, 300, 200, 350])
    assert.deepEqual(o.map((x) => x.stock), [0, 20, 30, 15])
  })

  it('main option OFF: only the variants are offered', () => {
    const o = getPurchaseOptions(shirt({ mainOptionEnabled: false }))
    assert.deepEqual(o.map((x) => x.name), ['Pink', 'White', 'Violet'])
    assert.equal(getMainOption(shirt({ mainOptionEnabled: false })), null)
  })

  it('inactive variants are never offered', () => {
    const p = shirt(); p.variants[1].status = 'inactive'
    assert.deepEqual(listVariants(p).map((v) => v.name), ['Pink', 'Violet'])
    assert.deepEqual(getPurchaseOptions(p).map((x) => x.name), ['Designer Shirt', 'Pink', 'Violet'])
  })

  it('a variant product whose variants are all gone degrades to a plain single option', () => {
    const o = getPurchaseOptions(shirt({ variants: [] }))
    assert.deepEqual(o.map((x) => x.kind), ['single'])
  })

  it('untracked inventory => stock null => always available', () => {
    const o = getPurchaseOptions(shirt({ trackInventory: false, stock: 0 }))
    assert.equal(o[0].stock, null); assert.equal(isAvailable(o[0]), true)
    const p = shirt(); p.variants[0].track_inventory = false; p.variants[0].stock = 0
    assert.equal(isAvailable(getPurchaseOptions(p)[1]), true)
    assert.equal(isAvailable(getPurchaseOptions(shirt({ stock: 0 }))[0]), false)
  })
})

describe('default selection', () => {
  it('the main option when it can be bought', () => assert.equal(defaultOption(shirt()).kind, 'main'))
  it('the first variant IN STOCK when the main option is off or sold out', () => {
    assert.equal(defaultOption(shirt({ mainOptionEnabled: false })).name, 'Pink')
    const p = shirt({ stock: 0 }); p.variants[0].stock = 0
    assert.equal(defaultOption(p).name, 'White')
  })
  it('falls back to the first option when nothing is in stock (so the page can show "out of stock")', () => {
    const p = shirt({ stock: 0 }); p.variants.forEach((v) => { v.stock = 0 })
    assert.equal(defaultOption(p).kind, 'main'); assert.equal(hasAvailableOption(p), false)
    assert.equal(defaultOption({ id: 'x', variants: [], hasVariants: false, price: 0, stock: 0 }).kind, 'single')
    assert.equal(defaultOption(null), null)
  })
  it('optionForVariantId resolves "" to the main option', () => {
    assert.equal(optionForVariantId(shirt(), '').kind, 'main')
    assert.equal(optionForVariantId(shirt(), 'var_1_2').name, 'Violet')
    assert.equal(optionForVariantId(shirt(), 'var_nope'), null)
  })
})

describe('cart identity and payload', () => {
  const p = shirt()
  const [main, pink, white] = getPurchaseOptions(p)

  it('independent line identities: product id for main, productId_variantId for a variant', () => {
    assert.equal(cartCompoundId(p, main), 'prod_shirt')
    assert.equal(cartCompoundId(p, pink), 'prod_shirt_var_1_0')
    assert.notEqual(cartCompoundId(p, pink), cartCompoundId(p, white))
  })
  it('main payload is the product itself (no variant fields) — buying it adds NO variant', () => {
    const payload = buildCartPayload(p, main)
    assert.equal(payload, p); assert.equal('variant_id' in payload, false)
  })
  it('variant payload carries the variant\'s own id, name, price, stock and image — and not the main price', () => {
    const payload = buildCartPayload(p, pink)
    assert.deepEqual([payload.variant_id, payload.variant_name, payload.price, payload.stock, payload.image, payload.thumbnail], ['var_1_0', 'Pink', 300, 20, 'pink.jpg', 'pink.jpg'])
    assert.equal(payload.selected_variant.sku, 'DS-PINK')
    assert.equal(payload.title, 'Designer Shirt'); assert.equal(p.price, 500, 'the product object is not mutated')
  })
  it('a variant without an image falls back to the product image', () => {
    assert.equal(buildCartPayload(p, white).image, 'main.jpg')
  })
  it('untracked variant gets a large stock cap instead of null (the cart UI clamps on it)', () => {
    const q = shirt(); q.variants[0].track_inventory = false
    assert.equal(buildCartPayload(q, getPurchaseOptions(q)[1]).stock, 999999)
  })
})

describe('return / exchange policy per option (independent; variant may override, NULL inherits)', () => {
  const [main, pink, white] = getPurchaseOptions(shirt())
  it('main uses the product policy; an inheriting variant uses the product policy too', () => {
    assert.equal(policySummary(main), '7-day returns · 5-day exchange')
    assert.equal(policySummary(pink), '7-day returns · 5-day exchange')
  })
  it('an overriding variant uses its own pair, independently for return and exchange', () => {
    assert.equal(policySummary(white), 'Not returnable · 3-day exchange')
  })
  it('both OFF and the singular/plural forms', () => {
    const none = getPurchaseOptions(single({ returnEnabled: false, returnWindowDays: null, exchangeEnabled: false }))[0]
    assert.equal(policySummary(none), 'Not returnable · No exchange')
    assert.equal(policyLine('return', { enabled: true, days: 10 }), '10-day returns')
    assert.equal(policyLine('exchange', { enabled: true, days: 1 }), '1-day exchange')
    assert.equal(policySummary(null), '')
  })
})

describe('list price presentation (never a bare minimum price)', () => {
  it('single product: just the price', () => assert.deepEqual(listPriceSummary(single()), { price: 500, prefix: '', note: '' }))
  it('variants + main on sale: the MAIN price, plus an explicit note about the others', () => {
    assert.deepEqual(listPriceSummary(shirt()), { price: 500, prefix: '', note: '+ 3 more options · ₹200 – ₹350' })
  })
  it('main not sold: "From <lowest>" with the range spelled out', () => {
    assert.deepEqual(listPriceSummary(shirt({ mainOptionEnabled: false })), { price: 200, prefix: 'From', note: '3 options · ₹200 – ₹350' })
  })
  it('one variant / equal prices read naturally', () => {
    const p = shirt({ variants: [{ id: 'v', name: 'A', price: 300, stock: 1 }] })
    assert.equal(listPriceSummary(p).note, '+ 1 more option · ₹300')
    const q = shirt({ mainOptionEnabled: false, variants: [{ id: 'a', name: 'A', price: 300, stock: 1 }, { id: 'b', name: 'B', price: 300, stock: 1 }] })
    assert.deepEqual(listPriceSummary(q), { price: 300, prefix: 'From', note: '2 options · ₹300' })
  })
  it('formatINR', () => { assert.equal(formatINR(1500), '₹1,500'); assert.equal(formatINR('abc'), '₹0') })
})

describe('list cards: choose-options CTA and availability', () => {
  it('a single product is added straight from the card', () => assert.equal(needsOptionChoice(single()), false))
  it('a variant product with its main option on sale needs a choice (never add the main product by accident)', () => {
    assert.equal(needsOptionChoice(shirt()), true)
  })
  it('main option off: still a choice — even when only ONE variant is left, the only thing on sale is a variant', () => {
    assert.equal(needsOptionChoice(shirt({ mainOptionEnabled: false })), true)
    assert.equal(needsOptionChoice(shirt({ mainOptionEnabled: false, variants: [{ id: 'only', name: 'Only', price: 10, stock: 1 }] })), true)
  })
  it('a variant product whose variants are all gone is a plain single product again', () => {
    assert.equal(needsOptionChoice(shirt({ variants: [] })), false)
    assert.equal(needsOptionChoice(null), false)
  })

  it('single: the units are the product stock and the card shows the number', () => {
    assert.deepEqual(listStockSummary(single()), { out: false, units: 50, multi: false })
    assert.deepEqual(listStockSummary(single({ stock: 0 })), { out: true, units: 0, multi: false })
  })
  it('variants: out ONLY when no option at all can be bought', () => {
    assert.deepEqual(listStockSummary(shirt()), { out: false, units: 75, multi: true })
    const mainSoldOut = shirt({ stock: 0 })
    assert.deepEqual(listStockSummary(mainSoldOut), { out: false, units: 65, multi: true }, 'a sold-out MAIN counter must not hide the in-stock variants')
    const all = shirt({ stock: 0 }); all.variants.forEach((v) => { v.stock = 0 })
    assert.deepEqual(listStockSummary(all), { out: true, units: 0, multi: true })
  })
  it('untracked inventory is unlimited: no number to show', () => {
    assert.deepEqual(listStockSummary(single({ trackInventory: false, stock: 0 })), { out: false, units: null, multi: false })
    const p = shirt(); p.variants[0].track_inventory = false
    assert.deepEqual(listStockSummary(p), { out: false, units: null, multi: true })
  })
  it('inactive variants and a disabled main option do not count towards availability', () => {
    const p = shirt({ mainOptionEnabled: false }); p.variants[0].status = 'inactive'
    assert.deepEqual(listStockSummary(p), { out: false, units: 45, multi: true })
  })
})