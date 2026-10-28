import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

/**
 * Centered modal dialog: the overlay, Esc and the X button close it (unless `busy`, so an in-flight save cannot be dismissed).
 * Used by the shipping screens; keep it dumb - the caller renders the form and the footer buttons.
 */
const ModalShell = ({ open, onClose, title, subtitle, width = 560, busy = false, children, footer }) => {
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose?.() }
    window.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    boxRef.current?.focus()
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, busy, onClose])

  if (!open) return null

  // Rendered into <body>: the order / request drawers and the animated page cards keep a CSS transform after their entrance
  // animation, and a transformed ancestor becomes the containing block of `position: fixed` - in place, this window (and its
  // dimmed overlay) was boxed into the 480 px drawer instead of covering the screen.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div onClick={() => { if (!busy) onClose?.() }} style={{ position: "absolute", inset: 0, background: "var(--color-overlay)" }} />
      <div
        ref={boxRef}
        tabIndex={-1}
        style={{ position: "relative", width: `${width}px`, maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "var(--color-surface)", color: "var(--color-ink)", borderRadius: "16px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)", outline: "none" }}
      >
        <div className="flex items-start justify-between" style={{ gap: "12px", padding: "20px 24px 12px" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: "20px", letterSpacing: "-0.3px" }}>{title}</h2>
            {subtitle ? <p style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", color: "var(--color-body)", marginTop: "2px" }}>{subtitle}</p> : null}
          </div>
          <button type="button" onClick={() => { if (!busy) onClose?.() }} aria-label="Close" className="flex items-center justify-center flex-shrink-0" style={{ width: "36px", height: "36px", borderRadius: "9999px", background: "var(--color-surface-muted)", cursor: busy ? "not-allowed" : "pointer" }}>
            <X size={16} style={{ color: "var(--color-body)" }} />
          </button>
        </div>
        <div style={{ padding: "4px 24px 16px", overflowY: "auto" }}>{children}</div>
        {footer ? <div className="flex items-center justify-end flex-wrap" style={{ gap: "8px", padding: "12px 24px 20px", borderTop: "1px solid var(--color-border)" }}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export default ModalShell