// "Buy again": turn the lines of a past order into cart additions — pure and unit-tested
// (src/features/orders/__tests__/buyAgainPlan.test.mjs, `npm run test:unit`).
//
// The three old handlers (current orders, past orders, order detail) each added quantity 1 of `productId`, sent an
// undefined price, and silently dropped the variant. The plan below
//   * re-adds the SAME option that was bought (main or the specific variant) at the quantity that was ordered,
//   * uses the option's CURRENT price / stock / image (never the old order price),
//   * clamps to what is in stock and tells the customer what was skipped or reduced, and why.
import { buildCartPayload, cartCompoundId, optionForVariantId, isAvailable } from "../products/purchaseOptions.js"   // explicit .js: this file is also run by Node's test runner

/**
 * @param orderLines  mapOrderRow(...).products
 * @param productsById Map/obj of CURRENT mapProductRow() products by id
 * @param cartItems   current Redux cart (to add on top of what is already there)
 * @returns { add: [{ product, option, payload, compoundId, quantity, nextTotal, note? }], skipped: [{ title, reason }] }
 */
export function buildBuyAgainPlan(orderLines, productsById, cartItems = []) {
  const add = []
  const skipped = []
  const get = (id) => (productsById instanceof Map ? productsById.get(id) : productsById?.[id])
  const inCart = (cid) => {
    const x = (cartItems || []).find((i) => String(i.id || i.compound_id) === String(cid))
    return x ? Number(x.quantity) || 0 : 0
  }

  // the same option twice in one order (rare, e.g. two bill lines) is added once with the summed quantity
  const merged = new Map()
  for (const line of orderLines || []) {
    const variantId = String(line.variantId || "")
    const key = `${line.productId}\u0000${variantId}`
    const prev = merged.get(key)
    if (prev) prev.quantity += Number(line.quantity) || 1
    else merged.set(key, { ...line, variantId, quantity: Number(line.quantity) || 1 })
  }

  for (const line of merged.values()) {
    const title = line.title || line.productTitle || "An item"
    const product = get(line.productId)
    if (!product) { skipped.push({ title, reason: "no longer sold" }); continue }

    // legacy order line that was a variant but whose variant could not be identified (title suffix only)
    if (line.itemType === "variant" && !line.variantId) {
      skipped.push({ title, reason: "variant could not be identified — open the product to choose it" })
      continue
    }

    const option = optionForVariantId(product, line.variantId)
    if (!option) {
      skipped.push({ title, reason: line.variantId ? "that variant is no longer available" : "choose a variant on the product page" })
      continue
    }
    if (!isAvailable(option)) { skipped.push({ title, reason: "out of stock" }); continue }

    const compoundId = cartCompoundId(product, option)
    const already = inCart(compoundId)
    const cap = option.stock === null ? Infinity : option.stock
    const room = cap - already
    if (room <= 0) { skipped.push({ title, reason: "the maximum available is already in your cart" }); continue }
    const quantity = Math.min(line.quantity, room)

    add.push({
      product, option, compoundId, quantity,
      payload: buildCartPayload(product, option),
      nextTotal: already + quantity,
      note: quantity < line.quantity ? `only ${quantity} of ${line.quantity} added (stock)` : undefined,
    })
  }
  return { add, skipped }
}

/** One toast sentence for the result. */
export function describeBuyAgain({ add, skipped }) {
  const parts = []
  if (add.length) parts.push(`${add.length} item${add.length > 1 ? "s" : ""} added to your cart`)
  const reduced = add.filter((a) => a.note)
  if (reduced.length) parts.push(reduced.map((a) => `${a.option.name || a.product.title}: ${a.note}`).join("; "))
  if (skipped.length) parts.push(`Not added — ${skipped.map((s) => `${s.title} (${s.reason})`).join("; ")}`)
  return parts.join(". ")
}