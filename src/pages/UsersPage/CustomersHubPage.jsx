import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "react-toastify"
import { X } from "lucide-react"

import { supabase } from "../../context/SupabaseConfig"
import { queryOrdersWithShipments } from "../../services/shipping"
import { mapOrderRows } from "../../utils/supabaseOrders"
import CustomerHubHeader from "./CustomerHubHeader"
import CustomerEveryonePage from "./CustomerEveryonePage"
import CustomerAnalyticsPage from "./CustomerAnalyticsPage"

/* ── Pelago design tokens ── */
const FONT = "'Plus Jakarta Sans', sans-serif"

export const getDateBounds = (range = "Today", customFrom = "", customTo = "") => {
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
    const valid = customFrom && customTo && !isNaN(new Date(customFrom).getTime()) && !isNaN(new Date(customTo).getTime())
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

const CustomersHubPage = () => {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get("view") === "analytics" ? "analytics" : "everyone"

  // Active date range filter & custom dates
  const [activeDateRange, setActiveDateRange] = useState("Today")
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))

  // Date bounds helper
  const dateBounds = useMemo(() => {
    return getDateBounds(activeDateRange, customFrom, customTo)
  }, [activeDateRange, customFrom, customTo])

  // Starred customers
  const [starredIds, setStarredIds] = useState(() => {
    try {
      const saved = localStorage.getItem("pelago_starred_customers")
      return saved ? JSON.parse(saved) : ["cust-demo-1", "cust-demo-2", "cust-demo-4"]
    } catch {
      return ["cust-demo-1", "cust-demo-2", "cust-demo-4"]
    }
  })

  // Data state
  const [profiles, setProfiles] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  // Export handlers
  const everyoneExportRef = useRef(null)
  const analyticsExportRef = useRef(null)

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

  /* ── Tab Switch Handler (updates query param seamlessly) ── */
  const switchTab = useCallback((key) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set("view", key)
      return next
    }, { replace: true })
  }, [setParams])

  /* ── Starred customer toggle ── */
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

  /* ── Fetch Real Data Once at Hub Level ── */
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [{ data: profilesData }, { data: rawOrdersData, error: ordersError }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        queryOrdersWithShipments(
          (select) => supabase.from("orders").select(select).order("created_at", { ascending: false }),
          { admin: true }
        ),
      ])

      if (profilesData) setProfiles(profilesData)

      if (rawOrdersData) {
        const rawOrders = mapOrderRows(rawOrdersData)
        const productIds = [...new Set(rawOrders.flatMap((o) => (o.products || []).map((p) => p.productId)).filter(Boolean))]
        let productById = {}
        if (productIds.length) {
          const { data: pRows } = await supabase.from("products").select("id, thumbnail, image, price, final_price, sale_price, mrp, variants").in("id", productIds)
          ;(pRows || []).forEach((p) => { productById[p.id] = p })
        }
        const enrichedOrders = rawOrders.map((order) => {
          const products = (order.products || []).map((item) => {
            const pd = productById[item.productId]
            const price = item.finalPrice || item.price || item.unitPrice || Number(pd?.final_price ?? pd?.sale_price ?? pd?.price ?? 0)
            const qty = Number(item.quantity) || 1
            const lineTotal = item.lineTotal || (price * qty)
            return {
              ...item,
              price,
              finalPrice: price,
              unitPrice: price,
              lineTotal,
            }
          })
          const itemsSum = products.reduce((sum, it) => sum + (it.lineTotal || 0), 0)
          const total = (order.total && order.total > 0) ? order.total : itemsSum
          return {
            ...order,
            products,
            total,
            totalAmount: total,
          }
        })
        setOrders(enrichedOrders)
      }
    } catch (err) {
      console.error("Error fetching customers/orders:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()

    // Realtime subscriptions
    const profilesChannel = supabase
      .channel("hub-customers-profiles")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, fetchData)
      .subscribe()

    const ordersChannel = supabase
      .channel("hub-customers-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, fetchData)
      .subscribe()

    return () => {
      supabase.removeChannel(profilesChannel)
      supabase.removeChannel(ordersChannel)
    }
  }, [fetchData])

  /* ── Merge Database Profiles with Order Analytics ── */
  const allCustomers = useMemo(() => {
    const customersMap = {}
    const { startDate, endDate, isAllTime } = dateBounds

    // 1. Index profiles
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
      if (email) {
        customersMap[email] = custObj
      }
    }

    // 2. Attach orders and discover unprofiled customers
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

    // 3. Deduplicate and compute individual metrics (both all-time and period-specific)
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

      // Period-filtered orders for this customer
      const periodOrders = sortedOrders.filter((ord) => {
        if (isAllTime) return true
        const od = new Date(ord.createdAt || ord.created_at || 0)
        return od >= startDate && od <= endDate
      })
      const periodOrdersCount = periodOrders.length
      const periodSpent = periodOrders.reduce(
        (sum, ord) => sum + (Number(ord.total || ord.totalAmount) || 0),
        0
      )
      const periodAov = periodOrdersCount > 0 ? Math.round(periodSpent / periodOrdersCount) : 0
      const periodLastOrder = periodOrders[0]
        ? periodOrders[0].createdAt || periodOrders[0].created_at
        : null

      return {
        ...c,
        orders: sortedOrders,
        ordersCount,
        totalSpent,
        lastOrder,
        aov,
        channel,
        isStarred: starredIds.includes(c.id),
        // Filtered period metrics
        periodOrders,
        periodOrdersCount,
        periodSpent,
        periodAov,
        periodLastOrder,
      }
    })
  }, [profiles, orders, starredIds, dateBounds])

  /* ── 6 KPI Metrics + Segment Calculation Based on Selected Filter ── */
  const metrics = useMemo(() => {
    const { startDate, endDate, prevStart, prevEnd, isAllTime, label } = dateBounds

    // 1. Filter orders in current period
    const periodOrders = orders.filter((o) => {
      if (isAllTime) return true
      const d = new Date(o.createdAt || o.created_at || 0)
      return d >= startDate && d <= endDate
    })

    const totalOrders = periodOrders.length
    const totalRevenue = periodOrders.reduce((sum, o) => sum + (Number(o.total || o.totalAmount) || 0), 0)
    const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0

    // 2. Previous period orders for comparison
    const prevOrders = prevStart && prevEnd
      ? orders.filter((o) => {
          const d = new Date(o.createdAt || o.created_at || 0)
          return d >= prevStart && d <= prevEnd
        })
      : []
    const prevOrdersCount = prevOrders.length
    const prevRevenue = prevOrders.reduce((sum, o) => sum + (Number(o.total || o.totalAmount) || 0), 0)
    const prevAov = prevOrdersCount > 0 ? Math.round(prevRevenue / prevOrdersCount) : 0
    const prevUserIds = new Set(
      prevOrders.map((o) => o.userId || o.user_id || o.userEmail || o.customerEmail).filter(Boolean)
    )

    // 3. Customers who placed orders or joined in the period
    const periodCustomerIds = new Set(
      periodOrders.map((o) => o.userId || o.user_id || o.userEmail || o.customerEmail).filter(Boolean)
    )
    const activeCustomersInPeriod = allCustomers.filter((c) =>
      isAllTime ? c.ordersCount > 0 : c.periodOrdersCount > 0
    )
    const activeUsersCount = activeCustomersInPeriod.length
    const activeUsersSpend = activeCustomersInPeriod.reduce(
      (sum, c) => sum + (isAllTime ? c.totalSpent : c.periodSpent),
      0
    )

    const newUsersInPeriod = allCustomers.filter((c) => {
      const jd = new Date(c.joinDate)
      return isAllTime ? true : (jd >= startDate && jd <= endDate)
    })

    // Total Users for period
    const distinctPeriodUsers = allCustomers.filter(
      (c) => (c.periodOrdersCount > 0) || (new Date(c.joinDate) >= startDate && new Date(c.joinDate) <= endDate)
    )
    const totalUsers = isAllTime ? allCustomers.length : distinctPeriodUsers.length

    // 4. Comparison subtitles
    const usersSubtitle = isAllTime
      ? "all in studio"
      : prevUserIds.size > 0
      ? `${Math.round(((distinctPeriodUsers.length - prevUserIds.size) / prevUserIds.size) * 100)}% vs prev`
      : distinctPeriodUsers.length > 0 ? "+100% vs prev" : "0% vs prev"

    const ordersSubtitle = isAllTime
      ? "all time"
      : prevOrdersCount > 0
      ? `${Math.round(((totalOrders - prevOrdersCount) / prevOrdersCount) * 100)}% vs prev`
      : totalOrders > 0 ? "+100%" : "0%"

    const revenueSubtitle = isAllTime
      ? "all time"
      : prevRevenue > 0
      ? `${Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)}% vs prev`
      : totalRevenue > 0 ? "+100%" : "0%"

    const aovSubtitle = isAllTime
      ? "all time"
      : prevAov > 0
      ? `${Math.round(((aov - prevAov) / prevAov) * 100)}% vs prev`
      : "0%"

    // 5. Top Spender in this period
    const sortedByPeriodSpend = [...allCustomers].sort(
      (a, b) => (isAllTime ? b.totalSpent || 0 : b.periodSpent || 0) - (isAllTime ? a.totalSpent || 0 : a.periodSpent || 0)
    )
    const topSpenderRaw = sortedByPeriodSpend[0]
    const topSpender =
      topSpenderRaw && (isAllTime ? topSpenderRaw.totalSpent > 0 : topSpenderRaw.periodSpent > 0)
        ? {
            ...topSpenderRaw,
            name: topSpenderRaw.name,
            totalSpent: isAllTime ? topSpenderRaw.totalSpent : topSpenderRaw.periodSpent,
            periodSpent: isAllTime ? topSpenderRaw.totalSpent : topSpenderRaw.periodSpent,
          }
        : { name: "None in period", totalSpent: 0, periodSpent: 0 }

    // 6. Retention rate
    const repeatActiveUsers = activeCustomersInPeriod.filter((c) =>
      isAllTime ? c.ordersCount >= 2 : (c.periodOrdersCount >= 2 || c.ordersCount >= 2)
    )
    const retentionPct =
      activeUsersCount > 0
        ? Math.min(100, Math.round((repeatActiveUsers.length / activeUsersCount) * 100))
        : 100
    const activeUserSubtitle = `${activeUsersCount} active · ${retentionPct}% Retention`

    // 7. Segments counts & share (dynamically scaled for period)
    const collectorThreshold = isAllTime
      ? 15000
      : activeDateRange === "Today"
      ? 500
      : activeDateRange === "Last 7 Days"
      ? 1500
      : activeDateRange === "Last 30 Days"
      ? 3000
      : activeDateRange === "Last 90 Days"
      ? 6000
      : 10000

    const collectors = allCustomers.filter(
      (c) => (isAllTime ? c.totalSpent || 0 : c.periodSpent || 0) >= collectorThreshold
    )
    const collectorsRev = collectors.reduce(
      (acc, c) => acc + (isAllTime ? c.totalSpent || 0 : c.periodSpent || 0),
      0
    )
    const collectorsShare = totalRevenue > 0 ? Math.round((collectorsRev / totalRevenue) * 100) : 0

    const regulars = allCustomers.filter((c) =>
      isAllTime ? c.ordersCount >= 3 : (c.periodOrdersCount >= 2 || (c.ordersCount >= 2 && c.periodOrdersCount >= 1))
    )
    const regularsRev = regulars.reduce(
      (acc, c) => acc + (isAllTime ? c.totalSpent || 0 : c.periodSpent || 0),
      0
    )
    const regularsShare = totalRevenue > 0 ? Math.round((regularsRev / totalRevenue) * 100) : 0

    const newThisMonth = allCustomers.filter((c) => {
      const d = new Date(c.joinDate).getTime()
      return isAllTime ? d >= Date.now() - 30 * 86400000 : (d >= startDate.getTime() && d <= endDate.getTime())
    })
    const newThisMonthRev = newThisMonth.reduce(
      (acc, c) => acc + (isAllTime ? c.totalSpent || 0 : c.periodSpent || 0),
      0
    )
    const newMonthShare = totalRevenue > 0 ? Math.round((newThisMonthRev / totalRevenue) * 100) : (newThisMonth.length > 0 ? 15 : 0)

    const driftingAway = allCustomers.filter((c) => {
      if (!c.lastOrder) return false
      return isAllTime
        ? new Date(c.lastOrder).getTime() < Date.now() - 60 * 86400000
        : (c.periodOrdersCount === 0 && new Date(c.lastOrder) < startDate)
    })

    const wholesale = allCustomers.filter(
      (c) =>
        String(c.channel || "").toLowerCase() === "wholesale" &&
        (isAllTime ? (c.ordersCount > 0 || c.totalSpent > 0) : c.periodOrdersCount > 0)
    )
    const wholesaleRev = wholesale.reduce(
      (acc, c) => acc + (isAllTime ? c.totalSpent || 0 : c.periodSpent || 0),
      0
    )
    const wholesaleShare = totalRevenue > 0 ? Math.round((wholesaleRev / totalRevenue) * 100) : 0

    const retail = allCustomers.filter(
      (c) =>
        String(c.channel || "").toLowerCase() !== "wholesale" &&
        (isAllTime ? (c.ordersCount > 0 || c.totalSpent > 0) : c.periodOrdersCount > 0)
    )
    const retailRev = retail.reduce(
      (acc, c) => acc + (isAllTime ? c.totalSpent || 0 : c.periodSpent || 0),
      0
    )
    const retailShare = totalRevenue > 0 ? Math.round((retailRev / totalRevenue) * 100) : 100

    // Today's counter
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayOrders = orders.filter((o) => new Date(o.createdAt || o.created_at || 0) >= todayStart)
    const todayCount = todayOrders.length
    const todayRev = Math.round(
      todayOrders.reduce((acc, o) => acc + (Number(o.total || o.totalAmount) || 0), 0) / 1000
    )

    return {
      totalUsers,
      totalOrders,
      totalRevenue,
      aov,
      topSpender,
      activeUsersCount,
      activeUsersSpend,
      activeUserSubtitle,
      usersSubtitle,
      ordersSubtitle,
      revenueSubtitle,
      aovSubtitle,
      retentionPct,
      todayCount,
      todayRev,
      collectorThreshold,
      collectorsCount: collectors.length,
      collectorsShare,
      collectorsList: collectors,
      regularsCount: regulars.length,
      regularsShare,
      regularsList: regulars,
      newMonthCount: newThisMonth.length,
      newMonthShare,
      newThisMonthList: newThisMonth,
      driftingCount: driftingAway.length,
      driftingList: driftingAway,
      wholesaleCount: wholesale.length,
      wholesaleShare,
      wholesaleRev,
      wholesaleList: wholesale,
      retailCount: retail.length,
      retailShare,
      retailRev,
      maxSpend: Math.max(...allCustomers.map((c) => c.totalSpent || 0), 10000),
      maxPeriodSpend: Math.max(
        ...allCustomers.map((c) => (isAllTime ? c.totalSpent || 0 : c.periodSpent || 0)),
        5000
      ),
      everyoneTotalUsers: allCustomers.length,
      allCustomersCount: allCustomers.length,
      dateBounds,
      periodLabel: label,
    }
  }, [allCustomers, orders, dateBounds, activeDateRange])

  /* ── Trigger Export for Active Tab ── */
  const handleExport = useCallback(() => {
    if (activeTab === "analytics" && analyticsExportRef.current) {
      analyticsExportRef.current()
    } else if (everyoneExportRef.current) {
      everyoneExportRef.current()
    } else {
      toast.info("Preparing customer data export...")
    }
  }, [activeTab])

  /* ── Create New Customer Submit ── */
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

      const { error } = await supabase.from("profiles").insert([newRecord]).select()
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

  // Shared payload for child tab components
  const sharedData = useMemo(() => ({
    allCustomers,
    metrics,
    profiles,
    orders,
    starredIds,
    toggleStar,
    activeDateRange,
    setActiveDateRange,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    dateBounds,
    refetchData: fetchData,
  }), [allCustomers, metrics, profiles, orders, starredIds, toggleStar, activeDateRange, customFrom, customTo, dateBounds, fetchData])

  return (
    <div
      className="flex-1 w-full min-h-screen px-4 sm:px-6 md:px-8 py-5 max-w-[1440px] mx-auto text-[#1C1917]"
      style={{ fontFamily: FONT }}
    >
      {/* ── COMMON PERSISTENT HEADER: NEVER UNMOUNTS WHEN SWITCHING TABS ── */}
      <CustomerHubHeader
        activeTab={activeTab}
        onSwitchTab={switchTab}
        metrics={metrics}
        activeDateRange={activeDateRange}
        setActiveDateRange={setActiveDateRange}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        onExport={handleExport}
        onNewCustomer={() => setShowNewCustomerModal(true)}
      />

      {/* ── TAB CONTENT: ONLY TABS ALONE SWITCH (ZERO FLICKER, ZERO JUMP) ── */}
      <div className="w-full mt-6" data-purpose="customer-hub-tab-body">
        {/* Everyone Tab View */}
        <div style={{ display: activeTab === "everyone" ? "block" : "none" }}>
          <CustomerEveryonePage
            onSwitchTab={switchTab}
            showHeader={false}
            sharedData={sharedData}
            exportRef={everyoneExportRef}
            onOpenNewCustomer={() => setShowNewCustomerModal(true)}
          />
        </div>

        {/* Analytics Tab View */}
        <div style={{ display: activeTab === "analytics" ? "block" : "none" }}>
          <CustomerAnalyticsPage
            onSwitchTab={switchTab}
            showHeader={false}
            sharedData={sharedData}
            exportRef={analyticsExportRef}
            onOpenNewCustomer={() => setShowNewCustomerModal(true)}
          />
        </div>
      </div>

      {/* ── CREATE NEW CUSTOMER MODAL ── */}
      {showNewCustomerModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-[#D8D2C9] relative">
            <button
              onClick={() => setShowNewCustomerModal(false)}
              className="absolute top-4 right-4 text-[#78716C] hover:text-[#171412] p-1.5 rounded-full hover:bg-stone-100 transition-colors cursor-pointer"
              type="button"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold text-[#171412] mb-1">Add New Customer</h3>
            <p className="text-[12.5px] text-[#78716C] mb-5">
              Create a customer record in your studio database.
            </p>

            <form onSubmit={handleCreateCustomerSubmit} className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#171412] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Marcus Lindgren or Juniper Home"
                  value={newCustomerForm.name}
                  onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#D8D2C9] text-[13px] text-[#171412] focus:outline-hidden focus:border-[#0F4C4C]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#171412] mb-1">Subtitle / Company (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Buyer / Interior Stylist"
                  value={newCustomerForm.subtitle}
                  onChange={(e) => setNewCustomerForm({ ...newCustomerForm, subtitle: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#D8D2C9] text-[13px] text-[#171412] focus:outline-hidden focus:border-[#0F4C4C]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-[#171412] mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="marcus@example.com"
                    value={newCustomerForm.email}
                    onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#D8D2C9] text-[13px] text-[#171412] focus:outline-hidden focus:border-[#0F4C4C]"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#171412] mb-1">Phone</label>
                  <input
                    type="tel"
                    placeholder="+1 (206) 555-0192"
                    value={newCustomerForm.phone}
                    onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#D8D2C9] text-[13px] text-[#171412] focus:outline-hidden focus:border-[#0F4C4C]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-[#171412] mb-1">City / Region</label>
                  <input
                    type="text"
                    placeholder="Seattle"
                    value={newCustomerForm.city}
                    onChange={(e) => setNewCustomerForm({ ...newCustomerForm, city: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#D8D2C9] text-[13px] text-[#171412] focus:outline-hidden focus:border-[#0F4C4C]"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#171412] mb-1">Channel</label>
                  <select
                    value={newCustomerForm.channel}
                    onChange={(e) => setNewCustomerForm({ ...newCustomerForm, channel: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#D8D2C9] text-[13px] text-[#171412] bg-white focus:outline-hidden focus:border-[#0F4C4C]"
                  >
                    <option value="Retail">Retail</option>
                    <option value="Wholesale">Wholesale</option>
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

export default CustomersHubPage
