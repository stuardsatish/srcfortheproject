// Most-recent-first list of product ids the user has opened a PDP for.
// Local-only (localStorage), capped so it can't grow unbounded.
const STORAGE_KEY = "recentlyViewedProductIds"
const MAX_ENTRIES = 20

export const getRecentlyViewedIds = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const ids = raw ? JSON.parse(raw) : []
        return Array.isArray(ids) ? ids : []
    } catch (err) {
        console.log("getRecentlyViewedIds error:", err)
        return []
    }
}

export const addRecentlyViewed = (productId) => {
    if (!productId) return
    const id = String(productId)
    try {
        const existing = getRecentlyViewedIds()
        const deduped = [id, ...existing.filter((existingId) => existingId !== id)].slice(
            0,
            MAX_ENTRIES
        )
        localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped))
    } catch (err) {
        console.log("addRecentlyViewed error:", err)
    }
}