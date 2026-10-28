import { useEffect, useState, useRef } from "react"

import { supabase } from "../../context/SupabaseConfig"
import { mapOrderRows, resolveOrderItemImage } from "../../utils/supabaseOrders"
import { queryOrdersWithShipments } from "../../services/shipping"
import { buyAgain } from "../../features/orders/buyAgain"
import { useSelector, useDispatch } from "react-redux"
import { useNavigate } from "react-router-dom"
import { Archive, Star, X, CheckCircle2, Download, Package } from "lucide-react"
import { generateInvoice } from "../../utils/generateInvoice"
import { submitReview as submitReviewApi } from "../../utils/reviews"
import { saveReviewPhotos } from "../../utils/reviewsPlus"
import ReviewPhotoPicker from "../../components/Reviews/ReviewPhotoPicker"
import UserOrderCard, { orderNo } from "../../features/orders/UserOrderCard"
import Pagination from "../../components/Pagination"
import useIsMobile from "../../hooks/useIsMobile"
import { toast } from "react-toastify"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import OrderCardSkeleton from "../../features/orders/OrderCardSkeleton"
import { returnsService } from "../../services/returns"
import { requestSummaryLine } from "../../features/returns/requestModel"

const UserPastOrdersPage = () => {

  const user = useSelector((state) => state.user.user)
  const cartItems = useSelector((state) => state.cart.cartItems)
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const isMobile = useIsMobile(1024)
  const [requestsByOrder, setRequestsByOrder] = useState({}) // orderId -> the customer's newest return / exchange request for it

  const [userData, setUserData] = useState(null)
  const [orders, setOrders] = useState([])       // delivered-only (mobile)
  const [allOrders, setAllOrders] = useState([]) // all past: delivered + cancelled (desktop tabs)
  const [activeTab, setActiveTab] = useState("ALL")
  const [loading, setLoading] = useState(true)

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)

  // Review modal
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [hoverRating, setHoverRating] = useState(0)
  // Photos for the open modal: `kept` = storage paths already on the review (edit), `files` = newly chosen.
  const [photoDraft, setPhotoDraft] = useState({ kept: [], files: [] })
  const [submitting, setSubmitting] = useState(false)

  // Reviews keyed by `${orderId}_${productId}` for per-order isolation
  const [userReviews, setUserReviews] = useState({})

  const containerRef = useRef(null)


  /* ---------------- FETCH USER ---------------- */

  useEffect(() => {
    const fetchUser = async () => {
      if (!user?.uid) return
      const { data } = await supabase.from("profiles").select("*").eq("id", user.uid).single()
      if (data) setUserData(data)
    }
    fetchUser()
  }, [user])


  /* ---------------- RETURN / EXCHANGE REQUESTS (one status line per order) ---------------- */
  useEffect(() => {
    let alive = true
    if (!user?.uid) return undefined
    returnsService.listMine()
      .then((list) => {
        if (!alive) return
        const map = {}
        for (const r of list) if (!map[r.orderId]) map[r.orderId] = r      // newest first
        setRequestsByOrder(map)
      })
      .catch(() => { /* the status line is a convenience; the order page shows the full state */ })
    return () => { alive = false }
  }, [user?.uid])

  /* ---------------- FETCH COMPLETED ORDERS ---------------- */

  useEffect(() => {
    const fetchOrders = async () => {
      if (!user?.uid) return
      setLoading(true)
      try {
        const { data: rows, error } = await queryOrdersWithShipments(
          (select) => supabase.from("orders").select(select).eq("user_id", user.uid)
        )
        if (error) throw error

        const toJsDate = (v) => {
          if (!v) return null
          if (v?.toDate) return v.toDate()
          if (v?.seconds) return new Date(v.seconds * 1000)
          const d = new Date(v)
          return isNaN(d.getTime()) ? null : d
        }

        // Past orders = delivered + cancelled
        const rawOrders = mapOrderRows(rows).filter((o) => {
          const s = (o.orderStatus || "").toLowerCase()
          return ["delivered", "cancelled"].includes(s)
        })

        const productIds = [...new Set(rawOrders.flatMap((order) => (order.products || []).map((item) => item.productId)).filter(Boolean))]
        let productById = {}
        if (productIds.length) {
          const { data: pRows } = await supabase.from("products").select("id, thumbnail, image, category, stock, variants").in("id", productIds)
          ;(pRows || []).forEach((p) => { productById[p.id] = p })
        }
        const enrichedOrders = rawOrders.map((order) => ({
          ...order,
          products: (order.products || []).map((item) => {
            const pd = item.productId ? productById[item.productId] : null
            if (!pd) return item
            const img = resolveOrderItemImage(item, pd)
            return {
              ...item,
              thumbnail: img,
              image: img,
              category: pd.category || "general",
              stock: pd.stock || 0,
            }
          }),
        }))

        const sortedOrders = enrichedOrders.sort((a, b) => {
          const ta = toJsDate(a.createdAt)?.getTime() ?? 0
          const tb = toJsDate(b.createdAt)?.getTime() ?? 0
          return tb - ta
        })

        setAllOrders(sortedOrders)
        setOrders(sortedOrders.filter((o) => (o.orderStatus || "").toLowerCase() === "delivered"))
      } catch (error) {
        console.error("Error fetching past orders:", error)
        setAllOrders([])
        setOrders([])
      } finally {
        setLoading(false)
      }
    }
    fetchOrders()
  }, [user])


  /* ---------------- FETCH USER REVIEWS ---------------- */

  useEffect(() => {
    const fetchUserReviews = async () => {
      if (!user?.uid) return
      try {
        const { data: rows, error } = await supabase.from("reviews").select("*").eq("user_id", user.uid)
        if (error) throw error
        const reviewsMap = {}
          ; (rows || []).forEach((data) => {
            // Per-order key: orderId_productId — each order has its own independent review
            if (data.order_id && data.product_id) {
              reviewsMap[`${data.order_id}_${data.product_id}`] = {
                id: data.id,
                orderId: data.order_id,
                productId: data.product_id,
                rating: data.rating,
                comment: data.comment || "",
                photos: data.photos || []
              }
            }
          })
        setUserReviews(reviewsMap)
      } catch (error) {
        console.error("Error fetching reviews:", error)
      }
    }
    fetchUserReviews()
  }, [user])


  /* ---------------- OPEN REVIEW MODAL ---------------- */

  const openReviewModal = (product, orderId) => {
    setSelectedProduct(product)
    setSelectedOrderId(orderId)
    // Strict per-order lookup: each order has its own independent review
    const existing = userReviews && userReviews[`${orderId}_${product.productId}`]
    if (existing) {
      setRating(existing.rating)
      setComment(existing.comment || "")
    } else {
      setRating(0)
      setComment("")
    }
    setPhotoDraft({ kept: existing?.photos || [], files: [] })
  }


  /* ---------------- SUBMIT REVIEW ---------------- */

  const submitReview = async () => {
    if (!rating) {
      toast.error("Please add a rating")
      return
    }
    setSubmitting(true)
    try {
      const { reviewId } = await submitReviewApi({
        orderId: selectedOrderId,
        productId: selectedProduct.productId,
        productTitle: selectedProduct.title,
        rating: Number(rating),
        comment: comment || "",
      })

      // Photos are attached after the review exists; losing them must not fail the review.
      // An empty final list is sent too when the user removed every existing photo.
      const key = `${selectedOrderId}_${selectedProduct.productId}`
      const previous = userReviews[key]?.photos || []
      let photos = previous
      let photosFailed = false
      if (photoDraft.files.length > 0 || photoDraft.kept.length !== previous.length) {
        try {
          photos = await saveReviewPhotos({
            userId: user.uid,
            orderId: selectedOrderId,
            productId: selectedProduct.productId,
            reviewId,
            keep: photoDraft.kept,
            files: photoDraft.files,
            previous,
          })
        } catch (photoError) {
          console.error("Review photo error:", photoError)
          photosFailed = true
        }
      }

      // Update local state with the new per-order review
      setUserReviews(prev => ({
        ...prev,
        [key]: {
          id: reviewId,
          orderId: selectedOrderId,
          productId: selectedProduct.productId,
          rating: Number(rating),
          comment: comment || "",
          photos
        }
      }))
      setSelectedProduct(null)
      setSelectedOrderId(null)
      setRating(0)
      setComment("")
      setPhotoDraft({ kept: [], files: [] })
      if (photosFailed) toast.warn("Review submitted, but the photos couldn't be uploaded.")
      else toast.success("Your review has been submitted.")
    } catch (error) {
      console.error("Review error:", error)
      toast.error(error.message || "Could not submit review. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  useGSAP(() => {
    if (isMobile) return
    if (gsap.utils.toArray(".order-card").length > 0) {
      gsap.from(".order-card", {
        y: 30,
        opacity: 0,
        stagger: 0.1,
        duration: 0.8,
        ease: "power3.out",
        clearProps: "opacity,transform"
      })
    }
    if (gsap.utils.toArray(".header-text").length > 0) {
      gsap.from(".header-text", {
        x: -50,
        opacity: 0,
        duration: 1.2,
        ease: "power4.out"
      })
    }
  }, { scope: containerRef, dependencies: [orders, loading, isMobile] })


  /* ============================================================
     DESKTOP TABS + HELPERS
  ============================================================ */
  const TABS = [
    { key: "ALL", label: "All Past Orders" },
    { key: "DELIVERED", label: "Delivered" },
    { key: "CANCELLED", label: "Cancelled" },
  ]
  const tabFilter = (o) => {
    const s = (o.orderStatus || "").toLowerCase()
    if (activeTab === "DELIVERED") return s === "delivered"
    if (activeTab === "CANCELLED") return s === "cancelled"
    return true
  }
  const desktopOrders = allOrders.filter(tabFilter)

  // Reset to first page when tab changes
  useEffect(() => { setPage(1) }, [activeTab])

  const mobileTotal = orders.length
  const desktopTotal = desktopOrders.length
  const pagedMobileOrders = orders.slice((page - 1) * pageSize, page * pageSize)
  const pagedDesktopOrders = desktopOrders.slice((page - 1) * pageSize, page * pageSize)

  // Clamp page if total shrinks
  useEffect(() => {
    const total = isMobile ? mobileTotal : desktopTotal
    const tp = Math.max(1, Math.ceil(total / pageSize))
    if (page > tp) setPage(tp)
  }, [isMobile, mobileTotal, desktopTotal, pageSize, page])

  // Re-adds the SAME option that was bought (main product or the specific variant) at the ordered quantity, at today's
  // price and stock — one implementation shared by all "Buy again" buttons (features/orders/buyAgain.js).
  const handleBuyAgain = async (o) => {
    try {
      const r = await buyAgain({ orderLines: o.products, cartItems, dispatch, uid: user?.uid })
      if (!r.added) { toast.error(r.message || "Nothing could be added to your cart"); return }
      if (r.skipped.length) toast.info(r.message); else toast.success(r.message)
      navigate("/cart")
    } catch (e) {
      console.error("buy again:", e)
      toast.error("Could not add these items to your cart")
    }
  }
  const handleViewDetails = (o) => navigate(`/order/${o.id}`)

  // Helper to look up per-order review from map — strict per-order, no cross-order fallback
  const getReview = (orderId, productId) => {
    return userReviews && userReviews[`${orderId}_${productId}`]
  }


  /* ============================================================
     MOBILE LAYOUT (≤1024px)
  ============================================================ */
  if (isMobile) {
    return (
      <div className="min-h-screen w-full" style={{ background: "var(--color-background)", fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
        <main style={{ padding: "96px 20px 24px" }}>
          {loading ? (
            <div className="flex flex-col" style={{ gap: "16px" }}>
              {[...Array(3)].map((_, i) => <OrderCardSkeleton key={i} />)}
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: "60vh", gap: "16px" }}>
              <Archive size={44} color="var(--color-border-strong)" />
              <p style={{ color: "var(--color-muted)", fontSize: "14px", fontWeight: 600 }}>No past orders yet.</p>
              <button onClick={() => navigate("/products")} style={{ background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "14px", padding: "12px 24px", borderRadius: "9999px" }}>
                Start Shopping
              </button>
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: "16px" }}>
              {pagedMobileOrders.map((order) => (
                <div key={order.id} className="bg-surface" style={{ borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  <div className="flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-surface-muted)", paddingBottom: "12px", marginBottom: "12px", gap: "8px" }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: "10px", color: "var(--color-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.6px" }}>Order</span>
                      <p style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-ink)" }}>#{orderNo(order)}</p>
                      {requestsByOrder[order.id] ? <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-info)" }}>{requestSummaryLine(requestsByOrder[order.id])}</p> : null}
                      {order.orderStatus === "delivered" ? <button onClick={() => navigate(`/order/${order.id}`)} style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-link)" }}>Return / Exchange</button> : null}
                    </div>
                    <div className="flex items-center flex-shrink-0" style={{ gap: "10px" }}>
                      <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--color-primary)" }}>₹{Number(order.total).toFixed(2)}</span>
                      <span className="flex items-center" style={{ gap: "4px", padding: "4px 10px", borderRadius: "9999px", fontSize: "10px", fontWeight: 600, background: "var(--color-success-subtle)", color: "var(--color-primary)" }}>
                        <CheckCircle2 size={10} /> Delivered
                      </span>
                      <button
                        onClick={() => generateInvoice(order, { name: order.userName || userData?.name, email: order.userEmail || userData?.email, phone: order.userPhone || userData?.phone, address: order.address || order.shippingAddress })}
                        aria-label="Download invoice"
                        className="flex items-center justify-center"
                        style={{ width: "28px", height: "28px", borderRadius: "8px", background: "var(--color-ink)", color: "var(--color-inverse)" }}
                      >
                        <Download size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col" style={{ gap: "10px" }}>
                    {order.products?.map((item, index) => {
                      const rev = getReview(order.id, item.productId)
                      return (
                        <div key={index} className="flex items-center justify-between" style={{ gap: "10px" }}>
                          <div className="flex items-center" style={{ gap: "10px", minWidth: 0 }}>
                            <div className="flex-shrink-0 flex items-center justify-center" style={{ width: "44px", height: "44px", background: "var(--color-surface-muted)", borderRadius: "8px", padding: "4px" }}>
                              <img src={item.thumbnail || item.image || "https://via.placeholder.com/64"} alt="" className="w-full h-full" style={{ objectFit: "cover", borderRadius: "4px" }} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <h4 style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</h4>
                              <p style={{ fontSize: "11px", color: "var(--color-muted)" }}>Qty: {item.quantity}</p>
                            </div>
                          </div>
                          {rev ? (
                            <button onClick={() => openReviewModal(item, order.id)} className="flex items-center flex-shrink-0" style={{ gap: "4px", fontSize: "11px", fontWeight: 700, color: "var(--color-primary)", background: "transparent", border: "none", cursor: "pointer" }}>
                              <div className="flex items-center" style={{ gap: "2px", marginRight: "4px" }}>
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <Star key={star} size={10} style={{ fill: rev.rating >= star ? "var(--color-chart-gold)" : "none", color: rev.rating >= star ? "var(--color-chart-gold)" : "var(--color-border-strong)" }} />
                                ))}
                              </div>
                              <span style={{ fontSize: "10px", fontWeight: 600 }}>(Edit)</span>
                            </button>
                          ) : (
                            <button onClick={() => openReviewModal(item, order.id)} className="flex items-center flex-shrink-0" style={{ gap: "4px", fontSize: "11px", fontWeight: 700, color: "var(--color-primary)", background: "transparent", border: "none", cursor: "pointer" }}>
                              <Star size={12} /> Review
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {mobileTotal > pageSize && (
                <Pagination
                  total={mobileTotal}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
                  pageSizeOptions={[5, 10, 25]}
                />
              )}
            </div>
          )}
        </main>

        {/* MOBILE REVIEW MODAL (bottom sheet) */}
        {selectedProduct && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center" style={{ background: "var(--color-overlay)" }} onClick={() => setSelectedProduct(null)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full bg-surface" style={{ borderRadius: "16px 16px 0 0", padding: "20px", fontFamily: "Inter, sans-serif", maxHeight: "90vh", overflowY: "auto" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
                <h2 style={{ fontWeight: 700, fontSize: "18px", color: "var(--color-ink)" }}>Write a Review</h2>
                <button onClick={() => setSelectedProduct(null)} aria-label="Close"><X size={20} color="var(--color-muted)" /></button>
              </div>
              <p style={{ fontSize: "13px", color: "var(--color-muted)", marginBottom: "16px" }}>{selectedProduct.title}</p>
              <div className="flex" style={{ gap: "8px", marginBottom: "16px" }}>
                {[1, 2, 3, 4, 5].map((star) => {
                  const on = (hoverRating || rating) >= star
                  return (
                    <button key={star} onClick={() => setRating(star)} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)} className="active:scale-90" style={{ transition: "transform 0.15s" }}>
                      <Star size={30} style={{ fill: on ? "var(--color-chart-gold)" : "none", color: on ? "var(--color-chart-gold)" : "var(--color-border-strong)" }} />
                    </button>
                  )
                })}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share your thoughts about this product…"
                style={{ width: "100%", height: "96px", background: "var(--color-surface-muted)", borderRadius: "12px", padding: "12px", fontSize: "14px", color: "var(--color-ink)", border: "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)", resize: "none", outline: "none", fontFamily: "Inter, sans-serif" }}
              />
              <ReviewPhotoPicker initialPhotos={photoDraft.kept} onChange={setPhotoDraft} disabled={submitting} />
              <button onClick={submitReview} disabled={submitting} className="w-full flex items-center justify-center" style={{ marginTop: "16px", height: "48px", background: "var(--color-primary)", borderRadius: "9999px", color: "var(--color-inverse)", fontWeight: 700, fontSize: "16px", opacity: submitting ? 0.6 : 1 }}>
                {submitting ? "Submitting…" : "Submit Review"}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }


  /* ============================================================
     DESKTOP LAYOUT (≥1024px)
  ============================================================ */
  return (
    <div ref={containerRef} className="hidden lg:block" style={{ background: "var(--color-background)", minHeight: "100vh", fontFamily: "Inter, sans-serif", color: "var(--color-ink)" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "48px 40px 80px" }}>

        {/* HEADER */}
        <div className="header-text flex flex-col" style={{ gap: "4px", paddingBottom: "8px" }}>
          <h1 style={{ fontWeight: 700, fontSize: "36px", letterSpacing: "-0.72px", color: "var(--color-ink)" }}>My Orders</h1>
          <p style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>Your order history — all past purchases.</p>
        </div>

        {/* FILTER TABS */}
        <div className="flex" style={{ borderBottom: "1px solid var(--color-border)", gap: "16px", paddingBottom: "4px", marginTop: "24px" }}>
          {TABS.map((t) => {
            const act = activeTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{ padding: "8px 16px", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: act ? "var(--color-primary)" : "var(--color-body)", borderBottom: act ? "2px solid var(--color-primary)" : "2px solid transparent", marginBottom: "-5px" }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* ORDER CARDS */}
        <div className="flex flex-col" style={{ gap: "24px", marginTop: "24px" }}>
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse flex" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "4px", padding: "24px", gap: "24px" }}>
                <div className="flex flex-col" style={{ gap: "16px", flexGrow: 1 }}>
                  <div style={{ height: "14px", width: "120px", background: "var(--color-border)", borderRadius: "4px" }} />
                  <div style={{ height: "22px", width: "180px", background: "var(--color-border)", borderRadius: "4px" }} />
                  <div className="flex" style={{ gap: "16px" }}>
                    <div style={{ width: "64px", height: "64px", background: "var(--color-border)", borderRadius: "4px" }} />
                    <div style={{ height: "16px", width: "160px", background: "var(--color-border)", borderRadius: "4px", marginTop: "12px" }} />
                  </div>
                </div>
                <div className="flex flex-col" style={{ gap: "8px", width: "180px" }}>
                  <div style={{ height: "48px", background: "var(--color-border)", borderRadius: "4px" }} />
                  <div style={{ height: "50px", background: "var(--color-border)", borderRadius: "4px" }} />
                </div>
              </div>
            ))
          ) : desktopOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ gap: "16px", padding: "80px 0", border: "1px dashed var(--color-border)", borderRadius: "8px", background: "var(--color-surface)" }}>
              <Package size={44} style={{ color: "var(--color-border)" }} />
              <p style={{ fontWeight: 700, fontSize: "18px", color: "var(--color-ink)" }}>No past orders yet</p>
              <p style={{ fontSize: "14px", color: "var(--color-body)" }}>When you complete orders, they'll appear here.</p>
              <button onClick={() => navigate("/products")} style={{ background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", padding: "14px 28px", borderRadius: "4px" }}>Start Shopping</button>
            </div>
          ) : (
            pagedDesktopOrders.map((order) => (
              <UserOrderCard key={order.id} order={order} returnRequest={requestsByOrder[order.id]} onBuyAgain={handleBuyAgain} onViewDetails={handleViewDetails} onReviewClick={openReviewModal} userReviews={userReviews} />
            ))
          )}
        </div>

        {/* PAGINATION */}
        {!loading && desktopTotal > pageSize && (
          <Pagination
            total={desktopTotal}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            pageSizeOptions={[5, 10, 25]}
          />
        )}
      </div>

      {/* DESKTOP REVIEW MODAL */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "var(--color-overlay)" }} onClick={() => setSelectedProduct(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface" style={{ borderRadius: "16px", padding: "24px", fontFamily: "Inter, sans-serif", boxShadow: "0 10px 25px rgba(0,0,0,0.1)", maxHeight: "90vh", overflowY: "auto" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
              <h2 style={{ fontWeight: 700, fontSize: "18px", color: "var(--color-ink)" }}>Write a Review</h2>
              <button onClick={() => setSelectedProduct(null)} aria-label="Close"><X size={20} color="var(--color-muted)" /></button>
            </div>
            <p style={{ fontSize: "13px", color: "var(--color-muted)", marginBottom: "16px" }}>{selectedProduct.title}</p>
            <div className="flex" style={{ gap: "8px", marginBottom: "16px" }}>
              {[1, 2, 3, 4, 5].map((star) => {
                const on = (hoverRating || rating) >= star
                return (
                  <button key={star} onClick={() => setRating(star)} onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)} className="active:scale-90" style={{ transition: "transform 0.15s" }}>
                    <Star size={30} style={{ fill: on ? "var(--color-chart-gold)" : "none", color: on ? "var(--color-chart-gold)" : "var(--color-border-strong)" }} />
                  </button>
                )
              })}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your thoughts about this product…"
              style={{ width: "100%", height: "96px", background: "var(--color-surface-muted)", borderRadius: "12px", padding: "12px", fontSize: "14px", color: "var(--color-ink)", border: "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)", resize: "none", outline: "none", fontFamily: "Inter, sans-serif" }}
            />
            <ReviewPhotoPicker initialPhotos={photoDraft.kept} onChange={setPhotoDraft} disabled={submitting} />
            <button onClick={submitReview} disabled={submitting} className="w-full flex items-center justify-center" style={{ marginTop: "16px", height: "48px", background: "var(--color-primary)", borderRadius: "9999px", color: "var(--color-inverse)", fontWeight: 700, fontSize: "16px", opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "Submitting…" : "Submit Review"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default UserPastOrdersPage