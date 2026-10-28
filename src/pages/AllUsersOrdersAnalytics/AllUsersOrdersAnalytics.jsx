import { useEffect, useState, useMemo, useRef } from "react"
import { supabase } from "../../context/SupabaseConfig"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import {
    Search,
    Download,
    Users,
    ShoppingBag,
    IndianRupee,
    TrendingUp,
    TrendingDown,
    Crown,
    Zap,
    ChevronDown,
    User as UserIcon,
    Calendar,
    ArrowUpRight,
    Star,
    Repeat,
    UserPlus,
    Clock,
    Briefcase,
} from "lucide-react"
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    PieChart,
    Pie,
    Cell,
} from "recharts"
import * as XLSX from "xlsx"
import { toast } from "react-toastify"
import RightDrawer from "../../components/Common/RightDrawer"
import Pagination from "../../components/Pagination"

/* ============================================================
   PELAGO DESIGN TOKENS
============================================================ */
const FONT = "'Plus Jakarta Sans', 'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

const TEAL = "#104945"
const TEAL_DARK = "#0B3838"
const TEAL_LIGHT = "#DEEEE7"
const TEAL_SUBTLE = "#E8F3F1"
const TERRACOTTA = "#BC5B3E"
const RUST = "#BE413B"
const OLIVE = "#527C32"
const AMBER = "#D99726"
const BORDER = "#E2DBD0"
const CANVAS = "#EDE8E1"
const CARD_BG = "#FFFFFF"
const INK = "#171412"
const MUTED = "#736B62"
const MUTED_LIGHT = "#8C8478"
const GREEN = "#167448"
const RED = "#BE413B"

const SEGMENT_COLORS = [TEAL, TERRACOTTA, "#D5CDBD"]

/* ============================================================
   HELPERS
============================================================ */
const toDate = (v) => {
    if (!v) return null
    if (v?.toDate) return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

const formatINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`

const formatCompactINR = (n) => {
    const num = Number(n || 0)
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(1)}Cr`
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`
    if (num >= 1000) return `₹${(num / 1000).toFixed(1)}k`
    return `₹${num.toLocaleString("en-IN")}`
}

const formatCount = (n) => {
    const num = Number(n || 0)
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
    return String(num)
}

const initials = (name) => {
    if (!name) return "U"
    return String(name).trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
}

const avatarColor = (name) => {
    const colors = [TEAL, TERRACOTTA, OLIVE, AMBER, "#6366F1", "#8B5CF6"]
    const s = String(name || "U")
    let h = 0
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
    return colors[Math.abs(h) % colors.length]
}

const relativeTime = (date) => {
    if (!date) return "—"
    const now = new Date()
    const diff = now - date
    const mins = Math.floor(diff / 60000)
    const hrs = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return "Just now"
    if (mins < 60) return `${mins} min ago`
    if (hrs < 24) return `${hrs}h ago`
    if (days === 1) return "Yesterday"
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

const PERIOD_DAYS = { today: 1, week: 7, month: 30, custom: 3650 }

const trendOf = (current, prev) => {
    if (!prev) return current > 0 ? { up: true, pct: 100 } : { up: true, pct: 0 }
    const pct = ((current - prev) / prev) * 100
    return { up: pct >= 0, pct: Math.abs(Math.round(pct)) }
}

const rankBadgeStyle = (rank) => {
    if (rank === 1) return { background: "linear-gradient(135deg, #F59E0B, #FDE68A)", color: "#78350F" }
    if (rank === 2) return { background: "linear-gradient(135deg, #94A3B8, #E2E8F0)", color: "#1E293B" }
    if (rank === 3) return { background: "linear-gradient(135deg, #B45309, #FDE68A)", color: "#78350F" }
    return null
}

const loyaltyTier = (rank) => {
    if (rank === 1) return "Platinum Collector"
    if (rank <= 3) return "Gold Regular"
    if (rank <= 6) return "Silver Member"
    return "Bronze Member"
}

const AllUsersOrdersAnalytics = () => {
    const [rawUsers, setRawUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState("month")
    const [search, setSearch] = useState("")
    const [minRev, setMinRev] = useState("")
    const [maxRev, setMaxRev] = useState("")
    const [sortBy, setSortBy] = useState("highest")
    const [expanded, setExpanded] = useState({})
    const [showAllLeaderboard, setShowAllLeaderboard] = useState(false)
    const [customFrom, setCustomFrom] = useState("")
    const [customTo, setCustomTo] = useState("")
    const [topSpendingPage, setTopSpendingPage] = useState(1)
    const [detailedOverviewPage, setDetailedOverviewPage] = useState(1)
    const PAGE_SIZE = 10

    // Order detail drawer
    const [selectedOrder, setSelectedOrder] = useState(null)
    const [displayedOrder, setDisplayedOrder] = useState(null)
    const openOrder = (user, order) => {
        setSelectedOrder({ ...order, customerName: user.name, customerEmail: user.email })
        setDisplayedOrder({ ...order, customerName: user.name, customerEmail: user.email })
    }
    const closeOrder = () => setSelectedOrder(null)

    const rootRef = useRef(null)

    /* ---------- FETCH — profiles + orders from Supabase ---------- */
    const fetchUsersOrders = async () => {
        try {
            setLoading(true)

            const [{ data: profiles }, { data: orderRows }] = await Promise.all([
                supabase.from("profiles").select("*"),
                supabase.from("orders").select("id, user_id, total, created_at, order_status, payment_method, customer_name, customer_email, customer_phone, address, razorpay_order_id"),
            ])

            const usersById = {}
            ;(profiles || []).forEach((u) => {
                usersById[u.id] = {
                    userId: u.id,
                    name: u.name || "Unknown User",
                    email: u.email || "—",
                    photoURL: u.photo_url || "",
                    createdAt: toDate(u.created_at),
                    orders: [],
                }
            })

            ;(orderRows || []).forEach((o) => {
                const uid = o.user_id
                if (!uid) return
                if (!usersById[uid]) {
                    usersById[uid] = {
                        userId: uid,
                        name: o.customer_name || "Unknown User",
                        email: o.customer_email || "—",
                        photoURL: "",
                        createdAt: null,
                        orders: [],
                    }
                }
                usersById[uid].orders.push({
                    id: o.id,
                    externalOrderId: o.razorpay_order_id || "",
                    total: Number(o.total || 0),
                    date: toDate(o.created_at),
                    items: [],
                    status: o.order_status || "placed",
                    paymentMethod: o.payment_method || "",
                    userName: o.customer_name || "",
                    userEmail: o.customer_email || "",
                    userPhone: o.customer_phone || "",
                    address: o.address || "",
                })
            })

            setRawUsers(Object.values(usersById))
        } catch (error) {
            console.error("fetchUsersOrders error:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchUsersOrders()
    }, [])

    /* ---------- DERIVED METRICS ---------- */
    const metrics = useMemo(() => {
        const now = new Date()
        const periodDays = PERIOD_DAYS[filter] ?? 30
        const customValid = filter === "custom" && customFrom && customTo && new Date(customFrom) <= new Date(customTo)
        const periodStart = filter === "custom"
            ? (customValid ? new Date(customFrom) : new Date(0))
            : new Date(now.getTime() - periodDays * 86400000)
        const periodEnd = filter === "custom" && customValid
            ? new Date(new Date(customTo).getTime() + 86400000 - 1)
            : now
        const prevStart = new Date(now.getTime() - 2 * periodDays * 86400000)
        const last30 = new Date(now.getTime() - 30 * 86400000)
        const last60 = new Date(now.getTime() - 60 * 86400000)

        // Per-user stats
        const users = rawUsers.map((u) => {
            const inPeriod = u.orders.filter((o) => o.date && o.date >= periodStart && o.date <= periodEnd)
            const allTimeTotal = u.orders.reduce((s, o) => s + o.total, 0)
            const periodTotal = inPeriod.reduce((s, o) => s + o.total, 0)
            const last30Count = u.orders.filter((o) => o.date && o.date >= last30).length
            const lastOrderDate = u.orders.reduce(
                (m, o) => (o.date && (!m || o.date > m) ? o.date : m),
                null
            )
            const total = periodTotal
            const periodOrders = inPeriod
            const orderCount = periodOrders.length
            return {
                ...u,
                total,
                orderCount,
                allTimeOrdersCount: u.orders.length,
                periodOrders,
                aov: orderCount > 0 ? total / orderCount : 0,
                last30Count,
                lastOrderDate,
                allTimeTotal,
            }
        })

        // Global KPIs
        const totalUsers = users.length
        const totalOrders = users.reduce((s, u) => s + u.orderCount, 0)
        const totalRevenue = users.reduce((s, u) => s + u.total, 0)
        const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0
        const topSpender = [...users].sort((a, b) => b.total - a.total)[0] || null
        const activeCustomers = users.filter((u) => u.last30Count >= 1).length

        // Period-over-period trends
        let curRev = 0, prevRev = 0, curOrd = 0, prevOrd = 0
        rawUsers.forEach((u) => {
            u.orders.forEach((o) => {
                if (!o.date) return
                if (o.date >= periodStart && o.date <= periodEnd) { curRev += o.total; curOrd += 1 }
                else if (o.date >= prevStart && o.date < periodStart) { prevRev += o.total; prevOrd += 1 }
            })
        })
        let curUsers = 0, prevUsers = 0
        rawUsers.forEach((u) => {
            if (!u.createdAt) return
            if (u.createdAt >= periodStart && u.createdAt <= periodEnd) curUsers += 1
            else if (u.createdAt >= prevStart && u.createdAt < periodStart) prevUsers += 1
        })
        const prev30Start = new Date(now.getTime() - 60 * 86400000)
        let prevActive = 0
        rawUsers.forEach((u) => {
            if (u.orders.some((o) => o.date && o.date >= prev30Start && o.date < last30)) prevActive += 1
        })
        const trends = {
            users: trendOf(curUsers, prevUsers),
            orders: trendOf(curOrd, prevOrd),
            revenue: trendOf(curRev, prevRev),
            aov: trendOf(curOrd ? curRev / curOrd : 0, prevOrd ? prevRev / prevOrd : 0),
            active: trendOf(activeCustomers, prevActive),
        }

        // Revenue trend series (daily buckets)
        const seriesDays = filter === "today" ? 7 : filter === "week" ? 7 : 30
        const dayMap = {}
        for (let i = seriesDays - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 86400000)
            const key = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
            dayMap[key] = 0
        }
        rawUsers.forEach((u) =>
            u.orders.forEach((o) => {
                if (!o.date) return
                const within = new Date(now.getTime() - seriesDays * 86400000)
                if (o.date >= within) {
                    const key = o.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                    if (dayMap[key] !== undefined) dayMap[key] += o.total
                }
            })
        )
        const seriesVals = Object.values(dayMap)
        const dailyAverage = seriesVals.length ? seriesVals.reduce((a, b) => a + b, 0) / seriesVals.length : 0
        const target = dailyAverage * 1.1
        const revenueSeries = Object.entries(dayMap).map(([date, revenue]) => ({
            date,
            revenue: Math.round(revenue),
            target: Math.round(target),
        }))

        // Peak growth
        let peakGrowth = 0
        for (let i = 1; i < seriesVals.length; i++) {
            if (seriesVals[i - 1] > 0) {
                const g = ((seriesVals[i] - seriesVals[i - 1]) / seriesVals[i - 1]) * 100
                if (g > peakGrowth) peakGrowth = g
            }
        }
        const todayRevenue = seriesVals[seriesVals.length - 1] || 0
        const ordersToday = rawUsers.reduce(
            (s, u) => s + u.orders.filter((o) => o.date && o.date >= new Date(now.getTime() - 86400000)).length,
            0
        )
        const currentVelocity = ordersToday / 24

        // Segments
        const spends = users.map((u) => u.total).filter((v) => v > 0).sort((a, b) => a - b)
        const p75 = spends.length ? spends[Math.floor(spends.length * 0.75)] : 0
        let power = 0, regulars = 0, casual = 0
        let collectorsRev = 0, regularsRev = 0, newRev = 0, driftingRev = 0, wholesaleRev = 0
        let collectorsList = [], regularsList = [], newList = [], driftingList = [], wholesaleList = []

        users.forEach((u) => {
            // Segments for chart
            if (u.total > 0 && u.total >= p75 && p75 > 0) power += 1
            else if (u.last30Count >= 2) regulars += 1
            else casual += 1

            // 5 Segment Cards
            if (u.allTimeTotal >= 5000 || (p75 > 0 && u.total >= p75)) {
                collectorsList.push(u)
                collectorsRev += u.total
            }
            if (u.allTimeOrdersCount >= 3) {
                regularsList.push(u)
                regularsRev += u.total
            }
            if (u.createdAt && u.createdAt >= last30) {
                newList.push(u)
                newRev += u.total
            }
            if (u.orders.length > 0 && (!u.lastOrderDate || u.lastOrderDate < last60)) {
                driftingList.push(u)
                driftingRev += u.total
            }
            if (u.allTimeOrdersCount >= 5 || u.allTimeTotal >= 10000) {
                wholesaleList.push(u)
                wholesaleRev += u.total
            }
        })

        const segments = [
            { name: "Power Users (High Spend)", value: power },
            { name: "Active Regulars", value: regulars },
            { name: "Casual / Inactive", value: casual },
        ]

        const segmentCards = [
            {
                id: "collectors",
                title: "Collectors",
                desc: "High-value spenders (Top tier)",
                members: collectorsList.length,
                pct: totalRevenue > 0 ? Math.min(100, Math.round((collectorsRev / totalRevenue) * 100)) : 0,
                color: TEAL,
                bgIcon: TEAL_LIGHT,
                icon: <Crown size={15} />,
                membersList: collectorsList,
            },
            {
                id: "regulars",
                title: "Regulars",
                desc: "Three orders or more",
                members: regularsList.length,
                pct: totalRevenue > 0 ? Math.min(100, Math.round((regularsRev / totalRevenue) * 100)) : 0,
                color: TERRACOTTA,
                bgIcon: "#FBEFEA",
                icon: <Repeat size={15} />,
                membersList: regularsList,
            },
            {
                id: "new",
                title: "New this month",
                desc: "Joined in the last 30 days",
                members: newList.length,
                pct: totalRevenue > 0 ? Math.min(100, Math.round((newRev / totalRevenue) * 100)) : 0,
                color: OLIVE,
                bgIcon: "#EAF2E4",
                icon: <UserPlus size={15} />,
                membersList: newList,
            },
            {
                id: "drifting",
                title: "Drifting away",
                desc: "No order in last 60 days",
                members: driftingList.length,
                pct: totalRevenue > 0 ? Math.min(100, Math.round((driftingRev / totalRevenue) * 100)) : 0,
                color: RUST,
                bgIcon: "#F8EAE9",
                icon: <Clock size={15} />,
                membersList: driftingList,
            },
            {
                id: "wholesale",
                title: "Wholesale & VIP",
                desc: "Bulk & frequent volume orders",
                members: wholesaleList.length,
                pct: totalRevenue > 0 ? Math.min(100, Math.round((wholesaleRev / totalRevenue) * 100)) : 0,
                color: AMBER,
                bgIcon: "#FBF2E3",
                icon: <Briefcase size={15} />,
                membersList: wholesaleList,
            },
        ]

        // Filtered + sorted display list
        let displayed = users.filter((u) => {
            const q = search.toLowerCase()
            const matchSearch =
                !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
            const min = minRev === "" ? -Infinity : Number(minRev)
            const max = maxRev === "" ? Infinity : Number(maxRev)
            return matchSearch && u.total >= min && u.total <= max
        })
        displayed.sort((a, b) => {
            if (sortBy === "newest") return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
            if (sortBy === "oldest") return (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0)
            return b.total - a.total
        })

        return {
            totalUsers, totalOrders, totalRevenue, aov, topSpender, activeCustomers,
            trends, revenueSeries, dailyAverage, peakGrowth, todayRevenue, currentVelocity,
            segments, segmentCards, displayed,
        }
    }, [rawUsers, filter, search, minRev, maxRev, sortBy, customFrom, customTo])

    useEffect(() => {
        setTopSpendingPage(1)
        setDetailedOverviewPage(1)
    }, [filter, search, minRev, maxRev, sortBy, customFrom, customTo])

    const topSpendingTotalPages = Math.max(1, Math.ceil(metrics.displayed.length / PAGE_SIZE))
    const topSpendingSafePage = Math.min(topSpendingPage, topSpendingTotalPages)
    const topSpendingPageItems = metrics.displayed.slice((topSpendingSafePage - 1) * PAGE_SIZE, topSpendingSafePage * PAGE_SIZE)

    const detailedOverviewTotalPages = Math.max(1, Math.ceil(metrics.displayed.length / PAGE_SIZE))
    const detailedOverviewSafePage = Math.min(detailedOverviewPage, detailedOverviewTotalPages)
    const detailedOverviewPageItems = metrics.displayed.slice((detailedOverviewSafePage - 1) * PAGE_SIZE, detailedOverviewSafePage * PAGE_SIZE)

    /* ---------- ANIMATIONS ---------- */
    useGSAP(() => {
        if (loading) return
        const cards = gsap.utils.toArray(".kpi-card")
        if (cards.length) gsap.from(cards, { y: 20, opacity: 0, duration: 0.4, stagger: 0.08, ease: "power2.out" })
    }, { scope: rootRef, dependencies: [loading, filter] })

    const toggleExpand = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }))

    const segTotal = metrics.segments?.reduce((s, x) => s + x.value, 0) || 0

    /* ---------- EXPORT TO EXCEL ---------- */
    const exportToExcel = () => {
        const m = metrics
        if (!m.displayed?.length) {
            toast.info("No customer data to export for this period.")
            return
        }
        const periodLabel = { today: "Today", week: "Last 7 Days", month: "Last 30 Days", custom: "Custom Range" }[filter] || filter

        const summary = [
            ["Users & Orders Analytics — Pelago Store"],
            ["Period", periodLabel],
            ["Generated", new Date().toLocaleString("en-IN")],
            [],
            ["Metric", "Value"],
            ["Total Customers", m.totalUsers],
            ["Total Orders", m.totalOrders],
            ["Total Revenue (INR)", Math.round(m.totalRevenue)],
            ["Avg Order Value (INR)", Math.round(m.aov)],
            ["Active Customers (last 30d)", m.activeCustomers],
            ["Top Spender", m.topSpender ? `${m.topSpender.name} (INR ${Math.round(m.topSpender.total)})` : "—"],
        ]
        const customers = m.displayed.map((u, i) => ({
            Rank: i + 1,
            "Customer Name": u.name,
            Email: u.email,
            Orders: u.orderCount,
            "Total Spend (INR)": Math.round(u.total),
            "AOV (INR)": Math.round(u.aov),
            "Last Order": u.lastOrderDate ? u.lastOrderDate.toLocaleDateString("en-IN") : "—",
        }))
        const trend = (m.revenueSeries || []).map((d) => ({ Date: d.date, "Revenue (INR)": d.revenue }))

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary")
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customers), "Customers")
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trend), "Revenue Trend")
        XLSX.writeFile(wb, `Customers_Analytics_${periodLabel.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`)
        toast.success("Exported users analytics to Excel.")
    }

    /* ---------- LOADING STATE ---------- */
    if (loading) {
        return (
            <div style={{ padding: "24px", fontFamily: FONT }} className="animate-pulse">
                <div style={{ height: "40px", background: "#E8E2D8", borderRadius: "14px", width: "320px", marginBottom: "20px" }} />
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} style={{ height: "110px", background: CARD_BG, borderRadius: "18px", border: `1px solid ${BORDER}` }} />
                    ))}
                </div>
                <div style={{ height: "300px", background: CARD_BG, borderRadius: "18px", border: `1px solid ${BORDER}` }} />
            </div>
        )
    }

    const FILTERS = [
        { key: "today", label: "Today" },
        { key: "week", label: "Last 7 Days" },
        { key: "month", label: "Last 30 Days" },
        { key: "custom", label: "Custom" },
    ]
    const m = metrics

    const KpiTrend = ({ t, label }) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11px", fontWeight: 700, color: t.up ? GREEN : RED }}>
            {t.up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {t.pct}% {label}
        </span>
    )

    return (
        <div ref={rootRef} style={{ fontFamily: FONT, color: INK, padding: "20px 24px 80px" }}>

            {/* TOP CONTROLS & TIME RANGE PILLS */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "20px" }}>
                {/* Date Range Pills */}
                <div style={{ display: "inline-flex", background: "#E2DBD1", padding: "4px", borderRadius: "9999px", gap: "2px" }}>
                    {FILTERS.map((f) => {
                        const active = filter === f.key
                        return (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                style={{
                                    padding: "5px 14px",
                                    fontSize: "12px",
                                    fontWeight: active ? 700 : 600,
                                    borderRadius: "9999px",
                                    background: active ? CARD_BG : "transparent",
                                    color: active ? INK : MUTED,
                                    border: "none",
                                    cursor: "pointer",
                                    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                                    transition: "all 0.15s ease",
                                }}
                            >
                                {f.label}
                            </button>
                        )
                    })}
                </div>

                {/* Right controls: Live stat pill + Export button */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ background: "#E4DED5", padding: "6px 14px", borderRadius: "9999px", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", border: `1px solid ${BORDER}` }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: GREEN, display: "inline-block" }} className="animate-pulse" />
                        <span style={{ fontWeight: 700, color: INK }}>{m.todayRevenue > 0 ? formatINR(m.todayRevenue) : "Active"}</span>
                        <span style={{ color: MUTED }}>today</span>
                    </div>

                    <button
                        onClick={exportToExcel}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "7px 16px",
                            borderRadius: "9999px",
                            background: CARD_BG,
                            border: `1px solid ${BORDER}`,
                            color: INK,
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                            transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#FAF8F5"}
                        onMouseLeave={(e) => e.currentTarget.style.background = CARD_BG}
                    >
                        <Download size={14} /> Export
                    </button>
                </div>
            </div>

            {/* Custom Range Picker */}
            {filter === "custom" && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "12px 16px", background: CARD_BG, borderRadius: "14px", border: `1px solid ${BORDER}`, marginBottom: "20px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: MUTED }}>Custom Range:</span>
                    <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        max={customTo || undefined}
                        style={{ padding: "5px 10px", borderRadius: "8px", border: `1px solid ${BORDER}`, fontSize: "12px", outline: "none", fontFamily: FONT }}
                    />
                    <span style={{ fontSize: "12px", color: MUTED }}>to</span>
                    <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        min={customFrom || undefined}
                        style={{ padding: "5px 10px", borderRadius: "8px", border: `1px solid ${BORDER}`, fontSize: "12px", outline: "none", fontFamily: FONT }}
                    />
                    {customFrom && customTo && new Date(customFrom) > new Date(customTo) && (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: RED }}>Start date must be before end date</span>
                    )}
                </div>
            )}

            {/* 6 TOP KPI CARDS */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                {/* 1. Total Users */}
                <div className="kpi-card" style={{ background: CARD_BG, borderRadius: "18px", padding: "16px", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ width: "26px", height: "26px", borderRadius: "8px", background: TEAL_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: TEAL, marginBottom: "10px" }}>
                        <Users size={14} />
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: MUTED, marginBottom: "2px" }}>Total Users</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: INK, lineHeight: 1.1 }}>{formatCount(m.totalUsers)}</div>
                    <div style={{ marginTop: "4px" }}><KpiTrend t={m.trends.users} label="vs prev" /></div>
                </div>

                {/* 2. Total Orders */}
                <div className="kpi-card" style={{ background: CARD_BG, borderRadius: "18px", padding: "16px", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ width: "26px", height: "26px", borderRadius: "8px", background: TEAL_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: TEAL, marginBottom: "10px" }}>
                        <ShoppingBag size={14} />
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: MUTED, marginBottom: "2px" }}>Total Orders</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: INK, lineHeight: 1.1 }}>{m.totalOrders.toLocaleString("en-IN")}</div>
                    <div style={{ marginTop: "4px" }}><KpiTrend t={m.trends.orders} label="" /></div>
                </div>

                {/* 3. Total Revenue */}
                <div className="kpi-card" style={{ background: CARD_BG, borderRadius: "18px", padding: "16px", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ width: "26px", height: "26px", borderRadius: "8px", background: TEAL_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: TEAL, marginBottom: "10px" }}>
                        <IndianRupee size={14} />
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: MUTED, marginBottom: "2px" }}>Total Revenue</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: INK, lineHeight: 1.1 }}>{formatCompactINR(m.totalRevenue)}</div>
                    <div style={{ marginTop: "4px" }}><KpiTrend t={m.trends.revenue} label="" /></div>
                </div>

                {/* 4. AOV */}
                <div className="kpi-card" style={{ background: CARD_BG, borderRadius: "18px", padding: "16px", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ width: "26px", height: "26px", borderRadius: "8px", background: TEAL_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: TEAL, marginBottom: "10px" }}>
                        <TrendingUp size={14} />
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: MUTED, marginBottom: "2px" }}>AOV</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: INK, lineHeight: 1.1 }}>{formatINR(Math.round(m.aov))}</div>
                    <div style={{ marginTop: "4px" }}><KpiTrend t={m.trends.aov} label="" /></div>
                </div>

                {/* 5. Top Spender */}
                <div className="kpi-card" style={{ background: CARD_BG, borderRadius: "18px", padding: "16px", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ width: "26px", height: "26px", borderRadius: "8px", background: TEAL_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: TEAL, marginBottom: "10px" }}>
                        <Crown size={14} />
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: MUTED, marginBottom: "2px" }}>Top Spender</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: INK, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.topSpender?.name || "—"}
                    </div>
                    <div style={{ marginTop: "4px" }}>
                        <span style={{ display: "inline-block", fontSize: "10px", fontWeight: 700, background: "#E6F3EC", color: GREEN, padding: "2px 6px", borderRadius: "6px" }}>
                            {formatINR(m.topSpender?.total || 0)}
                        </span>
                    </div>
                </div>

                {/* 6. Active User */}
                <div className="kpi-card" style={{ background: CARD_BG, borderRadius: "18px", padding: "16px", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ width: "26px", height: "26px", borderRadius: "8px", background: TEAL_LIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: TEAL, marginBottom: "10px" }}>
                        <Zap size={14} />
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: MUTED, marginBottom: "2px" }}>Active Users</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: INK, lineHeight: 1.1 }}>{formatCount(m.activeCustomers)}</div>
                    <div style={{ marginTop: "4px" }}><KpiTrend t={m.trends.active} label="Retention" /></div>
                </div>
            </div>

            {/* CUSTOMER SEGMENT CARDS (5 Cards Grid from Pelago CustomerAnalytics.html) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 mb-6">
                {m.segmentCards.map((seg) => (
                    <div
                        key={seg.id}
                        style={{
                            background: CARD_BG,
                            borderRadius: "18px",
                            padding: "16px",
                            border: `1px solid ${BORDER}`,
                            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                        }}
                    >
                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <div style={{ width: "24px", height: "24px", borderRadius: "6px", background: seg.bgIcon, color: seg.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        {seg.icon}
                                    </div>
                                    <span style={{ fontWeight: 700, fontSize: "13px", color: INK }}>{seg.title}</span>
                                </div>
                            </div>
                            <p style={{ fontSize: "10px", color: MUTED, margin: "0 0 12px", lineHeight: "1.2" }}>{seg.desc}</p>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                                <div>
                                    <div style={{ fontSize: "10px", color: MUTED }}>Members</div>
                                    <div style={{ fontSize: "18px", fontWeight: 800, color: INK }}>{seg.members}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: "10px", color: MUTED }}>Rev Share</div>
                                    <div style={{ fontSize: "18px", fontWeight: 800, color: INK }}>{seg.pct}%</div>
                                </div>
                            </div>
                            {/* Progress bar */}
                            <div style={{ width: "100%", background: "#EAE4DB", height: "4px", borderRadius: "9999px", overflow: "hidden", marginBottom: "12px" }}>
                                <div style={{ width: `${seg.pct}%`, background: seg.color, height: "100%", transition: "width 0.4s" }} />
                            </div>
                        </div>

                        {/* Avatars Footer */}
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingTop: "8px", borderTop: "1px solid #F4EFEB" }}>
                            {seg.membersList.length > 0 ? (
                                <>
                                    <div style={{ display: "flex", marginLeft: "-2px" }}>
                                        {seg.membersList.slice(0, 3).map((u, i) => (
                                            <span
                                                key={u.userId}
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    width: "20px",
                                                    height: "20px",
                                                    borderRadius: "50%",
                                                    background: avatarColor(u.name),
                                                    color: "#FFF",
                                                    fontSize: "8px",
                                                    fontWeight: 800,
                                                    marginLeft: i > 0 ? "-6px" : 0,
                                                    border: "1.5px solid #FFF",
                                                }}
                                            >
                                                {initials(u.name)}
                                            </span>
                                        ))}
                                    </div>
                                    <span style={{ fontSize: "10px", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {seg.membersList[0]?.name} {seg.membersList.length > 1 ? `+${seg.membersList.length - 1}` : ""}
                                    </span>
                                </>
                            ) : (
                                <span style={{ fontSize: "10px", color: MUTED }}>No members yet</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* CHARTS ROW (Revenue Trend AreaChart + Customer Segments Donut Chart) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-8">
                {/* Revenue Trend AreaChart (7 cols) */}
                <div className="lg:col-span-7" style={{ background: CARD_BG, borderRadius: "20px", padding: "20px", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                        <div>
                            <h3 style={{ fontSize: "15px", fontWeight: 800, color: INK, margin: 0 }}>Revenue Trend</h3>
                            <p style={{ fontSize: "11px", color: MUTED, margin: "2px 0 0" }}>Daily sales vs target velocity</p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "11px", color: MUTED, fontWeight: 600 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: TEAL }} /> Revenue
                            </span>
                            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: TERRACOTTA }} /> Target
                            </span>
                        </div>
                    </div>

                    <ResponsiveContainer width="100%" height={230}>
                        <AreaChart data={m.revenueSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="pelagoRev" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={TEAL} stopOpacity={0.25} />
                                    <stop offset="95%" stopColor={TEAL} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#EAE5DC" vertical={false} />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: MUTED, fontFamily: FONT }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: MUTED, fontFamily: FONT }} tickFormatter={(v) => formatCompactINR(v)} tickLine={false} axisLine={false} width={45} />
                            <Tooltip
                                formatter={(v) => [formatINR(v), "Revenue"]}
                                contentStyle={{ background: "#172220", borderRadius: "10px", border: "none", color: "#FFF", fontSize: "12px", fontFamily: FONT }}
                            />
                            <Area type="monotone" dataKey="revenue" stroke={TEAL} strokeWidth={2.5} fill="url(#pelagoRev)" />
                            <Area type="monotone" dataKey="target" stroke={TERRACOTTA} strokeWidth={1.8} strokeDasharray="4 3" fill="none" />
                        </AreaChart>
                    </ResponsiveContainer>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginTop: "16px", paddingTop: "14px", borderTop: `1px solid ${BORDER}` }}>
                        <div style={{ textAlign: "center" }}>
                            <p style={{ fontSize: "11px", color: MUTED, margin: 0 }}>Daily Average</p>
                            <p style={{ fontSize: "15px", fontWeight: 800, color: INK, margin: "2px 0 0" }}>{formatINR(Math.round(m.dailyAverage))}</p>
                        </div>
                        <div style={{ textAlign: "center" }}>
                            <p style={{ fontSize: "11px", color: MUTED, margin: 0 }}>Peak Growth</p>
                            <p style={{ fontSize: "15px", fontWeight: 800, color: GREEN, margin: "2px 0 0" }}>+{Math.round(m.peakGrowth)}%</p>
                        </div>
                        <div style={{ textAlign: "center" }}>
                            <p style={{ fontSize: "11px", color: MUTED, margin: 0 }}>Velocity</p>
                            <p style={{ fontSize: "15px", fontWeight: 800, color: INK, margin: "2px 0 0" }}>{m.currentVelocity.toFixed(1)} ord/hr</p>
                        </div>
                    </div>
                </div>

                {/* Customer Segments Donut Chart (5 cols) */}
                <div className="lg:col-span-5" style={{ background: CARD_BG, borderRadius: "20px", padding: "20px", border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.02)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                            <div style={{ width: "24px", height: "24px", borderRadius: "6px", background: TEAL_LIGHT, color: TEAL, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Users size={14} />
                            </div>
                            <h3 style={{ fontSize: "15px", fontWeight: 800, color: INK, margin: 0 }}>Customer Breakdown</h3>
                        </div>

                        <div style={{ position: "relative", height: "180px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <ResponsiveContainer width="100%" height={180}>
                                <PieChart>
                                    <Pie data={m.segments} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={78} paddingAngle={3} stroke="none">
                                        {m.segments.map((_, i) => <Cell key={i} fill={SEGMENT_COLORS[i % SEGMENT_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ background: "#172220", borderRadius: "8px", border: "none", color: "#FFF", fontSize: "12px", fontFamily: FONT }} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{ position: "absolute", textAlign: "center", pointerEvents: "none" }}>
                                <div style={{ fontSize: "20px", fontWeight: 800, color: INK, lineHeight: 1 }}>{formatCount(m.totalUsers)}</div>
                                <div style={{ fontSize: "10px", color: MUTED, marginTop: "2px" }}>Total Users</div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "12px", borderTop: `1px solid ${BORDER}` }}>
                        {m.segments.map((s, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
                                <span style={{ display: "flex", alignItems: "center", gap: "6px", color: MUTED, fontWeight: 500 }}>
                                    <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: SEGMENT_COLORS[i % SEGMENT_COLORS.length], flexShrink: 0 }} />
                                    {s.name}
                                </span>
                                <span style={{ fontWeight: 700, color: INK }}>{segTotal ? Math.round((s.value / segTotal) * 100) : 0}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* FILTER & SEARCH TOOLBAR */}
            <div style={{ background: CARD_BG, borderRadius: "16px", padding: "14px 18px", border: `1px solid ${BORDER}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                {/* Search */}
                <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
                    <Search size={14} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: MUTED }} />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by customer name or email..."
                        style={{
                            width: "100%",
                            height: "38px",
                            paddingLeft: "34px",
                            paddingRight: "12px",
                            borderRadius: "10px",
                            border: `1px solid ${BORDER}`,
                            background: "#FAF9F7",
                            fontFamily: FONT,
                            fontSize: "12px",
                            color: INK,
                            outline: "none",
                        }}
                    />
                </div>

                {/* Revenue filter */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                    <span style={{ color: MUTED, fontWeight: 600 }}>Spend (₹):</span>
                    <input
                        value={minRev}
                        onChange={(e) => setMinRev(e.target.value)}
                        type="number"
                        placeholder="Min"
                        style={{ width: "70px", height: "36px", padding: "0 8px", borderRadius: "8px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "12px", outline: "none", fontFamily: FONT }}
                    />
                    <span style={{ color: MUTED }}>-</span>
                    <input
                        value={maxRev}
                        onChange={(e) => setMaxRev(e.target.value)}
                        type="number"
                        placeholder="Max"
                        style={{ width: "70px", height: "36px", padding: "0 8px", borderRadius: "8px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "12px", outline: "none", fontFamily: FONT }}
                    />
                </div>

                {/* Sort */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                    <span style={{ color: MUTED, fontWeight: 600 }}>Sort:</span>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        style={{ height: "36px", padding: "0 10px", borderRadius: "8px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "12px", fontWeight: 600, color: INK, outline: "none", fontFamily: FONT }}
                    >
                        <option value="highest">Highest Spend</option>
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                    </select>
                </div>
            </div>

            {/* TOP SPENDING CUSTOMERS TABLE */}
            <div style={{ marginBottom: "28px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <div>
                        <h2 style={{ fontSize: "16px", fontWeight: 800, color: INK, margin: 0 }}>Top Spending Customers</h2>
                        <p style={{ fontSize: "11px", color: MUTED, margin: "2px 0 0" }}>Highest revenue accounts and purchase frequency</p>
                    </div>
                </div>

                <div style={{ background: CARD_BG, borderRadius: "18px", border: `1px solid ${BORDER}`, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12px" }}>
                            <thead>
                                <tr style={{ background: "#FAF8F5", borderBottom: `1.5px solid ${BORDER}` }}>
                                    {["RANK", "CUSTOMER", "EMAIL", "ORDERS", "TOTAL SPEND", "AOV", "LAST ORDER"].map((h) => (
                                        <th key={h} style={{ padding: "12px 16px", fontSize: "10px", fontWeight: 700, color: MUTED, letterSpacing: "0.05em" }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {topSpendingPageItems.map((u, i) => {
                                    const rank = (topSpendingSafePage - 1) * PAGE_SIZE + i + 1
                                    const badge = rankBadgeStyle(rank)
                                    return (
                                        <tr key={u.userId} style={{ borderBottom: `1px solid ${BORDER}`, transition: "background 0.1s" }} onMouseEnter={(e) => e.currentTarget.style.background = "#FAF8F5"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                                            <td style={{ padding: "12px 16px" }}>
                                                {badge ? (
                                                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", borderRadius: "50%", fontSize: "11px", fontWeight: 800, ...badge }}>
                                                        {rank}
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: "12px", fontWeight: 700, color: MUTED, marginLeft: "6px" }}>{rank}</span>
                                                )}
                                            </td>
                                            <td style={{ padding: "12px 16px", fontWeight: 700, color: INK }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                    <span style={{ width: "30px", height: "30px", borderRadius: "50%", background: avatarColor(u.name), color: "#FFF", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 800 }}>
                                                        {initials(u.name)}
                                                    </span>
                                                    <span>{u.name}</span>
                                                </div>
                                            </td>
                                            <td style={{ padding: "12px 16px", fontFamily: MONO, fontSize: "11px", color: MUTED }}>{u.email}</td>
                                            <td style={{ padding: "12px 16px", fontWeight: 600, color: INK }}>{u.orderCount}</td>
                                            <td style={{ padding: "12px 16px", fontWeight: 800, color: INK }}>{formatINR(u.total)}</td>
                                            <td style={{ padding: "12px 16px", fontWeight: 600, color: MUTED }}>{formatINR(Math.round(u.aov))}</td>
                                            <td style={{ padding: "12px 16px", color: MUTED, fontSize: "11px" }}>{relativeTime(u.lastOrderDate)}</td>
                                        </tr>
                                    )
                                })}
                                {m.displayed.length === 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ padding: "32px", textAlign: "center", color: MUTED }}>
                                            No customers match the current filter.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {m.displayed.length > 0 && (
                    <div style={{ marginTop: "12px" }}>
                        <Pagination
                            total={m.displayed.length}
                            page={topSpendingSafePage}
                            pageSize={PAGE_SIZE}
                            onPageChange={setTopSpendingPage}
                            itemLabel="customers"
                            accent={TEAL}
                        />
                    </div>
                )}
            </div>

            {/* DETAILED USER OVERVIEW (ACCORDION WITH TRANSACTION BREAKDOWN) */}
            <div>
                <div style={{ marginBottom: "12px" }}>
                    <h2 style={{ fontSize: "16px", fontWeight: 800, color: INK, margin: 0 }}>Customer Order History</h2>
                    <p style={{ fontSize: "11px", color: MUTED, margin: "2px 0 0" }}>Expand any customer row to inspect individual orders and receipts</p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {detailedOverviewPageItems.map((u) => {
                        const isExpanded = expanded[u.userId]
                        return (
                            <div key={u.userId} style={{ background: CARD_BG, borderRadius: "16px", border: `1px solid ${BORDER}`, padding: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "220px" }}>
                                        <span style={{ width: "40px", height: "40px", borderRadius: "50%", background: avatarColor(u.name), color: "#FFF", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 800, flexShrink: 0 }}>
                                            {initials(u.name)}
                                        </span>
                                        <div>
                                            <p style={{ margin: 0, fontWeight: 800, fontSize: "13px", color: INK }}>{u.name}</p>
                                            <p style={{ margin: "2px 0 0", fontFamily: MONO, fontSize: "11px", color: MUTED }}>{u.email}</p>
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                                        <div style={{ textAlign: "center", minWidth: "80px" }}>
                                            <span style={{ display: "block", fontSize: "10px", color: MUTED, textTransform: "uppercase", fontWeight: 700 }}>Joined</span>
                                            <span style={{ fontSize: "12px", fontWeight: 600, color: INK }}>
                                                {u.createdAt ? u.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                                            </span>
                                        </div>
                                        <div style={{ textAlign: "center", minWidth: "60px" }}>
                                            <span style={{ display: "block", fontSize: "10px", color: MUTED, textTransform: "uppercase", fontWeight: 700 }}>Orders</span>
                                            <span style={{ fontSize: "12px", fontWeight: 700, color: INK }}>{u.orderCount}</span>
                                        </div>
                                        <div style={{ textAlign: "center", minWidth: "90px" }}>
                                            <span style={{ display: "block", fontSize: "10px", color: MUTED, textTransform: "uppercase", fontWeight: 700 }}>Total Spend</span>
                                            <span style={{ fontSize: "13px", fontWeight: 800, color: TEAL }}>{formatINR(u.total)}</span>
                                        </div>
                                        <button
                                            onClick={() => toggleExpand(u.userId)}
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: "6px",
                                                padding: "6px 14px",
                                                borderRadius: "10px",
                                                background: TEAL_SUBTLE,
                                                color: TEAL,
                                                border: "none",
                                                fontSize: "12px",
                                                fontWeight: 700,
                                                cursor: "pointer",
                                            }}
                                        >
                                            Orders <ChevronDown size={14} style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" }} />
                                        </button>
                                    </div>
                                </div>

                                {/* Accordion orders list */}
                                {isExpanded && (
                                    <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: "6px" }}>
                                        {u.periodOrders.length === 0 ? (
                                            <p style={{ fontSize: "12px", color: MUTED, margin: "4px 0" }}>No orders placed during this period.</p>
                                        ) : (
                                            u.periodOrders.map((o) => (
                                                <div
                                                    key={o.id}
                                                    onClick={() => openOrder(u, o)}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        padding: "8px 12px",
                                                        borderRadius: "8px",
                                                        background: "#FAF8F5",
                                                        cursor: "pointer",
                                                        fontSize: "12px",
                                                        transition: "background 0.1s",
                                                    }}
                                                    onMouseEnter={(e) => e.currentTarget.style.background = "#F4EFEB"}
                                                    onMouseLeave={(e) => e.currentTarget.style.background = "#FAF8F5"}
                                                >
                                                    <span style={{ fontFamily: MONO, fontSize: "11px", color: TEAL, fontWeight: 700 }}>
                                                        #{o.externalOrderId ? String(o.externalOrderId).replace(/^#/, "") : o.id.slice(0, 8)}
                                                    </span>
                                                    <span style={{ fontWeight: 800, color: INK }}>{formatINR(o.total)}</span>
                                                    <span style={{ color: MUTED, fontSize: "11px" }}>
                                                        {o.date ? o.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                                                    </span>
                                                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "9999px", background: "#E8F3F1", color: TEAL, textTransform: "capitalize" }}>
                                                        {o.status}
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>

                {m.displayed.length > 0 && (
                    <div style={{ marginTop: "12px" }}>
                        <Pagination
                            total={m.displayed.length}
                            page={detailedOverviewSafePage}
                            pageSize={PAGE_SIZE}
                            onPageChange={setDetailedOverviewPage}
                            itemLabel="customers"
                            accent={TEAL}
                        />
                    </div>
                )}
            </div>

            {/* ORDER DETAIL DRAWER */}
            <RightDrawer open={!!selectedOrder} onClose={closeOrder} title="Order Detail">
                {displayedOrder && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontFamily: FONT }}>
                        <div style={{ background: "#FAF8F5", borderRadius: "14px", padding: "16px", border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div>
                                <p style={{ fontSize: "11px", color: MUTED, margin: 0 }}>Order Reference</p>
                                <p style={{ margin: "2px 0 0", fontFamily: MONO, fontSize: "14px", fontWeight: 800, color: INK }}>
                                    #{displayedOrder.externalOrderId ? String(displayedOrder.externalOrderId).replace(/^#/, "") : displayedOrder.id}
                                </p>
                            </div>
                            <div style={{ textAlign: "right" }}>
                                <p style={{ fontSize: "11px", color: MUTED, margin: 0 }}>Order Total</p>
                                <p style={{ margin: "2px 0 0", fontSize: "18px", fontWeight: 800, color: TEAL }}>{formatINR(displayedOrder.total)}</p>
                            </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
                            <span style={{ fontSize: "12px", color: MUTED }}>Status</span>
                            <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", padding: "3px 10px", borderRadius: "9999px", background: TEAL_SUBTLE, color: TEAL }}>
                                {displayedOrder.status}
                            </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
                            <span style={{ fontSize: "12px", color: MUTED }}>Order Date</span>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: INK }}>
                                {displayedOrder.date ? displayedOrder.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                            </span>
                        </div>

                        <div>
                            <h4 style={{ fontSize: "13px", fontWeight: 700, color: INK, margin: "0 0 8px" }}>Customer Information</h4>
                            <div style={{ background: "#FAF8F5", borderRadius: "12px", padding: "12px", border: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: "4px" }}>
                                <span style={{ fontWeight: 700, fontSize: "13px", color: INK }}>{displayedOrder.customerName || displayedOrder.userName || "Guest User"}</span>
                                <span style={{ fontFamily: MONO, fontSize: "11px", color: MUTED }}>{displayedOrder.customerEmail || displayedOrder.userEmail || "—"}</span>
                                {displayedOrder.userPhone && <span style={{ fontSize: "11px", color: MUTED }}>{displayedOrder.userPhone}</span>}
                            </div>
                        </div>

                        <div>
                            <h4 style={{ fontSize: "13px", fontWeight: 700, color: INK, margin: "0 0 8px" }}>Payment & Shipping</h4>
                            <div style={{ background: "#FAF8F5", borderRadius: "12px", padding: "12px", border: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
                                <div>
                                    <span style={{ color: MUTED }}>Payment Method: </span>
                                    <span style={{ fontWeight: 700, color: INK }}>{displayedOrder.paymentMethod || "—"}</span>
                                </div>
                                <div>
                                    <span style={{ color: MUTED }}>Delivery Address: </span>
                                    <span style={{ fontWeight: 600, color: INK }}>{displayedOrder.address || "No address on file"}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </RightDrawer>
        </div>
    )
}

export default AllUsersOrdersAnalytics