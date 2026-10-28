import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowRight, Star, Tag } from "lucide-react"
import { supabase } from "../../context/SupabaseConfig"
import { mapProductRows } from "../../utils/supabaseProducts"
import { activeDiscountPercent, effectivePrice } from "../../utils/pricing"

/**
 * Landing-page merchandising (roadmap task 2.3): a category grid, a
 * bestseller shelf, and a deals section.
 *
 * Until now the landing page was brand storytelling only (Hero / Taste /
 * Quality / Parallax) with no route into the catalogue except the nav bar —
 * a visitor could read the whole page without ever seeing a product. These
 * three sections are all driven by real `products` rows, so they can't go
 * stale the way hardcoded marketing copy does:
 *
 *   - Category grid   — distinct categories with live counts.
 *   - Bestsellers     — ranked by review_count, then rating. Review count
 *                       leads deliberately: a lone 5★ review is not evidence
 *                       of a bestseller, whereas volume is. Falls back to
 *                       newest-first when nothing has been reviewed yet, so
 *                       the shelf is never empty on a fresh catalogue.
 *   - Deals           — only products whose discount is actually live, via the
 *                       shared `activeDiscountPercent` (expiry-aware). The
 *                       whole section hides itself when there are none, rather
 *                       than rendering an empty "Deals" heading.
 *
 * One query serves all three.
 */

const money = (n) => `₹${Number(n || 0).toFixed(2)}`
const toTitleCase = (s) =>
    String(s || "")
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")

const SectionHeading = ({ eyebrow, title, action }) => (
    <div className="flex items-end justify-between mb-8 gap-4">
        <div>
            {eyebrow && (
                <p
                    className="font-accent"
                    style={{ fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase", color: "#8B4513", fontWeight: 600 }}
                >
                    {eyebrow}
                </p>
            )}
            <h2 style={{ fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 700, color: "#2A1A0F", marginTop: "6px" }}>
                {title}
            </h2>
        </div>
        {action}
    </div>
)

const ViewAll = ({ to, label = "View all" }) => (
    <Link
        to={to}
        className="flex items-center gap-1.5 flex-shrink-0 hover:gap-2.5 transition-all"
        style={{ fontSize: "14px", fontWeight: 600, color: "#8B4513" }}
    >
        {label} <ArrowRight size={15} />
    </Link>
)

const ProductTile = ({ product, onOpen }) => {
    const discount = activeDiscountPercent(product)
    const final = effectivePrice(product)
    return (
        <button
            type="button"
            onClick={() => onOpen(product)}
            className="text-left group"
            style={{ background: "transparent" }}
        >
            <div
                className="relative overflow-hidden"
                style={{ borderRadius: "14px", background: "#F3EDE4", aspectRatio: "1 / 1" }}
            >
                {product.thumbnail ? (
                    <img
                        src={product.thumbnail}
                        alt={product.title}
                        loading="lazy"
                        className="w-full h-full group-hover:scale-105 transition-transform duration-500"
                        style={{ objectFit: "cover" }}
                    />
                ) : null}
                {discount > 0 && (
                    <span
                        className="absolute flex items-center gap-1"
                        style={{
                            top: "10px",
                            left: "10px",
                            background: "#8B4513",
                            color: "#FFF",
                            borderRadius: "9999px",
                            padding: "4px 9px",
                            fontSize: "11px",
                            fontWeight: 700,
                        }}
                    >
                        <Tag size={10} /> {discount}% OFF
                    </span>
                )}
            </div>
            <p
                className="truncate"
                style={{ marginTop: "10px", fontSize: "14px", fontWeight: 600, color: "#2A1A0F" }}
            >
                {product.title}
            </p>
            <div className="flex items-center gap-2" style={{ marginTop: "3px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#8B4513" }}>{money(final)}</span>
                {discount > 0 && (
                    <span style={{ fontSize: "12px", color: "#9A8C7D", textDecoration: "line-through" }}>
                        {money(product.price)}
                    </span>
                )}
            </div>
            {product.reviewCount > 0 && (
                <div className="flex items-center gap-1" style={{ marginTop: "3px" }}>
                    <Star size={11} fill="#E8A33D" color="#E8A33D" />
                    <span style={{ fontSize: "11px", color: "#6B5B4D" }}>
                        {Number(product.rating).toFixed(1)} ({product.reviewCount})
                    </span>
                </div>
            )}
        </button>
    )
}

const Merchandising = () => {
    const navigate = useNavigate()
    const [products, setProducts] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let active = true
        supabase
            .from("products")
            .select("*")
            .then(({ data, error }) => {
                if (!active) return
                if (error) {
                    console.log("Merchandising products fetch error:", error)
                    setProducts([])
                } else {
                    setProducts(mapProductRows(data || []))
                }
                setLoading(false)
            })
        return () => {
            active = false
        }
    }, [])

    const categories = useMemo(() => {
        const counts = new Map()
        products.forEach((p) => {
            if (!p.category) return
            counts.set(p.category, (counts.get(p.category) || 0) + 1)
        })
        return [...counts.entries()]
            .map(([name, count]) => ({
                name,
                count,
                // A representative image so the grid isn't just coloured tiles.
                image: products.find((p) => p.category === name && p.thumbnail)?.thumbnail || "",
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6)
    }, [products])

    const bestsellers = useMemo(() => {
        const reviewed = products.filter((p) => p.reviewCount > 0)
        const pool = reviewed.length
            ? [...reviewed].sort(
                (a, b) => b.reviewCount - a.reviewCount || b.rating - a.rating
            )
            : [...products].sort(
                (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
            )
        return pool.slice(0, 4)
    }, [products])

    const deals = useMemo(
        () =>
            [...products]
                .filter((p) => activeDiscountPercent(p) > 0)
                .sort((a, b) => activeDiscountPercent(b) - activeDiscountPercent(a))
                .slice(0, 4),
        [products]
    )

    const openProduct = (product) => navigate(`/product/${product.id}`)

    // Nothing to merchandise (empty catalogue or a failed fetch) — render
    // nothing rather than a page of empty headings.
    if (loading || !products.length) return null

    return (
        <section style={{ background: "#FAF7F2", padding: "clamp(60px, 9vw, 110px) 0" }}>
            <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 clamp(20px, 5vw, 48px)" }}>
                {/* ── CATEGORY GRID ───────────────────────────────────────── */}
                {categories.length > 0 && (
                    <div style={{ marginBottom: "clamp(56px, 8vw, 96px)" }}>
                        <SectionHeading
                            eyebrow="Browse"
                            title="Shop by category"
                            action={<ViewAll to="/products" label="All products" />}
                        />
                        <div
                            className="grid"
                            style={{
                                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                                gap: "clamp(12px, 2vw, 20px)",
                            }}
                        >
                            {categories.map((cat) => (
                                <Link
                                    key={cat.name}
                                    to="/products"
                                    className="group relative overflow-hidden"
                                    style={{ borderRadius: "14px", aspectRatio: "4 / 3", background: "#EFE7DC" }}
                                >
                                    {cat.image && (
                                        <img
                                            src={cat.image}
                                            alt=""
                                            loading="lazy"
                                            className="w-full h-full group-hover:scale-105 transition-transform duration-500"
                                            style={{ objectFit: "cover", opacity: 0.85 }}
                                        />
                                    )}
                                    <div
                                        className="absolute inset-0 flex flex-col justify-end"
                                        style={{
                                            padding: "12px",
                                            background: "linear-gradient(to top, rgba(42,26,15,0.78) 0%, rgba(42,26,15,0.1) 60%, transparent 100%)",
                                        }}
                                    >
                                        <span style={{ fontSize: "14px", fontWeight: 700, color: "#FFF" }}>
                                            {toTitleCase(cat.name)}
                                        </span>
                                        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.8)" }}>
                                            {cat.count} {cat.count === 1 ? "item" : "items"}
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── BESTSELLERS ─────────────────────────────────────────── */}
                {bestsellers.length > 0 && (
                    <div style={{ marginBottom: deals.length ? "clamp(56px, 8vw, 96px)" : 0 }}>
                        <SectionHeading
                            eyebrow="Loved by customers"
                            title="Bestsellers"
                            action={<ViewAll to="/products" />}
                        />
                        <div
                            className="grid"
                            style={{
                                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                                gap: "clamp(14px, 2.2vw, 24px)",
                            }}
                        >
                            {bestsellers.map((p) => (
                                <ProductTile key={p.id} product={p} onOpen={openProduct} />
                            ))}
                        </div>
                    </div>
                )}

                {/* ── DEALS ───────────────────────────────────────────────── */}
                {deals.length > 0 && (
                    <div>
                        <SectionHeading
                            eyebrow="Limited time"
                            title="Today's deals"
                            action={<ViewAll to="/products" />}
                        />
                        <div
                            className="grid"
                            style={{
                                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                                gap: "clamp(14px, 2.2vw, 24px)",
                            }}
                        >
                            {deals.map((p) => (
                                <ProductTile key={p.id} product={p} onOpen={openProduct} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    )
}

export default Merchandising