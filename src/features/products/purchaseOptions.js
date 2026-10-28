// Purchasable options of a product — ONE place for the rules the storefront (product page, cards, cart, buy-again)
// must agree on. Pure (no React, no Supabase) so it is unit-tested:
//   src/features/products/__tests__/purchaseOptions.test.mjs     (npm run test:unit)
// The React Native app carries a copy of this file (src/utils/purchaseOptions.js) with the same tests — the project
// deliberately has no shared package between the two apps (MIGRATION_ANALYSIS §12). The SERVER stays authoritative
// for price / stock / eligibility; nothing here is trusted by it.
//
// MODEL — a purchasable option is (productId, variantId) and variantId '' means the main (or only) option:
//   single product        -> one option, kind "single"
//   product with variants -> the MAIN option (kind "main", only when product.mainOptionEnabled) + one per ACTIVE variant
// Every option has its OWN price, stock, SKU, image and return/exchange policy; the main price is never derived
// from the variants and a variant is never "added" when the main product is bought (or the other way round).

const num = (v) => Number(v) || 0

/** Active variants from the (trigger-maintained) products.variants cache. */
export const listVariants = (product) =>
  (Array.isArray(product?.variants) ? product.variants : []).filter((v) => v && v.id != null && v.status !== "inactive")

const policyOf = (enabled, days) => ({ enabled: enabled !== false, days: enabled === false ? null : (days ?? null) })

/** The main (or only) option, or null when a variant product does not sell its main product. */
export function getMainOption(product) {
  if (!product) return null
  const hasVariants = !!product.hasVariants && listVariants(product).length > 0
  if (hasVariants && product.mainOptionEnabled === false) return null
  const tracked = product.trackInventory !== false
  return {
    key: "",
    kind: hasVariants ? "main" : "single",
    variantId: "",
    name: product.title || "",
    label: hasVariants ? "Main product" : (product.title || ""),
    price: num(product.price),
    stock: tracked ? num(product.stock) : null,            // null = not tracked (always available)
    sku: product.sku || "",
    image: product.thumbnail || product.image || "",
    returnPolicy: policyOf(product.returnEnabled, product.returnWindowDays),
    exchangePolicy: policyOf(product.exchangeEnabled, product.exchangeWindowDays),
    variant: null,
  }
}

/** The option for one variant object of product.variants. */
export function getVariantOption(product, v) {
  const tracked = v.track_inventory !== false && v.trackInventory !== false
  // A variant either overrides BOTH sides of a policy (enabled set) or inherits (enabled NULL)
  const ret = v.return_enabled ?? v.returnEnabled
  const exc = v.exchange_enabled ?? v.exchangeEnabled
  return {
    key: String(v.id),
    kind: "variant",
    variantId: String(v.id),
    name: v.name || "",
    label: v.name || "",
    price: num(v.price),
    stock: tracked ? num(v.stock) : null,
    sku: v.sku || "",
    image: v.image || "",
    returnPolicy: ret == null ? policyOf(product?.returnEnabled, product?.returnWindowDays) : policyOf(ret, v.return_window_days ?? v.returnWindowDays),
    exchangePolicy: exc == null ? policyOf(product?.exchangeEnabled, product?.exchangeWindowDays) : policyOf(exc, v.exchange_window_days ?? v.exchangeWindowDays),
    variant: v,
  }
}

/** All options a customer can choose, main first. */
export function getPurchaseOptions(product) {
  const out = []
  const main = getMainOption(product)
  if (main) out.push(main)
  if (product?.hasVariants) for (const v of listVariants(product)) out.push(getVariantOption(product, v))
  return out
}

export const isAvailable = (option) => !!option && (option.stock === null || option.stock > 0)

/** What the page should select first: the main option if it can be bought, else the first variant in stock. */
export function defaultOption(product) {
  const options = getPurchaseOptions(product)
  return options.find(isAvailable) || options[0] || null
}

export const optionForVariantId = (product, variantId) =>
  getPurchaseOptions(product).find((o) => o.variantId === String(variantId || "")) || null

/** Cart line id: the plain product id for the main option, `${productId}_${variantId}` for a variant (variant ids start "var_"). */
export const cartCompoundId = (product, option) =>
  option?.variantId ? `${product.id}_${option.variantId}` : String(product.id)

/**
 * The object handed to addCart()/upsertCartItem() — identical in shape to what the page always built, now in one place.
 * Main option: the product itself. Variant: the product overlaid with the variant's own id / name / price / stock / image.
 */
export function buildCartPayload(product, option) {
  if (!option || !option.variantId) return product
  const img = option.image || product.thumbnail || product.image
  return {
    ...product,
    variant_id: option.variantId,
    variant_name: option.name,
    selected_variant: option.variant,
    price: option.price,
    stock: option.stock ?? 999999,
    image: img,
    thumbnail: img,
  }
}

/** Shopper-facing text for one policy side: "7-day returns" / "Not returnable". */
export const policyLine = (kind, policy) => {
  const noun = kind === "return" ? "return" : "exchange"
  if (!policy || !policy.enabled || !policy.days) return noun === "return" ? "Not returnable" : "No exchange"
  return `${policy.days}-day ${noun}${noun === "exchange" ? "" : "s"}`
}

/** One line for the product page: "7-day returns · 5-day exchange" (or the negative forms). */
export const policySummary = (option) =>
  option ? `${policyLine("return", option.returnPolicy)} · ${policyLine("exchange", option.exchangePolicy)}` : ""

export const formatINR = (n) => `₹${num(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

/**
 * How a LIST card should present the price without misleading anyone:
 *   single                      -> "₹500"
 *   variants + main on sale     -> "₹500" and "+ 3 more options · ₹200 – ₹350"
 *   variants, main NOT sold     -> "From ₹200" and "3 options · ₹200 – ₹350"
 * Never a bare minimum price.
 */
export function listPriceSummary(product) {
  const variants = listVariants(product).filter((v) => product?.hasVariants && num(v.price) > 0)
  const main = getMainOption(product)
  if (!product?.hasVariants || variants.length === 0) return { price: num(product?.price), prefix: "", note: "" }
  const prices = variants.map((v) => num(v.price))
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const range = lo === hi ? formatINR(lo) : `${formatINR(lo)} – ${formatINR(hi)}`
  if (main) {
    const n = variants.length
    return { price: num(product.price), prefix: "", note: `+ ${n} more option${n > 1 ? "s" : ""} · ${range}` }
  }
  return { price: lo, prefix: "From", note: `${variants.length} option${variants.length > 1 ? "s" : ""} · ${range}` }
}

/** Is anything on this product purchasable right now? (list cards: "Out of stock" badge) */
export const hasAvailableOption = (product) => getPurchaseOptions(product).some(isAvailable)

/**
 * True when a LIST card cannot simply "add the product": the shopper has to choose (more than one option) or the only
 * thing on sale is a variant. The card then shows "Choose options" and opens the product page instead of adding the
 * MAIN product by accident.
 */
export const needsOptionChoice = (product) => {
  const options = getPurchaseOptions(product)
  return options.length > 1 || (options.length === 1 && options[0].kind === "variant")
}

/**
 * Availability for a LIST card. The card must not say "Out of stock" because the MAIN counter is 0 while a variant is in
 * stock, and must not present the main product's stock as the stock of the whole product.
 *   out    true only when NO option can be bought
 *   units  purchasable units across the available options (null = some available option is untracked, i.e. unlimited)
 *   multi  more than one option exists -> show a generic "In stock", not a number
 */
export function listStockSummary(product) {
  const options = getPurchaseOptions(product)
  const available = options.filter(isAvailable)
  const multi = options.length > 1
  if (available.length === 0) return { out: true, units: 0, multi }
  if (available.some((o) => o.stock === null)) return { out: false, units: null, multi }
  return { out: false, units: available.reduce((sum, o) => sum + o.stock, 0), multi }
}