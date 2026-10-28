import { useEffect, useMemo, useState } from "react"
import { useSelector } from "react-redux"
import { toast } from "react-toastify"
import { fetchReviewVotes, voteOnReview } from "../../utils/reviewsPlus"
import { applyVote, filterAndSortReviews, photoReviewCount, ratingCounts } from "../../utils/reviewFilters"

const DEFAULTS = { rating: 0, withPhotos: false, sort: "recent" }

/**
 * Everything the product page's review list needs, shared by the mobile and the
 * desktop layout: filter/sort state, the filtered+sorted list, and helpful-vote
 * totals with optimistic voting.
 *
 * `votes` is `null` until loaded, and stays `null` when the votes backend isn't
 * live — the UI renders no vote buttons in that case.
 *
 * @param {string} productId
 * @param {Array<{id:string,userId:string,rating:number,createdAt:string,photos:string[]}>} reviews
 */
export default function useReviewList(productId, reviews) {
    const userId = useSelector((s) => s.user.user?.uid) ?? null

    // Filters are scoped to a product so navigating to another product resets them
    // without an effect.
    const [filterState, setFilterState] = useState({ productId, ...DEFAULTS })
    const filters = filterState.productId === productId ? filterState : { productId, ...DEFAULTS }
    const update = (patch) => setFilterState({ ...filters, ...patch, productId })

    const [voteState, setVoteState] = useState({ productId: null, map: null })
    const votes = voteState.productId === productId ? voteState.map : null
    const [pending, setPending] = useState({})

    const hasReviews = reviews.length > 0
    useEffect(() => {
        if (!hasReviews) return
        let active = true
        fetchReviewVotes(productId)
            .then((map) => { if (active) setVoteState({ productId, map }) })
            // Vote totals are a nicety; a failed load just leaves the buttons out.
            .catch((e) => console.warn("[reviews] vote totals unavailable:", e.message))
        return () => { active = false }
        // `userId`: re-read my_vote when the visitor signs in/out while on the page.
    }, [productId, hasReviews, userId])

    const counts = useMemo(() => ratingCounts(reviews), [reviews])
    const withPhotosCount = useMemo(() => photoReviewCount(reviews), [reviews])
    const filtered = useMemo(
        () => filterAndSortReviews(reviews, { rating: filters.rating, withPhotos: filters.withPhotos, sort: filters.sort, votes }),
        [reviews, filters.rating, filters.withPhotos, filters.sort, votes]
    )

    const setEntry = (reviewId, entry) =>
        setVoteState((s) => (s.productId === productId ? { ...s, map: { ...s.map, [reviewId]: entry } } : s))

    /** @param {1|-1|0} next */
    const castVote = async (review, next) => {
        if (!userId) { toast.info("Please sign in to vote"); return }
        if (review.userId === userId) { toast.info("You cannot vote on your own review"); return }
        if (pending[review.id] || !votes) return

        const before = votes[review.id]
        setEntry(review.id, applyVote(before, next)) // optimistic
        setPending((p) => ({ ...p, [review.id]: true }))
        try {
            setEntry(review.id, await voteOnReview(review.id, next)) // server totals win
        } catch (e) {
            setEntry(review.id, before || applyVote(null, 0)) // roll back
            toast.error(e.message || "Could not save your vote.")
        } finally {
            setPending((p) => ({ ...p, [review.id]: false }))
        }
    }

    return {
        ...filters,
        hasActiveFilters: filters.rating !== 0 || filters.withPhotos,
        setRating: (rating) => update({ rating }),
        setWithPhotos: (withPhotos) => update({ withPhotos }),
        setSort: (sort) => update({ sort }),
        clearFilters: () => update({ rating: 0, withPhotos: false }),
        counts,
        withPhotosCount,
        filtered,
        votes,
        pending,
        userId,
        castVote,
    }
}