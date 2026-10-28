// The row "Save for later" writes into public.saved_items (20261008_03_cart_enhancements.sql).
// `user_id` MUST be part of it: the column has no default and the row-level-security check is `user_id = auth.uid()`, so a row
// without it is refused with "new row violates row-level security policy for table saved_items" (found in the browser test round,
// 2026-10-18: "Save for later" had never worked on the live project). Pure, no imports - unit-tested in
// src/services/__tests__/savedItemRow.test.mjs. The phone app has its own copy (Ecommerce-App-v2-main/src/services/savedItemRow.js).

/** A cart line + the signed-in user's id -> the saved_items row. Throws when nobody is signed in. */
export function savedItemRow(cartItem, userId) {
  if (!userId) throw new Error("Please sign in to save items for later.")
  const item = cartItem || {}
  return {
    user_id: userId,
    product_id: item.productId || String(item.id || "").split("_var_")[0],
    variant_id: item.variant_id || "",
    variant_name: item.variant_name || "",
    selected_variant: item.selected_variant || null,
    quantity: item.quantity || 1,
    title: item.title || "",
    image: item.thumbnail || item.image || "",
    category: item.category || "",
    price: item.price || 0,
    discount: item.discount || 0,
    discount_expiry: item.discountExpiry || null,
  }
}