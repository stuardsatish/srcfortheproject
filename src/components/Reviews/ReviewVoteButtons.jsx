import { ThumbsDown, ThumbsUp } from "lucide-react"

/**
 * "Helpful (n)" / "Not helpful" pair. Clicking the vote you already cast clears it.
 * `own` keeps the buttons visible but inert-looking: the server refuses votes on
 * your own review, so we answer with the same message instead of a round trip.
 */
export default function ReviewVoteButtons({ summary, own = false, pending = false, onVote, compact = false }) {
    const { helpfulCount, myVote } = summary

    const btn = (active) => ({
        gap: "6px",
        height: compact ? "30px" : "34px",
        padding: compact ? "0 10px" : "0 14px",
        borderRadius: "9999px",
        fontSize: compact ? "12px" : "13px",
        fontWeight: 600,
        border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border-strong)"}`,
        background: active ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : "transparent",
        color: active ? "var(--color-primary)" : "var(--color-body)",
        opacity: own || pending ? 0.55 : 1,
        cursor: own ? "not-allowed" : pending ? "progress" : "pointer",
    })

    const ownTitle = own ? "You cannot vote on your own review" : undefined

    return (
        <div className="flex items-center flex-wrap" style={{ gap: "8px" }}>
            <button
                type="button"
                onClick={() => onVote(myVote === 1 ? 0 : 1)}
                aria-pressed={myVote === 1}
                aria-disabled={own || pending}
                title={ownTitle}
                className="flex items-center"
                style={btn(myVote === 1)}
            >
                <ThumbsUp size={compact ? 13 : 14} fill={myVote === 1 ? "currentColor" : "none"} />
                Helpful ({helpfulCount})
            </button>
            <button
                type="button"
                onClick={() => onVote(myVote === -1 ? 0 : -1)}
                aria-pressed={myVote === -1}
                aria-disabled={own || pending}
                title={ownTitle}
                className="flex items-center"
                style={btn(myVote === -1)}
            >
                <ThumbsDown size={compact ? 13 : 14} fill={myVote === -1 ? "currentColor" : "none"} />
                Not helpful
            </button>
        </div>
    )
}