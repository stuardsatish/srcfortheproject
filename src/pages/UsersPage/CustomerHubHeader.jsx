import React, { memo } from "react"
import {
  Users,
  ShoppingBag,
  IndianRupee,
  Package,
  Sparkles,
  Download,
  Plus,
  Moon,
  Bell,
} from "lucide-react"
import { toast } from "react-toastify"

/* ── Pelago design tokens ── */
const FONT = "'Plus Jakarta Sans', sans-serif"

const DATE_RANGES = [
  "Today",
  "Last 7 Days",
  "Last 30 Days",
  "Last 90 Days",
  "Last 6 Months",
  "All Time",
  "Custom",
]

const formatINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`

/**
 * CustomerHubHeader — Common persistent header for Customers Hub
 * Shared identically between ?view=everyone and ?view=analytics
 * Includes:
 *   - Date range selector pills
 *   - Live counter indicator, dark mode button, alerts notification bell
 *   - Studio shop subtitle & "Customers" title
 *   - "Export" and "+ New customer" buttons
 *   - 6 KPI metric cards
 *   - Sub-tab buttons (Everyone {totalUsers} | Analytics)
 */
const CustomerHubHeader = ({
  activeTab = "everyone",
  onSwitchTab,
  metrics = {},
  activeDateRange = "Today",
  setActiveDateRange,
  customFrom = "",
  setCustomFrom,
  customTo = "",
  setCustomTo,
  onExport,
  onNewCustomer,
}) => {
  return (
    <div style={{ fontFamily: FONT }} className="w-full flex flex-col space-y-5 text-[#1C1917]" data-purpose="customer-hub-header">
      {/* ── Top Utility Filter Bar ── */}
      <header className="flex items-center justify-between flex-wrap gap-4 pt-1" data-purpose="date-filter-control">
        {/* Date Range Filter Segmented Control & Custom Date Pickers */}
        <div className="flex flex-col gap-2">
          <nav className="inline-flex items-center bg-[#E4DDD4] p-1 rounded-xl text-[12px] font-medium text-[#78716C] space-x-0.5">
            {DATE_RANGES.map((range) => {
              const isActive = activeDateRange === range
              return (
                <button
                  key={range}
                  onClick={() => setActiveDateRange && setActiveDateRange(range)}
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

          {/* Custom Date Range Picker */}
          {activeDateRange === "Custom" && (
            <div className="inline-flex flex-wrap items-center gap-2 bg-[#F6F3EE] border border-[#DDD6CB] rounded-xl px-3 py-1.5 text-xs text-[#524B41] max-w-fit shadow-xs">
              <span className="font-bold text-[#1C1814]">From:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom && setCustomFrom(e.target.value)}
                max={customTo || undefined}
                className="bg-white border border-[#D5CCC0] rounded-lg px-2.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[#0F4C4C]"
              />
              <span className="font-bold text-[#1C1814]">To:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo && setCustomTo(e.target.value)}
                min={customFrom || undefined}
                className="bg-white border border-[#D5CCC0] rounded-lg px-2.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[#0F4C4C]"
              />
              {customFrom && customTo && new Date(customFrom) > new Date(customTo) && (
                <span className="text-[#B83E28] font-semibold text-[11px]">Start date must be before end date</span>
              )}
            </div>
          )}
        </div>

        {/* Right Utility Actions (Live counter, theme, alerts) */}
        <div className="flex items-center space-x-3">
          {/* Live Counter Indicator */}
          <div className="flex items-center space-x-2 bg-transparent text-[12px] font-medium text-[#44403C] px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-[#1B4D3E] animate-pulse"></span>
            <span>
              <strong className="font-bold text-[#171412]">{metrics.todayCount ?? 396}</strong> today{" "}
              <span className="text-[#78716C]">₹{metrics.todayRev ?? 25}k</span>
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
            id="hub-export-btn"
            onClick={onExport}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#D8D2C9] text-[12.5px] font-semibold text-[#171412] shadow-sm hover:bg-stone-50 transition-colors cursor-pointer"
            type="button"
          >
            <Download className="w-4 h-4 text-[#78716C]" />
            <span>Export</span>
          </button>

          {/* New Customer Button */}
          <button
            id="hub-new-customer-btn"
            onClick={onNewCustomer}
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
            <div className="text-2xl font-bold text-[#171412] tracking-tight">{metrics.totalUsers ?? 0}</div>
            <div className="text-[11px] text-[#78716C] mt-0.5">{metrics.usersSubtitle || "200% vs prev"}</div>
          </div>
        </div>

        {/* Card 2: Total Orders */}
        <div className="bg-white rounded-2xl p-4 border border-[#E6E0D8] shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-2 text-[12px] font-medium text-[#78716C]">
            <ShoppingBag className="w-4 h-4 text-[#78716C]" />
            <span>Total Orders</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#171412] tracking-tight">{metrics.totalOrders ?? 0}</div>
            <div className="text-[11px] text-[#78716C] mt-0.5">{metrics.ordersSubtitle || "300%"}</div>
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
                : formatINR(metrics.totalRevenue ?? 0)}
            </div>
            <div className="text-[11px] text-[#78716C] mt-0.5">{metrics.revenueSubtitle || "322%"}</div>
          </div>
        </div>

        {/* Card 4: AOV */}
        <div className="bg-white rounded-2xl p-4 border border-[#E6E0D8] shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-2 text-[12px] font-medium text-[#78716C]">
            <Package className="w-4 h-4 text-[#78716C]" />
            <span>AOV</span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#171412] tracking-tight">{formatINR(metrics.aov ?? 0)}</div>
            <div className="text-[11px] text-[#78716C] mt-0.5">{metrics.aovSubtitle || "5%"}</div>
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
              {metrics.topSpender?.name || "None in period"}
            </div>
            <div className="mt-1">
              <span className="inline-block bg-[#E0F0EB] text-[#0F4C4C] text-[10.5px] font-semibold px-2 py-0.5 rounded">
                Spent {formatINR(metrics.topSpender?.periodSpent ?? metrics.topSpender?.totalSpent ?? 0)}
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
              {metrics.activeUserDisplay || formatINR(metrics.activeUsersSpend ?? (metrics.activeUsersCount > 0 ? metrics.activeUsersCount * 732 : 0))}
            </div>
            <div className="text-[11px] text-[#78716C] mt-0.5">
              {metrics.activeUserSubtitle || `${metrics.retentionPct ?? 100}% Retention`}
            </div>
          </div>
        </div>
      </section>
      {/* ── END: 6 KPI Metric Cards Grid ── */}

      {/* ── Sub-Tabs Bar: Everyone vs Analytics ── */}
      <div className="border-b border-[#D8D2C9] flex items-center space-x-6 text-[13px] font-semibold pt-1">
        <button
          id="tab-btn-everyone"
          onClick={() => onSwitchTab && onSwitchTab("everyone")}
          className={`pb-2.5 flex items-center space-x-2 cursor-pointer transition-colors ${
            activeTab === "everyone"
              ? "border-b-2 border-[#0F4C4C] text-[#0F4C4C] font-bold"
              : "text-[#78716C] hover:text-[#171412]"
          }`}
          type="button"
        >
          <span>Everyone</span>
          <span className="bg-[#DDF0EB] text-[#0F4C4C] text-[11px] font-bold px-2 py-0.5 rounded-full">
            {metrics.everyoneTotalUsers ?? metrics.allCustomersCount ?? 35}
          </span>
        </button>
        <button
          id="tab-btn-analytics"
          onClick={() => onSwitchTab && onSwitchTab("analytics")}
          className={`pb-2.5 cursor-pointer transition-colors ${
            activeTab === "analytics"
              ? "border-b-2 border-[#0F4C4C] text-[#0F4C4C] font-bold"
              : "text-[#78716C] hover:text-[#171412]"
          }`}
          type="button"
        >
          Analytics
        </button>
      </div>
    </div>
  )
}

export default memo(CustomerHubHeader)
