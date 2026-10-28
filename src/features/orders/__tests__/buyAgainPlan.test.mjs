// node --test src/features/orders/__tests__/buyAgainPlan.test.mjs   (npm run test:unit)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildBuyAgainPlan, describeBuyAgain } from '../buyAgainPlan.js'

const product = (o = {}) => ({
  id: 'prod_shirt', title: 'Designer Shirt', price: 500, stock: 10, sku: 'DS', thumbnail: 'm.jpg', hasVariants: true,
  mainOptionEnabled: true, trackInventory: true, returnEnabled: true, returnWindowDays: 7, exchangeEnabled: true, exchangeWindowDays: 5,
  variants: [
    { id: 'var_pink', name: 'Pink', price: 300, stock: 20, sku: 'DS-P', image: 'p.jpg' },
    { id: 'var_white', name: 'White', price: 200, stock: 2, sku: 'DS-W', image: '' },
  ],
  ...o,
})
const byId = (...ps) => new Map(ps.map((p) => [p.id, p]))
const line = (o) => ({ productId: 'prod_shirt', variantId: null, title: 'Designer Shirt', quantity: 1, itemType: 'main', ...o })

describe('buy again re-adds the SAME option at the ordered quantity', () => {
  it('main option -> main line (no variant), quantity kept, CURRENT price', () => {
    const { add, skipped } = buildBuyAgainPlan([line({ quantity: 3, finalPrice: 123 })], byId(product()))
    assert.equal(skipped.length, 0)
    assert.deepEqual([add[0].compoundId, add[0].quantity, add[0].payload.price, 'variant_id' in add[0].payload], ['prod_shirt', 3, 500, false])
  })
  it('a variant line -> THAT variant (the old code re-added the main product), at the variant\'s own current price', () => {
    const { add } = buildBuyAgainPlan([line({ variantId: 'var_pink', variantName: 'Pink', itemType: 'variant', quantity: 2 })], byId(product()))
    assert.deepEqual([add[0].compoundId, add[0].quantity, add[0].payload.variant_id, add[0].payload.price, add[0].payload.image], ['prod_shirt_var_pink', 2, 'var_pink', 300, 'p.jpg'])
  })
  it('main + variant of the same product in one order stay two independent lines', () => {
    const { add } = buildBuyAgainPlan([line({}), line({ variantId: 'var_pink', itemType: 'variant', quantity: 2 })], byId(product()))
    assert.deepEqual(add.map((a) => [a.compoundId, a.quantity]), [['prod_shirt', 1], ['prod_shirt_var_pink', 2]])
  })
  it('the same option listed twice is merged', () => {
    const { add } = buildBuyAgainPlan([line({ quantity: 1 }), line({ quantity: 2 })], byId(product()))
    assert.deepEqual(add.map((a) => a.quantity), [3])
  })
})

describe('buy again respects what is available NOW', () => {
  it('clamps to stock and says so', () => {
    const { add } = buildBuyAgainPlan([line({ variantId: 'var_white', itemType: 'variant', quantity: 5 })], byId(product()))
    assert.equal(add[0].quantity, 2); assert.match(add[0].note, /only 2 of 5/)
  })
  it('adds on top of what is already in the cart, without exceeding stock', () => {
    const cart = [{ id: 'prod_shirt_var_white', quantity: 1 }]
    const { add, skipped } = buildBuyAgainPlan([line({ variantId: 'var_white', itemType: 'variant', quantity: 5 })], byId(product()), cart)
    assert.deepEqual([add[0].quantity, add[0].nextTotal], [1, 2])
    const full = buildBuyAgainPlan([line({ variantId: 'var_white', itemType: 'variant' })], byId(product()), [{ compound_id: 'prod_shirt_var_white', quantity: 2 }])
    assert.equal(full.add.length, 0); assert.match(full.skipped[0].reason, /maximum available/)
  })
  it('skips: deleted product, deactivated/removed variant, out of stock, main option no longer sold', () => {
    const p = product(); p.variants = p.variants.filter((v) => v.id !== 'var_white')
    const out = buildBuyAgainPlan([
      line({ productId: 'prod_gone', title: 'Gone' }),
      line({ variantId: 'var_white', itemType: 'variant', title: 'Shirt [White]' }),
    ], byId(p))
    assert.deepEqual(out.skipped.map((s) => s.reason), ['no longer sold', 'that variant is no longer available'])
    assert.equal(buildBuyAgainPlan([line({})], byId(product({ stock: 0 }))).skipped[0].reason, 'out of stock')
    assert.match(buildBuyAgainPlan([line({})], byId(product({ mainOptionEnabled: false }))).skipped[0].reason, /choose a variant/)
  })
  it('a legacy variant line whose variant could not be identified is skipped, never guessed', () => {
    const out = buildBuyAgainPlan([line({ itemType: 'variant', variantId: null, title: 'Hoodie [Discontinued]' })], byId(product()))
    assert.equal(out.add.length, 0); assert.match(out.skipped[0].reason, /could not be identified/)
  })
  it('untracked options are never out of stock', () => {
    const { add } = buildBuyAgainPlan([line({ quantity: 50 })], byId(product({ trackInventory: false, stock: 0 })))
    assert.equal(add[0].quantity, 50)
  })
})

describe('describeBuyAgain', () => {
  it('summarises added / reduced / skipped in one sentence', () => {
    const plan = buildBuyAgainPlan([line({ variantId: 'var_white', itemType: 'variant', quantity: 5 }), line({ productId: 'prod_gone', title: 'Gone' })], byId(product()))
    const msg = describeBuyAgain(plan)
    assert.match(msg, /^1 item added to your cart/); assert.match(msg, /only 2 of 5/); assert.match(msg, /Not added — Gone \(no longer sold\)/)
  })
})