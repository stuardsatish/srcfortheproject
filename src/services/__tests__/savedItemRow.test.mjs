// node --test src/services/__tests__/savedItemRow.test.mjs   (npm run test:unit)
// Regression: "Save for later" built its row WITHOUT user_id, so the database's row-level security (user_id = auth.uid()) refused it.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { savedItemRow } from '../savedItemRow.js'

const line = { id: 'prod_1_var_pink', productId: 'prod_1', variant_id: 'var_pink', variant_name: 'Pink', quantity: 2, title: 'Tee', thumbnail: 't.jpg', category: 'Shirts', price: 300, discount: 10, discountExpiry: '2026-12-31T00:00:00Z', selected_variant: { color: 'Pink' } }

describe('savedItemRow', () => {
  it('carries the owner: user_id is always in the row (the RLS check is user_id = auth.uid())', () => {
    const row = savedItemRow(line, 'u-1')
    assert.equal(row.user_id, 'u-1')
    assert.equal(Object.keys(row).includes('user_id'), true)
  })
  it('maps the cart line to the table columns', () => {
    assert.deepEqual(savedItemRow(line, 'u-1'), {
      user_id: 'u-1', product_id: 'prod_1', variant_id: 'var_pink', variant_name: 'Pink', selected_variant: { color: 'Pink' }, quantity: 2,
      title: 'Tee', image: 't.jpg', category: 'Shirts', price: 300, discount: 10, discount_expiry: '2026-12-31T00:00:00Z',
    })
  })
  it('defaults: a bare line saves as quantity 1, no variant, empty text, price 0', () => {
    assert.deepEqual(savedItemRow({ id: 'prod_9' }, 'u-1'), {
      user_id: 'u-1', product_id: 'prod_9', variant_id: '', variant_name: '', selected_variant: null, quantity: 1,
      title: '', image: '', category: '', price: 0, discount: 0, discount_expiry: null,
    })
  })
  it('finds the product id of an old line that only has the compound id', () => {
    assert.equal(savedItemRow({ id: 'prod_5_var_x' }, 'u').product_id, 'prod_5')
  })
  it('refuses when nobody is signed in (instead of sending a row the database would refuse)', () => {
    assert.throws(() => savedItemRow(line, ''), /sign in/i)
    assert.throws(() => savedItemRow(line, undefined), /sign in/i)
  })
})