import { supabase } from "../context/SupabaseConfig"

// Mirrors CartSlice's addCart/removeCart increment/decrement logic so the
// Supabase row always lands on the same quantity Redux is about to show.
//
// Identity must be resolved the SAME way CartSlice resolves it: `id || compound_id`. Matching on `x.id` alone (as
// these did) meant that for a line carrying only `compound_id` the slice would increment the existing line while
// these helpers found nothing and returned 1 — persisting quantity 1 over a line Redux had just moved to 2. The RN
// app fixed this already (see Ecommerce-App-v2-main/__tests__/logic/cart-identity.test.js); the web is aligned here.
const cartIdOf = (item) => String(item?.id || item?.compound_id || "")

export const nextAddQuantity = (cartItems, cartId) => {
  const existing = (cartItems || []).find((x) => cartIdOf(x) === String(cartId))
  return existing ? existing.quantity + 1 : 1
}

export const nextRemoveQuantity = (cartItems, cartId) => {
  const existing = (cartItems || []).find((x) => cartIdOf(x) === String(cartId))
  if (!existing) return 0
  return existing.quantity > 1 ? existing.quantity - 1 : 0
}

/**
 * Upsert a cart row for either a single or variant product.
 *
 * For single products: product.variantId is undefined / falsy.
 * For variant products: product.variantId is the variant's id string,
 *   product.id is the compound cart key (`${productId}_${variantId}`),
 *   and product.productId is the real products-table id.
 *
 * The DB conflict key is (user_id, product_id, variant_id) — see migration SQL.
 * Single products use variant_id = '' so they don't collide with any variant row.
 */
export const upsertCartItem = async (uid, product, quantity) => {
  if (!uid) return
  // Accept both camelCase (variantId) and snake_case (variant_id) — callers use both.
  const variantId = product.variantId || product.variant_id || ""
  const variantName = product.variantName || product.variant_name || null
  // product_id stored in the DB is always the actual products-table id. (The old fallback split on the FIRST "_",
  // which turns the real id "prod_1700000000" into "prod"; parseCartIds splits only on the "_var_" marker.)
  const realProductId = product.productId || parseCartIds(product).productId

  const variantImg = product.selected_variant?.image || product.selectedVariant?.image || product.image || product.thumbnail || ""

  const { error } = await supabase.from("cart_items").upsert(
    {
      user_id: uid,
      product_id: String(realProductId),
      variant_id: variantId,
      variant_name: variantName,
      selected_variant: product.selected_variant || product.selectedVariant || null,
      quantity,
      title: product.title || "",
      image: variantImg,
      category: product.category || "general",
      price: Number(product.price) || 0,
      discount: Number(product.discount || 0),
      discount_expiry: product.discountExpiry || null,
    },
    { onConflict: "user_id,product_id,variant_id" }
  )
  if (error) console.error("Cart upsert error:", error)
}

export const parseCartIds = (productOrId, variantId = "") => {
  if (!productOrId) return { productId: "", variantId: "" }

  if (typeof productOrId === "object") {
    const pId = productOrId.productId || productOrId.product_id || ""
    const vId = productOrId.variant_id || productOrId.variantId || ""
    if (pId) {
      return { productId: String(pId), variantId: String(vId || "") }
    }
    const rawId = String(productOrId.id || productOrId.compound_id || "")
    if (rawId.includes("_var_")) {
      const idx = rawId.indexOf("_var_")
      return { productId: rawId.slice(0, idx), variantId: rawId.slice(idx + 1) }
    }
    return { productId: rawId, variantId: String(vId || "") }
  }

  const rawId = String(productOrId)
  if (rawId.includes("_var_")) {
    const idx = rawId.indexOf("_var_")
    return { productId: rawId.slice(0, idx), variantId: rawId.slice(idx + 1) }
  }
  return { productId: rawId, variantId: String(variantId || "") }
}

export const removeCartItem = async (uid, productOrId, variantId = "") => {
  if (!uid) return
  const { productId: pId, variantId: vId } = parseCartIds(productOrId, variantId)
  if (!pId) return

  let query = supabase.from("cart_items").delete().eq("user_id", uid).eq("product_id", pId)
  if (vId) {
    query = query.eq("variant_id", vId)
  } else {
    // Single product: variant_id is either null or ''
    query = query.or("variant_id.is.null,variant_id.eq.")
  }

  const { error } = await query
  if (error) console.error("Cart remove error:", error)
}

export const decrementOrRemoveCartItem = async (uid, productOrId, newQuantity, variantId = "") => {
  if (!uid) return
  const { productId: pId, variantId: vId } = parseCartIds(productOrId, variantId)
  if (!pId) return

  if (newQuantity > 0) {
    let query = supabase.from("cart_items").update({ quantity: newQuantity }).eq("user_id", uid).eq("product_id", pId)
    if (vId) {
      query = query.eq("variant_id", vId)
    } else {
      query = query.or("variant_id.is.null,variant_id.eq.")
    }
    const { error } = await query
    if (error) console.error("Cart update error:", error)
  } else {
    await removeCartItem(uid, productOrId, variantId)
  }
}

export const clearCartItems = async (uid) => {
  if (!uid) return
  const { error } = await supabase.from("cart_items").delete().eq("user_id", uid)
  if (error) console.error("Cart clear error:", error)
}