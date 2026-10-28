import React, { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "react-toastify"
import { supabase } from "../../context/SupabaseConfig"
import { mapProductRows } from "../../utils/supabaseProducts"
import {
  Clock,
  Check,
  Search,
  Heart,
  ShoppingCart,
  Ticket,
  Trash2,
  Moon,
  Bell,
  Plus,
  AlertCircle,
  Loader2,
} from "lucide-react"

/* ── Pelago Typography Tokens ────────────────────────────────────────── */
const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const DISPLAY = "'Space Grotesk', 'Plus Jakarta Sans', sans-serif"

const toDateSafe = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

const isToday = (d) => {
  if (!d) return false
  const n = new Date()
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  )
}

const AddDiscountPage = () => {
  const navigate = useNavigate()

  // Core Data State
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [wishlistCounts, setWishlistCounts] = useState({})
  const [cartCounts, setCartCounts] = useState({})

  // Promo Codes State
  const [promoCodes, setPromoCodes] = useState([])
  const [newPromoCode, setNewPromoCode] = useState("")
  const [newPromoDiscount, setNewPromoDiscount] = useState("")
  const [newPromoExpiry, setNewPromoExpiry] = useState("")
  const [promoLoading, setPromoLoading] = useState(false)

  // Promo Filter & Search State
  const [couponFilter, setCouponFilter] = useState("all") // 'all' | 'active' | 'expired'
  const [couponSearch, setCouponSearch] = useState("")

  // Bulk Discount Form State
  const [discountVal, setDiscountVal] = useState("")
  const [expiryVal, setExpiryVal] = useState("")
  const [selectionMode, setSelectionMode] = useState("all") // 'all' | 'category' | 'individual' | 'wishlist' | 'cart'

  // Selection Targets
  const [selectedCategory, setSelectedCategory] = useState("")
  const [selectedProductIds, setSelectedProductIds] = useState(new Set())

  // Search for Individual/Wishlist/Cart Lists
  const [searchQuery, setSearchQuery] = useState("")

  // Live Today Orders & Revenue
  const [today, setToday] = useState({ count: 0, revenue: 0 })

  const loadPromoCodes = async () => {
    try {
      const { data: rows, error } = await supabase.from("promo_codes").select("*")
      if (error) throw error
      const list = (rows || []).map((r) => ({
        id: r.code,
        code: r.code,
        type: r.type,
        value: r.value,
        expiryDate: r.expiry_date,
        createdAt: r.created_at,
      }))
      setPromoCodes(list)
    } catch (error) {
      console.error("Error loading promo codes:", error)
    }
  }

  // Load products, categories, wishlists, and carts
  const loadData = async () => {
    try {
      setLoading(true)
      const { data: productRows, error: productError } = await supabase
        .from("products")
        .select("*")
      if (productError) throw productError
      const fetched = mapProductRows(productRows)
      setProducts(fetched)

      // Extract distinct categories
      const distinct = Array.from(
        new Set(fetched.map((p) => p.category).filter(Boolean))
      ).sort()
      setCategories(distinct)
      if (distinct.length > 0) {
        setSelectedCategory(distinct[0])
      }

      // Fetch wishlists and aggregate (per-product distinct user count)
      const wishlistCountsFinal = {}
      try {
        const { data: wishlistRows, error } = await supabase
          .from("wishlist_items")
          .select("product_id, user_id")
        if (!error && wishlistRows) {
          const wishlistCountsMap = {}
          wishlistRows.forEach(({ product_id: pId, user_id: uId }) => {
            if (pId && uId) {
              if (!wishlistCountsMap[pId]) wishlistCountsMap[pId] = new Set()
              wishlistCountsMap[pId].add(uId)
            }
          })
          Object.keys(wishlistCountsMap).forEach((pId) => {
            wishlistCountsFinal[pId] = wishlistCountsMap[pId].size
          })
        }
      } catch (error) {
        console.error("Error loading wishlists:", error)
      }
      setWishlistCounts(wishlistCountsFinal)

      // Fetch carts and aggregate (per-product distinct user count)
      const cartCountsFinal = {}
      try {
        const { data: cartRows, error } = await supabase
          .from("cart_items")
          .select("product_id, user_id")
        if (!error && cartRows) {
          const cartCountsMap = {}
          cartRows.forEach(({ product_id: pId, user_id: uId }) => {
            if (pId && uId) {
              if (!cartCountsMap[pId]) cartCountsMap[pId] = new Set()
              cartCountsMap[pId].add(uId)
            }
          })
          Object.keys(cartCountsMap).forEach((pId) => {
            cartCountsFinal[pId] = cartCountsMap[pId].size
          })
        }
      } catch (error) {
        console.error("Error loading carts:", error)
      }
      setCartCounts(cartCountsFinal)

      // Load promo codes
      await loadPromoCodes()
    } catch (error) {
      console.error("Error loading products for discounts:", error)
      toast.error("Failed to load discount data.")
    } finally {
      setLoading(false)
    }
  }

  // Load today sales data for header stat pill
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data: rows } = await supabase
          .from("orders")
          .select("id, total, created_at")
          .order("created_at", { ascending: false })
          .limit(200)
        if (rows && active) {
          const todays = rows.filter((o) => isToday(toDateSafe(o.created_at)))
          setToday({
            count: todays.length,
            revenue: todays.reduce((s, o) => s + Number(o.total || 0), 0),
          })
        }
      } catch (e) {
        console.warn("Failed to load today stats:", e)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [])

  // Compute selected products based on selection mode
  const getSelectedProducts = () => {
    if (selectionMode === "all") {
      return products
    } else if (selectionMode === "category") {
      return products.filter((p) => p.category === selectedCategory)
    } else {
      return products.filter((p) => selectedProductIds.has(p.id))
    }
  }

  // Toggle individual product selection
  const handleToggleProduct = (id) => {
    const updated = new Set(selectedProductIds)
    if (updated.has(id)) {
      updated.delete(id)
    } else {
      updated.add(id)
    }
    setSelectedProductIds(updated)
  }

  // Get wishlisted products ordered by user count descending
  const getWishlistedProducts = () => {
    return products
      .filter((p) => (wishlistCounts[p.id] || 0) > 0)
      .map((p) => ({ ...p, userCount: wishlistCounts[p.id] || 0 }))
      .sort((a, b) => b.userCount - a.userCount)
  }

  // Get carted products ordered by user count descending
  const getCartedProducts = () => {
    return products
      .filter((p) => (cartCounts[p.id] || 0) > 0)
      .map((p) => ({ ...p, userCount: cartCounts[p.id] || 0 }))
      .sort((a, b) => b.userCount - a.userCount)
  }

  const getFilteredProducts = () =>
    products.filter(
      (p) =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchQuery.toLowerCase())
    )

  const getFilteredWishlistedProducts = () =>
    getWishlistedProducts().filter(
      (p) =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchQuery.toLowerCase())
    )

  const getFilteredCartedProducts = () =>
    getCartedProducts().filter(
      (p) =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchQuery.toLowerCase())
    )

  const handleSelectAll = () => {
    let targets = []
    if (selectionMode === "individual") targets = getFilteredProducts()
    else if (selectionMode === "wishlist") targets = getFilteredWishlistedProducts()
    else if (selectionMode === "cart") targets = getFilteredCartedProducts()
    const updated = new Set(selectedProductIds)
    targets.forEach((p) => updated.add(p.id))
    setSelectedProductIds(updated)
  }

  const handleDeselectAll = () => {
    let targets = []
    if (selectionMode === "individual") targets = getFilteredProducts()
    else if (selectionMode === "wishlist") targets = getFilteredWishlistedProducts()
    else if (selectionMode === "cart") targets = getFilteredCartedProducts()
    const updated = new Set(selectedProductIds)
    targets.forEach((p) => updated.delete(p.id))
    setSelectedProductIds(updated)
  }

  const handleApplyDiscount = async () => {
    const pct = Number(discountVal)
    if (isNaN(pct) || pct < 0 || pct > 100 || discountVal === "") {
      toast.error("Please enter a valid discount percentage between 0 and 100.")
      return
    }
    if (!expiryVal) {
      toast.error("Please specify a valid expiration date and time.")
      return
    }
    const targets = getSelectedProducts()
    if (targets.length === 0) {
      toast.error("No products are currently selected. Adjust selection criteria.")
      return
    }

    try {
      setSaving(true)
      const productIds = targets.map((t) => t.id)
      const { error } = await supabase
        .from("products")
        .update({ discount: pct, discount_expiry: expiryVal })
        .in("id", productIds)
      if (error) throw error

      toast.success(`Successfully applied ${pct}% discount to ${targets.length} product(s)!`)
      setDiscountVal("")
      setExpiryVal("")
      setSelectedProductIds(new Set())
      await loadData()
    } catch (error) {
      console.error("Bulk discount error:", error)
      toast.error("An error occurred while applying bulk discount.")
    } finally {
      setSaving(false)
    }
  }

  const handleGeneratePromo = async () => {
    const code = newPromoCode.trim().toUpperCase()
    const pct = Number(newPromoDiscount)
    if (!code) {
      toast.error("Please enter a coupon code.")
      return
    }
    if (isNaN(pct) || pct <= 0 || pct > 100 || newPromoDiscount === "") {
      toast.error("Please enter a valid discount percentage between 1 and 100.")
      return
    }
    if (!newPromoExpiry) {
      toast.error("Please specify a valid expiration date and time.")
      return
    }
    try {
      setPromoLoading(true)
      const expiryISO = new Date(newPromoExpiry).toISOString()
      const { error } = await supabase.from("promo_codes").upsert({
        code,
        type: "percent",
        value: pct,
        expiry_date: expiryISO,
      })
      if (error) throw error
      toast.success(`Coupon "${code}" generated successfully!`)
      setNewPromoCode("")
      setNewPromoDiscount("")
      setNewPromoExpiry("")
      await loadPromoCodes()
    } catch (error) {
      console.error("Error creating promo code:", error)
      toast.error("An error occurred while creating the promo code.")
    } finally {
      setPromoLoading(false)
    }
  }

  // ── Bulletproof Delete Coupon Action ──
  const handleDeletePromo = async (code) => {
    if (!code) return
    const cleanCode = String(code).trim().toUpperCase()

    // 1. Optimistic removal: instantly removes row from table without blocking
    setPromoCodes((prev) => prev.filter((p) => String(p.code).trim().toUpperCase() !== cleanCode))

    try {
      setPromoLoading(true)
      // 2. Perform DB delete via ilike (case-insensitive) and eq
      const { error } = await supabase
        .from("promo_codes")
        .delete()
        .ilike("code", cleanCode)

      if (error) {
        const { error: err2 } = await supabase
          .from("promo_codes")
          .delete()
          .eq("code", cleanCode)
        if (err2) throw err2
      }

      toast.success(`Coupon "${cleanCode}" deleted successfully.`)
      await loadPromoCodes()
    } catch (error) {
      console.error("Error deleting promo code:", error)
      toast.error(error.message || `Failed to delete coupon "${cleanCode}".`)
      await loadPromoCodes()
    } finally {
      setPromoLoading(false)
    }
  }

  const selectedTargetsCount = getSelectedProducts().length

  // Filtered coupons list based on filter pill and search
  const filteredCoupons = promoCodes.filter((promo) => {
    const isExpired = new Date(promo.expiryDate).getTime() < Date.now()
    if (couponFilter === "active" && isExpired) return false
    if (couponFilter === "expired" && !isExpired) return false
    if (couponSearch.trim()) {
      return promo.code?.toLowerCase().includes(couponSearch.trim().toLowerCase())
    }
    return true
  })

  if (loading) {
    return (
      <div
        style={{ fontFamily: FONT }}
        className="flex-1 w-full min-h-[500px] flex flex-col items-center justify-center gap-3 text-[#162320]"
      >
        <Loader2 className="h-9 w-9 animate-spin text-[#104945]" />
        <p className="font-medium text-xs text-[#5D6B65]">Loading discounts and promo codes...</p>
      </div>
    )
  }

  return (
    <main
      style={{ fontFamily: FONT }}
      className="flex-1 w-full space-y-5 text-[#162320] pb-16 pr-4 sm:pr-6 md:pr-8 lg:pr-10 max-w-[1240px]"
      data-purpose="discounts-main-content"
    >
      {/* ── Top Header & Metrics Controls (aligned with Optimization / Inventory) ── */}
      <header
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-1"
        data-purpose="top-header"
      >
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#143834] text-white flex items-center justify-center shadow-xs">
              <Ticket className="w-4 h-4" />
            </div>
            <h2
              style={{ fontFamily: DISPLAY }}
              className="text-2xl font-bold tracking-tight text-[#14211D]"
            >
              Discounts &amp; Coupons Manager
            </h2>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-[#E2DBD0] text-[#47423B]">
              Promotions
            </span>
          </div>
          <p className="text-xs text-[#5D6B65] mt-0.5">
            Apply bulk promotional discounts to catalog products or generate unique checkout coupon
            codes with automated timers.
          </p>
        </div>

        {/* Header Actions: Stat Pill, Dark Mode, Notifications */}
        <div className="flex items-center gap-2.5 shrink-0 self-end md:self-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FFFFFF] rounded-full border border-[#DFD9CD] shadow-sm text-xs font-medium text-[#384641]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
            <span>{today.count} today</span>
            <span className="text-[#8B9691] font-normal">
              {today.revenue >= 1000
                ? `₹${(today.revenue / 1000).toFixed(1)}k`
                : `₹${today.revenue}`}
            </span>
          </div>

          <button
            aria-label="Toggle dark mode"
            onClick={() => toast.info("Dark mode toggled.")}
            className="w-8 h-8 rounded-full bg-white border border-[#DFD9CD] flex items-center justify-center text-[#5D6B65] hover:text-black shadow-sm transition-colors cursor-pointer"
            type="button"
            title="Toggle theme"
          >
            <Moon className="w-4 h-4" />
          </button>

          <button
            aria-label="View notifications"
            onClick={() => toast.info("No unread notifications.")}
            className="relative w-8 h-8 rounded-full bg-white border border-[#DFD9CD] flex items-center justify-center text-[#5D6B65] hover:text-black shadow-sm transition-colors cursor-pointer"
            type="button"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full"></span>
          </button>
        </div>
      </header>

      {/* ── Section 1: Bulk Discount Manager Card ── */}
      <section
        className="bg-white rounded-2xl md:rounded-3xl border border-[#E2DBD0] shadow-sm overflow-hidden"
        data-purpose="bulk-discount-manager"
      >
        {/* Banner Header */}
        <div className="bg-[#F8F6F3] p-5 md:p-6 border-b border-[#E9E3DA] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-9 h-9 rounded-xl bg-[#EAF2ED] text-[#104945] flex items-center justify-center shrink-0 border border-[#D5E4DB]">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#14211D]">Bulk Discount Manager</h3>
              <p className="text-xs text-[#6A7771] mt-0.5 leading-relaxed max-w-2xl">
                Apply promotional markdown to catalog products, entire category clusters, or seasonal
                sets. The scheduler restores standard MRP instantly when expired.
              </p>
            </div>
          </div>
          {/* Status Pill */}
          <div className="self-start md:self-center shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EAF2ED] border border-[#0F4C4C] text-[11px] font-semibold text-[#0F4C4C]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0F4C4C]"></span>
            <span>Automated Revert Active</span>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-5 md:p-6 space-y-5">
          {/* Step 1: Select Criteria */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#57645E] mb-2.5">
              <span>1. SELECT PRODUCTS CRITERIA</span>
              <span className="text-[11.5px] font-medium text-[#798580] normal-case tracking-normal">
                Applies to qualified items in live cart
              </span>
            </div>
            <div className="inline-flex p-1 bg-[#F5F2EC] rounded-full border border-[#EBE3D7] text-xs font-semibold text-[#54625C] flex-wrap gap-1">
              {[
                { id: "all", label: "All Products" },
                { id: "category", label: "By Category" },
                { id: "individual", label: "Individual" },
                { id: "wishlist", label: "Wishlist" },
                { id: "cart", label: "Cart" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSelectionMode(tab.id)
                    setSelectedProductIds(new Set())
                    setSearchQuery("")
                  }}
                  className={`px-4 py-1.5 rounded-full transition-all cursor-pointer ${
                    selectionMode === tab.id
                      ? "bg-white text-[#192723] shadow-xs font-bold"
                      : "hover:text-[#192723]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Criteria Selectors */}
          {selectionMode === "category" && (
            <div className="p-4 bg-[#F8F6F3] rounded-xl border border-[#E4DED6] space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#57645E]">
                SELECT PRODUCT CATEGORY
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD5C9] bg-white text-sm text-[#1C2924] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
              >
                {categories.map((c) => {
                  const count = products.filter((p) => p.category === c).length
                  return (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)} ({count} products)
                    </option>
                  )
                })}
              </select>
            </div>
          )}

          {selectionMode === "individual" && (
            <div className="p-4 bg-[#F8F6F3] rounded-xl border border-[#E4DED6] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#8C9892] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search product title or category..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-[#DCD5C9] bg-white text-xs text-[#1C2924] placeholder-[#8F9A95] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#DCD5C9] text-[#104945] hover:bg-[#F2ECE2] transition-colors cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#DCD5C9] text-[#55635C] hover:bg-[#F2ECE2] transition-colors cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Product Checklist */}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-[#DCD5C9] bg-white divide-y divide-[#EFE9DF]">
                {getFilteredProducts().length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#7F8B85]">
                    No matching products found.
                  </div>
                ) : (
                  getFilteredProducts().map((p) => {
                    const isChecked = selectedProductIds.has(p.id)
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleToggleProduct(p.id)}
                        className="flex items-center px-4 py-2.5 hover:bg-[#FAF7F2] cursor-pointer select-none transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          readOnly
                          className="h-4 w-4 rounded border-[#DCD5C9] text-[#104945] focus:ring-[#104945] cursor-pointer mr-3"
                        />
                        {(p.thumbnail || p.image) && (
                          <img
                            src={p.thumbnail || p.image}
                            alt=""
                            className="w-8 h-8 rounded-lg object-cover mr-3 bg-[#F5F2EC] shrink-0 border border-[#E8E2D9]"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="block text-xs font-semibold text-[#182622] truncate">
                            {p.title}
                          </span>
                          <span className="block text-[11px] text-[#7F8B85] capitalize">
                            {p.category} • ₹{Number(p.price || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {selectionMode === "wishlist" && (
            <div className="p-4 bg-[#F8F6F3] rounded-xl border border-[#E4DED6] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#8C9892] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search wishlisted product title or category..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-[#DCD5C9] bg-white text-xs text-[#1C2924] placeholder-[#8F9A95] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#DCD5C9] text-[#104945] hover:bg-[#F2ECE2] transition-colors cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#DCD5C9] text-[#55635C] hover:bg-[#F2ECE2] transition-colors cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Wishlisted Product Checklist */}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-[#DCD5C9] bg-white divide-y divide-[#EFE9DF]">
                {getFilteredWishlistedProducts().length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#7F8B85]">
                    No matching wishlisted products found.
                  </div>
                ) : (
                  getFilteredWishlistedProducts().map((p) => {
                    const isChecked = selectedProductIds.has(p.id)
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleToggleProduct(p.id)}
                        className="flex items-center px-4 py-2.5 hover:bg-[#FAF7F2] cursor-pointer select-none transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          readOnly
                          className="h-4 w-4 rounded border-[#DCD5C9] text-[#104945] focus:ring-[#104945] cursor-pointer mr-3"
                        />
                        {(p.thumbnail || p.image) && (
                          <img
                            src={p.thumbnail || p.image}
                            alt=""
                            className="w-8 h-8 rounded-lg object-cover mr-3 bg-[#F5F2EC] shrink-0 border border-[#E8E2D9]"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="block text-xs font-semibold text-[#182622] truncate">
                            {p.title}
                          </span>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-[#7F8B85] capitalize">
                              {p.category} • ₹{Number(p.price || 0).toFixed(2)}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FCE5E3] text-[#BE413B] text-[10px] font-bold border border-[#F8C8C5]">
                              <Heart className="w-2.5 h-2.5 fill-[#BE413B]" /> Wishlisted by{" "}
                              {p.userCount} {p.userCount === 1 ? "user" : "users"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {selectionMode === "cart" && (
            <div className="p-4 bg-[#F8F6F3] rounded-xl border border-[#E4DED6] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#8C9892] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search carted product title or category..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-[#DCD5C9] bg-white text-xs text-[#1C2924] placeholder-[#8F9A95] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#DCD5C9] text-[#104945] hover:bg-[#F2ECE2] transition-colors cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#DCD5C9] text-[#55635C] hover:bg-[#F2ECE2] transition-colors cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Carted Product Checklist */}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-[#DCD5C9] bg-white divide-y divide-[#EFE9DF]">
                {getFilteredCartedProducts().length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#7F8B85]">
                    No matching carted products found.
                  </div>
                ) : (
                  getFilteredCartedProducts().map((p) => {
                    const isChecked = selectedProductIds.has(p.id)
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleToggleProduct(p.id)}
                        className="flex items-center px-4 py-2.5 hover:bg-[#FAF7F2] cursor-pointer select-none transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          readOnly
                          className="h-4 w-4 rounded border-[#DCD5C9] text-[#104945] focus:ring-[#104945] cursor-pointer mr-3"
                        />
                        {(p.thumbnail || p.image) && (
                          <img
                            src={p.thumbnail || p.image}
                            alt=""
                            className="w-8 h-8 rounded-lg object-cover mr-3 bg-[#F5F2EC] shrink-0 border border-[#E8E2D9]"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="block text-xs font-semibold text-[#182622] truncate">
                            {p.title}
                          </span>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-[#7F8B85] capitalize">
                              {p.category} • ₹{Number(p.price || 0).toFixed(2)}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E0F2FE] text-[#0369A1] text-[10px] font-bold border border-[#BAE6FD]">
                              <ShoppingCart className="w-2.5 h-2.5" /> In cart for {p.userCount}{" "}
                              {p.userCount === 1 ? "user" : "users"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* Step 2 & 3: Inputs Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 pt-1">
            {/* 2. Discount Value */}
            <div>
              <label
                className="block text-[11px] font-bold uppercase tracking-wider text-[#57645E] mb-2"
                htmlFor="bulk-discount-value"
              >
                2. DISCOUNT VALUE (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD5C9] bg-white text-sm text-[#1C2924] placeholder-[#9EABA5] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
                id="bulk-discount-value"
                placeholder="% e.g. 15"
                value={discountVal}
                onChange={(e) => setDiscountVal(e.target.value)}
              />
              <p className="text-[11px] text-[#7F8B85] mt-1.5">
                Direct percentage deducted from standard studio price.
              </p>
            </div>

            {/* 3. Expiration Date & Time */}
            <div>
              <label
                className="block text-[11px] font-bold uppercase tracking-wider text-[#57645E] mb-2"
                htmlFor="bulk-expiration"
              >
                3. EXPIRATION DATE &amp; TIME
              </label>
              <input
                type="datetime-local"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD5C9] bg-white text-sm text-[#1C2924] placeholder-[#9EABA5] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
                id="bulk-expiration"
                value={expiryVal}
                onChange={(e) => setExpiryVal(e.target.value)}
              />
              <p className="text-[11px] text-[#7F8B85] mt-1.5">
                Promotion reverts to regular MSRP immediately after expiry.
              </p>
            </div>
          </div>

          {/* Target Summary Callout Box */}
          <div className="bg-[#F8F6F3] border border-[#E4DED6] rounded-xl p-4 flex items-start gap-3.5">
            <div className="w-7 h-7 rounded-lg bg-[#E2ECE7] text-[#134F4A] flex items-center justify-center shrink-0 mt-0.5">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div className="text-xs text-[#52605A] leading-relaxed">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-[#23312C] text-[11px] tracking-wide uppercase">
                  TARGET SUMMARY
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ECE7E1] text-[#4F5D57]">
                  {selectionMode === "all"
                    ? "All Scope"
                    : selectionMode === "category"
                    ? "Category Scope"
                    : selectionMode === "individual"
                    ? "Individual Scope"
                    : selectionMode === "wishlist"
                    ? "Wishlist Scope"
                    : "Cart Scope"}
                </span>
              </div>
              <p>
                Applying bulk discount to{" "}
                <span className="font-semibold text-[#182723] underline decoration-[#182723]">
                  {selectionMode === "all" && `all products (${products.length} items)`}
                  {selectionMode === "category" &&
                    `category "${selectedCategory || "none"}" (${selectedTargetsCount} items)`}
                  {selectionMode === "individual" &&
                    `${selectedProductIds.size} individually selected product(s)`}
                  {selectionMode === "wishlist" &&
                    `${selectedProductIds.size} wishlisted product(s)`}
                  {selectionMode === "cart" &&
                    `${selectedProductIds.size} carted product(s)`}
                </span>{" "}
                in the database.{" "}
                {discountVal && expiryVal ? (
                  <span>
                    This will apply a promotion of <strong>{discountVal}%</strong> until{" "}
                    <strong>{new Date(expiryVal).toLocaleString()}</strong>. A total of{" "}
                    <strong>{selectedTargetsCount}</strong> product(s) will be updated. Offers
                    revert to standard MSRP upon expiration.
                  </span>
                ) : (
                  <span>
                    Please enter a discount percentage and expiry date to compute promotion details.
                    Offers revert to standard MSRP upon expiration.
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Bottom Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#F2ECE2]">
            <button
              onClick={() => {
                setDiscountVal("")
                setExpiryVal("")
                setSelectedProductIds(new Set())
              }}
              className="px-4 py-2 text-xs font-semibold text-[#434F4A] hover:text-[#182723] rounded-lg transition-colors cursor-pointer"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={handleApplyDiscount}
              disabled={saving || selectedTargetsCount === 0}
              className="px-5 py-2.5 bg-[#143834] hover:bg-[#0D2623] text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>
                {saving
                  ? "Applying Bulk Updates..."
                  : `Apply Promotion to ${selectedTargetsCount} Product(s)`}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* ── Section 2: Promo Codes & Coupons Generator Card ── */}
      <section
        className="bg-white rounded-2xl md:rounded-3xl border border-[#E2DBD0] shadow-sm p-5 md:p-6 space-y-5"
        data-purpose="coupon-generator"
      >
        {/* Header */}
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-[#EAF2ED] text-[#104945] flex items-center justify-center shrink-0 border border-[#D5E4DB]">
            <Ticket className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#14211D]">
              Promo Codes &amp; Coupons Generator
            </h3>
            <p className="text-xs text-[#6A7771] mt-0.5 leading-relaxed">
              Create coupon codes that apply a percentage discount on the user's overall order value.
              Set an expiration timer; manually deleting a coupon invalidates it immediately.
            </p>
          </div>
        </div>

        {/* 3-Column Input Fields Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 pt-1">
          {/* Coupon Code */}
          <div>
            <label
              className="block text-[11px] font-bold uppercase tracking-wider text-[#57645E] mb-2"
              htmlFor="coupon-code-input"
            >
              COUPON CODE
            </label>
            <input
              type="text"
              id="coupon-code-input"
              placeholder="E.G. WELCOME"
              value={newPromoCode}
              onChange={(e) => setNewPromoCode(e.target.value.toUpperCase())}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD5C9] bg-white font-mono text-sm uppercase text-[#1C2924] placeholder-[#A0ACA6] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
            />
            <p className="text-[11px] text-[#7F8B85] mt-1.5">
              Codes are case-insensitive at checkout.
            </p>
          </div>

          {/* Discount % */}
          <div>
            <label
              className="block text-[11px] font-bold uppercase tracking-wider text-[#57645E] mb-2"
              htmlFor="coupon-discount-input"
            >
              DISCOUNT (%)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              id="coupon-discount-input"
              placeholder="% e.g. 20"
              value={newPromoDiscount}
              onChange={(e) => setNewPromoDiscount(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD5C9] bg-white text-sm text-[#1C2924] placeholder-[#A0ACA6] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
            />
            <p className="text-[11px] text-[#7F8B85] mt-1.5">
              Deducted from pre-tax cart subtotal.
            </p>
          </div>

          {/* Expiration Date & Time */}
          <div>
            <label
              className="block text-[11px] font-bold uppercase tracking-wider text-[#57645E] mb-2"
              htmlFor="coupon-expiration-input"
            >
              EXPIRATION DATE &amp; TIME
            </label>
            <input
              type="datetime-local"
              id="coupon-expiration-input"
              value={newPromoExpiry}
              onChange={(e) => setNewPromoExpiry(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#DCD5C9] bg-white text-sm text-[#1C2924] placeholder-[#A0ACA6] focus:outline-hidden focus:border-[#104945] focus:ring-1 focus:ring-[#104945] transition-all"
            />
            <p className="text-[11px] text-[#7F8B85] mt-1.5">
              Automatic revocation after deadline.
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleGeneratePromo}
            disabled={promoLoading}
            className="px-5 py-2.5 bg-[#143834] hover:bg-[#0D2623] text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{promoLoading ? "Generating..." : "Generate Coupon"}</span>
          </button>
        </div>
      </section>

      {/* ── Section 3: Active Coupons Table Card ── */}
      <section
        className="bg-white rounded-2xl md:rounded-3xl border border-[#E2DBD0] shadow-sm overflow-hidden"
        data-purpose="active-coupons-table-section"
      >
        {/* Table Toolbar */}
        <div className="p-5 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EFE9DF]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[#192723]">Active Coupons</h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#ECE7E1] text-[#34423C]">
                {promoCodes.length}
              </span>
            </div>
            {/* Segmented Filter Pills */}
            <div className="inline-flex p-1 bg-[#F5F2EC] rounded-full border border-[#EBE3D7] text-xs font-semibold text-[#54625C] ml-2">
              {["all", "active", "expired"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCouponFilter(tab)}
                  className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                    couponFilter === tab
                      ? "bg-white text-[#192723] shadow-xs font-bold"
                      : "hover:text-[#192723]"
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#8C9892] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter code..."
              value={couponSearch}
              onChange={(e) => setCouponSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[#D8D0C3] bg-[#F8F6F3] text-xs text-[#1C2924] placeholder-[#8F9A95] focus:outline-hidden focus:border-[#104945] focus:bg-white transition-all"
            />
          </div>
        </div>

        {/* Table Data or Empty State */}
        {promoCodes.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#7F8B85] bg-[#FCFAF7]">
            No coupons found in the system.
          </div>
        ) : filteredCoupons.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#7F8B85] bg-[#FCFAF7]">
            No coupons match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FBF9F6] border-b border-[#EFE9DF] text-[10px] font-bold uppercase tracking-wider text-[#798580]">
                <tr>
                  <th className="py-3 px-6" scope="col">
                    CODE
                  </th>
                  <th className="py-3 px-6" scope="col">
                    DISCOUNT
                  </th>
                  <th className="py-3 px-6" scope="col">
                    EXPIRATION
                  </th>
                  <th className="py-3 px-6" scope="col">
                    STATUS
                  </th>
                  <th className="py-3 px-6 text-right" scope="col">
                    ACTION
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EDE3]">
                {filteredCoupons.map((promo) => {
                  const isExpired = new Date(promo.expiryDate).getTime() < Date.now()
                  return (
                    <tr
                      key={promo.id || promo.code}
                      className="hover:bg-[#FCFAF7] transition-colors"
                    >
                      <td className="py-4 px-6 whitespace-nowrap">
                        <span
                          className={`font-mono text-xs font-semibold px-2.5 py-1 rounded ${
                            isExpired
                              ? "bg-[#F5F2ED] border border-[#E3DCCF] text-[#1F2C27]"
                              : "bg-[#D1FAE5] border border-[#A7F3D0] text-[#1B4332]"
                          }`}
                        >
                          {promo.code}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-bold text-[#1E2C27] whitespace-nowrap">
                        {promo.value}% OFF
                      </td>
                      <td className="py-4 px-6 font-mono text-[#58645F] whitespace-nowrap">
                        {new Date(promo.expiryDate).toLocaleString()}
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        {isExpired ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#FDE8E8] text-[#C81E1E]">
                            Expired
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#D1FAE5] text-[#1B4332]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#1B4332] animate-pulse"></span>
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeletePromo(promo.code)
                          }}
                          disabled={promoLoading}
                          aria-label={`Delete coupon ${promo.code}`}
                          className="p-1.5 text-[#9BA5A0] hover:text-[#C81E1E] hover:bg-[#FDE8E8] transition-colors rounded-lg cursor-pointer disabled:opacity-50 inline-flex items-center justify-center"
                          title="Delete Coupon"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer */}
        <div className="px-6 py-3.5 bg-white border-t border-[#EFE9DF] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <span className="text-[#5E6863]">
            Showing {filteredCoupons.length} of {promoCodes.length} promotional rules
          </span>
          <span className="text-[#87928D]">
            Coupon codes sync immediately across live POS &amp; web store
          </span>
        </div>
      </section>
    </main>
  )
}

export default AddDiscountPage