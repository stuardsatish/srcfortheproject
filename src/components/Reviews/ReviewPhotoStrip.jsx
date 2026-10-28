import { useState } from "react"
import { reviewPhotoUrl } from "../../utils/reviewsPlus"
import PhotoLightbox from "./PhotoLightbox"

/** Thumbnails of a review's photos; clicking one opens the lightbox on it. */
export default function ReviewPhotoStrip({ photos, size = 64 }) {
    const [openIndex, setOpenIndex] = useState(null)
    if (!photos?.length) return null
    const urls = photos.map(reviewPhotoUrl)

    return (
        <>
            <div className="flex flex-wrap" style={{ gap: "8px" }}>
                {urls.map((url, i) => (
                    <button
                        key={photos[i]}
                        type="button"
                        onClick={() => setOpenIndex(i)}
                        aria-label={`View photo ${i + 1} of ${urls.length}`}
                        className="flex-shrink-0"
                        style={{ width: `${size}px`, height: `${size}px`, borderRadius: "8px", overflow: "hidden", border: "1px solid var(--color-border)", background: "var(--color-surface-muted)" }}
                    >
                        <img src={url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </button>
                ))}
            </div>
            {openIndex !== null && (
                <PhotoLightbox urls={urls} index={openIndex} onIndexChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
            )}
        </>
    )
}