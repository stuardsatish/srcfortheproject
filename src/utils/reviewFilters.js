// Pure helpers behind the product-page review list: histogram counts for the
// filter chips, filtering/sorting, and the optimistic helpful-vote arithmetic.
// No React / Supabase imports on purpose, so the logic can be run with plain `node`.

export const REVIEW_SORTS = ["recent", "highest", "lowest", "helpful"]

// Same bucketing as the rating histogram on the page (Math.round), so a chip's
// count always matches the bar next to it.
const bucketOf = (review) => Math.round(Number(review?.rating)) || 0

const timeOf = (review) => {
    const v = review?.createdAt
    const d = v?.toDate ? v.toDate() : new Date(v)
    const t = d.getTime()
    return Number.isNaN(t) ? 0 : t
}

const photosOf = (review) => (Array.isArray(review?.photos) ? review.photos : [])

/** @returns {{5:number,4:number,3:number,2:number,1:number}} */
export function ratingCounts(reviews) {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    for (const r of reviews || []) {
        const b = bucketOf(r)
        if (counts[b] !== undefined) counts[b]++
    }
    return counts
}

export function photoReviewCount(reviews) {
    return (reviews || []).filter((r) => photosOf(r).length > 0).length
}

/**
 * @param {Array<{id:string, rating:number, createdAt:string, photos?:string[]}>} reviews
 * @param {{ rating?:number, withPhotos?:boolean, sort?:"recent"|"highest"|"lowest"|"helpful",
 *           votes?:Record<string,{helpfulCount:number}>|null }} [opts]
 *   `rating: 0` means every star level. `helpful` orders by helpful votes, then
 *   recency; without vote data (backend missing / not loaded) it degrades to `recent`.
 * @returns a new array — the input is never mutated.
 */
export function filterAndSortReviews(reviews, { rating = 0, withPhotos = false, sort = "recent", votes = null } = {}) {
    const list = (reviews || []).filter((r) => {
        if (rating && bucketOf(r) !== rating) return false
        if (withPhotos && photosOf(r).length === 0) return false
        return true
    })

    const recent = (a, b) => timeOf(b) - timeOf(a)
    const helpful = (r) => votes?.[r.id]?.helpfulCount ?? 0

    // Array.prototype.sort is stable, so full ties keep their incoming order.
    list.sort((a, b) => {
        if (sort === "highest") return (Number(b.rating) || 0) - (Number(a.rating) || 0) || recent(a, b)
        if (sort === "lowest") return (Number(a.rating) || 0) - (Number(b.rating) || 0) || recent(a, b)
        if (sort === "helpful") return helpful(b) - helpful(a) || recent(a, b)
        return recent(a, b)
    })
    return list
}

/**
 * Counts after casting `next` (1 helpful, -1 not helpful, 0 clear) on top of the
 * caller's current vote. Used for the optimistic update; the server's answer
 * replaces it afterwards.
 */
export function applyVote(summary, next) {
    const cur = summary || { helpfulCount: 0, unhelpfulCount: 0, myVote: 0 }
    let helpfulCount = cur.helpfulCount || 0
    let unhelpfulCount = cur.unhelpfulCount || 0
    if (cur.myVote === 1) helpfulCount -= 1
    if (cur.myVote === -1) unhelpfulCount -= 1
    if (next === 1) helpfulCount += 1
    if (next === -1) unhelpfulCount += 1
    return { helpfulCount: Math.max(0, helpfulCount), unhelpfulCount: Math.max(0, unhelpfulCount), myVote: next }
}