// node --test src/features/pos/__tests__/billOptions.test.mjs   (npm run test:unit)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  UNLIMITED, billLineKey, lineLabel, unitPriceOfOption, searchBillOptions, findOptionByCode, makeBillLine, normalizeBillLine,
  addOptionToBill, changeLineQty, setLineQty, removeLine, billPayloadItems,
} from '../billOptions.js'
import { getPurchaseOptions } from '../../products/purchaseOptions.js'

// products as mapProductRow() produces them (the POS now maps the raw rows)
const shirt = (o = {}) => ({
  id: 'prod_shirt', title: 'Designer Shirt', price: 500, stock: 10, sku: 'DESIGNER-SHIRT', thumbnail: 'main.jpg', category: 'apparel',
  hasVariants: true, mainOptionEnabled: true, trackInventory: true, discount: 0, gstRate: 5,
  returnEnabled: true, returnWindowDays: 7, exchangeEnabled: true, exchangeWindowDays: 5,
  variants: [
    { id: 'var_pink', name: 'Pink', price: 300, stock: 20, sku: 'DS-PINK', image: 'pink.jpg' },
    { id: 'var_white', name: 'White', price: 200, stock: 1, sku: 'DS-WHITE', image: '' },
  ],
  ...o,
})
const pen = (o = {}) => ({ id: 'prod_pen', title: 'Engraved Pen', price: 899, stock: 5, sku: 'PEN-1', category: 'gifts', hasVariants: false, variants: [], mainOptionEnabled: true, trackInventory: true, discount: 10, gstRate: 18, ...o })
const catalog = () => [shirt(), pen()]
const opt = (p, variantId) => getPurchaseOptions(p).find((o) => o.variantId === variantId)

describe('bill line identity', () => {
  it('the main option and each variant of the SAME product are separate lines', () => {
    assert.equal(billLineKey('prod_shirt', ''), 'prod_shirt::')
    assert.notEqual(billLineKey('prod_shirt', ''), billLineKey('prod_shirt', 'var_pink'))
    assert.equal(billLineKey('prod_shirt'), 'prod_shirt::')
  })
  it('lineLabel names the variant', () => {
    assert.equal(lineLabel({ title: 'Designer Shirt', variantName: 'Pink' }), 'Designer Shirt — Pink')
    assert.equal(lineLabel({ title: 'Engraved Pen', variantName: '' }), 'Engraved Pen')
  })
})

describe('unit price of an option', () => {
  it('uses the OPTION price, never the main price, and applies the product discount to every option', () => {
    const p = shirt({ discount: 10 })
    assert.deepEqual(unitPriceOfOption(p, opt(p, '')), { mrp: 500, discount: 10, finalPrice: 450, gstRate: 5 })
    assert.deepEqual(unitPriceOfOption(p, opt(p, 'var_pink')), { mrp: 300, discount: 10, finalPrice: 270, gstRate: 5 })
  })
  it('the larger of product / category discount wins (unchanged POS behaviour)', () => {
    const p = pen({ discount: 5, categoryDiscount: 12 })
    assert.equal(unitPriceOfOption(p, opt(p, '')).finalPrice, 899 - (899 * 12) / 100)
  })
})

describe('search: one entry per purchasable option', () => {
  it('a product match lists the main option AND every variant', () => {
    const r = searchBillOptions(catalog(), 'designer')
    assert.deepEqual(r.map((x) => x.key), ['prod_shirt::', 'prod_shirt::var_pink', 'prod_shirt::var_white'])
  })
  it('a variant-only match (name or SKU) lists just that variant', () => {
    assert.deepEqual(searchBillOptions(catalog(), 'pink').map((x) => x.key), ['prod_shirt::var_pink'])
    assert.deepEqual(searchBillOptions(catalog(), 'ds-white').map((x) => x.key), ['prod_shirt::var_white'])
  })
  it('category and SKU of a single product', () => {
    assert.deepEqual(searchBillOptions(catalog(), 'gifts').map((x) => x.key), ['prod_pen::'])
    assert.deepEqual(searchBillOptions(catalog(), 'PEN-1').map((x) => x.key), ['prod_pen::'])
  })
  it('a variant product whose main option is not sold only lists the variants', () => {
    const r = searchBillOptions([shirt({ mainOptionEnabled: false })], 'designer')
    assert.deepEqual(r.map((x) => x.key), ['prod_shirt::var_pink', 'prod_shirt::var_white'])
  })
  it('empty query, no match and the limit', () => {
    assert.deepEqual(searchBillOptions(catalog(), '  '), [])
    assert.deepEqual(searchBillOptions(catalog(), 'zzz'), [])
    assert.equal(searchBillOptions(catalog(), 'designer', 2).length, 2)
  })
})

describe('barcode / SKU entry', () => {
  it('a variant SKU selects that variant, a product SKU the main option (case-insensitive)', () => {
    const v = findOptionByCode(catalog(), 'ds-pink')
    assert.deepEqual([v.product.id, v.option.variantId], ['prod_shirt', 'var_pink'])
    const m = findOptionByCode(catalog(), 'Designer-Shirt')
    assert.deepEqual([m.product.id, m.option.variantId, m.option.kind], ['prod_shirt', '', 'main'])
    assert.equal(findOptionByCode(catalog(), 'PEN-1').option.kind, 'single')
  })
  it('the product SKU of a product whose main option is NOT sold has no option (caller must ask for a variant)', () => {
    const r = findOptionByCode([shirt({ mainOptionEnabled: false })], 'DESIGNER-SHIRT')
    assert.equal(r.product.id, 'prod_shirt'); assert.equal(r.option, null)
  })
  it('a product id (legacy) selects its default option; unknown codes give null', () => {
    assert.equal(findOptionByCode(catalog(), 'prod_pen').option.variantId, '')
    assert.equal(findOptionByCode(catalog(), 'nope'), null)
    assert.equal(findOptionByCode(catalog(), ''), null)
  })
})

describe('building the bill', () => {
  it('main + Pink + Pink again = two independent lines, Pink quantity 2', () => {
    const p = shirt()
    let lines = []
    for (const v of ['', 'var_pink', 'var_pink']) {
      const r = addOptionToBill(lines, p, opt(p, v)); assert.equal(r.error, null); lines = r.lines
    }
    assert.deepEqual(lines.map((l) => [l.lineKey, l.quantity, l.finalPrice, l.variantName]), [['prod_shirt::', 1, 500, ''], ['prod_shirt::var_pink', 2, 300, 'Pink']])
  })
  it('stock is per OPTION: White has 1 unit, the main option has 10', () => {
    const p = shirt()
    let r = addOptionToBill([], p, opt(p, 'var_white')); assert.equal(r.error, null)
    r = addOptionToBill(r.lines, p, opt(p, 'var_white'))
    assert.equal(r.error, 'Only 1 in stock for "Designer Shirt — White"'); assert.equal(r.lines[0].quantity, 1)
    r = addOptionToBill(r.lines, p, opt(p, '')); assert.equal(r.error, null); assert.equal(r.lines.length, 2)
  })
  it('out-of-stock option, missing option (main not sold) and unknown product are refused with a message', () => {
    const p = shirt({ stock: 0 })
    assert.match(addOptionToBill([], p, opt(p, '')).error, /out of stock/)
    assert.match(addOptionToBill([], shirt(), null).error, /choose one of its variants/)
    assert.equal(addOptionToBill([], null, null).error, 'Product not found')
  })
  it('untracked options are never out of stock and get the large cap', () => {
    const p = shirt(); p.variants[0].track_inventory = false; p.variants[0].stock = 0
    const r = addOptionToBill([], p, opt(p, 'var_pink')); assert.equal(r.error, null); assert.equal(r.lines[0].stock, UNLIMITED)
  })
  it('the line snapshot carries the option sku / image / variant name and the product GST', () => {
    const p = shirt(); const l = makeBillLine(p, opt(p, 'var_pink'))
    assert.deepEqual([l.sku, l.thumbnail, l.variantName, l.itemType, l.gstRate, l.title], ['DS-PINK', 'pink.jpg', 'Pink', 'variant', 5, 'Designer Shirt'])
    assert.equal(makeBillLine(p, opt(p, 'var_white')).thumbnail, 'main.jpg', 'a variant without an image falls back to the product image')
    assert.equal(makeBillLine(p, opt(p, '')).variantName, '')
  })
})

describe('quantity edits', () => {
  const p = shirt()
  const two = () => addOptionToBill(addOptionToBill([], p, opt(p, '')).lines, p, opt(p, 'var_pink')).lines
  it('+/- act on ONE line only; reaching 0 removes it; above stock is refused', () => {
    let r = changeLineQty(two(), 'prod_shirt::var_pink', 1); assert.equal(r.error, null)
    assert.deepEqual(r.lines.map((l) => l.quantity), [1, 2])
    r = changeLineQty(r.lines, 'prod_shirt::', -1)
    assert.deepEqual(r.lines.map((l) => l.lineKey), ['prod_shirt::var_pink'])
    const white = addOptionToBill([], p, opt(p, 'var_white')).lines
    assert.match(changeLineQty(white, 'prod_shirt::var_white', 1).error, /Only 1 in stock/)
  })
  it('typed quantity clamps to stock; 0 / junk keeps the line', () => {
    let r = setLineQty(two(), 'prod_shirt::var_pink', 99)
    assert.equal(r.lines[1].quantity, 20); assert.match(r.error, /Only 20 in stock/)
    r = setLineQty(two(), 'prod_shirt::var_pink', 'abc'); assert.equal(r.lines[1].quantity, 1); assert.equal(r.error, null)
    r = setLineQty(two(), 'prod_shirt::var_pink', 0); assert.equal(r.lines[1].quantity, 1)
  })
  it('removeLine removes exactly one option', () => {
    assert.deepEqual(removeLine(two(), 'prod_shirt::').map((l) => l.lineKey), ['prod_shirt::var_pink'])
  })
})

describe('what is sent to the server, and held bills from before variants', () => {
  it('payload is (productId, variantId, quantity) — variantId "" for the main option; no prices', () => {
    const p = shirt()
    let lines = addOptionToBill([], p, opt(p, '')).lines
    lines = addOptionToBill(lines, p, opt(p, 'var_pink')).lines
    assert.deepEqual(billPayloadItems(lines), [
      { productId: 'prod_shirt', variantId: '', quantity: 1 },
      { productId: 'prod_shirt', variantId: 'var_pink', quantity: 1 }])
    for (const it of billPayloadItems(lines)) assert.equal('finalPrice' in it || 'price' in it, false)
  })
  it('an old held line (no variantId / lineKey) becomes the main-option line and keeps working', () => {
    const old = { productId: 'prod_pen', title: 'Engraved Pen', sku: 'PEN-1', stock: 5, mrp: 899, discount: 10, finalPrice: 809.1, gstRate: 18, quantity: 2 }
    const n = normalizeBillLine(old)
    assert.deepEqual([n.lineKey, n.variantId, n.variantName], ['prod_pen::', '', ''])
    assert.equal(changeLineQty([n], 'prod_pen::', 1).lines[0].quantity, 3)
    assert.deepEqual(billPayloadItems([n]), [{ productId: 'prod_pen', variantId: '', quantity: 2 }])
  })
})