import React, { useState, useEffect } from "react"
import { useSelector, useDispatch } from "react-redux"
import { useNavigate } from "react-router-dom"
import { removeWishlist } from "../../context/WishlistSlice"
import { addCart } from "../../context/CartSlice"
import { Trash2, ShoppingBag, ArrowRight, ArrowLeft, ChevronRight, Share2, ShoppingCart, X, Bell } from "lucide-react"
import { supabase } from "../../context/SupabaseConfig"
import { mapProductRows } from "../../utils/supabaseProducts"
import { upsertCartItem, nextAddQuantity } from "../../utils/supabaseCart"
import { removeWishlistItem } from "../../utils/supabaseWishlist"
import { formatCurrency } from "../../utils/pricing"
import { toast } from "react-toastify"
import useIsMobile from "../../hooks/useIsMobile"
import Skeleton from "../../components/Common/Skeleton"

const WishlistPage = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems)
  const cartItems = useSelector((state) => state.cart.cartItems)
  const user = useSelector((state) => state.user.user)
  // Mobile design renders below `lg`; the desktop redesign at lg+.
  const isMobile = useIsMobile(1024)

  /* ---------- DESKTOP: enrichment + recommendations ---------- */
  // Shared formatter; the currency symbol lives in utils/pricing.js so it
  // cannot drift between screens again.
  const money = formatCurrency
  const LOW_STOCK = 5
  const pidOf = (item) => item.productId || item.id

  const [productMap, setProductMap] = useState({})
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [recommended, setRecommended] = useState([])
  const [loadingRec, setLoadingRec] = useState(true)
  const [alertedIds, setAlertedIds] = useState([])

  const wishlistKey = wishlistItems.map(pidOf).join(",")

  // Join each wishlist item with its live product row (stock / mrp for badges).
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoadingProducts(true)
      try {
        const ids = [...new Set(wishlistItems.map(pidOf).filter(Boolean))].map(String)
        if (!ids.length) {
          if (active) setProductMap({})
          return
        }
        const { data, error } = await supabase.from("products").select("*").in("id", ids)
        if (error) throw error
        const map = {}
        mapProductRows(data).forEach((p) => { map[p.id] = p })
        if (active) setProductMap(map)
      } catch (e) {
        console.log("wishlist product join failed:", e)
        if (active) setProductMap({})
      } finally {
        if (active) setLoadingProducts(false)
      }
    })()
    return () => { active = false }
  }, [wishlistKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Recommended: top-rated products not already in the wishlist.
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoadingRec(true)
      try {
        let { data, error } = await supabase
          .from("products")
          .select("*")
          .order("rating", { ascending: false })
          .limit(12)
        if (error) {
          ({ data, error } = await supabase.from("products").select("*").limit(12))
          if (error) throw error
        }
        const wishIds = new Set(wishlistItems.map(pidOf).map(String))
        const list = mapProductRows(data).filter((p) => !wishIds.has(String(p.id))).slice(0, 4)
        if (active) setRecommended(list)
      } catch (e) {
        console.log("recommended fetch failed:", e)
      } finally {
        if (active) setLoadingRec(false)
      }
    })()
    return () => { active = false }
  }, [wishlistKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive a stock badge from the joined product's stock.
  const stockInfo = (pid) => {
    const stock = Number(productMap[pid]?.stock)
    if (Number.isFinite(stock)) {
      if (stock <= 0) return { status: "OUT", label: "OUT OF STOCK" }
      if (stock <= LOW_STOCK) return { status: "LOW", label: `ONLY ${stock} LEFT`, left: stock }
      return { status: "IN", label: "IN STOCK" }
    }
    return { status: "IN", label: "IN STOCK" } // unknown stock → treat as available
  }

  const mrpOf = (pid) => Number(productMap[pid]?.mrp ?? productMap[pid]?.originalPrice ?? 0)

  // Prefer the live product doc's image over the wishlist item's own snapshot —
  // the item was frozen at the moment it was saved, so if the product's photo
  // was changed since, the snapshot would keep showing the old one forever.
  const liveImageOf = (item) => {
   const pid = pidOf(item)
   const live = productMap[pid]
   return (live && (live.thumbnail || live.image)) || item.thumbnail || item.image
  }

  /* ---------- DESKTOP handlers (reuse existing Redux actions) ---------- */
  const handleRemove = async (pid) => {
    dispatch(removeWishlist(pid)) // instant UI
    if (!user?.uid) return
    try {
      await removeWishlistItem(user.uid, pid)
    } catch (e) {
      console.log("wishlist remove persist failed:", e)
    }
  }

  const handleAddToCart = (item) => {
    const pid = pidOf(item)
    const qty = nextAddQuantity(cartItems, pid)
    dispatch(addCart(item))
    upsertCartItem(user?.uid, item, qty)
    toast.success("Added to cart")
  }

  const handleMoveAll = () => {
    const inStock = wishlistItems.filter((i) => stockInfo(pidOf(i)).status !== "OUT")
    if (!inStock.length) { toast.info("No in-stock items to move."); return }
    inStock.forEach((i) => {
      const pid = pidOf(i)
      const qty = nextAddQuantity(cartItems, pid)
      dispatch(addCart(i))
      upsertCartItem(user?.uid, i, qty)
      handleRemove(pid)
    })
    toast.success(`Moved ${inStock.length} item(s) to cart`)
    navigate("/cart")
  }

  const handleShare = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: "My Wishlist", url })
      else { await navigator.clipboard.writeText(url); toast.success("Wishlist link copied to clipboard!") }
    } catch { /* user dismissed the share sheet */ }
  }

  const handleNotify = async (pid) => {
    const uid = user?.uid
    if (!uid) { navigate("/login"); return }
    try {
      const { error } = await supabase.from("stock_alerts").insert({ product_id: String(pid), user_id: uid })
      if (error) throw error
      setAlertedIds((prev) => [...prev, String(pid)])
      toast.success("We'll notify you when it's back in stock")
    } catch (e) {
      console.log("stock alert failed:", e)
      toast.error("Could not set the alert")
    }
  }

  /* ============================================================
     MOBILE LAYOUT (≤640px) — shares all Redux state/handlers.
  ============================================================ */
  if (isMobile) {
    return (
      <div className="min-h-screen w-full" style={{ background: "var(--color-background)", fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
        {wishlistItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: "100vh", gap: "16px", padding: "96px 24px 0" }}>
            <ShoppingBag size={44} color="var(--color-border-strong)" />
            <p style={{ color: "var(--color-muted)", fontSize: "14px", fontWeight: 600 }}>Your wishlist is empty.</p>
            <button onClick={() => navigate("/products")} style={{ background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "14px", padding: "12px 24px", borderRadius: "9999px" }}>
              Explore Products
            </button>
          </div>
        ) : loadingProducts ? (
          <main className="grid grid-cols-2" style={{ gap: "16px", padding: "96px 20px 24px" }} aria-busy="true">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="relative bg-surface flex flex-col overflow-hidden"
                style={{ borderRadius: "12px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}
                aria-hidden="true"
              >
                {/* Image area */}
                <div style={{ background: "var(--color-surface-muted)", padding: "8px" }}>
                  <div
                    className="w-full aspect-square animate-pulse"
                    style={{ background: "var(--color-border)", borderRadius: "8px" }}
                  />
                </div>
                {/* Body */}
                <div className="flex flex-col flex-1" style={{ padding: "12px" }}>
                  <Skeleton className="h-3 w-1/2 mb-2" />
                  <Skeleton className="h-3.5 w-full mb-1" />
                  <Skeleton className="h-3.5 w-2/3" />
                  <div style={{ marginTop: "auto" }}>
                    <Skeleton className="h-5 w-20 mb-2" />
                    <Skeleton className="w-full h-9 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </main>
        ) : (
          <main className="grid grid-cols-2" style={{ gap: "16px", padding: "96px 20px 24px" }}>
            {wishlistItems.map((item) => {
              const pid = item.productId || item.id
              return (
                <div key={pid} className="relative bg-surface flex flex-col overflow-hidden" style={{ borderRadius: "12px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  <button
                    onClick={() => handleRemove(pid)}
                    aria-label="Remove from wishlist"
                    className="absolute z-20 flex items-center justify-center"
                    style={{ top: "12px", right: "12px", width: "32px", height: "32px", background: "color-mix(in srgb, var(--color-surface) 90%, transparent)", borderRadius: "9999px", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
                  >
                    <Trash2 size={15} color="var(--color-primary)" />
                  </button>

                  <div onClick={() => navigate(`/product/${pid}`)} className="w-full cursor-pointer" style={{ background: "var(--color-surface-muted)", padding: "8px" }}>
                    <div className="w-full aspect-square">
                      <img src={liveImageOf(item)} alt={item.title} loading="lazy" className="w-full h-full" style={{ objectFit: "cover", borderRadius: "8px" }} />
                    </div>
                  </div>

                  <div className="flex flex-col flex-1" style={{ padding: "12px" }}>
                    <div onClick={() => navigate(`/product/${pid}`)} className="cursor-pointer">
                      <p style={{ color: "var(--color-muted)", fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.6px" }}>{item.category}</p>
                      <h3 style={{ color: "var(--color-ink)", fontWeight: 700, fontSize: "14px", lineHeight: "18px", marginTop: "4px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.title}</h3>
                    </div>
                    <div style={{ marginTop: "auto" }}>
                      <span style={{ color: "var(--color-ink)", fontWeight: 600, fontSize: "18px" }}>{money(item.price)}</span>
                      <button
                        onClick={() => { handleAddToCart(item); navigate("/cart") }}
                        className="w-full flex items-center justify-center"
                        style={{ marginTop: "8px", height: "36px", borderRadius: "9999px", background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", gap: "6px" }}
                      >
                        <ShoppingBag size={14} /> Add to Cart
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </main>
        )}
      </div>
    )
  }

  return (
    <div className="hidden lg:block" style={{ background: "var(--color-surface-muted)", minHeight: "100vh", fontFamily: "Inter, sans-serif", color: "var(--color-ink)" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "48px 64px 80px" }}>

        {/* SECTION 1 — HEADER */}
        <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <div className="flex flex-col" style={{ gap: "8px" }}>
            <div className="flex items-center" style={{ gap: "8px" }}>
              <button onClick={() => navigate("/")} style={{ fontWeight: 500, fontSize: "12px", color: "var(--color-body)" }}>Home</button>
              <ChevronRight size={12} style={{ color: "var(--color-body)" }} />
              <span style={{ fontWeight: 500, fontSize: "12px", color: "var(--color-ink)" }}>Wishlist</span>
            </div>
            <h1 style={{ fontWeight: 700, fontSize: "48px", letterSpacing: "-0.96px", color: "var(--color-primary)", paddingTop: "8px" }}>My Wishlist</h1>
            <p style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>
              You have <strong className="font-bold">{wishlistItems.length}</strong> {wishlistItems.length === 1 ? "item" : "items"} saved for later.
            </p>
          </div>

          {wishlistItems.length > 0 && (
            <div className="flex" style={{ gap: "24px", alignItems: "flex-start" }}>
              <button onClick={handleShare} className="flex items-center" style={{ padding: "12px 24px", gap: "8px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px" }}>
                <Share2 size={16} style={{ color: "var(--color-body)" }} />
                <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>Share Wishlist</span>
              </button>
              <button onClick={handleMoveAll} className="flex items-center" style={{ padding: "13px 24px", gap: "8px", background: "var(--color-primary)", borderRadius: "8px", boxShadow: "0px 10px 15px -3px color-mix(in srgb, var(--color-accent) 20%, transparent)" }}>
                <ShoppingCart size={16} style={{ color: "var(--color-inverse)" }} />
                <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-inverse)" }}>Move All to Cart</span>
              </button>
            </div>
          )}
        </div>

        {/* SECTION 2 — WISHLIST GRID */}
        <div style={{ marginTop: "40px" }}>
          {wishlistItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ gap: "16px", padding: "80px 0" }}>
              <div className="flex items-center justify-center" style={{ width: "96px", height: "96px", borderRadius: "9999px", background: "var(--color-surface-muted)" }}>
                <ShoppingBag size={40} style={{ color: "var(--color-primary)" }} />
              </div>
              <h2 style={{ fontWeight: 700, fontSize: "22px", color: "var(--color-ink)" }}>Your wishlist is empty</h2>
              <p style={{ fontSize: "16px", color: "var(--color-body)" }}>Save items you love to find them here later.</p>
              <button onClick={() => navigate("/products")} style={{ background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "16px", padding: "14px 32px", borderRadius: "8px" }}>Explore Products</button>
            </div>
          ) : loadingProducts ? (
            <div className="grid grid-cols-4" style={{ gap: "24px" }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} className="animate-pulse" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px" }}>
                  <div style={{ height: "340px", background: "var(--color-border)", borderRadius: "8px 8px 0 0" }} />
                  <div style={{ padding: "24px" }}>
                    <div style={{ height: "12px", width: "50%", background: "var(--color-border)", borderRadius: "4px", marginBottom: "10px" }} />
                    <div style={{ height: "14px", width: "80%", background: "var(--color-border)", borderRadius: "4px", marginBottom: "14px" }} />
                    <div style={{ height: "18px", width: "40%", background: "var(--color-border)", borderRadius: "4px", marginBottom: "14px" }} />
                    <div style={{ height: "48px", background: "var(--color-border)", borderRadius: "4px" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4" style={{ gap: "24px" }}>
              {wishlistItems.map((item) => {
                const pid = pidOf(item)
                const info = stockInfo(pid)
                const out = info.status === "OUT"
                const mrp = mrpOf(pid)
                const img = liveImageOf(item)
                const notified = alertedIds.includes(String(pid))
                return (
                  <div key={pid} className="group flex flex-col" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", isolation: "isolate" }}>
                    {/* IMAGE AREA */}
                    <div className="relative" style={{ height: "340px", background: "var(--color-border)", overflow: "hidden", borderRadius: "8px 8px 0 0" }}>
                      {img && (
                        <img src={img} alt={item.title} onClick={() => navigate(`/product/${pid}`)} className="cursor-pointer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      )}
                      {out && (
                        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "var(--color-overlay)" }}>
                          <span style={{ background: "var(--color-surface)", borderRadius: "12px", padding: "8px 16px", fontWeight: 700, fontSize: "12px", letterSpacing: "1.2px", textTransform: "uppercase", color: "var(--color-ink)", boxShadow: "0px 4px 12px rgba(0,0,0,0.15)" }}>Out of Stock</span>
                        </div>
                      )}
                      {!out && info.status === "IN" && (
                        <span className="absolute" style={{ left: "12px", bottom: "12px", background: "var(--color-success-subtle)", borderRadius: "2px", padding: "2.5px 8px", fontWeight: 700, fontSize: "10px", textTransform: "uppercase", color: "var(--color-success)" }}>In Stock</span>
                      )}
                      {!out && info.status === "LOW" && (
                        <span className="absolute" style={{ left: "12px", bottom: "12px", background: "var(--color-accent-subtle)", borderRadius: "2px", padding: "2.5px 8px", fontWeight: 700, fontSize: "10px", textTransform: "uppercase", color: "var(--color-accent-strong)" }}>Only {info.left} Left</span>
                      )}
                      <button onClick={() => handleRemove(pid)} aria-label="Remove from wishlist" className="absolute opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity" style={{ top: "13px", right: "13px", width: "28px", height: "34px", background: "color-mix(in srgb, var(--color-surface) 90%, transparent)", backdropFilter: "blur(4px)", borderRadius: "12px" }}>
                        <X size={12} style={{ color: "var(--color-error)" }} />
                      </button>
                    </div>

                    {/* BODY */}
                    <div className="flex flex-col" style={{ padding: "24px", gap: "8px" }}>
                      <span style={{ fontWeight: 400, fontSize: "16px", letterSpacing: "1.6px", textTransform: "uppercase", color: "var(--color-muted)" }}>{item.brand || item.category || "PRODUCT"}</span>
                      <span className="line-clamp-1" style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-ink)" }}>{item.title}</span>
                      <div className="flex items-center" style={{ gap: "8px" }}>
                        <span style={{ fontWeight: 700, fontSize: "18px", color: "var(--color-primary)" }}>{money(item.price)}</span>
                        {mrp > Number(item.price) && (
                          <span style={{ fontWeight: 400, fontSize: "14px", color: "var(--color-body)", textDecoration: "line-through" }}>{money(mrp)}</span>
                        )}
                      </div>
                      {out ? (
                        <button onClick={() => handleNotify(pid)} disabled={notified} className="w-full flex items-center justify-center" style={{ height: "48px", padding: "12px 0", borderRadius: "4px", gap: "8px", background: "var(--color-border-strong)", opacity: notified ? 0.7 : 1 }}>
                          <Bell size={15} style={{ color: "var(--color-body)" }} />
                          <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>{notified ? "Notified" : "Notify Me"}</span>
                        </button>
                      ) : (
                        <button onClick={() => handleAddToCart(item)} className="w-full flex items-center justify-center" style={{ height: "48px", padding: "12px 0", borderRadius: "4px", gap: "8px", background: "var(--color-primary)" }}>
                          <ShoppingCart size={15} style={{ color: "var(--color-inverse)" }} />
                          <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-inverse)" }}>Add to Cart</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* SECTION 3 — RECOMMENDATIONS */}
        {wishlistItems.length > 0 && (
          <div className="flex flex-col" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "64px", marginTop: "64px", gap: "40px" }}>
            <div className="flex" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-ink)" }}>Recommended For You</h2>
              <button onClick={() => navigate("/products")} className="flex items-center" style={{ gap: "6px" }}>
                <span style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-primary)" }}>View Catalog</span>
                <ArrowRight size={12} style={{ color: "var(--color-primary)" }} />
              </button>
            </div>
            <div className="flex" style={{ gap: "24px", overflowX: "auto" }}>
              {loadingRec ? (
                [...Array(4)].map((_, i) => (
                  <div key={i} className="animate-pulse" style={{ minWidth: "280px", width: "280px", padding: "12px", background: "color-mix(in srgb, var(--color-surface-muted) 50%, transparent)", borderRadius: "8px" }}>
                    <div style={{ width: "100%", height: "254px", background: "var(--color-border)", borderRadius: "4px", marginBottom: "10px" }} />
                    <div style={{ height: "14px", width: "70%", background: "var(--color-border)", borderRadius: "4px", marginBottom: "8px" }} />
                    <div style={{ height: "14px", width: "40%", background: "var(--color-border)", borderRadius: "4px" }} />
                  </div>
                ))
              ) : recommended.length === 0 ? (
                <p style={{ fontSize: "14px", color: "var(--color-body)" }}>No recommendations right now.</p>
              ) : (
                recommended.map((p) => (
                  <button key={p.id} onClick={() => navigate(`/product/${p.id}`)} className="flex flex-col text-left" style={{ minWidth: "280px", width: "280px", padding: "12px", gap: "4px", background: "color-mix(in srgb, var(--color-surface-muted) 50%, transparent)", borderRadius: "8px" }}>
                    {(p.thumbnail || p.image) ? (
                      <img src={p.thumbnail || p.image} alt={p.title || p.name} style={{ width: "100%", height: "254px", objectFit: "cover", borderRadius: "4px" }} />
                    ) : (
                      <div style={{ width: "100%", height: "254px", background: "var(--color-border)", borderRadius: "4px" }} />
                    )}
                    <span className="line-clamp-1" style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-ink)" }}>{p.title || p.name}</span>
                    <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-primary)" }}>{money(p.price)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WishlistPage