import { useEffect, useState, useRef } from "react"

import { supabase } from "../../context/SupabaseConfig"
import { mapOrderRows, resolveOrderItemImage } from "../../utils/supabaseOrders"
import { queryOrdersWithShipments } from "../../services/shipping"
import { buyAgain } from "../../features/orders/buyAgain"
import { useSelector, useDispatch } from "react-redux"
import { useNavigate } from "react-router-dom"
import { Package, Clock, Star, MessageSquare, X, CheckCircle2, ArrowLeft, Download, Truck, XCircle, RotateCcw } from "lucide-react"
import { generateInvoice } from "../../utils/generateInvoice"
import { submitReview as submitReviewApi } from "../../utils/reviews"
import { saveReviewPhotos } from "../../utils/reviewsPlus"
import ReviewPhotoPicker from "../../components/Reviews/ReviewPhotoPicker"
import { formatCurrency } from "../../utils/pricing"
import UserOrderCard, { orderNo } from "../../features/orders/UserOrderCard"
import Pagination from "../../components/Pagination"
import useIsMobile from "../../hooks/useIsMobile"
import { toast } from "react-toastify"
import gsap from "gsap"
import { useGSAP } from "@gsap/react";
import OrderCardSkeleton from "../../features/orders/OrderCardSkeleton"

// Statuses that represent an order that is still in-progress (not yet
// delivered or cancelled).  Comparison is done after lowercasing so
// mixed-case values from Firestore are handled correctly.
const ONGOING_STATUSES = new Set(["placed", "confirmed", "shipped"])

// Safely convert a Firestore Timestamp, ISO string, or Date to a JS Date.
const toJsDate = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

const UserOrdersPage = () => {

  const user = useSelector((state) => state.user.user)
  const cartItems = useSelector((state) => state.cart.cartItems)
  const dispatch = useDispatch()
  const navigate = useNavigate()
  // Mobile design renders below `lg`; the desktop redesign at lg+.
  const isMobile = useIsMobile(1024)

  const [userData, setUserData] = useState(null)
  const [orders, setOrders] = useState([])   // ongoing only, newest-first
  const [loading, setLoading] = useState(true)

  // pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)

  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedOrderId, setSelectedOrderId] = useState(null)

  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [hoverRating, setHoverRating] = useState(0)
  const [userReviews, setUserReviews] = useState([])
  const [photoDraft, setPhotoDraft] = useState({ kept: [], files: [] })
  const [submitting, setSubmitting] = useState(false)

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


  /* ---------------- FETCH USER ORDERS ---------------- */

  useEffect(() => {
    const fetchOrders = async () => {
      if (!user?.uid) return
      setLoading(true)
      try {
        const { data: rows, error } = await queryOrdersWithShipments(
          (select) => supabase.from("orders").select(select).eq("user_id", user.uid)
        )
        if (error) throw error
        const rawOrders = mapOrderRows(rows)

        const productIds = [...new Set(rawOrders.flatMap((o) => (o.products || []).map((p) => p.productId)).filter(Boolean))]
        let productById = {}
        if (productIds.length) {
          const { data: pRows } = await supabase.from("products").select("id, thumbnail, image, variants").in("id", productIds)
          ;(pRows || []).forEach((p) => { productById[p.id] = p })
        }
        const enrichedOrders = rawOrders.map((order) => ({
          ...order,
          products: (order.products || []).map((item) => {
            const p = productById[item.productId]
            const img = resolveOrderItemImage(item, p)
            return img ? { ...item, thumbnail: img, image: img } : item
          }),
        }))

        const ongoingOrders = enrichedOrders
          .filter((o) => ONGOING_STATUSES.has((o.orderStatus || "").toLowerCase()))
          .sort((a, b) => {
            const ta = toJsDate(a.createdAt)?.getTime() ?? 0
            const tb = toJsDate(b.createdAt)?.getTime() ?? 0
            return tb - ta
          })

        setOrders(ongoingOrders)
      } catch (error) {
        console.error("Error fetching orders:", error)
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
        const { data: rows, error } = await supabase.from("reviews").select("product_id").eq("user_id", user.uid)
        if (error) throw error
        // Track reviewed products (server allows one review per product per user).
        const reviewedProductIds = (rows || []).map((r) => r.product_id).filter(Boolean)
        setUserReviews(reviewedProductIds)
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
    setPhotoDraft({ kept: [], files: [] })
  }


  /* ---------------- SUBMIT REVIEW ---------------- */

  const submitReview = async () => {
    if (!rating || !comment) {
      toast.error("Please add rating and comment")
      return
    }

    setSubmitting(true)
    try {
      // The Edge Function rejects a review without its order ("Missing order").
      const { reviewId } = await submitReviewApi({
        orderId: selectedOrderId,
        productId: selectedProduct.productId,
        productTitle: selectedProduct.title,
        rating: Number(rating),
        comment,
      })

      // Photos are attached after the review exists; losing them must not fail the review.
      let photosFailed = false
      if (photoDraft.files.length > 0) {
        try {
          await saveReviewPhotos({ userId: user.uid, orderId: selectedOrderId, productId: selectedProduct.productId, reviewId, files: photoDraft.files })
        } catch (photoError) {
          console.error("Review photo error:", photoError)
          photosFailed = true
        }
      }

      setUserReviews(prev => [...prev, selectedProduct.productId])
      setSelectedProduct(null)
      setSelectedOrderId(null)
      setRating(0)
      setComment("")
      setPhotoDraft({ kept: [], files: [] })
      if (photosFailed) toast.warn("Review submitted, but the photos couldn't be uploaded.")
      else toast.success("Broadcast successful! Your feedback has been deployed.")
    } catch (error) {
      console.error("Review error:", error)
      toast.error(error.message || "Transmission failed. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  useGSAP(() => {
    if (isMobile) return;
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

  /* ---------------- HANDLERS ---------------- */
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

  /* ---------------- PAGINATION ---------------- */
  const totalOrders = orders.length
  const pagedOrders = orders.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => {
    const tp = Math.max(1, Math.ceil(totalOrders / pageSize))
    if (page > tp) setPage(tp)
  }, [totalOrders, pageSize, page])

  /* ---------------- UI ---------------- */

  /* ============================================================
     MOBILE LAYOUT (≤640px) — shares all data/handlers above.
  ============================================================ */
  if (isMobile) {
    const statusStyles = {
      placed: { background: "var(--color-accent-subtle)", color: "var(--color-accent-strong)" },
      confirmed: { background: "var(--color-info-subtle)", color: "var(--color-info)" },
      shipped: { background: "var(--color-accent-subtle)", color: "var(--color-accent-strong)" },
      delivered: { background: "var(--color-success-subtle)", color: "var(--color-primary)" },
    }
    return (
      <div className="min-h-screen w-full" style={{ background: "var(--color-background)", fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
        <main style={{ padding: "96px 20px 24px" }}>
          {loading ? (
            <div className="flex flex-col" style={{ gap: "16px" }}>
              {[...Array(3)].map((_, i) => <OrderCardSkeleton key={i} />)}
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: "60vh", gap: "16px" }}>
              <Package size={44} color="var(--color-border-strong)" />
              <p style={{ color: "var(--color-muted)", fontSize: "14px", fontWeight: 600 }}>No active orders yet.</p>
              <button onClick={() => navigate("/products")} style={{ background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "14px", padding: "12px 24px", borderRadius: "9999px" }}>
                Start Shopping
              </button>
            </div>
          ) : (
            <div className="flex flex-col" style={{ gap: "16px" }}>
              {pagedOrders.map((order) => {
                const badge = statusStyles[order.orderStatus] || { background: "var(--color-surface-muted)", color: "var(--color-body)" }
                return (
                  <div key={order.id} className="bg-surface" style={{ borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                    <div className="flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-surface-muted)", paddingBottom: "12px", marginBottom: "12px", gap: "8px" }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: "10px", color: "var(--color-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.6px" }}>Order</span>
                        <p style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-ink)" }}>#{orderNo(order)}</p>
                      </div>
                      <div className="flex items-center flex-shrink-0" style={{ gap: "10px" }}>
                        <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--color-primary)" }}>{formatCurrency(order.total)}</span>
                        <span className="flex items-center" style={{ gap: "4px", padding: "4px 10px", borderRadius: "9999px", fontSize: "10px", fontWeight: 600, textTransform: "capitalize", background: badge.background, color: badge.color }}>
                          <Clock size={10} /> {order.orderStatus}
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
                      {order.products?.map((item, index) => (
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
                          {order.orderStatus === "delivered" && (
                            userReviews.includes(item.productId) ? (
                              <span className="flex items-center flex-shrink-0" style={{ gap: "4px", fontSize: "10px", fontWeight: 600, color: "var(--color-primary)" }}>
                                <CheckCircle2 size={12} /> Reviewed
                              </span>
                            ) : (
                              <button onClick={() => openReviewModal(item, order.id)} className="flex items-center flex-shrink-0" style={{ gap: "4px", fontSize: "11px", fontWeight: 700, color: "var(--color-primary)" }}>
                                <Star size={12} /> Review
                              </button>
                            )
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              {totalOrders > pageSize && (
                <Pagination
                  total={totalOrders}
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

        {/* MOBILE REVIEW MODAL (bottom sheet) — reuses existing review state/handlers */}
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
              <ReviewPhotoPicker onChange={setPhotoDraft} disabled={submitting} />
              <button onClick={submitReview} disabled={submitting} className="w-full flex items-center justify-center" style={{ marginTop: "16px", height: "48px", background: "var(--color-primary)", borderRadius: "9999px", color: "var(--color-inverse)", fontWeight: 700, fontSize: "16px", opacity: submitting ? 0.6 : 1 }}>
                {submitting ? "Submitting…" : "Submit Review"}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="hidden lg:block" style={{ background: "var(--color-background)", minHeight: "100vh", fontFamily: "Inter, sans-serif", color: "var(--color-ink)" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "48px 40px 80px" }}>

        {/* SECTION 1 — HEADER */}
        <div className="header-text flex flex-col" style={{ gap: "4px", paddingBottom: "8px" }}>
          <h1 style={{ fontWeight: 700, fontSize: "36px", letterSpacing: "-0.72px", color: "var(--color-ink)" }}>My Orders</h1>
          <p style={{ fontWeight: 400, fontSize: "16px", color: "var(--color-body)" }}>
            Welcome back, {userData?.name || user?.name || "there"}. Here's a summary of your recent purchases and their status.
          </p>
        </div>

        {/* SECTION 2 — ONGOING ORDERS LABEL (replaces tab bar) */}
        <div className="flex" style={{ borderBottom: "1px solid var(--color-border)", gap: "16px", paddingBottom: "4px", marginTop: "24px" }}>
          <span style={{ padding: "8px 16px", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: "var(--color-primary)", borderBottom: "2px solid var(--color-primary)", marginBottom: "-5px" }}>
            Ongoing Orders
          </span>
        </div>

        {/* SECTION 3 — ORDERS LIST */}
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
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ gap: "16px", padding: "80px 0", border: "1px dashed var(--color-border)", borderRadius: "8px", background: "var(--color-surface)" }}>
              <Package size={44} style={{ color: "var(--color-border)" }} />
              <p style={{ fontWeight: 700, fontSize: "18px", color: "var(--color-ink)" }}>No ongoing orders</p>
              <p style={{ fontSize: "14px", color: "var(--color-body)" }}>You have no active orders at the moment.</p>
              <button onClick={() => navigate("/products")} style={{ background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", padding: "14px 28px", borderRadius: "4px" }}>Start Shopping</button>
            </div>
          ) : (
            pagedOrders.map((order) => (
              <UserOrderCard key={order.id} order={order} onBuyAgain={handleBuyAgain} onViewDetails={handleViewDetails} />
            ))
          )}
        </div>

        {/* SECTION 4 — PAGINATION */}
        {!loading && totalOrders > pageSize && (
          <Pagination
            total={totalOrders}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            pageSizeOptions={[5, 10, 25]}
          />
        )}
      </div>
    </div>
  )
}

export default UserOrdersPage