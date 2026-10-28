// Pure helpers behind the admin Add / Edit product forms (no React, no Supabase) so they are unit-testable
// (src/features/products/admin/__tests__/productForm.test.mjs — run with `npm run test:unit`).
//
// The forms keep their own UI state; these functions turn that state into the payload of the
// `save_product` RPC (migration 20261014_02) and mirror its validation, so the admin gets a clear message
// BEFORE a round-trip. The server validates again — the UI is never the only layer.

/** Store-wide defaults, overridden by settings.returnPolicyDefaults. */
export const POLICY_DEFAULTS = Object.freeze({ returnEnabled: true, returnDays: "7", exchangeEnabled: true, exchangeDays: "7" })

export const policyFromSettings = (data) => ({
  returnEnabled: data?.returnEnabled !== false,
  returnDays: String(data?.returnWindowDays ?? POLICY_DEFAULTS.returnDays),
  exchangeEnabled: data?.exchangeEnabled !== false,
  exchangeDays: String(data?.exchangeWindowDays ?? POLICY_DEFAULTS.exchangeDays),
})

// ── Store-wide defaults editor (Admin ▸ Optimization) ────────────────────────────────────────────────────────────────
// settings.returnPolicyDefaults = { returnEnabled, returnWindowDays, exchangeEnabled, exchangeWindowDays,
//                                   noReturnCategories: [..], noExchangeCategories: [..] }
// The database validates the same rules (migration 20261017_01, trigger settings_guard_return_policy_defaults).

const cleanCategoryList = (list) => {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const c = String(raw ?? "").trim()
    if (c && c.length <= 100 && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c) }
  }
  return out
}

/** The category lists of a stored settings document (tolerates a missing / malformed value). */
export const categoryListsFromSettings = (data) => ({
  noReturnCategories: cleanCategoryList(data?.noReturnCategories),
  noExchangeCategories: cleanCategoryList(data?.noExchangeCategories),
})

/** form policy state (+ category lists) -> the document stored in settings.returnPolicyDefaults. */
export const policyToSettings = (policy, lists = {}) => ({
  returnEnabled: !!policy.returnEnabled,
  returnWindowDays: policy.returnEnabled ? Number(policy.returnDays) : null,
  exchangeEnabled: !!policy.exchangeEnabled,
  exchangeWindowDays: policy.exchangeEnabled ? Number(policy.exchangeDays) : null,
  noReturnCategories: cleanCategoryList(lists.noReturnCategories),
  noExchangeCategories: cleanCategoryList(lists.noExchangeCategories),
})

/**
 * The policy a NEW product in `category` starts with: the store defaults, with returns / exchanges switched OFF when the store
 * listed that category (Q-1: e.g. perishables, customised items). Case-insensitive. Pure pre-fill — the admin can still change it.
 */
export function policyForCategory(storePolicy, lists, category) {
  const c = String(category || "").trim().toLowerCase()
  const listed = (arr) => !!c && (arr || []).some((x) => String(x).trim().toLowerCase() === c)
  return {
    ...storePolicy,
    returnEnabled: listed(lists?.noReturnCategories) ? false : storePolicy.returnEnabled,
    exchangeEnabled: listed(lists?.noExchangeCategories) ? false : storePolicy.exchangeEnabled,
  }
}

/** products row -> form policy state (null columns fall back to the defaults). */
export const policyFromProduct = (p) => ({
  returnEnabled: p?.returnEnabled !== false,
  returnDays: p?.returnWindowDays != null ? String(p.returnWindowDays) : POLICY_DEFAULTS.returnDays,
  exchangeEnabled: p?.exchangeEnabled !== false,
  exchangeDays: p?.exchangeWindowDays != null ? String(p.exchangeWindowDays) : POLICY_DEFAULTS.exchangeDays,
})

/** product_variants row -> { policyMode, policy }. NULL columns = inherit from the product. */
export const policyFromVariant = (v) => {
  const custom = v?.returnEnabled != null || v?.exchangeEnabled != null
  return {
    policyMode: custom ? "custom" : "inherit",
    policy: {
      returnEnabled: v?.returnEnabled != null ? v.returnEnabled : true,
      returnDays: v?.returnWindowDays != null ? String(v.returnWindowDays) : POLICY_DEFAULTS.returnDays,
      exchangeEnabled: v?.exchangeEnabled != null ? v.exchangeEnabled : true,
      exchangeDays: v?.exchangeWindowDays != null ? String(v.exchangeWindowDays) : POLICY_DEFAULTS.exchangeDays,
    },
  }
}

const isPositiveInt = (s) => /^\d+$/.test(String(s ?? "").trim()) && Number(s) >= 1 && Number(s) <= 365

/** null when valid, else the message to show. `label` prefixes it ("Variant Pink: …"). */
export function policyError(policy, label = "") {
  const pre = label ? `${label}: ` : ""
  if (policy.returnEnabled && !isPositiveInt(policy.returnDays)) return `${pre}return window must be a whole number of days between 1 and 365`
  if (policy.exchangeEnabled && !isPositiveInt(policy.exchangeDays)) return `${pre}exchange window must be a whole number of days between 1 and 365`
  return null
}

/** "a, B ,a" -> ["a","b"]  (server also lower-cases / de-duplicates; this keeps the preview honest) */
export const parseTags = (text) => {
  const seen = new Set()
  const out = []
  for (const raw of String(text || "").split(",")) {
    const t = raw.trim().toLowerCase()
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

const intOrZero = (v) => Math.max(0, Math.floor(Number(v) || 0))

/** "Red / L" + attribute names [Color,Size] -> {Color:"Red",Size:"L"} (same rule as the SQL backfill). */
export function deriveVariantAttributes(name, attributes) {
  const names = (attributes || []).map((a) => a?.name).filter(Boolean)
  const parts = String(name || "").trim().split(/\s*\/\s*/)
  if (names.length === 0 || names.length !== parts.length) return {}
  return Object.fromEntries(names.map((n, i) => [n, parts[i]]))
}

/** A blank variant row for the form. `id` must follow the `var_…` convention (used for the image path). */
export const newVariantRow = (id, over = {}) => ({
  id, name: "", price: "", stock: "", sku: "", imageUrl: "", imageFile: null, imagePreview: "",
  status: "active", trackInventory: true, policyMode: "inherit", policy: { ...POLICY_DEFAULTS },
  stockLoaded: null,     // the stock the admin SAW (edit page) -> sent as stock_expected so sales are never overwritten
  ...over,
})

const cartesian = (arrs) => arrs.reduce((a, b) => a.flatMap((x) => b.map((y) => [...x, y])), [[]])

/**
 * Rows for the generated attribute combinations. Existing rows keep their id / price / stock, and rows that do NOT
 * match a generated combination are KEPT (they may carry stock, sales history or a custom price — the old code
 * dropped them silently; remove a variant explicitly with the bin icon instead).
 */
export function rebuildVariantRows(attributes, currentRows) {
  if (!attributes.length) return currentRows
  const combos = cartesian(attributes.map((a) => a.options))
  const stamp = Date.now()
  const generated = combos.map((combo, i) => {
    const name = combo.join(" / ")
    return currentRows.find((v) => v.name === name) || newVariantRow(`var_${stamp}_${i}`, { name })
  })
  const kept = currentRows.filter((r) => !generated.includes(r))
  return [...generated, ...kept]
}

/**
 * Validates the whole form. Returns the FIRST problem as a string, or null.
 *   state: { form, productType, variantRows, mainOptionEnabled, policy, hasPrimaryImage, requireImage }
 */
export function validateProduct({ form, productType, variantRows = [], mainOptionEnabled = true, policy = POLICY_DEFAULTS, hasPrimaryImage = true, requireImage = false }) {
  if (!String(form.title || "").trim() || !String(form.category || "").trim()) return "Title and Category are required"
  const isVariant = productType === "variant"
  const mainSellable = !isVariant || mainOptionEnabled

  if (mainSellable && !(Number(form.price) > 0)) {
    return isVariant ? "Enter a price for the main product (or turn off “Sell the main product as its own option”)" : "Price must be greater than zero"
  }
  const disc = form.discount === "" || form.discount == null ? 0 : Number(form.discount)
  if (!(disc >= 0 && disc <= 100)) return "Discount must be between 0 and 100"

  const pe = policyError(policy)
  if (pe) return `Product ${pe}`

  if (isVariant) {
    if (variantRows.length === 0) return "Add at least one variant before saving"
    const seenName = new Set()
    const seenSku = new Set()
    for (const v of variantRows) {
      const label = `Variant “${v.name || "unnamed"}”`
      if (!String(v.name || "").trim()) return "Every variant needs a name"
      if (!(Number(v.price) > 0)) return `${label} needs a price greater than zero`
      if (v.stock !== "" && v.stock != null && !(Number(v.stock) >= 0 && Number.isInteger(Number(v.stock)))) return `${label}: stock must be a whole number, 0 or more`
      const key = String(v.name).trim().toLowerCase()
      if (seenName.has(key)) return `Two variants are both called “${String(v.name).trim()}”`
      seenName.add(key)
      const sku = String(v.sku || "").trim().toLowerCase()
      if (sku) {
        if (seenSku.has(sku)) return `SKU “${v.sku}” is used by more than one variant`
        seenSku.add(sku)
      }
      if (v.policyMode === "custom") {
        const e = policyError(v.policy, label)
        if (e) return e
      }
    }
    const anyActive = variantRows.some((v) => v.status !== "inactive")
    if (!mainSellable && !anyActive) return "Nothing on this product can be bought: the main product is off and every variant is inactive"
  }
  if (requireImage && !hasPrimaryImage) return "Primary image is required"
  return null
}

/** One variant row -> the `p_variants[]` element. */
export function buildVariantPayload(row, { imageUrl, attributes } = {}) {
  const custom = row.policyMode === "custom"
  const out = {
    id: row.id,
    name: String(row.name).trim(),
    sku: String(row.sku || "").trim(),
    price: Number(row.price) || 0,
    stock: intOrZero(row.stock),
    track_inventory: row.trackInventory !== false,
    image: imageUrl ?? row.imageUrl ?? "",
    status: row.status === "inactive" ? "inactive" : "active",
    attributes: deriveVariantAttributes(row.name, attributes),
    // NULL = inherit the product's policy
    return_enabled: custom ? !!row.policy.returnEnabled : null,
    return_window_days: custom && row.policy.returnEnabled ? Number(row.policy.returnDays) : null,
    exchange_enabled: custom ? !!row.policy.exchangeEnabled : null,
    exchange_window_days: custom && row.policy.exchangeEnabled ? Number(row.policy.exchangeDays) : null,
  }
  if (row.stockLoaded != null) out.stock_expected = intOrZero(row.stockLoaded)
  return out
}

/**
 * The `p_product` object. Only keys the RPC whitelists. For an EDIT pass { id, stockLoaded } so the stock edit
 * becomes a delta against what the admin saw.
 */
export function buildProductPayload({
  id, form, status, productType, mainOptionEnabled = true, trackInventory = true, policy = POLICY_DEFAULTS,
  tagsText = "", thumbnail, gallery, attributes = [], stockLoaded = null, includeDiscount = false,
}) {
  const isVariant = productType === "variant"
  const p = {
    title: String(form.title).trim(),
    category: String(form.category).trim(),
    brand: String(form.brand || "").trim(),
    sku: String(form.sku || "").trim(),
    price: isVariant && !mainOptionEnabled && !(Number(form.price) > 0) ? 0 : Number(form.price) || 0,
    stock: intOrZero(form.stock),
    gst_rate: Number(form.gstRate) || 0,
    hsn_code: String(form.hsnCode || "").trim(),
    price_type: "inclusive",
    short_description: String(form.shortDescription || "").trim(),
    description: String(form.description || "").trim(),
    status,
    tags: parseTags(tagsText),
    track_inventory: !!trackInventory,
    main_option_enabled: isVariant ? !!mainOptionEnabled : true,
    return_enabled: !!policy.returnEnabled,
    return_window_days: policy.returnEnabled ? Number(policy.returnDays) : null,
    exchange_enabled: !!policy.exchangeEnabled,
    exchange_window_days: policy.exchangeEnabled ? Number(policy.exchangeDays) : null,
    attributes: isVariant ? attributes : [],
  }
  if (id) p.id = id
  if (thumbnail !== undefined) p.thumbnail = thumbnail
  if (gallery !== undefined) p.gallery = gallery
  if (stockLoaded != null) p.stock_expected = intOrZero(stockLoaded)
  if (includeDiscount) {
    p.discount = Number(form.discount) || 0
    p.discount_expiry = form.discountExpiry || null
  }
  return p
}

/** Friendly text for an RPC error (PostgREST puts the SQL message in `message`). */
export function explainSaveError(err) {
  const m = String(err?.message || err || "")
  if (/Could not find the function|function .*save_product.* does not exist|PGRST202/i.test(m + (err?.code || ""))) {
    return "The database is missing the save_product function — apply migrations 20261014_01 and 20261014_02 first."
  }
  if (err?.code === "40001" || /changed by someone else|changed while you were editing|Stock of variant/i.test(m)) {
    return m + " (nothing was saved)"
  }
  if (err?.code === "23505" || /already used by|must be unique/i.test(m)) return m
  return m || "Error saving product"
}