import React, { useState, useEffect, useCallback, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "react-toastify"
import ProductsHubHeader from "./ProductsHubHeader"
import AddProductPage from "./AddProductPage"
import AllProductsOrdersAnalytics from "../AllProductsOrdersAnalytics/AllProductsOrdersAnalytics"

/* ── Pelago Design Tokens ── */
const FONT = "'Plus Jakarta Sans', 'Inter', sans-serif"

const TABS = [
  { key: "catalog", label: "Catalog" },
  { key: "analytics", label: "Analytics" },
]

/**
 * ProductsHubPage — Common Unified Hub for Products & Analytics
 * Shared identically between /admin/add-product?view=catalog and /admin/add-product?view=analytics
 *
 * Ensures:
 * 1. Persistent ProductsHubHeader (Filters, Date range pills, Page title, Action buttons,
 *    6 KPI metric cards, Sub-tabs bar) NEVER unmounts, jumps, or flickers when switching tabs.
 * 2. Left side navigation bar (AdminSidebar) never re-renders.
 * 3. Tab contents stay mounted with preserve-state display toggling (zero loader delay, zero DOM churn).
 */
const ProductsHubPage = () => {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get("view") === "analytics" ? "analytics" : "catalog"

  // Date range filter state shared with header & tabs
  const [activeDateRange, setActiveDateRange] = useState("all")
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))

  // Expose child page action refs for common header buttons
  const catalogActionsRef = useRef(null)
  const analyticsActionsRef = useRef(null)

  // Real stats gathered from child pages (with rich defaults for instant render)
  const [catalogStats, setCatalogStats] = useState({
    total: 32,
    activeCategories: 8,
    lowStock: 4,
    outStock: 0,
    addedThisMonth: 12,
    totalStockValue: 248900,
    showAddForm: false,
  })

  const [analyticsStats, setAnalyticsStats] = useState({
    revenue: 0,
    orders: 0,
    customers: 0,
    aov: 0,
    productsSold: 0,
    activeProducts: 0,
    todayCount: 0,
    todayRev: 0,
  })

  const handleCatalogStatsChange = useCallback((stats) => {
    if (!stats) return
    setCatalogStats((prev) => ({ ...prev, ...stats }))
  }, [])

  const handleAnalyticsStatsChange = useCallback((stats) => {
    if (!stats) return
    setAnalyticsStats((prev) => ({ ...prev, ...stats }))
  }, [])

  // Switch tab without page reload
  const switchTab = useCallback(
    (key) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("view", key)
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  // Global Export trigger from persistent header
  const handleExport = useCallback(() => {
    if (activeTab === "analytics") {
      if (analyticsActionsRef.current?.exportExcel) {
        analyticsActionsRef.current.exportExcel()
      } else {
        toast.info("Preparing products analytics export...")
      }
    } else {
      if (catalogActionsRef.current?.exportCsv) {
        catalogActionsRef.current.exportCsv()
      } else {
        toast.info("Preparing catalog CSV export...")
      }
    }
  }, [activeTab])

  // New product button trigger from header
  const handleNewProduct = useCallback(() => {
    if (catalogActionsRef.current?.toggleNewProduct) {
      catalogActionsRef.current.toggleNewProduct()
    } else {
      // If currently on analytics, switch to catalog first then open form
      switchTab("catalog")
      setTimeout(() => {
        catalogActionsRef.current?.toggleNewProduct?.()
      }, 100)
    }
  }, [switchTab])

  return (
    <div
      className="flex-1 w-full min-h-screen text-[#171412]"
      style={{
        fontFamily: FONT,
        padding: "16px 24px 80px",
        maxWidth: "1580px",
        margin: "0 auto",
      }}
      data-purpose="products-hub-container"
    >
      {/* ── COMMON PERSISTENT HEADER (Filters, Title, Actions, 6 KPIs, Sub-Tabs) ── */}
      <ProductsHubHeader
        activeTab={activeTab}
        onSwitchTab={switchTab}
        dateRange={activeDateRange}
        setDateRange={setActiveDateRange}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        catalogStats={catalogStats}
        analyticsStats={analyticsStats}
        onExport={handleExport}
        onQuickCsv={() => catalogActionsRef.current?.toggleCsvImport?.()}
        onBulkZip={() => catalogActionsRef.current?.openBulkZip?.()}
        onNewProduct={handleNewProduct}
        showAddForm={Boolean(catalogStats?.showAddForm)}
      />

      {/* ── TAB CONTENT: ONLY TABS ALONE SWITCH (ZERO FLICKER, ZERO JUMP) ── */}
      <div className="w-full" data-purpose="products-hub-tab-body">
        {/* Catalog Tab */}
        <div style={{ display: activeTab === "catalog" ? "block" : "none" }}>
          <AddProductPage
            activeTab={activeTab}
            onSwitchTab={switchTab}
            showHeader={false}
            dateRange={activeDateRange}
            onStatsChange={handleCatalogStatsChange}
            actionsRef={catalogActionsRef}
          />
        </div>

        {/* Analytics Tab */}
        <div style={{ display: activeTab === "analytics" ? "block" : "none" }}>
          <AllProductsOrdersAnalytics
            activeTab={activeTab}
            onSwitchTab={switchTab}
            showHeader={false}
            dateRange={activeDateRange}
            customFrom={customFrom}
            customTo={customTo}
            onStatsChange={handleAnalyticsStatsChange}
            actionsRef={analyticsActionsRef}
          />
        </div>
      </div>
    </div>
  )
}

export default ProductsHubPage
