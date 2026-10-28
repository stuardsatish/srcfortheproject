import { useEffect, useState, useMemo, useRef } from "react"
import { supabase } from "../../context/SupabaseConfig"
import { mapOrderRows } from "../../utils/supabaseOrders"
import { queryOrdersWithShipments } from "../../services/shipping"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import {
    LayoutDashboard, Package, BarChart3, Users, ShoppingCart,
    FileText, Search, SlidersHorizontal, ArrowUpDown, ChevronDown,
    Download, IndianRupee, ShoppingBag, Calculator, Boxes,
    Grid3x3, Star, TrendingUp, MoreVertical, Calendar, Cpu, Shirt, Sofa, Apple, ArrowRight,
    AlertTriangle, Layers, FileDown, CheckCircle2, XCircle, ChevronRight, ArrowUp, ArrowDown,
    Eye, Moon, Bell, Plus, Tag, Clock, CheckCircle,
} from "lucide-react"
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, AreaChart, Area,
} from "recharts"
import * as XLSX from "xlsx"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { toast } from "react-toastify"
import RightDrawer from "../../components/Common/RightDrawer"

/* ============================== PELAGO DESIGN TOKENS ============================== */
const FONT = "'Plus Jakarta Sans', 'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

const TEAL = "#104945"
const TEAL_DARK = "#0C3936"
const TEAL_LIGHT = "#DEEEE7"
const TEAL_SUBTLE = "#E6F3F1"
const BORDER = "#E2DBD0"
const CANVAS = "#EDE8E1"
const WHITE = "#FFFFFF"
const CARD_BG = "#FFFFFF"
const INK = "#171412"
const MUTED = "#78716C"
const MUTED_LIGHT = "#8C8478"
const GREEN = "#167448"
const RED = "#BE413B"
const AMBER = "#D99726"
const TERRACOTTA = "#BC5B3E"

/* ============================== HELPERS ============================== */
const toDate = (v) => {
    if (!v) return null
    if (v?.toDate) return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}
const formatINR = (n) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`
const formatNum = (n) => Number(n || 0).toLocaleString("en-IN")
const trendPct = (cur, prev) => {
    if (!prev) return { pct: cur > 0 ? 100 : 0, up: true, hasPrev: prev > 0 }
    const p = ((cur - prev) / prev) * 100
    return { pct: Math.abs(Math.round(p * 10) / 10), up: p >= 0, hasPrev: true }
}
const PERIOD_DAYS = { today: 1, week: 7, month: 30, quarter: 90, halfyear: 180, "": 36500 }
const FILTERS = [
    { key: "today", label: "Today" },
    { key: "week", label: "Last 7 Days" },
    { key: "month", label: "Last 30 Days" },
    { key: "quarter", label: "Last 90 Days" },
    { key: "halfyear", label: "Last 6 Months" },
    { key: "", label: "All Time" },
    { key: "custom", label: "Custom" },
]

const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const getPeriodLabel = (filter, customFrom, customTo) => {
    if (filter === "today") return "Today"
    if (filter === "week") return "Last 7 Days"
    if (filter === "month") return "Last 30 Days"
    if (filter === "quarter") return "Last 90 Days"
    if (filter === "halfyear") return "Last 6 Months"
    if (filter === "custom") {
        if (customFrom && customTo) {
            const f = new Date(customFrom)
            const t = new Date(customTo)
            return `${f.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${t.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
        }
        return "Custom Period"
    }
    return "All Time"
}

function generatePeriodBuckets(filter, startDate, endDate, now) {
    const buckets = []
    let matrixTitle = "Category Performance by Month"
    let matrixSubtitle = "12-Month Historical Matrix"

    if (filter === "today") {
        matrixTitle = "Category Performance by Hour"
        matrixSubtitle = "Today's Hourly Matrix"
        const labels = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"]
        const fullLabels = [
            "12 AM - 3 AM", "3 AM - 6 AM", "6 AM - 9 AM", "9 AM - 12 PM",
            "12 PM - 3 PM", "3 PM - 6 PM", "6 PM - 9 PM", "9 PM - 12 AM"
        ]
        const todayBase = new Date(startDate)
        const curHour = now.getHours()

        for (let i = 0; i < 8; i++) {
            const bStart = new Date(todayBase.getFullYear(), todayBase.getMonth(), todayBase.getDate(), i * 3, 0, 0, 0)
            const bEnd = new Date(todayBase.getFullYear(), todayBase.getMonth(), todayBase.getDate(), (i + 1) * 3 - 1, 59, 59, 999)
            const isCurrent = curHour >= i * 3 && curHour < (i + 1) * 3
            buckets.push({
                key: `today-${i * 3}`,
                m: labels[i],
                fullLabel: fullLabels[i],
                start: bStart,
                end: bEnd,
                online: 0,
                cod: 0,
                total: 0,
                active: isCurrent,
            })
        }
    } else if (filter === "week") {
        matrixTitle = "Category Performance by Day"
        matrixSubtitle = "7-Day Daily Matrix"
        for (let i = 6; i >= 0; i--) {
            const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 0, 0, 0, 0)
            const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 23, 59, 59, 999)
            const dayLabel = `${dayStart.getDate()} ${MONTH_SHORT_NAMES[dayStart.getMonth()]}`
            const fullLabel = dayStart.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
            buckets.push({
                key: `day-${dayStart.getFullYear()}-${dayStart.getMonth() + 1}-${dayStart.getDate()}`,
                m: dayLabel,
                fullLabel,
                start: dayStart,
                end: dayEnd,
                online: 0,
                cod: 0,
                total: 0,
                active: i === 0,
            })
        }
    } else if (filter === "month") {
        matrixTitle = "Category Performance (30 Days)"
        matrixSubtitle = "5-Day Interval Matrix"
        for (let i = 5; i >= 0; i--) {
            const bStart = new Date(now.getTime() - (i + 1) * 5 * 86400000)
            bStart.setHours(0, 0, 0, 0)
            const bEnd = new Date(now.getTime() - i * 5 * 86400000)
            if (i === 0) {
                bEnd.setTime(now.getTime())
            } else {
                bEnd.setHours(23, 59, 59, 999)
            }
            const m = `${bStart.getDate()}-${bEnd.getDate()} ${MONTH_SHORT_NAMES[bEnd.getMonth()]}`
            const fullLabel = `${bStart.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${bEnd.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
            buckets.push({
                key: `int-30-${i}`,
                m,
                fullLabel,
                start: bStart,
                end: bEnd,
                online: 0,
                cod: 0,
                total: 0,
                active: i === 0,
            })
        }
    } else if (filter === "quarter") {
        matrixTitle = "Category Performance (90 Days)"
        matrixSubtitle = "3-Month Historical Matrix"
        for (let i = 2; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
            const mStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
            const mEnd = i === 0 ? now : new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
            const label = MONTH_SHORT_NAMES[d.getMonth()]
            const fullLabel = `${MONTH_SHORT_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`
            buckets.push({
                key: `month-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
                m: label,
                fullLabel,
                start: mStart,
                end: mEnd,
                online: 0,
                cod: 0,
                total: 0,
                active: i === 0,
            })
        }
    } else if (filter === "halfyear") {
        matrixTitle = "Category Performance (6 Months)"
        matrixSubtitle = "6-Month Historical Matrix"
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
            const mStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
            const mEnd = i === 0 ? now : new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
            const label = MONTH_SHORT_NAMES[d.getMonth()]
            const fullLabel = `${MONTH_SHORT_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`
            buckets.push({
                key: `month-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
                m: label,
                fullLabel,
                start: mStart,
                end: mEnd,
                online: 0,
                cod: 0,
                total: 0,
                active: i === 0,
            })
        }
    } else if (filter === "custom") {
        const diffDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000))
        matrixTitle = "Category Performance"
        matrixSubtitle = `Custom (${startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${endDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`

        if (diffDays <= 1) {
            const labels = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"]
            const fullLabels = [
                "12 AM - 3 AM", "3 AM - 6 AM", "6 AM - 9 AM", "9 AM - 12 PM",
                "12 PM - 3 PM", "3 PM - 6 PM", "6 PM - 9 PM", "9 PM - 12 AM"
            ]
            for (let i = 0; i < 8; i++) {
                const bStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), i * 3, 0, 0, 0)
                const bEnd = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), (i + 1) * 3 - 1, 59, 59, 999)
                buckets.push({
                    key: `custom-hour-${i}`,
                    m: labels[i],
                    fullLabel: fullLabels[i],
                    start: bStart,
                    end: bEnd,
                    online: 0,
                    cod: 0,
                    total: 0,
                    active: i === 7,
                })
            }
        } else if (diffDays <= 14) {
            for (let i = 0; i < diffDays; i++) {
                const dayStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i, 0, 0, 0, 0)
                const dayEnd = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i, 23, 59, 59, 999)
                const dayLabel = `${dayStart.getDate()} ${MONTH_SHORT_NAMES[dayStart.getMonth()]}`
                const fullLabel = dayStart.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                buckets.push({
                    key: `custom-day-${dayStart.getFullYear()}-${dayStart.getMonth() + 1}-${dayStart.getDate()}`,
                    m: dayLabel,
                    fullLabel,
                    start: dayStart,
                    end: dayEnd,
                    online: 0,
                    cod: 0,
                    total: 0,
                    active: i === diffDays - 1,
                })
            }
        } else if (diffDays <= 90) {
            const spanMs = (endDate.getTime() - startDate.getTime()) / 6
            for (let i = 0; i < 6; i++) {
                const bStart = new Date(startDate.getTime() + i * spanMs)
                const bEnd = new Date(startDate.getTime() + (i + 1) * spanMs)
                const m = `${bStart.getDate()} ${MONTH_SHORT_NAMES[bStart.getMonth()]}`
                const fullLabel = `${bStart.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${bEnd.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                buckets.push({
                    key: `custom-int-${i}`,
                    m,
                    fullLabel,
                    start: bStart,
                    end: bEnd,
                    online: 0,
                    cod: 0,
                    total: 0,
                    active: i === 5,
                })
            }
        } else {
            let cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
            let count = 0
            while (cur <= endDate && count < 12) {
                const mStart = new Date(cur.getFullYear(), cur.getMonth(), 1, 0, 0, 0, 0)
                const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999)
                const label = MONTH_SHORT_NAMES[cur.getMonth()]
                const fullLabel = `${MONTH_SHORT_NAMES[cur.getMonth()]} '${String(cur.getFullYear()).slice(-2)}`
                buckets.push({
                    key: `custom-m-${cur.getFullYear()}-${cur.getMonth() + 1}`,
                    m: label,
                    fullLabel,
                    start: mStart,
                    end: mEnd,
                    online: 0,
                    cod: 0,
                    total: 0,
                    active: false,
                })
                cur.setMonth(cur.getMonth() + 1)
                count++
            }
            if (buckets.length > 0) buckets[buckets.length - 1].active = true
        }
    } else {
        // filter === "" (All Time)
        matrixTitle = "Category Performance by Month"
        matrixSubtitle = "12-Month Historical Matrix"
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
            const mStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
            const mEnd = i === 0 ? now : new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
            const label = MONTH_SHORT_NAMES[d.getMonth()]
            const fullLabel = `${MONTH_SHORT_NAMES[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`
            buckets.push({
                key: `month-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
                m: label,
                fullLabel,
                start: mStart,
                end: mEnd,
                online: 0,
                cod: 0,
                total: 0,
                active: i === 0,
            })
        }
    }

    return { buckets, matrixTitle, matrixSubtitle }
}

const LOW_STOCK = 10
const stockStatus = (s) => (s <= 0 ? "out" : s <= LOW_STOCK ? "low" : "in")
const statusLabelOf = (s) => (stockStatus(s) === "out" ? "Out of Stock" : stockStatus(s) === "low" ? "Low Stock" : "In Stock")

const INVENTORY_COLUMNS = [
    { label: "PRODUCT", key: "product", align: "left" },
    { label: "CATEGORY", key: "category", align: "left" },
    { label: "STOCK", key: "stock", align: "right" },
    { label: "UNITS SOLD", key: "units", align: "right" },
    { label: "ORDERS", key: "orders", align: "right" },
    { label: "REVENUE", key: "revenue", align: "right" },
    { label: "STATUS", key: "status", align: "center" },
]

const productImage = (p) =>
    p.image || p.productImage || p.imageUrl || p.thumbnail || (Array.isArray(p.gallery) ? p.gallery[0] : "") || ""

const ProductThumb = ({ src, alt, size = 38, radius = 8 }) => {
    return src ? (
        <img src={src} alt={alt || ""} style={{ width: size, height: size, objectFit: "cover", borderRadius: radius, border: `1px solid ${BORDER}` }} />
    ) : (
        <span style={{ width: size, height: size, borderRadius: radius, background: "#FAF9F7", border: `1px solid ${BORDER}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: MUTED }}>
            <Package size={Math.max(14, Math.round(size * 0.45))} />
        </span>
    )
}

const AllProductsOrdersAnalytics = ({
    activeTab = "analytics",
    onSwitchTab,
    showHeader = true,
    onStatsChange,
    actionsRef,
    dateRange,
    customFrom: propCustomFrom = "",
    customTo: propCustomTo = "",
}) => {
    const [loading, setLoading] = useState(false)
    const [filter, setFilter] = useState("month")
    const [customFrom, setCustomFrom] = useState(propCustomFrom)
    const [customTo, setCustomTo] = useState(propCustomTo)

    useEffect(() => {
        if (propCustomFrom !== undefined && propCustomFrom !== null) setCustomFrom(propCustomFrom)
    }, [propCustomFrom])

    useEffect(() => {
        if (propCustomTo !== undefined && propCustomTo !== null) setCustomTo(propCustomTo)
    }, [propCustomTo])

    useEffect(() => {
        if (dateRange !== undefined && dateRange !== null) {
            const mapped =
                dateRange === "7d" ? "week" :
                dateRange === "30d" ? "month" :
                dateRange === "90d" ? "quarter" :
                dateRange === "6m" ? "halfyear" :
                dateRange === "all" ? "" :
                dateRange
            setFilter(mapped)
        }
    }, [dateRange])

    const [searchQuery, setSearchQuery] = useState("")
    const [sortBy, setSortBy] = useState("revenue")

    // Per-product analytics drawer
    const [selectedProductAnalytics, setSelectedProductAnalytics] = useState(null)
    const [displayedProductAnalytics, setDisplayedProductAnalytics] = useState(null)
    const openProductAnalytics = (p) => { setSelectedProductAnalytics(p); setDisplayedProductAnalytics(p) }
    const closeProductAnalytics = () => setSelectedProductAnalytics(null)

    // Analytics state
    const [revenue, setRevenue] = useState(0)
    const [orders, setOrders] = useState(0)
    const [customers, setCustomers] = useState(0)
    const [productsSold, setProductsSold] = useState(0)
    const [activeProducts, setActiveProducts] = useState(0)
    const [todayCount, setTodayCount] = useState(0)
    const [todayRev, setTodayRev] = useState(0)
    const [trends, setTrends] = useState({})
    const [chartData, setChartData] = useState([])
    const [allProducts, setAllProducts] = useState([])
    const [categoryData, setCategoryData] = useState([])
    const [insights, setInsights] = useState({})
    const [catalog, setCatalog] = useState([])

    // Detailed trend & spotlight metrics
    const [timelineBars, setTimelineBars] = useState([])
    const [topBuyer, setTopBuyer] = useState(null)
    const [channelBreakdown, setChannelBreakdown] = useState({ online: 0, cod: 0 })
    const [monthlyCatMatrix, setMonthlyCatMatrix] = useState({ months: [], rows: [] })
    const [categoryCollections, setCategoryCollections] = useState([])

    const rootRef = useRef(null)

    /* ============================== FETCH ============================== */
    const fetchDashboard = async () => {
        try {
            setLoading(true)
            const now = new Date()
            const days = PERIOD_DAYS[filter] ?? 30
            const customValid = filter === "custom" && customFrom && customTo && !isNaN(new Date(customFrom).getTime()) && !isNaN(new Date(customTo).getTime())
            let startDate, endDate, prevStart
            if (filter === "custom") {
                if (customValid) {
                    startDate = new Date(customFrom)
                    startDate.setHours(0, 0, 0, 0)
                    endDate = new Date(customTo)
                    endDate.setHours(23, 59, 59, 999)
                    const rangeDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000))
                    prevStart = new Date(startDate.getTime() - rangeDays * 86400000)
                } else {
                    startDate = new Date(0)
                    endDate = now
                    prevStart = new Date(0)
                }
            } else if (filter === "today") {
                startDate = new Date(now)
                startDate.setHours(0, 0, 0, 0)
                endDate = now
                prevStart = new Date(startDate.getTime() - 86400000)
            } else if (filter === "") {
                startDate = new Date(0)
                endDate = now
                prevStart = new Date(0)
            } else {
                startDate = new Date(now.getTime() - days * 86400000)
                endDate = now
                prevStart = new Date(now.getTime() - 2 * days * 86400000)
            }

            const todayStart = new Date()
            todayStart.setHours(0, 0, 0, 0)
            let curTodayCount = 0, curTodayRev = 0

            // 1. Fetch catalog
            let catalogById = {}
            try {
                const { data: catalogRows, error: catalogErr } = await supabase.from("products").select("*")
                if (catalogErr) throw catalogErr
                ;(catalogRows || []).forEach((x) => {
                    catalogById[x.id] = {
                        id: x.id,
                        title: x.title || "Product",
                        category: x.category || "General",
                        image: productImage(x),
                        price: Number(x.price || x.final_price || x.unit_price || 0),
                        rating: Number(x.rating) || 0,
                        stock: Number(x.stock ?? 0),
                    }
                })
            } catch (e) {
                console.error("catalog fetch", e)
            }

            // 2. Fetch orders via queryOrdersWithShipments & mapOrderRows
            const { data: rawOrdersData, error: ordersErr } = await queryOrdersWithShipments(
                (select) => supabase.from("orders").select(select).order("created_at", { ascending: false }),
                { admin: true }
            )
            if (ordersErr) console.error("ordersErr", ordersErr)
            const orderRows = mapOrderRows(rawOrdersData || [])

            const { buckets, matrixTitle, matrixSubtitle } = generatePeriodBuckets(filter, startDate, endDate, now)

            let totalRevenue = 0, totalOrders = 0, totalUnits = 0
            let prevRevenue = 0, prevOrders = 0, prevUnits = 0
            const dateMap = {}, productMap = {}, prevProductMap = {}, categoryMap = {}, prevCategoryMap = {}
            const activeIds = new Set()
            const userPeriod = {}
            const customerSpend = {}
            const curChannels = { online: 0, cod: 0 }
            const catBucketSales = {} // category -> { bucketKey -> number }

            // Process order rows
            orderRows.forEach((order) => {
                const d = toDate(order.createdAt)
                if (!d) return

                const orderTotal = Number(order.total || 0)
                const isCod = String(order.paymentMethod || "").toLowerCase().includes("cod")

                // Today badge counts
                if (d >= todayStart) {
                    curTodayCount++
                    curTodayRev += orderTotal
                }

                const inCur = d >= startDate && d <= endDate
                const inPrev = !inCur && d >= prevStart && d < startDate
                if (!inCur && !inPrev) return

                const uid = order.userId || order.userEmail || order.userName || "guest"
                if (!userPeriod[uid]) userPeriod[uid] = { cur: 0, prev: 0 }

                const items = order.products || []

                if (inCur) {
                    // Populate timeline bar bucket for current period
                    const b = buckets.find((bucket) => d >= bucket.start && d <= bucket.end)
                    if (b) {
                        if (isCod) b.cod += orderTotal
                        else b.online += orderTotal
                        b.total += orderTotal
                    }

                    userPeriod[uid].cur++
                    totalOrders++
                    totalRevenue += orderTotal

                    const dateKey = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                    if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, revenue: 0, orders: 0, _t: d.getTime() }
                    dateMap[dateKey].revenue += orderTotal
                    dateMap[dateKey].orders++

                    if (isCod) curChannels.cod += orderTotal
                    else curChannels.online += orderTotal

                    const cName = order.userName || order.userEmail || "Customer"
                    if (!customerSpend[uid]) customerSpend[uid] = { name: cName, spend: 0, orders: 0 }
                    customerSpend[uid].spend += orderTotal
                    customerSpend[uid].orders++
                } else {
                    userPeriod[uid].prev++
                    prevOrders++
                    prevRevenue += orderTotal
                }

                items.forEach((p) => {
                    const pid = p.productId || p.product_id || p.id || p.title || "unknown"
                    const catObj = catalogById[pid]
                    const title = p.title || p.productTitle || catObj?.title || "Product"
                    const qty = Number(p.quantity) || 1
                    const unitPrice = Number(p.finalPrice ?? p.unitPrice ?? p.price ?? catObj?.price ?? 0)
                    const lineRev = Number(p.lineTotal) > 0 ? Number(p.lineTotal) : (unitPrice * qty)
                    const category = catObj?.category || p.category || "General"

                    if (inCur) {
                        // Track category bucket sales for heatmap matrix
                        const b = buckets.find((bucket) => d >= bucket.start && d <= bucket.end)
                        if (b) {
                            if (!catBucketSales[category]) catBucketSales[category] = {}
                            catBucketSales[category][b.key] = (catBucketSales[category][b.key] || 0) + lineRev
                        }

                        totalUnits += qty
                        activeIds.add(pid)

                        if (!productMap[pid]) {
                            productMap[pid] = {
                                id: pid,
                                title,
                                revenue: 0,
                                orders: 0,
                                ordersCount: 0,
                                units: 0,
                                unitsSold: 0,
                                category,
                                image: catObj?.image || p.snapshotImage || "",
                                price: unitPrice || catObj?.price || 0,
                                rating: catObj?.rating || 0,
                                stock: catObj?.stock ?? 0,
                                recentOrders: [],
                            }
                        }
                        productMap[pid].revenue += lineRev
                        productMap[pid].orders++
                        productMap[pid].ordersCount++
                        productMap[pid].units += qty
                        productMap[pid].unitsSold += qty
                        if (!productMap[pid].image && (catObj?.image || p.snapshotImage)) {
                            productMap[pid].image = catObj?.image || p.snapshotImage
                        }
                        productMap[pid].recentOrders.push({
                            id: order.id,
                            date: d,
                            customerName: order.userName || "Customer",
                            customerEmail: order.userEmail || "",
                            quantity: qty,
                            lineRev,
                            status: order.orderStatus,
                            paymentMethod: order.paymentMethod,
                        })

                        if (!categoryMap[category]) {
                            categoryMap[category] = { name: category, revenue: 0, ordersSet: new Set(), products: new Set(), totalUnitsSold: 0 }
                        }
                        categoryMap[category].revenue += lineRev
                        categoryMap[category].ordersSet.add(order.id)
                        categoryMap[category].products.add(pid)
                        categoryMap[category].totalUnitsSold += qty
                    } else {
                        prevUnits += qty
                        if (!prevProductMap[pid]) prevProductMap[pid] = { revenue: 0, orders: 0 }
                        prevProductMap[pid].revenue += lineRev
                        prevProductMap[pid].orders++
                        if (!prevCategoryMap[category]) prevCategoryMap[category] = { revenue: 0 }
                        prevCategoryMap[category].revenue += lineRev
                    }
                })
            })

            let customersWithOrders = 0, prevCustomersWithOrders = 0
            Object.values(userPeriod).forEach((v) => {
                if (v.cur > 0) customersWithOrders++
                if (v.prev > 0) prevCustomersWithOrders++
            })

            const curChart = Object.values(dateMap).sort((a, b) => a._t - b._t)
            const chartArray = curChart.map((pt) => ({ ...pt, prevRevenue: 0 }))

            // Products array enriched with growth + catalog metadata
            const productsArray = Object.values(productMap).map((p) => {
                const prev = prevProductMap[p.id]?.revenue || 0
                const g = trendPct(p.revenue, prev)
                const cat = catalogById[p.id]
                return {
                    ...p,
                    unitsSold: p.units,
                    ordersCount: p.orders,
                    image: p.image || cat?.image || "",
                    category: p.category !== "Uncategorized" ? p.category : (cat?.category || p.category),
                    rating: p.rating || cat?.rating || 0,
                    price: p.price || cat?.price || 0,
                    stock: cat ? cat.stock : (p.stock ?? 0),
                    growth: (g.up ? 1 : -1) * g.pct,
                    growthHasPrev: g.hasPrev,
                }
            }).sort((a, b) => b.revenue - a.revenue)

            // Inventory list across full catalog
            const inventoryList = Object.values(catalogById).map((c) => {
                const pm = productMap[c.id]
                return {
                    ...c,
                    units: pm?.units || 0,
                    unitsSold: pm?.units || 0,
                    orders: pm?.orders || 0,
                    ordersCount: pm?.orders || 0,
                    revenue: pm?.revenue || 0,
                    recentOrders: pm?.recentOrders || [],
                }
            }).sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))

            // Categories list
            const catArray = Object.values(categoryMap).map((c) => {
                const prev = prevCategoryMap[c.name]?.revenue || 0
                const g = trendPct(c.revenue, prev)
                const catOrders = c.ordersSet.size
                return {
                    name: c.name,
                    revenue: c.revenue,
                    orders: catOrders,
                    products: c.products.size,
                    unitsSold: c.totalUnitsSold,
                    aov: catOrders ? c.revenue / catOrders : 0,
                    growth: (g.up ? 1 : -1) * g.pct,
                }
            }).sort((a, b) => b.revenue - a.revenue)

            // Insights
            const byOrders = [...productsArray].sort((a, b) => b.orders - a.orders)
            const byGrowth = [...productsArray].filter((p) => p.growthHasPrev).sort((a, b) => b.growth - a.growth)
            const worst = [...productsArray].sort((a, b) => a.revenue - b.revenue)[0]

            // Top Buyer
            const sortedBuyers = Object.values(customerSpend).sort((a, b) => b.spend - a.spend)
            const topSpender = sortedBuyers[0] || null

            // Timeline bars for selected period
            const maxBarTotal = Math.max(...buckets.map((b) => b.total), 1)
            const computedBars = buckets.map((b) => {
                const onlineRatio = b.total > 0 ? (b.online / b.total) : 1
                const codRatio = b.total > 0 ? (b.cod / b.total) : 0
                return {
                    ...b,
                    h: b.total > 0 ? Math.max(6, Math.round((b.total / maxBarTotal) * 44)) : 2,
                    onlineH: onlineRatio,
                    codH: codRatio,
                }
            })

            // Heatmap Matrix: categories across period buckets
            const catalogCategories = Array.from(new Set(Object.values(catalogById).map((c) => c.category || "General")))
            const matrixCategories = catArray.length > 0
                ? catArray.slice(0, 6).map((c) => c.name)
                : Object.keys(catBucketSales).length > 0
                ? Object.keys(catBucketSales).slice(0, 6)
                : catalogCategories.slice(0, 6)

            const matrixRows = matrixCategories.map((catName) => {
                const vals = buckets.map((b) => {
                    const r = catBucketSales[catName]?.[b.key] || 0
                    if (r <= 0) return "₹0"
                    if (r >= 1000) return `₹${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}k`
                    return `₹${Math.round(r)}`
                })
                const bgs = buckets.map((b) => {
                    const r = catBucketSales[catName]?.[b.key] || 0
                    if (r <= 0) return "#DED6C9"
                    return "#124B43"
                })
                return { name: catName, vals, bgs }
            })

            // Category collections (all categories in catalog)
            const catMapObj = {}
            inventoryList.forEach((p) => {
                const cName = p.category || "General"
                if (!catMapObj[cName]) catMapObj[cName] = { title: cName, total: 0, sold: 0, rev: 0, products: [] }
                catMapObj[cName].total++
                catMapObj[cName].sold += (p.unitsSold || 0)
                catMapObj[cName].rev += (p.revenue || 0)
                catMapObj[cName].products.push(p)
            })
            const catCollectionList = Object.values(catMapObj).map((col, idx) => ({
                title: col.title,
                total: col.total,
                sold: col.sold,
                rev: formatINR(col.rev),
                tag: idx === 0 ? "★ Popular" : undefined,
                border: idx === 0 ? "#0F3D39" : idx === 1 ? "#C25E30" : idx === 2 ? "#4A7C59" : idx === 3 ? "#7C8B99" : "#D97706",
                bg: idx === 0 ? "#2D5A54" : idx === 1 ? "#8A3D24" : idx === 2 ? "#5E7A4A" : idx === 3 ? "#9AA9B6" : "#D6C4A9",
                thumbnails: col.products.slice(0, 5).map((p) => p.image).filter(Boolean),
            }))

            setRevenue(totalRevenue)
            setOrders(totalOrders)
            setCustomers(customersWithOrders)
            setProductsSold(totalUnits)
            setActiveProducts(activeIds.size)
            setTodayCount(curTodayCount)
            setTodayRev(curTodayRev)
            setTrends({
                revenue: trendPct(totalRevenue, prevRevenue),
                orders: trendPct(totalOrders, prevOrders),
                customers: trendPct(customersWithOrders, prevCustomersWithOrders),
                productsSold: trendPct(totalUnits, prevUnits),
            })
            setChartData(chartArray)
            setAllProducts(productsArray)
            setCatalog(inventoryList)
            setCategoryData(catArray)
            setInsights({
                highest: productsArray[0] || null,
                mostOrdered: byOrders[0] || null,
                fastestGrowing: byGrowth[0] || byOrders[0] || null,
                lowest: worst || null,
            })
            setTimelineBars(computedBars)
            setTopBuyer(topSpender)
            setChannelBreakdown(curChannels)
            setMonthlyCatMatrix({
                title: matrixTitle,
                subtitle: matrixSubtitle,
                months: buckets.map((b) => b.m),
                rows: matrixRows,
            })
            setCategoryCollections(catCollectionList)

            if (typeof onStatsChange === "function") {
                onStatsChange({
                    revenue: totalRevenue,
                    orders: totalOrders,
                    customers: customersWithOrders,
                    aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
                    productsSold: totalUnits,
                    activeProducts: activeIds.size,
                    todayCount: curTodayCount,
                    todayRev: curTodayRev,
                })
            }
        } catch (err) {
            console.error("fetchDashboard error", err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchDashboard()
    }, [filter, customFrom, customTo])

    /* ============================== DERIVED ============================== */
    const aov = orders === 0 ? 0 : revenue / orders

    const displayedProducts = useMemo(() => {
        let list = allProducts.filter((p) => p.title.toLowerCase().includes(searchQuery.toLowerCase()))
        list = [...list].sort((a, b) => {
            if (sortBy === "orders") return b.orders - a.orders
            if (sortBy === "units") return b.units - a.units
            if (sortBy === "growth") return b.growth - a.growth
            return b.revenue - a.revenue
        })
        return list
    }, [allProducts, searchQuery, sortBy])

    const [invSort, setInvSort] = useState({ key: "stock", dir: "asc" })
    const toggleInvSort = (key) => {
        setInvSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))
    }

    const displayedInventory = useMemo(() => {
        const list = catalog.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
        const { key, dir } = invSort
        const mul = dir === "asc" ? 1 : -1
        list.sort((a, b) => {
            if (key === "product") return mul * String(a.title || "").localeCompare(String(b.title || ""))
            if (key === "category") return mul * String(a.category || "").localeCompare(String(b.category || ""))
            if (key === "units") return mul * ((a.unitsSold || 0) - (b.unitsSold || 0))
            if (key === "orders") return mul * ((a.ordersCount || 0) - (b.ordersCount || 0))
            if (key === "revenue") return mul * ((a.revenue || 0) - (b.revenue || 0))
            if (key === "status") return mul * statusLabelOf(a.stock).localeCompare(statusLabelOf(b.stock))
            return mul * ((a.stock ?? 0) - (b.stock ?? 0))
        })
        return list
    }, [catalog, searchQuery, invSort])

    const exportToExcel = () => {
        if (!displayedProducts.length && !displayedInventory.length) {
            toast.info("No product data to export for this period.")
            return
        }
        const periodStr = FILTERS.find((f) => f.key === filter)?.label || "Selected Period"
        const summary = [
            ["Products & Orders Analytics — Pelago Store"],
            ["Period", periodStr],
            ["Generated", new Date().toLocaleString("en-IN")],
            [],
            ["Total Revenue", revenue],
            ["Total Orders", orders],
            ["Total Customers", customers],
            ["Avg Order Value", Math.round(aov)],
            ["Units Sold", productsSold],
            ["Active Catalog SKUs", activeProducts],
        ]
        const productsRows = displayedProducts.map((p, i) => ({
            Rank: i + 1,
            Title: p.title,
            Category: p.category,
            Revenue: p.revenue,
            Orders: p.orders,
            UnitsSold: p.units,
            Price: p.price,
            Stock: p.stock ?? "—",
        }))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Overview")
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productsRows), "Products")
        XLSX.writeFile(wb, `Products_Analytics_${new Date().toISOString().slice(0, 10)}.xlsx`)
        toast.success("Exported products analytics to Excel.")
    }

    useEffect(() => {
        if (onStatsChange) {
            onStatsChange({
                revenue,
                orders,
                customers,
                aov,
                productsSold,
                activeProducts,
                todayCount,
                todayRev,
            })
        }
    }, [revenue, orders, customers, aov, productsSold, activeProducts, todayCount, todayRev, onStatsChange])

    useEffect(() => {
        if (actionsRef) {
            actionsRef.current = {
                exportExcel: exportToExcel,
            }
        }
    }, [actionsRef, exportToExcel])

    const KpiTrend = ({ t }) => {
        if (!t) return null
        return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "2px", fontSize: "11px", fontWeight: 700, color: t.up ? GREEN : RED }}>
                {t.up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                {t.pct}%
            </span>
        )
    }

    return (
        <div ref={rootRef} className="w-full flex flex-col font-sans text-[#171412]">
            {/* Header & Sub-nav rendered when standalone */}
            {showHeader && (
                <>
                    <header className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[#DED6C9] gap-4 mb-5">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold uppercase tracking-wider text-[#0F3D39] bg-[#E8F3F1] px-2.5 py-0.5 rounded-full">
                                    Catalog Analytics
                                </span>
                            </div>
                            <h1 className="text-2xl font-bold tracking-tight text-[#111817] mt-1">
                                Product Intelligence &amp; Orders
                            </h1>
                            <p className="text-xs text-[#78716A] mt-0.5">
                                Performance benchmarks, unit velocity, sales volume, and inventory health.
                            </p>
                        </div>
                    </header>

                    {/* KPI Strip */}
                    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
                        <div className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-[#78716A]">Revenue</span>
                                <KpiTrend t={trends.revenue} />
                            </div>
                            <div className="mt-2">
                                <span className="text-xl font-bold tracking-tight text-[#111817]">{formatINR(revenue)}</span>
                                <p className="text-[10px] text-[#A0988F] mt-0.5">Total Sales</p>
                            </div>
                        </div>

                        <div className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-[#78716A]">Orders</span>
                                <KpiTrend t={trends.orders} />
                            </div>
                            <div className="mt-2">
                                <span className="text-xl font-bold tracking-tight text-[#111817]">{formatNum(orders)}</span>
                                <p className="text-[10px] text-[#A0988F] mt-0.5">Volume</p>
                            </div>
                        </div>

                        <div className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-[#78716A]">Customers</span>
                                <KpiTrend t={trends.customers} />
                            </div>
                            <div className="mt-2">
                                <span className="text-xl font-bold tracking-tight text-[#111817]">{formatNum(customers)}</span>
                                <p className="text-[10px] text-[#A0988F] mt-0.5">Unique Buyers</p>
                            </div>
                        </div>

                        <div className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
                            <span className="text-[11px] font-medium text-[#78716A]">AOV</span>
                            <div className="mt-2">
                                <span className="text-xl font-bold tracking-tight text-[#111817]">{formatINR(aov)}</span>
                                <p className="text-[10px] text-[#A0988F] mt-0.5">Avg Order Value</p>
                            </div>
                        </div>

                        <div className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
                            <span className="text-[11px] font-medium text-[#78716A]">Products Sold</span>
                            <div className="mt-2">
                                <span className="text-xl font-bold tracking-tight text-[#111817]">{formatNum(productsSold)}</span>
                                <p className="text-[10px] text-[#A0988F] mt-0.5">Total Units</p>
                            </div>
                        </div>

                        <div className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
                            <span className="text-[11px] font-medium text-[#78716A]">Active Products</span>
                            <div className="mt-2">
                                <span className="text-xl font-bold tracking-tight text-[#111817]">{activeProducts}</span>
                                <p className="text-[10px] text-[#A0988F] mt-0.5">Catalog SKUs with Orders</p>
                            </div>
                        </div>
                    </section>

                    {/* Sub-nav tabs */}
                    <div className="border-b border-[#DED6C9] flex gap-6 text-xs font-semibold px-1 pt-1 mb-5">
                        <button
                            onClick={() => onSwitchTab?.("catalog")}
                            className="pb-2.5 text-[#78716A] hover:text-[#111817] flex items-center gap-1.5 transition-colors cursor-pointer"
                            type="button"
                        >
                            <span>Catalog</span>
                            <span className="text-[10px] bg-[#E2DBD1] text-[#524C46] px-1.5 py-0.2 rounded-full">{catalog.length}</span>
                        </button>
                        <button
                            className="pb-2.5 text-[#0F3D39] border-b-2 border-[#0F3D39] flex items-center gap-1.5 font-bold"
                            type="button"
                        >
                            <span>Analytics</span>
                            <span className="text-[10px] bg-[#0F3D39] text-[#8EE0D0] px-1.5 py-0.2 rounded-full">{allProducts.length}</span>
                        </button>
                    </div>
                </>
            )}

            {/* BEGIN: Revenue Trend Section */}
            <section className="bg-white border border-[#DED6C9] rounded-2xl p-5 shadow-sm space-y-4 mb-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-[#F0EBE3] gap-3">
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-[#0F3D39]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                        </svg>
                        <h3 className="text-xs font-bold text-[#111817] uppercase tracking-wide">Revenue Trend &amp; Monthly Performance</h3>
                    </div>
                    {/* Real Channel Legends */}
                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#78716A]">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#0F3D39]"></span> Prepaid / Online</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#D97706]"></span> Cash on Delivery</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm border-2 border-dashed border-[#0F3D39]"></span> Current Period</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                    {/* Left: Real Categories Mini List (3 cols) */}
                    <div className="lg:col-span-3 space-y-2.5 pr-2 border-r-0 lg:border-r border-[#F0EBE3]">
                        <div className="flex items-center justify-between p-2 rounded-xl bg-[#F6F3EE] border border-[#EBE4D8]">
                            <div className="flex items-center gap-2.5">
                                <span className="w-7 h-7 rounded-lg bg-white border border-[#DED6C9] flex items-center justify-center text-[#78716A]">
                                    <Layers size={14} />
                                </span>
                                <div>
                                    <p className="font-semibold text-xs text-[#111817]">All categories</p>
                                    <p className="text-[10px] text-[#78716A]">{formatINR(revenue)} · {orders} orders</p>
                                </div>
                            </div>
                            <span className="text-xs font-bold text-[#0F3D39]">100%</span>
                        </div>

                        {categoryData.slice(0, 6).map((c) => {
                            const share = revenue > 0 ? Math.round((c.revenue / revenue) * 100) : 0
                            return (
                                <div key={c.name} className="flex items-center justify-between p-2 rounded-xl hover:bg-[#FAF8F5] transition-colors">
                                    <div className="flex items-center gap-2.5">
                                        <span className="w-7 h-7 rounded-lg bg-[#F6F3EE] flex items-center justify-center text-xs font-bold text-[#0F3D39] capitalize">
                                            {c.name.slice(0, 2).toUpperCase()}
                                        </span>
                                        <div>
                                            <p className="font-semibold text-xs text-[#111817] capitalize">{c.name}</p>
                                            <p className="text-[10px] text-[#78716A]">{formatINR(c.revenue)} · {share}%</p>
                                        </div>
                                    </div>
                                    <div className="w-16 h-1.5 rounded-full bg-[#E5E0D8] overflow-hidden">
                                        <div className="h-full bg-[#0F3D39] rounded-full" style={{ width: `${Math.min(100, Math.max(5, share))}%` }} />
                                    </div>
                                </div>
                            )
                        })}

                        {categoryData.length === 0 && (
                            <p className="text-xs text-[#78716A] py-3 text-center">No category sales in this period.</p>
                        )}
                    </div>

                    {/* Center: 12-Month Dynamic Bar Chart (6 cols) */}
                    <div className="lg:col-span-6 flex flex-col justify-between pt-2 relative">
                        {/* Background Horizontal dashed grid lines */}
                        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-6 text-[10px] text-[#A0988F]">
                            <div className="border-b border-dashed border-[#E5E0D8] w-full flex justify-end pr-1">
                                <span>{formatINR(Math.max(...timelineBars.map((b) => b.total), 1000))}</span>
                            </div>
                            <div className="border-b border-dashed border-[#E5E0D8] w-full flex justify-end pr-1">
                                <span>{formatINR(Math.round(Math.max(...timelineBars.map((b) => b.total), 1000) / 2))}</span>
                            </div>
                            <div className="border-b border-dashed border-[#E5E0D8] w-full flex justify-end pr-1">
                                <span>₹0</span>
                            </div>
                        </div>

                        {/* Stacked Bars Container */}
                        <div className="h-64 flex items-end justify-between gap-1.5 z-10 px-2 pb-6">
                            {timelineBars.map((bar, idx) => (
                                <div key={idx} className="flex-1 flex flex-col items-center gap-1 relative group">
                                    {bar.active && (
                                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#111817] text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full shadow-md z-20 whitespace-nowrap">
                                            {formatINR(bar.total)}
                                        </span>
                                    )}
                                    <div
                                        title={`${bar.fullLabel}: ${formatINR(bar.total)} (Prepaid: ${formatINR(bar.online)}, COD: ${formatINR(bar.cod)})`}
                                        className={`w-full flex flex-col items-center gap-0.5 rounded-lg p-1 justify-end transition-all ${
                                            bar.active
                                                ? "border-2 border-dashed border-[#0F3D39] bg-[#0F3D39]/10"
                                                : "border border-dashed border-[#DED6C9] bg-white/40 hover:bg-[#F6F3EE]"
                                        }`}
                                        style={{ height: `${Math.max(28, bar.h * 4.5)}px` }}
                                    >
                                        {bar.total > 0 ? (
                                            <>
                                                <div className="w-full bg-[#0F3D39] rounded-sm" style={{ height: `${Math.max(4, Math.round(bar.h * 3.5 * bar.onlineH))}px` }} />
                                                {bar.codH > 0 && (
                                                    <div className="w-full bg-[#D97706] rounded-sm" style={{ height: `${Math.max(3, Math.round(bar.h * 3.5 * bar.codH))}px` }} />
                                                )}
                                            </>
                                        ) : (
                                            <div className="w-full bg-[#E5E0D8] rounded-sm" style={{ height: "4px" }} />
                                        )}
                                    </div>
                                    <span className={`text-[10px] mt-1 ${bar.active ? "font-bold text-[#0F3D39]" : "text-[#78716A]"}`}>
                                        {bar.m}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: Dynamic Spotlight Card for Selected Period (3 cols) */}
                    <div className="lg:col-span-3 bg-[#FAF8F5] border border-[#EBE4D8] rounded-xl p-4 flex flex-col justify-between">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[11px] font-bold text-[#111817]">Period Performance</p>
                                    <p className="text-[10px] text-[#78716A]">{getPeriodLabel(filter, customFrom, customTo)}</p>
                                </div>
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#166534] bg-[#DCFCE7] px-2 py-0.5 rounded-full">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#166534]"></span> live
                                </span>
                            </div>

                            <div>
                                <h4 className="text-2xl font-bold tracking-tight text-[#111817]">{formatINR(revenue)}</h4>
                                <div className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded ${
                                    trends.revenue?.up ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#FEE2E2] text-[#991B1B]"
                                }`}>
                                    {trends.revenue?.up ? "↑ +" : "↓ -"}{trends.revenue?.pct || 0}% vs prev period
                                </div>
                            </div>

                            {/* Breakdown by Payment Channel */}
                            <div className="space-y-1.5 pt-2 border-t border-[#EBE4D8] text-[11px]">
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1.5 text-[#524C46]">
                                        <span className="w-2 h-2 rounded-xs bg-[#0F3D39]"></span> Prepaid / Online
                                    </span>
                                    <span className="font-semibold text-[#111817]">{formatINR(channelBreakdown.online)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1.5 text-[#524C46]">
                                        <span className="w-2 h-2 rounded-xs bg-[#D97706]"></span> Cash on Delivery
                                    </span>
                                    <span className="font-semibold text-[#111817]">{formatINR(channelBreakdown.cod)}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-[#78716A] pt-1">
                                    <span>Total Units Sold:</span>
                                    <span className="font-bold text-[#111817]">{formatNum(productsSold)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Top Buyer & Best Seller Micro-Cards */}
                        <div className="space-y-2 pt-3 border-t border-[#EBE4D8] mt-3">
                            <div>
                                <span className="text-[9px] uppercase tracking-wider font-bold text-[#A0988F]">TOP BUYER</span>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="w-6 h-6 rounded bg-[#E5DFD5] text-[#524C46] font-bold text-[10px] flex items-center justify-center">
                                        {(topBuyer?.name || "AN").slice(0, 2).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-[11px] text-[#111817] leading-none truncate">
                                            {topBuyer?.name || "No buyers recorded"}
                                        </p>
                                        <p className="text-[9px] text-[#78716A]">
                                            {topBuyer ? `${formatINR(topBuyer.spend)} in period` : "—"}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <span className="text-[9px] uppercase tracking-wider font-bold text-[#A0988F]">BEST SELLER</span>
                                <div
                                    className="flex items-center gap-2 mt-1 cursor-pointer hover:opacity-80 transition-opacity"
                                    onClick={() => insights.highest && openProductAnalytics(insights.highest)}
                                >
                                    <div className="w-6 h-6 rounded bg-[#FAF8F5] border border-[#EBE4D8] flex items-center justify-center overflow-hidden flex-shrink-0">
                                        {insights.highest?.image ? (
                                            <img src={insights.highest.image} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <Package size={12} className="text-[#78716A]" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-[11px] text-[#111817] leading-none truncate">
                                            {insights.highest?.title || "No sales recorded"}
                                        </p>
                                        <p className="text-[9px] text-[#78716A]">
                                            {insights.highest ? `${insights.highest.category} · ${formatINR(insights.highest.price)}` : "—"}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* BEGIN: Top Products Table Section */}
            <section className="bg-white border border-[#DED6C9] rounded-2xl p-5 shadow-sm space-y-4 mb-5">
                <div className="flex items-center justify-between pb-2">
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-[#0F3D39]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                        </svg>
                        <h3 className="text-xs font-bold text-[#111817] uppercase tracking-wide">Top Products by Revenue</h3>
                    </div>
                    <span className="text-xs text-[#78716A]">{allProducts.length} products with sales</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-[#F0EBE3] text-[10px] text-[#78716A] font-semibold uppercase tracking-wider">
                                <th className="py-2 px-3 font-normal w-12">Rank</th>
                                <th className="py-2 px-3 font-normal">Product</th>
                                <th className="py-2 px-3 font-normal">Category</th>
                                <th className="py-2 px-3 font-normal">Revenue</th>
                                <th className="py-2 px-3 font-normal">Growth % | Orders</th>
                                <th className="py-2 px-3 font-normal text-right">Units</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F6F3EE] text-xs">
                            {allProducts.slice(0, 10).map((prod, idx) => (
                                <tr key={prod.id || idx} className="hover:bg-[#FAF8F5] transition-colors cursor-pointer" onClick={() => openProductAnalytics(prod)}>
                                    <td className="py-3 px-3 text-[#A0988F] font-medium">
                                        <span className="w-6 h-6 rounded-md bg-[#FAF8F5] border border-[#EBE4D8] text-[#111817] font-bold text-xs flex items-center justify-center">
                                            {idx + 1}
                                        </span>
                                    </td>
                                    <td className="py-3 px-3">
                                        <div className="flex items-center gap-2.5">
                                            <ProductThumb src={prod.image} alt={prod.title} size={32} radius={6} />
                                            <div>
                                                <p className="font-semibold text-[#111817] leading-snug">{prod.title}</p>
                                                <p className="text-[10px] text-[#78716A] font-mono">{prod.id}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-3 px-3">
                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#E8F3F1] text-[#0F3D39] capitalize">
                                            <span className="w-1.5 h-1.5 rounded-full bg-[#0F3D39]"></span>
                                            {prod.category || "General"}
                                        </span>
                                    </td>
                                    <td className="py-3 px-3 font-semibold text-[#111817]">
                                        {formatINR(prod.revenue)}
                                    </td>
                                    <td className="py-3 px-3">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[11px] font-bold ${prod.growth >= 0 ? "text-[#166534]" : "text-[#B83E28]"}`}>
                                                {prod.growthHasPrev ? `${prod.growth >= 0 ? "+" : ""}${Math.round(prod.growth)}%` : "N/A"}
                                            </span>
                                            <span className="text-[11px] text-[#524C46]">
                                                · <strong className="font-bold text-[#111817]">{prod.orders}</strong> orders
                                            </span>
                                        </div>
                                    </td>
                                    <td className="py-3 px-3 text-right">
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E8F3F1] text-[#0F3D39]">
                                            {prod.units} items
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {allProducts.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="py-8 text-center text-xs text-[#78716A]">
                                        No product sales recorded for this period.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* BEGIN: Products Performance Section */}
            <section className="space-y-3 mb-5">
                <h3 className="text-sm font-bold text-[#111817]">Products Performance</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* HIGHEST REVENUE */}
                    <div
                        className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0F3D39] transition-colors"
                        onClick={() => insights.highest && openProductAnalytics(insights.highest)}
                    >
                        <div className="space-y-1">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-[#78716A] flex items-center gap-1">
                                <TrendingUp size={12} className="text-[#0F3D39]" />
                                HIGHEST REVENUE
                            </span>
                            <h4 className="font-bold text-xs text-[#111817] max-w-[150px] truncate" title={insights.highest?.title || "No data"}>
                                {insights.highest?.title || "No data"}
                            </h4>
                            <p className="text-[10px] text-[#78716A]">
                                {formatINR(insights.highest?.revenue || 0)} Total Revenue
                            </p>
                        </div>
                        <div className="w-11 h-11 rounded-lg bg-[#FAF8F5] border border-[#EBE4D8] flex-shrink-0 flex items-center justify-center overflow-hidden">
                            {insights.highest?.image ? (
                                <img src={insights.highest.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <Package size={20} className="text-[#78716A]" />
                            )}
                        </div>
                    </div>

                    {/* MOST ORDERED */}
                    <div
                        className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0F3D39] transition-colors"
                        onClick={() => insights.mostOrdered && openProductAnalytics(insights.mostOrdered)}
                    >
                        <div className="space-y-1">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-[#78716A] flex items-center gap-1">
                                <ShoppingBag size={12} className="text-[#0F3D39]" />
                                MOST ORDERED
                            </span>
                            <h4 className="font-bold text-xs text-[#111817] max-w-[150px] truncate" title={insights.mostOrdered?.title || "No data"}>
                                {insights.mostOrdered?.title || "No data"}
                            </h4>
                            <p className="text-[10px] text-[#78716A]">
                                {insights.mostOrdered?.orders || 0} Orders
                            </p>
                        </div>
                        <div className="w-11 h-11 rounded-lg bg-[#FAF8F5] border border-[#EBE4D8] flex-shrink-0 flex items-center justify-center overflow-hidden">
                            {insights.mostOrdered?.image ? (
                                <img src={insights.mostOrdered.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <Package size={20} className="text-[#78716A]" />
                            )}
                        </div>
                    </div>

                    {/* FASTEST GROWING */}
                    <div
                        className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0F3D39] transition-colors"
                        onClick={() => insights.fastestGrowing && openProductAnalytics(insights.fastestGrowing)}
                    >
                        <div className="space-y-1">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-[#78716A] flex items-center gap-1">
                                <TrendingUp size={12} className="text-[#0F3D39]" />
                                FASTEST GROWING
                            </span>
                            <h4 className="font-bold text-xs text-[#111817] max-w-[150px] truncate" title={insights.fastestGrowing?.title || "No data"}>
                                {insights.fastestGrowing?.title || "No data"}
                            </h4>
                            <p className="text-[10px] text-[#166534] font-semibold">
                                {insights.fastestGrowing?.growthHasPrev ? `${insights.fastestGrowing.growth >= 0 ? "+" : ""}${Math.round(insights.fastestGrowing.growth)}% Growth` : (insights.fastestGrowing ? "Active" : "No data")}
                            </p>
                        </div>
                        <div className="w-11 h-11 rounded-lg bg-[#FAF8F5] border border-[#EBE4D8] flex-shrink-0 flex items-center justify-center overflow-hidden">
                            {insights.fastestGrowing?.image ? (
                                <img src={insights.fastestGrowing.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <Package size={20} className="text-[#78716A]" />
                            )}
                        </div>
                    </div>

                    {/* LOWEST PERFORMING */}
                    <div
                        className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex items-center justify-between cursor-pointer hover:border-[#0F3D39] transition-colors"
                        onClick={() => insights.lowest && openProductAnalytics(insights.lowest)}
                    >
                        <div className="space-y-1">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-[#78716A] flex items-center gap-1">
                                <ArrowDown size={12} className="text-[#C25E30]" />
                                LOWEST PERFORMING
                            </span>
                            <h4 className="font-bold text-xs text-[#111817] max-w-[150px] truncate" title={insights.lowest?.title || "No data"}>
                                {insights.lowest?.title || "No data"}
                            </h4>
                            <p className="text-[10px] text-[#78716A]">
                                {formatINR(insights.lowest?.revenue || 0)} Total Revenue
                            </p>
                        </div>
                        <div className="w-11 h-11 rounded-lg bg-[#FAF8F5] border border-[#EBE4D8] flex-shrink-0 flex items-center justify-center overflow-hidden">
                            {insights.lowest?.image ? (
                                <img src={insights.lowest.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <Package size={20} className="text-[#78716A]" />
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {/* BEGIN: Category Performance Section */}
            <section className="space-y-3 mb-5">
                <h3 className="text-sm font-bold text-[#111817]">Category Performance</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {categoryData.length > 0 ? (
                        categoryData.slice(0, 4).map((c) => (
                            <div key={c.name} className="bg-white border border-[#DED6C9] rounded-xl p-3.5 shadow-2xs flex items-center justify-between">
                                <div className="space-y-1">
                                    <span className="text-[9px] text-[#78716A] flex items-center gap-1 font-medium">
                                        <Tag size={11} className="text-[#0F3D39]" />
                                        {formatINR(c.revenue)} Total Revenue
                                    </span>
                                    <h4 className="font-bold text-xs text-[#111817] capitalize">{c.name}</h4>
                                    <p className="text-[10px] text-[#78716A] leading-tight">
                                        <strong className="font-semibold text-[#111817]">{c.orders}</strong> Orders<br />
                                        <strong className="font-semibold text-[#111817]">{c.products}</strong> Products<br />
                                        <span className={`font-semibold ${c.growth >= 0 ? "text-[#166534]" : "text-[#B83E28]"}`}>
                                            {c.growth >= 0 ? "+" : ""}{Math.round(c.growth)}% Growth
                                        </span>
                                    </p>
                                </div>
                                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#2D5A54] to-[#12312D] flex-shrink-0 shadow-inner flex items-center justify-center text-white text-xs font-bold capitalize">
                                    {c.name.slice(0, 2).toUpperCase()}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="col-span-full p-6 text-center text-xs text-[#78716A] bg-white rounded-xl border border-[#DED6C9]">
                            No category data recorded for this period.
                        </div>
                    )}
                </div>
            </section>

            {/* BEGIN: Heatmap Matrix Section */}
            <section className="bg-white border border-[#DED6C9] rounded-2xl p-5 shadow-sm space-y-4 mb-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-[#0F3D39]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                        </svg>
                        <h3 className="text-xs font-bold text-[#111817] uppercase tracking-wide">
                            {monthlyCatMatrix.title || "Category Performance by Month"}
                        </h3>
                    </div>
                    <span className="text-[11px] text-[#78716A]">
                        {monthlyCatMatrix.subtitle || "12-Month Historical Matrix"}
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-separate border-spacing-y-2">
                        <thead>
                            <tr className="text-[10px] text-[#78716A] uppercase tracking-wider text-center">
                                <th className="w-24 text-left font-normal px-2">Category</th>
                                {(monthlyCatMatrix.months || []).map((m, idx) => (
                                    <th key={idx} className="font-normal px-1">{m}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(monthlyCatMatrix.rows || []).map((row, rIdx) => (
                                <tr key={rIdx}>
                                    <td className="font-semibold text-[#111817] capitalize py-1 px-2 whitespace-nowrap">
                                        <span>{row.name}</span>
                                    </td>
                                    {row.vals.map((v, cIdx) => (
                                        <td key={cIdx} className="px-1">
                                            <div
                                                className="text-white font-medium text-[10px] py-1.5 text-center rounded-lg shadow-2xs whitespace-nowrap"
                                                style={{ background: v === "₹0" ? "#DED6C9" : row.bgs[cIdx], color: v === "₹0" ? "#524C46" : "#FFFFFF" }}
                                            >
                                                {v}
                                            </div>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {(!monthlyCatMatrix.rows || monthlyCatMatrix.rows.length === 0) && (
                                <tr>
                                    <td colSpan={(monthlyCatMatrix.months?.length || 12) + 1} className="py-6 text-center text-xs text-[#78716A]">
                                        No category breakdown available for this period.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* BEGIN: Categories Collection Cards */}
            <section className="space-y-3 mb-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-[#111817]">Catalog Categories Breakdown</h3>
                        <p className="text-[11px] text-[#78716A]">Total SKUs with sold units and revenue for {getPeriodLabel(filter, customFrom, customTo)}</p>
                    </div>
                    <span className="text-xs text-[#78716A]">{categoryCollections.length} Categories</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {categoryCollections.map((col, idx) => (
                        <div
                            key={idx}
                            className="bg-white rounded-2xl p-4 shadow-sm flex flex-col justify-between"
                            style={{ border: `2px solid ${col.border}` }}
                        >
                            <div>
                                <div className="flex items-center gap-2.5">
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-xs" style={{ background: col.bg }}>
                                        {col.title.slice(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-xs text-[#111817] capitalize">{col.title}</h4>
                                        {col.tag && (
                                            <span className="inline-block bg-[#FEF3C7] text-[#92400E] text-[9px] font-bold px-1.5 py-0.2 rounded mt-0.5">
                                                {col.tag}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 text-center gap-1 mt-4 pt-3 border-t border-[#F0EBE3]">
                                    <div>
                                        <p className="text-[9px] uppercase tracking-wider text-[#A0988F]">TOTAL</p>
                                        <p className="font-bold text-xs text-[#111817]">{col.total}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] uppercase tracking-wider text-[#A0988F]">SOLD</p>
                                        <p className="font-bold text-xs text-[#111817]">{col.sold}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] uppercase tracking-wider text-[#A0988F]">REVENUE</p>
                                        <p className="font-bold text-xs text-[#111817]">{col.rev}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-[#F0EBE3]">
                                {col.thumbnails.length > 0 ? (
                                    col.thumbnails.map((src, iIdx) => (
                                        <img key={iIdx} src={src} alt="" className="w-6 h-6 rounded-md object-cover border border-[#DED6C9]" />
                                    ))
                                ) : (
                                    <span className="text-[10px] text-[#78716A]">No images</span>
                                )}
                            </div>
                        </div>
                    ))}
                    {categoryCollections.length === 0 && (
                        <div className="col-span-full p-6 text-center text-xs text-[#78716A] bg-white rounded-xl border border-[#DED6C9]">
                            No categories found in catalog.
                        </div>
                    )}
                </div>
            </section>

            {/* INVENTORY / STOCK LEVELS TABLE */}
            <div style={{ background: WHITE, borderRadius: "18px", border: `1px solid ${BORDER}`, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
                    <div>
                        <h3 style={{ fontSize: "15px", fontWeight: 800, color: INK, margin: 0 }}>Stock &amp; Sales Performance</h3>
                        <p style={{ fontSize: "11px", color: MUTED, margin: "2px 0 0" }}>Product-level sales metrics for {getPeriodLabel(filter, customFrom, customTo)}, remaining inventory, and unit velocity</p>
                    </div>

                    <div style={{ position: "relative", minWidth: "200px" }}>
                        <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: MUTED }} />
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Filter table..."
                            style={{ width: "100%", height: "34px", paddingLeft: "30px", paddingRight: "10px", borderRadius: "9999px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "12px", outline: "none", fontFamily: FONT }}
                        />
                    </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12px" }}>
                        <thead>
                            <tr style={{ background: "#FAF8F5", borderBottom: `1.5px solid ${BORDER}` }}>
                                {INVENTORY_COLUMNS.map((col) => (
                                    <th
                                        key={col.key}
                                        onClick={() => toggleInvSort(col.key)}
                                        style={{
                                            padding: "12px 16px",
                                            fontSize: "10px",
                                            fontWeight: 700,
                                            color: MUTED,
                                            letterSpacing: "0.05em",
                                            textAlign: col.align,
                                            cursor: "pointer",
                                        }}
                                    >
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                            {col.label}
                                            {invSort.key === col.key && (
                                                <span style={{ color: TEAL }}>{invSort.dir === "asc" ? "↑" : "↓"}</span>
                                            )}
                                        </span>
                                    </th>
                                ))}
                                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "10px", fontWeight: 700, color: MUTED }}>VIEW</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayedInventory.map((item) => {
                                const st = stockStatus(item.stock)
                                return (
                                    <tr key={item.id} style={{ borderBottom: `1px solid ${BORDER}`, transition: "background 0.1s" }} onMouseEnter={(e) => e.currentTarget.style.background = "#FAF8F5"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                                        <td style={{ padding: "12px 16px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                <ProductThumb src={item.image} alt={item.title} size={36} />
                                                <div>
                                                    <p style={{ margin: 0, fontWeight: 700, fontSize: "13px", color: INK }}>{item.title}</p>
                                                    <span style={{ fontFamily: MONO, fontSize: "10px", color: MUTED }}>SKU: {item.id}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: "12px 16px", textTransform: "capitalize", color: MUTED }}>{item.category}</td>
                                        <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: MONO, fontWeight: 700 }}>{item.stock}</td>
                                        <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: MONO, fontWeight: 600 }}>{item.unitsSold}</td>
                                        <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: MONO, fontWeight: 600 }}>{item.ordersCount}</td>
                                        <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: MONO, fontWeight: 800, color: TEAL }}>{formatINR(item.revenue)}</td>
                                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                                            <span style={{
                                                fontSize: "10px",
                                                fontWeight: 700,
                                                padding: "2px 8px",
                                                borderRadius: "9999px",
                                                background: st === "out" ? "#FEE2E2" : st === "low" ? "#FEF3C7" : TEAL_SUBTLE,
                                                color: st === "out" ? "#991B1B" : st === "low" ? "#92400E" : TEAL,
                                            }}>
                                                {statusLabelOf(item.stock)}
                                            </span>
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                                            <button
                                                onClick={() => openProductAnalytics(item)}
                                                style={{ padding: "4px 8px", borderRadius: "6px", border: `1px solid ${BORDER}`, background: WHITE, color: TEAL, cursor: "pointer", fontSize: "11px", fontWeight: 700 }}
                                            >
                                                Analytics
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                            {displayedInventory.length === 0 && (
                                <tr>
                                    <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: MUTED }}>
                                        No catalog products found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* PRODUCT ANALYTICS DRAWER */}
            <RightDrawer open={!!selectedProductAnalytics} onClose={closeProductAnalytics} title="Product Performance">
                {displayedProductAnalytics && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontFamily: FONT }}>
                        <div style={{ width: "100%", height: "180px", borderRadius: "14px", background: "#FAF8F5", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${BORDER}` }}>
                            {displayedProductAnalytics.image ? (
                                <img src={displayedProductAnalytics.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                                <Package size={44} style={{ color: MUTED }} />
                            )}
                        </div>

                        <div>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                {displayedProductAnalytics.category || "General"}
                            </span>
                            <h3 style={{ fontSize: "18px", fontWeight: 800, color: INK, margin: "2px 0 0" }}>
                                {displayedProductAnalytics.title}
                            </h3>
                            <span style={{ fontFamily: MONO, fontSize: "11px", color: MUTED }}>
                                ID: {displayedProductAnalytics.id}
                            </span>
                        </div>

                        {/* Price & Growth Card */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FAF8F5", border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "12px 16px" }}>
                            <div>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Price</span>
                                <p style={{ fontSize: "18px", fontWeight: 800, color: INK, margin: "2px 0 0" }}>
                                    {formatINR(displayedProductAnalytics.price)}
                                </p>
                            </div>
                            <div style={{ textAlign: "right" }}>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Growth</span>
                                <p style={{ fontSize: "18px", fontWeight: 800, color: (displayedProductAnalytics.growth ?? 0) >= 0 ? GREEN : RED, margin: "2px 0 0" }}>
                                    {displayedProductAnalytics.growthHasPrev ? `${displayedProductAnalytics.growth >= 0 ? "+" : ""}${Math.round(displayedProductAnalytics.growth)}%` : "N/A"}
                                </p>
                            </div>
                        </div>

                        {/* 4 KPIs Grid */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                            <div style={{ background: WHITE, borderRadius: "12px", padding: "12px", border: `1px solid ${BORDER}` }}>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Revenue</span>
                                <div style={{ fontSize: "18px", fontWeight: 800, color: TEAL }}>
                                    {formatINR(displayedProductAnalytics.revenue || 0)}
                                </div>
                            </div>
                            <div style={{ background: WHITE, borderRadius: "12px", padding: "12px", border: `1px solid ${BORDER}` }}>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Units Sold</span>
                                <div style={{ fontSize: "18px", fontWeight: 800, color: INK }}>
                                    {formatNum(displayedProductAnalytics.unitsSold ?? displayedProductAnalytics.units ?? 0)}
                                </div>
                            </div>
                            <div style={{ background: WHITE, borderRadius: "12px", padding: "12px", border: `1px solid ${BORDER}` }}>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Orders</span>
                                <div style={{ fontSize: "18px", fontWeight: 800, color: INK }}>
                                    {formatNum(displayedProductAnalytics.ordersCount ?? displayedProductAnalytics.orders ?? 0)}
                                </div>
                            </div>
                            <div style={{ background: WHITE, borderRadius: "12px", padding: "12px", border: `1px solid ${BORDER}` }}>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Stock Remaining</span>
                                <div style={{ fontSize: "18px", fontWeight: 800, color: (displayedProductAnalytics.stock ?? 0) <= 0 ? RED : INK }}>
                                    {displayedProductAnalytics.stock ?? 0}
                                </div>
                            </div>
                        </div>

                        {/* Recent Orders Itemized List */}
                        <div style={{ marginTop: "4px" }}>
                            <h4 style={{ fontSize: "13px", fontWeight: 700, color: INK, margin: "0 0 8px" }}>Recent Orders for this Product</h4>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "240px", overflowY: "auto" }}>
                                {(displayedProductAnalytics.recentOrders || []).length > 0 ? (
                                    displayedProductAnalytics.recentOrders.map((ord, oIdx) => (
                                        <div key={oIdx} style={{ background: "#FAF8F5", border: `1px solid ${BORDER}`, borderRadius: "10px", padding: "10px 12px", fontSize: "11px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <div>
                                                <p style={{ fontWeight: 700, color: INK, margin: 0 }}>{ord.customerName}</p>
                                                <span style={{ color: MUTED, fontSize: "10px" }}>
                                                    {ord.date ? new Date(ord.date).toLocaleDateString("en-IN") : ""} · {ord.quantity} unit(s)
                                                </span>
                                            </div>
                                            <div style={{ textAlign: "right" }}>
                                                <p style={{ fontWeight: 800, color: TEAL, margin: 0 }}>{formatINR(ord.lineRev)}</p>
                                                <span style={{ fontSize: "9px", textTransform: "uppercase", fontWeight: 700, color: MUTED }}>
                                                    {ord.status || ord.paymentMethod || "Completed"}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <p style={{ fontSize: "11px", color: MUTED, margin: 0, padding: "12px", textAlign: "center", background: "#FAF8F5", borderRadius: "10px", border: `1px solid ${BORDER}` }}>
                                        No order history for this product in the selected period.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </RightDrawer>
        </div>
    )
}

export default AllProductsOrdersAnalytics