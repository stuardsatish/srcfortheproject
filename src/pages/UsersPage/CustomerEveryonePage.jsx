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
  Package,
  Layers,
  ChevronRight,
  TrendingUp,
} from "lucide-react"

import { supabase } from "../../context/SupabaseConfig"
import RightDrawer from "../../components/Common/RightDrawer"

/* ============================== DESIGN TOKENS ============================== */
const FONT = "'Plus Jakarta Sans', sans-serif"
const TEAL = "#0F4C4C"
const TEAL_DARK = "#0B3A3A"
const TEAL_LIGHT = "#DDF0EB"
const TEAL_PILL = "#E0F0EB"
const BORDER = "#E6E0D8"
const BORDER_SUBTLE = "#EFECE6"
const BORDER_MID = "#D8D2C9"
const CANVAS = "#EDE8E2"
const INK = "#171412"
const MUTED = "#78716C"
const SUBTLE = "#A8A29E"
const CARD_BG = "#FFFFFF"

/* Pastel avatar color palettes matching the Pelago design */
const AVATAR_PALETTES = [
  { bg: "#F6DDCC", text: "#93441A" },
  { bg: "#FAECD6", text: "#8E5C1E" },
  { bg: "#FBDBE4", text: "#9B294C" },
  { bg: "#DCF1EB", text: "#1C695A" },
  { bg: "#DBE8F1", text: "#215A7F" },
  { bg: "#D0E5E0", text: "#0F4C4C" },
  { bg: "#FCE5D2", text: "#8C4610" },
  { bg: "#E9E4F0", text: "#5B3F8A" },
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
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} h ago`
  const diffDays = Math.floor(diffHours / 24)
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


const CustomerEveryonePage = ({
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

  // Filters & search
  const [activeDateRange, setActiveDateRange] = useState(sharedData?.activeDateRange || "Today")
  const [channelFilter, setChannelFilter] = useState("all") // all | retail | wholesale | starred
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState("spend") // spend | last_order | name
  const [visibleCount, setVisibleCount] = useState(20)

  // Starred customer IDs (stored in localStorage for persistence)
  const [starredIds, setStarredIds] = useState(() => {
    try {
      const saved = localStorage.getItem("pelago_starred_customers")
      return saved ? JSON.parse(saved) : ["cust-demo-1", "cust-demo-2", "cust-demo-4"]
    } catch {
      return ["cust-demo-1", "cust-demo-2", "cust-demo-4"]
    }
  })

  // Selected customer for slide-over drawer
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

  /* ── Fetch Real Data from Supabase ── */
  const fetchData = useCallback(async () => {
    try {
      const [profilesRes, ordersRes] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("id, user_id, customer_name, customer_email, customer_phone, total, subtotal, order_status, status, created_at, address, shipping_address")
          .order("created_at", { ascending: false }),
      ])

      if (profilesRes.data) setProfiles(profilesRes.data)
      if (ordersRes.data) setOrders(ordersRes.data)
    } catch (err) {
      console.error("Error fetching customers/orders:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (sharedData?.profiles) setProfiles(sharedData.profiles)
    if (sharedData?.orders) setOrders(sharedData.orders)
    if (sharedData?.activeDateRange) setActiveDateRange(sharedData.activeDateRange)
    if (sharedData?.starredIds) setStarredIds(sharedData.starredIds)
  }, [sharedData])

  useEffect(() => {
    if (sharedData?.profiles && sharedData?.orders) {
      setLoading(false)
      return
    }

    fetchData()

    // Realtime subscriptions
    const profilesChannel = supabase
      .channel("customer-everyone-profiles")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, fetchData)
      .subscribe()

    const ordersChannel = supabase
      .channel("customer-everyone-orders")
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

  /* ── 6 KPI Metrics Calculation ── */
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

    // Active users / Retention (users with an order in the last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const activeUsersCount = allCustomers.filter((c) => {
      if (!c.lastOrder) return false
      return new Date(c.lastOrder).getTime() >= thirtyDaysAgo
    }).length
    const retentionPct = totalUsers > 0 ? Math.min(100, Math.round((activeUsersCount / totalUsers) * 100)) : 100

    // Today's stats for live counter
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
      maxSpend: Math.max(...allCustomers.map((c) => c.totalSpent || 0), 10000),
    }
  }, [sharedData, allCustomers, orders])

  /* ── Filtering & Sorting ── */
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

    // Sorting
    list.sort((a, b) => {
      if (sortBy === "spend") {
        return (b.totalSpent || 0) - (a.totalSpent || 0)
      }
      if (sortBy === "last_order") {
        const da = a.lastOrder ? new Date(a.lastOrder).getTime() : 0
        const db = b.lastOrder ? new Date(b.lastOrder).getTime() : 0
        return db - da
      }
      if (sortBy === "name") {
        return String(a.name || "").localeCompare(String(b.name || ""))
      }
      return 0
    })

    return list
  }, [allCustomers, channelFilter, searchQuery, sortBy])

  const displayedCustomers = useMemo(() => {
    return filteredCustomers.slice(0, visibleCount)
  }, [filteredCustomers, visibleCount])

  /* ── Customer Count Breakdowns for Pills ── */
  const counts = useMemo(() => {
    const total = allCustomers.length
    const retail = allCustomers.filter((c) => String(c.channel || "").toLowerCase() === "retail").length
    const wholesale = allCustomers.filter((c) => String(c.channel || "").toLowerCase() === "wholesale").length
    const starred = allCustomers.filter((c) => c.isStarred).length
    return { total, retail, wholesale, starred }
  }, [allCustomers])

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

  /* ── Admin Actions on Customer ── */
  const handleResetPassword = async () => {
    if (!selectedCustomer?.email) {
      toast.error("No email associated with this customer.")
      return
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(selectedCustomer.email)
      if (error) throw error
      toast.success(`Password reset instructions sent to ${selectedCustomer.email}`)
    } catch (err) {
      toast.error(`Reset email failed: ${err.message || "Unknown error"}`)
    }
  }

  const handleToggleSuspend = async () => {
    if (!selectedCustomer) return
    const newStatus = selectedCustomer.status === "suspended" ? "active" : "suspended"
    try {
      if (!selectedCustomer.id.startsWith("cust-demo-")) {
        const { error } = await supabase
          .from("profiles")
          .update({ status: newStatus })
          .eq("id", selectedCustomer.id)
        if (error) throw error
      }
      setSelectedCustomer((prev) => ({ ...prev, status: newStatus }))
      toast.success(`Account marked as ${newStatus}.`)
    } catch (err) {
      toast.error(`Failed to update status: ${err.message}`)
    }
  }

  const handleDeleteCustomer = async () => {
    if (!selectedCustomer) return
    if (!window.confirm(`Delete ${selectedCustomer.name}? This will permanently remove their profile.`)) return
    try {
      if (!selectedCustomer.id.startsWith("cust-demo-")) {
        const { error } = await supabase.from("profiles").delete().eq("id", selectedCustomer.id)
        if (error) throw error
      }
      toast.success("Customer removed.")
      setDrawerOpen(false)
      setSelectedCustomer(null)
      fetchData()
    } catch (err) {
      toast.error(`Could not delete customer: ${err.message}`)
    }
  }

  /* ── Export to Excel / CSV ── */
  const handleExport = () => {
    if (filteredCustomers.length === 0) {
      toast.info("No customers to export.")
      return
    }

    const dataRows = filteredCustomers.map((c, i) => ({
      "#": i + 1,
      Customer: c.name,
      Contact: c.subtitle || c.email,
      Email: c.email,
      Phone: c.phone || "—",
      City: c.city,
      "Join Date": formatJoinDate(c.joinDate),
      "Total Orders": c.ordersCount,
      "Lifetime Spend (INR)": c.totalSpent,
      "Last Order": c.lastOrder ? new Date(c.lastOrder).toLocaleDateString("en-IN") : "Never",
      Channel: c.channel,
      Status: c.status,
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(dataRows)
    XLSX.utils.book_append_sheet(wb, ws, "Customers")
    XLSX.writeFile(wb, `Pelago_Customers_${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(`Exported ${filteredCustomers.length} customers to Excel.`)
  }

  useEffect(() => {
    if (exportRef) {
      exportRef.current = handleExport
    }
  }, [exportRef, handleExport])

  /* ── Create New Customer ── */
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
    <div style={{ fontFamily: FONT }} className={`flex-1 w-full flex flex-col space-y-6 text-[#1C1917] pb-16 ${showHeader ? "" : "pt-0"}`}>
      {showHeader && (
        <>
          {/* ── Top Utility Filter Bar ── */}
      <header className="flex items-center justify-between flex-wrap gap-4 pt-1" data-purpose="date-filter-control">
        {/* Date Range Filter Segmented Control */}
        <nav className="inline-flex items-center bg-[#E4DDD4] p-1 rounded-xl text-[12px] font-medium text-[#78716C] space-x-0.5">
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

        {/* Right Utility Actions (Live counter, theme, alerts) */}
        <div className="flex items-center space-x-3">
          {/* Live Counter Indicator */}
          <div className="flex items-center space-x-2 bg-transparent text-[12px] font-medium text-[#44403C] px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-[#1B4D3E] animate-pulse"></span>
            <span>
              <strong className="font-bold text-[#171412]">{metrics.todayCount}</strong> today{" "}
              <span className="text-[#78716C]">₹{metrics.todayRev}k</span>
            </span>
          </div>

          {/* Moon Icon Button (Dark mode toggle) */}
          <button
            aria-label="Toggle dark mode"
            onClick={() => toast.info("Dark mode toggled.")}
            className="w-8 h-8 rounded-full border border-[#D8D2C9] bg-[#EDE8E2] flex items-center justify-center text-[#78716C] hover:text-[#171412] transition-colors cursor-pointer"
            type="button"
          >
            <Moon className="w-4 h-4" />
          </button>

          {/* Notification Bell with Alert Dot */}
          <button
            aria-label="Notifications"
            onClick={() => toast.info("No unread customer alerts.")}
            className="w-8 h-8 rounded-full border border-[#D8D2C9] bg-[#EDE8E2] flex items-center justify-center text-[#78716C] hover:text-[#171412] relative transition-colors cursor-pointer"
            type="button"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E05844]"></span>
          </button>
        </div>
      </header>

      {/* ── Page Title & Main Action Buttons ── */}
      <div className="flex items-center justify-between pt-1 flex-wrap gap-4">
        <div>
          <p className="text-[12px] text-[#78716C] font-medium mb-0.5">
            Studio shop, online and wholesale · everyone who has bought
          </p>
          <h1 className="text-3xl font-extrabold text-[#171412] tracking-tight">Customers</h1>
        </div>
        <div className="flex items-center space-x-2.5">
          {/* Export Button */}
          <button
            onClick={handleExport}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#D8D2C9] text-[12.5px] font-semibold text-[#171412] shadow-sm hover:bg-stone-50 transition-colors cursor-pointer"
            type="button"
          >
            <Download className="w-4 h-4 text-[#78716C]" />
            <span>Export</span>
          </button>

          {/* New Customer Button */}
          <button
            id="new-customer-btn"
            onClick={() => (onOpenNewCustomer ? onOpenNewCustomer() : setShowNewCustomerModal(true))}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#0F4C4C] hover:bg-[#0B3A3A] text-white text-[12.5px] font-semibold shadow-sm transition-colors cursor-pointer"
            type="button"
          >
            <Plus className="w-4 h-4 text-[#DDF0EB]" />
            <span>New customer</span>
          </button>
        </div>
      </div>

      {/* ── BEGIN: 6 KPI Metric Cards Grid ── */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5" data-purpose="kpi-metrics-grid">
        {/* Card 1: Total Users */}
        <div className="bg-white rounded-2xl p-4 border border-[#E6E0D8] shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-2 text-[12px] font-medium text-[#78716C]">
            <Users className="w-4 h-4 text-[#78716C]" />
            <span>Total Users</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#171412] tracking-tight">{metrics.totalUsers}</div>
            <div className="text-[11px] text-[#78716C] mt-0.5">200% vs prev</div>
          </div>
        </div>

        {/* Card 2: Total Orders */}
        <div className="bg-white rounded-2xl p-4 border border-[#E6E0D8] shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-2 text-[12px] font-medium text-[#78716C]">
            <ShoppingBag className="w-4 h-4 text-[#78716C]" />
            <span>Total Orders</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#171412] tracking-tight">{metrics.totalOrders}</div>
            <div className="text-[11px] text-[#78716C] mt-0.5">300%</div>
          </div>
        </div>

        {/* Card 3: Total Revenue */}
        <div className="bg-white rounded-2xl p-4 border border-[#E6E0D8] shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-2 text-[12px] font-medium text-[#78716C]">
            <IndianRupee className="w-4 h-4 text-[#78716C]" />
            <span>Total Revenue</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#171412] tracking-tight truncate">
              {metrics.totalRevenue > 99999
                ? `₹${(metrics.totalRevenue / 1000).toFixed(0)}k`
                : formatINR(metrics.totalRevenue)}
            </div>
            <div className="text-[11px] text-[#78716C] mt-0.5">322%</div>
          </div>
        </div>

        {/* Card 4: AOV */}
        <div className="bg-white rounded-2xl p-4 border border-[#E6E0D8] shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-2 text-[12px] font-medium text-[#78716C]">
            <Package className="w-4 h-4 text-[#78716C]" />
            <span>AOV</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#171412] tracking-tight">{formatINR(metrics.aov)}</div>
            <div className="text-[11px] text-[#78716C] mt-0.5">5%</div>
          </div>
        </div>

        {/* Card 5: Top Spender */}
        <div className="bg-white rounded-2xl p-4 border border-[#E6E0D8] shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-2 text-[12px] font-medium text-[#78716C]">
            <Sparkles className="w-4 h-4 text-[#78716C]" />
            <span>Top Spender</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#171412] tracking-tight truncate">
              {metrics.topSpender.name || "Satish"}
            </div>
            <div className="mt-1">
              <span className="inline-block bg-[#E0F0EB] text-[#0F4C4C] text-[10.5px] font-semibold px-2 py-0.5 rounded">
                Spent {formatINR(metrics.topSpender.totalSpent || 4010)}
              </span>
            </div>
          </div>
        </div>

        {/* Card 6: Active User */}
        <div className="bg-white rounded-2xl p-4 border border-[#E6E0D8] shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-2 text-[12px] font-medium text-[#78716C]">
            <Users className="w-4 h-4 text-[#78716C]" />
            <span>Active User</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#171412] tracking-tight">
              {formatINR(metrics.activeUsersCount > 0 ? metrics.activeUsersCount * 732 : 2928)}
            </div>
            <div className="text-[11px] text-[#78716C] mt-0.5">{metrics.retentionPct}% Retention</div>
          </div>
        </div>
      </section>
      {/* ── END: 6 KPI Metric Cards Grid ── */}

      {/* ── Sub-Tabs Bar: Customers vs Analytics ── */}
      <div className="border-b border-[#D8D2C9] flex items-center space-x-6 text-[13px] font-semibold pt-1">
        <button
          className="border-b-2 border-[#0F4C4C] pb-2 text-[#0F4C4C] flex items-center space-x-2 cursor-pointer"
          type="button"
        >
          <span>Customers</span>
          <span className="bg-[#DDF0EB] text-[#0F4C4C] text-[11px] font-bold px-2 py-0.5 rounded-full">
            {metrics.totalUsers}
          </span>
        </button>
        <button
          onClick={() => onSwitchTab && onSwitchTab("analytics")}
          className="pb-2 text-[#78716C] hover:text-[#171412] transition-colors cursor-pointer"
          type="button"
        >
          Analytics
        </button>
      </div>
        </>
      )}

      {/* ── BEGIN: Customer Data Table Card ── */}
      <div
        className="bg-white rounded-2xl border border-[#E6E0D8] shadow-xs overflow-hidden flex flex-col"
        data-purpose="customer-table-container"
      >
        {/* Table Controls & Search Filter Bar */}
        <div className="p-4 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-[#EFECE6]">
          <div className="flex items-center flex-wrap gap-3 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative w-full md:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#A8A29E]">
                <Search className="w-4 h-4" />
              </div>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-[12.5px] rounded-full border border-[#D8D2C9] bg-white placeholder-[#A8A29E] focus:outline-none focus:ring-1 focus:ring-[#0F4C4C] focus:border-[#0F4C4C]"
                placeholder="Search name, café, email or city"
                type="text"
              />
            </div>

            {/* Channel Filter Pills */}
            <div className="flex items-center space-x-1.5 text-[12px] font-medium text-[#78716C] flex-wrap gap-y-1">
              <button
                onClick={() => setChannelFilter("all")}
                className={`px-3 py-1.5 rounded-full font-semibold transition-colors cursor-pointer ${
                  channelFilter === "all"
                    ? "bg-[#1E293B] text-white"
                    : "hover:bg-stone-100 text-[#78716C]"
                }`}
                type="button"
              >
                All <span className={channelFilter === "all" ? "text-slate-300 font-normal" : "text-[#A8A29E]"}>{counts.total}</span>
              </button>
              <button
                onClick={() => setChannelFilter("retail")}
                className={`px-3 py-1.5 rounded-full transition-colors cursor-pointer ${
                  channelFilter === "retail"
                    ? "bg-[#1E293B] text-white font-semibold"
                    : "hover:bg-stone-100 text-[#78716C]"
                }`}
                type="button"
              >
                Retail <span className={channelFilter === "retail" ? "text-slate-300" : "text-[#A8A29E]"}>{counts.retail}</span>
              </button>
              <button
                onClick={() => setChannelFilter("wholesale")}
                className={`px-3 py-1.5 rounded-full transition-colors cursor-pointer ${
                  channelFilter === "wholesale"
                    ? "bg-[#1E293B] text-white font-semibold"
                    : "hover:bg-stone-100 text-[#78716C]"
                }`}
                type="button"
              >
                Wholesale <span className={channelFilter === "wholesale" ? "text-slate-300" : "text-[#A8A29E]"}>{counts.wholesale}</span>
              </button>
              <button
                onClick={() => setChannelFilter("starred")}
                className={`px-3 py-1.5 rounded-full transition-colors flex items-center space-x-1 cursor-pointer ${
                  channelFilter === "starred"
                    ? "bg-[#1E293B] text-white font-semibold"
                    : "hover:bg-stone-100 text-[#78716C]"
                }`}
                type="button"
              >
                <span>☆ Starred</span>
                <span className={channelFilter === "starred" ? "text-slate-300" : "text-[#A8A29E]"}>{counts.starred}</span>
              </button>
            </div>
          </div>

          {/* Sort Segmented Controls */}
          <div className="flex items-center space-x-2 text-[12px] shrink-0 self-end md:self-auto">
            <span className="text-[#78716C] font-medium">Sort</span>
            <div className="inline-flex items-center bg-[#EDE8E2] p-0.5 rounded-xl text-[#78716C] font-medium">
              <button
                onClick={() => setSortBy("spend")}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  sortBy === "spend"
                    ? "bg-white text-[#171412] font-semibold shadow-2xs"
                    : "hover:text-[#171412]"
                }`}
                type="button"
              >
                Lifetime spend
              </button>
              <button
                onClick={() => setSortBy("last_order")}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  sortBy === "last_order"
                    ? "bg-white text-[#171412] font-semibold shadow-2xs"
                    : "hover:text-[#171412]"
                }`}
                type="button"
              >
                Last order
              </button>
              <button
                onClick={() => setSortBy("name")}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  sortBy === "name"
                    ? "bg-white text-[#171412] font-semibold shadow-2xs"
                    : "hover:text-[#171412]"
                }`}
                type="button"
              >
                Name
              </button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px] border-collapse">
            <thead>
              <tr className="border-b border-[#EFECE6] text-[11px] font-bold text-[#A8A29E] tracking-wider uppercase">
                <th className="py-3.5 pl-6 pr-4" scope="col">Customer</th>
                <th className="py-3.5 px-4 font-semibold" scope="col">Join Date</th>
                <th className="py-3.5 px-4 font-semibold" scope="col">City</th>
                <th className="py-3.5 px-4 font-semibold" scope="col">Orders</th>
                <th className="py-3.5 px-4 font-semibold" scope="col">Lifetime Spend</th>
                <th className="py-3.5 px-4 font-semibold" scope="col">Last Order</th>
                <th className="py-3.5 pl-4 pr-6 font-semibold" scope="col">Segments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2EFEA]">
              {displayedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#78716C]">
                    No customers match your search or filter.
                  </td>
                </tr>
              ) : (
                displayedCustomers.map((c) => {
                  const palette = getAvatarPalette(c.name)
                  const initials = getInitials(c.name)
                  const spendPct = Math.min(100, Math.max(8, Math.round(((c.totalSpent || 0) / (metrics.maxSpend || 25000)) * 100)))

                  return (
                    <tr
                      key={c.id}
                      onClick={(e) => handleOpenCustomer(c, e)}
                      className="hover:bg-[#FAF8F5] transition-colors cursor-pointer group"
                    >
                      {/* Customer avatar & name */}
                      <td className="py-4 pl-6 pr-4">
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={(e) => toggleStar(c.id, e)}
                            title={c.isStarred ? "Starred customer" : "Click to star"}
                            className="text-stone-300 hover:text-amber-500 transition-colors p-0.5 cursor-pointer -ml-1"
                            type="button"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                c.isStarred ? "text-amber-500 fill-amber-500" : ""
                              }`}
                            />
                          </button>
                          <div
                            style={{ backgroundColor: palette.bg, color: palette.text }}
                            className="w-9 h-9 rounded-full font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs"
                          >
                            {initials}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-[#171412] text-[13px] truncate">
                              {c.name}
                            </span>
                            <span className="text-[11.5px] text-[#78716C] truncate">
                              {c.subtitle || c.email}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Join Date */}
                      <td className="py-4 px-4 text-[#44403C] font-medium whitespace-nowrap">
                        {formatJoinDate(c.joinDate)}
                      </td>

                      {/* City */}
                      <td className="py-4 px-4 text-[#44403C] font-medium whitespace-nowrap">
                        {c.city || "Seattle"}
                      </td>

                      {/* Orders */}
                      <td className="py-4 px-4 text-[#171412] font-semibold whitespace-nowrap">
                        {c.ordersCount}
                      </td>

                      {/* Lifetime Spend */}
                      <td className="py-4 px-4">
                        <div className="flex flex-col space-y-1 w-28">
                          <span className="font-bold text-[#171412]">
                            {formatINR(c.totalSpent)}
                          </span>
                          <div className="w-full h-1 bg-[#E2DCD4] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#0F4C4C] rounded-full transition-all duration-500"
                              style={{ width: `${spendPct}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>

                      {/* Last Order */}
                      <td className="py-4 px-4 text-[#44403C] font-medium whitespace-nowrap">
                        {formatRelativeTime(c.lastOrder)}
                      </td>

                      {/* Segments action button */}
                      <td className="py-4 pl-4 pr-6 whitespace-nowrap">
                        <button
                          onClick={(e) => handleOpenCustomer(c, e)}
                          className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-[#DDF0EB] text-[#0F4C4C] font-semibold text-[11.5px] hover:bg-[#CFE8E1] transition-colors cursor-pointer"
                          type="button"
                        >
                          <svg
                            className="w-3.5 h-3.5 text-[#0F4C4C]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            ></path>
                          </svg>
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

        {/* Table Footer with Show More Action */}
        <div className="p-4 border-t border-[#EFECE6] flex items-center justify-between text-[12.5px] text-[#78716C] flex-wrap gap-3">
          <div>
            Showing{" "}
            <span className="font-semibold text-[#171412]">
              {Math.min(visibleCount, filteredCustomers.length)}
            </span>{" "}
            of <span className="font-semibold text-[#171412]">{filteredCustomers.length}</span>
          </div>
          {visibleCount < filteredCustomers.length && (
            <button
              onClick={() => setVisibleCount((prev) => prev + 20)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-[#D8D2C9] bg-white text-[#171412] font-medium hover:bg-stone-50 transition-colors shadow-2xs cursor-pointer"
              type="button"
            >
              <span>Show 20 more</span>
              <ChevronDown className="w-4 h-4 text-[#78716C]" />
            </button>
          )}
        </div>
      </div>
      {/* ── END: Customer Data Table Card ── */}

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

            {/* Administrative Actions */}
            <div className="space-y-2 pt-2 border-t border-[#E6E0D8]">
              <span className="text-[11px] font-bold text-[#A8A29E] uppercase tracking-wider block mb-1">
                Account Actions
              </span>
              <button
                onClick={handleResetPassword}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl border border-[#D8D2C9] bg-white text-[#171412] hover:bg-stone-50 font-semibold text-[13px] transition-colors cursor-pointer"
                type="button"
              >
                <KeyRound className="w-4 h-4 text-[#78716C]" />
                <span>Send Password Reset Link</span>
              </button>

              <button
                onClick={handleToggleSuspend}
                className={`w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl font-semibold text-[13px] transition-colors cursor-pointer ${
                  selectedCustomer.status === "suspended"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                    : "bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                }`}
                type="button"
              >
                <Ban className="w-4 h-4" />
                <span>
                  {selectedCustomer.status === "suspended"
                    ? "Reactivate Customer Account"
                    : "Suspend Customer Account"}
                </span>
              </button>

              <button
                onClick={handleDeleteCustomer}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold text-[12.5px] transition-colors cursor-pointer"
                type="button"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Customer Permanently</span>
              </button>
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
            {/* Modal Header */}
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

            {/* Modal Form */}
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

              {/* Modal Actions */}
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

export default CustomerEveryonePage
