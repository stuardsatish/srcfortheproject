// WhatsApp order channel: the message a customer sends -> parsed -> resolved to purchasable options.
//   node --test whatsapp.test.mjs      (also part of `npm test`)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseWhatsAppMessage } from '../functions/_shared/whatsappMessage.ts'
import { resolveOptionByTitle } from '../functions/_shared/cartPricing.ts'

// exactly what web CartPage.jsx sendOrderToWhatsApp() emits now (note the markdown asterisks and the leading spaces)
const NEW = `Hello,

I would like to place the following order.

**Customer Details:**

Customer ID: 00000000-0000-0000-0000-0000000000a1
Customer Name: Alice
Email: alice@example.test
Phone: 9999999999


**Items:**

1. Designer Shirt
 Ref: prod_1700000000001|
 Quantity: 1
 MRP: ₹500.00
 Discount: 10%
 Discounted Price: ₹450.00

2. Designer Shirt [Pink]
 Ref: prod_1700000000001|var_1700000000001_0
 Quantity: 2
 MRP: ₹300.00
 Discounted Price: ₹300.00

Total Items : 3
Subtotal : ₹1050.00
Shipping : ₹0.00
Promo Code : SAVE5
Promo Discount : ₹50.00
Total Amount : ₹1000.00

Thank you.`

// the same message as an OLD client sent it: no Ref lines
const OLD = NEW.replace(/ Ref: .*\n/g, '')

describe('parseWhatsAppMessage', () => {
  it('reads customer, totals and every item (new format with Ref lines)', () => {
    const m = parseWhatsAppMessage(NEW)
    assert.deepEqual([m.customerId, m.customerName, m.email, m.phone], ['00000000-0000-0000-0000-0000000000a1', 'Alice', 'alice@example.test', '9999999999'])
    assert.deepEqual([m.totalItems, m.subtotal, m.shipping, m.promoCode, m.promoDiscount, m.totalAmount], [3, 1050, 0, 'SAVE5', 50, 1000])
    assert.equal(m.items.length, 2)
    assert.deepEqual(m.items.map((i) => [i.title, i.quantity, i.mrp, i.discountPct, i.discountedPrice]), [
      ['Designer Shirt', 1, 500, 10, 450], ['Designer Shirt [Pink]', 2, 300, 0, 300]])
  })

  it('captures the optional Ref: "productId|variantId" (variantId empty = main option)', () => {
    const [main, pink] = parseWhatsAppMessage(NEW).items
    assert.equal(main.ref, 'prod_1700000000001|')
    assert.equal(pink.ref, 'prod_1700000000001|var_1700000000001_0')
  })

  it('an OLD message without Ref lines parses identically and has empty refs (title resolution takes over)', () => {
    const o = parseWhatsAppMessage(OLD)
    assert.deepEqual(o.items.map((i) => [i.title, i.quantity, i.ref]), [['Designer Shirt', 1, ''], ['Designer Shirt [Pink]', 2, '']])
    assert.equal(o.totalAmount, 1000)
  })

  it('a Ref line is never mistaken for an item, a total or a field', () => {
    const m = parseWhatsAppMessage('Customer ID: u1\n\n1. Thing\n Ref: 5IJsGY9jHkYbMH7maxjS|\n Quantity: 1\n Price: ₹10\n\nTotal Amount : ₹10')
    assert.equal(m.items.length, 1); assert.equal(m.items[0].ref, '5IJsGY9jHkYbMH7maxjS|'); assert.equal(m.items[0].mrp, 10)
  })

  it('legacy "Price:" lines and "Promo Code : None" still work', () => {
    const m = parseWhatsAppMessage('Customer ID: u1\n1. Old Item\n Quantity: 2\n Price: ₹40\nPromo Code : None\nTotal Amount : ₹80')
    assert.deepEqual([m.items[0].mrp, m.items[0].discountedPrice, m.promoCode, m.totalAmount], [40, 40, '', 80])
  })

  it('items with no quantity are ignored, garbage input yields an empty result', () => {
    assert.equal(parseWhatsAppMessage('1. Nothing\n Price: 5').items.length, 0)
    assert.equal(parseWhatsAppMessage('').items.length, 0)
  })
})

describe('parsed lines resolve to the right purchasable option (the whole point of the channel)', () => {
  const shirt = { id: 'prod_1700000000001', title: 'Designer Shirt', category: 'shirts', sku: 'DS', price: 500, stock: 10, discount: 10, discount_expiry: null, gst_rate: 12, hsn_code: '', has_variants: true, main_option_enabled: true }
  const pink = { id: 'var_1700000000001_0', product_id: shirt.id, name: 'Pink', sku: 'DS-P', price: 300, stock: 20, status: 'active' }
  const variants = new Map([[shirt.id, [pink]]])

  it('"Designer Shirt" -> the MAIN option at the main price; "Designer Shirt [Pink]" -> the Pink variant at ITS price', () => {
    const [a, b] = parseWhatsAppMessage(NEW).items
    const ra = resolveOptionByTitle(a.title, [shirt], variants)
    const rb = resolveOptionByTitle(b.title, [shirt], variants)
    assert.ok(ra.ok && rb.ok)
    assert.deepEqual([ra.variant, rb.variant.id], [null, pink.id])
    assert.deepEqual([ra.product.price, rb.variant.price], [500, 300], 'independent prices')
  })
})