import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { supabase } from "../../context/SupabaseConfig"
import { callFunction } from "../../utils/edgeFunctions"
import { toast } from "react-toastify"
import generateInvoice from "../../utils/generateInvoice"
import useIsMobile from "../../hooks/useIsMobile"
import { mapProductRows } from "../../utils/supabaseProducts"
import { defaultOption, hasAvailableOption, isAvailable, listPriceSummary, needsOptionChoice } from "../../features/products/purchaseOptions"
import {
  lineLabel, unitPriceOfOption, searchBillOptions, findOptionByCode, addOptionToBill,
  changeLineQty, setLineQty, removeLine, billPayloadItems, normalizeBillLine,
} from "../../features/pos/billOptions"
import { queryOrdersWithShipments } from "../../services/shipping"
import {
  Receipt, Search, Plus, Minus, Trash2, X, User, Phone, Mail, Loader2,
  CheckCircle2, AlertCircle, ShoppingBag, Banknote, CreditCard, Smartphone,
  MoreHorizontal, BadgeCheck, Clock, Package, Zap, ScanLine, PauseCircle,
  RotateCcw, Printer, Tag, ChevronDown, ChevronUp, Moon, Bell, Check,
} from "lucide-react"

/* ── Pelago Design Tokens ─────────────────────────────────────────── */
const FONT = "'Inter', 'Plus Jakarta Sans', sans-serif"
const MONO = "'Space Grotesk', 'JetBrains Mono', monospace"

const HELD_KEY = "billing_held_bills"

/* ── Helper Formatter ────────────────────────────────────────────── */
const formatINR = (n) =>
  `₹${Number(n || 0).toFixed(2)}`

const toDateSafe = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

const isToday = (d) => {
  if (!d) return false
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

const BillingPage = () => {
  const isMobile = useIsMobile(900)

  /* ── catalog + aggregates ── */
  const [products, setProducts] = useState([])
  const [topSellers, setTopSellers] = useState([])
  const [recentBills, setRecentBills] = useState([])
  const [today, setToday] = useState({ count: 0, revenue: 0 })

  /* ── bill state ── */
  const [billItems, setBillItems] = useState([])
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" })
  const [customerOpen, setCustomerOpen] = useState(true)
  const [custSearching, setCustSearching] = useState(false)

  /* ── search / scan ── */
  const [searchQuery, setSearchQuery] = useState("")
  const [showResults, setShowResults] = useState(false)
  const [skuInput, setSkuInput] = useState("")
  const [failedImages, setFailedImages] = useState({})
  const searchRef = useRef(null)

  /* ── pricing controls ── */
  const [manualDiscount, setManualDiscount] = useState("")
  const [manualDiscountType, setManualDiscountType] = useState("flat") // "flat" | "percent"
  const [promoInput, setPromoInput] = useState("")
  const [appliedPromo, setAppliedPromo] = useState(null)
  const [promoLoading, setPromoLoading] = useState(false)

  /* ── payment ── */
  const [paymentMethod, setPaymentMethod] = useState("Cash")
  const [paymentStatus, setPaymentStatus] = useState("paid")

  /* ── flow ── */
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  /* ── held bills ── */
  const [heldBills, setHeldBills] = useState([])
  const [heldOpen, setHeldOpen] = useState(false)
  const [recentBillsOpen, setRecentBillsOpen] = useState(true)

  /* ── load data ── */
  const loadCatalog = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("products").select("*")
      if (error) throw error
      setProducts(mapProductRows(data))
    } catch (e) {
      console.error("Failed to load products:", e)
    }
  }, [])

  const loadTopSellers = useCallback(async (catalog) => {
    try {
      const { data: stats } = await supabase
        .from("product_stats")
        .select("product_id, total_quantity")
        .order("total_quantity", { ascending: false })
        .limit(8)
      const byId = new Map(catalog.map((p) => [p.id, p]))
      const list = (stats || [])
        .map((s) => byId.get(s.product_id))
        .filter(Boolean)
        .filter((p) => hasAvailableOption(p))
        .slice(0, 6)

      // If fewer than 6, fill with products from catalog that have available options
      if (list.length < 6) {
        const existingIds = new Set(list.map((p) => p.id))
        for (const p of catalog) {
          if (list.length >= 6) break
          if (!existingIds.has(p.id) && hasAvailableOption(p)) {
            list.push(p)
            existingIds.add(p.id)
          }
        }
      }
      setTopSellers(list)
    } catch (e) {
      console.warn("Top sellers unavailable:", e)
      const list = catalog.filter((p) => hasAvailableOption(p)).slice(0, 6)
      setTopSellers(list)
    }
  }, [])

  const loadRecent = useCallback(async () => {
    try {
      let rows = []
      const { data, error } = await queryOrdersWithShipments(
        (selectStr) => supabase.from("orders").select(selectStr).order("created_at", { ascending: false }).limit(60),
        { admin: true }
      )
      if (!error && Array.isArray(data) && data.length > 0) {
        rows = data
      } else {
        const { data: directRows } = await supabase
          .from("orders")
          .select("id, total, created_at, customer_name, order_status, payment_method, source")
          .eq("source", "billing")
          .order("created_at", { ascending: false })
          .limit(60)
        rows = directRows || []
      }

      const billing = (rows || [])
        .filter((o) => o.source === "billing")
        .map((o) => ({
          id: o.id,
          total: Number(o.total || 0),
          createdAt: o.created_at || o.createdAt,
          userName: o.customer_name || o.userName || (o.user ? `${o.user.first_name || ""} ${o.user.last_name || ""}`.trim() : "") || "Walk-in Customer",
          orderStatus: o.order_status || o.orderStatus || "paid",
          paymentMethod: o.payment_method || o.paymentMethod || "Cash",
          source: o.source || "billing",
        }))

      setRecentBills(billing.slice(0, 15))
      const todays = billing.filter((o) => isToday(toDateSafe(o.createdAt)))
      setToday({
        count: todays.length,
        revenue: todays.reduce((s, o) => s + o.total, 0),
      })
    } catch (e) {
      console.warn("Recent bills unavailable:", e)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      let catalog = null
      try {
        const { data, error } = await supabase.from("products").select("*")
        if (error) throw error
        catalog = mapProductRows(data)
      } catch {
        /* handled */
      }
      if (catalog) {
        setProducts(catalog)
        loadTopSellers(catalog)
      }
      loadRecent()
    })()

    try {
      setHeldBills(JSON.parse(localStorage.getItem(HELD_KEY) || "[]"))
    } catch {
      setHeldBills([])
    }
  }, [loadTopSellers, loadRecent])

  /* ── derived totals ── */
  const subtotal = useMemo(
    () => billItems.reduce((s, it) => s + it.finalPrice * it.quantity, 0),
    [billItems]
  )
  const subtotalR = Math.round(subtotal * 100) / 100

  const promoDiscount = useMemo(
    () => Math.min(Number(appliedPromo?.discount || 0), subtotalR),
    [appliedPromo, subtotalR]
  )

  const manualDiscountAmount = useMemo(() => {
    const raw = Math.max(0, Number(manualDiscount) || 0)
    if (raw <= 0) return 0
    const amt =
      manualDiscountType === "percent"
        ? Math.round((subtotalR * Math.min(raw, 100)) / 100)
        : raw
    return Math.max(0, amt)
  }, [manualDiscount, manualDiscountType, subtotalR])

  const grandTotal = Math.max(0, Math.round(subtotalR - promoDiscount - manualDiscountAmount))
  const totalItems = billItems.reduce((s, it) => s + it.quantity, 0)

  /* ── search results ── */
  const searchResults = useMemo(() => searchBillOptions(products, searchQuery), [searchQuery, products])

  /* ── bill mutations ── */
  const addOption = useCallback((product, option) => {
    setBillItems((prev) => {
      const r = addOptionToBill(prev, product, option)
      if (r.error) toast.warn(r.error)
      return r.lines
    })
  }, [])

  const pickTopSeller = (p) => {
    if (needsOptionChoice(p)) {
      setSearchQuery(p.title || "")
      setShowResults(true)
      searchRef.current?.focus()
      toast.info("Pick the variant to add")
      return
    }
    addOption(p, defaultOption(p))
  }

  const changeQty = (lineKey, delta) => {
    setBillItems((prev) => {
      const r = changeLineQty(prev, lineKey, delta)
      if (r.error) toast.warn(r.error)
      return r.lines
    })
  }

  const removeItem = (lineKey) => {
    setBillItems((prev) => removeLine(prev, lineKey))
  }

  const resetBill = useCallback(() => {
    setBillItems([])
    setCustomer({ name: "", phone: "", email: "" })
    setManualDiscount("")
    setManualDiscountType("flat")
    setPromoInput("")
    setAppliedPromo(null)
    setPaymentMethod("Cash")
    setPaymentStatus("paid")
    setSearchQuery("")
    setSkuInput("")
    setResult(null)
  }, [])

  /* ── SKU entry ── */
  const handleSkuEnter = (e) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    const code = skuInput.trim()
    if (!code) return
    const hit = findOptionByCode(products, code)
    if (!hit) {
      toast.error(`No product with SKU "${code}"`)
      return
    }
    addOption(hit.product, hit.option)
    if (hit.option) setSkuInput("")
  }

  /* ── customer lookup ── */
  const searchCustomer = async () => {
    const phone = customer.phone.trim()
    const email = customer.email.trim()
    if (!phone && !email) {
      toast.info("Enter phone or email to search")
      return
    }
    setCustSearching(true)
    try {
      let profile = null
      if (phone) {
        const { data } = await supabase.from("profiles").select("name, phone, email").eq("phone", phone).limit(1).single()
        profile = data
      }
      if (!profile && email) {
        const { data } = await supabase.from("profiles").select("name, phone, email").eq("email", email).limit(1).single()
        profile = data
      }
      if (profile) {
        setCustomer({ name: profile.name || "", phone: profile.phone || phone, email: profile.email || email })
        toast.success(`Found: ${profile.name || "customer"}`)
      } else {
        toast.info("No matching customer found — will bill as walk-in")
      }
    } catch {
      toast.error("Customer lookup failed")
    } finally {
      setCustSearching(false)
    }
  }

  /* ── promo apply ── */
  const applyPromo = async () => {
    const code = promoInput.trim()
    if (!code) return
    if (subtotalR <= 0) {
      toast.info("Add items before applying promo")
      return
    }
    setPromoLoading(true)
    try {
      const { res, data } = await callFunction("promo-validate", { code, subtotal: subtotalR })
      if (res.ok && data.success) {
        setAppliedPromo({ code: data.code, discount: Number(data.discount || 0) })
        toast.success(`Promo ${data.code} applied — ₹${data.discount} off`)
      } else {
        setAppliedPromo(null)
        toast.error(data.error || "Invalid promo code")
      }
    } catch {
      toast.error("Could not validate promo")
    } finally {
      setPromoLoading(false)
    }
  }

  /* ── hold / recall bills ── */
  const persistHeld = (list) => {
    setHeldBills(list)
    try {
      localStorage.setItem(HELD_KEY, JSON.stringify(list))
    } catch {}
  }

  const holdBill = () => {
    if (!billItems.length) {
      toast.info("Nothing to hold")
      return
    }
    const entry = {
      id: `held_${Date.now()}`,
      customerName: customer.name || "Walk-in Customer",
      customerPhone: customer.phone || "",
      customerEmail: customer.email || "",
      billItems: [...billItems],
      total: grandTotal,
      itemCount: totalItems,
      heldAt: new Date().toISOString(),
    }
    const next = [entry, ...heldBills]
    persistHeld(next)
    resetBill()
    toast.success("Bill placed on hold")
  }

  const recallBill = (entry) => {
    setBillItems(entry.billItems || [])
    setCustomer({
      name: entry.customerName === "Walk-in Customer" ? "" : entry.customerName,
      phone: entry.customerPhone || "",
      email: entry.customerEmail || "",
    })
    persistHeld(heldBills.filter((h) => h.id !== entry.id))
    toast.success("Held bill recalled")
  }

  const deleteHeld = (id) => {
    persistHeld(heldBills.filter((h) => h.id !== id))
    toast.info("Held bill deleted")
  }

  /* ── print invoice ── */
  const printInvoice = useCallback((order) => {
    try {
      generateInvoice({
        id: order?.id || `ORD-${Date.now().toString().slice(-6)}`,
        orderId: order?.id || `ORD-${Date.now().toString().slice(-6)}`,
        userName: order?.userName || customer.name || "Walk-in Customer",
        userPhone: order?.userPhone || customer.phone || "—",
        userEmail: order?.userEmail || customer.email || "—",
        total: order?.total ?? grandTotal,
        paymentMethod: order?.paymentMethod || paymentMethod,
        paymentStatus: order?.paymentStatus || paymentStatus,
        createdAt: order?.createdAt || new Date(),
        products:
          order?.products ||
          billItems.map((it) => ({
            title: lineLabel(it),
            sku: it.sku || "—",
            price: it.finalPrice,
            quantity: it.quantity,
          })),
        address: "In-Store Billing Counter",
      })
    } catch (e) {
      console.error("Invoice PDF generation failed:", e)
      toast.error("Could not generate invoice PDF")
    }
  }, [customer, grandTotal, paymentMethod, paymentStatus, billItems])

  /* ── generate bill ── */
  const generateBill = useCallback(async () => {
    if (!billItems.length) {
      toast.info("Add items to the bill first")
      return
    }

    setLoading(true)
    setResult(null)
    try {
      // Try edge function if available, otherwise direct fallback
      let orderCreated = null
      try {
        const { res, data } = await callFunction("orders-billing-create", {
          items: billPayloadItems(billItems),
          customerName: customer.name.trim() || "Walk-in Customer",
          customerPhone: customer.phone.trim(),
          customerEmail: customer.email.trim(),
          paymentMethod,
          paymentStatus,
          promoCode: appliedPromo?.code || "",
          manualDiscount: Number(manualDiscount) || 0,
          manualDiscountType,
        })
        if (res.ok && data.success) {
          orderCreated = data.order || { id: data.orderId, total: grandTotal }
        }
      } catch {
        // Fallback directly to Supabase order insert
        const fallbackOrder = {
          customer_name: customer.name.trim() || "Walk-in Customer",
          customer_phone: customer.phone.trim(),
          customer_email: customer.email.trim(),
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          order_status: paymentStatus === "paid" ? "delivered" : "placed",
          source: "billing",
          total: grandTotal,
          subtotal: subtotalR,
          created_at: new Date().toISOString(),
        }
        const { data: inserted, error: insErr } = await supabase
          .from("orders")
          .insert([fallbackOrder])
          .select()
          .single()
        if (!insErr && inserted) {
          orderCreated = { ...inserted, userName: inserted.customer_name }
        }
      }

      const billId = orderCreated?.id || `BILL-${Date.now().toString().slice(-6)}`
      setResult({ success: true, orderId: billId, order: orderCreated })
      toast.success(`Bill #${billId} generated successfully!`)

      // Auto trigger invoice download
      printInvoice(orderCreated)

      // Clear bill
      setBillItems([])
      setCustomer({ name: "", phone: "", email: "" })
      setManualDiscount("")
      setPromoInput("")
      setAppliedPromo(null)
      loadRecent()
    } catch (err) {
      toast.error(`Bill generation failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [billItems, customer, paymentMethod, paymentStatus, appliedPromo, manualDiscount, manualDiscountType, subtotalR, grandTotal, printInvoice, loadRecent])

  return (
    <div
      style={{ fontFamily: FONT }}
      className="flex-1 w-full space-y-5 min-w-0 text-[#2D3748] pb-16 pr-4 sm:pr-6 md:pr-8 lg:pr-10 max-w-[1440px]"
    >
      {/* ── Top Bar: Header & Status Indicators ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Page Title & Icon */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#DCE8E0] flex items-center justify-center text-[#0F4C4C] shadow-xs shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              ></path>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Billing Counter</h2>
            <p className="text-xs text-gray-500 font-medium">
              Create bills for walk-in customers. Search products, add to bill, and generate an invoice.
            </p>
          </div>
        </div>

        {/* Top Right Indicators & Badges */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Active orders pill */}
          <div className="h-9 px-3.5 rounded-full bg-white border border-[#E5DFD5] flex items-center gap-2 shadow-2xs text-xs font-medium text-gray-700">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
            <span>{today.count} today</span>
            <span style={{ fontFamily: MONO }} className="text-gray-500 font-semibold">
              {formatINR(today.revenue)}
            </span>
          </div>

          {/* Dark mode toggle pill */}
          <button
            onClick={() => toast.info("Dark mode toggled.")}
            aria-label="Toggle dark mode"
            className="w-9 h-9 rounded-full bg-white border border-[#E5DFD5] flex items-center justify-center text-gray-500 hover:text-gray-800 shadow-2xs transition-colors cursor-pointer"
            type="button"
          >
            <Moon className="w-4 h-4" />
          </button>

          {/* Notification bell with badge */}
          <button
            onClick={() => toast.info("No unread billing alerts.")}
            aria-label="Notifications"
            className="w-9 h-9 rounded-full bg-white border border-[#E5DFD5] flex items-center justify-center text-gray-500 hover:text-gray-800 shadow-2xs transition-colors relative cursor-pointer"
            type="button"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
          </button>

          {/* Bill Today Counter Metric */}
          <div className="h-10 px-4 bg-white border border-[#E5DFD5] rounded-xl flex flex-col justify-center items-center shadow-2xs ml-1">
            <span style={{ fontFamily: MONO }} className="text-sm font-bold text-[#0F4C4C] leading-none">
              #{today.count + 1}
            </span>
            <span className="text-[9px] font-bold tracking-wider text-gray-400 uppercase mt-0.5">
              Bill Today
            </span>
          </div>

          {/* Today's Sales Metric */}
          <div className="h-10 px-4 bg-[#EAF6EF] border border-[#A7F3D0] rounded-xl flex flex-col justify-center items-center shadow-2xs">
            <span style={{ fontFamily: MONO }} className="text-sm font-bold text-[#1F7A4D] leading-none">
              {formatINR(today.revenue)}
            </span>
            <span className="text-[9px] font-bold tracking-wider text-[#1F7A4D] uppercase mt-0.5">
              Today's Sales
            </span>
          </div>
        </div>
      </div>

      {/* ── Main Columns Grid: 2 Columns (Billing Action & Order Summary) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* ═══════════ LEFT ACTION COLUMN (8 cols) ═══════════ */}
        <div className="lg:col-span-8 space-y-4">
          {/* 1. Search Products Card */}
          <div
            className="bg-white rounded-3xl p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[#E5DFD5] space-y-2.5"
            data-purpose="product-search-card"
          >
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-600 uppercase">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <span>Search Products</span>
            </div>

            {/* Universal text search */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search className="w-4 h-4 text-gray-400" />
              </div>
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setShowResults(true)
                }}
                onFocus={() => setShowResults(true)}
                className="w-full pl-10 pr-4 py-2.5 bg-[#F6F2EC] border border-[#E8E2D9] rounded-xl text-xs placeholder-gray-400 text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F4C4C]/20 focus:border-[#0F4C4C] transition-all"
                placeholder="Search by name, SKU, or category... (F2 or /)"
                type="text"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("")
                    setShowResults(false)
                  }}
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  type="button"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {/* Search dropdown results */}
              {showResults && searchResults.length > 0 && (
                <div className="absolute top-12 left-0 right-0 z-30 bg-white border border-[#E5DFD5] rounded-2xl shadow-xl max-h-72 overflow-y-auto p-2 space-y-1">
                  {searchResults.map(({ key, product: p, option }) => {
                    const { discount, finalPrice } = unitPriceOfOption(p, option)
                    const oos = !isAvailable(option)
                    const optionLabel =
                      option.kind === "variant"
                        ? ` — ${option.name}`
                        : option.kind === "main"
                        ? " (main product)"
                        : ""

                    return (
                      <button
                        key={key}
                        disabled={oos}
                        onClick={() => {
                          addOption(p, option)
                          setSearchQuery("")
                          setShowResults(false)
                          searchRef.current?.focus()
                        }}
                        className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-colors cursor-pointer ${
                          oos ? "opacity-50 cursor-not-allowed" : "hover:bg-[#FAF8F5]"
                        }`}
                        type="button"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-stone-100 flex items-center justify-center overflow-hidden shrink-0">
                            {option.image || p.thumbnail ? (
                              <img
                                src={option.image || p.thumbnail}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Package className="w-4 h-4 text-stone-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h5 className="text-xs font-semibold text-gray-900 truncate">
                              {p.title}
                              {optionLabel}
                            </h5>
                            <p style={{ fontFamily: MONO }} className="text-[10px] text-gray-400">
                              {option.sku || "—"} · {p.category || "General"}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span style={{ fontFamily: MONO }} className="text-xs font-bold text-[#0F4C4C]">
                            {formatINR(finalPrice)}
                          </span>
                          {discount > 0 && (
                            <span className="block text-[10px] text-emerald-600 font-semibold">
                              {discount}% off
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Barcode input */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <ScanLine className="w-4 h-4 text-gray-400" />
              </div>
              <input
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                onKeyDown={handleSkuEnter}
                style={{ fontFamily: MONO }}
                className="w-full pl-10 pr-4 py-2.5 bg-[#F6F2EC] border border-[#E8E2D9] rounded-xl text-xs placeholder-gray-400 text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F4C4C]/20 focus:border-[#0F4C4C] transition-all"
                placeholder="Scan barcode / enter SKU, then press Enter"
                type="text"
              />
            </div>
          </div>

          {/* 2. Quick Add - Top Sellers Card */}
          {topSellers.length > 0 && (
            <div
              className="bg-white rounded-3xl p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[#E5DFD5]"
              data-purpose="top-sellers-card"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-gray-700 uppercase mb-3">
                <span className="text-amber-500">⚡</span>
                <span>Quick Add — Top Sellers</span>
              </div>

              {/* 6 Items Grid (3 columns x 2 rows) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {topSellers.map((item) => {
                  const ls = listPriceSummary(item)
                  const price =
                    ls.price -
                    (ls.price *
                      Math.max(Number(item.discount || 0), Number(item.categoryDiscount || 0))) /
                      100

                  return (
                    <div
                      key={item.id}
                      onClick={() => pickTopSeller(item)}
                      className="p-2.5 bg-white border border-[#E8E2D9] rounded-2xl flex items-center justify-between hover:border-gray-300 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                          {item.thumbnail && !failedImages[item.id] ? (
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              className="w-full h-full object-cover"
                              onError={() =>
                                setFailedImages((prev) => ({ ...prev, [item.id]: true }))
                              }
                            />
                          ) : (
                            <Package className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-gray-900 leading-tight truncate">
                            {item.title}
                          </h4>
                          <p style={{ fontFamily: MONO }} className="text-xs font-medium text-gray-500">
                            {ls.prefix ? `${ls.prefix} ` : ""}{formatINR(price)}
                          </p>
                        </div>
                      </div>
                      <button
                        aria-label={`Add ${item.title}`}
                        className="w-6 h-6 rounded-lg border border-gray-200 flex items-center justify-center text-gray-400 group-hover:text-gray-700 group-hover:border-gray-400 transition-colors shrink-0"
                        type="button"
                      >
                        +
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 3. Current Bill Table Card */}
          <div
            className="bg-white rounded-3xl p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[#E5DFD5]"
            data-purpose="current-bill-card"
          >
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-700 uppercase mb-4">
              <ShoppingBag className="w-4 h-4 text-gray-500" />
              <span>Current Bill ({totalItems} {totalItems === 1 ? "Item" : "Items"})</span>
            </div>

            {/* Items Table */}
            {billItems.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No items in bill yet. Search products or click quick add above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-400 tracking-wider uppercase border-b border-[#F0EBE3]">
                      <th className="py-2.5 pl-1 w-6">#</th>
                      <th className="py-2.5">Product</th>
                      <th className="py-2.5 text-right">MRP</th>
                      <th className="py-2.5 text-center">Disc</th>
                      <th className="py-2.5 text-right">Price</th>
                      <th className="py-2.5 text-center w-28">Qty</th>
                      <th className="py-2.5 text-right">Total</th>
                      <th className="py-2.5 pr-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {billItems.map((item, idx) => (
                      <tr key={item.lineKey} className="group hover:bg-[#FAF8F5]/60 transition-colors">
                        <td style={{ fontFamily: MONO }} className="py-3 pl-1 text-gray-400">
                          {idx + 1}
                        </td>
                        <td className="py-3">
                          <div className="font-semibold text-gray-900 leading-none">
                            {lineLabel(item)}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-1">
                            {item.sku || "-"}
                          </div>
                        </td>
                        <td
                          style={{ fontFamily: MONO }}
                          className="py-3 text-right line-through text-gray-400"
                        >
                          {formatINR(item.mrp || item.finalPrice)}
                        </td>
                        <td className="py-3 text-center">
                          {item.discount > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200">
                              {item.discount}%
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td
                          style={{ fontFamily: MONO }}
                          className="py-3 text-right font-semibold text-gray-800"
                        >
                          {formatINR(item.finalPrice)}
                        </td>
                        <td className="py-3 text-center">
                          <div className="inline-flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => changeQty(item.lineKey, -1)}
                              aria-label="Decrease quantity"
                              className="w-5 h-5 rounded-md bg-[#F4EFEA] text-gray-600 flex items-center justify-center hover:bg-gray-200 text-xs cursor-pointer"
                              type="button"
                            >
                              -
                            </button>
                            <span
                              style={{ fontFamily: MONO }}
                              className="w-5 font-semibold text-gray-900 text-center"
                            >
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => changeQty(item.lineKey, 1)}
                              aria-label="Increase quantity"
                              className="w-5 h-5 rounded-md bg-[#F4EFEA] text-gray-600 flex items-center justify-center hover:bg-gray-200 text-xs cursor-pointer"
                              type="button"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td
                          style={{ fontFamily: MONO }}
                          className="py-3 text-right font-bold text-gray-900"
                        >
                          {formatINR(item.finalPrice * item.quantity)}
                        </td>
                        <td className="py-3 pr-1 text-right">
                          <button
                            onClick={() => removeItem(item.lineKey)}
                            aria-label="Remove item"
                            className="text-gray-300 hover:text-rose-500 transition-colors cursor-pointer"
                            type="button"
                          >
                            <Trash2 className="w-3.5 h-3.5 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Table Footer: Subtotal align right */}
            <div className="pt-4 mt-2 border-t border-[#F0EBE3] flex justify-end items-center gap-3">
              <span className="text-xs font-medium text-gray-500">Subtotal</span>
              <span style={{ fontFamily: MONO }} className="text-sm font-bold text-gray-900">
                {formatINR(subtotalR)}
              </span>
            </div>
          </div>

          {/* 4. Customer Details (Optional) Card */}
          <div
            className="bg-white rounded-3xl p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[#E5DFD5]"
            data-purpose="customer-details-card"
          >
            <div
              onClick={() => setCustomerOpen((o) => !o)}
              className="flex items-center justify-between cursor-pointer mb-3"
            >
              <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-700 uppercase">
                <User className="w-4 h-4 text-gray-500" />
                <span>Customer Details (Optional)</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform ${
                  customerOpen ? "rotate-180" : ""
                }`}
              />
            </div>

            {customerOpen && (
              <div className="space-y-2.5">
                {/* Name Input */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <User className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    value={customer.name}
                    onChange={(e) => setCustomer((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full pl-10 pr-4 py-2 bg-[#F6F2EC] border border-[#E8E2D9] rounded-xl text-xs placeholder-gray-400 text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F4C4C]/20 focus:border-[#0F4C4C] transition-all"
                    placeholder="Customer name"
                    type="text"
                  />
                </div>

                {/* Phone Input with Find button */}
                <div className="relative flex items-center">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Phone className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    value={customer.phone}
                    onChange={(e) => setCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full pl-10 pr-20 py-2 bg-[#F6F2EC] border border-[#E8E2D9] rounded-xl text-xs placeholder-gray-400 text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F4C4C]/20 focus:border-[#0F4C4C] transition-all"
                    placeholder="Phone"
                    type="tel"
                  />
                  <button
                    onClick={searchCustomer}
                    disabled={custSearching}
                    className="absolute right-2 px-2.5 py-1 bg-white border border-[#E0D9CE] rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
                    type="button"
                  >
                    {custSearching ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Search className="w-3 h-3 text-gray-500" />
                    )}
                    <span>Find</span>
                  </button>
                </div>

                {/* Email Input */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Mail className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    value={customer.email}
                    onChange={(e) => setCustomer((prev) => ({ ...prev, email: e.target.value }))}
                    className="w-full pl-10 pr-4 py-2 bg-[#F6F2EC] border border-[#E8E2D9] rounded-xl text-xs placeholder-gray-400 text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F4C4C]/20 focus:border-[#0F4C4C] transition-all"
                    placeholder="Email"
                    type="email"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-2 font-medium">
                  Leave blank to bill as a Walk-in Customer.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ═══════════ RIGHT SUMMARY COLUMN (4 cols) ═══════════ */}
        <div className="lg:col-span-4 space-y-4">
          {/* 1. Price Summary Card */}
          <div
            className="bg-white rounded-3xl p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[#E5DFD5] space-y-3.5"
            data-purpose="price-summary-card"
          >
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-700 uppercase">
              <Receipt className="w-4 h-4 text-gray-500" />
              <span>Price Summary</span>
            </div>

            {/* Subtotal Line */}
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-500 font-medium">Subtotal</span>
              <span style={{ fontFamily: MONO }} className="font-bold text-gray-900 text-sm">
                {formatINR(subtotalR)}
              </span>
            </div>

            {/* Additional Discount Toggle & Input */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 font-medium">Additional Discount</span>
                {/* Currency / Percentage Segmented Button */}
                <div className="flex items-center bg-[#F6F2EC] p-0.5 rounded-lg border border-[#E5DFD5]">
                  <button
                    onClick={() => setManualDiscountType("flat")}
                    className={`px-2 py-0.5 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                      manualDiscountType === "flat"
                        ? "bg-[#0F4C4C] text-white shadow-2xs"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                    type="button"
                  >
                    ₹
                  </button>
                  <button
                    onClick={() => setManualDiscountType("percent")}
                    className={`px-2 py-0.5 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                      manualDiscountType === "percent"
                        ? "bg-[#0F4C4C] text-white shadow-2xs"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                    type="button"
                  >
                    %
                  </button>
                </div>
              </div>
              <input
                type="number"
                min="0"
                value={manualDiscount}
                onChange={(e) => setManualDiscount(e.target.value)}
                className="w-full px-3 py-2 bg-[#F6F2EC] border border-[#E8E2D9] rounded-xl text-xs placeholder-gray-400 text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F4C4C]/20 focus:border-[#0F4C4C] transition-all"
                placeholder={manualDiscountType === "flat" ? "Discount amount (₹)" : "Discount percent (%)"}
              />
            </div>

            {/* Promo Code with Apply Button */}
            <div className="flex gap-2 pt-1">
              <input
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                className="flex-1 px-3 py-2 bg-[#F6F2EC] border border-[#E8E2D9] rounded-xl text-xs placeholder-gray-400 text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0F4C4C]/20 focus:border-[#0F4C4C] transition-all"
                placeholder="Promo code"
                type="text"
              />
              <button
                onClick={applyPromo}
                disabled={promoLoading || !promoInput.trim()}
                className="px-4 py-2 bg-[#F6F2EC] hover:bg-gray-200 border border-[#E8E2D9] text-gray-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                type="button"
              >
                {promoLoading ? "Applying..." : "Apply"}
              </button>
            </div>

            {/* Taxes and Shipping Lines */}
            <div className="space-y-1.5 pt-2 border-t border-[#F0EBE3] text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">GST (incl.)</span>
                <span style={{ fontFamily: MONO }} className="text-gray-600">
                  ₹0.00
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#059669] font-medium">Shipping</span>
                <span className="font-bold text-[#059669] tracking-wider text-[11px]">FREE</span>
              </div>
            </div>

            {/* Grand Total */}
            <div className="pt-3 border-t border-[#F0EBE3] flex justify-between items-baseline">
              <span className="text-xs font-bold text-gray-900">Grand Total</span>
              <span style={{ fontFamily: MONO }} className="text-2xl font-bold text-[#0F4C4C]">
                {formatINR(grandTotal)}
              </span>
            </div>
          </div>

          {/* 2. Payment Method & Action Card */}
          <div
            className="bg-white rounded-3xl p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[#E5DFD5] space-y-4"
            data-purpose="payment-action-card"
          >
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-700 uppercase">
              <CreditCard className="w-4 h-4 text-gray-500" />
              <span>Payment Method</span>
            </div>

            {/* 4 Payment Methods (2x2 Grid) */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "Cash", label: "Cash", Icon: Banknote },
                { key: "UPI", label: "UPI", Icon: Smartphone },
                { key: "Card", label: "Card", Icon: CreditCard },
                { key: "Other", label: "Other", Icon: MoreHorizontal },
              ].map(({ key, label: pLbl, Icon }) => {
                const isSelected = paymentMethod === key
                return (
                  <button
                    key={key}
                    onClick={() => setPaymentMethod(key)}
                    className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? "border-2 border-emerald-500 bg-white text-gray-900 shadow-2xs"
                        : "border border-[#E8E2D9] bg-white hover:bg-gray-50 text-gray-700"
                    }`}
                    type="button"
                  >
                    <Icon className={`w-4 h-4 ${isSelected ? "text-emerald-600" : "text-gray-400"}`} />
                    <span>{pLbl}</span>
                  </button>
                )
              })}
            </div>

            {/* Payment Status Segment */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] font-bold text-gray-400 tracking-wider uppercase">
                Payment Status
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPaymentStatus("paid")}
                  className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    paymentStatus === "paid"
                      ? "bg-emerald-50 border border-emerald-500 text-emerald-700 shadow-2xs"
                      : "bg-white border border-[#E8E2D9] text-gray-600 hover:bg-gray-50"
                  }`}
                  type="button"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Paid</span>
                </button>
                <button
                  onClick={() => setPaymentStatus("pending")}
                  className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs font-medium transition-all cursor-pointer ${
                    paymentStatus === "pending"
                      ? "bg-amber-50 border border-amber-500 text-amber-700 shadow-2xs font-semibold"
                      : "bg-white border border-[#E8E2D9] text-gray-600 hover:bg-gray-50"
                  }`}
                  type="button"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>Pending</span>
                </button>
              </div>
            </div>

            {/* Main Generate Bill CTA Button */}
            <button
              onClick={generateBill}
              disabled={loading || !billItems.length}
              className="w-full py-3.5 px-4 bg-[#104945] hover:bg-[#0D3B38] text-white rounded-2xl font-bold text-sm tracking-wide flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-[0.99] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Receipt className="w-4 h-4 text-emerald-200" />
                  <span>Generate Bill · {formatINR(grandTotal)}</span>
                </>
              )}
            </button>

            {/* Secondary Actions: Hold & Clear All */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={holdBill}
                disabled={!billItems.length}
                className="py-2.5 px-3 rounded-xl border border-[#E8E2D9] bg-white hover:bg-gray-50 text-gray-700 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                type="button"
              >
                <PauseCircle className="w-3.5 h-3.5 text-gray-500" />
                <span>Hold</span>
              </button>
              <button
                onClick={resetBill}
                disabled={!billItems.length && !result}
                className="py-2.5 px-3 rounded-xl border border-[#F2D7D7] bg-white hover:bg-rose-50 text-rose-600 flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                type="button"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-500" />
                <span>Clear All</span>
              </button>
            </div>
          </div>

          {/* 3. Held Bills Collapsible Card */}
          <div
            onClick={() => setHeldOpen((o) => !o)}
            className="bg-white rounded-2xl px-4 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[#E5DFD5] flex items-center justify-between cursor-pointer hover:border-gray-300 transition-colors"
            data-purpose="held-bills-card"
          >
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-600 uppercase">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              <span>Held Bills ({heldBills.length})</span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-gray-400 transition-transform ${heldOpen ? "rotate-180" : ""}`}
            />
          </div>

          {heldOpen && heldBills.length > 0 && (
            <div className="bg-white rounded-2xl p-3 border border-[#E5DFD5] space-y-2">
              {heldBills.map((h) => (
                <div
                  key={h.id}
                  className="p-2.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl flex items-center justify-between"
                >
                  <div>
                    <h5 className="text-xs font-semibold text-gray-900 leading-tight">
                      {h.customerName}
                    </h5>
                    <p style={{ fontFamily: MONO }} className="text-[11px] text-gray-500 mt-0.5">
                      {formatINR(h.total)} · {h.itemCount} items
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => recallBill(h)}
                      className="px-2.5 py-1 bg-[#104945] text-white rounded-lg text-xs font-semibold cursor-pointer"
                      type="button"
                    >
                      Recall
                    </button>
                    <button
                      onClick={() => deleteHeld(h.id)}
                      className="text-gray-400 hover:text-rose-500 p-1 cursor-pointer"
                      type="button"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 4. Recent Bills Card */}
          <div
            className="bg-white rounded-3xl p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[#E5DFD5] space-y-3"
            data-purpose="recent-bills-card"
          >
            <div
              onClick={() => setRecentBillsOpen((o) => !o)}
              className="flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-gray-700 uppercase">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                <span>Recent Bills</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform ${
                  recentBillsOpen ? "rotate-180" : ""
                }`}
              />
            </div>

            {recentBillsOpen && (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {recentBills.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-xs">
                    <Clock className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                    No recent bills recorded yet.
                  </div>
                ) : (
                  recentBills.map((bill) => (
                    <div
                      key={bill.id}
                      className="p-2.5 bg-[#FAF8F5] border border-[#EAE4DC] rounded-xl flex items-center justify-between hover:border-gray-300 transition-colors"
                    >
                      <div>
                        <h5 className="text-xs font-semibold text-gray-900 leading-tight">
                          {bill.userName || "Walk-in Customer"}
                        </h5>
                        <p style={{ fontFamily: MONO }} className="text-[11px] text-gray-500 mt-0.5">
                          {formatINR(bill.total)} · {bill.paymentMethod || "Cash"}
                        </p>
                      </div>
                      <button
                        onClick={() => printInvoice(bill)}
                        aria-label="Print receipt"
                        className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-white transition-colors cursor-pointer"
                        type="button"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default BillingPage