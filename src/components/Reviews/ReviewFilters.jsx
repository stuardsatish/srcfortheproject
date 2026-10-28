import { Camera, Star } from "lucide-react"

/**
 * Filter chips (All · 5★ … 1★ · With photos) for the review list. Every star
 * level is shown with its count; levels with no reviews are disabled rather
 * than hidden so the row keeps a stable shape. `rv` is the useReviewList result.
 */
export default function ReviewFilters({ rv, compact = false }) {
    const total = Object.values(rv.counts).reduce((a, b) => a + b, 0)

    const chip = (active, disabled) => ({
        gap: "5px",
        height: compact ? "30px" : "34px",
        padding: compact ? "0 11px" : "0 14px",
        borderRadius: "9999px",
        fontSize: compact ? "12px" : "13px",
        fontWeight: 600,
        border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border-strong)"}`,
        background: active ? "var(--color-primary)" : "var(--color-surface)",
        color: active ? "var(--color-inverse)" : "var(--color-ink)",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
    })

    return (
        <div role="group" aria-label="Filter reviews" className="flex flex-wrap items-center" style={{ gap: compact ? "6px" : "8px" }}>
            <button
                type="button"
                onClick={rv.clearFilters}
                aria-pressed={!rv.hasActiveFilters}
                className="flex items-center"
                style={chip(!rv.hasActiveFilters, false)}
            >
                All ({total})
            </button>
            {[5, 4, 3, 2, 1].map((star) => {
                const count = rv.counts[star] || 0
                const disabled = count === 0
                return (
                    <button
                        key={star}
                        type="button"
                        onClick={() => rv.setRating(rv.rating === star ? 0 : star)}
                        disabled={disabled}
                        aria-pressed={rv.rating === star}
                        aria-label={`${star} star reviews (${count})`}
                        className="flex items-center"
                        style={chip(rv.rating === star, disabled)}
                    >
                        {star}
                        <Star size={compact ? 11 : 12} fill="currentColor" strokeWidth={0} />
                        ({count})
                    </button>
                )
            })}
            <button
                type="button"
                onClick={() => rv.setWithPhotos(!rv.withPhotos)}
                disabled={rv.withPhotosCount === 0}
                aria-pressed={rv.withPhotos}
                className="flex items-center"
                style={chip(rv.withPhotos, rv.withPhotosCount === 0)}
            >
                <Camera size={compact ? 12 : 13} />
                With photos ({rv.withPhotosCount})
            </button>
        </div>
    )
}

/** Sort dropdown; "Most helpful" only appears when vote data exists. */
export function ReviewSortSelect({ rv, style }) {
    return (
        <select
            value={rv.sort}
            onChange={(e) => rv.setSort(e.target.value)}
            aria-label="Sort reviews"
            style={style}
        >
            <option value="recent">Most Recent</option>
            <option value="highest">Highest Rated</option>
            <option value="lowest">Lowest Rated</option>
            {rv.votes && <option value="helpful">Most Helpful</option>}
        </select>
    )
}

/** Shown when the active filters match no review. */
export function ReviewFilterEmpty({ onClear, compact = false }) {
    return (
        <div
            className="flex flex-col items-center justify-center text-center"
            style={{ background: "var(--color-surface-muted)", borderRadius: compact ? "12px" : "16px", padding: compact ? "28px 16px" : "48px 24px", border: "1px dashed var(--color-border-strong)", gap: "8px" }}
        >
            <p style={{ fontWeight: 600, fontSize: compact ? "15px" : "18px", color: "var(--color-ink)" }}>No reviews match these filters</p>
            <button
                type="button"
                onClick={onClear}
                style={{ marginTop: "4px", height: "36px", padding: "0 18px", borderRadius: "9999px", border: "1px solid var(--color-ink)", fontWeight: 700, fontSize: "13px", color: "var(--color-ink)" }}
            >
                Clear filters
            </button>
        </div>
    )
}