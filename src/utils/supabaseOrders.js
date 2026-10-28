import { mapShipmentRows } from "../features/orders/shipmentModel"

// Maps `orders` + `order_items` rows (snake_case, per 01-schema.sql) to the
// camelCase shape the rest of the app was built around when orders lived in
// Firestore. All reads from the orders table should go through this normalizer.
//
// IMPORTANT — resolvedFinalPrice compatibility:
//   AdminOrdersPage has a `resolvedFinalPrice` helper that detects an old
//   Firestore-backend bug where finalPrice was stored equal to the MRP.
//   It fires when `disc > 0 && stored >= mrp && mrp > 0`. To prevent that
//   branch from double-discounting Supabase order items (where unit_price IS
//   already the correct post-discount price), we intentionally do NOT expose a
//   `price` field on mapped items so that mrp resolves to 0 and the condition
//   `mrp > 0` stays false. `finalPrice` alone is enough for every UI consumer.
export const mapOrderRow = (row) => {
  if (!row) return row
  const items = (row.order_items || []).map((it) => {
    const unitPrice = Number(it.unit_price ?? it.price ?? it.final_price ?? 0)
    const qty = Number(it.quantity) || 1
    const lineTotal = Number(it.line_total) || (unitPrice * qty)
    const effectivePrice = unitPrice > 0 ? unitPrice : (lineTotal > 0 && qty > 0 ? lineTotal / qty : 0)

    return {
      productId: it.product_id,
      variantId: it.variant_id || null,
      variantName: it.variant_name || null,
      title: it.title || "",
      quantity: qty,
      // unit_price is the final charged price per unit (already discounted).
      finalPrice: effectivePrice,
      price: effectivePrice,
      unitPrice: effectivePrice,
      discount: Number(it.discount) || 0,
      lineTotal: lineTotal,

    // ── Purchase-time snapshot (migration 20261014_01). Pre-migration rows have none of this (all undefined/empty).
    // order_items.id is THE key for everything after delivery (return / exchange / refund of ONE line).
    id: it.id || null,
    // 'single' | 'main' | 'variant' (the product page option that was bought); '' for rows older than the migration
    itemType: it.item_type || "",
    sku: it.sku || "",
    productTitle: it.product_title || "",
    snapshotImage: it.image || "",
    snapshotSource: it.snapshot_source || "",   // 'order' (exact) | 'backfill' (reconstructed from the title)
    // The return / exchange policy that applied when it was bought (null = unknown/legacy -> use the product's)
    policy: it.return_enabled == null && it.exchange_enabled == null ? null : {
      returnEnabled: it.return_enabled !== false,
      returnWindowDays: it.return_window_days ?? null,
      exchangeEnabled: it.exchange_enabled !== false,
      exchangeWindowDays: it.exchange_window_days ?? null,
    },
    // NB: still NO `price` / `mrp` field — see the resolvedFinalPrice note at the top of this file.
  }})

  const itemsTotal = items.reduce((sum, it) => sum + (it.lineTotal || it.finalPrice * it.quantity), 0)
  const orderTotal = Number(row.total ?? row.total_amount ?? 0) || itemsTotal

  // address is jsonb in Supabase — expose under all aliases the UI checks.
  const addr = row.address

  return {
    id: row.id,
    userId: row.user_id,
    orderStatus: row.order_status || "placed",
    paymentStatus: row.payment_status || "pending",
    paymentMethod: row.payment_method || "",
    source: row.source || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    // Schema uses customer_* not user_*; re-expose under the camelCase names
    // the rest of the UI expects.
    userName: row.customer_name || "",
    userEmail: row.customer_email || "",
    userPhone: row.customer_phone || "",

    // address is jsonb; expose under all aliases the UI checks
    userAddress: addr,
    address: addr,
    shippingAddress: addr,

    // financial fields
    subtotal: Number(row.subtotal) || 0,
    shipping: Number(row.shipping) || 0,
    total: orderTotal,
    totalAmount: orderTotal,
    promoCode: row.promo_code || "",
    promoDiscount: Number(row.promo_discount) || 0,

    // GST breakdown (stored as cgst/sgst/igst on the orders row)
    totalCgst: Number(row.cgst) || 0,
    totalSgst: Number(row.sgst) || 0,
    totalIgst: Number(row.igst) || 0,

    // Razorpay IDs
    razorpayOrderId: row.razorpay_order_id || "",
    razorpayPaymentId: row.razorpay_payment_id || "",

    // order_items mapped to `products` (UI-facing name for the line-items array)
    products: items,

    // ── Shipping (migration 20261017_03_shipping.sql). All empty / null on a server without it or for rows nobody shipped yet.
    // delivered_at anchors every return / exchange window; `deliveredAtSource === 'backfill_updated_at'` means it is only approximate.
    deliveredAt: row.delivered_at || null,
    deliveredAtSource: row.delivered_at_source || "",
    shipments: mapShipmentRows(row.shipments),
  }
}

export const mapOrderRows = (rows) => (rows || []).map(mapOrderRow)

/**
 * Resolves the accurate image for an order line item.
 * Prioritizes the specific variant's image when variantId or variant title matches,
 * falling back to base product thumbnail/image.
 */
export const resolveOrderItemImage = (item, product) => {
  if (!product) return item?.thumbnail || item?.image || ""
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
    if (v && v.image) {
      return v.image
    }
  }
  return product.thumbnail || product.image || item?.thumbnail || item?.image || ""
}