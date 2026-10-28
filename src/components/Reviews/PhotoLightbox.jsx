import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

/**
 * Full-screen viewer for a review's photos. Closes on backdrop click or Escape;
 * ←/→ (and the arrow buttons) move between photos when there are several.
 * Portalled to <body> so GSAP transforms on page ancestors can't offset `fixed`.
 */
export default function PhotoLightbox({ urls, index, onIndexChange, onClose }) {
    const closeRef = useRef(null)
    const count = urls.length

    useEffect(() => {
        const step = (delta) => onIndexChange((index + delta + count) % count)
        const onKey = (e) => {
            if (e.key === "Escape") onClose()
            else if (count > 1 && e.key === "ArrowLeft") step(-1)
            else if (count > 1 && e.key === "ArrowRight") step(1)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [index, count, onIndexChange, onClose])

    useEffect(() => {
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        closeRef.current?.focus()
        return () => { document.body.style.overflow = prev }
    }, [])

    const navStyle = (side) => ({
        position: "absolute",
        top: "50%",
        [side]: "16px",
        transform: "translateY(-50%)",
        width: "44px",
        height: "44px",
        borderRadius: "9999px",
        background: "color-mix(in srgb, var(--color-surface) 90%, transparent)",
        color: "var(--color-ink)",
    })

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Review photos"
            onClick={onClose}
            className="flex items-center justify-center"
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.85)" }}
        >
            <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close photo viewer"
                className="flex items-center justify-center"
                style={{ position: "absolute", top: "16px", right: "16px", width: "44px", height: "44px", borderRadius: "9999px", background: "color-mix(in srgb, var(--color-surface) 90%, transparent)", color: "var(--color-ink)" }}
            >
                <X size={20} />
            </button>

            {count > 1 && (
                <button type="button" aria-label="Previous photo" className="flex items-center justify-center" style={navStyle("left")} onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + count) % count) }}>
                    <ChevronLeft size={22} />
                </button>
            )}

            <img
                src={urls[index]}
                alt={`Review photo ${index + 1} of ${count}`}
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: "92vw", maxHeight: "84vh", objectFit: "contain", borderRadius: "8px", background: "var(--color-surface-muted)" }}
            />

            {count > 1 && (
                <>
                    <button type="button" aria-label="Next photo" className="flex items-center justify-center" style={navStyle("right")} onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % count) }}>
                        <ChevronRight size={22} />
                    </button>
                    <span style={{ position: "absolute", bottom: "20px", left: "50%", transform: "translateX(-50%)", fontSize: "13px", fontWeight: 600, color: "#fff" }}>
                        {index + 1} / {count}
                    </span>
                </>
            )}
        </div>,
        document.body
    )
}