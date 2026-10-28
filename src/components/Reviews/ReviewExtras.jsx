import ReviewPhotoStrip from "./ReviewPhotoStrip"
import ReviewVoteButtons from "./ReviewVoteButtons"

const NO_VOTES = { helpfulCount: 0, unhelpfulCount: 0, myVote: 0 }

/**
 * The photo thumbnails + helpful/not-helpful buttons under a review's text.
 * Used by both PDP layouts; renders nothing for a review with neither. No vote
 * buttons at all while `rv.votes` is null (backend missing / not loaded).
 */
export default function ReviewExtras({ review, rv, compact = false }) {
  const hasPhotos = review.photos?.length > 0
  if (!hasPhotos && !rv.votes) return null

  return (
    <div className="flex flex-col" style={{ gap: compact ? "10px" : "14px", paddingTop: compact ? "4px" : "12px" }}>
      {hasPhotos && <ReviewPhotoStrip photos={review.photos} size={compact ? 60 : 80} />}
      {rv.votes && (
        <ReviewVoteButtons
          summary={rv.votes[review.id] || NO_VOTES}
          own={!!rv.userId && review.userId === rv.userId}
          pending={!!rv.pending[review.id]}
          onVote={(next) => rv.castVote(review, next)}
          compact={compact}
        />
      )}
    </div>
  )
}