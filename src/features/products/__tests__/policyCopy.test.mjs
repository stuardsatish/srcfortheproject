// node --test src/features/products/__tests__/policyCopy.test.mjs   (npm run test:unit)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RETURN_POLICY, normalizeReturnPolicyDefaults, returnPolicyCopy } from '../policyCopy.js'

describe('normalizeReturnPolicyDefaults', () => {
  it('a missing / malformed document gives the 7 / 7 store defaults', () => {
    for (const bad of [undefined, null, 'x', 42, []]) {
      assert.deepEqual(normalizeReturnPolicyDefaults(bad), { ...DEFAULT_RETURN_POLICY, noReturnCategories: [], noExchangeCategories: [] })
    }
  })
  it('keeps valid values; a disabled side has NO window', () => {
    const n = normalizeReturnPolicyDefaults({ returnEnabled: true, returnWindowDays: 14, exchangeEnabled: false, exchangeWindowDays: 5 })
    assert.deepEqual([n.returnEnabled, n.returnWindowDays, n.exchangeEnabled, n.exchangeWindowDays], [true, 14, false, null])
  })
  it('an out-of-range / fractional / string window falls back to 7 instead of printing nonsense', () => {
    for (const v of [0, -1, 366, 7.5, 'abc', null]) assert.equal(normalizeReturnPolicyDefaults({ returnWindowDays: v }).returnWindowDays, 7)
    assert.equal(normalizeReturnPolicyDefaults({ returnWindowDays: '10' }).returnWindowDays, 10)
  })
  it('category lists are trimmed and blank entries dropped', () => {
    assert.deepEqual(normalizeReturnPolicyDefaults({ noReturnCategories: [' Sweets ', '', null, 'Gifts'], noExchangeCategories: 'x' }).noReturnCategories, ['Sweets', 'Gifts'])
    assert.deepEqual(normalizeReturnPolicyDefaults({ noExchangeCategories: 'x' }).noExchangeCategories, [])
  })
})

describe('returnPolicyCopy: the static policy pages read the STORE values, not a number baked into the source', () => {
  it('defaults: 7 days, product page pointer, exchanges paragraph', () => {
    const c = returnPolicyCopy(undefined)
    assert.equal(c.returns.length, 2)
    assert.match(c.returns[0], /Each product has its own return and exchange policy/)
    assert.match(c.returns[1], /within 7 days of delivery/)
    assert.equal(c.exchanges.length, 1)
    assert.match(c.exchanges[0], /exchange window shown on its product page/)
  })
  it('the window follows the setting, with the singular form', () => {
    assert.match(returnPolicyCopy({ returnWindowDays: 10, exchangeWindowDays: 3 }).returns[1], /within 10 days of delivery/)
    assert.match(returnPolicyCopy({ returnWindowDays: 1, exchangeWindowDays: 1 }).returns[1], /within 1 day of delivery/)
  })
  it('returns switched OFF store-wide: no number is promised', () => {
    const c = returnPolicyCopy({ returnEnabled: false, returnWindowDays: null, exchangeWindowDays: 7 })
    assert.doesNotMatch(c.returns[1], /within \d+ day/)
    assert.match(c.returns[1], /as soon as possible after delivery/)
  })
  it('exchanges switched OFF store-wide', () => {
    assert.match(returnPolicyCopy({ exchangeEnabled: false, exchangeWindowDays: null, returnWindowDays: 7 }).exchanges[0], /Exchanges are not offered unless a product page says so/)
  })
  it('names the categories the store marked non-returnable / non-exchangeable (Q-1) — singular and plural', () => {
    const one = returnPolicyCopy({ returnWindowDays: 7, exchangeWindowDays: 7, noReturnCategories: ['Fresh sweets'], noExchangeCategories: ['Custom gifts', 'Cakes'] })
    assert.equal(one.returns.length, 3)
    assert.match(one.returns[2], /^Products in this category are not returnable unless they arrive damaged, defective or different from what you ordered: Fresh sweets\.$/)
    assert.equal(one.exchanges.length, 2)
    assert.match(one.exchanges[1], /^Products in these categories cannot be exchanged: Custom gifts and Cakes\.$/)
    assert.match(returnPolicyCopy({ noReturnCategories: ['A', 'B', 'C'] }).returns[2], /: A, B and C\.$/)
  })
})