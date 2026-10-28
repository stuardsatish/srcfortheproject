import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useSelector, useDispatch } from "react-redux"
import { supabase } from "../../context/SupabaseConfig"
import { mapOrderRow, resolveOrderItemImage } from "../../utils/supabaseOrders"
import { queryOrdersWithShipments } from "../../services/shipping"
import TrackingCard from "../../features/orders/shipping/TrackingCard"
import OrderReturnsSection from "../../features/returns/OrderReturnsSection"
import OrderRefundSection from "../../features/returns/OrderRefundSection"
import { buyAgain } from "../../features/orders/buyAgain"
import { generateInvoice } from "../../utils/generateInvoice"
import { orderNo, statusMeta } from "../../features/orders/UserOrderCard"
import { paymentMethodLabel, paymentStatusLabel } from "../../utils/paymentLabels"
import { ArrowLeft, Truck, CheckCircle2, XCircle, RotateCcw, Download, Package } from "lucide-react"
import { toast } from "react-toastify"

const cur = (n) => `₹${Number(n || 0).toFixed(2)}`
// Order line-items store the per-unit charge as `finalPrice` (after discount);
// older/other shapes may use `price` or `originalPrice`. Fall back across them.
const unitPrice = (p) => Number(p?.finalPrice ?? p?.price ?? p?.originalPrice ?? 0)
const toJsDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null)
// Address is stored as `userAddress` (a string OR { street, city, state, pincode }).
const formatAddress = (v) => {
  if (!v) return ""
  if (typeof v === "string") return v.trim()
  if (typeof v === "object") {
    return [v.street, v.city, v.state, v.pincode, v.country]
      .map((s) => String(s ?? "").trim())
      .filter(Boolean)
      .join(", ")
  }
  return ""
}
const fmtDate = (v) => {
  const d = toJsDate(v)
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"
}

const OrderDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const user = useSelector((state) => state.user.user)
  const cartItems = useSelector((state) => state.cart.cartItems)

  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const { data: row, error } = await queryOrdersWithShipments(
          (select) => supabase.from("orders").select(select).eq("id", id).single()
        )
        if (error || !row) { if (active) setError(true); return }
        const data = mapOrderRow(row)
        const productIds = [...new Set((data.products || []).map((item) => item.productId).filter(Boolean))]
        let productById = {}
        if (productIds.length) {
          const { data: pRows } = await supabase.from("products").select("id, thumbnail, image, variants").in("id", productIds)
          ;(pRows || []).forEach((p) => { productById[p.id] = p })
        }
        const products = (data.products || []).map((item) => {
          const p = productById[item.productId]
          const img = resolveOrderItemImage(item, p)
          return img ? { ...item, thumbnail: img, image: img } : item
        })
        if (active) setOrder({ ...data, products })
      } catch (e) {
        console.error("order detail fetch:", e)
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [id])

  // Re-adds the SAME option that was bought (main product or the specific variant) at the ordered quantity, at today's
  // price and stock (features/orders/buyAgain.js).
  const handleBuyAgain = async () => {
    try {
      const r = await buyAgain({ orderLines: order?.products, cartItems, dispatch, uid: user?.uid })
      if (!r.added) { toast.error(r.message || "Nothing could be added to your cart"); return }
      if (r.skipped.length) toast.info(r.message); else toast.success(r.message)
      navigate("/cart")
    } catch (e) {
      console.error("buy again:", e)
      toast.error("Could not add these items to your cart")
    }
  }

  const downloadInvoice = () =>
    generateInvoice(order, { name: order.userName || user?.name, email: order.userEmail || user?.email, phone: order.userPhone || user?.phone, address: order.address || order.shippingAddress })

  const Shell = ({ children }) => (
    <div style={{ background: "var(--color-background)", minHeight: "100vh", fontFamily: "Inter, sans-serif", color: "var(--color-ink)" }}>
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "48px 24px 80px" }}>{children}</div>
    </div>
  )

  if (loading) {
    return (
      <Shell>
        <div className="animate-pulse flex flex-col" style={{ gap: "16px" }}>
          <div style={{ height: "28px", width: "240px", background: "var(--color-border)", borderRadius: "6px" }} />
          <div style={{ height: "180px", background: "var(--color-border)", borderRadius: "8px" }} />
          <div style={{ height: "320px", background: "var(--color-border)", borderRadius: "8px" }} />
        </div>
      </Shell>
    )
  }

  if (error || !order) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center text-center" style={{ gap: "16px", padding: "80px 0" }}>
          <Package size={44} style={{ color: "var(--color-border)" }} />
          <p style={{ fontWeight: 700, fontSize: "18px" }}>Order not found</p>
          <button onClick={() => navigate("/userorders")} style={{ background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", padding: "14px 28px", borderRadius: "4px" }}>Back to Orders</button>
        </div>
      </Shell>
    )
  }

  const m = statusMeta(order)
  const items = order.products || []
  const computedItems = items.reduce((s, p) => s + unitPrice(p) * Number(p.quantity || 0), 0)
  const itemsTotal = order.subtotal != null ? Number(order.subtotal) : computedItems
  const shipping = order.shipping != null ? Number(order.shipping) : Math.max(0, Number(order.total || 0) - itemsTotal)
  // GST is included in the item prices; show the breakdown when the order stored it.
  const hasGst = order.gstEnabled !== false && order.taxableTotal != null
  const isInterState = !!order.isInterState
  const totalCgst = Number(order.totalCgst || 0)
  const totalSgst = Number(order.totalSgst || 0)
  const totalIgst = Number(order.totalIgst || 0)

  return (
    <Shell>
      {/* Back + header */}
      <button onClick={() => navigate(-1)} className="flex items-center" style={{ gap: "8px", color: "var(--color-body)", marginBottom: "24px" }}>
        <ArrowLeft size={16} /> <span style={{ fontWeight: 600, fontSize: "14px" }}>Back to orders</span>
      </button>

      <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
        <div className="flex flex-col" style={{ gap: "4px" }}>
          <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-body)" }}>Order ID</span>
          <h1 style={{ fontWeight: 700, fontSize: "32px", letterSpacing: "-0.6px", color: "var(--color-ink)" }}>#{orderNo(order)}</h1>
          <span style={{ fontWeight: 400, fontSize: "14px", color: "var(--color-body)" }}>Placed on {fmtDate(order.createdAt)}</span>
        </div>
        <span className="flex items-center" style={{ background: m.bg, borderRadius: "12px", padding: "6px 16px", gap: "6px" }}>
          {m.icon === "truck" && <Truck size={14} style={{ color: m.color }} />}
          {m.icon === "check" && <CheckCircle2 size={14} style={{ color: m.color }} />}
          {m.icon === "x" && <XCircle size={14} style={{ color: m.color }} />}
          <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", color: m.color }}>{m.label}</span>
        </span>
      </div>

      {/* Where is it? Courier, tracking number / link, expected date and the courier's updates (nothing is shown for cancelled orders) */}
      <TrackingCard order={order} />

      {/* Items */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "24px", marginTop: "24px" }}>
        <h2 style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>Items ({items.length})</h2>
        <div className="flex flex-col" style={{ gap: "16px" }}>
          {items.map((p, i) => (
            <div key={i} className="flex items-center" style={{ gap: "16px", borderTop: i === 0 ? "none" : "1px solid var(--color-info-subtle)", paddingTop: i === 0 ? 0 : "16px" }}>
              {(p.thumbnail || p.image) ? (
                <img src={p.thumbnail || p.image} alt={p.title} style={{ width: "64px", height: "64px", borderRadius: "6px", objectFit: "cover", background: "var(--color-border)" }} />
              ) : (
                <div style={{ width: "64px", height: "64px", borderRadius: "6px", background: "var(--color-border)" }} />
              )}
              <div className="flex flex-col flex-1" style={{ minWidth: 0 }}>
                <span className="line-clamp-1" style={{ fontWeight: 600, fontSize: "15px", color: "var(--color-ink)" }}>{p.title}</span>
                <span style={{ fontSize: "13px", color: "var(--color-body)" }}>Qty {p.quantity} · {cur(unitPrice(p))} each</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-primary)" }}>{cur(unitPrice(p) * Number(p.quantity || 0))}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Returns & exchanges: what can be returned / exchanged, the request form, and the requests made so far */}
      <OrderReturnsSection order={order} user={user} />

      {/* A cancelled order: why, and where its refund stands (also a refund the shop made on its own) */}
      <OrderRefundSection order={order} />

      {/* Summary + meta */}
      <div className="flex" style={{ gap: "24px", marginTop: "24px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "24px" }}>
          <h2 style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>Summary</h2>
          <div className="flex flex-col" style={{ gap: "10px" }}>
            <div className="flex" style={{ justifyContent: "space-between" }}><span style={{ color: "var(--color-body)" }}>Items</span><span style={{ fontWeight: 600 }}>{cur(itemsTotal)}</span></div>
            {hasGst && (isInterState ? (
              <div className="flex" style={{ justifyContent: "space-between", fontSize: "13px" }}><span style={{ color: "var(--color-muted)" }}>Incl. IGST</span><span style={{ color: "var(--color-muted)" }}>{cur(totalIgst)}</span></div>
            ) : (
              <div className="flex" style={{ justifyContent: "space-between", fontSize: "13px" }}><span style={{ color: "var(--color-muted)" }}>Incl. CGST + SGST</span><span style={{ color: "var(--color-muted)" }}>{cur(totalCgst + totalSgst)}</span></div>
            ))}
            <div className="flex" style={{ justifyContent: "space-between" }}><span style={{ color: "var(--color-body)" }}>Shipping</span><span style={{ fontWeight: 600 }}>{shipping === 0 ? "Free" : cur(shipping)}</span></div>
            <div className="flex" style={{ justifyContent: "space-between", borderTop: "1px dashed var(--color-border)", paddingTop: "10px" }}><span style={{ fontWeight: 700 }}>Total</span><span style={{ fontWeight: 800, color: "var(--color-primary)" }}>{cur(order.total)}</span></div>
          </div>
          <div className="flex flex-col" style={{ gap: "8px", marginTop: "20px" }}>
            <button onClick={handleBuyAgain} className="flex items-center justify-center" style={{ height: "48px", background: "var(--color-accent-strong)", borderRadius: "4px", gap: "6px" }}>
              <RotateCcw size={14} style={{ color: "var(--color-inverse)" }} />
              <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-inverse)" }}>Buy Again</span>
            </button>
            <button onClick={downloadInvoice} className="flex items-center justify-center" style={{ height: "48px", border: "1px solid var(--color-border)", borderRadius: "4px", gap: "6px" }}>
              <Download size={14} style={{ color: "var(--color-ink)" }} />
              <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-ink)" }}>Download Invoice</span>
            </button>
          </div>
        </div>

        <div style={{ flex: "1 1 280px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "24px" }}>
          <h2 style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>Delivery &amp; Payment</h2>
          <div className="flex flex-col" style={{ gap: "12px", fontSize: "14px" }}>
            <div className="flex flex-col">
              <span style={{ color: "var(--color-body)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 600 }}>Ship To</span>
              <span style={{ color: "var(--color-ink)", marginTop: "2px" }}>{order.userName || user?.name || "—"}</span>
              <span style={{ color: "var(--color-body)" }}>{formatAddress(order.userAddress) || formatAddress(order.address) || formatAddress(order.shippingAddress) || "No address on file"}</span>
            </div>
            <div className="flex flex-col">
              <span style={{ color: "var(--color-body)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 600 }}>Payment</span>
              <span style={{ color: "var(--color-ink)", marginTop: "2px" }}>{order.paymentMethod ? paymentMethodLabel(order.paymentMethod) : "—"}{order.paymentStatus ? ` · ${paymentStatusLabel(order.paymentStatus, order.paymentMethod)}` : ""}</span>
              {order.razorpayPaymentId && <span style={{ color: "var(--color-body)", fontFamily: "monospace", fontSize: "13px" }}>{order.razorpayPaymentId}</span>}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}

export default OrderDetailPage