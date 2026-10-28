import React, { memo } from "react"
import {
  Download,
  UploadCloud,
  FileSpreadsheet,
  Plus,
  X,
  Moon,
  Bell,
  IndianRupee,
  ShoppingBag,
  Users,
  Calculator,
  Boxes,
  Package,
} from "lucide-react"
import { toast } from "react-toastify"

/* ── Pelago Design Tokens ── */
const FONT = "'Plus Jakarta Sans', 'Inter', sans-serif"

const DATE_RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "6m", label: "Last 6 Months" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
]

const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`

const formatINR = (n) =>
  `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`

const formatNum = (n) =>
  Number(n || 0).toLocaleString("en-IN")

/**
 * ProductsHubHeader — Common persistent header for Products Hub
 * Shared identically between ?view=catalog and ?view=analytics
 * Includes:
 *   - Date range selector pills (Today ... Custom)
 *   - Right live status pill, dark mode toggle, notification bell
 *   - Studio shop subtitle & "Products" title
 *   - Action buttons (Export, Quick CSV, Bulk ZIP, + New product)
 *   - 6 KPI metric cards (Catalog vs Analytics metrics)
 *   - Sub-tab buttons (Catalog {count} | Analytics {count})
 */
const ProductsHubHeader = ({
  activeTab = "catalog",
  onSwitchTab,
  dateRange = "all",
  setDateRange,
  customFrom = "",
  setCustomFrom,
  customTo = "",
  setCustomTo,
  catalogStats = {},
  analyticsStats = {},
  onExport,
  onQuickCsv,
  onBulkZip,
  onNewProduct,
  showAddForm = false,
}) => {
  return (
    <div style={{ fontFamily: FONT }} className="w-full flex flex-col text-[#171412] mb-2" data-purpose="products-hub-header">
      {/* ── Top Utility Filter Bar ── */}
      <header className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1 mb-4">
        {/* Date Pills Container & Custom Date Inputs */}
        <div className="flex flex-col gap-2">
          <nav className="inline-flex items-center bg-[#DDD7CD]/80 rounded-full p-1 text-[12px] font-medium text-[#524B41] max-w-fit overflow-x-auto no-scrollbar shadow-inner">
            {DATE_RANGES.map((r) => {
              const isActive =
                dateRange === r.key ||
                (activeTab === "analytics" && ((r.key === "30d" && dateRange === "month") || (r.key === "all" && dateRange === "")))
              return (
                <button
                  key={r.key}
                  onClick={() => setDateRange && setDateRange(r.key)}
                  className={`px-3 py-1 whitespace-nowrap rounded-full transition-all cursor-pointer ${
                    isActive
                      ? "bg-white text-[#1C1814] font-semibold shadow-sm"
                      : "hover:text-[#1F1C18]"
                  }`}
                  type="button"
                >
                  {r.label}
                </button>
              )
            })}
          </nav>

          {/* Custom Date Range Picker */}
          {dateRange === "custom" && (
            <div className="inline-flex flex-wrap items-center gap-2 bg-[#F6F3EE] border border-[#DDD6CB] rounded-xl px-3 py-1.5 text-xs text-[#524B41] max-w-fit shadow-xs">
              <span className="font-bold text-[#1C1814]">From:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom && setCustomFrom(e.target.value)}
                max={customTo || undefined}
                className="bg-white border border-[#D5CCC0] rounded-lg px-2.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[#104945]"
              />
              <span className="font-bold text-[#1C1814]">To:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo && setCustomTo(e.target.value)}
                min={customFrom || undefined}
                className="bg-white border border-[#D5CCC0] rounded-lg px-2.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-[#104945]"
              />
              {customFrom && customTo && new Date(customFrom) > new Date(customTo) && (
                <span className="text-[#B83E28] font-semibold text-[11px]">Start date must be before end date</span>
              )}
            </div>
          )}
        </div>

        {/* Right Quick Actions */}
        <div className="flex items-center gap-2 self-end md:self-auto">
          {/* Active orders pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#DDD7CD]/80 rounded-full text-[12px] font-semibold text-[#1C1917]">
            <span className="w-2 h-2 rounded-full bg-[#115E59] animate-pulse"></span>
            <span>{analyticsStats?.todayCount ?? 0} today</span>
            <span className="text-[#787166] font-normal">{formatINR(analyticsStats?.todayRev ?? 0)}</span>
          </div>

          {/* Moon mode toggle */}
          <button
            type="button"
            onClick={() => toast.info("Dark mode toggled.")}
            className="w-8 h-8 rounded-full bg-[#DDD7CD]/80 flex items-center justify-center text-[#554E44] hover:bg-white hover:text-black transition-colors cursor-pointer"
            title="Dark mode"
          >
            <Moon size={15} />
          </button>

          {/* Notification bell */}
          <button
            type="button"
            onClick={() => toast.info("No unread product notifications.")}
            className="w-8 h-8 rounded-full bg-[#DDD7CD]/80 flex items-center justify-center text-[#554E44] hover:bg-white hover:text-black transition-colors relative cursor-pointer"
            title="Notifications"
          >
            <Bell size={15} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[#E1432E] rounded-full ring-2 ring-white"></span>
          </button>
        </div>
      </header>

      {/* ── Page Title & Primary Action Buttons ── */}
      <section className="flex flex-wrap items-end justify-between gap-4 pt-1 mb-4" data-purpose="header-section">
        <div>
          <p className="text-[11px] font-medium text-[#7C746A]">
            Fernhill Ceramics · thrown, glazed and fired on Quay Street
          </p>
          <h2 className="text-3xl font-extrabold text-[#111C17] tracking-tight">Products</h2>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Export Button */}
          <button
            id="products-export-btn"
            onClick={onExport}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#FBF9F5] border border-[#D5CCC0] rounded-full text-[13px] font-semibold text-[#1C1814] hover:bg-white shadow-sm transition-all cursor-pointer"
            type="button"
          >
            <Download size={14} className="text-stone-500" />
            <span>Export</span>
          </button>

          {/* Quick CSV & Bulk ZIP Buttons (Visible on Catalog tab) */}
          {activeTab === "catalog" && (
            <>
              <button
                id="products-quick-csv-btn"
                onClick={onQuickCsv}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#FBF9F5] border border-[#D5CCC0] rounded-full text-[13px] font-semibold text-[#1C1814] hover:bg-white shadow-sm transition-all cursor-pointer"
                type="button"
              >
                <UploadCloud size={14} className="text-stone-500" />
                <span>Quick CSV</span>
              </button>

              <button
                id="products-bulk-zip-btn"
                onClick={onBulkZip}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#FBF9F5] border border-[#D5CCC0] rounded-full text-[13px] font-semibold text-[#1C1814] hover:bg-white shadow-sm transition-all cursor-pointer"
                type="button"
              >
                <FileSpreadsheet size={14} className="text-stone-500" />
                <span>Bulk ZIP</span>
              </button>
            </>
          )}

          {/* New Product Button */}
          <button
            id="products-new-product-btn"
            onClick={onNewProduct}
            className={`flex items-center gap-1 px-4 py-2 rounded-full text-[13px] font-bold text-white shadow-sm transition-all cursor-pointer ${
              showAddForm ? "bg-[#B83E28] hover:bg-[#96301E]" : "bg-[#103D37] hover:bg-[#0c312c]"
            }`}
            type="button"
          >
            {showAddForm ? <X size={14} /> : <span className="text-base leading-none mb-0.5">+</span>}
            <span>{showAddForm ? "Close Form" : "New product"}</span>
          </button>
        </div>
      </section>

      {/* ── KPI Metrics Strip (6 cards) ── */}
      <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-4" data-purpose="kpi-metric-cards">
        {activeTab === "catalog" ? (
          <>
            {/* 1. Active products */}
            <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                <span className="text-[#157A6E]">💧</span>
                <span>Active products</span>
              </div>
              <div className="text-2xl font-black text-[#141C18] mt-1.5 leading-tight">
                {catalogStats?.total ?? 32}
              </div>
              <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">all in the shop</div>
            </div>

            {/* 2. Active Categories */}
            <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                <span className="text-[#157A6E]">💧</span>
                <span>Active Categories</span>
              </div>
              <div className="text-2xl font-black text-[#141C18] mt-1.5 leading-tight">
                {catalogStats?.activeCategories ?? 7}
              </div>
              <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">all in the shop</div>
            </div>

            {/* 3. Low on stock */}
            <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-[#6E665B]">
                <span>⚠️!</span>
                <span className="ml-0.5">Low on stock</span>
              </div>
              <div className="flex items-baseline gap-2 mt-1.5">
                <span className="text-2xl font-black text-[#141C18] leading-tight">
                  {catalogStats?.lowStock ?? 0}
                </span>
                <span className="bg-[#F9EDCF] text-[#9A620E] text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                  14 not booked
                </span>
              </div>
              <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">attention required</div>
            </div>

            {/* 4. Out of Stock */}
            <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                <span className="text-[#787167]">🏺</span>
                <span>Out of Stock</span>
              </div>
              <div className={`text-2xl font-black mt-1.5 leading-tight ${catalogStats?.outStock > 0 ? "text-[#B83E28]" : "text-[#141C18]"}`}>
                {catalogStats?.outStock ?? 0}
              </div>
              <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">next Oct 22</div>
            </div>

            {/* 5. Added This Month */}
            <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                <span className="text-[#157A6E]">💧</span>
                <span>Added This Month</span>
              </div>
              <div className="text-2xl font-black text-[#141C18] mt-1.5 leading-tight">
                {catalogStats?.addedThisMonth ?? 3}
              </div>
              <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">all in the shop</div>
            </div>

            {/* 6. Stock value, at cost */}
            <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                <span>📦</span>
                <span>Stock value, at cost</span>
              </div>
              <div className="text-2xl font-black text-[#141C18] mt-1.5 leading-tight">
                {money(catalogStats?.totalStockValue ?? 1582408.2)}
              </div>
              <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">
                {catalogStats?.total ?? 32} items
              </div>
            </div>
          </>
        ) : (
          <>
            {/* 1. Total Revenue */}
            <div className="bg-white border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#78716A]">
                <IndianRupee size={14} className="text-[#0F3D39]" />
                <span>Total Revenue</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black tracking-tight text-[#111817]">
                  {formatINR(analyticsStats?.revenue ?? 0)}
                </span>
                <p className="text-[10px] text-[#A0988F] mt-0.5">all in the shop</p>
              </div>
            </div>

            {/* 2. Total Orders */}
            <div className="bg-white border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#78716A]">
                <ShoppingBag size={14} className="text-[#78716A]" />
                <span>Total Orders</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black tracking-tight text-[#111817]">
                  {formatNum(analyticsStats?.orders ?? 0)}
                </span>
                <p className="text-[10px] text-[#A0988F] mt-0.5">Orders</p>
              </div>
            </div>

            {/* 3. Total Customers */}
            <div className="bg-white border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#78716A]">
                <Users size={14} className="text-[#78716A]" />
                <span>Total Customers</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black tracking-tight text-[#111817]">
                  {formatNum(analyticsStats?.customers ?? 0)}
                </span>
                <p className="text-[10px] text-[#A0988F] mt-0.5">Customers</p>
              </div>
            </div>

            {/* 4. AOV */}
            <div className="bg-white border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#78716A]">
                <Calculator size={14} className="text-[#78716A]" />
                <span>AOV</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black tracking-tight text-[#111817]">
                  {formatINR(analyticsStats?.aov ?? 0)}
                </span>
                <p className="text-[10px] text-[#A0988F] mt-0.5">Average Order Value</p>
              </div>
            </div>

            {/* 5. Products Sold */}
            <div className="bg-white border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#78716A]">
                <Boxes size={14} className="text-[#78716A]" />
                <span>Products Sold</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black tracking-tight text-[#111817]">
                  {formatNum(analyticsStats?.productsSold ?? 0)}
                </span>
                <p className="text-[10px] text-[#A0988F] mt-0.5">Units Sold</p>
              </div>
            </div>

            {/* 6. Active Products */}
            <div className="bg-white border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#78716A]">
                <Package size={14} className="text-[#78716A]" />
                <span>Active Products</span>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black tracking-tight text-[#111817]">
                  {analyticsStats?.activeProducts ?? 0}
                </span>
                <p className="text-[10px] text-[#A0988F] mt-0.5">Catalog SKUs</p>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Sub-Tabs Bar: Catalog vs Analytics ── */}
      <div className="flex items-center gap-6 border-b border-[#DDD5C9] pt-1 mb-4" data-purpose="sub-tabs-bar">
        <button
          id="tab-btn-catalog"
          onClick={() => onSwitchTab?.("catalog")}
          className={`flex items-center gap-1.5 pb-2.5 cursor-pointer transition-colors ${
            activeTab === "catalog"
              ? "border-b-2 border-[#103D37] font-bold text-[14px] text-[#131D18]"
              : "font-medium text-[14px] text-[#716A60] hover:text-[#1C1814]"
          }`}
          type="button"
        >
          <span>Catalog</span>
          <span className="text-xs bg-[#DDD7CD] text-[#4A443A] font-medium px-2 py-0.5 rounded-full leading-none">
            {catalogStats?.total ?? 32}
          </span>
        </button>
        <button
          id="tab-btn-analytics"
          onClick={() => onSwitchTab?.("analytics")}
          className={`flex items-center gap-1.5 pb-2.5 cursor-pointer transition-colors ${
            activeTab === "analytics"
              ? "border-b-2 border-[#103D37] font-bold text-[14px] text-[#131D18]"
              : "font-medium text-[14px] text-[#716A60] hover:text-[#1C1814]"
          }`}
          type="button"
        >
          <span>Analytics</span>
          <span className="text-xs bg-[#DDD7CD] text-[#4A443A] font-medium px-2 py-0.5 rounded-full leading-none">
            {analyticsStats?.activeProducts ?? 20}
          </span>
        </button>
      </div>
    </div>
  )
}

export default memo(ProductsHubHeader)
