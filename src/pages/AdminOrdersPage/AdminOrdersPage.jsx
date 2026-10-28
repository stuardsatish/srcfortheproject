import { useEffect, useLayoutEffect, useState, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "react-toastify"

import { supabase } from "../../context/SupabaseConfig"
import { mapOrderRows, resolveOrderItemImage } from "../../utils/supabaseOrders"
import { generateInvoice } from "../../utils/generateInvoice"
import { paymentMethodLabel, paymentStatusLabel, isCodPending, isPendingPayment } from "../../utils/paymentLabels"
import SearchBar from "../../components/SearchBar"
import PaginatedOrderTable from "../../features/orders/PaginatedOrderTable"
import useIsMobile from "../../hooks/useIsMobile"
import { queryOrdersWithShipments, shippingService } from "../../services/shipping"
import ShipOrderModal from "../../features/orders/shipping/ShipOrderModal"
import ShipmentPanel from "../../features/orders/shipping/ShipmentPanel"
import ShipmentMini from "../../features/orders/shipping/ShipmentMini"
import CancelOrderModal from "../../features/orders/cancel/CancelOrderModal"
import OrderRefundsPanel from "../../features/orders/cancel/OrderRefundsPanel"
import { canCancelOrder } from "../../features/inventory/inventoryModel"
import {
  Truck, CreditCard, Package, X, Download, Printer,
  CheckCircle2, PackageCheck, Banknote, XCircle
} from "lucide-react"
import gsap from "gsap"

/* ============================== FONTS ============================== */
// (tabs: Confirmed / Shipped / Delivered)
const MANROPE = "'Manrope', sans-serif"
const MONO = "'JetBrains Mono', monospace"
const INTER = "'Inter', sans-serif"

/* ============================== HELPERS ============================== */
const toDate = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}
const formatINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// Address may be a plain string OR the profile/order object shape
// ({ street, city, state, pincode }). Normalise to a single readable line so
// React never receives a raw object as a child.
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

/**
 * Compute the correct final (discounted) price for an order line item.
 *
 * The old deployed backend stored finalPrice = originalPrice when it couldn't
 * parse the new MRP / Discounted-Price message format (the parsePrice regex
 * was stripping the decimal dot so ₹7.55 → 755, then the fallback set
 * finalPrice = catalog MRP). We detect that case by checking whether the
 * stored finalPrice ≥ originalPrice while a non-zero discount% exists, and
 * recompute from the discount percentage so the UI is always correct.
 */
const resolvedFinalPrice = (p) => {
  const mrp = Number(p.originalPrice ?? p.price ?? 0)
  const disc = Number(p.discount || 0)
  const stored = Number(p.finalPrice ?? p.price ?? 0)
  if (disc > 0 && stored >= mrp && mrp > 0) {
    // Old-backend bug: finalPrice was set to MRP — recompute correctly.
    return Math.round(mrp * (1 - disc / 100) * 100) / 100
  }
  return stored || mrp
}
const fmtDateTime = (d) =>
  d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) +
    " • " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—"
const initials = (name) => {
  if (!name) return "?"
  return String(name).trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
}
const hashColor = (str) => {
  const colors = ["var(--color-accent-strong)", "var(--color-info)", "var(--color-accent-strong)", "var(--color-accent-strong)", "var(--color-primary)", "var(--color-info)"]
  let h = 0
  const s = String(str || "x")
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}

const TABS = [
  { key: "confirmed", title: "Confirmed Orders", statuses: ["placed", "confirmed"], color: "var(--color-primary)", activeBadgeBg: "color-mix(in srgb, var(--color-accent) 12%, transparent)", emptyIcon: CheckCircle2, emptyTitle: "No Orders to Dispatch" },
  { key: "shipped", title: "Shipped", statuses: ["shipped"], color: "var(--color-accent-strong)", activeBadgeBg: "color-mix(in srgb, var(--color-accent-strong) 12%, transparent)", emptyIcon: Truck, emptyTitle: "No Active Shipments" },
  { key: "delivered", title: "Delivered", statuses: ["delivered"], color: "var(--color-accent-strong)", activeBadgeBg: "color-mix(in srgb, var(--color-accent-strong) 12%, transparent)", emptyIcon: PackageCheck, emptyTitle: "No Completed Orders Yet" },
  { key: "cancelled", title: "Cancelled", statuses: ["cancelled"], color: "var(--color-error)", activeBadgeBg: "color-mix(in srgb, var(--color-error) 12%, transparent)", emptyIcon: XCircle, emptyTitle: "No Cancelled Orders" },
]
const INACTIVE_BADGE = { background: "var(--color-surface-muted)", color: "var(--color-body)" }

const AdminOrdersPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  // Search + active tab are initialised from (and reflected back to) the URL
  // so links like ?tab=confirmed&page=2&search=John are deep-linkable.
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get("search") || "")
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get("tab")
    return TABS.some((x) => x.key === t) ? t : "confirmed"
  })
  const [productImages, setProductImages] = useState({}) // productId -> real thumbnail
  const [drawerUserAddress, setDrawerUserAddress] = useState("")
  const [paymentFilter, setPaymentFilter] = useState("all") // "all" | "paid" | "unpaid"
  const [paymentModeFilter, setPaymentModeFilter] = useState("all") // "all" | "cod" | "razorpay" | "whatsapp"
  const [shipTarget, setShipTarget] = useState(null) // the order whose "ship" form is open
  const [cancelTarget, setCancelTarget] = useState(null) // the order whose "cancel" dialog is open (before shipment only)

  const containerRef = useRef(null)
  const drawerRef = useRef(null)
  const fetchOrdersRef = useRef(null) // lets actions outside the listener effect reload the list

  // Mobile layout: this page is built with fixed-pixel inline styles, so we
  // branch the big chrome dimensions (header, side padding, drawer width) on a
  // viewport check instead of CSS media queries.
  const isMobile = useIsMobile(768)
  const sidePad = isMobile ? "16px" : "48px"

  /* ---------------- URL PARAM SYNC ---------------- */
  // Merge a partial update into the query string (drops empty values).
  const updateParams = (updates) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        Object.entries(updates).forEach(([k, v]) => {
          if (v === "" || v == null) next.delete(k)
          else next.set(k, String(v))
        })
        return next
      },
      { replace: true }
    )
  }
  const handleSearchChange = (v) => {
    setSearchTerm(v)
    updateParams({ search: v })
  }
  // The active tab's PaginatedOrderTable reports its page up for URL reflection.
  const handleActivePage = (p) => updateParams({ page: p })

  /* ---------------- REALTIME ORDERS LISTENER ---------------- */
  useEffect(() => {
    const fetchOrders = async () => {
      const { data, error } = await queryOrdersWithShipments(
        (select) => supabase.from("orders").select(select).order("created_at", { ascending: false }),
        { admin: true },
      )
      if (error) { console.error("orders fetch:", error); return }
      const rawOrders = mapOrderRows(data)

      const productIds = [...new Set(rawOrders.flatMap((o) => (o.products || []).map((p) => p.productId)).filter(Boolean))]
      let productById = {}
      if (productIds.length) {
        const { data: pRows } = await supabase.from("products").select("id, thumbnail, image, variants").in("id", productIds)
        ;(pRows || []).forEach((p) => { productById[p.id] = p })
      }
      const enrichedOrders = rawOrders.map((order) => ({
        ...order,
        products: (order.products || []).map((item) => {
          const pd = productById[item.productId]
          const img = resolveOrderItemImage(item, pd)
          return { ...item, thumbnail: img, image: img }
        }),
      }))

      setOrders(enrichedOrders)
      setLoading(false)
    }
    fetchOrders()
    fetchOrdersRef.current = fetchOrders
    const channel = supabase
      .channel("admin-orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, fetchOrders)
      .subscribe()
    // a separate channel: if the shipping tables do not exist yet (SQL not applied) only THIS subscription fails, orders keep updating
    const shipChannel = supabase
      .channel("admin-shipments-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, fetchOrders)
      .subscribe()
    return () => { supabase.removeChannel(channel); supabase.removeChannel(shipChannel) }
  }, [])

  /* ---------------- TAB BUCKETING ---------------- */
  // Search is applied per-tab inside <PaginatedOrderTable>, so this returns the
  // full (unfiltered) bucket — tab badge counts therefore always show totals.
  // Confirmed tab intentionally includes still-"placed" (paid, not-yet-actioned) orders.
  const ordersForTab = (tab) => orders.filter((o) => tab.statuses.includes(o.orderStatus))

  /* ---------------- ORDER ACTIONS (kept) ---------------- */
  // "Mark Delivered": the database delivers every open parcel of the order (or just the order, when it was shipped before shipment
  // tracking existed) and stamps delivered_at, which the return / exchange windows count from.
  const refreshOrders = () => fetchOrdersRef.current?.()
  const markDelivered = async (orderId) => {
    try {
      await shippingService.markDelivered(orderId)
      refreshOrders()
    } catch (err) {
      console.log(err)
      toast.error(err.message || "Could not mark the order delivered.")
    }
  }

  /* Mark a COD order's payment as collected (cash received). */
  const markAsPaid = async (orderId) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", orderId)
      if (error) throw error
      setSelectedOrder((prev) => (prev && prev.id === orderId ? { ...prev, paymentStatus: "paid" } : prev))
    } catch (err) {
      console.log(err)
      toast.error(err.message || "Could not update payment status.")
    }
  }

  /* ---------------- TAB SWITCH ---------------- */
  // All three panels stay mounted (so each keeps its own page); we just toggle
  // visibility and fade the newly-active panel in.
  const switchTab = (newTab) => {
    if (newTab === activeTab) return
    setActiveTab(newTab)
    updateParams({ tab: newTab })
    gsap.fromTo(`.tab-panel-${newTab}`, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" })
  }

  /* ---------------- DRAWER ---------------- */
  const openOrder = (order) => setSelectedOrder(order)
  const closeDrawer = () => {
    if (drawerRef.current) {
      gsap.to(drawerRef.current, { xPercent: 100, duration: 0.3, ease: "power3.in", onComplete: () => setSelectedOrder(null) })
    } else {
      setSelectedOrder(null)
    }
  }
  // Animate transform (not `right`) so a realtime re-render can't reset the
  // drawer position; layout effect runs pre-paint to avoid an open-state flash.
  useLayoutEffect(() => {
    if (selectedOrder && drawerRef.current) {
      gsap.set(drawerRef.current, { xPercent: 100 })
      gsap.to(drawerRef.current, { xPercent: 0, duration: 0.4, ease: "power3.out" })
    }
  }, [selectedOrder])

  // Order line items don't store an image — fetch each product's real thumbnail
  // from the products collection when the drawer opens.
  useEffect(() => {
    if (!selectedOrder?.products?.length) return
    const ids = [...new Set(selectedOrder.products.map((p) => p.productId).filter((id) => id && !(id in productImages)))]
    if (ids.length === 0) return
    let cancelled = false
      ; (async () => {
        const found = {}
        try {
          const { data: rows, error } = await supabase
            .from("products")
            .select("id, thumbnail, image, gallery")
            .in("id", ids)
          if (error) throw error
          rows.forEach((d) => {
            found[d.id] = d.thumbnail || d.image || (Array.isArray(d.gallery) ? d.gallery[0] : "") || ""
          })
          ids.forEach((id) => { if (!(id in found)) found[id] = "" })
        } catch {
          ids.forEach((id) => { found[id] = "" })
        }
        if (!cancelled) setProductImages((prev) => ({ ...prev, ...found }))
      })()
    return () => { cancelled = true }
  }, [selectedOrder, productImages])

  // Fallback address lookup: fetch from profiles when the order itself has no address.
  useEffect(() => {
    setDrawerUserAddress("")
    if (!selectedOrder) return
    if (selectedOrder.userAddress || selectedOrder.address || selectedOrder.shippingAddress) return
    if (!selectedOrder.userId) return
    let cancelled = false
      ; (async () => {
        try {
          const { data } = await supabase
            .from("profiles")
            .select("address, name, phone, email")
            .eq("id", selectedOrder.userId)
            .single()
          if (!cancelled && data) setDrawerUserAddress(data.address || "")
        } catch { /* non-fatal */ }
      })()
    return () => { cancelled = true }
  }, [selectedOrder])

  /* ---------------- LOAD ANIMATIONS ---------------- */
  useEffect(() => {
    if (!orders.length) return
    const ctx = gsap.context(() => {
      gsap.from(".analytics-card", { y: 20, opacity: 0, stagger: 0.1, duration: 0.6, ease: "power3.out" })
    }, containerRef)
    return () => ctx.revert()
  }, [orders.length])

  /* ---------------- ORDER CARD STAGGER (per tab) ---------------- */
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".order-card", { opacity: 0, y: 20, scale: 0.97, stagger: 0.06, duration: 0.35, ease: "power3.out", delay: 0.1 })
    }, containerRef)
    return () => ctx.revert()
  }, [activeTab, orders.length])

  /* ---------------- ANALYTICS (realtime from orders) ---------------- */
  const total = orders.length
  const placedCount = orders.filter((o) => o.orderStatus === "placed").length
  const shippedCount = orders.filter((o) => o.orderStatus === "shipped").length
  const deliveredCount = orders.filter((o) => o.orderStatus === "delivered").length

  /* ---------------- INVOICE DOWNLOAD (professional PDF) ---------------- */
  const downloadInvoice = (order) => {
    try {
      generateInvoice(order, {
        name: order.userName,
        email: order.userEmail,
        phone: order.userPhone || order.phone,
        address: order.userAddress || order.address || order.shippingAddress,
      })
    } catch (err) {
      console.error("Invoice error:", err)
    }
  }

  /* ============================== ORDER CARD ============================== */
  const OrderCard = ({ order, column }) => {
    const av = order.userAvatar
    const avBg = hashColor(order.userName)
    return (
      <div
        className="order-card cursor-pointer"
        onClick={() => openOrder(order)}
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "0px 1px 2px rgba(0,0,0,0.05)", borderRadius: "24px", padding: "24px", width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}
      >
        {/* Row 1 — header */}
        <div className="flex items-start justify-between">
          <div>
            <p style={{ fontFamily: MONO, fontSize: "12px", color: "var(--color-body)", letterSpacing: "0.6px" }}>#{order.externalOrderId ? String(order.externalOrderId).replace(/^#/, "") : order.id}</p>
            <p style={{ fontFamily: MANROPE, fontWeight: 800, fontSize: "24px", color: "var(--color-ink)", marginTop: "2px" }}>{formatINR(order.total)}</p>
          </div>
          {av ? (
            <img src={av} alt="" className="flex-shrink-0" style={{ width: "40px", height: "40px", borderRadius: "9999px", border: "2px solid var(--color-inverse)", boxShadow: "0px 1px 4px rgba(0,0,0,0.1)", objectFit: "cover" }} />
          ) : (
            <span className="flex items-center justify-center flex-shrink-0 text-inverse font-bold" style={{ width: "40px", height: "40px", borderRadius: "9999px", border: "2px solid var(--color-inverse)", boxShadow: "0px 1px 4px rgba(0,0,0,0.1)", background: avBg, fontSize: "13px" }}>{initials(order.userName)}</span>
          )}
        </div>

        {/* Row 2 — customer */}
        <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}>{order.userName || "Guest"}</p>

        {/* Row 3 — products */}
        <div style={{ background: "var(--color-surface-muted)", border: "1px solid var(--color-border)", borderRadius: "12px", padding: "12px", maxHeight: "104px", overflowY: "auto" }}>
          {(order.products || []).map((p, i) => (
            <p key={i} style={{ fontFamily: MONO, fontWeight: 500, fontSize: "13px", color: "var(--color-body)", lineHeight: "22px" }}>
              {p.title} x{p.quantity}
            </p>
          ))}
          {(!order.products || order.products.length === 0) && (
            <p style={{ fontFamily: MONO, fontSize: "13px", color: "var(--color-body)", opacity: 0.5 }}>No items</p>
          )}
        </div>

        {/* Row 4 — payment method + paid/unpaid badge */}
        <div className="flex items-center gap-2 flex-wrap">
          {String(order.paymentMethod || "").toLowerCase() === "cod"
            ? <Banknote size={14} style={{ color: "var(--color-body)" }} />
            : <CreditCard size={14} style={{ color: "var(--color-body)" }} />}
          <span style={{ fontFamily: INTER, fontWeight: 500, fontSize: "12px", color: "var(--color-body)", letterSpacing: "0.6px" }}>{order.paymentMethod ? paymentMethodLabel(order.paymentMethod) : "Paid via Credit Card"}</span>
          {order.paymentStatus && (() => {
            const paid = String(order.paymentStatus).toLowerCase() === "paid"
            return (
              <span style={{
                fontFamily: INTER, fontWeight: 700, fontSize: "10px", padding: "2px 9px", borderRadius: "9999px",
                background: paid ? "var(--color-success-subtle)" : "color-mix(in srgb, var(--color-accent-strong) 14%, transparent)",
                color: paid ? "var(--color-success)" : "var(--color-accent-strong)",
              }}>
                {paid ? "Paid" : "Unpaid"}
              </span>
            )
          })()}
        </div>

        {/* COD: collect cash → mark paid, from any tab, without opening the drawer */}
        {/* 
        {isCodPending(order) && (
          <button
            onClick={(e) => { e.stopPropagation(); markAsPaid(order.id) }}
            className="w-full flex items-center justify-center gap-2 text-inverse"
            style={{ background: "var(--color-primary)", borderRadius: "12px", height: "44px", fontFamily: INTER, fontWeight: 700, fontSize: "14px", boxShadow: "0px 2px 6px rgba(0,0,0,0.1)" }}
          >
            <Banknote size={15} /> Mark Payment as Paid
          </button>
        )}
        */}
        {isPendingPayment(order) && column === "delivered" && (
          <button
            onClick={(e) => { e.stopPropagation(); markAsPaid(order.id) }}
            className="w-full flex items-center justify-center gap-2 text-inverse"
            style={{ background: "var(--color-primary)", borderRadius: "12px", height: "44px", fontFamily: INTER, fontWeight: 700, fontSize: "14px", boxShadow: "0px 2px 6px rgba(0,0,0,0.1)", cursor: "pointer" }}
          >
            <Banknote size={15} /> Mark Payment as Paid
          </button>
        )}

        {/* Row 5 — action (per tab) */}
        {column === "confirmed" && (
          <button onClick={(e) => { e.stopPropagation(); setShipTarget(order) }} className="w-full text-inverse" style={{ background: "var(--color-primary)", borderRadius: "12px", height: "52px", boxShadow: "0px 4px 6px rgba(0,0,0,0.1)", fontFamily: INTER, fontWeight: 700, fontSize: "16px", cursor: "pointer" }}>Initiate Transit</button>
        )}
        {column === "confirmed" && canCancelOrder(order) && (
          <button onClick={(e) => { e.stopPropagation(); setCancelTarget(order) }} className="w-full" style={{ background: "var(--color-surface)", color: "var(--color-error)", border: "1px solid var(--color-error-subtle)", borderRadius: "12px", height: "40px", fontFamily: INTER, fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>Cancel order</button>
        )}
        {column === "shipped" && (
          <div className="flex flex-col gap-3">
            <ShipmentMini order={order} />
            <button onClick={(e) => { e.stopPropagation(); markDelivered(order.id) }} className="w-full" style={{ background: "var(--color-accent-subtle)", color: "var(--color-body)", borderRadius: "12px", height: "44px", fontFamily: INTER, fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>Mark Delivered</button>
          </div>
        )}
      </div>
    )
  }

  /* ============================== ORDER CARD SKELETON ============================== */
  // Mirrors OrderCard: header (id + total + avatar), customer line, products
  // box, payment row, and an action button — same container radius/padding.
  const OrderCardSkeletonCard = () => {
    const bar = (style) => <div className="animate-pulse" style={{ background: "var(--color-surface-muted)", borderRadius: "6px", ...style }} />
    return (
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "0px 1px 2px rgba(0,0,0,0.05)", borderRadius: "24px", padding: "24px", width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Row 1 — header */}
        <div className="flex items-start justify-between">
          <div className="flex flex-col" style={{ gap: "6px" }}>
            {bar({ width: "90px", height: "12px" })}
            {bar({ width: "120px", height: "24px" })}
          </div>
          {bar({ width: "40px", height: "40px", borderRadius: "9999px" })}
        </div>
        {/* Row 2 — customer */}
        {bar({ width: "60%", height: "16px" })}
        {/* Row 3 — products box */}
        <div style={{ background: "var(--color-surface-muted)", border: "1px solid var(--color-border)", borderRadius: "12px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {bar({ width: "80%", height: "13px", background: "var(--color-border)" })}
          {bar({ width: "65%", height: "13px", background: "var(--color-border)" })}
        </div>
        {/* Row 4 — payment */}
        {bar({ width: "50%", height: "12px" })}
        {/* Row 5 — action */}
        {bar({ width: "100%", height: "52px", borderRadius: "12px" })}
      </div>
    )
  }

  /* ============================== ANALYTICS CARD ============================== */
  const cardBase = { background: "color-mix(in srgb, var(--color-surface) 40%, transparent)", border: "1px solid color-mix(in srgb, var(--color-surface) 30%, transparent)", boxShadow: "0px 8px 32px color-mix(in srgb, var(--color-accent) 5%, transparent)", backdropFilter: "blur(12px)", borderRadius: "24px", padding: "24px", minHeight: "126px" }
  const labelStyle = { fontFamily: MONO, fontSize: "13px", color: "var(--color-body)", opacity: 0.7 }
  const valueStyle = { fontFamily: MANROPE, fontWeight: 800, fontSize: "36px", letterSpacing: "-0.9px" }
  // While the orders listener is still pending, show a pulsing bar in place of
  // the derived stat so the analytics cards don't flash a misleading "0".
  const statSkel = <span aria-hidden="true" className="animate-pulse" style={{ display: "inline-block", width: "72px", height: "36px", background: "var(--color-surface-muted)", borderRadius: "8px" }} />

  /* ============================== DRAWER ============================== */
  const Drawer = () => {
    const o = selectedOrder
    if (!o) return null
    const created = toDate(o.createdAt)
    const status = o.orderStatus
    const paymentDone = ["confirmed", "shipped", "delivered"].includes(status)
    const processingDone = ["shipped", "delivered"].includes(status)
    const productsCount = o.products?.length || 0

    const TimelineStep = ({ title, subtitle, done, last }) => (
      <div className="flex gap-4">
        <div className="flex flex-col items-center">
          <span style={{ width: "20px", height: "20px", borderRadius: "9999px", background: done ? "var(--color-primary)" : "var(--color-border)", boxShadow: done ? "0px 0px 0px 4px color-mix(in srgb, var(--color-accent) 20%, transparent)" : "none" }} />
          {!last && <span style={{ width: "2px", flex: 1, minHeight: "32px", background: "var(--color-border)", marginTop: "4px" }} />}
        </div>
        <div style={{ paddingBottom: last ? 0 : "12px" }}>
          <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "16px", color: done ? "var(--color-ink)" : "var(--color-ink)", opacity: done ? 1 : 0.4 }}>{title}</p>
          <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "14px", color: "var(--color-body)", opacity: done ? 1 : 0.4 }}>{subtitle}</p>
        </div>
      </div>
    )

    return (
      <div ref={drawerRef} className="fixed top-0 bottom-0 overflow-y-auto" style={{ right: 0, width: "500px", maxWidth: "100vw", background: "var(--color-background)", borderLeft: "1px solid var(--color-border)", boxShadow: "0px 25px 50px -12px rgba(0,0,0,0.25)", zIndex: 50 }}>
        <div style={{ padding: isMobile ? "20px" : "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Top row */}
          <div className="flex items-center justify-between">
            <h2 style={{ fontFamily: INTER, fontWeight: 800, fontSize: "30px", color: "var(--color-ink)", letterSpacing: "-0.75px" }}>Order Details</h2>
            <button onClick={closeDrawer} className="flex items-center justify-center" style={{ width: "40px", height: "40px", borderRadius: "9999px", background: "var(--color-surface-muted)" }}><X size={18} style={{ color: "var(--color-body)" }} /></button>
          </div>

          {/* Summary row */}
          <div className="flex items-start justify-between" style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "16px" }}>
            <div>
              <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-body)", letterSpacing: "1.8px" }}>ORDER ID</p>
              <p style={{ fontFamily: MONO, fontWeight: 800, fontSize: "18px", color: "var(--color-ink)" }}>#{o.externalOrderId ? String(o.externalOrderId).replace(/^#/, "") : o.id}</p>
            </div>
            <div className="text-right">
              <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-body)", letterSpacing: "1.8px" }}>TOTAL AMOUNT</p>
              <p style={{ fontFamily: INTER, fontWeight: 800, fontSize: "18px", color: "var(--color-primary)", letterSpacing: "-1.5px" }}>{formatINR(o.total)}</p>
            </div>
          </div>

          {/* Timeline */}
          <div style={{ paddingTop: "8px" }}>
            <div className="flex items-center gap-3" style={{ marginBottom: "20px" }}>
              <span style={{ width: "4px", height: "20px", background: "var(--color-primary)", borderRadius: "9999px" }} />
              <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: "18px", color: "var(--color-ink)" }}>Order Timeline</h3>
            </div>
            <TimelineStep title="Order Placed" subtitle={fmtDateTime(created)} done />
            <TimelineStep title="Payment Confirmed" subtitle={paymentDone ? fmtDateTime(created) : "Pending"} done={paymentDone} />
            <TimelineStep title="Processing" subtitle={processingDone ? "Dispatched from warehouse" : "Awaiting Warehouse Confirmation"} done={processingDone} last />
          </div>

          {/* Real shipment data: courier, tracking number / link, parcel history, and the actions that change them */}
          <ShipmentPanel order={orders.find((x) => x.id === o.id) || o} onChanged={refreshOrders} />

          {/* The money side: why / when the order was cancelled, every refund of it (send / record / cancel), "Refund an amount" for a paid order */}
          <OrderRefundsPanel key={`${o.id}-${o.orderStatus}`} order={orders.find((x) => x.id === o.id) || o} onChanged={refreshOrders} />

          {/* Customer Information */}
          <div className="relative" style={{ background: "var(--color-surface-muted)", border: "1px solid var(--color-border)", boxShadow: "0px 1px 2px rgba(0,0,0,0.05)", borderRadius: "24px", padding: "64px 32px 32px", marginTop: "40px" }}>
            {o.userAvatar ? (
              <img src={o.userAvatar} alt="" className="absolute" style={{ top: "-40px", left: "32px", width: "80px", height: "80px", borderRadius: "24px", boxShadow: "0px 0px 0px 2px var(--color-inverse), 0px 4px 6px rgba(0,0,0,0.1)", objectFit: "cover" }} />
            ) : (
              <span className="absolute flex items-center justify-center text-inverse font-bold" style={{ top: "-40px", left: "32px", width: "80px", height: "80px", borderRadius: "24px", boxShadow: "0px 0px 0px 2px var(--color-inverse), 0px 4px 6px rgba(0,0,0,0.1)", background: hashColor(o.userName), fontSize: "28px", fontFamily: MANROPE }}>{initials(o.userName)}</span>
            )}
            <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: "18px", color: "var(--color-ink)", marginBottom: "12px" }}>Customer Information</h3>
            <p style={{ fontFamily: INTER, fontWeight: 800, fontSize: "20px", color: "var(--color-ink)" }}>{o.userName || "Guest"}</p>
            <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "14px", color: "var(--color-body)" }}>{o.userEmail || "—"}{o.userPhone ? ` • ${o.userPhone}` : ""}</p>

            <div style={{ marginTop: "20px" }}>
              <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-body)", letterSpacing: "2.4px", textTransform: "uppercase" }}>Shipping Address</p>
              <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "14px", lineHeight: "23px", color: "var(--color-ink)", marginTop: "4px" }}>{formatAddress(o.userAddress) || formatAddress(o.address) || formatAddress(o.shippingAddress) || formatAddress(drawerUserAddress) || "No address on file"}</p>
            </div>

            <div style={{ marginTop: "20px" }}>
              <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-body)", letterSpacing: "2.4px", textTransform: "uppercase" }}>Payment Method</p>
              <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: "4px" }}>
                {String(o.paymentMethod || "").toLowerCase() === "cod"
                  ? <Banknote size={16} style={{ color: "var(--color-primary)" }} />
                  : <CreditCard size={16} style={{ color: "var(--color-primary)" }} />}
                <span style={{ fontFamily: INTER, fontWeight: 500, fontSize: "14px", color: "var(--color-ink)" }}>{o.paymentMethod ? paymentMethodLabel(o.paymentMethod) : "Credit Card"}</span>
                {/* Payment status badge */}
                {(() => {
                  const paid = String(o.paymentStatus || "").toLowerCase() === "paid"
                  return (
                    <span style={{
                      fontFamily: INTER, fontWeight: 700, fontSize: "11px", padding: "2px 10px", borderRadius: "9999px",
                      background: paid ? "var(--color-success-subtle)" : "color-mix(in srgb, var(--color-accent-strong) 14%, transparent)",
                      color: paid ? "var(--color-success)" : "var(--color-accent-strong)",
                      border: `1px solid ${paid ? "var(--color-success)" : "var(--color-accent-strong)"}`,
                    }}>
                      {paid ? "Paid" : paymentStatusLabel(o.paymentStatus, o.paymentMethod)}
                    </span>
                  )
                })()}
              </div>
              {o.razorpayPaymentId && (
                <div className="flex items-center gap-2" style={{ marginTop: "8px" }}>
                  <span style={{ fontFamily: INTER, fontWeight: 600, fontSize: "12px", color: "var(--color-body)" }}>Txn ID</span>
                  <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: "13px", color: "var(--color-ink)", background: "color-mix(in srgb, var(--color-accent) 8%, transparent)", padding: "2px 8px", borderRadius: "6px" }}>{o.razorpayPaymentId}</span>
                </div>
              )}
              {/* COD: let admin mark payment collected */}
              {/* 
              {isCodPending(o) && (
                <button
                  onClick={() => markAsPaid(o.id)}
                  className="flex items-center gap-2"
                  style={{ marginTop: "12px", background: "var(--color-primary)", color: "var(--color-inverse)", fontFamily: INTER, fontWeight: 700, fontSize: "13px", padding: "8px 14px", borderRadius: "10px", boxShadow: "0px 2px 6px rgba(0,0,0,0.1)" }}
                >
                  <Banknote size={15} /> Mark Payment as Paid
                </button>
              )}
              */}
              {isPendingPayment(o) && activeTab === "delivered" && (
                <button
                  onClick={() => markAsPaid(o.id)}
                  className="flex items-center gap-2"
                  style={{ marginTop: "12px", background: "var(--color-primary)", color: "var(--color-inverse)", fontFamily: INTER, fontWeight: 700, fontSize: "13px", padding: "8px 14px", borderRadius: "10px", boxShadow: "0px 2px 6px rgba(0,0,0,0.1)" }}
                >
                  <Banknote size={15} /> Mark Payment as Paid
                </button>
              )}
            </div>
          </div>

          {/* Ordered Products */}
          <div style={{ paddingTop: "32px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
              <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: "18px", color: "var(--color-ink)" }}>Ordered Products</h3>
              <span style={{ background: "var(--color-accent-subtle)", fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-ink)", padding: "4px 12px", borderRadius: "9999px" }}>{productsCount} ITEMS</span>
            </div>
            <div className="flex flex-col gap-3">
              {(o.products || []).map((p, i) => (
                <div key={i} className="flex items-center gap-5" style={{ background: "color-mix(in srgb, var(--color-surface) 50%, transparent)", border: "1px solid var(--color-border)", borderRadius: "24px", padding: "20px" }}>
                  <span className="flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ width: "64px", height: "64px", background: "color-mix(in srgb, var(--color-accent) 20%, transparent)", borderRadius: "12px" }}>
                    {(p.thumbnail || p.image || productImages[p.productId]) ? <img src={p.thumbnail || p.image || productImages[p.productId]} alt={p.title} className="w-full h-full object-cover" /> : <Package size={22} style={{ color: "var(--color-primary)" }} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }} className="truncate">{p.title}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "12px", color: "var(--color-body)" }}>Qty: {p.quantity} •</p>
                      <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-primary)" }}>{formatINR(resolvedFinalPrice(p))} each</p>
                      {Number(p.discount) > 0 && (
                        <p style={{ fontFamily: INTER, fontWeight: 400, fontSize: "11px", color: "var(--color-muted)", textDecoration: "line-through" }}>{formatINR(p.originalPrice ?? p.price ?? 0)}</p>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontFamily: INTER, fontWeight: 800, fontSize: "18px", color: "var(--color-ink)" }}>{formatINR(resolvedFinalPrice(p) * p.quantity)}</p>
                    {Number(p.discount) > 0 && (
                      <p style={{ fontFamily: INTER, fontWeight: 400, fontSize: "11px", color: "var(--color-muted)" }}>{Math.round(Number(p.discount))}% OFF</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Price Summary + GST breakdown */}
          <div style={{ paddingTop: "32px" }}>
            <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: "18px", color: "var(--color-ink)", marginBottom: "16px" }}>Price Summary</h3>
            <div className="flex flex-col" style={{ gap: "8px", fontFamily: INTER, fontSize: "14px" }}>
              {o.gstEnabled !== false && o.taxableTotal != null && (
                <div className="flex justify-between"><span style={{ color: "var(--color-body)" }}>Taxable Value</span><span style={{ fontWeight: 600, color: "var(--color-ink)" }}>{formatINR(o.taxableTotal)}</span></div>
              )}
              {o.gstEnabled !== false && o.taxableTotal != null && (o.isInterState ? (
                <div className="flex justify-between"><span style={{ color: "var(--color-body)" }}>IGST</span><span style={{ fontWeight: 600, color: "var(--color-ink)" }}>{formatINR(o.totalIgst)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between"><span style={{ color: "var(--color-body)" }}>CGST</span><span style={{ fontWeight: 600, color: "var(--color-ink)" }}>{formatINR(o.totalCgst)}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--color-body)" }}>SGST</span><span style={{ fontWeight: 600, color: "var(--color-ink)" }}>{formatINR(o.totalSgst)}</span></div>
                </>
              ))}
              {Number(o.shipping) > 0 && (
                <div className="flex justify-between"><span style={{ color: "var(--color-body)" }}>Shipping</span><span style={{ fontWeight: 600, color: "var(--color-ink)" }}>{formatINR(o.shipping)}</span></div>
              )}
              {Number(o.promoDiscount) > 0 && (
                <div className="flex justify-between"><span style={{ color: "var(--color-body)" }}>Promo Discount{o.promoCode ? ` (${o.promoCode})` : ""}</span><span style={{ fontWeight: 600, color: "var(--color-success)" }}>-{formatINR(o.promoDiscount)}</span></div>
              )}
              <div className="flex justify-between" style={{ borderTop: "1px dashed var(--color-border)", paddingTop: "10px", marginTop: "4px" }}>
                <span style={{ fontWeight: 800, color: "var(--color-ink)" }}>Grand Total</span>
                <span style={{ fontWeight: 800, color: "var(--color-primary)" }}>{formatINR(o.total)}</span>
              </div>
            </div>
          </div>

          {/* Bottom actions */}
          <div className="flex flex-col gap-3" style={{ paddingTop: "32px", borderTop: "1px solid var(--color-border)" }}>
            {/* Mark as Paid — shown for COD and WhatsApp orders with pending payment */}
            {isPendingPayment(o) && (
              <button
                onClick={() => markAsPaid(o.id)}
                className="w-full flex items-center justify-center gap-2 text-inverse"
                style={{ background: "var(--color-primary)", borderRadius: "24px", height: "56px", fontFamily: INTER, fontWeight: 700, fontSize: "16px", boxShadow: "0px 4px 12px rgba(0,0,0,0.15)" }}
              >
                <Banknote size={18} /> Mark Payment as Paid
              </button>
            )}
            <div className="flex gap-4">
              <button onClick={() => downloadInvoice(o)} className="flex items-center justify-center gap-2 text-inverse flex-1" style={{ background: "var(--color-primary)", borderRadius: "24px", height: "64px", fontFamily: INTER, fontWeight: 700, fontSize: "16px" }}>
                <Download size={18} /> Download Invoice
              </button>
              <button onClick={() => window.print()} className="flex items-center justify-center flex-shrink-0" style={{ width: "64px", height: "64px", borderRadius: "24px", border: "2px solid var(--color-border)" }}>
                <Printer size={20} style={{ color: "var(--color-body)" }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ============================== RENDER ============================== */
  return (
    <div
      ref={containerRef}
      className="relative"
      style={{
        flex: 1,
        minHeight: "100vh",
        fontFamily: "'Plus Jakarta Sans','Inter',sans-serif",
        background: "transparent",
        overflowX: "hidden",
      }}
    >

      {/* Main content */}
      <div style={{ padding: isMobile ? "16px 0 48px" : "20px 0 48px", display: "flex", flexDirection: "column" }}>

        {/* KPI cards — Pelago style: white, rounded-2xl, teal accent */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: "12px", padding: `0 ${sidePad}`, marginBottom: isMobile ? "20px" : "28px" }}>
          {[
            { label: "Total Orders",          value: loading ? "…" : total,          badge: "+12.4%",        badgeBg: "#E5F6EE", badgeColor: "#0F6848" },
            { label: "Awaiting Confirmation",  value: loading ? "…" : placedCount,    badge: "Action Required", badgeBg: "#FDF0E2", badgeColor: "#A75C1C" },
            { label: "In Transit",             value: loading ? "…" : shippedCount,   badge: null,           badgeBg: null,      badgeColor: null },
            { label: "Delivered",              value: loading ? "…" : deliveredCount, badge: null,           badgeBg: null,      badgeColor: null },
          ].map(card => (
            <div key={card.label} className="analytics-card" style={{ background: "#fff", border: "1px solid #E4DDD3", borderRadius: "16px", padding: "14px", boxShadow: "0 1px 2px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "90px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", marginBottom: "8px" }}>{card.label}</div>
              <div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#1C1917", lineHeight: 1 }}>{card.value}</div>
                {card.badge && (
                  <div style={{ marginTop: "6px" }}>
                    <span style={{ display: "inline-block", background: card.badgeBg, color: card.badgeColor, fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px" }}>{card.badge}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Tab bar + search — tabs on the left, search on the right (stacks below
            the tabs on narrow screens). Tabs scroll horizontally if they overflow. */}
        <div className={`flex ${isMobile ? "flex-col gap-3" : "items-center gap-6"}`} style={{ borderBottom: "1px solid var(--color-border)", padding: `0 ${sidePad}`, paddingBottom: isMobile ? "12px" : "0" }}>
          <div className="flex no-scrollbar" style={{ overflowX: "auto", ...(isMobile ? {} : { flex: 1, minWidth: 0 }) }}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key
              const count = ordersForTab(tab).length
              return (
                <button
                  key={tab.key}
                  onClick={() => switchTab(tab.key)}
                  className="flex items-center flex-shrink-0"
                  style={{
                    gap: "10px",
                    padding: isMobile ? "16px 16px" : "20px 32px",
                    whiteSpace: "nowrap",
                    fontFamily: INTER,
                    fontSize: "15px",
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? tab.color : "var(--color-ink)",
                    opacity: isActive ? 1 : 0.6,
                    borderBottom: `3px solid ${isActive ? tab.color : "transparent"}`,
                    background: "transparent",
                    transition: "all 0.2s ease",
                  }}
                >
                  {isActive && <span style={{ width: "8px", height: "20px", background: tab.color, borderRadius: "9999px" }} />}
                  {tab.title}
                  <span style={{
                    fontFamily: MONO, fontWeight: 700, fontSize: "12px", borderRadius: "9999px",
                    padding: "3px 10px", minWidth: "28px", textAlign: "center",
                    ...(isActive ? { background: tab.activeBadgeBg, color: tab.color } : INACTIVE_BADGE),
                  }}>{count}</span>
                </button>
              )
            })}
          </div>
          <div className="flex-shrink-0" style={{ width: isMobile ? "100%" : "340px" }}>
            <SearchBar
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search by Order ID or customer…"
            />
          </div>
        </div>

        {/* Tab panels — all three stay mounted so each keeps its own page/search state */}
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key
          const rawList = ordersForTab(tab)
          const EmptyIcon = tab.emptyIcon

          // Apply payment mode filter to all tabs
          const modeFiltered = paymentModeFilter !== "all"
            ? rawList.filter((o) => String(o.paymentMethod || "").toLowerCase() === paymentModeFilter)
            : rawList

          // For delivered tab, additionally apply paid/unpaid filter
          const list = tab.key === "delivered" && paymentFilter !== "all"
            ? modeFiltered.filter((o) => {
                const isPaid = String(o.paymentStatus || "").toLowerCase() === "paid"
                return paymentFilter === "paid" ? isPaid : !isPaid
              })
            : modeFiltered

          return (
            <div
              key={tab.key}
              className={`tab-panel tab-panel-${tab.key} ${isActive ? "" : "hidden"}`}
              style={{ padding: isMobile ? "24px 16px" : "40px 48px", minHeight: "calc(100vh - 300px)" }}
            >
              {/* Panel header */}
              <div className={`flex ${isMobile ? "flex-col gap-4" : "items-start justify-between"}`} style={{ marginBottom: isMobile ? "20px" : "32px" }}>
                <div className="flex items-center gap-3 sm:gap-4">
                  <span style={{ width: "8px", height: isMobile ? "28px" : "40px", background: tab.color, borderRadius: "9999px", flexShrink: 0 }} />
                  <h2 style={{ fontFamily: MANROPE, fontWeight: 800, fontSize: isMobile ? "22px" : "32px", color: "var(--color-ink)", letterSpacing: isMobile ? "-0.5px" : "-1px", textTransform: "uppercase" }}>{tab.title}</h2>
                  <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: isMobile ? "14px" : "18px", borderRadius: "9999px", padding: isMobile ? "4px 12px" : "6px 16px", background: tab.activeBadgeBg, color: tab.color, flexShrink: 0 }}>{list.length}</span>
                </div>

                {/* Filters column: payment mode (all tabs) + paid/unpaid (delivered only) */}
                <div className="flex flex-col gap-2" style={{ flexShrink: 0, alignItems: isMobile ? "flex-start" : "flex-end" }}>

                  {/* Payment mode filter — all tabs */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontFamily: INTER, fontWeight: 600, fontSize: "11px", color: "var(--color-muted)", letterSpacing: "0.5px", textTransform: "uppercase" }}>Mode</span>
                    {[
                      { key: "all", label: "All" },
                      { key: "cod", label: "COD" },
                      { key: "razorpay", label: "Razorpay" },
                      { key: "whatsapp", label: "WhatsApp" },
                    ].map((f) => {
                      const active = paymentModeFilter === f.key
                      return (
                        <button
                          key={f.key}
                          onClick={() => setPaymentModeFilter(f.key)}
                          style={{
                            fontFamily: INTER,
                            fontWeight: 700,
                            fontSize: "12px",
                            padding: "5px 14px",
                            borderRadius: "9999px",
                            border: active ? "none" : "1px solid var(--color-border)",
                            background: active ? tab.color : "var(--color-surface)",
                            color: active ? "var(--color-inverse)" : "var(--color-body)",
                            transition: "all 0.15s ease",
                            cursor: "pointer",
                          }}
                        >
                          {f.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Payment status filter — delivered tab only */}
                  {tab.key === "delivered" && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontFamily: INTER, fontWeight: 600, fontSize: "11px", color: "var(--color-muted)", letterSpacing: "0.5px", textTransform: "uppercase" }}>Status</span>
                      {[
                        { key: "all", label: "All" },
                        { key: "paid", label: "Paid" },
                        { key: "unpaid", label: "Unpaid" },
                      ].map((f) => {
                        const active = paymentFilter === f.key
                        return (
                          <button
                            key={f.key}
                            onClick={() => setPaymentFilter(f.key)}
                            style={{
                              fontFamily: INTER,
                              fontWeight: 700,
                              fontSize: "12px",
                              padding: "5px 14px",
                              borderRadius: "9999px",
                              border: active ? "none" : "1px solid var(--color-border)",
                              background: active
                                ? f.key === "paid"
                                  ? "var(--color-success)"
                                  : f.key === "unpaid"
                                  ? "var(--color-accent-strong)"
                                  : "var(--color-ink)"
                                : "var(--color-surface)",
                              color: active ? "var(--color-inverse)" : "var(--color-body)",
                              transition: "all 0.15s ease",
                              cursor: "pointer",
                            }}
                          >
                            {f.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <PaginatedOrderTable
                orders={list}
                search={searchTerm}
                active={isActive}
                onActivePageChange={handleActivePage}
                loading={loading}
                renderSkeleton={() => <OrderCardSkeletonCard />}
                skeletonCount={6}
                renderItem={(order) => <OrderCard key={order.id} order={order} column={tab.key} />}
                emptyState={
                  <div className="flex flex-col items-center justify-center text-center" style={{ border: "2px dashed var(--color-border)", borderRadius: "32px", padding: "80px 48px", background: "color-mix(in srgb, var(--color-surface) 40%, transparent)", backdropFilter: "blur(12px)", gap: "16px" }}>
                    <EmptyIcon size={48} style={{ color: tab.color, opacity: 0.3 }} />
                    <p style={{ fontFamily: MANROPE, fontWeight: 800, fontSize: "28px", color: "var(--color-ink)", letterSpacing: "-0.5px" }}>{tab.emptyTitle}</p>
                    <p style={{ fontFamily: INTER, fontWeight: 500, fontSize: "16px", color: "var(--color-body)", opacity: 0.6 }}>All quiet here. New orders will appear instantly.</p>
                  </div>
                }
              />
            </div>
          )
        })}
      </div>

      {/* Backdrop + Drawer (inlined so its DOM node stays stable across re-renders) */}
      {selectedOrder && (
        <div className="fixed inset-0" style={{ zIndex: 40, background: "var(--color-overlay)" }} onClick={closeDrawer} />
      )}
      {Drawer()}
      {shipTarget && (
        <ShipOrderModal
          key={shipTarget.id}
          order={shipTarget}
          onClose={() => setShipTarget(null)}
          onDone={() => { setShipTarget(null); refreshOrders() }}
        />
      )}
      {cancelTarget && (
        <CancelOrderModal
          key={cancelTarget.id}
          order={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); setSelectedOrder((prev) => (prev && prev.id === cancelTarget.id ? null : prev)); refreshOrders() }}
        />
      )}
    </div>
  )
}

export default AdminOrdersPage