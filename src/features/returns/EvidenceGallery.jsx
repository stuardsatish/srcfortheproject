import { useEffect, useState } from "react"
import { returnsService } from "../../services/returns"

/**
 * Thumbnails of the PRIVATE evidence photos of a request. The bucket is private: each photo is shown through a short-lived signed link
 * (created for the signed-in customer / admin only). `paths` = storage paths from the request's evidence rows.
 */
const EvidenceGallery = ({ paths, size = 72 }) => {
  const [urls, setUrls] = useState({})
  const [failed, setFailed] = useState(false)
  const key = (paths || []).join("|")

  useEffect(() => {
    let alive = true
    const list = key ? key.split("|") : []
    if (list.length === 0) return undefined
    returnsService.signedEvidenceUrls(list)
      .then((u) => { if (alive) { setUrls(u); setFailed(false) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [key])

  if (!key) return null
  if (failed) return <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "12px", color: "var(--color-muted)" }}>The photos could not be loaded right now.</p>
  return (
    <div className="flex flex-wrap" style={{ gap: "8px" }}>
      {key.split("|").map((p) => (
        urls[p]
          ? (
            <a key={p} href={urls[p]} target="_blank" rel="noopener noreferrer" aria-label="Open photo">
              <img src={urls[p]} alt="Evidence" style={{ width: `${size}px`, height: `${size}px`, objectFit: "cover", borderRadius: "8px", border: "1px solid var(--color-border)" }} />
            </a>
          )
          : <span key={p} className="animate-pulse" style={{ width: `${size}px`, height: `${size}px`, borderRadius: "8px", background: "var(--color-surface-muted)" }} />
      ))}
    </div>
  )
}

export default EvidenceGallery