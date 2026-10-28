// Admin POS (BillingPage): every bill line is a purchasable OPTION = (productId, variantId), exactly like the storefront cart.
// Pure (no React, no Supabase) so it is unit-tested:  src/features/pos/__tests__/billOptions.test.mjs  (npm run test:unit).
// The SERVER stays authoritative (orders-billing-create re-prices every line from the catalog); nothing here is trusted by it.
//
// Before this module the POS keyed bill lines by productId only, so a product with variants could only ever be billed as its
// main product. Now: one line per (product, option); a variant of the same product is a SEPARATE line.
import { getPurchaseOptions, defaultOption, isAvailable } from "../products/purchaseOptions.js"

/** Stock cap for untracked options (the bill UI clamps quantities on `stock`, same idea as buildCartPayload's 999999). */
export const UNLIMITED = 999999

const lower = (v) => String(v ?? "").toLowerCase()

/** Identity of a bill line. '' variant = the main / only option. */
export const billLineKey = (productId, variantId = "") => `${productId}::${variantId || ""}`

/** "Designer Shirt — Pink" for a variant line, the plain title otherwise. */
export const lineLabel = (line) => (line?.variantName ? `${line.title} — ${line.variantName}` : (line?.title || "Product"))

/**
 * Unit price of ONE option after the product-level discount (the larger of product / category discount, as the POS always
 * did; the billing route deliberately ignores discount_expiry — see orders-billing-create).
 * The option's OWN price is the MRP: the main price is never used for a variant.
 */
export function unitPriceOfOption(product, option) {
  const price = Number(option ? option.price : product?.price) || 0
  const disc = Math.max(Number(product?.discount || 0), Number(product?.categoryDiscount || 0))
  return { mrp: price, discount: disc, finalPrice: price - (price * disc) / 100, gstRate: Number(product?.gstRate || 0) }
}

/**
 * Search results, one entry per purchasable option. A query that matches the PRODUCT (title / sku / category) lists all its
 * options; a query that only matches a variant (name / sku) lists just that variant.
 */
export function searchBillOptions(products, query, limit = 12) {
  const q = lower(query).trim()
  if (!q) return []
  const out = []
  for (const product of products || []) {
    const productHit = lower(product.title).includes(q) || lower(product.sku).includes(q) || lower(product.category).includes(q)
    for (const option of getPurchaseOptions(product)) {
      if (!(productHit || lower(option.name).includes(q) || lower(option.sku).includes(q))) continue
      out.push({ key: billLineKey(product.id, option.variantId), product, option })
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * Barcode / SKU / product-id entry. A variant SKU selects that variant; a product SKU selects the main (or only) option.
 * A product id (legacy behaviour) selects the product's default option.
 * Returns { product, option } — `option` is null when the code is the SKU of a product whose MAIN option is not sold
 * (the caller tells the admin to pick a variant) — or null when nothing matches.
 */
export function findOptionByCode(products, code) {
  const c = lower(code).trim()
  if (!c) return null
  let mainNotSold = null
  for (const product of products || []) {
    for (const option of getPurchaseOptions(product)) {
      if (option.sku && lower(option.sku) === c) return { product, option }
    }
    if (product.sku && lower(product.sku) === c) mainNotSold = mainNotSold || { product, option: null }
  }
  const byId = (products || []).find((p) => lower(p.id) === c)
  if (byId) return { product: byId, option: defaultOption(byId) }
  return mainNotSold
}

/** The bill line for (product, option). */
export function makeBillLine(product, option) {
  const { mrp, discount, finalPrice, gstRate } = unitPriceOfOption(product, option)
  return {
    lineKey: billLineKey(product.id, option.variantId),
    productId: product.id,
    variantId: option.variantId || "",
    variantName: option.kind === "variant" ? option.name : "",
    itemType: option.kind, // single | main | variant (display only; the server decides what is stored)
    title: product.title || "Product",
    category: product.category || "general",
    sku: option.sku || "",
    thumbnail: option.image || product.thumbnail || "",
    stock: option.stock === null ? UNLIMITED : option.stock,
    mrp, discount, finalPrice, gstRate,
    quantity: 1,
  }
}

/** Held bills saved BEFORE variants existed have no lineKey / variantId: they are plain main-option lines. */
export const normalizeBillLine = (it) => ({
  ...it,
  variantId: it?.variantId || "",
  variantName: it?.variantName || "",
  lineKey: it?.lineKey || billLineKey(it?.productId, it?.variantId),
})

/** Adds one unit of an option. Returns { lines, error } — `error` is a message for the admin, `lines` is unchanged then. */
export function addOptionToBill(lines, product, option) {
  if (!product) return { lines, error: "Product not found" }
  if (!option) return { lines, error: `"${product.title}" cannot be sold on its own — choose one of its variants` }
  const label = option.kind === "variant" ? `${product.title} — ${option.name}` : product.title
  if (!isAvailable(option)) return { lines, error: `"${label}" is out of stock` }
  const key = billLineKey(product.id, option.variantId)
  const idx = lines.findIndex((l) => l.lineKey === key)
  if (idx < 0) return { lines: [...lines, makeBillLine(product, option)], error: null }
  const cur = lines[idx]
  if (cur.quantity + 1 > cur.stock) return { lines, error: `Only ${cur.stock} in stock for "${lineLabel(cur)}"` }
  const next = [...lines]
  next[idx] = { ...cur, quantity: cur.quantity + 1 }
  return { lines: next, error: null }
}

/** +1 / -1 on a line; reaching 0 removes it; above stock is refused. */
export function changeLineQty(lines, key, delta) {
  let error = null
  const next = lines.flatMap((l) => {
    if (l.lineKey !== key) return [l]
    const q = l.quantity + delta
    if (q <= 0) return []
    if (q > l.stock) { error = `Only ${l.stock} in stock for "${lineLabel(l)}"`; return [l] }
    return [{ ...l, quantity: q }]
  })
  return { lines: next, error }
}

/** Typed quantity: <= 0 / NaN keeps the line, above stock clamps to stock (and reports it). */
export function setLineQty(lines, key, value) {
  const v = Math.floor(Number(value) || 0)
  let error = null
  const next = lines.map((l) => {
    if (l.lineKey !== key || v <= 0) return l
    if (v > l.stock) error = `Only ${l.stock} in stock for "${lineLabel(l)}"`
    return { ...l, quantity: Math.min(v, l.stock) }
  })
  return { lines: next, error }
}

export const removeLine = (lines, key) => lines.filter((l) => l.lineKey !== key)

/** Items exactly as the orders-billing-create Edge Function reads them. */
export const billPayloadItems = (lines) => lines.map((l) => ({ productId: l.productId, variantId: l.variantId || "", quantity: l.quantity }))