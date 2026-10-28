/**
 * AdminDashboard — Pelago Command Center & Overview
 * Route: /admin/dashboard
 *
 * Implements the complete design from Dashboard.html with:
 * - Dynamic date range filter: Today | Last 7 Days | Last 30 Days | Last 90 Days | Last 6 Months | All Time | Custom
 * - Top header placement replacing the search bar
 * - Reactive data hydration for all sections based on active date range
 * - Real Supabase data hydration (Orders, Revenue, Inventory, Kiln queue)
 * - Channel share breakdowns (Online Shop / Razorpay, WhatsApp, COD)
 * - Directly connected to The Packing Bench (Confirmed Orders tab) from /admin/myorders?view=pack
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useSelector } from "react-redux"
import { toast } from "react-toastify"
import * as XLSX from "xlsx"
import {
  Search,
  Moon,
  Bell,
  Plus,
  ArrowRight,
  TrendingUp,
  Package,
  Boxes,
  ShoppingBag,
  Clock,
  Flame,
  BarChart3,
  Star,
  DollarSign,
  Coffee,
  CheckCircle2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  X,
  CreditCard,
  IndianRupee,
  Layers,
  Sparkles,
  Eye,
} from "lucide-react"
import { supabase } from "../../context/SupabaseConfig"
import { mapOrderRows } from "../../utils/supabaseOrders"
import { queryOrdersWithShipments } from "../../services/shipping"

/* ── Pelago Design Tokens ─────────────────────────────────────────── */
const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const MONO = "'JetBrains Mono', monospace"

const TEAL = "#104945"
const TEAL_DARK = "#0D3C38"
const TEAL_SAGE = "#DCE8E0"
const TEAL_MINT = "#ECFDF5"
const OCHRE = "#C4975D"
const TERRACOTTA = "#BE413B"
const SAND = "#E5DFD5"
const BORDER = "#E2DBD0"
const CANVAS = "#ECE7E1"
const CHARCOAL = "#1A2421"
const MUTED = "#717A76"
const WHITE = "#FFFFFF"

/* ── Date Ranges Standard Definition ───────────────────────────────── */
export const DATE_RANGES = [
  "Today",
  "Last 7 Days",
  "Last 30 Days",
  "Last 90 Days",
  "Last 6 Months",
  "All Time",
  "Custom",
]

export const getDateBounds = (range = "Last 30 Days", customFrom = "", customTo = "") => {
  const norm = String(range || "").trim().toLowerCase()
  const now = new Date()
  let startDate = new Date(0)
  let endDate = new Date(now)
  let prevStart = new Date(0)
  let prevEnd = new Date(0)
  let isAllTime = false
  let label = "All Time"

  if (norm === "today") {
    startDate = new Date(now)
    startDate.setHours(0, 0, 0, 0)
    endDate = new Date(now)
    endDate.setHours(23, 59, 59, 999)
    prevStart = new Date(startDate.getTime() - 86400000)
    prevEnd = new Date(startDate.getTime() - 1)
    label = "Today"
  } else if (norm === "last 7 days" || norm === "7d") {
    startDate = new Date(now.getTime() - 7 * 86400000)
    endDate = new Date(now)
    prevStart = new Date(startDate.getTime() - 7 * 86400000)
    prevEnd = new Date(startDate.getTime() - 1)
    label = "Last 7 Days"
  } else if (norm === "last 30 days" || norm === "30d") {
    startDate = new Date(now.getTime() - 30 * 86400000)
    endDate = new Date(now)
    prevStart = new Date(startDate.getTime() - 30 * 86400000)
    prevEnd = new Date(startDate.getTime() - 1)
    label = "Last 30 Days"
  } else if (norm === "last 90 days" || norm === "90d") {
    startDate = new Date(now.getTime() - 90 * 86400000)
    endDate = new Date(now)
    prevStart = new Date(startDate.getTime() - 90 * 86400000)
    prevEnd = new Date(startDate.getTime() - 1)
    label = "Last 90 Days"
  } else if (norm === "last 6 months" || norm === "6m") {
    startDate = new Date(now.getTime() - 180 * 86400000)
    endDate = new Date(now)
    prevStart = new Date(startDate.getTime() - 180 * 86400000)
    prevEnd = new Date(startDate.getTime() - 1)
    label = "Last 6 Months"
  } else if (norm === "custom") {
    const valid =
      customFrom &&
      customTo &&
      !isNaN(new Date(customFrom).getTime()) &&
      !isNaN(new Date(customTo).getTime())
    if (valid) {
      startDate = new Date(customFrom)
      startDate.setHours(0, 0, 0, 0)
      endDate = new Date(customTo)
      endDate.setHours(23, 59, 59, 999)
      const duration = Math.max(86400000, endDate.getTime() - startDate.getTime())
      prevStart = new Date(startDate.getTime() - duration)
      prevEnd = new Date(startDate.getTime() - 1)
      label = `${customFrom} – ${customTo}`
    } else {
      startDate = new Date(now.getTime() - 30 * 86400000)
      endDate = new Date(now)
      prevStart = new Date(startDate.getTime() - 30 * 86400000)
      prevEnd = new Date(startDate.getTime() - 1)
      label = "Custom"
    }
  } else {
    // All Time
    isAllTime = true
    startDate = new Date(0)
    endDate = new Date(8640000000000000)
    prevStart = null
    prevEnd = null
    label = "All Time"
  }

  return { startDate, endDate, prevStart, prevEnd, isAllTime, label }
}

/* ── Helper Formatters ────────────────────────────────────────────── */
const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`

const formatCompactINR = (n) => {
  const num = Number(n || 0)
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`
  if (num >= 1000) return `₹${(num / 1000).toFixed(1)}k`
  return `₹${num.toLocaleString("en-IN")}`
}

const relativeTime = (dateStr) => {
  if (!dateStr) return "recently"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return "recently"
  const diffMs = Date.now() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMs / 3600000)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 1) return "yesterday"
  return `${diffDays}d ago`
}

/* ── Order Channel Formatter ──────────────────────────────────────── */
const getOrderChannel = (ord) => {
  const method = String(ord.paymentMethod || "").toLowerCase()
  const source = String(ord.source || "").toLowerCase()
  if (source === "whatsapp" || method === "whatsapp") {
    return { name: "WhatsApp", color: "#16A34A", dot: "bg-emerald-500" }
  }
  if (source === "billing" || method === "billing") {
    return { name: "Studio POS", color: "#C4975D", dot: "bg-[#C4975D]" }
  }
  if (["cod", "cash on delivery"].includes(method)) {
    return { name: "Cash on Delivery", color: "#D97706", dot: "bg-amber-500" }
  }
  if (method === "razorpay") {
    return { name: "Razorpay", color: "#104945", dot: "bg-[#104945]" }
  }
  return { name: "Online Shop", color: "#104945", dot: "bg-[#104945]" }
}

/* ── Order Status Badge Formatter ─────────────────────────────────── */
const getOrderStatusBadge = (ord) => {
  const pStatus = String(ord.paymentStatus || "").toLowerCase()
  const pMethod = String(ord.paymentMethod || "").toLowerCase()
  const oStatus = String(ord.orderStatus || "").toLowerCase()

  if (pStatus === "paid") {
    return {
      label: "Paid",
      badgeClass: "text-emerald-700 bg-emerald-50 border border-emerald-200",
    }
  }
  if (["cod", "cash on delivery"].includes(pMethod)) {
    return {
      label: "COD • To Pack",
      badgeClass: "text-amber-800 bg-amber-50 border border-amber-200",
    }
  }
  if (pStatus === "pending") {
    return {
      label: "Pending",
      badgeClass: "text-amber-700 bg-amber-50 border border-amber-200",
    }
  }
  if (oStatus === "confirmed" || oStatus === "placed") {
    return {
      label: "Confirmed",
      badgeClass: "text-[#104945] bg-[#DCE8E0] border border-[#104945]/20",
    }
  }
  return {
    label: oStatus || "Confirmed",
    badgeClass: "text-[#104945] bg-[#DCE8E0] border border-[#104945]/20",
  }
}

/* ── Custom CSS Patterns (embedded) ───────────────────────────────── */
const styles = `
  .stripe-pattern {
    background-image: repeating-linear-gradient(
      -45deg,
      #104945,
      #104945 6px,
      #165853 6px,
      #165853 12px
    );
  }
  .stripe-pattern-muted {
    background-image: repeating-linear-gradient(
      -45deg,
      #D5CEC4,
      #D5CEC4 4px,
      #E3DCD3 4px,
      #E3DCD3 8px
    );
  }
  .dots-pattern {
    background-image: radial-gradient(circle, #8F9E97 1.5px, transparent 1.5px);
    background-size: 6px 6px;
  }
`

const AdminDashboard = () => {
  const navigate = useNavigate()
  const user = useSelector((s) => s.user.user)
  const firstName = (user?.name || "Noor").split(" ")[0]

  /* ── Filter State (Standard Analytics Filter) ── */
  const [activeDateRange, setActiveDateRange] = useState("Last 30 Days")
  const [customFrom, setCustomFrom] = useState(() =>
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  )
  const [customTo, setCustomTo] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [ordersSearchQuery, setOrdersSearchQuery] = useState("")
  const [compareLastYear, setCompareLastYear] = useState(true)

  /* ── Live Data State ── */
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalOrders: 0,
    todayOrders: 0,
    todayRevenue: 0,
    monthOrders: 0,
    monthRevenue: 0,
    toPack: 0,
    runningLowCount: 0,
    confirmed: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
    pendingReturns: 0,
  })

  const [allOrders, setAllOrders] = useState([])
  const [allProducts, setAllProducts] = useState([])
  const [lowStockProducts, setLowStockProducts] = useState([])

  const fetchOrdersRef = useRef(null)

  /* ── Fetch Live Data ── */
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayISO = todayStart.toISOString()

      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const monthISO = monthStart.toISOString()

      const [
        ordersResult,
        { data: todayRows },
        { data: monthRows },
        { count: returnsCount },
        { data: productsRows },
      ] = await Promise.all([
        queryOrdersWithShipments(
          (select) =>
            supabase
              .from("orders")
              .select(select)
              .order("created_at", { ascending: false }),
          { admin: true }
        ),
        supabase.from("orders").select("id, total, total_amount, created_at").gte("created_at", todayISO),
        supabase.from("orders").select("id, total, total_amount, created_at").gte("created_at", monthISO),
        supabase.from("return_requests").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
        supabase
          .from("products")
          .select("id, title, price, stock, category, image, thumbnail")
          .order("stock", { ascending: true }),
      ])

      const rawOrders = mapOrderRows(ordersResult?.data || [])
      setAllOrders(rawOrders)

      const toPackOrders = rawOrders.filter((o) =>
        ["placed", "confirmed"].includes(o.orderStatus)
      )

      const todaySum = (todayRows || []).reduce(
        (sum, o) => sum + Number(o.total || o.total_amount || 0),
        0
      )
      const monthSum = (monthRows || []).reduce(
        (sum, o) => sum + Number(o.total || o.total_amount || 0),
        0
      )

      const lowStock = (productsRows || []).filter((p) => Number(p.stock || 0) <= 5)
      const shippedCount = rawOrders.filter((o) => o.orderStatus === "shipped").length
      const deliveredCount = rawOrders.filter((o) => o.orderStatus === "delivered").length
      const cancelledCount = rawOrders.filter((o) => o.orderStatus === "cancelled").length

      setStats({
        totalOrders: rawOrders.length,
        todayOrders: todayRows?.length || 0,
        todayRevenue: todaySum || 0,
        monthOrders: monthRows?.length || 0,
        monthRevenue: monthSum || 0,
        toPack: toPackOrders.length,
        runningLowCount: lowStock.length,
        confirmed: toPackOrders.length,
        shipped: shippedCount,
        delivered: deliveredCount,
        cancelled: cancelledCount,
        pendingReturns: returnsCount || 0,
      })

      setAllProducts(productsRows || [])
      setLowStockProducts(lowStock)
    } catch (err) {
      console.error("Dashboard data error:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    fetchOrdersRef.current = fetchData

    // Realtime subscription for immediate order updates
    const channel = supabase
      .channel("admin-dashboard-realtime-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => fetchOrdersRef.current?.()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipments" },
        () => fetchOrdersRef.current?.()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchData])

  /* ── Compute Active Date Bounds ── */
  const dateBounds = useMemo(() => {
    return getDateBounds(activeDateRange, customFrom, customTo)
  }, [activeDateRange, customFrom, customTo])

  /* ── Filter Orders based on active date range ── */
  const { filteredOrders, prevOrders } = useMemo(() => {
    const { startDate, endDate, prevStart, prevEnd, isAllTime } = dateBounds
    const cur = []
    const prev = []

    ;(allOrders || []).forEach((ord) => {
      const rawDate = ord.createdAt || ord.date || ord.created_at
      const d = rawDate ? new Date(rawDate) : null
      if (!d || isNaN(d.getTime())) return

      if (isAllTime || (d >= startDate && d <= endDate)) {
        cur.push(ord)
      } else if (prevStart && prevEnd && d >= prevStart && d <= prevEnd) {
        prev.push(ord)
      }
    })

    return { filteredOrders: cur, prevOrders: prev }
  }, [allOrders, dateBounds])

  /* ── Core Metrics for Filtered Period ── */
  const currentRevenue = useMemo(() => {
    return filteredOrders.reduce(
      (sum, o) => sum + Number(o.total || o.totalAmount || 0),
      0
    )
  }, [filteredOrders])

  const prevRevenue = useMemo(() => {
    return prevOrders.reduce(
      (sum, o) => sum + Number(o.total || o.totalAmount || 0),
      0
    )
  }, [prevOrders])

  const revGrowth = useMemo(() => {
    if (prevRevenue === 0) {
      return { pct: currentRevenue > 0 ? 100 : 0, isPositive: true }
    }
    const diff = ((currentRevenue - prevRevenue) / prevRevenue) * 100
    return {
      pct: Math.abs(Math.round(diff * 10) / 10),
      isPositive: diff >= 0,
    }
  }, [currentRevenue, prevRevenue])

  const totalSalesUnits = useMemo(() => {
    return filteredOrders.reduce(
      (sum, o) =>
        sum +
        (o.products || []).reduce(
          (pSum, it) => pSum + (Number(it.quantity) || 1),
          0
        ),
      0
    )
  }, [filteredOrders])

  const aov = useMemo(() => {
    const count = filteredOrders.length
    return count > 0 ? Math.round(currentRevenue / count) : 0
  }, [filteredOrders, currentRevenue])

  /* ── Channel Share Breakdown for Filtered Period ── */
  const channelStats = useMemo(() => {
    let razorpayRev = 0
    let whatsappRev = 0
    let codRev = 0
    let totalRev = 0

    filteredOrders.forEach((o) => {
      const method = String(o.paymentMethod || "").toLowerCase()
      const source = String(o.source || "").toLowerCase()
      const val = Number(o.total || o.totalAmount || 0)

      if (source === "whatsapp" || method === "whatsapp") {
        whatsappRev += val
      } else if (method.includes("cod") || method.includes("cash")) {
        codRev += val
      } else {
        razorpayRev += val
      }
      totalRev += val
    })

    if (totalRev === 0) {
      return {
        razorpayPct: 0,
        whatsappPct: 0,
        codPct: 0,
        razorpayRev: 0,
        whatsappRev: 0,
        codRev: 0,
        totalRev: 0,
      }
    }

    const razorpayPct = Math.round((razorpayRev / totalRev) * 100)
    const whatsappPct = Math.round((whatsappRev / totalRev) * 100)
    const codPct = Math.max(0, 100 - razorpayPct - whatsappPct)

    return {
      razorpayPct,
      whatsappPct,
      codPct,
      razorpayRev,
      whatsappRev,
      codRev,
      totalRev,
    }
  }, [filteredOrders])

  /* ── 20 Dynamic Revenue Distribution Bars ── */
  const revenueBars = useMemo(() => {
    const BARS_COUNT = 20
    const { startDate, endDate, isAllTime } = dateBounds
    let startMs = startDate.getTime()
    let endMs = endDate.getTime()

    if (isAllTime) {
      const timestamps = filteredOrders
        .map((o) => new Date(o.createdAt || o.date).getTime())
        .filter((t) => !isNaN(t))
      startMs = timestamps.length > 0 ? Math.min(...timestamps) : Date.now() - 30 * 86400000
      endMs = Date.now()
    }

    const span = Math.max(BARS_COUNT * 1000, endMs - startMs)
    const bucketDuration = span / BARS_COUNT
    const bucketSums = new Array(BARS_COUNT).fill(0)

    filteredOrders.forEach((o) => {
      const t = new Date(o.createdAt || o.date).getTime()
      if (isNaN(t)) return
      let idx = Math.floor((t - startMs) / bucketDuration)
      if (idx < 0) idx = 0
      if (idx >= BARS_COUNT) idx = BARS_COUNT - 1
      bucketSums[idx] += Number(o.total || o.totalAmount || 0)
    })

    const maxVal = Math.max(...bucketSums, 1)
    let peakIdx = -1
    let peakVal = 0

    bucketSums.forEach((val, i) => {
      if (val > peakVal) {
        peakVal = val
        peakIdx = i
      }
    })

    return bucketSums.map((val, idx) => ({
      heightPct: val === 0 ? 8 : Math.max(12, Math.round((val / maxVal) * 100)),
      isPeak: idx === peakIdx && peakVal > 0,
      value: val,
    }))
  }, [filteredOrders, dateBounds])

  /* ── Confirmed Orders To Pack in Selected Period ── */
  const filteredConfirmedOrders = useMemo(() => {
    return filteredOrders.filter((o) =>
      ["placed", "confirmed"].includes(o.orderStatus)
    )
  }, [filteredOrders])

  /* ── Export Dashboard Report ── */
  const handleExport = () => {
    try {
      const summaryRows = [
        { Metric: "Filter Period", Value: dateBounds.label },
        { Metric: "Total Orders in Period", Value: filteredOrders.length },
        { Metric: "Total Revenue in Period", Value: currentRevenue },
        { Metric: "Average Order Value (AOV)", Value: aov },
        { Metric: "Total Units Sold", Value: totalSalesUnits },
        { Metric: "Confirmed Orders Awaiting Packing", Value: filteredConfirmedOrders.length },
        { Metric: "Razorpay Revenue Share (%)", Value: `${channelStats.razorpayPct}%` },
        { Metric: "WhatsApp Revenue Share (%)", Value: `${channelStats.whatsappPct}%` },
        { Metric: "COD Revenue Share (%)", Value: `${channelStats.codPct}%` },
      ]
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.json_to_sheet(summaryRows)
      XLSX.utils.book_append_sheet(wb, ws, "Dashboard Summary")
      XLSX.writeFile(
        wb,
        `Pelago_Dashboard_${dateBounds.label.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      )
      toast.success(`Dashboard summary for ${dateBounds.label} exported to Excel.`)
    } catch (err) {
      toast.error("Export failed: " + err.message)
    }
  }

  /* ── Format Date Label ── */
  const dateFormatted = useMemo(() => {
    const d = new Date()
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
  }, [])

  /* ── Paginated Orders in Period (6 per page) ── */
  const ORDERS_PER_PAGE = 6
  const [ordersPage, setOrdersPage] = useState(1)

  useEffect(() => {
    setOrdersPage(1)
  }, [ordersSearchQuery, activeDateRange, customFrom, customTo])

  const allCandidateOrders = useMemo(() => {
    // Confirmed orders matching The Packing Bench from /admin/myorders?view=pack
    const list =
      filteredConfirmedOrders.length > 0
        ? filteredConfirmedOrders
        : filteredOrders
    if (!ordersSearchQuery.trim()) return list
    const q = ordersSearchQuery.toLowerCase().trim()
    return list.filter(
      (o) =>
        String(o.id).toLowerCase().includes(q) ||
        String(o.userName || o.customerName || "").toLowerCase().includes(q) ||
        String(o.paymentMethod || "").toLowerCase().includes(q) ||
        String(o.orderStatus || "").toLowerCase().includes(q) ||
        String(o.source || "").toLowerCase().includes(q)
    )
  }, [filteredConfirmedOrders, filteredOrders, ordersSearchQuery])

  const totalCandidateOrders = allCandidateOrders.length
  const totalPages = Math.max(1, Math.ceil(totalCandidateOrders / ORDERS_PER_PAGE))

  useEffect(() => {
    if (ordersPage > totalPages) {
      setOrdersPage(totalPages)
    }
  }, [ordersPage, totalPages])

  const displayedOrders = useMemo(() => {
    const start = (ordersPage - 1) * ORDERS_PER_PAGE
    return allCandidateOrders.slice(start, start + ORDERS_PER_PAGE)
  }, [allCandidateOrders, ordersPage])

  const fromIndex = totalCandidateOrders === 0 ? 0 : (ordersPage - 1) * ORDERS_PER_PAGE + 1
  const toIndex = Math.min(ordersPage * ORDERS_PER_PAGE, totalCandidateOrders)

  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    const pages = []
    let start = Math.max(1, ordersPage - 1)
    let end = Math.min(totalPages, start + 2)
    start = Math.max(1, end - 2)

    if (start > 1) {
      pages.push(1)
      if (start > 2) pages.push("…")
    }
    for (let p = start; p <= end; p++) {
      pages.push(p)
    }
    if (end < totalPages) {
      if (end < totalPages - 1) pages.push("…")
      pages.push(totalPages)
    }
    return pages
  }, [ordersPage, totalPages])

  /* ── Best Sellers: Ranked by Revenue in Selected Period ── */
  const BEST_SELLERS_PER_PAGE = 5
  const [bestSellersPage, setBestSellersPage] = useState(1)

  useEffect(() => {
    setBestSellersPage(1)
  }, [activeDateRange, customFrom, customTo])

  const bestSellersList = useMemo(() => {
    const catalogById = {}
    ;(allProducts || []).forEach((p) => {
      if (p?.id) catalogById[p.id] = p
    })

    const productStats = {}

    filteredOrders.forEach((ord) => {
      const items = ord.products || []
      items.forEach((it) => {
        const pid = it.productId || it.product_id || it.id || it.title || "item"
        const catObj = catalogById[pid]
        const name = it.title || it.productTitle || catObj?.title || pid
        const category = catObj?.category || it.category || "General"
        const qty = Number(it.quantity) || 1
        const unitPrice = Number(it.finalPrice ?? it.unitPrice ?? it.price ?? catObj?.price ?? 0)
        const lineTotal = Number(it.lineTotal) > 0 ? Number(it.lineTotal) : unitPrice * qty

        if (!productStats[name]) {
          productStats[name] = {
            id: pid,
            name,
            category,
            units: 0,
            rev: 0,
          }
        }
        productStats[name].units += qty
        productStats[name].rev += lineTotal
      })
    })

    const list = Object.values(productStats).sort((a, b) => b.rev - a.rev)

    if (list.length === 0) {
      return []
    }

    const maxRev = list[0]?.rev || 1

    const swatches = [
      "bg-[#C7B299]",
      "bg-[#104945]",
      "bg-teal-700",
      "bg-[#E4DDD3]",
      "bg-[#BE413B]",
      "bg-[#A8B2A9]",
      "bg-[#C4975D]",
      "bg-amber-700",
      "bg-emerald-700",
    ]

    return list.map((item, idx) => ({
      ...item,
      rank: idx + 1,
      desc: `${item.units} ${item.units === 1 ? "piece" : "pieces"} · ${item.category}`,
      barPct: Math.max(10, Math.min(100, Math.round((item.rev / maxRev) * 100))),
      swatch: swatches[idx % swatches.length],
    }))
  }, [filteredOrders, allProducts])

  const totalBestSellers = bestSellersList.length
  const totalBestSellerPages = Math.max(1, Math.ceil(totalBestSellers / BEST_SELLERS_PER_PAGE))

  useEffect(() => {
    if (bestSellersPage > totalBestSellerPages) {
      setBestSellersPage(totalBestSellerPages)
    }
  }, [bestSellersPage, totalBestSellerPages])

  const displayedBestSellers = useMemo(() => {
    const start = (bestSellersPage - 1) * BEST_SELLERS_PER_PAGE
    return bestSellersList.slice(start, start + BEST_SELLERS_PER_PAGE)
  }, [bestSellersList, bestSellersPage])

  const bsFrom = totalBestSellers === 0 ? 0 : (bestSellersPage - 1) * BEST_SELLERS_PER_PAGE + 1
  const bsTo = Math.min(bestSellersPage * BEST_SELLERS_PER_PAGE, totalBestSellers)

  /* ── Category Revenue Contribution Calculation in Selected Period ── */
  const categoryRevenueStats = useMemo(() => {
    const catalogById = {}
    ;(allProducts || []).forEach((p) => {
      if (p?.id) catalogById[p.id] = p
    })

    const catRevMap = {}
    let totalRev = 0

    filteredOrders.forEach((ord) => {
      const items = ord.products || []
      items.forEach((it) => {
        const pid = it.productId || it.product_id || it.id || it.title || "item"
        const catObj = catalogById[pid]
        const catName = catObj?.category || it.category || "Ceramics"
        const qty = Number(it.quantity) || 1
        const unitPrice = Number(it.finalPrice ?? it.unitPrice ?? it.price ?? catObj?.price ?? 0)
        const lineTotal = Number(it.lineTotal) > 0 ? Number(it.lineTotal) : unitPrice * qty

        catRevMap[catName] = (catRevMap[catName] || 0) + lineTotal
        totalRev += lineTotal
      })
    })

    const palette = [
      { color: "#104945", bg: "bg-[#104945]" },
      { color: "#C4975D", bg: "bg-[#C4975D]" },
      { color: "#BE413B", bg: "bg-[#BE413B]" },
      { color: "#0D9488", bg: "bg-teal-600" },
      { color: "#D97706", bg: "bg-amber-600" },
      { color: "#059669", bg: "bg-emerald-600" },
      { color: "#64748B", bg: "bg-slate-500" },
      { color: "#8B5CF6", bg: "bg-violet-500" },
      { color: "#EC4899", bg: "bg-pink-500" },
    ]

    if (totalRev === 0 || Object.keys(catRevMap).length === 0) {
      return {
        totalRevenue: 0,
        topCategory: { name: "No Sales", share: 0, amount: 0 },
        categories: [],
      }
    }

    const sortedCats = Object.entries(catRevMap)
      .map(([name, amount], i) => {
        const share = totalRev > 0 ? Math.round((amount / totalRev) * 100) : 0
        const style = palette[i % palette.length]
        return {
          name,
          amount,
          share,
          color: style.color,
          bg: style.bg,
        }
      })
      .sort((a, b) => b.amount - a.amount)

    const topCategory = sortedCats[0] || { name: "Ceramics", share: 100, amount: totalRev }

    return {
      totalRevenue: totalRev,
      topCategory,
      categories: sortedCats,
    }
  }, [filteredOrders, allProducts])

  /* ── Right Column Period Insights (Demand by Category) ── */
  const periodInsights = useMemo(() => {
    const customerSpend = {}
    let onlineRev = 0
    let studioRev = 0
    let wholesaleRev = 0

    filteredOrders.forEach((o) => {
      const name = o.userName || o.customerName || "Customer"
      const val = Number(o.total || o.totalAmount || 0)
      customerSpend[name] = (customerSpend[name] || 0) + val

      const src = String(o.source || "").toLowerCase()
      const m = String(o.paymentMethod || "").toLowerCase()
      if (src === "billing" || m === "billing") {
        studioRev += val
      } else if (src === "wholesale") {
        wholesaleRev += val
      } else {
        onlineRev += val
      }
    })

    const sortedBuyers = Object.entries(customerSpend).sort((a, b) => b[1] - a[1])
    const topBuyer = sortedBuyers[0]
      ? { name: sortedBuyers[0][0], amount: sortedBuyers[0][1] }
      : { name: "None", amount: 0 }

    const topProduct = bestSellersList[0] || null

    return {
      topBuyer,
      topProduct,
      onlineRev,
      studioRev,
      wholesaleRev,
    }
  }, [filteredOrders, bestSellersList])

  /* ── Live Activity Stream for Filtered Period ── */
  const ACTIVITY_PER_PAGE = 5
  const [activityPage, setActivityPage] = useState(1)

  useEffect(() => {
    setActivityPage(1)
  }, [activeDateRange, customFrom, customTo])

  const activityFeed = useMemo(() => {
    if (filteredOrders.length === 0) return []
    return filteredOrders.map((o) => {
      const ch = getOrderChannel(o)
      return {
        id: o.id,
        name: o.userName || o.customerName || "Customer",
        amount: o.total || o.totalAmount || 0,
        channel: ch.name,
        time: relativeTime(o.createdAt || o.date),
      }
    })
  }, [filteredOrders])

  const totalActivity = activityFeed.length
  const totalActivityPages = Math.max(1, Math.ceil(totalActivity / ACTIVITY_PER_PAGE))

  useEffect(() => {
    if (activityPage > totalActivityPages) {
      setActivityPage(totalActivityPages)
    }
  }, [activityPage, totalActivityPages])

  const displayedActivity = useMemo(() => {
    const start = (activityPage - 1) * ACTIVITY_PER_PAGE
    return activityFeed.slice(start, start + ACTIVITY_PER_PAGE)
  }, [activityFeed, activityPage])

  const actFrom = totalActivity === 0 ? 0 : (activityPage - 1) * ACTIVITY_PER_PAGE + 1
  const actTo = Math.min(activityPage * ACTIVITY_PER_PAGE, totalActivity)

  /* ── 12-hour Clock Calculation (for Radial Card) ── */
  const [clockTime, setClockTime] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setClockTime(new Date()), 10000)
    return () => clearInterval(timer)
  }, [])

  const { currentHourOffset, currentMinuteOffset } = useMemo(() => {
    const hours = clockTime.getHours()
    const minutes = clockTime.getMinutes()
    const circumference = 226.195
    const hourFraction = ((hours % 12) + minutes / 60) / 12
    const minuteFraction = minutes / 60
    return {
      currentHourOffset: -Number((hourFraction * circumference).toFixed(2)),
      currentMinuteOffset: -Number((minuteFraction * circumference).toFixed(2)),
    }
  }, [clockTime])

  /* ── Latest Booked Orders for 'From the kiln' ── */
  const latestBookedOrders = useMemo(() => {
    const source = (filteredOrders.length > 0 ? filteredOrders : allOrders).slice(0, 3)
    if (source.length === 0) return []
    return source.map((o) => {
      const totalPcs = (o.products || []).reduce((sum, it) => sum + (Number(it.quantity) || 1), 0) || 1
      const orderIdLabel = String(o.id).length > 8 ? `#${String(o.id).slice(-6).toUpperCase()}` : `#${o.id}`
      return {
        id: o.id,
        label: orderIdLabel,
        customer: o.userName || o.customerName || "Customer",
        pcs: totalPcs,
        date: relativeTime(o.createdAt || o.date),
        total: o.total || o.totalAmount || 0,
      }
    })
  }, [filteredOrders, allOrders])

  /* ── Lowest Stock Products for 'From the kiln' ── */
  const lowestStockProducts = useMemo(() => {
    const sorted = [...(allProducts || [])]
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
      .slice(0, 3)
    return sorted.map((p) => ({
      id: p.id,
      title: p.title || "Handcrafted Pottery",
      stock: Number(p.stock || 0),
      image: p.image || p.thumbnail || "",
    }))
  }, [allProducts])

  return (
    <>
      <style>{styles}</style>

      <main
        style={{ fontFamily: FONT }}
        className="flex-1 flex flex-col min-w-0 overflow-y-auto px-4 py-5 lg:px-8 text-[#1A2421]"
      >
        {/* ── Top Action Bar (Date Filter Replaces Search Bar) ───────── */}
        <header className="flex items-center justify-between gap-4 pb-5 flex-wrap">
          {/* Date Range Filter Control (Replaces Global Search at top of page) */}
          <div className="flex flex-col gap-2" data-purpose="dashboard-date-filter">
            <nav className="inline-flex items-center bg-[#E4DDD4] p-1 rounded-xl text-[12px] font-medium text-[#78716C] space-x-0.5 shadow-2xs">
              {DATE_RANGES.map((range) => {
                const isActive = activeDateRange === range
                return (
                  <button
                    key={range}
                    onClick={() => setActiveDateRange(range)}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      isActive
                        ? "bg-white text-[#171412] font-semibold shadow-sm"
                        : "hover:text-[#171412]"
                    }`}
                    type="button"
                  >
                    {range}
                  </button>
                )
              })}
            </nav>

            {/* Custom Date Range Picker */}
            {activeDateRange === "Custom" && (
              <div className="inline-flex flex-wrap items-center gap-2 bg-[#F6F3EE] border border-[#DDD6CB] rounded-xl px-3 py-1.5 text-xs text-[#524B41] max-w-fit shadow-xs">
                <span className="font-bold text-[#1C1814]">From:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  max={customTo || undefined}
                  className="bg-white border border-[#D5CCC0] rounded-lg px-2.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[#104945]"
                />
                <span className="font-bold text-[#1C1814]">To:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  min={customFrom || undefined}
                  className="bg-white border border-[#D5CCC0] rounded-lg px-2.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[#104945]"
                />
                {customFrom && customTo && new Date(customFrom) > new Date(customTo) && (
                  <span className="text-[#B83E28] font-semibold text-[11px]">
                    Start date must be before end date
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right Utility Actions */}
          <div className="flex items-center gap-2.5">
            {/* Live Today Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/80 border border-[#E2DBD0] rounded-full text-xs font-semibold text-[#1A2421] shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                {stats.todayOrders} today{" "}
                <span className="font-bold ml-0.5 text-[#717A76]">
                  {formatCompactINR(stats.todayRevenue)}
                </span>
              </span>
            </div>

            {/* Dark mode button */}
            <button
              type="button"
              onClick={() => toast.info("Theme preference preserved.")}
              aria-label="Theme toggle"
              className="p-2 bg-white/80 hover:bg-white border border-[#E2DBD0] rounded-full text-[#717A76] hover:text-[#1A2421] transition cursor-pointer"
            >
              <Moon className="w-4 h-4" />
            </button>

            {/* Notification bell button */}
            <button
              type="button"
              onClick={() => toast.info("All orders synchronized with Supabase.")}
              aria-label="Notifications"
              className="relative p-2 bg-white/80 hover:bg-white border border-[#E2DBD0] rounded-full text-[#717A76] hover:text-[#1A2421] transition cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#BE413B] rounded-full ring-2 ring-white" />
            </button>

            {/* Export Report Button */}
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-1.5 bg-white/80 hover:bg-white border border-[#E2DBD0] text-[#1A2421] px-3.5 py-1.5 rounded-full text-xs font-semibold shadow-2xs transition cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-[#717A76]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
              <span>Export</span>
            </button>

            {/* New Quick Action */}
            <button
              type="button"
              onClick={() => navigate("/admin/createOrders")}
              className="flex items-center gap-1.5 bg-[#104945] hover:bg-[#0D3C38] text-white px-4 py-1.5 rounded-full text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              <span className="text-sm leading-none">+</span>
              <span>New</span>
            </button>
          </div>
        </header>

        {/* ── Welcome Headline ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-xs text-[#717A76] font-medium mb-1">
              {dateFormatted} · Fernhill Ceramics
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-[#1A2421]">
              Good morning, {firstName}
            </h1>
            <p className="text-xs text-[#717A76] mt-1 max-w-2xl leading-relaxed">
              <strong className="text-[#1A2421] font-semibold">{filteredOrders.length} orders</strong> ({formatINR(currentRevenue)}) in <span className="font-semibold text-[#104945]">{dateBounds.label}</span>.{" "}
              <strong
                onClick={() => navigate("/admin/myorders?view=pack")}
                className="text-[#104945] font-semibold underline cursor-pointer"
              >
                {filteredConfirmedOrders.length} to pack
              </strong>{" "}
              and{" "}
              <strong
                onClick={() => navigate("/admin/inventory")}
                className="text-[#BE413B] font-semibold underline cursor-pointer"
              >
                {stats.runningLowCount} pieces running low
              </strong>
              .
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-[#717A76] bg-white/70 border border-[#E2DBD0] px-3 py-1.5 rounded-full shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#104945]" />
              Showing: <strong className="text-[#1A2421] font-semibold">{dateBounds.label}</strong>
            </span>
          </div>
        </div>

        {/* ── Top Metrics Grid (Hero Cards) ──────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-6" data-purpose="top-metrics">
          {/* Revenue Card (Hero Dark Teal) */}
          <div
            className="lg:col-span-6 bg-[#104945] rounded-[22px] p-5 text-white shadow-sm flex flex-col justify-between relative overflow-hidden"
            data-purpose="revenue-card"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold tracking-wide text-[#DCE8E0]">Revenue</span>
                <span className="text-[11px] font-medium bg-[#1A5954] text-white/90 px-2.5 py-0.5 rounded-full border border-white/10">
                  {dateBounds.label}
                </span>
              </div>

              {/* Main Metric */}
              <div className="flex items-baseline gap-3 mb-1">
                <span className="text-3xl font-extrabold tracking-tight">
                  {formatINR(currentRevenue)}
                </span>
                <span
                  className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                    revGrowth.isPositive
                      ? "bg-[#1F625D] text-emerald-200 border-emerald-400/20"
                      : "bg-[#5A2422] text-rose-200 border-rose-400/20"
                  }`}
                >
                  <TrendingUp
                    className={`w-3 h-3 ${
                      revGrowth.isPositive ? "text-emerald-300" : "text-rose-300 rotate-180"
                    }`}
                  />
                  {revGrowth.isPositive ? `+${revGrowth.pct}%` : `-${revGrowth.pct}%`}
                </span>
              </div>
              <p className="text-[11px] text-white/60 mb-5">
                {dateBounds.isAllTime
                  ? "All-time revenue across all sales channels"
                  : `Revenue in ${dateBounds.label}`}
              </p>

              {/* Bar Chart Visualization (20 bars with peak highlighted in Ochre) */}
              <div
                className="h-24 flex items-end gap-1.5 w-full mb-4 px-1"
                data-purpose="revenue-bar-chart"
              >
                {revenueBars.map((bar, idx) => (
                  <div
                    key={idx}
                    style={{ height: `${bar.heightPct}%` }}
                    className={`flex-1 rounded-xs transition-all ${
                      bar.isPeak ? "bg-[#C4975D] shadow-xs" : "bg-white/25 hover:bg-white/45"
                    }`}
                    title={bar.value > 0 ? formatINR(bar.value) : `Interval ${idx + 1}`}
                  />
                ))}
              </div>

              {/* Channel Share Multi-segment Bar (Razorpay, WhatsApp order, COD) */}
              <div className="w-full flex h-1.5 rounded-full overflow-hidden mb-3">
                <div
                  className="bg-emerald-300 transition-all duration-300"
                  style={{ width: `${channelStats.razorpayPct}%` }}
                  title={`Razorpay ${channelStats.razorpayPct}% (${formatINR(channelStats.razorpayRev)})`}
                />
                <div
                  className="bg-[#C4975D] transition-all duration-300"
                  style={{ width: `${channelStats.whatsappPct}%` }}
                  title={`WhatsApp order ${channelStats.whatsappPct}% (${formatINR(channelStats.whatsappRev)})`}
                />
                <div
                  className="bg-[#BE413B] transition-all duration-300"
                  style={{ width: `${channelStats.codPct}%` }}
                  title={`COD ${channelStats.codPct}% (${formatINR(channelStats.codRev)})`}
                />
              </div>

              {/* Legend (Razorpay, WhatsApp order, COD) */}
              <div className="flex items-center gap-4 text-[11px] text-white/80 mb-5 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-300" />
                  <span>
                    Razorpay <strong className="text-white font-semibold">{channelStats.razorpayPct}%</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#C4975D]" />
                  <span>
                    WhatsApp order <strong className="text-white font-semibold">{channelStats.whatsappPct}%</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#BE413B]" />
                  <span>
                    COD <strong className="text-white font-semibold">{channelStats.codPct}%</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Stat Trio: Total orders, AOV, Total sales */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/10 text-left">
              <div>
                <span className="block text-[10px] text-white/60 font-medium uppercase tracking-wider">
                  Total orders
                </span>
                <span className="text-sm font-bold text-white">
                  {filteredOrders.length}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-white/60 font-medium uppercase tracking-wider">
                  AOV
                </span>
                <span className="text-sm font-bold text-white">
                  {formatINR(aov)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-white/60 font-medium uppercase tracking-wider">
                  Total sales
                </span>
                <span className="text-sm font-bold text-white">
                  {totalSalesUnits.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Today / Period Activity Radial Card */}
          <div
            className="lg:col-span-3 bg-white rounded-[22px] p-5 border border-[#E2DBD0] shadow-2xs flex flex-col justify-between"
            data-purpose="hourly-dial-card"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-[#104945]" />
                  <h3 className="text-xs font-bold text-[#1A2421]">
                    {activeDateRange === "Today" ? "Today, by the hour" : `${dateBounds.label} Pace`}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/admin/myorders?view=pack")}
                  className="text-[11px] text-[#717A76] border border-[#E2DBD0]/80 px-2 py-0.5 rounded-full hover:bg-[#ECE7E1] cursor-pointer"
                >
                  Orders
                </button>
              </div>

              {/* Radial Clock Graph */}
              <div className="relative w-44 h-44 mx-auto my-3 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" fill="none" r="44" stroke="#ECE7E1" strokeWidth="2" />
                  <circle
                    cx="50"
                    cy="50"
                    fill="none"
                    opacity="0.85"
                    r="36"
                    stroke="#104945"
                    strokeDasharray="2 6.5"
                    strokeLinecap="round"
                    strokeWidth="4.5"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    fill="none"
                    r="36"
                    stroke="#BE413B"
                    strokeDasharray="4 222.2"
                    strokeDashoffset={currentHourOffset}
                    strokeLinecap="round"
                    strokeWidth="6.5"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    fill="none"
                    r="36"
                    stroke="#BE413B"
                    strokeDasharray="4 222.2"
                    strokeDashoffset={currentMinuteOffset}
                    strokeLinecap="round"
                    strokeWidth="6.5"
                  />
                </svg>
                <span className="absolute top-0 text-[10px] font-semibold text-[#717A76]">12</span>
                <span className="absolute right-0 text-[10px] font-semibold text-[#717A76]">3</span>
                <span className="absolute bottom-0 text-[10px] font-semibold text-[#717A76]">6</span>
                <span className="absolute left-0 text-[10px] font-semibold text-[#717A76]">9</span>
                <div className="absolute text-center flex flex-col items-center">
                  <span className="text-xl font-extrabold text-[#1A2421] tracking-tight">
                    {filteredOrders.length}
                  </span>
                  <span className="text-[10px] font-medium text-[#717A76]">
                    orders · {formatCompactINR(currentRevenue)}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-[#717A76] leading-tight text-center pt-2 border-t border-[#E2DBD0]/50">
              {activeDateRange === "Today" ? (
                <>Busiest so far: <strong className="text-[#1A2421] font-semibold">12 PM</strong> with {filteredOrders.length} orders.</>
              ) : (
                <><strong className="text-[#1A2421] font-semibold">{filteredOrders.length} orders</strong> placed in {dateBounds.label}.</>
              )}
            </p>
          </div>

          {/* From the kiln (Inventory / Queue) */}
          <div
            className="lg:col-span-3 bg-white rounded-[22px] p-5 border border-[#E2DBD0] shadow-2xs flex flex-col justify-between"
            data-purpose="kiln-status-card"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-[#BE413B]" />
                  <h3 className="text-xs font-bold text-[#1A2421]">From the kiln</h3>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/admin/inventory")}
                  className="text-[11px] text-[#717A76] border border-[#E2DBD0] px-2.5 py-0.5 rounded-full hover:bg-[#ECE7E1] cursor-pointer"
                >
                  Stock
                </button>
              </div>

              {/* BOOKED Subsection: Shows latest 3 orders booked in period */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#717A76]">
                    Booked in Period (Latest 3)
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate("/admin/myorders?view=pack")}
                    className="text-[10px] text-[#104945] font-semibold hover:underline cursor-pointer"
                  >
                    View bench
                  </button>
                </div>
                <div className="space-y-2">
                  {latestBookedOrders.length === 0 ? (
                    <p className="text-[11px] text-[#717A76] py-2">No orders in this period.</p>
                  ) : (
                    latestBookedOrders.map((ord) => (
                      <div
                        key={ord.id}
                        onClick={() => navigate("/admin/myorders?view=pack")}
                        className="flex items-center justify-between group hover:bg-[#ECE7E1]/40 p-1.5 rounded-xl transition cursor-pointer"
                        title="View order details in The Packing Bench"
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <div className="w-6 h-6 rounded-lg bg-[#DCE8E0] text-[#104945] flex items-center justify-center text-[10px] font-bold shadow-2xs shrink-0">
                            <Package className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-semibold text-[#1A2421] leading-tight truncate group-hover:text-[#104945]">
                              {ord.customer}
                            </span>
                            <span className="text-[10px] text-[#717A76] truncate">
                              {ord.label} · {ord.pcs} {ord.pcs === 1 ? "item" : "items"} · {ord.date}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-[#1A2421] shrink-0">
                          {formatINR(ord.total)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* RUNNING LOW Subsection: Shows products that are low in stock */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#BE413B]">
                    Running Low (Stock &le; 5)
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate("/admin/inventory")}
                    className="text-[10px] text-[#BE413B] font-semibold hover:underline cursor-pointer"
                  >
                    Restock
                  </button>
                </div>
                <div className="space-y-2">
                  {lowestStockProducts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => navigate("/admin/inventory")}
                      className="flex items-center justify-between group hover:bg-[#ECE7E1]/40 p-1.5 rounded-xl transition cursor-pointer"
                      title="Manage product inventory"
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        {p.image ? (
                          <img
                            src={p.image}
                            alt={p.title}
                            className="w-6 h-6 rounded-lg object-cover border border-[#E2DBD0] shadow-2xs shrink-0"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-lg bg-[#BE413B]/10 text-[#BE413B] flex items-center justify-center text-[10px] font-bold shadow-2xs shrink-0">
                            🏺
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-[#1A2421] leading-tight truncate group-hover:text-[#BE413B]">
                            {p.title}
                          </span>
                          <span className="text-[10px] text-[#BE413B] font-semibold">
                            {p.stock === 0 ? "Out of stock (0 left)" : `Only ${p.stock} left in stock`}
                          </span>
                        </div>
                      </div>
                      <span className="w-6 h-6 rounded-full border border-[#E2DBD0] flex items-center justify-center text-[#717A76] hover:text-[#1A2421] hover:bg-[#ECE7E1] shrink-0">
                        <Plus className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Demand by Category Section ─────────────────────────────── */}
        <section
          className="bg-white rounded-[22px] p-6 border border-[#E2DBD0] shadow-2xs mb-6"
          data-purpose="demand-by-category"
        >
          {/* Section Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-[#E2DBD0]/60">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-[#DCE8E0]/50 rounded-lg text-[#104945]">
                <BarChart3 className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#1A2421]">Demand by category</h2>
            </div>

            <div className="flex items-center gap-3 text-xs flex-wrap">
              <div className="flex items-center gap-2 text-[#717A76]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#104945]" />
                  <span>Online shop</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#C4975D]" />
                  <span>Studio shop</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#BE413B]" />
                  <span>Wholesale</span>
                </label>
              </div>

              <div className="h-3 w-[1px] bg-[#E2DBD0]" />

              <div className="flex items-center gap-2">
                <span className="text-[#717A76] text-[11px]">Compare Prev Period</span>
                <div
                  onClick={() => setCompareLastYear(!compareLastYear)}
                  className={`w-7 h-4 rounded-full p-0.5 cursor-pointer flex items-center transition-colors ${
                    compareLastYear ? "bg-[#104945] justify-end" : "bg-[#D5CEC4] justify-start"
                  }`}
                >
                  <div className="w-3 h-3 bg-white rounded-full shadow" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate("/admin/add-product?view=analytics")}
                className="flex items-center gap-1 text-[#104945] font-semibold hover:underline cursor-pointer"
              >
                <span>Explore</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Main Visual Layout: Left Categories | Middle Stacked Chart | Right Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5 items-stretch">
            {/* Left Category Breakdown with Sparklines */}
            <div className="lg:col-span-3 space-y-3.5 border-r border-[#E2DBD0]/60 pr-4">
              {/* All Categories */}
              <div className="flex items-center justify-between pb-2 border-b border-[#E2DBD0]/40">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-[#DCE8E0]/60 flex items-center justify-center text-[#104945]">
                    <Layers className="w-3 h-3" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[#1A2421]">All categories</span>
                    <span className="text-[10px] text-[#717A76]">
                      {formatCompactINR(currentRevenue)} · {dateBounds.label}
                    </span>
                  </div>
                </div>
                <svg className="w-12 h-4 text-[#104945]" fill="none" stroke="currentColor" viewBox="0 0 50 16">
                  <path d="M0 12 Q 12 2, 25 10 T 50 4" fill="none" strokeLinecap="round" strokeWidth="2" />
                </svg>
              </div>

              {categoryRevenueStats.categories.length === 0 ? (
                <p className="text-xs text-[#717A76] py-4 text-center">
                  No category sales in {dateBounds.label}
                </p>
              ) : (
                categoryRevenueStats.categories.slice(0, 5).map((cat, idx) => (
                  <div key={cat.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-[#ECE7E1] flex items-center justify-center text-xs">
                        {idx === 0 ? "☕" : idx === 1 ? "🥣" : idx === 2 ? "🏺" : idx === 3 ? "🪴" : "🧺"}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-[#1A2421]">{cat.name}</span>
                        <span className="text-[10px] text-[#717A76]">
                          {formatCompactINR(cat.amount)} · {cat.share}%
                        </span>
                      </div>
                    </div>
                    <svg className="w-12 h-4" style={{ color: cat.color }} fill="none" stroke="currentColor" viewBox="0 0 50 16">
                      <path
                        d={
                          idx % 2 === 0
                            ? "M0 14 Q 15 14, 25 6 T 50 2"
                            : "M0 8 Q 12 14, 25 6 T 50 10"
                        }
                        fill="none"
                        strokeLinecap="round"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </div>
                ))
              )}
            </div>

            {/* Center Stacked Bar Chart */}
            <div
              className="lg:col-span-6 flex flex-col justify-end relative pt-6"
              data-purpose="stacked-monthly-chart"
            >
              {/* Horizontal Grid Lines */}
              <div className="absolute inset-x-0 top-6 bottom-7 flex flex-col justify-between pointer-events-none text-[10px] text-[#717A76]/60">
                <div className="border-b border-[#E2DBD0]/40 w-full flex justify-between">
                  <span>{formatCompactINR(currentRevenue > 0 ? currentRevenue : 150000)}</span>
                </div>
                <div className="border-b border-[#E2DBD0]/40 w-full flex justify-between">
                  <span>{formatCompactINR(Math.round(currentRevenue / 2))}</span>
                </div>
                <div className="border-b border-[#E2DBD0] w-full flex justify-between">
                  <span>₹0</span>
                </div>
              </div>

              {/* Peak Badge */}
              <div className="absolute right-4 top-1 z-10 flex flex-col items-center">
                <span className="bg-[#1A2421] text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                  {formatCompactINR(currentRevenue)}
                </span>
                <div className="w-1.5 h-1.5 bg-[#1A2421] rotate-45 -mt-0.5" />
              </div>

              {/* Monthly Bars Container */}
              <div className="flex items-end justify-between gap-1.5 h-56 pl-8 pr-1 z-0">
                {[
                  { m: "Nov '25", h1: "h-6", h2: "h-8", h3: "h-5" },
                  { m: "Dec", h1: "h-14", h2: "h-12", h3: "h-10" },
                  { m: "Jan '26", h1: "h-8", h2: "h-7", h3: "h-6" },
                  { m: "Feb", h1: "h-9", h2: "h-7", h3: "h-5" },
                  { m: "Mar", h1: "h-10", h2: "h-8", h3: "h-6" },
                  { m: "Apr", h1: "h-12", h2: "h-10", h3: "h-7" },
                  { m: "May", h1: "h-13", h2: "h-10", h3: "h-8" },
                  { m: "Jun", h1: "h-11", h2: "h-8", h3: "h-7" },
                  { m: "Jul", h1: "h-10", h2: "h-7", h3: "h-6" },
                  { m: "Aug", h1: "h-11", h2: "h-9", h3: "h-7" },
                  { m: "Sep", h1: "h-12", h2: "h-10", h3: "h-8" },
                ].map((col, idx) => (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full max-w-[24px] flex flex-col rounded-t-sm overflow-hidden bg-[#E5DFD5]/40">
                      <div className={`dots-pattern bg-[#C5D5CC] ${col.h1}`} />
                      <div className={`dots-pattern bg-[#EBD8C1] ${col.h2}`} />
                      <div className={`dots-pattern bg-[#E6BFB5] ${col.h3}`} />
                    </div>
                    <span className="text-[10px] text-[#717A76] group-hover:text-[#1A2421]">
                      {col.m}
                    </span>
                  </div>
                ))}

                {/* Active Period Highlight Bar */}
                <div className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="w-full max-w-[24px] flex flex-col rounded-t-sm overflow-hidden shadow-sm">
                    <div className="h-28 bg-[#104945]" />
                    <div className="h-4 bg-[#C4975D]" />
                    <div className="h-8 bg-[#BE413B]" />
                  </div>
                  <span className="text-[10px] font-bold text-[#104945] truncate">
                    {dateBounds.label === "Today" ? "Today" : "Active"}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Insights Column */}
            <div className="lg:col-span-3 border-l border-[#E2DBD0]/60 pl-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#1A2421] truncate max-w-[150px]">
                    {dateBounds.label}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    ● active period
                  </span>
                </div>
                <p className="text-[11px] text-[#717A76]">All categories</p>
                <div className="mt-2 mb-1">
                  <span className="text-2xl font-extrabold text-[#1A2421] tracking-tight">
                    {formatINR(currentRevenue)}
                  </span>
                  <div className="text-[11px] text-emerald-600 font-semibold mt-0.5 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>
                      {revGrowth.isPositive ? `+${revGrowth.pct}%` : `-${revGrowth.pct}%`} vs prev period
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mt-4 pt-3 border-t border-[#E2DBD0]/60 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#104945]" />
                      <span className="text-[#717A76]">Online shop</span>
                    </div>
                    <span className="font-bold text-[#1A2421]">
                      {formatINR(periodInsights.onlineRev)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#C4975D]" />
                      <span className="text-[#717A76]">Studio shop</span>
                    </div>
                    <span className="font-bold text-[#1A2421]">
                      {formatINR(periodInsights.studioRev)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#BE413B]" />
                      <span className="text-[#717A76]">Wholesale</span>
                    </div>
                    <span className="font-bold text-[#1A2421]">
                      {formatINR(periodInsights.wholesaleRev)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Mini Callout Cards */}
              <div className="space-y-2.5 mt-5">
                {/* Top Buyer in Selected Period */}
                <div className="bg-[#ECE7E1]/50 border border-[#E2DBD0]/80 rounded-xl p-2.5 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[#DCE8E0] text-[#104945] font-bold text-[11px] flex items-center justify-center shrink-0">
                    {periodInsights.topBuyer.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] uppercase tracking-wider font-bold text-[#717A76]">
                      Top Buyer
                    </span>
                    <span className="text-xs font-semibold text-[#1A2421] truncate">
                      {periodInsights.topBuyer.name}
                    </span>
                    <span className="text-[10px] text-[#717A76]">
                      {formatINR(periodInsights.topBuyer.amount)} in period
                    </span>
                  </div>
                </div>

                {/* Best Seller in Selected Period */}
                <div className="bg-[#ECE7E1]/50 border border-[#E2DBD0]/80 rounded-xl p-2.5 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#D6C7B2] flex items-center justify-center text-xs shrink-0">
                    ☕
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] uppercase tracking-wider font-bold text-[#717A76]">
                      Best Seller
                    </span>
                    <span className="text-xs font-semibold text-[#1A2421] truncate">
                      {periodInsights.topProduct?.name || "No sales in period"}
                    </span>
                    <span className="text-[10px] text-[#717A76]">
                      {periodInsights.topProduct
                        ? `${periodInsights.topProduct.units} sold · ${formatINR(periodInsights.topProduct.rev)}`
                        : "0 pieces"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Bottom Grid Section (Orders, Best Sellers, Unit Economics, Activity) ── */}
        <section
          className="grid grid-cols-1 lg:grid-cols-12 gap-5"
          data-purpose="bottom-details-grid"
        >
          {/* Latest Orders (Col 7) */}
          <div
            className="lg:col-span-7 bg-white rounded-[22px] p-5 border border-[#E2DBD0] shadow-2xs flex flex-col justify-between"
            data-purpose="latest-orders-table"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[#DCE8E0]/60 rounded-lg text-[#104945]">
                    <ShoppingBag className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-bold text-[#1A2421]">Latest orders</h3>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Inline Search Input for Latest Orders */}
                  <div className="relative">
                    <input
                      type="text"
                      value={ordersSearchQuery}
                      onChange={(e) => setOrdersSearchQuery(e.target.value)}
                      placeholder="Filter orders..."
                      className="bg-white/80 border border-[#E2DBD0] rounded-full pl-6 pr-2 py-0.5 text-[11px] text-[#1A2421] placeholder-[#717A76] outline-none w-28 sm:w-36 focus:w-44 transition-all"
                    />
                    <Search className="w-3 h-3 text-[#717A76] absolute left-2 top-1.5 pointer-events-none" />
                    {ordersSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setOrdersSearchQuery("")}
                        className="absolute right-1.5 top-1 text-[#717A76] hover:text-[#1A2421]"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => navigate("/admin/myorders?view=pack")}
                    className="text-[11px] font-semibold text-[#104945] bg-[#DCE8E0] px-2.5 py-0.5 rounded-full flex items-center gap-1 cursor-pointer hover:bg-[#cde0d3] transition"
                  >
                    <Package className="w-3 h-3" />
                    Pack {filteredConfirmedOrders.length} confirmed
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/admin/myorders?view=pack")}
                    className="text-xs font-medium text-[#717A76] hover:text-[#1A2421] ml-1 cursor-pointer"
                  >
                    All
                  </button>
                </div>
              </div>

              {/* Orders Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-wider text-[#717A76] border-b border-[#E2DBD0]/60">
                      <th className="pb-2 font-bold">Order</th>
                      <th className="pb-2 font-bold">Customer</th>
                      <th className="pb-2 font-bold">Channel</th>
                      <th className="pb-2 font-bold">Status</th>
                      <th className="pb-2 font-bold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DBD0]/40">
                    {displayedOrders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[#717A76] text-xs">
                          No orders recorded for {dateBounds.label}.
                        </td>
                      </tr>
                    ) : (
                      displayedOrders.map((ord, idx) => {
                        const custName = ord.userName || ord.customerName || "Customer"
                        const initials = custName
                          .split(" ")
                          .map((p) => p[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()
                        const totalVal = ord.total || ord.totalAmount || 0
                        const ch = getOrderChannel(ord)
                        const st = getOrderStatusBadge(ord)
                        const orderIdLabel =
                          String(ord.id).length > 12
                            ? `#${String(ord.id).slice(-8).toUpperCase()}`
                            : `#${ord.id}`

                        return (
                          <tr
                            key={ord.id || idx}
                            onClick={() => navigate("/admin/myorders?view=pack")}
                            className="group hover:bg-[#ECE7E1]/30 transition-colors cursor-pointer"
                            title="Click to view in The Packing Bench"
                          >
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-[#DCE8E0]/80 text-[#104945] text-[10px] font-bold flex items-center justify-center">
                                  {initials}
                                </span>
                                <div>
                                  <span className="font-semibold text-[#1A2421] block leading-none">
                                    {orderIdLabel}
                                  </span>
                                  <span className="text-[10px] text-[#717A76]">
                                    {relativeTime(ord.createdAt || ord.date)}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 font-medium text-[#1A2421]">{custName}</td>
                            <td className="py-2.5 text-[#717A76]">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${ch.dot}`} />
                                <span>{ch.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5">
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.badgeClass}`}
                              >
                                ● {st.label}
                              </span>
                            </td>
                            <td className="py-2.5 text-right font-bold text-[#1A2421]">
                              {formatINR(totalVal)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination Footer Controls (Strict 6 per page) */}
            {totalCandidateOrders > 0 && (
              <div className="pt-3.5 mt-3 border-t border-[#E2DBD0]/60 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
                <span className="text-[#717A76] text-[11px]">
                  Showing <span className="font-semibold text-[#1A2421]">{fromIndex}</span>–
                  <span className="font-semibold text-[#1A2421]">{toIndex}</span> of{" "}
                  <span className="font-semibold text-[#1A2421]">{totalCandidateOrders}</span> orders
                </span>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                      disabled={ordersPage <= 1}
                      aria-label="Previous page"
                      className="p-1 rounded-md text-[#717A76] hover:text-[#104945] hover:bg-[#DCE8E0]/50 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-1 px-1">
                      {pageNumbers.map((pg, i) =>
                        pg === "…" ? (
                          <span key={`dots-${i}`} className="px-1 text-[11px] text-[#717A76]">
                            …
                          </span>
                        ) : (
                          <button
                            key={pg}
                            type="button"
                            onClick={() => setOrdersPage(pg)}
                            className={`min-w-[24px] h-6 px-1.5 rounded text-[11px] font-semibold transition cursor-pointer flex items-center justify-center ${
                              ordersPage === pg
                                ? "bg-[#104945] text-white shadow-2xs"
                                : "text-[#717A76] hover:text-[#1A2421] hover:bg-[#ECE7E1]"
                            }`}
                          >
                            {pg}
                          </button>
                        )
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setOrdersPage((p) => Math.min(totalPages, p + 1))}
                      disabled={ordersPage >= totalPages}
                      aria-label="Next page"
                      className="p-1 rounded-md text-[#717A76] hover:text-[#104945] hover:bg-[#DCE8E0]/50 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Best Sellers (Col 5) */}
          <div
            className="lg:col-span-5 bg-white rounded-[22px] p-5 border border-[#E2DBD0] shadow-2xs flex flex-col justify-between"
            data-purpose="best-sellers-ranked"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[#DCE8E0]/60 rounded-lg text-[#104945]">
                    <Star className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-bold text-[#1A2421]">Best sellers</h3>
                </div>
                <span className="text-[11px] text-[#717A76] font-medium">{dateBounds.label}</span>
              </div>

              {/* List with Progress and Swatches */}
              <div className="space-y-3.5">
                {displayedBestSellers.length === 0 ? (
                  <p className="text-xs text-[#717A76] py-8 text-center">
                    No best sellers recorded in {dateBounds.label}.
                  </p>
                ) : (
                  displayedBestSellers.map((item) => (
                    <div
                      key={item.id || item.rank}
                      onClick={() => navigate("/admin/add-product?view=analytics")}
                      className="space-y-1 cursor-pointer group"
                      title={`View analytics for ${item.name}`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <span className="text-[11px] font-bold text-[#717A76] w-3 shrink-0">
                            {item.rank}
                          </span>
                          <div className={`w-5 h-5 rounded ${item.swatch} shadow-2xs shrink-0`} />
                          <div className="min-w-0">
                            <span className="font-semibold text-[#1A2421] group-hover:text-[#104945] transition-colors truncate block">
                              {item.name}
                            </span>
                            <span className="text-[10px] text-[#717A76] block">{item.desc}</span>
                          </div>
                        </div>
                        <span className="font-bold text-[#1A2421] shrink-0">{formatINR(item.rev)}</span>
                      </div>
                      <div className="w-full bg-[#E5DFD5]/50 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#104945] h-full rounded-full transition-all duration-300"
                          style={{ width: `${item.barPct}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Pagination Footer Controls for Best Sellers */}
            {totalBestSellers > 0 && (
              <div className="pt-3.5 mt-3 border-t border-[#E2DBD0]/60 flex items-center justify-between gap-2 text-xs">
                <span className="text-[#717A76] text-[11px]">
                  Showing <span className="font-semibold text-[#1A2421]">{bsFrom}</span>–
                  <span className="font-semibold text-[#1A2421]">{bsTo}</span> of{" "}
                  <span className="font-semibold text-[#1A2421]">{totalBestSellers}</span>
                </span>

                {totalBestSellerPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setBestSellersPage((p) => Math.max(1, p - 1))}
                      disabled={bestSellersPage <= 1}
                      aria-label="Previous page"
                      className="p-1 rounded-md text-[#717A76] hover:text-[#104945] hover:bg-[#DCE8E0]/50 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-semibold text-[#1A2421] px-1">
                      {bestSellersPage} / {totalBestSellerPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBestSellersPage((p) => Math.min(totalBestSellerPages, p + 1))}
                      disabled={bestSellersPage >= totalBestSellerPages}
                      aria-label="Next page"
                      className="p-1 rounded-md text-[#717A76] hover:text-[#104945] hover:bg-[#DCE8E0]/50 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Category Revenue Contribution (Col 6) */}
          <div
            className="lg:col-span-6 bg-white rounded-[22px] p-5 border border-[#E2DBD0] shadow-2xs flex flex-col justify-between"
            data-purpose="category-revenue-contribution"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[#DCE8E0]/60 rounded-lg text-[#104945]">
                    <Layers className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-bold text-[#1A2421]">Category Revenue Contribution</h3>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/admin/inventory")}
                  className="text-[11px] text-[#717A76] border border-[#E2DBD0] px-2.5 py-0.5 rounded-full hover:bg-[#ECE7E1] cursor-pointer transition"
                >
                  All Categories
                </button>
              </div>

              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-2xl font-black text-[#104945]">
                  ₹{categoryRevenueStats.topCategory.share}
                </span>
                <span className="text-xs text-[#717A76]">
                  of every ₹100 earned comes from {categoryRevenueStats.topCategory.name} (
                  {formatINR(categoryRevenueStats.totalRevenue)} total in {dateBounds.label})
                </span>
              </div>

              {/* Segmented Colored Progress Bar */}
              <div className="w-full h-3 rounded-full overflow-hidden flex gap-0.5 mb-4 p-0.5 bg-[#ECE7E1]">
                {categoryRevenueStats.categories.length === 0 ? (
                  <div className="w-full bg-[#E2DBD0] h-full rounded-full" />
                ) : (
                  categoryRevenueStats.categories.map((cat, idx) => (
                    <div
                      key={cat.name}
                      className={`${cat.bg} h-full ${idx === 0 ? "rounded-l-full" : ""} ${
                        idx === categoryRevenueStats.categories.length - 1 ? "rounded-r-full" : ""
                      } transition-all duration-300`}
                      style={{ width: `${Math.max(2, cat.share)}%` }}
                      title={`${cat.name}: ${cat.share}% (${formatINR(cat.amount)})`}
                    />
                  ))
                )}
              </div>

              {/* Categories Contribution Grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {categoryRevenueStats.categories.length === 0 ? (
                  <p className="col-span-2 text-xs text-[#717A76] py-4 text-center">
                    No category data in this period.
                  </p>
                ) : (
                  categoryRevenueStats.categories.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0 pr-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        <span className="text-[#717A76] truncate">{cat.name}</span>
                        <span className="text-[10px] text-[#717A76]/80 font-mono">({cat.share}%)</span>
                      </div>
                      <span className="font-bold text-[#1A2421] whitespace-nowrap">
                        {formatINR(cat.amount)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-3.5 mt-3 border-t border-[#E2DBD0]/60 flex items-center justify-between text-xs text-[#717A76]">
              <span className="text-[11px]">
                Showing {categoryRevenueStats.categories.length} active categories in {dateBounds.label}
              </span>
              <span className="text-[11px] font-semibold text-[#104945]">
                {formatINR(categoryRevenueStats.totalRevenue)} gross
              </span>
            </div>
          </div>

          {/* Live Activity Stream (Col 6) */}
          <div
            className="lg:col-span-6 bg-white rounded-[22px] p-5 border border-[#E2DBD0] shadow-2xs flex flex-col justify-between"
            data-purpose="live-activity-stream"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[#DCE8E0]/60 rounded-lg text-[#104945]">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-bold text-[#1A2421]">Live Activity</h3>
                </div>
                <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {dateBounds.label}
                </span>
              </div>

              {/* Activity List */}
              <div className="space-y-3">
                {displayedActivity.length === 0 ? (
                  <div className="py-8 text-center text-[#717A76] text-xs">
                    No activity recorded for {dateBounds.label}.
                  </div>
                ) : (
                  displayedActivity.map((act) => (
                    <div
                      key={act.id}
                      onClick={() => navigate("/admin/myorders?view=pack")}
                      className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-[#ECE7E1]/40 transition-colors cursor-pointer group"
                      title="View order in The Packing Bench"
                    >
                      <div className="w-7 h-7 rounded-full bg-[#DCE8E0]/60 text-[#104945] flex items-center justify-center shrink-0 group-hover:bg-[#104945] group-hover:text-white transition-colors">
                        <ShoppingBag className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex flex-col text-xs leading-snug min-w-0">
                        <span className="text-[#1A2421] truncate">
                          <strong className="font-semibold">{act.name}</strong> ordered{" "}
                          {formatINR(act.amount)} ({act.channel.toLowerCase()})
                        </span>
                        <span className="text-[10px] text-[#717A76]">
                          {act.channel} · {act.time}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Pagination Footer Controls for Live Activity */}
            {totalActivity > 0 && (
              <div className="pt-3.5 mt-3 border-t border-[#E2DBD0]/60 flex items-center justify-between gap-2 text-xs">
                <span className="text-[#717A76] text-[11px]">
                  Showing <span className="font-semibold text-[#1A2421]">{actFrom}</span>–
                  <span className="font-semibold text-[#1A2421]">{actTo}</span> of{" "}
                  <span className="font-semibold text-[#1A2421]">{totalActivity}</span> events
                </span>

                {totalActivityPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                      disabled={activityPage <= 1}
                      aria-label="Previous page"
                      className="p-1 rounded-md text-[#717A76] hover:text-[#104945] hover:bg-[#DCE8E0]/50 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-semibold text-[#1A2421] px-1">
                      {activityPage} / {totalActivityPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActivityPage((p) => Math.min(totalActivityPages, p + 1))}
                      disabled={activityPage >= totalActivityPages}
                      aria-label="Next page"
                      className="p-1 rounded-md text-[#717A76] hover:text-[#104945] hover:bg-[#DCE8E0]/50 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  )
}

export default AdminDashboard
