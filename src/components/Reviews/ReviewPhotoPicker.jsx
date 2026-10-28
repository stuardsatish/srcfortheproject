import { useEffect, useRef, useState } from "react"
import { ImagePlus, X } from "lucide-react"
import { toast } from "react-toastify"
import { MAX_REVIEW_PHOTOS, reviewPhotoUrl, reviewPhotosAvailable, validateReviewPhoto } from "../../utils/reviewsPlus"

/**
 * Optional "Add photos (up to 4)" picker for the review modals.
 *
 * Owns the selection (and the blob preview URLs) itself and reports it upward as
 * `{ kept, files }` — `kept` are storage paths already on the review (edit flow),
 * `files` the newly chosen File objects. Render it only while the modal is open:
 * unmounting revokes every preview URL and resets the selection.
 *
 * Renders nothing when the photos backend isn't live yet.
 */
export default function ReviewPhotoPicker({ initialPhotos = [], onChange, disabled = false }) {
    const [available, setAvailable] = useState(false)
    const [kept, setKept] = useState(initialPhotos)
    const [added, setAdded] = useState([]) // [{ id, file, url }]
    const inputRef = useRef(null)
    const idRef = useRef(0)
    // Preview URLs are created in the change handler (not during render), so every
    // one is tracked here and revoked on unmount even if the user never removed it.
    const urlsRef = useRef(new Set())

    useEffect(() => {
        let active = true
        reviewPhotosAvailable().then((ok) => { if (active) setAvailable(ok) })
        return () => { active = false }
    }, [])

    useEffect(() => {
        const urls = urlsRef.current
        return () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear() }
    }, [])

    const total = kept.length + added.length
    const room = MAX_REVIEW_PHOTOS - total
    const emit = (nextKept, nextAdded) => onChange?.({ kept: nextKept, files: nextAdded.map((a) => a.file) })

    const handlePick = (e) => {
        const picked = Array.from(e.target.files || [])
        if (inputRef.current) inputRef.current.value = "" // lets the same file be chosen again after removing it
        if (picked.length === 0) return

        const accepted = []
        for (const file of picked) {
            if (accepted.length >= room) {
                toast.info(`You can add up to ${MAX_REVIEW_PHOTOS} photos.`)
                break
            }
            const check = validateReviewPhoto(file)
            if (!check.ok) {
                toast.error(`${file.name}: ${check.error}`)
                continue
            }
            const url = URL.createObjectURL(file)
            urlsRef.current.add(url)
            idRef.current += 1
            accepted.push({ id: idRef.current, file, url })
        }
        if (accepted.length === 0) return
        const next = [...added, ...accepted]
        setAdded(next)
        emit(kept, next)
    }

    const removeAdded = (item) => {
        URL.revokeObjectURL(item.url)
        urlsRef.current.delete(item.url)
        const next = added.filter((a) => a.id !== item.id)
        setAdded(next)
        emit(kept, next)
    }

    const removeKept = (path) => {
        const next = kept.filter((p) => p !== path)
        setKept(next)
        emit(next, added)
    }

    if (!available) return null

    return (
        <div style={{ marginTop: "16px" }}>
            <div className="flex items-center justify-between" style={{ gap: "8px" }}>
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={disabled || room <= 0}
                    className="flex items-center"
                    style={{ gap: "6px", fontSize: "13px", fontWeight: 700, color: room > 0 ? "var(--color-primary)" : "var(--color-muted)", cursor: room > 0 && !disabled ? "pointer" : "not-allowed" }}
                >
                    <ImagePlus size={16} />
                    {room > 0 ? `Add photos (up to ${MAX_REVIEW_PHOTOS})` : "Photo limit reached"}
                </button>
                <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>{total}/{MAX_REVIEW_PHOTOS} · optional</span>
            </div>
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={handlePick}
            />
            {total > 0 && (
                <div className="flex flex-wrap" style={{ gap: "12px", marginTop: "12px", paddingTop: "4px" }}>
                    {kept.map((path, i) => (
                        <Thumb key={path} src={reviewPhotoUrl(path)} label={`Photo ${i + 1}`} disabled={disabled} onRemove={() => removeKept(path)} />
                    ))}
                    {added.map((a, i) => (
                        <Thumb key={`new-${a.id}`} src={a.url} label={`Photo ${kept.length + i + 1}`} disabled={disabled} onRemove={() => removeAdded(a)} />
                    ))}
                </div>
            )}
        </div>
    )
}

function Thumb({ src, label, disabled, onRemove }) {
    return (
        <div className="relative flex-shrink-0" style={{ width: "64px", height: "64px" }}>
            <img src={src} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-surface-muted)" }} />
            <button
                type="button"
                onClick={onRemove}
                disabled={disabled}
                aria-label={`Remove ${label.toLowerCase()}`}
                className="absolute flex items-center justify-center"
                style={{ top: "-6px", right: "-6px", width: "20px", height: "20px", borderRadius: "9999px", background: "var(--color-ink)", color: "var(--color-inverse)", border: "2px solid var(--color-surface)" }}
            >
                <X size={11} />
            </button>
        </div>
    )
}