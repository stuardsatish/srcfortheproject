// Words for the static policy pages (web RefundPolicyPage, RN support/returns). Pure (no React, no Supabase) so it is unit-tested:
//   src/features/products/__tests__/policyCopy.test.mjs     (npm run test:unit)
// The React Native app carries an identical copy (src/utils/policyCopy.js) with the same tests — the two apps share no package
// (MIGRATION_ANALYSIS §12). THE NUMBERS COME FROM THE STORE, NOT FROM THE CODE: the page used to say "7 days" in the source;
// now it reads settings.returnPolicyDefaults (Admin > Optimization), and every product page shows its own window.

/** What the store falls back to when the settings row is missing (the same 7 / 7 that migration 20261014_01 seeds). */
export const DEFAULT_RETURN_POLICY = Object.freeze({
  returnEnabled: true, returnWindowDays: 7, exchangeEnabled: true, exchangeWindowDays: 7, noReturnCategories: [], noExchangeCategories: [],
})

const asDays = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null }
const asList = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [])

/** The stored settings document -> a clean object (defaults for anything missing or malformed). */
export function normalizeReturnPolicyDefaults(data) {
  const d = data && typeof data === "object" ? data : {}
  const returnEnabled = d.returnEnabled !== false
  const exchangeEnabled = d.exchangeEnabled !== false
  return {
    returnEnabled,
    returnWindowDays: returnEnabled ? (asDays(d.returnWindowDays) ?? DEFAULT_RETURN_POLICY.returnWindowDays) : null,
    exchangeEnabled,
    exchangeWindowDays: exchangeEnabled ? (asDays(d.exchangeWindowDays) ?? DEFAULT_RETURN_POLICY.exchangeWindowDays) : null,
    noReturnCategories: asList(d.noReturnCategories),
    noExchangeCategories: asList(d.noExchangeCategories),
  }
}

const joinList = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`)
const days = (n) => `${n} day${n === 1 ? "" : "s"}`

/**
 * The paragraphs of the "Returns" and "Exchanges" sections, from the store defaults (normalised here, so callers may pass the
 * raw settings document). Nothing here promises more than the product pages and the server enforce.
 */
export function returnPolicyCopy(defaults) {
  const d = normalizeReturnPolicyDefaults(defaults)

  const returns = [
    "Each product has its own return and exchange policy, shown on its product page — for example “7-day returns · 5-day exchange”, or “Not returnable”. The days are counted from the delivery date recorded for your order.",
    d.returnEnabled
      ? `If something arrives damaged, incorrect, or not as described, contact us within ${days(d.returnWindowDays)} of delivery with your order number and we'll arrange a replacement or refund. Items should be unused and in their original packaging where possible.`
      : "If something arrives damaged, incorrect, or not as described, contact us as soon as possible after delivery with your order number and we'll arrange a replacement or refund. Items should be unused and in their original packaging where possible.",
  ]
  if (d.noReturnCategories.length) {
    returns.push(`Products in ${d.noReturnCategories.length === 1 ? "this category" : "these categories"} are not returnable unless they arrive damaged, defective or different from what you ordered: ${joinList(d.noReturnCategories)}.`)
  }

  const exchanges = [
    d.exchangeEnabled
      ? "Where a product offers exchanges, you can ask for a replacement — for example another size, colour or variant — within the exchange window shown on its product page. We confirm that the replacement is in stock before approving an exchange."
      : "Exchanges are not offered unless a product page says so. Where a product offers them, its page shows the exchange window.",
  ]
  if (d.noExchangeCategories.length) {
    exchanges.push(`Products in ${d.noExchangeCategories.length === 1 ? "this category" : "these categories"} cannot be exchanged: ${joinList(d.noExchangeCategories)}.`)
  }

  return { returns, exchanges }
}