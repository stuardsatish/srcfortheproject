import React, { memo } from "react"
import { useNavigate } from "react-router-dom"
import {
  Search,
  Moon,
  Bell,
  Download,
  Package,
  IndianRupee,
  Truck,
  Check,
  RotateCcw,
} from "lucide-react"
import { toast } from "react-toastify"

/* ── Pelago Design Tokens ── */
const FONT = "'Plus Jakarta Sans', 'Inter', sans-serif"

const formatINR = (n) =>
  `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`

/**
 * OrdersHubHeader — Common persistent header for Orders Hub
 * Shared identically between:
 *   - /admin/myorders?view=pack
 *   - /admin/myorders?view=all
 *   - /admin/myorders?view=returns
 *
 * Includes:
 *   1. Top utility bar (Search bar with ⌘K, daily status pill, dark mode, bell, + New)
 *   2. Page title & action buttons (Subtitle, "Orders" title, Export, + New order)
 *   3. 6 KPI metric cards
 *   4. Sub-navigation tabs (To pack & ship | All orders | Returns)
 */
const OrdersHubHeader = ({
  activeTab = "pack",
  onSwitchTab,
  metrics = {},
  searchQuery = "",
  onSearchChange,
  onExport,
}) => {
  const navigate = useNavigate()

  return (
    <div style={{ fontFamily: FONT }} className="w-full flex flex-col gap-4 text-[#2C3437] select-none" data-purpose="orders-hub-header">
      {/* ── 1. Top Utility Navigation Bar ── */}
      <header className="flex flex-col sm:flex-row items-center justify-between gap-3" data-purpose="top-navigation">
        {/* Search bar */}
        <div className="relative w-full sm:w-[340px]">
          <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#717680]">
            <Search size={14} className="stroke-[2]" />
          </span>
          <input
            id="orders-search-input"
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="w-full text-[11.5px] bg-[#E8E2D8] border border-[#DDD5C8] rounded-full pl-8 pr-9 py-1.5 focus:bg-white focus:ring-1 focus:ring-[#104945] text-[#2C3437] placeholder-[#797F87] font-medium outline-none transition-all"
            placeholder="Search orders, products, customers..."
            type="text"
          />
          <span className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
            <kbd className="text-[9px] font-semibold text-[#6B7280] bg-[#DFD8CD] px-1 py-0.5 rounded border border-[#CFC5B7]">
              ⌘K
            </kbd>
          </span>
        </div>

        {/* Right Utilities */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Daily stats pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E4DDD2]/80 text-[11px] font-medium text-[#2C3437] shadow-inner">
            <span className="w-2 h-2 rounded-full bg-[#15803D] animate-pulse"></span>
            <span>
              <strong className="font-bold">{metrics.todayCount ?? 290} today</strong>{" "}
              <span className="text-[#646A72]">{formatINR(metrics.todayRev ?? 19000)}</span>
            </span>
          </div>

          {/* Dark mode toggle */}
          <button
            aria-label="Toggle theme"
            type="button"
            onClick={() => toast.info("Dark mode toggled.")}
            className="w-8 h-8 rounded-full bg-[#E4DDD2]/80 flex items-center justify-center text-[#4B5563] hover:text-black hover:bg-white transition-colors cursor-pointer"
            title="Dark mode"
          >
            <Moon size={14} />
          </button>

          {/* Notifications */}
          <button
            aria-label="Notifications"
            type="button"
            onClick={() => toast.info("No unread order notifications.")}
            className="w-8 h-8 rounded-full bg-[#E4DDD2]/80 flex items-center justify-center text-[#4B5563] hover:text-black hover:bg-white relative transition-colors cursor-pointer"
            title="Notifications"
          >
            <Bell size={14} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500 ring-2 ring-white"></span>
          </button>

          {/* Top New action */}
          <button
            id="orders-top-new-btn"
            onClick={() => navigate("/admin/createOrders")}
            type="button"
            className="bg-[#104945] hover:bg-[#0c3936] text-white text-[11px] font-bold px-3 py-1.5 rounded-full flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span className="text-xs leading-none">+</span>
            <span>New</span>
          </button>
        </div>
      </header>

      {/* ── 2. Page Title & Main Header Actions ── */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-0.5" data-purpose="header-section">
        <div>
          <div className="text-[11px] text-[#6E737B] font-medium tracking-tight">
            Online shop, studio shop and wholesale
          </div>
          <h1 className="text-[26px] font-extrabold text-[#111827] tracking-tight leading-none mt-0.5">
            Orders
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Export Button */}
          <button
            id="orders-export-btn"
            onClick={onExport}
            type="button"
            className="bg-white hover:bg-[#FAF8F5] text-[#2C3437] text-[11px] font-bold px-3 py-1.5 rounded-full border border-[#DED7CB] flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
          >
            <Download size={12} className="text-[#525866]" />
            <span>Export</span>
          </button>
          {/* New order Button */}
          <button
            id="orders-new-order-btn"
            onClick={() => navigate("/admin/createOrders")}
            type="button"
            className="bg-[#104945] hover:bg-[#0b3633] text-white text-[11px] font-bold px-3.5 py-1.5 rounded-full flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
          >
            <span className="text-xs leading-none">+</span>
            <span>New order</span>
          </button>
        </div>
      </section>

      {/* ── 3. KPI Metrics 6-Card Row ── */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5" data-purpose="kpi-metrics">
        {/* KPI 1: Total Orders */}
        <div className="bg-white rounded-xl p-3 border border-[#E7E2D8] shadow-2xs flex flex-col justify-between h-[104px] hover:shadow-xs transition-shadow">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#686E78]">
            <div className="w-5 h-5 rounded-md bg-[#E8F3F1] flex items-center justify-center text-[#104945]">
              <Package size={12} />
            </div>
            <span>Total Orders</span>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-[#111827] leading-none mb-1.5">
              {metrics.total ?? 929}
            </div>
            <span className="inline-block bg-[#D7EDE2] text-[#0E6245] text-[9.5px] font-bold px-1.5 py-0.5 rounded-full">
              +96% on September
            </span>
          </div>
        </div>

        {/* KPI 2: Orders in October */}
        <div className="bg-white rounded-xl p-3 border border-[#E7E2D8] shadow-2xs flex flex-col justify-between h-[104px] hover:shadow-xs transition-shadow">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#686E78]">
            <div className="w-5 h-5 rounded-md bg-[#E8F3F1] flex items-center justify-center text-[#104945]">
              <Package size={12} />
            </div>
            <span>Orders in October</span>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-[#111827] leading-none mb-1.5">
              {metrics.ordersMonth ?? 481}
            </div>
            <span className="inline-block bg-[#D7EDE2] text-[#0E6245] text-[9.5px] font-bold px-1.5 py-0.5 rounded-full">
              +96% on September
            </span>
          </div>
        </div>

        {/* KPI 3: Revenue in October */}
        <div className="bg-white rounded-xl p-3 border border-[#E7E2D8] shadow-2xs flex flex-col justify-between h-[104px] hover:shadow-xs transition-shadow">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#686E78]">
            <div className="w-5 h-5 rounded-md bg-[#E8F3F1] flex items-center justify-center text-[#104945]">
              <IndianRupee size={12} />
            </div>
            <span>Revenue in October</span>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-[#111827] leading-none mb-1.5 tracking-tight">
              {formatINR(metrics.revMonth ?? 46023)}
            </div>
            <span className="text-[9.5px] text-[#6B7280] font-medium">
              ₹{metrics.aovMonth ?? 96} an order
            </span>
          </div>
        </div>

        {/* KPI 4: Awaiting Confirmation / Paid, waiting to pack */}
        <div className="bg-white rounded-xl p-3 border border-[#E7E2D8] shadow-2xs flex flex-col justify-between h-[104px] hover:shadow-xs transition-shadow">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#686E78]">
            <div className="w-5 h-5 rounded-md bg-[#E8F3F1] flex items-center justify-center text-[#104945]">
              <Package size={12} />
            </div>
            <span>{activeTab === "returns" ? "Waiting to pack" : "Awaiting Confirmation"}</span>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-[#111827] leading-none mb-1.5">
              {metrics.awaiting ?? 297}
            </div>
            <span className="inline-block bg-[#F7E7CD] text-[#7A4B15] text-[9.5px] font-bold px-1.5 py-0.5 rounded-full">
              oldest 1 d ago
            </span>
          </div>
        </div>

        {/* KPI 5: In Transit / Returns to refund */}
        <div className="bg-white rounded-xl p-3 border border-[#E7E2D8] shadow-2xs flex flex-col justify-between h-[104px] hover:shadow-xs transition-shadow">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#686E78]">
            <div className="w-5 h-5 rounded-md bg-[#E8F3F1] flex items-center justify-center text-[#104945]">
              {activeTab === "returns" ? <RotateCcw size={12} /> : <Truck size={12} />}
            </div>
            <span>{activeTab === "returns" ? "Returns to refund" : "In Transit"}</span>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-[#111827] leading-none mb-1.5">
              {activeTab === "returns" ? (metrics.returnsCount ?? 2) : (metrics.inTransit ?? 2)}
            </div>
            <span className="inline-block bg-[#F7E7CD] text-[#7A4B15] text-[9.5px] font-bold px-1.5 py-0.5 rounded-full">
              ₹211 due
            </span>
          </div>
        </div>

        {/* KPI 6: Delivered */}
        <div className="bg-white rounded-xl p-3 border border-[#E7E2D8] shadow-2xs flex flex-col justify-between h-[104px] hover:shadow-xs transition-shadow">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#686E78]">
            <div className="w-5 h-5 rounded-md bg-[#E8F3F1] flex items-center justify-center text-[#104945]">
              <Check size={12} />
            </div>
            <span>Delivered</span>
          </div>
          <div>
            <div className="text-[22px] font-extrabold text-[#111827] leading-none mb-1.5">
              {metrics.delivered ?? 2}
            </div>
            <span className="inline-block bg-[#F7E7CD] text-[#7A4B15] text-[9.5px] font-bold px-1.5 py-0.5 rounded-full">
              ₹211 due
            </span>
          </div>
        </div>
      </section>

      {/* ── 4. Sub Navigation Tabs ── */}
      <div className="flex items-center gap-6 border-b border-[#D8D2C6] text-[12px] font-semibold pt-1" data-purpose="orders-sub-tabs">
        <button
          id="orders-tab-pack"
          onClick={() => onSwitchTab?.("pack")}
          type="button"
          className={`flex items-center gap-1.5 pb-2.5 transition-colors cursor-pointer ${
            activeTab === "pack"
              ? "text-[#111827] border-b-2 border-[#104945] font-bold"
              : "text-[#686E78] hover:text-[#111827] font-semibold"
          }`}
        >
          <span>To pack &amp; ship</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
            activeTab === "pack" ? "bg-[#D7EDE2] text-[#0E6245]" : "bg-[#E2DBD1] text-[#524C46]"
          }`}>
            {metrics.awaiting ?? 297}
          </span>
        </button>

        <button
          id="orders-tab-all"
          onClick={() => onSwitchTab?.("all")}
          type="button"
          className={`flex items-center gap-1.5 pb-2.5 transition-colors cursor-pointer ${
            activeTab === "all"
              ? "text-[#111827] border-b-2 border-[#104945] font-bold"
              : "text-[#686E78] hover:text-[#111827] font-semibold"
          }`}
        >
          <span>All orders</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
            activeTab === "all" ? "bg-[#104945]/10 text-[#104945]" : "bg-[#E2DBD1] text-[#524C46]"
          }`}>
            {metrics.total ?? 929}
          </span>
        </button>

        <button
          id="orders-tab-returns"
          onClick={() => onSwitchTab?.("returns")}
          type="button"
          className={`flex items-center gap-1.5 pb-2.5 transition-colors cursor-pointer ${
            activeTab === "returns"
              ? "text-[#111827] border-b-2 border-[#104945] font-bold"
              : "text-[#686E78] hover:text-[#111827] font-semibold"
          }`}
        >
          <span>Returns</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
            activeTab === "returns" ? "bg-[#D7EFE6] text-[#0A7347]" : "bg-[#E2DBD1] text-[#524C46]"
          }`}>
            {metrics.returnsCount ?? 2}
          </span>
        </button>
      </div>
    </div>
  )
}

export default memo(OrdersHubHeader)
