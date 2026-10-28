// Most-recent-first list of search terms the user has actually submitted.
// Local-only (localStorage), capped, same shape as `recentlyViewed.js` —
// dedup-and-move-to-front so re-running an old search promotes it rather than
// duplicating it.
//
// Deliberately records only SUBMITTED terms (enter key, or picking a
// suggestion), never raw keystrokes: storing every prefix would fill the list
// with "c", "ca", "cat" and bury anything useful.
//
// Mirrors the mobile app's `src/utils/searchHistory.js` (AsyncStorage there,
// localStorage here) — same key name, cap and semantics, so the two behave
// identically.
const STORAGE_KEY = "recentSearchTerms"
const MAX_ENTRIES = 8
const MIN_LENGTH = 2

export const getRecentSearches = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const terms = raw ? JSON.parse(raw) : []
        return Array.isArray(terms) ? terms : []
    } catch (err) {
        console.log("getRecentSearches error:", err)
        return []
    }
}

export const addRecentSearch = (term) => {
    const cleaned = String(term || "").trim()
    if (cleaned.length < MIN_LENGTH) return
    try {
        const existing = getRecentSearches()
        // Case-insensitive dedup, but the newly typed casing is what's kept —
        // matching how the user last wrote it.
        const deduped = [
            cleaned,
            ...existing.filter((t) => t.toLowerCase() !== cleaned.toLowerCase()),
        ].slice(0, MAX_ENTRIES)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped))
    } catch (err) {
        console.log("addRecentSearch error:", err)
    }
}

export const removeRecentSearch = (term) => {
    try {
        const next = getRecentSearches().filter(
            (t) => t.toLowerCase() !== String(term).toLowerCase()
        )
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (err) {
        console.log("removeRecentSearch error:", err)
    }
}

export const clearRecentSearches = () => {
    try {
        localStorage.removeItem(STORAGE_KEY)
    } catch (err) {
        console.log("clearRecentSearches error:", err)
    }
}