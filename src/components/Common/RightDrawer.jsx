import { useRef, useState, useEffect, useLayoutEffect } from "react"
import gsap from "gsap"
import { X } from "lucide-react"

/**
 * Generic right-side slide-in drawer.
 * Extracted from the product detail drawer in AddProductPage so both the
 * Products Catalog and Detailed User Overview (order details) share one
 * implementation instead of duplicating the overlay/animation/close logic.
 */
const RightDrawer = ({ open, onClose, title, widthPx = 480, zIndex = 60, children }) => {
    const drawerRef = useRef(null)
    const [mounted, setMounted] = useState(open)
    // Keep the drawer mounted while the close animation plays. Derived during
    // render (React's recommended pattern) rather than in an effect, since
    // opening must mount synchronously before the slide-in animation runs.
    const [prevOpen, setPrevOpen] = useState(open)
    if (open !== prevOpen) {
        setPrevOpen(open)
        if (open) setMounted(true)
    }

    useLayoutEffect(() => {
        if (open && drawerRef.current) {
            gsap.set(drawerRef.current, { xPercent: 100 })
            gsap.to(drawerRef.current, { xPercent: 0, duration: 0.4, ease: "power3.out" })
        } else if (!open && mounted && drawerRef.current) {
            gsap.to(drawerRef.current, {
                xPercent: 100, duration: 0.3, ease: "power3.in",
                onComplete: () => setMounted(false),
            })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    useEffect(() => {
        if (!open) return
        const onKey = (e) => { if (e.key === "Escape") onClose?.() }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [open, onClose])

    if (!mounted) return null

    return (
        <>
            <div className="fixed inset-0" style={{ zIndex, background: "var(--color-overlay)" }} onClick={onClose} />
            <div
                ref={drawerRef}
                className="fixed top-0 right-0 bottom-0 overflow-y-auto"
                style={{ width: `${widthPx}px`, maxWidth: "100%", background: "var(--color-surface)", color: "var(--color-ink)", zIndex: zIndex + 1, boxShadow: "-10px 0 40px rgba(0,0,0,0.15)" }}
            >
                <div className="p-6 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h2 className="font-bold" style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontSize: "20px" }}>{title}</h2>
                        <button onClick={onClose} className="p-2 rounded-full" style={{ background: "var(--color-surface-muted)" }}>
                            <X size={18} />
                        </button>
                    </div>
                    {children}
                </div>
            </div>
        </>
    )
}

export default RightDrawer