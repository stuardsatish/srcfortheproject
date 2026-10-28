import { useEffect, useState, useMemo, useRef, useCallback } from "react"
import { toast } from "react-toastify"
import * as XLSX from "xlsx"
import {
  Users,
  Search,
  Download,
  Plus,
  Moon,
  Bell,
  X,
  Mail,
  Phone,
  MapPin,
  Calendar,
  ShoppingBag,
  IndianRupee,
  Check,
  Ban,
  KeyRound,
  Trash2,
  ExternalLink,
  Star,
  Sparkles,
  Clock,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Package,
  Layers,
  Repeat,
  Eye,
  Store,
  Building2,
  CalendarDays,
} from "lucide-react"

import { supabase } from "../../context/SupabaseConfig"
import RightDrawer from "../../components/Common/RightDrawer"
import { getDateBounds } from "./CustomersHubPage"

/* ============================== DESIGN TOKENS ============================== */
const FONT = "'Plus Jakarta Sans', sans-serif"
const TEAL = "#0F4C4C"
const TEAL_DARK = "#0B3838"
const TEAL_LIGHT = "#DEEEE7"
const TERRACOTTA = "#BC5B3E"
const RUST = "#BE413B"
const OLIVE = "#527C32"
const AMBER = "#D99726"
const BORDER = "#ECE5DC"
const BORDER_SUBTLE = "#F2ECE4"
const BORDER_MID = "#E4DDD4"
const CANVAS = "#EDE8E2"
const INK = "#171412"
const MUTED = "#736B62"
const CARD_BG = "#FFFFFF"

/* Pastel avatar color palettes matching the Pelago design */
const AVATAR_PALETTES = [
  { bg: "#FCE6DD", text: "#A64A2F" },
  { bg: "#FEF1D4", text: "#A6771F" },
  { bg: "#FCE2DF", text: "#A63A2E" },
  { bg: "#E5F1E7", text: "#2F6736" },
  { bg: "#DFEDF7", text: "#245D8C" },
  { bg: "#DEEEE7", text: "#0F4C4C" },
  { bg: "#FCE5D2", text: "#8C4610" },
  { bg: "#EFE1EA", text: "#6E2A5A" },
]

const getAvatarPalette = (name) => {
  let hash = 0
  const s = String(name || "Customer")
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length]
}

const getInitials = (name) => {
  if (!name) return "CU"
  const parts = String(name).trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return parts[0].slice(0, 2).toUpperCase()
}

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN")}`

const formatRelativeTime = (dateStr) => {
  if (!dateStr) return "Never"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return "Never"
  const diffMs = Date.now() - d.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  if (diffMinutes < 1) return "Just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMs / 3600000)
  if (diffHours < 24) return `${diffHours} h ago`
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} d ago`
  if (diffDays < 30) return `${diffDays} d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const formatJoinDate = (dateStr) => {
  if (!dateStr) return "11 Jun 2026"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return "11 Jun 2026"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

const renderSegmentFooter = (list = [], emptyText = "Nobody yet") => {
  if (!list || list.length === 0) {
    return (
      <div className="pt-2 border-t border-[#F2ECE4]">
        <span className="text-[10px] text-[#8C8479]">{emptyText}</span>
      </div>
    )
  }
  const top4 = list.slice(0, 4)
  const first = list[0]
  const remainder = list.length - 1
  return (
    <div className="flex items-center gap-1.5 pt-2 border-t border-[#F2ECE4]">
      <div className="flex -space-x-1.5 overflow-hidden">
        {top4.map((c, i) => {
          const pal = getAvatarPalette(c.name)
          return (
            <span
              key={c.id || i}
              style={{ backgroundColor: pal.bg, color: pal.text }}
              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-bold ring-1 ring-white"
            >
              {getInitials(c.name)}
            </span>
          )
        })}
      </div>
      <span className="text-[10px] text-[#756D63] truncate">
        {first.name} {remainder > 0 ? `and ${remainder} other${remainder > 1 ? "s" : ""}` : ""}
      </span>
    </div>
  )
}

const CustomerAnalyticsPage = ({
  onSwitchTab,
  showHeader = true,
  sharedData,
  exportRef,
  onOpenNewCustomer,
}) => {
  /* ── State ── */
  const [profiles, setProfiles] = useState(sharedData?.profiles || [])
  const [orders, setOrders] = useState(sharedData?.orders || [])
  const [loading, setLoading] = useState(!sharedData)

  // Top filters & custom dates
  const [activeDateRange, setActiveDateRange] = useState(sharedData?.activeDateRange || "Today")
  const [customFrom, setCustomFrom] = useState(sharedData?.customFrom || "")
  const [customTo, setCustomTo] = useState(sharedData?.customTo || "")
  const [channelFilter, setChannelFilter] = useState("all") // all | retail | wholesale | starred
  const [searchQuery, setSearchQuery] = useState("")
  const [visibleCount, setVisibleCount] = useState(20)

  // Starred customers
  const [starredIds, setStarredIds] = useState(() => {
    try {
      const saved = localStorage.getItem("pelago_starred_customers")
      return saved ? JSON.parse(saved) : ["cust-demo-1", "cust-demo-2", "cust-demo-4"]
    } catch {
      return ["cust-demo-1", "cust-demo-2", "cust-demo-4"]
    }
  })

  // Drawer
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [customerOrders, setCustomerOrders] = useState([])
  const [loadingCustomerOrders, setLoadingCustomerOrders] = useState(false)

  // New Customer Modal
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false)
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: "",
    subtitle: "",
    email: "",
    phone: "",
    city: "",
    channel: "Retail",
    role: "user",
  })
  const [submittingCustomer, setSubmittingCustomer] = useState(false)

  /* ── Toggle Starred ── */
  const toggleStar = useCallback((id, e) => {
    if (e) e.stopPropagation()
    setStarredIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem("pelago_starred_customers", JSON.stringify(next))
      } catch (err) {
        console.error("Storage error:", err)
      }
      return next
    })
  }, [])

  /* ── Fetch Supabase Data ── */
  const fetchData = useCallback(async () => {
    try {
      const [profilesRes, ordersRes] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("id, user_id, customer_name, customer_email, customer_phone, total, subtotal, order_status, status, payment_method, created_at, address, shipping_address")
          .order("created_at", { ascending: false }),
      ])

      if (profilesRes.data) setProfiles(profilesRes.data)
      if (ordersRes.data) setOrders(ordersRes.data)
    } catch (err) {
      console.error("Error fetching analytics data:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (sharedData?.profiles) setProfiles(sharedData.profiles)
    if (sharedData?.orders) setOrders(sharedData.orders)
    if (sharedData?.activeDateRange) setActiveDateRange(sharedData.activeDateRange)
    if (sharedData?.customFrom) setCustomFrom(sharedData.customFrom)
    if (sharedData?.customTo) setCustomTo(sharedData.customTo)
    if (sharedData?.starredIds) setStarredIds(sharedData.starredIds)
  }, [sharedData])

  useEffect(() => {
    if (sharedData?.profiles && sharedData?.orders) {
      setLoading(false)
      return
    }

    fetchData()

    const profilesChannel = supabase
      .channel("customer-analytics-profiles")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, fetchData)
      .subscribe()

    const ordersChannel = supabase
      .channel("customer-analytics-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, fetchData)
      .subscribe()

    return () => {
      supabase.removeChannel(profilesChannel)
      supabase.removeChannel(ordersChannel)
    }
  }, [fetchData, sharedData])

  /* ── Merge Database Profiles with Order Analytics ── */
  const allCustomers = useMemo(() => {
    if (sharedData?.allCustomers) {
      return sharedData.allCustomers
    }

    const customersMap = {}
    for (const p of profiles) {
      const email = p.email ? p.email.toLowerCase().trim() : ""
      const name = p.name || p.full_name || (email ? email.split("@")[0] : "Customer")
      const addr = p.address
      const city =
        p.city ||
        (typeof addr === "object" ? addr?.city || addr?.town : "") ||
        (typeof addr === "string" ? addr.split(",")[1]?.trim() : "") ||
        ""

      const custObj = {
        id: p.id,
        name,
        subtitle: p.subtitle || p.company || p.email || "",
        email: p.email || "",
        phone: p.phone || "",
        city,
        joinDate: p.created_at || new Date().toISOString(),
        channel: p.channel || "Retail",
        role: p.role || "user",
        status: p.status || "active",
        isStarred: starredIds.includes(p.id),
        rawProfile: p,
        orders: [],
      }

      customersMap[p.id] = custObj
      if (email) customersMap[email] = custObj
    }

    for (const o of orders) {
      const uid = o.userId || o.user_id
      const email = (o.userEmail || o.customer_email || o.customerEmail || "").toLowerCase().trim()
      const name = o.userName || o.customer_name || o.customerName || (email ? email.split("@")[0] : "Customer")
      const phone = o.userPhone || o.customer_phone || o.customerPhone || ""
      const addr = o.address || o.shippingAddress || o.shipping_address || o.userAddress
      const city =
        (typeof addr === "object" ? addr?.city || addr?.town : "") ||
        (typeof addr === "string" ? addr.split(",")[1]?.trim() : "") ||
        ""

      let customer = null
      if (uid && customersMap[uid]) {
        customer = customersMap[uid]
      } else if (email && customersMap[email]) {
        customer = customersMap[email]
      }

      if (!customer) {
        const fallbackId = uid || (email ? `cust-${email}` : `cust-${o.id}`)
        customer = {
          id: fallbackId,
          name,
          subtitle: email || "Guest Customer",
          email: email || "",
          phone,
          city: city || "",
          joinDate: o.createdAt || o.created_at || new Date().toISOString(),
          channel: "Retail",
          role: "user",
          status: "active",
          isStarred: starredIds.includes(fallbackId),
          rawProfile: null,
          orders: [],
        }
        customersMap[fallbackId] = customer
        if (uid) customersMap[uid] = customer
        if (email) customersMap[email] = customer
      }

      if (!customer.phone && phone) customer.phone = phone
      if (!customer.city && city) customer.city = city
      if ((!customer.name || customer.name === "Customer") && name && name !== "Customer") customer.name = name

      if (!customer.orders.some((existing) => existing.id === o.id)) {
        customer.orders.push(o)
      }
    }

    const uniqueCustomers = Array.from(new Set(Object.values(customersMap)))

    return uniqueCustomers.map((c) => {
      const sortedOrders = [...c.orders].sort((a, b) => {
        const da = new Date(a.createdAt || a.created_at || 0).getTime()
        const db = new Date(b.createdAt || b.created_at || 0).getTime()
        return db - da
      })
      const ordersCount = sortedOrders.length
      const totalSpent = sortedOrders.reduce(
        (sum, ord) => sum + (Number(ord.total || ord.totalAmount) || 0),
        0
      )
      const lastOrder = sortedOrders[0]
        ? sortedOrders[0].createdAt || sortedOrders[0].created_at
        : null
      const aov = ordersCount > 0 ? Math.round(totalSpent / ordersCount) : 0
      const channel = c.rawProfile?.channel || (totalSpent > 25000 ? "Wholesale" : "Retail")

      return {
        ...c,
        orders: sortedOrders,
        ordersCount,
        totalSpent,
        lastOrder,
        aov,
        channel,
        isStarred: starredIds.includes(c.id),
      }
    })
  }, [sharedData, profiles, orders, starredIds])

  /* ── 6 Top KPI Metrics & Segment Numbers ── */
  const metrics = useMemo(() => {
    if (sharedData?.metrics) {
      return sharedData.metrics
    }

    const totalUsers = allCustomers.length
    const totalOrders = allCustomers.reduce((acc, c) => acc + (c.ordersCount || 0), 0)
    const totalRevenue = allCustomers.reduce((acc, c) => acc + (c.totalSpent || 0), 0)
    const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0

    // Top spender
    const sortedBySpend = [...allCustomers].sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0))
    const topSpender = sortedBySpend[0] || { name: "No customers yet", totalSpent: 0 }

    // Retention
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const activeUsersCount = allCustomers.filter((c) => {
      if (!c.lastOrder) return false
      return new Date(c.lastOrder).getTime() >= thirtyDaysAgo
    }).length
    const retentionPct = totalUsers > 0 ? Math.min(100, Math.round((activeUsersCount / totalUsers) * 100)) : 100

    // Segments counts & share
    const collectors = allCustomers.filter((c) => c.totalSpent >= 15000)
    const collectorsRev = collectors.reduce((acc, c) => acc + c.totalSpent, 0)
    const collectorsShare = totalRevenue > 0 ? Math.round((collectorsRev / totalRevenue) * 100) : 0

    const regulars = allCustomers.filter((c) => c.ordersCount >= 3)
    const regularsRev = regulars.reduce((acc, c) => acc + c.totalSpent, 0)
    const regularsShare = totalRevenue > 0 ? Math.round((regularsRev / totalRevenue) * 100) : 0

    const newThisMonth = allCustomers.filter((c) => {
      const d = new Date(c.joinDate).getTime()
      return d >= thirtyDaysAgo
    })

    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000
    const driftingAway = allCustomers.filter((c) => {
      if (!c.lastOrder) return false
      return new Date(c.lastOrder).getTime() < sixtyDaysAgo
    })

    const wholesale = allCustomers.filter((c) => String(c.channel || "").toLowerCase() === "wholesale")
    const wholesaleRev = wholesale.reduce((acc, c) => acc + c.totalSpent, 0)
    const wholesaleShare = totalRevenue > 0 ? Math.round((wholesaleRev / totalRevenue) * 100) : 0

    const retail = allCustomers.filter((c) => String(c.channel || "").toLowerCase() !== "wholesale")
    const retailRev = retail.reduce((acc, c) => acc + c.totalSpent, 0)
    const retailShare = totalRevenue > 0 ? Math.round((retailRev / totalRevenue) * 100) : 0

    // Today's counter
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayOrders = orders.filter((o) => new Date(o.createdAt || o.created_at || 0) >= todayStart)
    const todayCount = todayOrders.length
    const todayRev = Math.round(todayOrders.reduce((acc, o) => acc + (Number(o.total || o.totalAmount) || 0), 0) / 1000)

    return {
      totalUsers,
      totalOrders,
      totalRevenue,
      aov,
      topSpender,
      activeUsersCount,
      retentionPct,
      todayCount,
      todayRev,
      collectorsCount: collectors.length,
      collectorsShare,
      regularsCount: regulars.length,
      regularsShare,
      newMonthCount: newThisMonth.length,
      driftingCount: driftingAway.length,
      wholesaleCount: wholesale.length,
      wholesaleShare,
      wholesaleRev,
      retailCount: retail.length,
      retailShare,
      retailRev,
      maxSpend: Math.max(...allCustomers.map((c) => c.totalSpent || 0), 10000),
    }
  }, [sharedData, allCustomers, orders])

  /* ── Table Customers (Top Spenders) ── */
  const filteredCustomers = useMemo(() => {
    let list = [...allCustomers]

    // Channel filter
    if (channelFilter === "retail") {
      list = list.filter((c) => String(c.channel || "").toLowerCase() === "retail")
    } else if (channelFilter === "wholesale") {
      list = list.filter((c) => String(c.channel || "").toLowerCase() === "wholesale")
    } else if (channelFilter === "starred") {
      list = list.filter((c) => c.isStarred)
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (c) =>
          String(c.name || "").toLowerCase().includes(q) ||
          String(c.subtitle || "").toLowerCase().includes(q) ||
          String(c.email || "").toLowerCase().includes(q) ||
          String(c.city || "").toLowerCase().includes(q)
      )
    }

    // Sort by period spend (or totalSpent if All Time)
    const isAllTime = metrics.dateBounds ? metrics.dateBounds.isAllTime : (activeDateRange === "All Time")
    list.sort((a, b) => {
      const valA = isAllTime ? (a.totalSpent || 0) : (a.periodSpent || 0)
      const valB = isAllTime ? (b.totalSpent || 0) : (b.periodSpent || 0)
      return valB - valA
    })

    return list
  }, [allCustomers, channelFilter, searchQuery, metrics.dateBounds, activeDateRange])

  const displayedCustomers = useMemo(() => {
    return filteredCustomers.slice(0, visibleCount)
  }, [filteredCustomers, visibleCount])

  const counts = useMemo(() => {
    const total = allCustomers.length
    const retail = allCustomers.filter((c) => String(c.channel || "").toLowerCase() === "retail").length
    const wholesale = allCustomers.filter((c) => String(c.channel || "").toLowerCase() === "wholesale").length
    const starred = allCustomers.filter((c) => c.isStarred).length
    return { total, retail, wholesale, starred }
  }, [allCustomers])

  /* ── Weekly / Periodic Customer Acquisition Chart Data ── */
  const acquisitionData = useMemo(() => {
    const dateBounds = metrics.dateBounds || getDateBounds(activeDateRange, customFrom, customTo)
    const { startDate, endDate, isAllTime, label } = dateBounds
    const norm = String(activeDateRange || "").trim().toLowerCase()

    let buckets = []
    if (norm === "today") {
      const times = [6, 9, 12, 15, 18, 21]
      const labels = ["6a", "9a", "12p", "3p", "6p", "9p"]
      buckets = times.map((h, i) => {
        const bStart = new Date(startDate)
        bStart.setHours(h - 3, 0, 0, 0)
        const bEnd = new Date(startDate)
        bEnd.setHours(h, 0, 0, 0)
        const count = allCustomers.filter((c) => {
          const jd = new Date(c.joinDate || 0)
          return jd >= bStart && jd < bEnd
        }).length
        return { label: labels[i], count }
      })
    } else if (norm === "last 7 days" || norm === "7d") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000)
        const bStart = new Date(d)
        bStart.setHours(0, 0, 0, 0)
        const bEnd = new Date(d)
        bEnd.setHours(23, 59, 59, 999)
        const labelStr = `${d.getMonth() + 1}/${d.getDate()}`
        const count = allCustomers.filter((c) => {
          const jd = new Date(c.joinDate || 0)
          return jd >= bStart && jd <= bEnd
        }).length
        buckets.push({ label: labelStr, count })
      }
    } else if (norm === "last 30 days" || norm === "30d") {
      for (let i = 5; i >= 0; i--) {
        const dEnd = new Date(Date.now() - i * 5 * 86400000)
        const dStart = new Date(dEnd.getTime() - 5 * 86400000)
        const labelStr = `${dEnd.getMonth() + 1}/${dEnd.getDate()}`
        const count = allCustomers.filter((c) => {
          const jd = new Date(c.joinDate || 0)
          return jd >= dStart && jd <= dEnd
        }).length
        buckets.push({ label: labelStr, count })
      }
    } else if (norm === "last 90 days" || norm === "90d") {
      for (let i = 5; i >= 0; i--) {
        const dEnd = new Date(Date.now() - i * 15 * 86400000)
        const dStart = new Date(dEnd.getTime() - 15 * 86400000)
        const labelStr = `${dEnd.getMonth() + 1}/${dEnd.getDate()}`
        const count = allCustomers.filter((c) => {
          const jd = new Date(c.joinDate || 0)
          return jd >= dStart && jd <= dEnd
        }).length
        buckets.push({ label: labelStr, count })
      }
    } else if (norm === "last 6 months" || norm === "6m") {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      const now = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const bStart = new Date(d.getFullYear(), d.getMonth(), 1)
        const bEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
        const labelStr = monthNames[d.getMonth()]
        const count = allCustomers.filter((c) => {
          const jd = new Date(c.joinDate || 0)
          return jd >= bStart && jd <= bEnd
        }).length
        buckets.push({ label: labelStr, count })
      }
    } else {
      // 8 intervals for all time / custom
      const now = new Date()
      for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const bStart = new Date(d.getFullYear(), d.getMonth(), 1)
        const bEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
        const labelStr = `${d.getMonth() + 1}/${d.getDate()}`
        const count = allCustomers.filter((c) => {
          const jd = new Date(c.joinDate || 0)
          return jd >= bStart && jd <= bEnd
        }).length
        buckets.push({ label: labelStr, count })
      }
    }

    const maxCount = Math.max(...buckets.map((b) => b.count), 1)
    const totalNewInPeriod = buckets.reduce((s, b) => s + b.count, 0)
    const thisWeekCount = allCustomers.filter(
      (c) => new Date(c.joinDate || 0).getTime() >= Date.now() - 7 * 86400000
    ).length

    return {
      buckets,
      maxCount,
      totalNewInPeriod,
      subtitle: `${totalNewInPeriod} new in period · this week: ${thisWeekCount}`,
    }
  }, [allCustomers, metrics.dateBounds, activeDateRange, customFrom, customTo])

  /* ── Revenue Trend Chart & Spotlight Data ── */
  const revenueTrendData = useMemo(() => {
    const dateBounds = metrics.dateBounds || getDateBounds(activeDateRange, customFrom, customTo)
    const { startDate, endDate, prevStart, prevEnd, isAllTime, label } = dateBounds
    const norm = String(activeDateRange || "").trim().toLowerCase()

    // 1. Period orders
    const periodOrders = orders.filter((o) => {
      if (isAllTime) return true
      const d = new Date(o.createdAt || o.created_at || 0)
      return d >= startDate && d <= endDate
    })

    const periodRevenue = periodOrders.reduce(
      (sum, o) => sum + (Number(o.total || o.totalAmount) || 0),
      0
    )

    // Previous period revenue
    const prevOrders = prevStart && prevEnd
      ? orders.filter((o) => {
          const d = new Date(o.createdAt || o.created_at || 0)
          return d >= prevStart && d <= prevEnd
        })
      : []
    const prevRevenue = prevOrders.reduce(
      (sum, o) => sum + (Number(o.total || o.totalAmount) || 0),
      0
    )
    const growthPct = prevRevenue > 0
      ? Math.round(((periodRevenue - prevRevenue) / prevRevenue) * 100)
      : (periodRevenue > 0 ? 100 : 0)

    // Payment methods breakdown in period
    let onlineRev = 0, studioRev = 0, wholesaleRev = 0
    for (const o of periodOrders) {
      const amt = Number(o.total || o.totalAmount) || 0
      const pay = String(o.paymentMethod || o.payment_method || "").toLowerCase()
      if (pay.includes("cod") || pay.includes("cash") || pay.includes("delivery")) {
        wholesaleRev += amt
      } else if (pay.includes("whatsapp") || pay.includes("manual") || pay.includes("bill") || pay.includes("store")) {
        studioRev += amt
      } else {
        onlineRev += amt // razorpay, online, card, upi
      }
    }

    // Top Buyer in this period
    const topBuyer = allCustomers
      .filter((c) => (isAllTime ? (c.totalSpent || 0) > 0 : (c.periodSpent || 0) > 0))
      .sort((a, b) => (isAllTime ? (b.totalSpent || 0) - (a.totalSpent || 0) : (b.periodSpent || 0) - (a.periodSpent || 0)))[0] || null

    // Best Seller product in this period
    const productSoldMap = {}
    for (const o of periodOrders) {
      for (const item of o.products || []) {
        const pid = item.productId || item.id || item.title
        if (!pid) continue
        if (!productSoldMap[pid]) {
          productSoldMap[pid] = {
            title: item.title || item.name || "Morning mug",
            qty: 0,
            revenue: 0,
            price: item.price || item.finalPrice || 32,
          }
        }
        productSoldMap[pid].qty += Number(item.quantity) || 1
        productSoldMap[pid].revenue += (item.lineTotal || ((item.price || 0) * (item.quantity || 1)))
      }
    }
    const bestSeller = Object.values(productSoldMap).sort((a, b) => b.revenue - a.revenue)[0] || {
      title: "Morning mug",
      price: 32,
      qty: 1,
    }

    // Generate timeline buckets
    let buckets = []
    function buildBucket(bLabel, bOrders) {
      let rz = 0, bill = 0, cod = 0, wa = 0
      for (const o of bOrders) {
        const amt = Number(o.total || o.totalAmount) || 0
        const pay = String(o.paymentMethod || o.payment_method || "").toLowerCase()
        if (pay.includes("cod") || pay.includes("cash") || pay.includes("delivery")) cod += amt
        else if (pay.includes("whatsapp") || pay.includes("manual")) wa += amt
        else if (pay.includes("bill") || pay.includes("store") || pay.includes("pos")) bill += amt
        else rz += amt
      }
      const total = rz + bill + cod + wa
      return { label: bLabel, total, rz, bill, cod, wa }
    }

    if (norm === "today") {
      const times = [0, 3, 6, 9, 12, 15, 18, 21]
      const labels = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"]
      buckets = times.map((h, i) => {
        const bStart = new Date(startDate)
        bStart.setHours(h, 0, 0, 0)
        const bEnd = new Date(startDate)
        bEnd.setHours(h + 3, 0, 0, 0)
        const bOrders = orders.filter((o) => {
          const d = new Date(o.createdAt || o.created_at || 0)
          return d >= bStart && d < bEnd
        })
        return buildBucket(labels[i], bOrders)
      })
    } else if (norm === "last 7 days" || norm === "7d") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000)
        const bStart = new Date(d)
        bStart.setHours(0, 0, 0, 0)
        const bEnd = new Date(d)
        bEnd.setHours(23, 59, 59, 999)
        const labelStr = `${d.getMonth() + 1}/${d.getDate()}`
        const bOrders = orders.filter((o) => {
          const od = new Date(o.createdAt || o.created_at || 0)
          return od >= bStart && od <= bEnd
        })
        buckets.push(buildBucket(labelStr, bOrders))
      }
    } else if (norm === "last 30 days" || norm === "30d") {
      for (let i = 5; i >= 0; i--) {
        const dEnd = new Date(Date.now() - i * 5 * 86400000)
        const dStart = new Date(dEnd.getTime() - 5 * 86400000)
        const labelStr = `${dEnd.getMonth() + 1}/${dEnd.getDate()}`
        const bOrders = orders.filter((o) => {
          const od = new Date(o.createdAt || o.created_at || 0)
          return od >= dStart && od <= dEnd
        })
        buckets.push(buildBucket(labelStr, bOrders))
      }
    } else if (norm === "last 90 days" || norm === "90d") {
      for (let i = 5; i >= 0; i--) {
        const dEnd = new Date(Date.now() - i * 15 * 86400000)
        const dStart = new Date(dEnd.getTime() - 15 * 86400000)
        const labelStr = `${dEnd.getMonth() + 1}/${dEnd.getDate()}`
        const bOrders = orders.filter((o) => {
          const od = new Date(o.createdAt || o.created_at || 0)
          return od >= dStart && od <= dEnd
        })
        buckets.push(buildBucket(labelStr, bOrders))
      }
    } else if (norm === "last 6 months" || norm === "6m") {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      const now = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const bStart = new Date(d.getFullYear(), d.getMonth(), 1)
        const bEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
        const labelStr = monthNames[d.getMonth()]
        const bOrders = orders.filter((o) => {
          const od = new Date(o.createdAt || o.created_at || 0)
          return od >= bStart && od <= bEnd
        })
        buckets.push(buildBucket(labelStr, bOrders))
      }
    } else {
      // 12 monthly bars for All Time
      const monthNames = ["Nov '25", "Dec", "Jan '26", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"]
      const now = new Date()
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const bStart = new Date(d.getFullYear(), d.getMonth(), 1)
        const bEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
        const labelStr = i === 11 ? "Nov '25" : (i === 9 ? "Jan '26" : monthNames[(now.getMonth() - i + 12) % 12])
        const bOrders = orders.filter((o) => {
          const od = new Date(o.createdAt || o.created_at || 0)
          return od >= bStart && od <= bEnd
        })
        buckets.push(buildBucket(labelStr, bOrders))
      }
    }

    const maxBucketRev = Math.max(...buckets.map((b) => b.total), 1000)

    return {
      buckets,
      maxBucketRev,
      periodRevenue,
      prevRevenue,
      growthPct,
      onlineRev,
      studioRev,
      wholesaleRev,
      topBuyer,
      bestSeller,
      periodTitle: isAllTime ? "October 2026" : label,
    }
  }, [orders, allCustomers, metrics.dateBounds, activeDateRange, customFrom, customTo])

  /* ── Open Customer Details Drawer ── */
  const handleOpenCustomer = useCallback(
    (customer, e) => {
      if (e) e.stopPropagation()
      setSelectedCustomer(customer)
      setDrawerOpen(true)
      setLoadingCustomerOrders(false)
      setCustomerOrders(customer.orders || [])
    },
    []
  )

  /* ── Export to Excel ── */
  const handleExport = () => {
    if (filteredCustomers.length === 0) {
      toast.info("No customer data to export.")
      return
    }

    const summary = [
      ["Pelago Customers & Segments Analytics"],
      ["Generated", new Date().toLocaleString("en-IN")],
      [],
      ["Metric", "Value"],
      ["Total Users", metrics.totalUsers],
      ["Total Orders", metrics.totalOrders],
      ["Total Revenue", metrics.totalRevenue],
      ["AOV", metrics.aov],
      ["Top Spender", `${metrics.topSpender.name} (₹${metrics.topSpender.totalSpent})`],
      ["Active Retention Rate", `${metrics.retentionPct}%`],
      [],
    ]

    const dataRows = filteredCustomers.map((c, i) => ({
      Rank: i + 1,
      Customer: c.name,
      Contact: c.subtitle || c.email,
      Email: c.email,
      Phone: c.phone || "—",
      City: c.city,
      "Join Date": formatJoinDate(c.joinDate),
      AOV: c.ordersCount > 0 ? Math.round(c.totalSpent / c.ordersCount) : 0,
      Orders: c.ordersCount,
      "Total Spend (INR)": c.totalSpent,
      "Last Order": c.lastOrder ? new Date(c.lastOrder).toLocaleDateString("en-IN") : "Never",
      Channel: c.channel,
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Overview")
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataRows), "Top Spenders")
    XLSX.writeFile(wb, `Pelago_Analytics_${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(`Exported ${filteredCustomers.length} customers analytics to Excel.`)
  }

  useEffect(() => {
    if (exportRef) {
      exportRef.current = handleExport
    }
  }, [exportRef, handleExport])

  /* ── Create Customer ── */
  const handleCreateCustomerSubmit = async (e) => {
    e.preventDefault()
    if (!newCustomerForm.name.trim() || !newCustomerForm.email.trim()) {
      toast.error("Name and Email are required.")
      return
    }

    setSubmittingCustomer(true)
    try {
      const newRecord = {
        name: newCustomerForm.name.trim(),
        email: newCustomerForm.email.trim(),
        phone: newCustomerForm.phone.trim(),
        city: newCustomerForm.city.trim() || "Seattle",
        channel: newCustomerForm.channel,
        role: newCustomerForm.role || "user",
        status: "active",
        created_at: new Date().toISOString(),
      }

      const { data, error } = await supabase.from("profiles").insert([newRecord]).select()
      if (error) throw error

      toast.success(`Customer "${newRecord.name}" created!`)
      setShowNewCustomerModal(false)
      setNewCustomerForm({
        name: "",
        subtitle: "",
        email: "",
        phone: "",
        city: "",
        channel: "Retail",
        role: "user",
      })
      fetchData()
    } catch (err) {
      console.error("Create customer error:", err)
      toast.error(`Could not create customer: ${err.message}`)
    } finally {
      setSubmittingCustomer(false)
    }
  }

  const DATE_RANGES = [
    "Today",
    "Last 7 Days",
    "Last 30 Days",
    "Last 90 Days",
    "Last 6 Months",
    "All Time",
    "Custom",
  ]

  return (
    <div style={{ fontFamily: FONT }} className={`flex-1 min-w-0 max-w-[1400px] mx-auto text-[#171412] text-[13px] pb-16 ${showHeader ? "" : "pt-0"}`}>
      {showHeader && (
        <>
          {/* ── Top Filter Bar & Live Counters ── */}
      <header className="flex items-center justify-between pb-4 flex-wrap gap-3">
        {/* Date Range Pills */}
        <div className="inline-flex bg-[#E2DBD1] p-1 rounded-full text-[12px] font-semibold text-[#665E54] gap-0.5 shadow-inner">
          {DATE_RANGES.map((range) => {
            const isActive = activeDateRange === range
            return (
              <button
                key={range}
                onClick={() => setActiveDateRange(range)}
                className={`px-3.5 py-1 rounded-full transition-colors cursor-pointer ${
                  isActive
                    ? "bg-white text-[#171412] shadow-2xs font-semibold"
                    : "hover:text-[#171412]"
                }`}
                type="button"
              >
                {range}
              </button>
            )
          })}
        </div>

        {/* Top Right Controls */}
        <div className="flex items-center gap-3">
          {/* Live Stat Pill */}
          <div className="bg-[#E4DED5] px-3 py-1 rounded-full flex items-center gap-2 text-[12px] font-medium border border-[#DCD3C7]">
            <span className="w-2 h-2 rounded-full bg-[#167448] animate-pulse"></span>
            <span className="font-bold text-[#171412]">{metrics.todayCount} today</span>
            <span className="text-[#847B70]">₹{metrics.todayRev}k</span>
          </div>

          {/* Dark Mode Button */}
          <button
            onClick={() => toast.info("Dark mode toggled.")}
            className="w-8 h-8 rounded-full border border-[#D7CEBF] bg-[#EDE8E2] flex items-center justify-center text-[#554D43] hover:text-[#171412] transition-colors cursor-pointer"
            type="button"
            title="Toggle dark mode"
          >
            <Moon className="w-4 h-4" />
          </button>

          {/* Notifications Button */}
          <button
            onClick={() => toast.info("No unread alerts.")}
            className="w-8 h-8 rounded-full border border-[#D7CEBF] bg-[#EDE8E2] flex items-center justify-center text-[#554D43] hover:text-[#171412] relative transition-colors cursor-pointer"
            type="button"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="w-2 h-2 bg-[#E05844] rounded-full absolute top-1.5 right-1.5 ring-2 ring-[#EDE8E2]"></span>
          </button>
        </div>
      </header>

      {/* ── Page Title & Action Buttons ── */}
      <div className="flex items-end justify-between mt-1 mb-5 flex-wrap gap-4">
        <div>
          <p className="text-[12px] font-medium text-[#766E65] mb-0.5">
            Studio shop, online and wholesale · everyone who has bought
          </p>
          <h2 className="text-[30px] font-extrabold tracking-tight text-[#171412] leading-none">
            Customers
          </h2>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExport}
            className="bg-white border border-[#DED8CF] hover:bg-[#F9F7F4] text-[#35302A] px-4 py-2 rounded-full font-bold text-[12px] flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            type="button"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
          <button
            id="new-customer-analytics-btn"
            onClick={() => (onOpenNewCustomer ? onOpenNewCustomer() : setShowNewCustomerModal(true))}
            className="bg-[#0F4C4C] hover:bg-[#0B3A3A] text-white px-4 py-2 rounded-full font-bold text-[12px] flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            type="button"
          >
            <Plus className="w-4 h-4" />
            <span>New customer</span>
          </button>
        </div>
      </div>

      {/* ── BEGIN: 6 Top KPI Metrics Row ── */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6" data-purpose="kpi-metrics-row">
        {/* 1. Total Users */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs hover:shadow-xs transition-shadow">
          <div className="w-6 h-6 rounded-md bg-[#DEEEE7] flex items-center justify-center text-[#0F4C4C] mb-2.5">
            <Users className="w-3.5 h-3.5" />
          </div>
          <div className="text-[11px] font-semibold text-[#736B62] mb-0.5">Total Users</div>
          <div className="text-[24px] font-bold text-[#171412] leading-tight">{metrics.totalUsers}</div>
          <div className="text-[11px] font-semibold text-[#8C8478] mt-0.5">200% vs prev</div>
        </div>

        {/* 2. Total Orders */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs hover:shadow-xs transition-shadow">
          <div className="w-6 h-6 rounded-md bg-[#DEEEE7] flex items-center justify-center text-[#0F4C4C] mb-2.5">
            <ShoppingBag className="w-3.5 h-3.5" />
          </div>
          <div className="text-[11px] font-semibold text-[#736B62] mb-0.5">Total Orders</div>
          <div className="text-[24px] font-bold text-[#171412] leading-tight">{metrics.totalOrders}</div>
          <div className="text-[11px] font-semibold text-[#8C8478] mt-0.5">300%</div>
        </div>

        {/* 3. Total Revenue */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs hover:shadow-xs transition-shadow">
          <div className="w-6 h-6 rounded-md bg-[#DEEEE7] flex items-center justify-center text-[#0F4C4C] mb-2.5">
            <IndianRupee className="w-3.5 h-3.5" />
          </div>
          <div className="text-[11px] font-semibold text-[#736B62] mb-0.5">Total Revenue</div>
          <div className="text-[24px] font-bold text-[#171412] leading-tight truncate">
            {metrics.totalRevenue > 99999
              ? `₹${(metrics.totalRevenue / 1000).toFixed(0)}k`
              : formatINR(metrics.totalRevenue)}
          </div>
          <div className="text-[11px] font-semibold text-[#8C8478] mt-0.5">322%</div>
        </div>

        {/* 4. AOV */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs hover:shadow-xs transition-shadow">
          <div className="w-6 h-6 rounded-md bg-[#DEEEE7] flex items-center justify-center text-[#0F4C4C] mb-2.5">
            <Package className="w-3.5 h-3.5" />
          </div>
          <div className="text-[11px] font-semibold text-[#736B62] mb-0.5">AOV</div>
          <div className="text-[24px] font-bold text-[#171412] leading-tight">{formatINR(metrics.aov)}</div>
          <div className="text-[11px] font-semibold text-[#8C8478] mt-0.5">5%</div>
        </div>

        {/* 5. Top Spender */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs hover:shadow-xs transition-shadow">
          <div className="w-6 h-6 rounded-md bg-[#DEEEE7] flex items-center justify-center text-[#0F4C4C] mb-2.5">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="text-[11px] font-semibold text-[#736B62] mb-0.5">Top Spender</div>
          <div className="text-[22px] font-bold text-[#171412] leading-tight truncate">
            {metrics.topSpender.name || "Satish"}
          </div>
          <div className="mt-1">
            <span className="inline-block text-[10px] font-bold bg-[#E6F3EC] text-[#1E7448] px-1.5 py-0.5 rounded">
              Spent {formatINR(metrics.topSpender.totalSpent || 4010)}
            </span>
          </div>
        </div>

        {/* 6. Active User */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs hover:shadow-xs transition-shadow">
          <div className="w-6 h-6 rounded-md bg-[#DEEEE7] flex items-center justify-center text-[#0F4C4C] mb-2.5">
            <Users className="w-3.5 h-3.5" />
          </div>
          <div className="text-[11px] font-semibold text-[#736B62] mb-0.5">Active User</div>
          <div className="text-[24px] font-bold text-[#171412] leading-tight">
            {formatINR(metrics.activeUsersCount > 0 ? metrics.activeUsersCount * 732 : 2928)}
          </div>
          <div className="text-[11px] font-semibold text-[#8C8478] mt-0.5">{metrics.retentionPct}% Retention</div>
        </div>
      </section>
      {/* ── END: Top KPI Metrics Row ── */}

      {/* ── Tab Selection Header ── */}
      <div className="flex items-center gap-6 border-b border-[#DDD5CA] mb-5">
        <button
          onClick={() => onSwitchTab && onSwitchTab("everyone")}
          className="pb-2.5 text-[13px] font-semibold text-[#726A61] hover:text-[#171412] transition-colors cursor-pointer"
          type="button"
        >
          Everyone <span className="font-normal text-[#8A8176]">{metrics.totalUsers}</span>
        </button>
        <button
          className="pb-2.5 text-[13px] font-bold text-[#141210] border-b-2 border-[#0F4C4C] cursor-pointer"
          type="button"
        >
          Analytics
        </button>
      </div>
        </>
      )}

      {/* ── BEGIN: Customer Segments Cards Grid (5 Cards) ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 mb-6" data-purpose="customer-segments-grid">
        {/* 1. Collectors */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs flex flex-col justify-between hover:shadow-xs transition-shadow">
          <div>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[#E4F3ED] text-[#0F4C4C] flex items-center justify-center">
                  <Star className="w-3.5 h-3.5 fill-[#0F4C4C]" />
                </div>
                <span className="font-bold text-[13px] text-[#171412]">Collectors</span>
              </div>
              <button
                className="w-5 h-5 rounded-full border border-[#E5DFD6] flex items-center justify-center text-[#8C8377] hover:border-[#B5ACA0] cursor-pointer"
                type="button"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[10px] text-[#7A7268] leading-tight mb-3">
              {metrics.dateBounds?.isAllTime
                ? "Spent ₹15,000 or more, all time"
                : `Spent ₹${(metrics.collectorThreshold || 1000).toLocaleString("en-IN")} or more in period`}
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <div className="text-[10px] text-[#867E74]">Members</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.collectorsCount ?? 0}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#867E74]">Revenue share</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.collectorsShare ?? 0}%</div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-[#EAE4DB] h-1 rounded-full overflow-hidden mb-3">
              <div className="bg-[#0F4C4C] h-full rounded-full" style={{ width: `${metrics.collectorsShare ?? 0}%` }}></div>
            </div>
          </div>
          {/* Avatars Footer */}
          {renderSegmentFooter(metrics.collectorsList, "Nobody in period")}
        </div>

        {/* 2. Regulars */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs flex flex-col justify-between hover:shadow-xs transition-shadow">
          <div>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[#FBEFEA] text-[#BC5B3E] flex items-center justify-center">
                  <Repeat className="w-3.5 h-3.5" />
                </div>
                <span className="font-bold text-[13px] text-[#171412]">Regulars</span>
              </div>
              <button
                className="w-5 h-5 rounded-full border border-[#E5DFD6] flex items-center justify-center text-[#8C8377] hover:border-[#B5ACA0] cursor-pointer"
                type="button"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[10px] text-[#7A7268] leading-tight mb-3">
              {metrics.dateBounds?.isAllTime ? "Three orders or more, all time" : "Two or more orders in period"}
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <div className="text-[10px] text-[#867E74]">Members</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.regularsCount ?? 0}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#867E74]">Revenue share</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.regularsShare ?? 0}%</div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-[#EAE4DB] h-1 rounded-full overflow-hidden mb-3">
              <div className="bg-[#BC5B3E] h-full rounded-full" style={{ width: `${metrics.regularsShare ?? 0}%` }}></div>
            </div>
          </div>
          {/* Avatars Footer */}
          {renderSegmentFooter(metrics.regularsList, "Nobody in period")}
        </div>

        {/* 3. New this month */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs flex flex-col justify-between hover:shadow-xs transition-shadow">
          <div>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[#EAF2E4] text-[#527C32] flex items-center justify-center">
                  <CalendarDays className="w-3.5 h-3.5" />
                </div>
                <span className="font-bold text-[13px] text-[#171412]">
                  {activeDateRange === "Today" ? "New today" : (metrics.dateBounds?.isAllTime ? "New this month" : "New in period")}
                </span>
              </div>
              <button
                className="w-5 h-5 rounded-full border border-[#E5DFD6] flex items-center justify-center text-[#8C8377] hover:border-[#B5ACA0] cursor-pointer"
                type="button"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[10px] text-[#7A7268] leading-tight mb-3">
              {metrics.dateBounds?.isAllTime
                ? "Joined in the last 30 days"
                : `Joined in ${metrics.periodLabel?.toLowerCase() || "period"}`}
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <div className="text-[10px] text-[#867E74]">Members</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.newMonthCount ?? 0}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#867E74]">Revenue share</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.newMonthShare ?? 0}%</div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-[#EAE4DB] h-1 rounded-full overflow-hidden mb-3">
              <div className="bg-[#527C32] h-full rounded-full" style={{ width: `${metrics.newMonthShare ?? 0}%` }}></div>
            </div>
          </div>
          {/* Avatars Footer */}
          {renderSegmentFooter(metrics.newThisMonthList, "Nobody in period")}
        </div>

        {/* 4. Drifting away */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs flex flex-col justify-between hover:shadow-xs transition-shadow">
          <div>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[#F8EAE9] text-[#BE413B] flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5" />
                </div>
                <span className="font-bold text-[13px] text-[#171412]">Drifting away</span>
              </div>
              <button
                className="w-5 h-5 rounded-full border border-[#E5DFD6] flex items-center justify-center text-[#8C8377] hover:border-[#B5ACA0] cursor-pointer"
                type="button"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[10px] text-[#7A7268] leading-tight mb-3">
              {metrics.dateBounds?.isAllTime ? "No order in 60 days" : "No orders in this period"}
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <div className="text-[10px] text-[#867E74]">Members</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.driftingCount ?? 0}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#867E74]">Revenue share</div>
                <div className="text-[18px] font-extrabold text-[#171412]">0%</div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-[#EAE4DB] h-1 rounded-full overflow-hidden mb-3">
              <div className="bg-gray-300 h-full rounded-full" style={{ width: "0%" }}></div>
            </div>
          </div>
          {/* Avatars Footer */}
          {renderSegmentFooter(metrics.driftingList, "Nobody yet")}
        </div>

        {/* 5. Wholesale */}
        <div className="bg-white rounded-2xl p-4 border border-[#ECE5DC] shadow-2xs flex flex-col justify-between hover:shadow-xs transition-shadow">
          <div>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[#FBF2E3] text-[#D99726] flex items-center justify-center">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <span className="font-bold text-[13px] text-[#171412]">Wholesale</span>
              </div>
              <button
                className="w-5 h-5 rounded-full border border-[#E5DFD6] flex items-center justify-center text-[#8C8377] hover:border-[#B5ACA0] cursor-pointer"
                type="button"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[10px] text-[#7A7268] leading-tight mb-3">
              {metrics.dateBounds?.isAllTime ? "All wholesale accounts" : "Wholesale active in period"}
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <div className="text-[10px] text-[#867E74]">Members</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.wholesaleCount ?? 0}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#867E74]">Revenue share</div>
                <div className="text-[18px] font-extrabold text-[#171412]">{metrics.wholesaleShare ?? 0}%</div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-[#EAE4DB] h-1 rounded-full overflow-hidden mb-3">
              <div className="bg-[#D99726] h-full rounded-full" style={{ width: `${metrics.wholesaleShare ?? 0}%` }}></div>
            </div>
          </div>
          {/* Avatars Footer */}
          {renderSegmentFooter(metrics.wholesaleList, "Nobody in period")}
        </div>
      </section>
      {/* ── END: Customer Segments Cards Grid ── */}

      {/* ── BEGIN: Middle Analytics Charts Row ── */}
      <section className="grid grid-cols-12 gap-4 mb-6" data-purpose="charts-row">
        {/* Donut Chart: Customer Segments (5 Cols) */}
        <div className="col-span-12 lg:col-span-5 bg-white rounded-2xl p-5 border border-[#ECE5DC] shadow-2xs flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded bg-[#DEEEE7] text-[#0F4C4C] flex items-center justify-center">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <h3 className="font-bold text-[13px] text-[#171412]">Customer Segments</h3>
          </div>
          <div className="flex items-center gap-6 my-auto flex-wrap sm:flex-nowrap">
            {/* Donut Graphic */}
            <div className="relative w-32 h-32 flex-shrink-0 flex items-center justify-center mx-auto">
              <div
                style={{
                  background: `conic-gradient(#0F4C4C 0% ${metrics.retailShare ?? 0}%, #BC5B3E ${metrics.retailShare ?? 0}% 100%)`,
                  borderRadius: "50%",
                }}
                className="w-full h-full shadow-inner"
              ></div>
              {/* Inner cutout circle */}
              <div className="absolute w-20 h-20 bg-white rounded-full flex flex-col items-center justify-center shadow-xs">
                <span className="text-[16px] font-extrabold text-[#171412] leading-none">
                  {metrics.retailShare ?? 0}%
                </span>
                <span className="text-[10px] font-medium text-[#7A7268] mt-0.5">retail</span>
              </div>
            </div>
            {/* Segments Legend & Values */}
            <div className="flex-1 space-y-3.5 min-w-[180px]">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#0F4C4C] mt-1 flex-shrink-0"></span>
                  <div>
                    <div className="font-bold text-[12px] text-[#171412] leading-tight">Retail</div>
                    <div className="text-[10px] text-[#7C746A] leading-tight">
                      {metrics.retailCount ?? 0} people, online and at the studio
                    </div>
                  </div>
                </div>
                <div className="font-bold text-[13px] text-[#171412] text-right">{formatINR(metrics.retailRev ?? 0)}</div>
              </div>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#BC5B3E] mt-1 flex-shrink-0"></span>
                  <div>
                    <div className="font-bold text-[12px] text-[#171412] leading-tight">Wholesale</div>
                    <div className="text-[10px] text-[#7C746A] leading-tight">
                      {metrics.wholesaleCount ?? 0} accounts at trade price
                    </div>
                  </div>
                </div>
                <div className="font-bold text-[13px] text-[#171412] text-right">{formatINR(metrics.wholesaleRev ?? 0)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Bar Chart: New customers a week (7 Cols) */}
        <div className="col-span-12 lg:col-span-7 bg-white rounded-2xl p-5 border border-[#ECE5DC] shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[#DEEEE7] text-[#0F4C4C] flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
              <h3 className="font-bold text-[13px] text-[#171412]">New customers a week</h3>
            </div>
            <span className="text-[11px] text-[#7E766D] font-medium">{acquisitionData.subtitle}</span>
          </div>
          {/* Weekly / Periodic Bar Columns */}
          <div className="h-32 flex items-end justify-between gap-3 pt-4 px-2">
            {acquisitionData.buckets.map((b, idx) => {
              const heightPct = Math.max(12, Math.min(100, Math.round(((b.count || 0) / (acquisitionData.maxCount || 1)) * 100)))
              const hasCount = b.count > 0
              return (
                <div key={b.label + idx} className="flex-1 flex flex-col items-center h-full justify-end">
                  <div
                    style={{ height: `${heightPct}%` }}
                    title={`${b.label}: ${b.count} customers`}
                    className={`w-full rounded-md transition-all ${
                      hasCount
                        ? "bg-[#557C32] hover:brightness-110"
                        : "bg-[#F5F2EC] border border-[#E9E4DC]"
                    }`}
                  ></div>
                  <span className="text-[10px] font-medium text-[#7C746A] mt-2 whitespace-nowrap">{b.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>
      {/* ── END: Middle Analytics Charts Row ── */}

      {/* ── BEGIN: Top Spending Customer Table Card ── */}
      <section className="bg-white rounded-2xl p-5 border border-[#ECE5DC] shadow-2xs mb-6" data-purpose="top-spending-customers-table">
        {/* Table Toolbar */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[#DEEEE7] text-[#0F4C4C] flex items-center justify-center">
                <ShoppingBag className="w-3.5 h-3.5" />
              </div>
              <h3 className="font-bold text-[13px] text-[#171412]">Top Spending Customer</h3>
            </div>
            {/* Search Input */}
            <div className="relative ml-2">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#8F877D]" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-[#FAF7F2] border border-[#E4DDD4] rounded-lg text-[12px] placeholder-[#9C948B] focus:ring-1 focus:ring-[#0F4C4C] focus:border-[#0F4C4C] w-48 outline-none"
                placeholder="Search"
                type="text"
              />
            </div>
          </div>

          {/* Filter Segment Pills */}
          <div className="flex items-center gap-1.5 text-[12px] font-semibold">
            <button
              onClick={() => setChannelFilter("all")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                channelFilter === "all" ? "bg-[#1E293B] text-white" : "text-[#6F675D] hover:text-[#171412]"
              }`}
            >
              All <span className={channelFilter === "all" ? "text-gray-300 font-normal" : "font-normal text-[#8A8177]"}>{counts.total}</span>
            </button>
            <button
              onClick={() => setChannelFilter("retail")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                channelFilter === "retail" ? "bg-[#1E293B] text-white" : "text-[#6F675D] hover:text-[#171412]"
              }`}
            >
              Retail <span className={channelFilter === "retail" ? "text-gray-300 font-normal" : "font-normal text-[#8A8177]"}>{counts.retail}</span>
            </button>
            <button
              onClick={() => setChannelFilter("wholesale")}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                channelFilter === "wholesale" ? "bg-[#1E293B] text-white" : "text-[#6F675D] hover:text-[#171412]"
              }`}
            >
              Wholesale <span className={channelFilter === "wholesale" ? "text-gray-300 font-normal" : "font-normal text-[#8A8177]"}>{counts.wholesale}</span>
            </button>
            <button
              onClick={() => setChannelFilter("starred")}
              className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                channelFilter === "starred" ? "bg-[#1E293B] text-white" : "text-[#6F675D] hover:text-[#171412]"
              }`}
            >
              <span className="text-amber-500">☆</span> Starred{" "}
              <span className={channelFilter === "starred" ? "text-gray-300 font-normal" : "font-normal text-[#8A8177]"}>{counts.starred}</span>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#EFE9E0] text-[10px] font-bold text-[#8E867C] uppercase tracking-wider">
                <th className="py-2.5 px-3 font-bold">Customer</th>
                <th className="py-2.5 px-3 font-bold">Join Date</th>
                <th className="py-2.5 px-3 font-bold">AOV</th>
                <th className="py-2.5 px-3 font-bold text-center">Orders</th>
                <th className="py-2.5 px-3 font-bold">Total Spend</th>
                <th className="py-2.5 px-3 font-bold">Last Order</th>
                <th className="py-2.5 px-3 font-bold text-right">Segments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F5EFE8]">
              {displayedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#78716C]">
                    No customer matches found.
                  </td>
                </tr>
              ) : (
                displayedCustomers.map((c) => {
                  const palette = getAvatarPalette(c.name)
                  const initials = getInitials(c.name)
                  const isAllTime = metrics.dateBounds ? metrics.dateBounds.isAllTime : (activeDateRange === "All Time")
                  const spend = isAllTime ? (c.totalSpent || 0) : (c.periodSpent || 0)
                  const maxSp = metrics.maxPeriodSpend || 25000
                  const spendPct = Math.min(100, Math.max(8, Math.round((spend / (maxSp || 1)) * 100)))
                  const ordersCount = isAllTime ? (c.ordersCount || 0) : (c.periodOrdersCount || 0)
                  const aov = ordersCount > 0 ? Math.round(spend / ordersCount) : 0
                  const lastOrder = isAllTime ? c.lastOrder : (c.periodLastOrder || c.lastOrder)

                  return (
                    <tr
                      key={c.id}
                      onClick={(e) => handleOpenCustomer(c, e)}
                      className="hover:bg-[#FAF8F5] transition-colors cursor-pointer group"
                    >
                      {/* Customer */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <button
                            onClick={(e) => toggleStar(c.id, e)}
                            className="text-stone-300 hover:text-amber-500 cursor-pointer p-0.5"
                            type="button"
                          >
                            <Star className={`w-3.5 h-3.5 ${c.isStarred ? "text-amber-500 fill-amber-500" : ""}`} />
                          </button>
                          <div
                            style={{ backgroundColor: palette.bg, color: palette.text }}
                            className="w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 shadow-2xs"
                          >
                            {initials}
                          </div>
                          <div>
                            <div className="font-bold text-[#171412] text-[12px] leading-tight">
                              {c.name}
                            </div>
                            <div className="text-[11px] text-[#7F776D] leading-tight">
                              {c.subtitle || c.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Join Date */}
                      <td className="py-2.5 px-3 text-[#5A534B] whitespace-nowrap">
                        {formatJoinDate(c.joinDate)}
                      </td>

                      {/* AOV */}
                      <td className="py-2.5 px-3 font-medium text-[#171412] whitespace-nowrap">
                        {formatINR(aov)}
                      </td>

                      {/* Orders */}
                      <td className="py-2.5 px-3 text-center font-medium text-[#171412] whitespace-nowrap">
                        {ordersCount}
                      </td>

                      {/* Total Spend */}
                      <td className="py-2.5 px-3">
                        <div>
                          <div className="font-bold text-[#171412]">{formatINR(spend)}</div>
                          <div className="w-20 bg-[#E6E0D6] h-1 rounded-full overflow-hidden mt-1">
                            <div
                              className="bg-[#0F4C4C] h-full rounded-full transition-all duration-500"
                              style={{ width: `${spendPct}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>

                      {/* Last Order */}
                      <td className="py-2.5 px-3 text-[#5A534B] whitespace-nowrap">
                        {formatRelativeTime(lastOrder)}
                      </td>

                      {/* Action */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => handleOpenCustomer(c, e)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#EBF6F1] text-[#0F4C4C] font-semibold text-[11px] hover:bg-[#DEEEE7] transition-colors cursor-pointer"
                          type="button"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Order Details</span>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="flex items-center justify-between pt-4 mt-1 border-t border-[#F2EDE5] text-[12px] flex-wrap gap-2">
          <span className="text-[#7D756C]">
            Showing {Math.min(visibleCount, filteredCustomers.length)} of {filteredCustomers.length}
          </span>
          {visibleCount < filteredCustomers.length && (
            <button
              onClick={() => setVisibleCount((prev) => prev + 20)}
              className="flex items-center gap-1.5 text-[#3C362F] font-bold hover:text-[#171412] px-2.5 py-1 rounded-md border border-[#E2DDD3] cursor-pointer"
              type="button"
            >
              <span>Show 20 more</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#7D756C]" />
            </button>
          )}
        </div>
      </section>
      {/* ── END: Top Spending Customer Table Card ── */}

      {/* ── BEGIN: Bottom Revenue Trend Section ── */}
      <section className="bg-white rounded-2xl p-5 border border-[#ECE5DC] shadow-2xs mb-8" data-purpose="revenue-trend-section">
        {/* Section Header & Legends */}
        <div className="flex items-center justify-between mb-6 pb-2 border-b border-[#F5EFE8] flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#DEEEE7] text-[#0F4C4C] flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
            <h3 className="font-bold text-[13px] text-[#171412]">Revenue Trend</h3>
          </div>
          {/* Trend Legends */}
          <div className="flex items-center gap-4 text-[11px] font-semibold text-[#5B544B] flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#0F4C4C]"></span>
              Razorpay
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#5BA4A4]"></span>
              Billing
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#D97706]"></span>
              COD
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#BE413B]"></span>
              Whatsapp
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs border border-dashed border-[#8E867C]"></span>
              Same month last year
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs border border-[#8E867C] bg-stone-100"></span>
              October's pace
            </div>
          </div>
        </div>

        {/* Revenue Chart & Sidebar Grid */}
        <div className="grid grid-cols-12 gap-8 items-start">
          {/* Left 12-Month Stacked Bar Chart (8 Cols) */}
          <div className="col-span-12 lg:col-span-8 flex flex-col justify-end h-80 relative pr-2">
            {/* Background Grid lines with Y-Axis Values */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-7">
              <div className="w-full flex items-center">
                <span className="text-[10px] text-[#A69F94] w-10">
                  {revenueTrendData.maxBucketRev >= 100000
                    ? `₹${Math.round(revenueTrendData.maxBucketRev / 1000)}k`
                    : revenueTrendData.maxBucketRev >= 1000
                    ? `₹${(revenueTrendData.maxBucketRev / 1000).toFixed(0)}k`
                    : `₹${revenueTrendData.maxBucketRev}`}
                </span>
                <div className="flex-1 border-b border-dashed border-[#EAE3D8]"></div>
              </div>
              <div className="w-full flex items-center">
                <span className="text-[10px] text-[#A69F94] w-10">
                  {revenueTrendData.maxBucketRev >= 100000
                    ? `₹${Math.round(revenueTrendData.maxBucketRev / 2000)}k`
                    : revenueTrendData.maxBucketRev >= 1000
                    ? `₹${(revenueTrendData.maxBucketRev / 2000).toFixed(0)}k`
                    : `₹${Math.round(revenueTrendData.maxBucketRev / 2)}`}
                </span>
                <div className="flex-1 border-b border-dashed border-[#EAE3D8]"></div>
              </div>
              <div className="w-full flex items-center">
                <span className="text-[10px] text-[#A69F94] w-10">₹0</span>
                <div className="flex-1 border-b border-[#E0D8CB]"></div>
              </div>
            </div>

            {/* Stacked Bars Container */}
            <div className="ml-10 flex items-end justify-between gap-2.5 h-64 z-10">
              {revenueTrendData.buckets.map((b, idx) => {
                const isLast = idx === revenueTrendData.buckets.length - 1
                const maxVal = revenueTrendData.maxBucketRev || 1
                const heightPct = b.total > 0
                  ? Math.max(14, Math.min(100, Math.round((b.total / maxVal) * 100)))
                  : 8

                // Segment proportions
                const total = b.total || 1
                const rzPct = Math.round((b.rz / total) * 100)
                const billPct = Math.round((b.bill / total) * 100)
                const codPct = Math.round((b.cod / total) * 100)
                const waPct = Math.max(0, 100 - rzPct - billPct - codPct)

                const badgeText = b.total >= 1000
                  ? `₹${Math.round(b.total / 1000)}k`
                  : `₹${b.total}`

                return (
                  <div
                    key={idx}
                    className="flex-1 flex flex-col items-center h-full justify-end group relative"
                    title={`${b.label}: ${formatINR(b.total)}`}
                  >
                    {/* Floating Badge for last/active bucket if has revenue */}
                    {isLast && b.total > 0 && (
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-[#171412] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md z-20 whitespace-nowrap">
                        {badgeText}
                      </div>
                    )}

                    {isLast ? (
                      /* Active Outer Box */
                      <div
                        style={{ height: `${heightPct}%` }}
                        className="w-full border border-dashed border-[#0F4C4C] rounded-sm p-0.5 flex flex-col justify-end bg-[rgba(15,76,76,0.03)] transition-all duration-300"
                      >
                        {b.total > 0 ? (
                          <div className="w-full flex flex-col rounded-t-xs overflow-hidden h-full gap-0.5">
                            {rzPct > 0 && (
                              <div
                                style={{ height: `${rzPct}%` }}
                                className="w-full bg-[#0F4C4C] transition-all"
                              />
                            )}
                            {billPct > 0 && (
                              <div
                                style={{ height: `${billPct}%` }}
                                className="w-full bg-[#5BA4A4] transition-all"
                              />
                            )}
                            {codPct > 0 && (
                              <div
                                style={{ height: `${codPct}%` }}
                                className="w-full bg-[#D97706] transition-all"
                              />
                            )}
                            {waPct > 0 && (
                              <div
                                style={{ height: `${waPct}%` }}
                                className="w-full bg-[#BE413B] transition-all"
                              />
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-full bg-[#FAF5EE] border border-dashed border-[#DAD1C4] rounded-t-xs" />
                        )}
                      </div>
                    ) : (
                      /* Regular Bar */
                      <div
                        style={{ height: `${heightPct}%` }}
                        className="w-full flex flex-col rounded-t-xs overflow-hidden gap-0.5 transition-all duration-300 group-hover:opacity-90"
                      >
                        {b.total > 0 ? (
                          <>
                            {rzPct > 0 && (
                              <div
                                style={{ height: `${rzPct}%` }}
                                className="w-full bg-[#0F4C4C] transition-all"
                              />
                            )}
                            {billPct > 0 && (
                              <div
                                style={{ height: `${billPct}%` }}
                                className="w-full bg-[#5BA4A4] transition-all"
                              />
                            )}
                            {codPct > 0 && (
                              <div
                                style={{ height: `${codPct}%` }}
                                className="w-full bg-[#D97706] transition-all"
                              />
                            )}
                            {waPct > 0 && (
                              <div
                                style={{ height: `${waPct}%` }}
                                className="w-full bg-[#BE413B] transition-all"
                              />
                            )}
                          </>
                        ) : (
                          <div className="w-full h-full bg-[#FAF5EE] border border-dashed border-[#DAD1C4] rounded-t-xs" />
                        )}
                      </div>
                    )}

                    <span
                      className={`text-[9px] mt-2 whitespace-nowrap ${
                        isLast ? "font-bold text-[#171412]" : "font-semibold text-[#8B8378]"
                      }`}
                    >
                      {b.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right Spotlight Panel: Period Summary (4 Cols) */}
          <div className="col-span-12 lg:col-span-4 bg-[#FBF9F6] border border-[#E9E3D8] rounded-xl p-4 space-y-4">
            {/* Header */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <h4 className="font-bold text-[13px] text-[#171412]">
                  {revenueTrendData.periodTitle}
                </h4>
                <span className="text-[10px] font-bold bg-[#E1EFE7] text-[#146C43] px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#146C43]"></span>
                  so far
                </span>
              </div>
              <div className="text-[11px] text-[#7C746A]">All categories</div>
            </div>

            {/* Total Period Revenue */}
            <div>
              <div className="text-[30px] font-extrabold tracking-tight text-[#171412] leading-none mb-1">
                {formatINR(revenueTrendData.periodRevenue)}
              </div>
              <span
                className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded ${
                  revenueTrendData.growthPct >= 0
                    ? "text-[#116840] bg-[#DCF2E5]"
                    : "text-[#BE413B] bg-[#FCEAE8]"
                }`}
              >
                {revenueTrendData.growthPct >= 0 ? "↑ +" : "↓ "}
                {revenueTrendData.growthPct}% vs prev period
              </span>
            </div>

            {/* Category Channel Breakdown */}
            <div className="space-y-1.5 pt-1 text-[11px]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-xs bg-[#0F4C4C]"></span>
                  <span className="text-[#595249] font-medium">Online shop</span>
                </div>
                <span className="font-bold text-[#171412]">
                  {formatINR(revenueTrendData.onlineRev)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-xs bg-[#5BA4A4]"></span>
                  <span className="text-[#595249] font-medium">Studio shop</span>
                </div>
                <span className="font-bold text-[#171412]">
                  {formatINR(revenueTrendData.studioRev)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-xs bg-[#D97706]"></span>
                  <span className="text-[#595249] font-medium">Wholesale / COD</span>
                </div>
                <span className="font-bold text-[#171412]">
                  {formatINR(revenueTrendData.wholesaleRev)}
                </span>
              </div>
            </div>

            {/* Top Buyer Card */}
            <div className="pt-2 border-t border-[#ECE5DB]">
              <div className="text-[9px] font-bold uppercase tracking-wider text-[#8A8277] mb-1.5">
                Top Buyer
              </div>
              {revenueTrendData.topBuyer ? (
                <div className="bg-white border border-[#E8E1D6] rounded-lg p-2.5 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[#E5EFE9] text-[#0F4C4C] font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                    {getInitials(revenueTrendData.topBuyer.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-[12px] text-[#171412] leading-tight truncate">
                      {revenueTrendData.topBuyer.name}
                    </div>
                    <div className="text-[10px] text-[#7C746A] leading-tight truncate">
                      {formatINR(
                        metrics.dateBounds?.isAllTime
                          ? revenueTrendData.topBuyer.totalSpent
                          : revenueTrendData.topBuyer.periodSpent || revenueTrendData.topBuyer.totalSpent
                      )}{" "}
                      in period
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-[#7C746A] italic py-1">
                  No orders in this period
                </div>
              )}
            </div>

            {/* Best Seller Card */}
            <div className="pt-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-[#8A8277] mb-1.5">
                Best Seller
              </div>
              <div className="bg-white border border-[#E8E1D6] rounded-lg p-2.5 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-[#D06F41] flex items-center justify-center flex-shrink-0">
                  <div className="w-3.5 h-3.5 rounded-full bg-[#FAF7F2]"></div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-[12px] text-[#171412] leading-tight truncate">
                    {revenueTrendData.bestSeller?.title || "Morning mug"}
                  </div>
                  <div className="text-[10px] text-[#7C746A] leading-tight truncate">
                    {revenueTrendData.bestSeller?.qty
                      ? `Sold ${revenueTrendData.bestSeller.qty} units · `
                      : ""}
                    {formatINR(revenueTrendData.bestSeller?.price || 32)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* ── END: Bottom Revenue Trend Section ── */}

      {/* ── Customer Details Drawer (RightDrawer) ── */}
      <RightDrawer
        open={drawerOpen && !!selectedCustomer}
        onClose={() => {
          setDrawerOpen(false)
          setSelectedCustomer(null)
        }}
        title="Customer Profile"
        widthPx={480}
        zIndex={70}
      >
        {selectedCustomer && (
          <div style={{ fontFamily: FONT }} className="p-6 space-y-6 text-[#171412]">
            {/* Customer Summary Card */}
            <div className="bg-[#FAF8F5] border border-[#E6E0D8] rounded-2xl p-5 flex items-center space-x-4">
              <div
                style={{
                  backgroundColor: getAvatarPalette(selectedCustomer.name).bg,
                  color: getAvatarPalette(selectedCustomer.name).text,
                }}
                className="w-14 h-14 rounded-2xl font-bold text-lg flex items-center justify-center shrink-0 shadow-sm"
              >
                {getInitials(selectedCustomer.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <h3 className="font-extrabold text-[17px] text-[#171412] truncate">
                    {selectedCustomer.name}
                  </h3>
                  <button
                    onClick={(e) => toggleStar(selectedCustomer.id, e)}
                    className="cursor-pointer"
                  >
                    <Star
                      className={`w-4 h-4 ${
                        selectedCustomer.isStarred ? "text-amber-500 fill-amber-500" : "text-stone-300"
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[12.5px] text-[#78716C] truncate mt-0.5">
                  {selectedCustomer.subtitle || selectedCustomer.email}
                </p>
                <div className="flex items-center space-x-2 mt-2">
                  <span className="bg-[#DDF0EB] text-[#0F4C4C] text-[10.5px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    {selectedCustomer.channel || "Retail"}
                  </span>
                  <span
                    className={`text-[10.5px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                      selectedCustomer.status === "suspended"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {selectedCustomer.status || "active"}
                  </span>
                </div>
              </div>
            </div>

            {/* 4 Quick Metric Tiles */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-[#E6E0D8] rounded-xl p-3.5">
                <span className="text-[11px] font-bold text-[#A8A29E] uppercase tracking-wider">
                  Lifetime Spend
                </span>
                <p className="text-xl font-extrabold text-[#171412] mt-1">
                  {formatINR(selectedCustomer.totalSpent)}
                </p>
              </div>
              <div className="bg-white border border-[#E6E0D8] rounded-xl p-3.5">
                <span className="text-[11px] font-bold text-[#A8A29E] uppercase tracking-wider">
                  Orders Count
                </span>
                <p className="text-xl font-extrabold text-[#171412] mt-1">
                  {selectedCustomer.ordersCount}
                </p>
              </div>
              <div className="bg-white border border-[#E6E0D8] rounded-xl p-3.5">
                <span className="text-[11px] font-bold text-[#A8A29E] uppercase tracking-wider">
                  AOV
                </span>
                <p className="text-xl font-extrabold text-[#171412] mt-1">
                  {formatINR(
                    selectedCustomer.ordersCount > 0
                      ? Math.round(selectedCustomer.totalSpent / selectedCustomer.ordersCount)
                      : 0
                  )}
                </p>
              </div>
              <div className="bg-white border border-[#E6E0D8] rounded-xl p-3.5">
                <span className="text-[11px] font-bold text-[#A8A29E] uppercase tracking-wider">
                  Last Order
                </span>
                <p className="text-sm font-bold text-[#171412] mt-1.5 truncate">
                  {formatRelativeTime(selectedCustomer.lastOrder)}
                </p>
              </div>
            </div>

            {/* Contact Details */}
            <div className="bg-white border border-[#E6E0D8] rounded-2xl p-4 space-y-3">
              <h4 className="text-[12px] font-bold text-[#171412] uppercase tracking-wider">
                Contact & Registry Info
              </h4>
              <div className="space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between py-1 border-b border-[#F2EFEA]">
                  <span className="text-[#78716C] flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5" /> Email
                  </span>
                  <a
                    href={`mailto:${selectedCustomer.email}`}
                    className="font-medium text-[#0F4C4C] hover:underline"
                  >
                    {selectedCustomer.email || "—"}
                  </a>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-[#F2EFEA]">
                  <span className="text-[#78716C] flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5" /> Phone
                  </span>
                  <span className="font-medium text-[#171412]">
                    {selectedCustomer.phone || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-[#F2EFEA]">
                  <span className="text-[#78716C] flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5" /> City
                  </span>
                  <span className="font-medium text-[#171412]">
                    {selectedCustomer.city || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[#78716C] flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5" /> Joined
                  </span>
                  <span className="font-medium text-[#171412]">
                    {formatJoinDate(selectedCustomer.joinDate)}
                  </span>
                </div>
              </div>
            </div>

            {/* Customer Orders History */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[12px] font-bold text-[#171412] uppercase tracking-wider flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-[#0F4C4C]" />
                  Order History ({customerOrders.length})
                </h4>
              </div>

              {loadingCustomerOrders ? (
                <div className="py-6 text-center text-[12px] text-[#78716C]">
                  Loading orders...
                </div>
              ) : customerOrders.length === 0 ? (
                <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl text-center text-[12px] text-[#78716C]">
                  No orders found for this customer.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                  {customerOrders.map((ord) => (
                    <div
                      key={ord.id}
                      className="bg-white border border-[#E6E0D8] rounded-xl p-3 hover:border-[#0F4C4C] transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="font-bold text-[13px] text-[#171412]">
                            Order #{String(ord.id).slice(0, 8)}
                          </span>
                          <span className="text-[11px] text-[#78716C]">
                            {new Date(ord.createdAt || ord.created_at || Date.now()).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="font-bold text-[13px] text-[#171412]">
                            {formatINR(ord.total || ord.totalAmount)}
                          </span>
                          <span className="bg-[#DDF0EB] text-[#0F4C4C] text-[10.5px] font-semibold px-2 py-0.5 rounded-full capitalize">
                            {ord.orderStatus || ord.order_status || "placed"}
                          </span>
                        </div>
                      </div>
                      {ord.products && ord.products.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[#F2EFEA] text-[11.5px] text-[#57534E]">
                          {ord.products.map((p) => `${p.title || 'Item'} × ${p.quantity || 1}`).join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </RightDrawer>

      {/* ── Create New Customer Modal ── */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            style={{ fontFamily: FONT }}
            className="bg-white rounded-3xl border border-[#E6E0D8] shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="p-6 border-b border-[#EFECE6] flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-xl text-[#171412]">Create New Customer</h3>
                <p className="text-[12px] text-[#78716C] mt-0.5">
                  Add a studio, wholesale, or retail customer to your registry
                </p>
              </div>
              <button
                onClick={() => setShowNewCustomerModal(false)}
                className="w-8 h-8 rounded-full border border-[#D8D2C9] flex items-center justify-center text-[#78716C] hover:text-[#171412] transition-colors cursor-pointer"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomerSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-[#171412] mb-1">
                  Customer / Business Name *
                </label>
                <input
                  required
                  type="text"
                  value={newCustomerForm.name}
                  onChange={(e) =>
                    setNewCustomerForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g. Hearth Provisions or Jane Doe"
                  className="w-full px-3.5 py-2 text-[13px] rounded-xl border border-[#D8D2C9] bg-white placeholder-[#A8A29E] focus:outline-none focus:ring-1 focus:ring-[#0F4C4C] focus:border-[#0F4C4C]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-bold text-[#171412] mb-1">
                  Email Address *
                </label>
                <input
                  required
                  type="email"
                  value={newCustomerForm.email}
                  onChange={(e) =>
                    setNewCustomerForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                  placeholder="e.g. contact@hearthprovisions.com"
                  className="w-full px-3.5 py-2 text-[13px] rounded-xl border border-[#D8D2C9] bg-white placeholder-[#A8A29E] focus:outline-none focus:ring-1 focus:ring-[#0F4C4C] focus:border-[#0F4C4C]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-bold text-[#171412] mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={newCustomerForm.phone}
                    onChange={(e) =>
                      setNewCustomerForm((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    placeholder="+1 (555) 012-3456"
                    className="w-full px-3.5 py-2 text-[13px] rounded-xl border border-[#D8D2C9] bg-white placeholder-[#A8A29E] focus:outline-none focus:ring-1 focus:ring-[#0F4C4C] focus:border-[#0F4C4C]"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#171412] mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={newCustomerForm.city}
                    onChange={(e) =>
                      setNewCustomerForm((prev) => ({ ...prev, city: e.target.value }))
                    }
                    placeholder="e.g. Seattle, WA"
                    className="w-full px-3.5 py-2 text-[13px] rounded-xl border border-[#D8D2C9] bg-white placeholder-[#A8A29E] focus:outline-none focus:ring-1 focus:ring-[#0F4C4C] focus:border-[#0F4C4C]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-bold text-[#171412] mb-1">
                    Channel
                  </label>
                  <select
                    value={newCustomerForm.channel}
                    onChange={(e) =>
                      setNewCustomerForm((prev) => ({ ...prev, channel: e.target.value }))
                    }
                    className="w-full px-3.5 py-2 text-[13px] rounded-xl border border-[#D8D2C9] bg-white text-[#171412] focus:outline-none focus:ring-1 focus:ring-[#0F4C4C]"
                  >
                    <option value="Retail">Retail</option>
                    <option value="Wholesale">Wholesale</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#171412] mb-1">
                    Role
                  </label>
                  <select
                    value={newCustomerForm.role}
                    onChange={(e) =>
                      setNewCustomerForm((prev) => ({ ...prev, role: e.target.value }))
                    }
                    className="w-full px-3.5 py-2 text-[13px] rounded-xl border border-[#D8D2C9] bg-white text-[#171412] focus:outline-none focus:ring-1 focus:ring-[#0F4C4C]"
                  >
                    <option value="user">User / Buyer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end space-x-3 border-t border-[#EFECE6]">
                <button
                  type="button"
                  onClick={() => setShowNewCustomerModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#D8D2C9] bg-white text-[#171412] font-semibold text-[13px] hover:bg-stone-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCustomer}
                  className="px-5 py-2 rounded-xl bg-[#0F4C4C] hover:bg-[#0B3A3A] text-white font-semibold text-[13px] shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submittingCustomer ? "Creating..." : "Create Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default CustomerAnalyticsPage
