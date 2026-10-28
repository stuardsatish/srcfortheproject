import React, { useEffect, useState, useRef, memo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { supabase } from "../../context/SupabaseConfig"
import { mapProductRow, mapProductRows } from "../../utils/supabaseProducts"
import { upsertCartItem, decrementOrRemoveCartItem, nextAddQuantity, nextRemoveQuantity } from "../../utils/supabaseCart"
import { addWishlistItem, removeWishlistItem } from "../../utils/supabaseWishlist"
import { FaHeart, FaRegHeart } from "react-icons/fa"
import { useDispatch, useSelector } from "react-redux"
import { toast } from "react-toastify"
import { addWishlist, removeWishlist } from "../../context/WishlistSlice"
import { addCart, removeCart } from "../../context/CartSlice"
import {
    ShoppingBag,
    ArrowLeft,
    ArrowRight,
    Minus,
    Plus,
    ShoppingCart,
    Star,
    ChevronDown,
    ChevronRight,
    ChevronLeft,
    Check,
    Shield,
    Heart,
    Truck,
    Share2,
    Bell,
    BellOff
} from "lucide-react"
import { Swiper, SwiperSlide } from "swiper/react"
import { Thumbs, Pagination, Navigation, EffectCreative } from "swiper/modules"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { ProductDetailSkeleton } from "../../features/products/ProductDetailSkeleton"
import useIsMobile from "../../hooks/useIsMobile"
import { addRecentlyViewed } from "../../utils/recentlyViewed"
import PolicyLinks from "../../components/Common/PolicyLinks"
import { getShippingSettings } from "../../services/settingsService"
import useReviewList from "../../components/Reviews/useReviewList"
import ReviewFilters, { ReviewFilterEmpty, ReviewSortSelect } from "../../components/Reviews/ReviewFilters"
import ReviewExtras from "../../components/Reviews/ReviewExtras"
import ProductQA from "../../components/Reviews/ProductQA"
import OptionPicker, { OptionMeta } from "../../features/products/OptionPicker"
import { buildCartPayload, defaultOption, optionForVariantId, policySummary } from "../../features/products/purchaseOptions"

// Import Swiper styles
import "swiper/css"
import "swiper/css/pagination"
import "swiper/css/navigation"
import "swiper/css/thumbs"
import "swiper/css/effect-creative"

/* ============================================================
   Helpers used by the mobile (≤lg) layout below.
   Pure functions — no effect on the desktop render.
============================================================ */
const getInitials = (name) => {
    if (!name) return "A"
    const parts = String(name).trim().split(/\s+/).filter(Boolean)
    if (!parts.length) return "A"
    return parts.map((p) => p[0]).join("").slice(0, 2).toUpperCase()
}
const toReviewDate = (v) => {
    if (!v) return null
    if (v?.toDate) return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

// Normalises whatever shape `specs` has (object | array of
// objects | array of strings) into [{ label, value }] rows. Returns [] when absent.
const normalizeSpecs = (specs) => {
    if (!specs) return []
    if (Array.isArray(specs)) {
        return specs.map((s) => {
            if (s && typeof s === "object") {
                const label = s.label ?? s.key ?? s.name ?? s.title ?? null
                const rawVal = s.value ?? s.val ?? s.detail ?? null
                return { label, value: rawVal != null ? String(rawVal) : (label ? "" : JSON.stringify(s)) }
            }
            return { label: null, value: String(s) }
        })
    }
    if (typeof specs === "object") {
        return Object.entries(specs).map(([k, v]) => ({
            label: k,
            value: v != null && typeof v === "object" ? JSON.stringify(v) : String(v),
        }))
    }
    return [{ label: null, value: String(specs) }]
}

/* ============================================================
   Desktop-only presentational helpers
============================================================ */
const formatINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`

// Turn a camelCase / snake_case spec key into a readable label.
const prettyLabel = (key) =>
    String(key)
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())

const DStars = ({ rating = 0, size = 15 }) => (
    <span className="flex items-center" style={{ gap: "2px" }}>
        {[0, 1, 2, 3, 4].map((i) => {
            const on = i < Math.round(rating)
            return (
                <Star
                    key={i}
                    size={size}
                    style={{ color: on ? "var(--color-primary)" : "var(--color-border-strong)" }}
                    fill={on ? "var(--color-primary)" : "var(--color-border-strong)"}
                    strokeWidth={0}
                />
            )
        })}
    </span>
)

const AVATAR_COLORS = ["var(--color-accent-subtle)", "var(--color-info-border)", "var(--color-error-subtle)", "var(--color-surface-muted)", "var(--color-success-border)", "var(--color-accent-subtle)"]

const ProductDetail = () => {
    const { id } = useParams()
    const navigate = useNavigate()
    const dispatch = useDispatch()

    const [product, setProduct] = useState(null)
    const [thumbsSwiper, setThumbsSwiper] = useState(null)
    const [selectedSize, setSelectedSize] = useState("M")
    const [reviews, setReviews] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [avgRating, setAvgRating] = useState(0)
    const [reviewCount, setReviewCount] = useState(0)
    const [ratingStats, setRatingStats] = useState({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 })
    // Task 1.17 — live shipping rates, so the delivery claims on this page
    // state what the cart will actually charge rather than a hardcoded figure.
    const [shippingSettings, setShippingSettings] = useState(null)

    // Desktop-only UI state (lg+). Additive — mobile never reads these.
    const [relatedProducts, setRelatedProducts] = useState([])
    const [selectedImageIndex, setSelectedImageIndex] = useState(0)
    const [quantity, setQuantity] = useState(1)
    // undefined = the customer has not chosen yet (the page shows the default option); null = the MAIN option; object = a variant.
    // The old state started at null, so the main product was only ever "nothing selected".
    const [pickedVariant, setSelectedVariant] = useState(undefined)  // variant object from product.variants
    const [activeTab, setActiveTab] = useState("description")
    const [showAllReviews, setShowAllReviews] = useState(false)

    // Mobile-only UI state (≤lg). Additive — desktop never reads these.
    const isMobile = useIsMobile(1024)
    const [activeImgIdx, setActiveImgIdx] = useState(0)
    const [descExpanded, setDescExpanded] = useState(false)
    const [specsOpen, setSpecsOpen] = useState(false)

    // Phase 7.5: stock alert
    const [hasAlert, setHasAlert] = useState(false)
    const [alertBusy, setAlertBusy] = useState(false)
    const wishlistItems = useSelector((state) => state.wishlist.wishlistItems)
    const isWishlisted = wishlistItems.some((item) => String(item.id) === String(id))
    const user = useSelector((state) => state.user.user)

    const containerRef = useRef(null)
    const mainImgRef = useRef(null)
    const relatedScrollRef = useRef(null)

    // FETCH SHIPPING SETTINGS (task 1.17) — not keyed to `id`, the rates are
    // store-wide, so this runs once per mount rather than per product.
    useEffect(() => {
        let active = true
        getShippingSettings().then((data) => active && setShippingSettings(data)).catch(() => { })
        return () => { active = false }
    }, [])

    // FETCH PRODUCT
    useEffect(() => {
        window.scrollTo(0, 0)          // always open at the top
        setError(false)
        setSelectedImageIndex(0)
        setQuantity(1)
        setSelectedVariant(undefined)
        setShowAllReviews(false)
        setActiveTab("description")
        const fetchProduct = async () => {
            try {
                const { data: row, error } = await supabase
                    .from("products")
                    .select("*")
                    .eq("id", id)
                    .maybeSingle()
                if (error) throw error
                if (row) {
                    setProduct(mapProductRow(row))
                    addRecentlyViewed(row.id)
                } else {
                    setProduct(null)
                    setError(true)
                    console.log("Product not found")
                }
            } catch (error) {
                setError(true)
                console.log("Product fetch error:", error)
            }
        }
        fetchProduct()
    }, [id])

    // FETCH REVIEWS
    useEffect(() => {
        const fetchReviews = async () => {
            try {
                const { data: rows, error } = await supabase
                    .from("reviews")
                    .select("*, profiles(name)")
                    .eq("product_id", id)
                if (error) throw error
                const reviewList = (rows || []).map((row) => ({
                    id: row.id,
                    userId: row.user_id,
                    orderId: row.order_id,
                    productId: row.product_id,
                    rating: row.rating,
                    comment: row.comment,
                    createdAt: row.created_at,
                    userName: row.profiles?.name || "User",
                    // Storage paths (task 3.1); the column doesn't exist until the SQL is applied.
                    photos: Array.isArray(row.photos) ? row.photos : [],
                }))
                setReviews(reviewList)
            } catch (error) {
                console.log("Review fetch error:", error)
            } finally {
                setLoading(false)
            }
        }
        fetchReviews()
    }, [id])

    // FETCH RATINGS
    useEffect(() => {
        const fetchRatings = async () => {
            try {
                const { data: rows, error } = await supabase.from("reviews").select("rating").eq("product_id", id)
                if (error) throw error
                if (!rows || rows.length === 0) {
                    setAvgRating(0)
                    setReviewCount(0)
                    setRatingStats({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 })
                    return
                }

                let total = 0
                let count = 0
                let stats = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }

                rows.forEach((data) => {
                    if (data.rating) {
                        const rating = Number(data.rating)
                        total += rating
                        count++
                        const bucket = Math.round(rating)
                        if (stats[bucket] !== undefined) stats[bucket]++
                    }
                })
                setAvgRating(count > 0 ? total / count : 0)
                setReviewCount(count)
                setRatingStats(stats)
            } catch (error) {
                console.log("Rating error:", error)
            }
        }
        fetchRatings()
    }, [id])

    // FETCH RELATED PRODUCTS (same category, exclude current, max 4)
    useEffect(() => {
        if (!product?.category) return
        const fetchRelated = async () => {
            try {
                const { data, error } = await supabase
                    .from("products")
                    .select("*")
                    .eq("category", product.category)
                    .neq("id", id)
                    .limit(4)
                if (error) throw error
                setRelatedProducts(mapProductRows(data))
            } catch (error) {
                console.log("Related fetch error:", error)
            }
        }
        fetchRelated()
    }, [product?.category, id])

    // WISHLIST FUNCTION
    const handleWishlist = async (e) => {
        if (e) e.stopPropagation()
        if (!user) {
            alert("Please login first")
            return
        }
        const productId = String(id)
        try {
            if (isWishlisted) {
                dispatch(removeWishlist(productId))
                await removeWishlistItem(user.uid, productId)
            } else {
                const wishlistItem = {
                    userId: user.uid,
                    productId: productId,
                    id: productId,
                    title: product.title,
                    price: product.price,
                    image: product.thumbnail || product.image,
                    category: product.category,
                    addedAt: new Date().toISOString()
                }
                dispatch(addWishlist(wishlistItem))
                await addWishlistItem(user.uid, product)
            }
        } catch (error) {
            console.log("Wishlist error:", error)
        }
    }

    // SHARE — native share sheet where available, else copy the link.
    const handleShare = async (e) => {
        if (e) e.stopPropagation()
        const shareData = { title: product.title, text: product.title, url: window.location.href }
        try {
            if (navigator.share) {
                await navigator.share(shareData)
            } else {
                await navigator.clipboard.writeText(shareData.url)
                toast.success("Product link copied to clipboard")
            }
        } catch (error) {
            console.log("Share error:", error)
        }
    }

    const cartItems = useSelector((state) => state.cart.cartItems)
    const existingItem = cartItems.find((item) => String(item.id) === String(id))

    // GSAP Animations (desktop only — lg+)
    useGSAP(() => {
        if (loading || !product || isMobile) return

        const tl = gsap.timeline({ defaults: { ease: "power3.out" } })
        tl.from(".dt-breadcrumb", { y: -10, duration: 0.4 })
            .from(".dt-gallery", { x: -20, duration: 0.5 }, "<")
            .from(".dt-details", { x: 20, duration: 0.5 }, "<")
            .from(".dt-tabs", { y: 12, duration: 0.4 }, "-=0.2")

        const cards = gsap.utils.toArray(".dt-related-card")
        if (cards.length) {
            gsap.from(cards, { y: 16, stagger: 0.08, duration: 0.4, delay: 0.2 })
        }
    }, { scope: containerRef, dependencies: [product, loading, isMobile, activeTab] })

    const mainImage = product?.thumbnail || product?.image
    const galleryImages = product?.images || product?.productImages || product?.gallery || []
    // Keep the main product gallery unchanged — variant images show only inside their chips.
    const allImages = [mainImage, ...galleryImages].filter(Boolean)
    // What is selected: the customer's pick, else the default option (the main product when it can be bought,
    // otherwise the first variant in stock).
    const selectedVariant = pickedVariant !== undefined ? pickedVariant : (product ? (defaultOption(product)?.variant ?? null) : null)
    // Variant display image: when a variant with its own image is selected, swap main preview.
    const variantDisplayImage = selectedVariant?.image || null

    // The selected purchasable option supplies price / stock / SKU / policy. The main product and every variant are independent.
    const activeVariant = selectedVariant
    const activeOption = product ? optionForVariantId(product, activeVariant?.id || "") : null
    const displayPrice = activeOption ? activeOption.price : (product ? Number(product.price) || 0 : 0)
    const untrackedStock = activeOption?.stock === null            // "track inventory" is off for this option
    const displayStock = activeOption ? (untrackedStock ? 9999 : activeOption.stock) : (product ? Number(product.stock) || 0 : 0)
    const isOutOfStock = displayStock <= 0

    // --- Cart derivations ---
    const currentCartCompoundId = activeVariant ? `${product?.id || id}_${activeVariant.id}` : (product?.id || id)
    const currentCartItem = cartItems.find((item) => String(item.compound_id || item.id) === String(currentCartCompoundId))
    const inCartQty = currentCartItem ? (currentCartItem.quantity || 0) : 0

    // --- Mobile-only derivations (null-safe; desktop ignores these) ---
    const cartCount = cartItems.reduce((acc, item) => acc + (item.quantity || 0), 0)
    const stockNum = displayStock
    const stockWarning =
        stockNum <= 0
            ? "Out of stock"
            : stockNum <= 10
                ? `Only ${stockNum} left in stock - order soon`
                : null
    const activeImage = variantDisplayImage || allImages[activeImgIdx] || allImages[0]

    // Phase 7.5: check existing stock alert
    useEffect(() => {
        if (!isOutOfStock || !user?.uid || !product?.id) return
        let active = true
        supabase.from("stock_alerts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.uid)
            .eq("product_id", product.id)
            .eq("variant_id", activeVariant?.id || "")
            .then(({ count }) => { if (active) setHasAlert((count || 0) > 0) })
            .catch(() => {})
        return () => { active = false }
    }, [isOutOfStock, product?.id, user?.uid, activeVariant?.id])

    const handleToggleStockAlert = async () => {
        if (!user?.uid) { toast.error("Please login to enable stock alerts"); return }
        setAlertBusy(true)
        try {
            if (hasAlert) {
                await supabase.from("stock_alerts").delete()
                    .eq("user_id", user.uid).eq("product_id", product.id).eq("variant_id", activeVariant?.id || "")
                setHasAlert(false)
                toast.success("Stock alert removed")
            } else {
                await supabase.from("stock_alerts").upsert(
                    { user_id: user.uid, product_id: product.id, variant_id: activeVariant?.id || "" },
                    { onConflict: "user_id,product_id,variant_id", ignoreDuplicates: true }
                )
                setHasAlert(true)
                toast.success("We'll notify you when it's back in stock!")
            }
        } catch (err) {
            toast.error(err.message || "Could not set alert.")
        } finally {
            setAlertBusy(false)
        }
    }

    const specRows = normalizeSpecs(product?.specs)

    /* ============================================================
       Desktop-only derivations
    ============================================================ */
    const dName = product?.title || product?.name || "Product"
    const mrpNum = activeVariant ? Number(activeVariant.price) || 0 : Number(product?.price || 0)
    const discountPct = (() => {
        if (product?.discountExpiry) {
            const expiry = new Date(product.discountExpiry).getTime();
            if (Date.now() > expiry) return 0;
        }
        return Number(product?.discount || 0);
    })()
    const priceNum = mrpNum - (mrpNum * discountPct) / 100
    const desktopMainImage = variantDisplayImage || allImages[selectedImageIndex] || mainImage
    const features = Array.isArray(product?.features) ? product.features : []
    const specRowsDetailed = normalizeSpecs(product?.specifications || product?.specs)

    // Split the description into two paragraphs when no extended copy exists.
    const descText = product?.description || ""
    let descPara1 = descText
    let descPara2 = product?.descriptionExtended || ""
    if (!descPara2 && descText.length > 160) {
        const mid = Math.floor(descText.length / 2)
        const cut = descText.indexOf(". ", mid)
        if (cut > -1) {
            descPara1 = descText.slice(0, cut + 1)
            descPara2 = descText.slice(cut + 2)
        }
    }

    // Filter chips, sort and helpful votes for BOTH layouts (see components/Reviews).
    const rv = useReviewList(id, reviews)
    const sortedReviews = rv.filtered

    const displayedReviews = showAllReviews ? sortedReviews : sortedReviews.slice(0, 3)

    const formatReviewDate = (ts) => {
        const d = toReviewDate(ts)
        return d ? `Reviewed on ${d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}` : ""
    }

    const handleAddToCartDesktop = () => {
        if (!user) { navigate("/login"); return }
                const cartPayload = buildCartPayload(product, activeOption)
        const compoundId = activeVariant ? `${product.id}_${activeVariant.id}` : product.id
        const existingVariantItem = cartItems.find((item) => String(item.compound_id || item.id) === String(compoundId))
        const addedQty = quantity
        const qty = (existingVariantItem ? existingVariantItem.quantity : 0) + addedQty
        dispatch(addCart({ ...cartPayload, id: compoundId, compound_id: compoundId, qtyToAdd: addedQty }))
        upsertCartItem(user.uid, cartPayload, qty, activeVariant?.id || null)

        // Reset PDP quantity selector back to 1
        setQuantity(1)

        // Feedback toast notification
        toast.success(`Added ${addedQty} item${addedQty > 1 ? "s" : ""} to cart`)
    }

    const handleSelectImage = (i) => {
        setSelectedImageIndex(i)
        if (mainImgRef.current) {
            gsap.fromTo(mainImgRef.current, { scale: 0.97 }, { scale: 1, duration: 0.2, ease: "power2.out" })
        }
    }

    const scrollRelated = (dir) => {
        relatedScrollRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" })
    }

    return (
        <div className="bg-background min-h-screen text-ink overflow-x-hidden selection:bg-surface-inverse selection:text-inverse" ref={containerRef}>
            {loading ? (
                <ProductDetailSkeleton />
            ) : (error || !product) ? (
                <div className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center gap-6 px-6 text-center">
                    <p className="font-semibold text-[var(--color-ink)] text-2xl">Product not found</p>
                    <button
                        onClick={() => navigate("/products")}
                        className="flex items-center gap-2 rounded-xl px-6 h-12 font-bold text-inverse"
                        style={{ background: "var(--color-ink)" }}
                    >
                        <ArrowLeft size={18} /> Back to Products
                    </button>
                </div>
            ) : (
                <>
                    {/* ============================================================
              MOBILE + TABLET LAYOUT (≤lg) — preserved as-is.
          ============================================================ */}
                    <div className="block lg:hidden">
                        <div
                            className="min-h-screen w-full"
                            style={{ background: "var(--color-background)", fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}
                        >
                            {/* SCROLLABLE CONTENT (clears the global navbar) */}
                            <div style={{ paddingTop: "96px", paddingBottom: "81px" }}>

                                {/* 2 ── HERO */}
                                <section style={{ padding: "16px 20px 0" }}>
                                    <div className="relative w-full" style={{ background: "var(--color-surface)", borderRadius: "12px", overflow: "hidden" }}>
                                        <img
                                            src={activeImage}
                                            alt={product.title}
                                            style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }}
                                        />
                                        <button
                                            onClick={handleWishlist}
                                            aria-label="Toggle wishlist"
                                            className="absolute flex items-center justify-center"
                                            style={{ top: "16px", right: "16px", width: "36px", height: "36px", background: "color-mix(in srgb, var(--color-surface) 80%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", borderRadius: "9999px", boxShadow: "0px 1px 2px rgba(0,0,0,0.05)" }}
                                        >
                                            {isWishlisted ? <FaHeart size={20} style={{ color: "var(--color-primary)" }} /> : <FaRegHeart size={20} style={{ color: "var(--color-ink)" }} />}
                                        </button>
                                        <button
                                            onClick={handleShare}
                                            aria-label="Share product"
                                            className="absolute flex items-center justify-center"
                                            style={{ top: "60px", right: "16px", width: "36px", height: "36px", background: "color-mix(in srgb, var(--color-surface) 80%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", borderRadius: "9999px", boxShadow: "0px 1px 2px rgba(0,0,0,0.05)" }}
                                        >
                                            <Share2 size={18} style={{ color: "var(--color-ink)" }} />
                                        </button>
                                    </div>

                                    {/* Thumbnail gallery — horizontally scrollable */}
                                    {allImages.length > 1 && (
                                        <div className="hide-scrollbar" style={{ width: "100%", height: "88px", overflowX: "scroll", overflowY: "hidden", display: "flex", gap: "16px", paddingTop: "8px" }}>
                                            {allImages.map((img, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => setActiveImgIdx(i)}
                                                    className="flex items-center justify-center flex-shrink-0"
                                                    style={{ width: "80px", height: "80px", background: "var(--color-surface)", borderRadius: "8px", padding: "8px", border: i === activeImgIdx ? "2px solid var(--color-ink)" : "1px solid var(--color-border-strong)" }}
                                                >
                                                    <img src={img} alt="" style={{ width: "60px", height: "60px", objectFit: "cover", borderRadius: "4px" }} />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </section>

                                {/* 3 ── PRODUCT INFO */}
                                <section style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", gap: "8px" }}>
                                    <div>
                                        <p style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-muted)" }}>{product.category}</p>
                                        <h1 style={{ fontWeight: 700, fontSize: "24px", lineHeight: "30px", color: "var(--color-ink)", marginTop: "4px" }}>{product.title}</h1>
                                    </div>

                                    {/* Rating */}
                                    <div className="flex items-center" style={{ gap: "6px" }}>
                                        <div className="flex items-center" style={{ gap: "2px" }}>
                                            {[0, 1, 2, 3, 4].map((s) => {
                                                const on = s < Math.round(avgRating)
                                                return <Star key={s} size={12} style={{ fill: on ? "var(--color-chart-gold)" : "var(--color-border-strong)", color: on ? "var(--color-chart-gold)" : "var(--color-border-strong)" }} />
                                            })}
                                        </div>
                                        <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: "var(--color-body)" }}>
                                            {reviewCount > 0 ? `${avgRating.toFixed(1)} (${reviewCount} ${reviewCount === 1 ? "review" : "reviews"})` : "No reviews yet"}
                                        </span>
                                    </div>

                                    {/* Price */}
                                    <div className="flex flex-wrap items-center" style={{ gap: "10px", paddingTop: "8px" }}>
                                        {discountPct > 0 ? (
                                            <>
                                                <span style={{ fontWeight: 800, fontSize: "28px", letterSpacing: "-0.56px", color: "var(--color-primary)", lineHeight: 1 }}>
                                                    {formatINR(priceNum)}
                                                </span>
                                                <span style={{ fontWeight: 400, fontSize: "14px", color: "var(--color-muted)", textDecoration: "line-through" }}>
                                                    {formatINR(mrpNum)}
                                                </span>
                                                <span style={{ background: "var(--color-error-subtle)", borderRadius: "4px", padding: "2px 8px", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: "var(--color-error)" }}>
                                                    {discountPct}% OFF
                                                </span>
                                                {product.discountExpiry && (
                                                    <span style={{ width: "100%", fontWeight: 500, fontSize: "12px", color: "var(--color-accent-strong)", display: "flex", alignItems: "center", gap: "4px" }}>
                                                        Offer ends: {new Date(product.discountExpiry).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <span style={{ fontWeight: 800, fontSize: "28px", letterSpacing: "-0.56px", color: "var(--color-primary)", lineHeight: 1 }}>
                                                {formatINR(mrpNum)}
                                            </span>
                                        )}
                                    </div>

                                    {/* Purchasable options — mobile: the main product AND each variant, each with its own price */}
                                    <OptionPicker product={product} selectedVariant={selectedVariant} onSelect={setSelectedVariant} mainImage={mainImage} layout="mobile" />
                                    <OptionMeta product={product} selectedVariant={selectedVariant} />

                                    {/* Stock warning */}
                                    {stockWarning && (
                                        <div className="flex items-center" style={{ gap: "8px" }}>
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                                <path d="M12 9v4" />
                                                <path d="M12 17h.01" />
                                            </svg>
                                            <span style={{ fontWeight: 500, fontSize: "14px", color: "var(--color-error)" }}>{stockWarning}</span>
                                        </div>
                                    )}

                                    {/* Shipping box */}
                                    <div style={{ background: "var(--color-surface-muted)", border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)", borderRadius: "12px", padding: "12px", display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
                                        <div className="flex items-center" style={{ gap: "8px" }}>
                                            <Truck size={18} color="var(--color-ink)" />
                                            <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-ink)" }}>Free shipping</span>
                                        </div>
                                        {product.shippingInfo ? (
                                            <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: "var(--color-body)" }}>{String(product.shippingInfo)}</span>
                                        ) : null}
                                    </div>
                                </section>

                                {/* 4 ── DESCRIPTION */}
                                {product.description && (
                                    <section style={{ padding: "24px 20px 0", borderTop: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)", marginTop: "24px", display: "flex", flexDirection: "column", gap: "7.5px" }}>
                                        <h2 style={{ fontWeight: 600, fontSize: "18px", color: "var(--color-ink)" }}>Description</h2>
                                        <p
                                            style={
                                                descExpanded
                                                    ? { fontWeight: 400, fontSize: "14px", lineHeight: "20px", color: "var(--color-body)" }
                                                    : { fontWeight: 400, fontSize: "14px", lineHeight: "20px", color: "var(--color-body)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }
                                            }
                                        >
                                            {product.description}
                                        </p>
                                        {product.description.length > 120 && (
                                            <button
                                                onClick={() => setDescExpanded((v) => !v)}
                                                style={{ alignSelf: "flex-start", fontWeight: 700, fontSize: "12px", letterSpacing: "1.2px", textTransform: "uppercase", color: "var(--color-ink)" }}
                                            >
                                                {descExpanded ? "Read Less" : "Read More"}
                                            </button>
                                        )}
                                    </section>
                                )}

                                {/* 5 ── TECH SPECS ACCORDION */}
                                {specRows.length > 0 && (
                                    <section style={{ margin: "24px 20px 0" }}>
                                        <div style={{ border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)", borderRadius: "12px", overflow: "hidden" }}>
                                            <button
                                                onClick={() => setSpecsOpen((v) => !v)}
                                                className="w-full flex items-center justify-between"
                                                style={{ padding: "16px", background: "var(--color-surface)" }}
                                            >
                                                <span style={{ fontWeight: 600, fontSize: "18px", color: "var(--color-ink)" }}>Tech Specs</span>
                                                <ChevronDown size={16} color="var(--color-ink)" style={{ transition: "transform 0.3s ease", transform: specsOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
                                            </button>
                                            {specsOpen && (
                                                <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                                    {specRows.map((row, i) => (
                                                        <div key={i} className="flex" style={{ justifyContent: row.label ? "space-between" : "flex-start", gap: "12px", fontWeight: 400, fontSize: "14px", color: "var(--color-body)" }}>
                                                            {row.label ? (
                                                                <>
                                                                    <span style={{ color: "var(--color-muted)" }}>{row.label}</span>
                                                                    <span style={{ textAlign: "right" }}>{row.value}</span>
                                                                </>
                                                            ) : (
                                                                <span>{row.value}</span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                )}

                                {/* 5.25 ── DELIVERY & RETURNS (task 1.17) */}
                                <section style={{ margin: "24px 20px 0" }}>
                                    <PolicyLinks />
                                </section>

                                {/* 5.5 ── YOU MAY ALSO LIKE */}
                                {relatedProducts.length > 0 && (
                                    <section style={{ padding: "24px 0 0", borderTop: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)", marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                                        <h2 style={{ fontWeight: 600, fontSize: "18px", color: "var(--color-ink)", padding: "0 20px" }}>You May Also Like</h2>
                                        <div className="flex no-scrollbar" style={{ gap: "12px", overflowX: "auto", padding: "0 20px" }}>
                                            {relatedProducts.map((rp) => {
                                                const rpName = rp.title || rp.name || "Product"
                                                const rpImg = rp.thumbnail || rp.image || rp.imageUrl
                                                const rpMrp = Number(rp.price || 0)
                                                const rpDisc = Number(rp.discount || 0)
                                                const rpPrice = rpMrp - (rpMrp * rpDisc) / 100
                                                return (
                                                    <div
                                                        key={rp.id}
                                                        onClick={() => navigate(`/product/${rp.id}`, { state: { product: rp } })}
                                                        className="flex flex-col cursor-pointer flex-shrink-0"
                                                        style={{ width: "140px", gap: "4px" }}
                                                    >
                                                        <div style={{ width: "140px", height: "140px", background: "var(--color-surface-muted)", borderRadius: "10px", overflow: "hidden" }}>
                                                            <img src={rpImg} alt={rpName} className="w-full h-full object-cover" />
                                                        </div>
                                                        <span
                                                            style={{
                                                                fontWeight: 500, fontSize: "13px", color: "var(--color-ink)",
                                                                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                                                            }}
                                                        >
                                                            {rpName}
                                                        </span>
                                                        {rpDisc > 0 ? (
                                                            <div className="flex items-center" style={{ gap: "6px" }}>
                                                                <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-primary)" }}>{formatINR(rpPrice)}</span>
                                                                <span style={{ fontWeight: 400, fontSize: "11px", color: "var(--color-muted)", textDecoration: "line-through" }}>{formatINR(rpMrp)}</span>
                                                            </div>
                                                        ) : (
                                                            <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-ink)" }}>{formatINR(rpMrp)}</span>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </section>
                                )}

                                {/* 6 ── REVIEWS */}
                                <section id="mobile-reviews" style={{ padding: "24px 20px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
                                    <div className="flex items-center justify-between">
                                        <h2 style={{ fontWeight: 600, fontSize: "18px", color: "var(--color-ink)" }}>Reviews</h2>
                                        {reviews.length > 0 && (
                                            <button
                                                onClick={() => document.getElementById("mobile-reviews")?.scrollIntoView({ behavior: "smooth" })}
                                                style={{ fontWeight: 700, fontSize: "12px", letterSpacing: "0.6px", color: "var(--color-ink)" }}
                                            >
                                                View All
                                            </button>
                                        )}
                                    </div>

                                    {reviewCount > 0 && (
                                        <div
                                            className="flex items-center"
                                            style={{ gap: "16px", background: "var(--color-surface-muted)", borderRadius: "12px", padding: "16px" }}
                                        >
                                            <div className="flex flex-col items-center flex-shrink-0" style={{ gap: "2px" }}>
                                                <span style={{ fontWeight: 700, fontSize: "28px", color: "var(--color-ink)", lineHeight: 1 }}>{avgRating.toFixed(1)}</span>
                                                <DStars rating={avgRating} size={12} />
                                            </div>
                                            <div className="flex flex-col flex-1" style={{ gap: "4px" }}>
                                                {[5, 4, 3, 2, 1].map((star) => {
                                                    const count = ratingStats[star] || 0
                                                    const pct = reviewCount > 0 ? (count / reviewCount) * 100 : 0
                                                    return (
                                                        <div key={star} className="flex items-center" style={{ gap: "6px" }}>
                                                            <span style={{ fontSize: "11px", color: "var(--color-muted)", width: "8px" }}>{star}</span>
                                                            <div className="flex-1 overflow-hidden" style={{ height: "6px", background: "var(--color-border)", borderRadius: "9999px" }}>
                                                                <div style={{ height: "100%", width: `${pct}%`, background: "var(--color-primary)", borderRadius: "9999px" }} />
                                                            </div>
                                                            <span style={{ fontSize: "11px", color: "var(--color-muted)", width: "18px", textAlign: "right" }}>{count}</span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {reviews.length > 0 && (
                                        <div className="flex flex-col" style={{ gap: "10px" }}>
                                            <ReviewFilters rv={rv} compact />
                                            <div className="flex items-center justify-between" style={{ gap: "8px" }}>
                                                <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                                                    {rv.filtered.length} of {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
                                                </span>
                                                <ReviewSortSelect
                                                    rv={rv}
                                                    style={{ background: "var(--color-surface)", border: "1px solid var(--color-border-strong)", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", color: "var(--color-ink)" }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {reviews.length === 0 ? (
                                        <div
                                            className="flex flex-col items-center justify-center text-center"
                                            style={{
                                                background: "var(--color-surface-muted)",
                                                borderRadius: "12px",
                                                padding: "32px 16px",
                                                border: "1px dashed var(--color-border-strong)",
                                                gap: "6px"
                                            }}
                                        >
                                            <Star size={24} style={{ color: "var(--color-primary)", marginBottom: "4px" }} />
                                            <p style={{ fontWeight: 600, fontSize: "15px", color: "var(--color-ink)" }}>No reviews yet</p>
                                            <p style={{ fontWeight: 400, fontSize: "13px", color: "var(--color-muted)" }}>Have you purchased this product? Share your thoughts!</p>
                                        </div>
                                    ) : rv.filtered.length === 0 ? (
                                        <ReviewFilterEmpty onClear={rv.clearFilters} compact />
                                    ) : (
                                        rv.filtered.map((review, i) => {
                                            const initials = getInitials(review.userName)
                                            const avatarBg = ["var(--color-info-subtle)", "var(--color-error-subtle)"][i % 2]
                                            const reviewDate = toReviewDate(review.createdAt)
                                            const dateStr = reviewDate ? reviewDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""
                                            return (
                                                <div key={review.id} style={{ background: "var(--color-surface)", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                                    <div className="flex items-center" style={{ gap: "12px" }}>
                                                        <div className="flex items-center justify-center flex-shrink-0" style={{ width: "40px", height: "40px", borderRadius: "9999px", background: avatarBg, fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}>
                                                            {initials}
                                                        </div>
                                                        <div className="flex-1" style={{ minWidth: 0 }}>
                                                            <div className="flex items-center justify-between" style={{ gap: "8px" }}>
                                                                <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-ink)" }}>{review.userName || "Anonymous"}</span>
                                                                <div className="flex items-center flex-shrink-0" style={{ gap: "2px" }}>
                                                                    {[0, 1, 2, 3, 4].map((s) => {
                                                                        const on = s < (Number(review.rating) || 0)
                                                                        return <Star key={s} size={12} style={{ fill: on ? "var(--color-chart-gold)" : "var(--color-border-strong)", color: on ? "var(--color-chart-gold)" : "var(--color-border-strong)" }} />
                                                                    })}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center" style={{ gap: "6px" }}>
                                                                {dateStr && <span style={{ fontWeight: 500, fontSize: "10px", color: "var(--color-muted)" }}>{dateStr}</span>}
                                                                <span className="flex items-center" style={{ gap: "2px", fontWeight: 600, fontSize: "10px", color: "var(--color-success)" }}>
                                                                    <Check size={10} />
                                                                    Verified Purchase
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <p style={{ fontWeight: 400, fontSize: "14px", lineHeight: "20px", color: "var(--color-body)" }}>{review.comment}</p>
                                                    <ReviewExtras review={review} rv={rv} compact />
                                                </div>
                                            )
                                        })
                                    )}
                                </section>

                                {/* 6b ── PRODUCT Q&A (mounted only for this layout so the questions are fetched once) */}
                                {isMobile && <ProductQA productId={id} variant="mobile" sectionId="mobile-qa" />}
                            </div>

                            {/* 7 ── BOTTOM ACTION BAR (fixed, above the global mobile tab bar) */}
                            <div
                                className="fixed inset-x-0 z-50 flex items-center"
                                style={{ bottom: "calc(56px + env(safe-area-inset-bottom))", height: "81px", padding: "16px 20px", gap: "16px", background: "color-mix(in srgb, var(--color-surface) 92%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", borderTop: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)" }}
                            >
                                {isOutOfStock ? (
                                    <button
                                        disabled
                                        className="flex items-center justify-center flex-shrink-0"
                                        style={{ width: "134.8px", height: "48px", border: "1px solid var(--color-border)", borderRadius: "9999px", fontWeight: 700, fontSize: "14px", color: "var(--color-muted)", background: "transparent", cursor: "not-allowed" }}
                                    >
                                        Out of Stock
                                    </button>
                                ) : (() => {
                                    const currentCartCompoundId = activeVariant ? `${product?.id || id}_${activeVariant.id}` : (product?.id || id)
                                    const mobileCartItem = cartItems.find((item) => String(item.compound_id || item.id) === String(currentCartCompoundId))

                                    return mobileCartItem ? (
                                        <div
                                            className="flex items-center justify-between flex-shrink-0"
                                            style={{ width: "134.8px", height: "48px", border: "1px solid var(--color-ink)", borderRadius: "9999px", overflow: "hidden" }}
                                        >
                                            <button
                                                onClick={() => {
                                                    const qty = nextRemoveQuantity(cartItems, currentCartCompoundId)
                                                    dispatch(removeCart(String(currentCartCompoundId)))
                                                    decrementOrRemoveCartItem(user?.uid, currentCartCompoundId, qty, activeVariant?.id || null)
                                                }}
                                                aria-label="Decrease quantity"
                                                className="flex items-center justify-center h-full"
                                                style={{ width: "44px", color: "var(--color-ink)" }}
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)", minWidth: "20px", textAlign: "center" }}>
                                                {mobileCartItem.quantity}
                                            </span>
                                            <button
                                                disabled={mobileCartItem.quantity >= (displayStock || 0)}
                                                onClick={() => {
                                                    const qty = nextAddQuantity(cartItems, currentCartCompoundId)
                const cartPayload = buildCartPayload(product, activeOption)
                                                    dispatch(addCart({ ...cartPayload, id: currentCartCompoundId, compound_id: currentCartCompoundId, qtyToAdd: 1 }))
                                                    upsertCartItem(user?.uid, cartPayload, qty, activeVariant?.id || null)
                                                }}
                                                aria-label="Increase quantity"
                                                className="flex items-center justify-center h-full"
                                                style={{ width: "44px", color: "var(--color-ink)", opacity: mobileCartItem.quantity >= (displayStock || 0) ? 0.3 : 1 }}
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => {
                                                if (!user) { navigate("/login"); return }
                const cartPayload = buildCartPayload(product, activeOption)
                                                const qty = nextAddQuantity(cartItems, currentCartCompoundId)
                                                dispatch(addCart({ ...cartPayload, id: currentCartCompoundId, compound_id: currentCartCompoundId, qtyToAdd: 1 }))
                                                upsertCartItem(user.uid, cartPayload, qty, activeVariant?.id || null)
                                                toast.success("Added to cart")
                                            }}
                                            className="flex items-center justify-center flex-shrink-0"
                                            style={{ width: "134.8px", height: "48px", border: "1px solid var(--color-ink)", borderRadius: "9999px", fontWeight: 700, fontSize: "16px", color: "var(--color-ink)", background: "transparent" }}
                                        >
                                            Add to Cart
                                        </button>
                                    )
                                })()}
                                <button
                                    onClick={() => {
                                        if (!user) { navigate("/login"); return }
                                        const currentCartCompoundId = activeVariant ? `${product?.id || id}_${activeVariant.id}` : (product?.id || id)
                                        const mobileCartItem = cartItems.find((item) => String(item.compound_id || item.id) === String(currentCartCompoundId))
                const cartPayload = buildCartPayload(product, activeOption)
                                        if (!mobileCartItem) {
                                            const qty = nextAddQuantity(cartItems, currentCartCompoundId)
                                            dispatch(addCart({ ...cartPayload, id: currentCartCompoundId, compound_id: currentCartCompoundId, qtyToAdd: 1 }))
                                            upsertCartItem(user.uid, cartPayload, qty, activeVariant?.id || null)
                                        }
                                        navigate("/cart")
                                    }}
                                    className="flex items-center justify-center flex-1"
                                    style={{ height: "48px", background: "var(--color-primary)", borderRadius: "9999px", fontWeight: 700, fontSize: "16px", color: "var(--color-inverse)", boxShadow: "0px 10px 15px -3px color-mix(in srgb, var(--color-primary) 20%, transparent), 0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)" }}
                                >
                                    Buy Now
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ============================================================
              DESKTOP LAYOUT (lg+) — new design, matches html.png
          ============================================================ */}
                    <div className="hidden lg:block" style={{ background: "var(--color-background)", fontFamily: "Inter, sans-serif" }}>
                        <div className="mx-auto" style={{ maxWidth: "1280px", padding: "32px" }}>

                            {/* SECTION 1 — BREADCRUMBS */}
                            <div className="dt-breadcrumb flex items-center" style={{ gap: "8px", marginBottom: "32px" }}>
                                <button onClick={() => navigate("/")} className="text-[16px]" style={{ color: "var(--color-body)", fontWeight: 400 }}>Home</button>
                                <ChevronRight size={14} style={{ color: "var(--color-body)" }} />
                                <button onClick={() => navigate("/products")} className="text-[16px] capitalize" style={{ color: "var(--color-body)", fontWeight: 400 }}>{product.category}</button>
                                <ChevronRight size={14} style={{ color: "var(--color-body)" }} />
                                <span className="text-[16px]" style={{ color: "var(--color-ink)", fontWeight: 500 }}>
                                    {dName.length > 15 ? dName.slice(0, 15) + "..." : dName}
                                </span>
                            </div>

                            {/* SECTION 2 — PRODUCT HERO */}
                            <div className="flex items-start" style={{ gap: "40px" }}>

                                {/* LEFT — Image Gallery (~half the width) */}
                                <div className="dt-gallery flex flex-1 min-w-0" style={{ gap: "16px" }}>
                                    {/* Thumbnail strip */}
                                    <div className="flex flex-col flex-shrink-0 no-scrollbar" style={{ width: "96px", gap: "12px", maxHeight: "520px", overflowY: "auto" }}>
                                        {allImages.map((img, i) => (
                                            <button
                                                key={i}
                                                onClick={() => handleSelectImage(i)}
                                                className="flex-shrink-0 overflow-hidden"
                                                style={{
                                                    width: "96px",
                                                    height: "96px",
                                                    borderRadius: "8px",
                                                    border: i === selectedImageIndex ? "2px solid var(--color-ink)" : "1px solid var(--color-border-strong)",
                                                    background: "var(--color-surface)",
                                                }}
                                            >
                                                <img src={img} alt="" className="w-full h-full object-cover" />
                                            </button>
                                        ))}
                                    </div>
                                    {/* Main image — grows to fill the gallery column (square) */}
                                    <div
                                        className="flex-1 min-w-0 aspect-square self-start"
                                        style={{
                                            borderRadius: "12px",
                                            boxShadow: "0px 4px 12px rgba(0,0,0,0.05)",
                                            background: "rgba(255,255,255,0.002)",
                                            overflow: "hidden",
                                        }}
                                    >
                                        <img ref={mainImgRef} src={desktopMainImage} alt={dName} className="w-full h-full object-cover" />
                                    </div>
                                </div>

                                {/* RIGHT — Product Details (~half the width) */}
                                <div className="dt-details flex flex-col flex-1 min-w-0" style={{ gap: "24px" }}>
                                    {/* Top block */}
                                    <div className="flex flex-col" style={{ gap: "8px" }}>
                                        <span
                                            className="self-start capitalize"
                                            style={{ background: "var(--color-border)", borderRadius: "9999px", padding: "4px 16px", fontWeight: 600, fontSize: "14px", color: "var(--color-body)", letterSpacing: "0.14px" }}
                                        >
                                            {product.category}
                                        </span>
                                        <h1 style={{ fontWeight: 600, fontSize: "32px", color: "var(--color-ink)", letterSpacing: "-0.8px", lineHeight: "40px" }}>
                                            {dName}
                                        </h1>
                                        {reviewCount > 0 ? (
                                            <div
                                                className="flex items-center cursor-pointer hover:opacity-80 transition-opacity"
                                                style={{ gap: "12px" }}
                                                onClick={() => document.getElementById("customer-reviews-section")?.scrollIntoView({ behavior: "smooth" })}
                                            >
                                                <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-ink)" }}>{avgRating.toFixed(1)}</span>
                                                <DStars rating={avgRating} size={15} />
                                                <span style={{ fontWeight: 400, fontSize: "14px", color: "var(--color-body)" }}>
                                                    ({reviewCount.toLocaleString("en-IN")} {reviewCount === 1 ? "Review" : "Reviews"})
                                                </span>
                                            </div>
                                        ) : (
                                            <div
                                                className="flex items-center cursor-pointer group transition-opacity"
                                                style={{ gap: "8px" }}
                                                onClick={() => document.getElementById("customer-reviews-section")?.scrollIntoView({ behavior: "smooth" })}
                                            >
                                                <span style={{ fontWeight: 500, fontSize: "14px", color: "var(--color-muted)" }}>No reviews yet</span>
                                                <span style={{ color: "var(--color-muted)" }}>·</span>
                                                <span
                                                    className="group-hover:underline"
                                                    style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-primary)" }}
                                                >
                                                    Be the first to review
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Price block */}
                                    <div style={{ borderTop: "1px solid var(--color-border-strong)", borderBottom: "1px solid var(--color-border-strong)", padding: "24px 0", display: "flex", flexDirection: "column", gap: "12px" }}>
                                        <div className="flex items-end flex-wrap" style={{ gap: "16px" }}>
                                            <span style={{ fontWeight: 700, fontSize: "48px", color: "var(--color-ink)", letterSpacing: "-0.96px", lineHeight: 1 }}>
                                                {formatINR(priceNum)}
                                            </span>
                                            {mrpNum > priceNum && (
                                                <span style={{ fontWeight: 400, fontSize: "18px", color: "var(--color-body)", textDecoration: "line-through" }}>
                                                    {formatINR(mrpNum)}
                                                </span>
                                            )}
                                            {discountPct > 0 && (
                                                <span style={{ background: "var(--color-accent-strong)", borderRadius: "4px", padding: "4px 8px", color: "var(--color-inverse)", fontWeight: 600, fontSize: "14px" }}>
                                                    {discountPct}% OFF
                                                </span>
                                            )}
                                            {discountPct > 0 && product?.discountExpiry && (
                                                <div className="w-full text-[14px] font-semibold text-accent-strong bg-accent-subtle border border-accent-subtle rounded-lg p-3 mt-2 flex items-center gap-2">
                                                    <span> Offer valid till: {new Date(product.discountExpiry).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center" style={{ gap: "8px" }}>
                                            <span style={{ width: "10px", height: "10px", borderRadius: "9999px", background: stockNum > 0 ? "var(--color-success)" : "var(--color-error)" }} />
                                            <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-ink)" }}>
                                                {stockNum > 0 ? (untrackedStock ? "In Stock" : `In Stock | Available Quantity: ${stockNum} units`) : "Out of Stock"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Purchasable options — desktop */}
                                    <OptionPicker product={product} selectedVariant={selectedVariant} onSelect={setSelectedVariant} mainImage={mainImage} layout="desktop" />
                                    <OptionMeta product={product} selectedVariant={selectedVariant} />

                                    {/* Quantity + Actions */}
                                    <div className="flex flex-col" style={{ gap: "20px" }}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col" style={{ gap: "8px" }}>
                                                <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-body)" }}>Quantity</span>
                                                <div
                                                    className="flex items-center"
                                                    style={{ background: "var(--color-background)", border: "1px solid var(--color-muted)", borderRadius: "12px", width: "146px", height: "48px", padding: "0 8px" }}
                                                >
                                                    <button
                                                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                                                        className="flex items-center justify-center"
                                                        style={{ width: "40px", height: "40px", borderRadius: "8px" }}
                                                        aria-label="Decrease quantity"
                                                    >
                                                        <Minus size={16} style={{ color: "var(--color-ink)" }} />
                                                    </button>
                                                    <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)", width: "48px", textAlign: "center" }}>{quantity}</span>
                                                    <button
                                                        onClick={() => setQuantity((q) => (stockNum ? Math.min(stockNum, q + 1) : q + 1))}
                                                        className="flex items-center justify-center"
                                                        style={{ width: "40px", height: "40px", borderRadius: "8px" }}
                                                        aria-label="Increase quantity"
                                                    >
                                                        <Plus size={16} style={{ color: "var(--color-ink)" }} />
                                                    </button>
                                                </div>
                                            </div>

                                            {inCartQty > 0 && (
                                                <div
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold self-end"
                                                    style={{
                                                        background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                                                        color: "var(--color-primary)",
                                                        border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)",
                                                        marginBottom: "4px"
                                                    }}
                                                >
                                                    <Check size={14} className="stroke-[2.5]" />
                                                    <span>{inCartQty} in your cart</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center" style={{ gap: "16px" }}>
                                                                                    {isOutOfStock ? (
                                            <button
                                                onClick={handleToggleStockAlert}
                                                disabled={alertBusy}
                                                className="flex items-center justify-center gap-2 flex-1"
                                                style={{ height: "56px", background: hasAlert ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : "var(--color-surface)", border: `1.5px solid ${hasAlert ? "var(--color-primary)" : "var(--color-border-strong)"}`, borderRadius: "12px", gap: "8px", cursor: alertBusy ? "not-allowed" : "pointer", opacity: alertBusy ? 0.5 : 1 }}
                                            >
                                                {hasAlert ? <BellOff size={20} color="var(--color-primary)" /> : <Bell size={20} color="var(--color-muted)" />}
                                                <span style={{ color: hasAlert ? "var(--color-primary)" : "var(--color-muted)", fontWeight: 600, fontSize: "15px" }}>{hasAlert ? "You'll be notified" : "Notify Me"}</span>
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleAddToCartDesktop}
                                                className="flex items-center justify-center flex-1"
                                                style={{ height: "56px", background: "var(--color-ink)", borderRadius: "12px", gap: "8px", boxShadow: "0px 4px 12px rgba(0,0,0,0.05)", cursor: "pointer" }}
                                            >
                                                <ShoppingCart size={20} color="var(--color-inverse)" />
                                                <span style={{ color: "var(--color-inverse)", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 400, fontSize: "16px" }}>Add to Cart</span>
                                            </button>
                                        )}
                                            <button
                                                onClick={handleWishlist}
                                                className="flex items-center justify-center flex-shrink-0"
                                                style={{ width: "56px", height: "56px", border: "1px solid var(--color-muted)", borderRadius: "12px" }}
                                                aria-label="Toggle wishlist"
                                            >
                                                <Heart size={20} style={{ color: isWishlisted ? "var(--color-primary)" : "var(--color-body)" }} fill={isWishlisted ? "var(--color-primary)" : "none"} />
                                            </button>
                                            <button
                                                onClick={handleShare}
                                                className="flex items-center justify-center flex-shrink-0"
                                                style={{ width: "56px", height: "56px", border: "1px solid var(--color-muted)", borderRadius: "12px" }}
                                                aria-label="Share product"
                                            >
                                                <Share2 size={20} style={{ color: "var(--color-body)" }} />
                                            </button>
                                        </div>

                                        {/* Delivery info */}
                                        <div className="flex" style={{ gap: "16px" }}>
                                            <div className="flex items-center flex-1" style={{ height: "62px", background: "var(--color-surface-muted)", borderRadius: "12px", padding: "16px", gap: "8px" }}>
                                                <Truck size={22} style={{ color: "var(--color-ink)" }} />
                                                {/* Task 1.17: this tile used to promise "Free Delivery"
                                                    unconditionally, which contradicts the threshold-based
                                                    rate the cart actually charges. Now states the real
                                                    threshold from live `shippingSettings`. */}
                                                <div className="flex flex-col">
                                                    <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-ink)" }}>
                                                        {shippingSettings
                                                            ? `Free over ₹${Number(shippingSettings.freeShippingThreshold || 0).toFixed(0)}`
                                                            : "Delivery"}
                                                    </span>
                                                    <span style={{ fontWeight: 500, fontSize: "12px", color: "var(--color-body)" }}>Within 3-5 days</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center flex-1" style={{ height: "62px", background: "var(--color-surface-muted)", borderRadius: "12px", padding: "16px", gap: "8px" }}>
                                                <Shield size={20} style={{ color: "var(--color-ink)" }} />
                                                <div className="flex flex-col">
                                                    <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-ink)" }}>1 Year Warranty</span>
                                                    <span style={{ fontWeight: 500, fontSize: "12px", color: "var(--color-body)" }}>Brand Warranty</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* SECTION 3 — TABS */}
                            <div className="dt-tabs" style={{ marginTop: "64px" }}>
                                <div className="flex" style={{ borderBottom: "1px solid var(--color-border-strong)", gap: "32px" }}>
                                    {[
                                        { key: "description", label: "Product Description" },
                                        { key: "specifications", label: "Specifications" },
                                        { key: "shipping", label: "Shipping & Returns" },
                                    ].map((tab) => (
                                        <button
                                            key={tab.key}
                                            onClick={() => setActiveTab(tab.key)}
                                            style={{
                                                fontWeight: 600,
                                                fontSize: "14px",
                                                letterSpacing: "0.14px",
                                                paddingBottom: "16px",
                                                color: activeTab === tab.key ? "var(--color-ink)" : "var(--color-body)",
                                                borderBottom: activeTab === tab.key ? "2px solid var(--color-ink)" : "2px solid transparent",
                                            }}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* TAB — Description */}
                                {activeTab === "description" && (
                                    <div className="flex items-start" style={{ gap: "32px", marginTop: "32px" }}>
                                        <div className="flex flex-col flex-1" style={{ gap: "24px" }}>
                                            <h3 style={{ fontWeight: 600, fontSize: "20px", color: "var(--color-ink)" }}>Overview</h3>
                                            {descPara1 && <p style={{ fontWeight: 400, fontSize: "16px", lineHeight: "26px", color: "var(--color-body)" }}>{descPara1}</p>}
                                            {descPara2 && <p style={{ fontWeight: 400, fontSize: "16px", lineHeight: "26px", color: "var(--color-body)" }}>{descPara2}</p>}
                                            {features.length > 0 && (
                                                <>
                                                    <h3 style={{ fontWeight: 600, fontSize: "20px", color: "var(--color-ink)", paddingTop: "16px" }}>Key Features</h3>
                                                    <div className="grid grid-cols-2" style={{ gap: "8px 24px" }}>
                                                        {features.map((f, i) => (
                                                            <div key={i} className="flex items-center" style={{ gap: "8px" }}>
                                                                <Check size={20} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
                                                                <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-ink)" }}>{f}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {specRowsDetailed.length > 0 && (
                                            <div className="flex-shrink-0" style={{ width: "373.33px", background: "var(--color-border)", borderRadius: "12px", padding: "32px" }}>
                                                <h3 style={{ fontWeight: 600, fontSize: "20px", color: "var(--color-ink)", marginBottom: "16px" }}>Specifications</h3>
                                                <div className="flex flex-col" style={{ gap: "16px" }}>
                                                    {specRowsDetailed.filter((r) => r.value).map((row, i) => (
                                                        <div key={i} className="flex items-center justify-between" style={{ borderBottom: "1px solid color-mix(in srgb, var(--color-border-strong) 30%, transparent)", paddingBottom: "16px" }}>
                                                            <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>{row.label ? prettyLabel(row.label) : "Detail"}</span>
                                                            <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)", textAlign: "right" }}>{row.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* TAB — Specifications */}
                                {activeTab === "specifications" && (
                                    <div style={{ marginTop: "32px" }}>
                                        {specRowsDetailed.length > 0 ? (
                                            <div className="flex flex-col" style={{ gap: "16px", maxWidth: "800px" }}>
                                                {specRowsDetailed.filter((r) => r.value).map((row, i) => (
                                                    <div key={i} className="flex items-center justify-between" style={{ borderBottom: "1px solid color-mix(in srgb, var(--color-border-strong) 30%, transparent)", paddingBottom: "16px" }}>
                                                        <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>{row.label ? prettyLabel(row.label) : "Detail"}</span>
                                                        <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)", textAlign: "right" }}>{row.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p style={{ fontWeight: 400, fontSize: "16px", lineHeight: "26px", color: "var(--color-body)" }}>No specifications available.</p>
                                        )}
                                    </div>
                                )}

                                {/* TAB — Shipping & Returns
                                    Task 1.17: this tab previously made three
                                    hardcoded claims that contradicted the
                                    store's actual policy — it advertised an
                                    "Express delivery" tier that doesn't exist,
                                    and "Free returns within 30 days" against a
                                    real 7-day return window. Replaced with the
                                    genuine terms, with the shipping rates read
                                    from the same live `shippingSettings` the
                                    cart charges from, plus links to the full
                                    policies. */}
                                {activeTab === "shipping" && (
                                    <div className="flex flex-col" style={{ marginTop: "32px", gap: "16px", maxWidth: "800px" }}>
                                        <p style={{ fontWeight: 400, fontSize: "16px", lineHeight: "26px", color: "var(--color-body)" }}>
                                            {shippingSettings
                                                ? `Orders over ₹${Number(shippingSettings.freeShippingThreshold || 0).toFixed(2)} ship free. Below that, a flat ₹${Number(shippingSettings.shippingCost || 0).toFixed(2)} charge applies, shown at checkout before you pay.`
                                                : "Shipping cost is calculated at checkout based on your order total."}
                                        </p>
                                        <p style={{ fontWeight: 400, fontSize: "16px", lineHeight: "26px", color: "var(--color-body)" }}>
                                            Orders are packed and handed to our delivery partner within 1–2 business days, then typically take a further 2–5 business days to arrive.
                                        </p>
                                        <p style={{ fontWeight: 400, fontSize: "16px", lineHeight: "26px", color: "var(--color-body)" }}>
                                            {activeOption ? <>This item: <strong>{policySummary(activeOption)}</strong> (counted from delivery). </> : null}If an item arrives damaged, incorrect, or not as described, contact us within its return window and we&apos;ll arrange a replacement or refund.
                                        </p>
                                        <PolicyLinks style={{ marginTop: "8px", maxWidth: "420px" }} />
                                    </div>
                                )}
                            </div>

                            {/* SECTION 4 — CUSTOMER REVIEWS */}
                            <div id="customer-reviews-section" style={{ borderTop: "1px solid var(--color-border-strong)", paddingTop: "72px", marginTop: "72px", display: "flex", flexDirection: "column", gap: "48px" }}>
                                <div className="flex items-center justify-between">
                                    <h2 style={{ fontWeight: 600, fontSize: "32px", color: "var(--color-ink)" }}>Customer Reviews</h2>
                                    {reviewCount > 0 && (
                                        <div className="flex items-center" style={{ gap: "8px" }}>
                                            <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>Sort by:</span>
                                            <ReviewSortSelect
                                                rv={rv}
                                                style={{ background: "var(--color-background)", border: "1px solid var(--color-muted)", borderRadius: "8px", padding: "8px 16px", fontSize: "14px", color: "var(--color-ink)" }}
                                            />
                                        </div>
                                    )}
                                </div>

                                {reviewCount === 0 ? (
                                    <div
                                        className="flex flex-col items-center justify-center text-center w-full"
                                        style={{
                                            background: "var(--color-surface-muted)",
                                            borderRadius: "16px",
                                            padding: "56px 24px",
                                            border: "1px dashed var(--color-border-strong)",
                                            gap: "12px"
                                        }}
                                    >
                                        <div
                                            className="flex items-center justify-center"
                                            style={{
                                                width: "56px",
                                                height: "56px",
                                                borderRadius: "50%",
                                                background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                                                color: "var(--color-primary)",
                                                marginBottom: "4px"
                                            }}
                                        >
                                            <Star size={26} strokeWidth={2} />
                                        </div>
                                        <h3 style={{ fontWeight: 600, fontSize: "20px", color: "var(--color-ink)" }}>
                                            No reviews yet
                                        </h3>
                                        <p style={{ fontWeight: 400, fontSize: "15px", color: "var(--color-body)", maxWidth: "440px", lineHeight: "22px" }}>
                                            Have you purchased or tried this product? Be the first to share your thoughts and help other shoppers make their choice!
                                        </p>
                                    </div>
                                ) : (
                                    <div className="flex items-start" style={{ gap: "48px" }}>
                                        {/* Rating Summary */}
                                        <div className="flex flex-col flex-shrink-0" style={{ width: "350px", background: "var(--color-surface-muted)", borderRadius: "12px", padding: "32px", gap: "32px" }}>
                                            <div className="flex flex-col items-center" style={{ gap: "8px" }}>
                                                <span style={{ fontWeight: 700, fontSize: "56px", color: "var(--color-ink)", lineHeight: 1 }}>{avgRating.toFixed(1)}</span>
                                                <DStars rating={avgRating} size={20} />
                                                <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>
                                                    Total {reviewCount.toLocaleString("en-IN")} reviews
                                                </span>
                                            </div>
                                            <div className="flex flex-col" style={{ gap: "8px" }}>
                                                {[5, 4, 3, 2, 1].map((star) => {
                                                    const count = ratingStats[star] || 0
                                                    const pct = reviewCount > 0 ? (count / reviewCount) * 100 : 0
                                                    return (
                                                        <div key={star} className="flex items-center" style={{ gap: "8px" }}>
                                                            <span style={{ fontSize: "16px", color: "var(--color-ink)", width: "12px" }}>{star}</span>
                                                            <div className="flex-1 overflow-hidden" style={{ height: "8px", background: "var(--color-border)", borderRadius: "9999px" }}>
                                                                <div style={{ height: "100%", width: `${pct}%`, background: "var(--color-primary)", borderRadius: "9999px" }} />
                                                            </div>
                                                            <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-ink)", width: "24px", textAlign: "right" }}>{count}</span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>

                                        {/* Review cards */}
                                        <div className="flex flex-col flex-1" style={{ gap: "32px" }}>
                                            <ReviewFilters rv={rv} />
                                            {displayedReviews.length === 0 && <ReviewFilterEmpty onClear={rv.clearFilters} />}
                                            {displayedReviews.map((review, i) => {
                                                const initials = review.userInitials || getInitials(review.userName)
                                                const avatarBg = review.avatarColor || AVATAR_COLORS[i % AVATAR_COLORS.length]
                                                return (
                                                    <div key={review.id} style={{ borderBottom: "1px solid var(--color-border-strong)", paddingBottom: "32px" }}>
                                                        <div className="flex items-center" style={{ gap: "16px" }}>
                                                            <div
                                                                className="flex items-center justify-center flex-shrink-0"
                                                                style={{ width: "48px", height: "48px", borderRadius: "9999px", background: avatarBg, fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}
                                                            >
                                                                {initials}
                                                            </div>
                                                            <div className="flex flex-col" style={{ gap: "4px" }}>
                                                                <div className="flex items-center" style={{ gap: "10px" }}>
                                                                    <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-ink)" }}>{review.userName || "Anonymous"}</span>
                                                                    <span className="flex items-center" style={{ gap: "3px", fontWeight: 600, fontSize: "12px", color: "var(--color-success)" }}>
                                                                        <Check size={12} />
                                                                        Verified Purchase
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center" style={{ gap: "12px" }}>
                                                                    <DStars rating={Number(review.rating) || 0} size={15} />
                                                                    <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>{formatReviewDate(review.createdAt)}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {review.title && <h4 style={{ fontWeight: 600, fontSize: "20px", color: "var(--color-ink)", paddingTop: "8px" }}>{review.title}</h4>}
                                                        <p style={{ fontWeight: 400, fontSize: "16px", lineHeight: "24px", color: "var(--color-body)", paddingTop: review.title ? "4px" : "8px" }}>
                                                            {review.body || review.comment}
                                                        </p>
                                                        <ReviewExtras review={review} rv={rv} />
                                                    </div>
                                                )
                                            })}
                                            {sortedReviews.length > 3 && (
                                                <button
                                                    onClick={() => setShowAllReviews((v) => !v)}
                                                    className="w-full"
                                                    style={{ height: "60px", border: "2px solid var(--color-ink)", borderRadius: "12px", fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}
                                                >
                                                    {showAllReviews ? "Show Less" : "View All Reviews"}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* SECTION 4b — PRODUCT Q&A (mounted only for this layout so the questions are fetched once) */}
                            {!isMobile && <ProductQA productId={id} variant="desktop" sectionId="product-qa-section" />}

                            {/* SECTION 5 — RELATED PRODUCTS */}
                            {relatedProducts.length > 0 && (
                                <div style={{ paddingTop: "72px", display: "flex", flexDirection: "column", gap: "32px" }}>
                                    <div className="flex items-center justify-between">
                                        <h2 style={{ fontWeight: 600, fontSize: "32px", color: "var(--color-ink)" }}>You May Also Like</h2>
                                        <div className="flex items-center" style={{ gap: "8px" }}>
                                            <button
                                                onClick={() => scrollRelated(-1)}
                                                className="flex items-center justify-center"
                                                style={{ width: "40px", height: "40px", border: "1px solid var(--color-border-strong)", borderRadius: "9999px" }}
                                                aria-label="Scroll left"
                                            >
                                                <ChevronLeft size={16} style={{ color: "var(--color-ink)" }} />
                                            </button>
                                            <button
                                                onClick={() => scrollRelated(1)}
                                                className="flex items-center justify-center"
                                                style={{ width: "40px", height: "40px", border: "1px solid var(--color-border-strong)", borderRadius: "9999px" }}
                                                aria-label="Scroll right"
                                            >
                                                <ChevronRight size={16} style={{ color: "var(--color-ink)" }} />
                                            </button>
                                        </div>
                                    </div>

                                    <div ref={relatedScrollRef} className="flex no-scrollbar" style={{ gap: "24px", overflowX: "auto" }}>
                                        {relatedProducts.map((rp) => {
                                            const rpName = rp.title || rp.name || "Product"
                                            const rpImg = rp.thumbnail || rp.image || rp.imageUrl
                                            return (
                                                <div
                                                    key={rp.id}
                                                    onClick={() => navigate(`/product/${rp.id}`, { state: { product: rp } })}
                                                    className="dt-related-card flex flex-col cursor-pointer flex-shrink-0 group"
                                                    style={{ width: "286px", gap: "4px" }}
                                                >
                                                    <div className="relative overflow-hidden" style={{ width: "286px", height: "357.5px", background: "var(--color-surface-muted)", borderRadius: "12px" }}>
                                                        <img src={rpImg} alt={rpName} className="w-full h-full object-cover" />
                                                        <button
                                                            onClick={(e) => { e.stopPropagation() }}
                                                            className="absolute flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                            style={{ top: "16px", right: "16px", width: "32px", height: "32px", background: "color-mix(in srgb, var(--color-surface) 80%, transparent)", backdropFilter: "blur(4px)", borderRadius: "9999px" }}
                                                            aria-label="Wishlist"
                                                        >
                                                            <Heart size={16} style={{ color: "var(--color-body)" }} />
                                                        </button>
                                                    </div>
                                                    <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)", paddingTop: "12px" }} className="capitalize">{rp.brand || rp.category}</span>
                                                    <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-ink)" }}>{rpName}</span>
                                                    {(() => {
                                                        const rpMrp = Number(rp.price || 0)
                                                        const rpDisc = Number(rp.discount || 0)
                                                        const rpPrice = rpMrp - (rpMrp * rpDisc) / 100
                                                        return rpDisc > 0 ? (
                                                            <div className="flex items-center" style={{ gap: "8px", flexWrap: "wrap" }}>
                                                                <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-primary)" }}>{formatINR(rpPrice)}</span>
                                                                <span style={{ fontWeight: 400, fontSize: "14px", color: "var(--color-muted)", textDecoration: "line-through" }}>{formatINR(rpMrp)}</span>
                                                                <span style={{ background: "var(--color-error-subtle)", borderRadius: "4px", padding: "2px 6px", fontWeight: 600, fontSize: "11px", color: "var(--color-error)" }}>{rpDisc}% OFF</span>
                                                            </div>
                                                        ) : (
                                                            <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}>{formatINR(rpMrp)}</span>
                                                        )
                                                    })()}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

export default memo(ProductDetail)