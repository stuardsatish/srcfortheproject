/**
 * The single place this app decides how money is rendered.
 *
 * Introduced because the `$`/`₹` symbol had drifted apart across four
 * customer-facing surfaces — product cards, the wishlist, order totals, and
 * the cart's mobile total bar all printed dollars while the product detail
 * page, cart summary, policy pages and the entire React Native app printed
 * rupees. The store is unambiguously INR (shipping settings are ₹50/₹40;
 * invoice settings carry a GSTIN and an Indian phone number), so the dollar
 * sites were simply wrong.
 *
 * Import this rather than writing the symbol inline, so it cannot drift again.
 */
export const formatCurrency = (n) => `₹${Number(n || 0).toFixed(2)}`

/**
 * Shared discount helpers.
 *
 * `isDiscountActive` is lifted verbatim (behaviour-for-behaviour) from the copy
 * inlined in `CartPage.jsx`, which is the most defensive of the several copies
 * in this codebase — it tolerates the three `discount_expiry` shapes the data
 * has actually been seen in: an ISO string, a Firestore-style `{ toDate() }`
 * object left over from the pre-Supabase schema, and a raw epoch number. It
 * also retries a `DD/MM/YYYY hh:mm AM` string that `new Date()` rejects.
 *
 * NOTE: CartPage.jsx, ProductDetail.jsx and the mobile app's
 * `utils/pricing.js` each still carry their own copy. New code should import
 * from here; consolidating the existing call sites is a separate change,
 * deliberately not bundled into the roadmap task that introduced this file
 * (2.3), since CartPage's copy feeds live money calculations.
 */
export const isDiscountActive = (item) => {
    if (!item) return false
    const disc = Number(item.discount || 0)
    if (disc <= 0) return false
    if (item.discountExpiry) {
        const val = item.discountExpiry
        let expiry = NaN
        if (typeof val === "string") {
            expiry = new Date(val).getTime()
            if (isNaN(expiry)) {
                const cleanStr = val.replace(
                    /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s+(AM|PM)/i,
                    "$1 $2 $3"
                )
                expiry = new Date(cleanStr).getTime()
            }
        } else if (val?.toDate) {
            expiry = val.toDate().getTime()
        } else if (typeof val === "number") {
            expiry = val
        }
        if (!isNaN(expiry) && Date.now() > expiry) {
            return false
        }
    }
    return true
}

/** Effective per-unit price after any active percentage discount. */
export const effectivePrice = (item) => {
    const price = Number(item?.price || 0)
    const discount = isDiscountActive(item) ? Number(item.discount || 0) : 0
    return price - (price * discount) / 100
}

/** The active discount percentage, or 0 when there isn't one. */
export const activeDiscountPercent = (item) =>
    isDiscountActive(item) ? Number(item?.discount || 0) : 0