// node --test src/features/products/admin/__tests__/productForm.test.mjs   (npm run test:unit)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  POLICY_DEFAULTS, policyFromSettings, policyFromProduct, policyFromVariant, policyError, parseTags,
  deriveVariantAttributes, newVariantRow, rebuildVariantRows, validateProduct, buildVariantPayload, buildProductPayload, explainSaveError,
  policyToSettings, policyForCategory, categoryListsFromSettings,
} from '../productForm.js'

const form = (o = {}) => ({ title: 'Designer Shirt', category: 'shirts', price: '500', stock: '10', brand: '', sku: 'DS', shortDescription: '', description: '', gstRate: '12', hsnCode: '', discount: '', discountExpiry: '', ...o })
const row = (name, price, o = {}) => newVariantRow(`var_${name}`, { name, price, stock: '5', ...o })

describe('policy helpers', () => {
  it('defaults mirror the store policy (7 / 7, both on)', () => {
    assert.deepEqual(POLICY_DEFAULTS, { returnEnabled: true, returnDays: '7', exchangeEnabled: true, exchangeDays: '7' })
    assert.deepEqual(policyFromSettings({ returnWindowDays: 10, exchangeEnabled: false }), { returnEnabled: true, returnDays: '10', exchangeEnabled: false, exchangeDays: '7' })
    assert.deepEqual(policyFromSettings(undefined), POLICY_DEFAULTS)
  })
  it('product row -> form; variant NULL columns mean "inherit"', () => {
    assert.deepEqual(policyFromProduct({ returnEnabled: false, returnWindowDays: null, exchangeEnabled: true, exchangeWindowDays: 3 }),
      { returnEnabled: false, returnDays: '7', exchangeEnabled: true, exchangeDays: '3' })
    assert.equal(policyFromVariant({ returnEnabled: null, exchangeEnabled: null }).policyMode, 'inherit')
    const c = policyFromVariant({ returnEnabled: false, returnWindowDays: null, exchangeEnabled: true, exchangeWindowDays: 3 })
    assert.equal(c.policyMode, 'custom'); assert.deepEqual([c.policy.returnEnabled, c.policy.exchangeEnabled, c.policy.exchangeDays], [false, true, '3'])
  })
  it('policyError: a window is required exactly when the policy is ON, whole days 1-365', () => {
    assert.equal(policyError({ returnEnabled: true, returnDays: '7', exchangeEnabled: true, exchangeDays: '5' }), null)
    assert.equal(policyError({ returnEnabled: false, returnDays: '', exchangeEnabled: false, exchangeDays: 'abc' }), null, 'OFF ignores the days')
    for (const bad of ['', '0', '-3', '7.5', 'x', '366']) {
      assert.match(policyError({ returnEnabled: true, returnDays: bad, exchangeEnabled: false, exchangeDays: '' }), /return window/, bad)
      assert.match(policyError({ returnEnabled: false, returnDays: '', exchangeEnabled: true, exchangeDays: bad }), /exchange window/, bad)
    }
    assert.match(policyError({ returnEnabled: true, returnDays: '', exchangeEnabled: true, exchangeDays: '7' }, 'Variant “Pink”'), /^Variant “Pink”: return window/)
  })
})

describe('small parsers', () => {
  it('tags: trimmed, lower-cased, de-duplicated, order kept', () => {
    assert.deepEqual(parseTags(' Cotton, summer ,COTTON,, new '), ['cotton', 'summer', 'new'])
    assert.deepEqual(parseTags(''), []); assert.deepEqual(parseTags(null), [])
  })
  it('variant attributes from "Red / L" follow the attribute names, same rule as the SQL backfill', () => {
    const attrs = [{ name: 'Color', options: ['Red'] }, { name: 'Size', options: ['L'] }]
    assert.deepEqual(deriveVariantAttributes('Red / L', attrs), { Color: 'Red', Size: 'L' })
    assert.deepEqual(deriveVariantAttributes('Pink', [{ name: 'Color' }]), { Color: 'Pink' })
    assert.deepEqual(deriveVariantAttributes('Red', attrs), {}, 'count mismatch -> no guess')
    assert.deepEqual(deriveVariantAttributes('Custom name', []), {})
  })
})

describe('validateProduct', () => {
  const ok = (o = {}) => validateProduct({ form: form(), productType: 'single', policy: POLICY_DEFAULTS, ...o })
  it('accepts a normal single product', () => assert.equal(ok(), null))
  it('title / category / price', () => {
    assert.match(ok({ form: form({ title: ' ' }) }), /Title and Category/)
    assert.match(ok({ form: form({ category: '' }) }), /Title and Category/)
    assert.match(ok({ form: form({ price: '' }) }), /Price must be greater than zero/)
    assert.match(ok({ form: form({ price: '0' }) }), /Price must be greater than zero/)
    assert.match(ok({ form: form({ discount: '150' }) }), /Discount must be between/)
  })
  it('product policy errors are reported with the "Product" prefix', () => {
    assert.match(ok({ policy: { ...POLICY_DEFAULTS, returnDays: '0' } }), /^Product return window/)
  })
  it('a primary image is required only when asked (Add page)', () => {
    assert.equal(ok({ requireImage: false, hasPrimaryImage: false }), null)
    assert.match(ok({ requireImage: true, hasPrimaryImage: false }), /Primary image is required/)
  })

  describe('product with variants', () => {
    const v = (o = {}) => validateProduct({ form: form(), productType: 'variant', mainOptionEnabled: true, policy: POLICY_DEFAULTS, variantRows: [row('Pink', '300'), row('White', '200')], ...o })
    it('accepts main + variants, each with its own price (main price is its own)', () => assert.equal(v(), null))
    it('needs at least one variant, names, positive prices', () => {
      assert.match(v({ variantRows: [] }), /at least one variant/)
      assert.match(v({ variantRows: [row('', '5')] }), /needs a name/)
      assert.match(v({ variantRows: [row('Pink', '0')] }), /Variant “Pink” needs a price greater than zero/)
      assert.match(v({ variantRows: [row('Pink', '5', { stock: '1.5' })] }), /stock must be a whole number/)
    })
    it('duplicate names (case-insensitive) and duplicate SKUs are caught before saving', () => {
      assert.match(v({ variantRows: [row('Pink', '1'), row(' pink ', '2')] }), /Two variants are both called/)
      assert.match(v({ variantRows: [row('A', '1', { sku: 'X1' }), row('B', '2', { sku: 'x1' })] }), /SKU “x1” is used by more than one variant/)
    })
    it('main product price is required only while the main option is on', () => {
      assert.match(v({ form: form({ price: '' }) }), /Enter a price for the main product/)
      assert.equal(v({ form: form({ price: '' }), mainOptionEnabled: false }), null)
    })
    it('something must be purchasable', () => {
      assert.match(v({ mainOptionEnabled: false, variantRows: [row('Pink', '5', { status: 'inactive' })] }), /Nothing on this product can be bought/)
      assert.equal(v({ mainOptionEnabled: true, variantRows: [row('Pink', '5', { status: 'inactive' })] }), null)
    })
    it('a variant with a CUSTOM policy is validated; an inheriting one is not', () => {
      const bad = row('Pink', '5', { policyMode: 'custom', policy: { returnEnabled: true, returnDays: '', exchangeEnabled: false, exchangeDays: '' } })
      assert.match(v({ variantRows: [bad] }), /Variant “Pink”: return window/)
      const inherit = row('Pink', '5', { policyMode: 'inherit', policy: { returnEnabled: true, returnDays: '', exchangeEnabled: true, exchangeDays: '' } })
      assert.equal(v({ variantRows: [inherit] }), null)
    })
  })
})

describe('buildProductPayload — exactly the keys save_product whitelists', () => {
  const WHITELIST = ['id','title','description','short_description','category','brand','badge','sku','price','price_type','discount','discount_expiry','gst_rate','hsn_code','stock','stock_expected','max_stock','image','thumbnail','gallery','status','tags','track_inventory','main_option_enabled','return_enabled','return_window_days','exchange_enabled','exchange_window_days','attributes','import_key']
  const VARIANT_WHITELIST = ['id','name','sku','price','stock','stock_expected','track_inventory','image','gallery','attributes','status','sort_order','return_enabled','return_window_days','exchange_enabled','exchange_window_days','import_key']

  it('single product', () => {
    const p = buildProductPayload({ id: 'prod_x', form: form({ stock: '50.9', gstRate: '5' }), status: 'active', productType: 'single', tagsText: 'A, b', thumbnail: 'u', gallery: [] })
    assert.deepEqual(Object.keys(p).filter((k) => !WHITELIST.includes(k)), [])
    assert.deepEqual([p.id, p.price, p.stock, p.gst_rate, p.tags, p.main_option_enabled, p.attributes, p.has_variants], ['prod_x', 500, 50, 5, ['a', 'b'], true, [], undefined])
    assert.deepEqual([p.return_enabled, p.return_window_days, p.exchange_enabled, p.exchange_window_days], [true, 7, true, 7])
    assert.equal('stock_expected' in p, false, 'creating: no expected stock')
  })
  it('policy OFF sends no window; ON sends the number', () => {
    const p = buildProductPayload({ form: form(), status: 'draft', productType: 'single', policy: { returnEnabled: false, returnDays: '9', exchangeEnabled: true, exchangeDays: '5' } })
    assert.deepEqual([p.return_enabled, p.return_window_days, p.exchange_enabled, p.exchange_window_days, p.status], [false, null, true, 5, 'draft'])
  })
  it('variant product: main option flag and attributes are sent; a disabled main option may have no price', () => {
    const attrs = [{ name: 'Color', options: ['Pink'] }]
    const p = buildProductPayload({ form: form({ price: '' }), status: 'active', productType: 'variant', mainOptionEnabled: false, attributes: attrs })
    assert.deepEqual([p.price, p.main_option_enabled, p.attributes], [0, false, attrs])
  })
  it('edit: stock becomes a delta against what the admin saw; discount fields only when asked', () => {
    const p = buildProductPayload({ id: 'prod_x', form: form({ stock: '12', discount: '10', discountExpiry: '2026-12-01T10:00' }), status: 'active', productType: 'single', stockLoaded: 10, includeDiscount: true })
    assert.deepEqual([p.stock, p.stock_expected, p.discount, p.discount_expiry], [12, 10, 10, '2026-12-01T10:00'])
    const q = buildProductPayload({ form: form(), status: 'active', productType: 'single' })
    assert.equal('discount' in q, false)
  })

  it('variant payload: inherit => NULL policy; custom => explicit; stock_expected only for loaded variants', () => {
    const attrs = [{ name: 'Color', options: ['Pink'] }]
    const inh = buildVariantPayload(row('Pink', '300'), { attributes: attrs })
    assert.deepEqual(Object.keys(inh).filter((k) => !VARIANT_WHITELIST.includes(k)), [])
    assert.deepEqual([inh.return_enabled, inh.return_window_days, inh.exchange_enabled, inh.exchange_window_days], [null, null, null, null])
    assert.deepEqual([inh.price, inh.stock, inh.status, inh.track_inventory, inh.attributes], [300, 5, 'active', true, { Color: 'Pink' }])
    assert.equal('stock_expected' in inh, false)

    const cus = buildVariantPayload(row('White', '200', { policyMode: 'custom', status: 'inactive', stockLoaded: 30, policy: { returnEnabled: false, returnDays: '7', exchangeEnabled: true, exchangeDays: '3' } }), { imageUrl: 'https://x/w.png' })
    assert.deepEqual([cus.return_enabled, cus.return_window_days, cus.exchange_enabled, cus.exchange_window_days, cus.status, cus.stock_expected, cus.image],
      [false, null, true, 3, 'inactive', 30, 'https://x/w.png'])
  })
})

describe('rebuildVariantRows (attribute generator)', () => {
  it('adds the missing combinations, keeps existing rows (id, price, stock) and never drops unmatched ones', () => {
    const pink = newVariantRow('var_pink', { name: 'Pink', price: '300', stock: '20' })
    const custom = newVariantRow('var_custom', { name: 'Limited edition', price: '999', stock: '3' })
    const out = rebuildVariantRows([{ name: 'Color', options: ['Pink', 'White'] }], [pink, custom])
    assert.deepEqual(out.map((r) => r.name), ['Pink', 'White', 'Limited edition'])
    assert.equal(out[0], pink, 'the existing row is reused, not recreated')
    assert.match(out[1].id, /^var_\d+_1$/)
    assert.ok(out.every((r) => /^var_[A-Za-z0-9_\-]+$/.test(r.id)), 'ids follow the var_ convention')
    assert.equal(rebuildVariantRows([], [pink]).length, 1, 'no attributes = nothing is touched')
  })
  it('two attributes -> cartesian product named "A / B"', () => {
    const out = rebuildVariantRows([{ name: 'Color', options: ['Red', 'Blue'] }, { name: 'Size', options: ['S', 'M'] }], [])
    assert.deepEqual(out.map((r) => r.name), ['Red / S', 'Red / M', 'Blue / S', 'Blue / M'])
  })
})

describe('explainSaveError', () => {
  it('turns server messages into admin-friendly text', () => {
    assert.match(explainSaveError({ message: 'Could not find the function public.save_product(p_product) in the schema cache', code: 'PGRST202' }), /apply migrations 20261014_01 and 20261014_02/)
    assert.match(explainSaveError({ code: '40001', message: 'This product was changed by someone else since you opened it.' }), /nothing was saved/)
    assert.equal(explainSaveError({ code: '23505', message: 'SKU "A" is already used by product p1' }), 'SKU "A" is already used by product p1')
    assert.equal(explainSaveError(null), 'Error saving product')
  })
})

describe('store-wide return / exchange defaults (Admin ▸ Optimization, Phase 2)', () => {
  const on = { returnEnabled: true, returnDays: '7', exchangeEnabled: true, exchangeDays: '7' }

  it('policyToSettings: enabled sides carry whole-number windows, disabled sides carry NULL (the DB rule)', () => {
    assert.deepEqual(policyToSettings({ returnEnabled: true, returnDays: '10', exchangeEnabled: false, exchangeDays: '5' }),
      { returnEnabled: true, returnWindowDays: 10, exchangeEnabled: false, exchangeWindowDays: null, noReturnCategories: [], noExchangeCategories: [] })
    assert.equal(policyToSettings({ returnEnabled: false, returnDays: '', exchangeEnabled: true, exchangeDays: '3' }).returnWindowDays, null)
  })

  it('policyToSettings cleans the category lists: trimmed, de-duplicated case-insensitively, blanks dropped', () => {
    const s = policyToSettings(on, { noReturnCategories: [' Fresh sweets ', 'fresh SWEETS', '', null, 'Gifts'], noExchangeCategories: 'not a list' })
    assert.deepEqual(s.noReturnCategories, ['Fresh sweets', 'Gifts'])
    assert.deepEqual(s.noExchangeCategories, [])
  })

  it('round trip: settings -> form -> settings keeps every value', () => {
    const stored = { returnEnabled: true, returnWindowDays: 14, exchangeEnabled: false, exchangeWindowDays: null, noReturnCategories: ['Perishables'], noExchangeCategories: ['Perishables', 'Custom'] }
    const form = policyFromSettings(stored)
    assert.deepEqual(form, { returnEnabled: true, returnDays: '14', exchangeEnabled: false, exchangeDays: '7' })
    assert.deepEqual(policyToSettings(form, categoryListsFromSettings(stored)), stored)
  })

  it('what the editor produces always passes the same validation as a product (policyError)', () => {
    assert.equal(policyError({ returnEnabled: true, returnDays: '0', exchangeEnabled: true, exchangeDays: '7' }), 'return window must be a whole number of days between 1 and 365')
    assert.equal(policyError({ returnEnabled: false, returnDays: '', exchangeEnabled: true, exchangeDays: '366' }), 'exchange window must be a whole number of days between 1 and 365')
    assert.equal(policyError(on), null)
  })

  it('categoryListsFromSettings tolerates missing / malformed documents', () => {
    assert.deepEqual(categoryListsFromSettings(undefined), { noReturnCategories: [], noExchangeCategories: [] })
    assert.deepEqual(categoryListsFromSettings({ noReturnCategories: 'x' }), { noReturnCategories: [], noExchangeCategories: [] })
  })

  it('policyForCategory (Q-1): a listed category starts with that policy OFF, others keep the store defaults', () => {
    const lists = { noReturnCategories: ['Fresh Sweets'], noExchangeCategories: ['fresh sweets', 'Custom'] }
    assert.deepEqual(policyForCategory(on, lists, 'fresh sweets'), { returnEnabled: false, returnDays: '7', exchangeEnabled: false, exchangeDays: '7' })
    assert.deepEqual(policyForCategory(on, lists, ' Custom '), { returnEnabled: true, returnDays: '7', exchangeEnabled: false, exchangeDays: '7' })
    assert.deepEqual(policyForCategory(on, lists, 'shirts'), on)
    assert.deepEqual(policyForCategory(on, lists, ''), on)
    assert.deepEqual(policyForCategory(on, undefined, 'x'), on)
    assert.equal(on.returnEnabled, true, 'the store default object is not mutated')
  })
})