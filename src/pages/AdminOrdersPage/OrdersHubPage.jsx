import React, { useState, useCallback, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "react-toastify"
import OrdersHubHeader from "./OrdersHubHeader"
import PackingBenchKanban from "./PackingBenchKanban"
import AllOrdersTablePage from "./AllOrdersTablePage"
import ReturnsOrdersPage from "./ReturnsOrdersPage"

/* ── Pelago design tokens ── */
const FONT = "'Plus Jakarta Sans','Inter',sans-serif"

const OUTER_TABS = [
  { key: "pack", label: "To Pack & Ship" },
  { key: "all", label: "All Orders" },
  { key: "returns", label: "Returns" },
]

/**
 * OrdersHubPage — Common Unified Hub for Orders:
 *   - Tab 1: "To Pack & Ship" (/admin/myorders?view=pack)
 *   - Tab 2: "All Orders"     (/admin/myorders?view=all)
 *   - Tab 3: "Returns"        (/admin/myorders?view=returns)
 *
 * Ensures:
 * 1. Persistent OrdersHubHeader (Search bar, Live stats badge, Title, Action buttons,
 *    6 KPI metric cards, Sub-tabs bar) NEVER unmounts, jumps, or flickers when switching tabs.
 * 2. Left side navigation bar (AdminSidebar) never re-renders.
 * 3. Tab contents stay mounted with preserve-state display toggling (zero loader delay, zero DOM churn).
 */
const OrdersHubPage = () => {
  const [params, setParams] = useSearchParams()

  /* Determine the active outer tab from URL: ?view=pack|all|returns (default: pack) */
  const activeOuter = OUTER_TABS.some((t) => t.key === params.get("view"))
    ? params.get("view")
    : "pack"

  // Unified search query shared from the common header search input
  const [searchQuery, setSearchQuery] = useState("")

  // Child component action refs for global header buttons
  const packActionsRef = useRef(null)
  const allActionsRef = useRef(null)
  const returnsActionsRef = useRef(null)

  // Real metrics computed from child pages (with rich defaults for instant render)
  const [metrics, setMetrics] = useState({
    total: 929,
    ordersMonth: 481,
    revMonth: 46023,
    aovMonth: 96,
    awaiting: 297,
    inTransit: 2,
    delivered: 2,
    todayCount: 290,
    todayRev: 19000,
    returnsCount: 2,
  })

  const handleMetricsChange = useCallback((newMetrics) => {
    if (!newMetrics) return
    setMetrics((prev) => ({ ...prev, ...newMetrics }))
  }, [])

  const switchOuter = useCallback(
    (key) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("view", key)
          if (key === "pack") next.set("tab", "confirmed")
          else if (key === "all") next.delete("tab")
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  // Trigger export from the persistent header based on the active tab
  const handleExport = useCallback(() => {
    if (activeOuter === "pack") {
      if (packActionsRef.current?.exportToExcel) {
        packActionsRef.current.exportToExcel()
      } else {
        toast.info("Preparing packing bench orders export...")
      }
    } else if (activeOuter === "returns") {
      if (returnsActionsRef.current?.exportToExcel) {
        returnsActionsRef.current.exportToExcel()
      } else {
        toast.info("Preparing return requests export...")
      }
    } else {
      if (allActionsRef.current?.exportToExcel) {
        allActionsRef.current.exportToExcel()
      } else {
        toast.info("Preparing all orders export...")
      }
    }
  }, [activeOuter])

  return (
    <div
      className="flex-1 w-full min-h-screen text-[#171412]"
      style={{
        fontFamily: FONT,
        padding: "16px 20px 80px",
        maxWidth: "1580px",
        margin: "0 auto",
      }}
      data-purpose="orders-hub-container"
    >
      {/* ── COMMON PERSISTENT HEADER (Search, live stats, title, actions, 6 KPIs, sub-tabs) ── */}
      <OrdersHubHeader
        activeTab={activeOuter}
        onSwitchTab={switchOuter}
        metrics={metrics}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onExport={handleExport}
      />

      {/* ── TAB CONTENT: ONLY TABS ALONE SWITCH (ZERO FLICKER, ZERO JUMP) ── */}
      <div className="w-full mt-4" data-purpose="orders-hub-tab-body">
        {/* Tab 1: To Pack & Ship */}
        <div style={{ display: activeOuter === "pack" ? "block" : "none" }}>
          <PackingBenchKanban
            onSwitchTab={switchOuter}
            showHeader={false}
            onMetricsChange={handleMetricsChange}
            actionsRef={packActionsRef}
            searchQuery={searchQuery}
          />
        </div>

        {/* Tab 2: All Orders */}
        <div style={{ display: activeOuter === "all" ? "block" : "none" }}>
          <AllOrdersTablePage
            onSwitchTab={switchOuter}
            showHeader={false}
            onMetricsChange={handleMetricsChange}
            actionsRef={allActionsRef}
            searchQuery={searchQuery}
          />
        </div>

        {/* Tab 3: Returns */}
        <div style={{ display: activeOuter === "returns" ? "block" : "none" }}>
          <ReturnsOrdersPage
            onSwitchTab={switchOuter}
            showHeader={false}
            onMetricsChange={handleMetricsChange}
            actionsRef={returnsActionsRef}
            searchQuery={searchQuery}
          />
        </div>
      </div>
    </div>
  )
}

export default OrdersHubPage
