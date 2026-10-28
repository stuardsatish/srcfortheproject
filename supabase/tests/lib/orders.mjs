// Calls create_order_tx exactly the way supabase/functions/_shared/orderWriter.ts does
// (named RPC arguments, p_items as the jsonb array shaped by toOrderItemsJson).
export const ALICE = '00000000-0000-0000-0000-0000000000a1'
export const BOB = '00000000-0000-0000-0000-0000000000a2'
export const ADMIN = '00000000-0000-0000-0000-0000000000ad'

/** One p_items element. `extra` carries the new optional keys (mrp, gst_rate, hsn_code). */
export const item = (productId, variantId, quantity, { unit = 100, discount = 0, title, ...extra } = {}) => ({
  product_id: productId,
  variant_id: variantId || null,
  variant_name: null,
  title: title || `${productId}${variantId ? ' [' + variantId + ']' : ''}`,
  quantity,
  unit_price: unit,
  discount,
  cgst: 0, sgst: 0, igst: 0,
  line_total: Math.round(unit * quantity * 100) / 100,
  ...extra,
})

export async function placeOrder(client, { orderId, userId = ALICE, items, status = 'placed', payment = 'paid', method = 'Razorpay', source = 'online' }) {
  const total = items.reduce((s, i) => s + i.line_total, 0)
  const r = await client.query(
    `select * from public.create_order_tx(
       p_order_id := $1, p_user_id := $2, p_items := $3::jsonb, p_order_status := $4, p_payment_status := $5,
       p_payment_method := $6, p_source := $7, p_customer_name := 'T', p_customer_email := 't@example.test',
       p_customer_phone := '9999999999', p_address := '{}'::jsonb, p_subtotal := $8, p_shipping := 0,
       p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := $8,
       p_razorpay_order_id := null, p_razorpay_payment_id := null)`,
    [orderId, userId, JSON.stringify(items), status, payment, method, source, total])
  return r.rows[0]
}

export const stockOf = async (client, productId, variantId = '') => {
  const r = variantId
    ? await client.query('select stock from public.product_variants where id = $1', [variantId])
    : await client.query('select stock from public.products where id = $1', [productId])
  return r.rows[0]?.stock
}