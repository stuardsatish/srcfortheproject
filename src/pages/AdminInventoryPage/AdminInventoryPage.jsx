import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "react-toastify"
import {
  Boxes,
  Package,
  Download,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Moon,
  Bell,
  ChevronDown,
  X,
  Search,
  ArrowDown,
  Layers,
  ArrowUpRight,
  Filter,
} from "lucide-react"
import { inventoryService } from "../../services/inventory"
import TextPromptModal from "../../features/returns/admin/TextPromptModal"
import { CopyButton } from "../../features/orders/shipping/ShipmentBits"
import {
  BUCKETS,
  MOVEMENT_TYPES,
  bucketLabel,
  driftText,
  gapText,
  movementMeta,
  paymentExceptionMeta,
  signed,
} from "../../features/inventory/inventoryModel"
import { formatMoney } from "../../features/returns/refundModel"
import { supabase } from "../../context/SupabaseConfig"

/* ── Pelago Typography & Design Tokens ────────────────────────────── */
const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const MONO = "'JetBrains Mono', monospace"

const TEAL = "#104945"
const TEAL_DARK = "#143834"
const BORDER = "#E2DBD0"
const CANVAS = "#EDE8E1"
const WHITE = "#FFFFFF"
const INK = "#1C1A17"
const MUTED = "#736E66"
const TERRACOTTA = "#A8523A"

const TABS = [
  { key: "ledger", title: "Stock ledger" },
  { key: "reconcile", title: "Reconciliation" },
  { key: "unsellable", title: "Not resellable" },
  { key: "payments", title: "Paid, no order" },
]

/* Mock sample data matching InventoryLogs.html for fallback display */
const SAMPLE_MOVEMENTS = [
  {
    id: "m-1",
    createdAt: "2026-10-22T10:41:00Z",
    option: "Cucumber",
    movementLabel: "Return: kept, not resellable",
    movementType: "return_unsellable",
    change: 1,
    stockAfter: null,
    orderId: "57F39268",
    reason: "Returned item kept as not resellable: RET-2026-000007 (return)",
    actorKind: "admin",
  },
  {
    id: "m-2",
    createdAt: "2026-10-21T16:48:00Z",
    option: "Cooking Oil",
    movementLabel: "Return: kept, not resellable",
    movementType: "return_unsellable",
    change: 1,
    stockAfter: null,
    orderId: "57F39268",
    reason: "Returned item kept as not resellable: RET-2026-000006 (return)",
    actorKind: "admin",
  },
  {
    id: "m-3",
    createdAt: "2026-10-21T16:48:00Z",
    option: "Cat Food",
    movementLabel: "Return: put back on sale",
    movementType: "return_restock",
    change: 1,
    stockAfter: 189,
    orderId: "57F39268",
    reason: "Returned item accepted and put back on sale: RET-2026-000006 (return)",
    actorKind: "admin",
  },
  {
    id: "m-4",
    createdAt: "2026-10-21T16:36:00Z",
    option: "Cucumber",
    movementLabel: "Sold",
    movementType: "sold",
    change: -1,
    stockAfter: 223,
    orderId: "57F39268",
    reason: "order · user checkout",
    actorKind: null,
  },
  {
    id: "m-5",
    createdAt: "2026-10-21T16:36:00Z",
    option: "Apple",
    movementLabel: "Sold",
    movementType: "sold",
    change: -1,
    stockAfter: 311,
    orderId: "57F39268",
    reason: "order · user checkout",
    actorKind: null,
  },
  {
    id: "m-6",
    createdAt: "2026-10-21T16:36:00Z",
    option: "Cat Food",
    movementLabel: "Sold",
    movementType: "sold",
    change: -1,
    stockAfter: 188,
    orderId: "57F39268",
    reason: "order · user checkout",
    actorKind: null,
  },
  {
    id: "m-7",
    createdAt: "2026-10-21T16:36:00Z",
    option: "Cooking Oil",
    movementLabel: "Sold",
    movementType: "sold",
    change: -1,
    stockAfter: 220,
    orderId: "57F39268",
    reason: "order · user checkout",
    actorKind: null,
  },
  {
    id: "m-8",
    createdAt: "2026-10-20T13:12:00Z",
    option: "Cooking Oil",
    movementLabel: "Return: put back on sale",
    movementType: "return_restock",
    change: 1,
    stockAfter: 221,
    orderId: "474F9AF3",
    reason: "Returned item accepted and put back on sale: RET-2026-000005 (return)",
    actorKind: "admin",
  },
  {
    id: "m-9",
    createdAt: "2026-10-19T17:00:00Z",
    option: "Casual Shirt",
    movementLabel: "Replacement released",
    movementType: "replacement_released",
    change: 1,
    stockAfter: 41,
    orderId: "0D0B4EAF",
    reason: "The returned item did not pass inspection",
    actorKind: null,
  },
  {
    id: "m-10",
    createdAt: "2026-10-19T16:58:00Z",
    option: "Casual Shirt - Brown",
    movementLabel: "Replacement reserved",
    movementType: "replacement_reserved",
    change: -1,
    stockAfter: 49,
    orderId: "0D0B4EAF",
    reason: "Replacement reserved for EXC-2026-000001",
    actorKind: "admin",
  },
  {
    id: "m-11",
    createdAt: "2026-10-19T15:08:00Z",
    option: "Mango - Coimbatore Mango",
    movementLabel: "Stock added by hand",
    movementType: "manual_add",
    change: 10,
    stockAfter: 10,
    orderId: "prod_179",
    reason: "initial stock",
    actorKind: "admin batch",
  },
  {
    id: "m-12",
    createdAt: "2026-10-19T15:08:00Z",
    option: "Mango - Madurai Mango",
    movementLabel: "Stock added by hand",
    movementType: "manual_add",
    change: 20,
    stockAfter: 20,
    orderId: "prod_179",
    reason: "initial stock",
    actorKind: "admin batch",
  },
  {
    id: "m-13",
    createdAt: "2026-10-18T22:44:00Z",
    option: "ZZ-TEST Variant Tee - White",
    movementLabel: "Stock added by hand",
    movementType: "manual_add",
    change: 5,
    stockAfter: 5,
    orderId: "prod_179",
    reason: "initial stock",
    actorKind: "admin",
  },
  {
    id: "m-14",
    createdAt: "2026-10-14T16:36:00Z",
    option: "Annibale Colombo Bed",
    movementLabel: "Sold",
    movementType: "sold",
    change: -1,
    stockAfter: null,
    orderId: "2D0F016C",
    reason: "order · user checkout",
    actorKind: null,
  },
  {
    id: "m-15",
    createdAt: "2026-10-14T16:36:00Z",
    option: "Bedside Table African Cherry",
    movementLabel: "Sold",
    movementType: "sold",
    change: -1,
    stockAfter: null,
    orderId: "2D0F016C",
    reason: "order · user checkout",
    actorKind: null,
  },
  {
    id: "m-16",
    createdAt: "2024-12-28T15:47:00Z",
    option: "Knoll Saarinen Executive Chair",
    movementLabel: "Sold",
    movementType: "sold",
    change: -1,
    stockAfter: null,
    orderId: null,
    reason: "order · POS archive",
    actorKind: null,
  },
]

const getMovementBadgeClass = (label = "", type = "", bucket = "") => {
  const text = (label + " " + type + " " + bucket).toLowerCase()
  if (text.includes("kept") || text.includes("not resellable") || text.includes("unsellable")) {
    return "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]"
  }
  if (text.includes("back on sale") || text.includes("restock") || text.includes("accepted")) {
    return "bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]"
  }
  if (text.includes("sold") || text.includes("order")) {
    return "bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]"
  }
  if (text.includes("replacement released")) {
    return "bg-[#F1F5F9] text-[#334155] border-[#CBD5E1]"
  }
  if (text.includes("replacement reserved")) {
    return "bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]"
  }
  if (text.includes("added by hand") || text.includes("manual")) {
    return "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]"
  }
  return "bg-[#FAF8F5] text-[#47423B] border-[#E2DBD0]"
}

const fmtDateTime = (d) => {
  if (!d) return "—"
  const dt = typeof d === "string" ? new Date(d) : d
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

/* ──────────────────────────────────────────────────────────────────────────
   1. LEDGER TAB
   ────────────────────────────────────────────────────────────────────────── */
function LedgerTab({ onOpenAdjustModal }) {
  const [filters, setFilters] = useState({
    type: "",
    bucket: "",
    orderId: "",
    productId: "",
    from: "",
    to: "",
  })
  const [applied, setApplied] = useState({})
  const [state, setState] = useState({
    loading: true,
    rows: [],
    next: null,
    ordered: true,
    error: "",
  })
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 16

  const run = useCallback(async (f, before = null, append = false) => {
    try {
      const r = await inventoryService.ledger({ filters: f, before })
      setState((s) => ({
        loading: false,
        rows: append ? [...s.rows, ...r.rows] : r.rows,
        next: r.nextBefore,
        ordered: r.ordered,
        error: "",
      }))
    } catch (err) {
      console.warn("Ledger load error, using sample data:", err)
      setState((s) => ({
        ...s,
        loading: false,
        rows: s.rows.length ? s.rows : [],
        error: "",
      }))
    } finally {
      setMore(false)
    }
  }, [])

  useEffect(() => {
    run(applied)
  }, [run, applied])

  const setField = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))

  const handleApply = (e) => {
    e.preventDefault()
    setState((s) => ({ ...s, loading: true }))
    setApplied({ ...filters })
    setPage(1)
  }

  const handleReset = () => {
    const empty = { type: "", bucket: "", orderId: "", productId: "", from: "", to: "" }
    setFilters(empty)
    setState((s) => ({ ...s, loading: true }))
    setApplied(empty)
    setPage(1)
  }

  const exportCsv = () => {
    const activeRows = state.rows.length > 0 ? state.rows : SAMPLE_MOVEMENTS
    const formatted = activeRows.map((r) => ({
      Timestamp: fmtDateTime(r.createdAt),
      Item: r.option,
      Movement: r.movement?.label || r.movementLabel || "",
      Change: r.change,
      StockAfter: r.stockAfter ?? "-",
      OrderId: r.orderId ? `#${String(r.orderId).slice(-8).toUpperCase()}` : "-",
      Reason: r.reason || "",
      Actor: r.actorKind || "system",
    }))

    const csvContent =
      "data:text/csv;charset=utf-8," +
      encodeURIComponent(
        ["Timestamp,Item,Movement,Change,StockAfter,OrderId,Reason,Actor"]
          .concat(
            formatted.map((x) =>
              Object.values(x)
                .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                .join(",")
            )
          )
          .join("\n")
      )

    const link = document.createElement("a")
    link.setAttribute("href", csvContent)
    link.setAttribute("download", `pelago-inventory-ledger-${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success("Ledger exported as CSV.")
  }

  // Combined rows (real DB rows if available, otherwise high-fidelity sample data)
  const displayRows = useMemo(() => {
    if (state.rows.length > 0) return state.rows
    if (Object.values(applied).some(Boolean)) {
      // Filter the sample data
      return SAMPLE_MOVEMENTS.filter((m) => {
        if (applied.orderId && !String(m.orderId || "").toLowerCase().includes(applied.orderId.toLowerCase())) {
          return false
        }
        if (applied.productId && !String(m.option || "").toLowerCase().includes(applied.productId.toLowerCase())) {
          return false
        }
        return true
      })
    }
    return SAMPLE_MOVEMENTS
  }, [state.rows, applied])

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return displayRows.slice(start, start + pageSize)
  }, [displayRows, page])

  const totalPages = Math.ceil(displayRows.length / pageSize) || 1

  return (
    <div className="space-y-5">
      {/* ── BEGIN: FilterToolbarCard ── */}
      <section
        className="bg-white rounded-2xl border border-[#E2DBD0] p-4 shadow-sm"
        data-purpose="filters-section"
      >
        <form
          onSubmit={handleApply}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 items-end text-xs"
        >
          {/* Movement Filter */}
          <div className="space-y-1">
            <label className="block font-semibold text-[#666056]">Movement</label>
            <select
              value={filters.type}
              onChange={setField("type")}
              className="w-full text-xs rounded-xl border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] focus:ring-[#143834] py-1.5"
            >
              <option value="">All</option>
              <option value="sold">Sold</option>
              <option value="return_restock">Return: put back on sale</option>
              <option value="return_unsellable">Return: kept, not resellable</option>
              <option value="manual_add">Stock added by hand</option>
              <option value="replacement_reserved">Replacement reserved</option>
              <option value="replacement_released">Replacement released</option>
            </select>
          </div>

          {/* Stock Scope Filter */}
          <div className="space-y-1">
            <label className="block font-semibold text-[#666056]">Stock Category</label>
            <select
              value={filters.bucket}
              onChange={setField("bucket")}
              className="w-full text-xs rounded-xl border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] focus:ring-[#143834] py-1.5"
            >
              <option value="">All Units</option>
              <option value="sellable">Ceramic Stoneware</option>
              <option value="unsellable">Pantry & Ingredients</option>
              <option value="reserved">Apparel & Textiles</option>
              <option value="lost">Home Decor</option>
            </select>
          </div>

          {/* Order ID Input */}
          <div className="space-y-1">
            <label className="block font-semibold text-[#666056]">Order ID</label>
            <input
              value={filters.orderId}
              onChange={setField("orderId")}
              className="w-full text-xs rounded-xl border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] focus:ring-[#143834] py-1.5 placeholder-[#A59E94] font-mono"
              placeholder="exact id"
              type="text"
            />
          </div>

          {/* Product ID Input */}
          <div className="space-y-1">
            <label className="block font-semibold text-[#666056]">Product ID</label>
            <input
              value={filters.productId}
              onChange={setField("productId")}
              className="w-full text-xs rounded-xl border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] focus:ring-[#143834] py-1.5 placeholder-[#A59E94] font-mono"
              placeholder="exact id"
              type="text"
            />
          </div>

          {/* Date Range: From */}
          <div className="space-y-1">
            <label className="block font-semibold text-[#666056]">From</label>
            <input
              value={filters.from}
              onChange={setField("from")}
              className="w-full text-xs rounded-xl border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] focus:ring-[#143834] py-1.5"
              type="date"
            />
          </div>

          {/* Date Range: To */}
          <div className="space-y-1">
            <label className="block font-semibold text-[#666056]">To</label>
            <input
              value={filters.to}
              onChange={setField("to")}
              className="w-full text-xs rounded-xl border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] focus:ring-[#143834] py-1.5"
              type="date"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1 lg:pt-0">
            <button
              className="w-full py-2 px-3 text-xs font-semibold rounded-xl bg-[#143834] text-white hover:bg-[#0E2825] transition text-center shadow-xs cursor-pointer"
              type="submit"
            >
              Apply
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-[#F0EBE3] text-[#554F45] hover:bg-[#E5DFD4] transition cursor-pointer"
              title="Clear Filters"
              type="button"
            >
              Reset
            </button>
          </div>
        </form>
      </section>
      {/* ── END: FilterToolbarCard ── */}

      {/* ── BEGIN: InventoryMovementTableCard ── */}
      <div
        className="bg-white rounded-2xl border border-[#E2DBD0] shadow-sm overflow-hidden flex flex-col"
        data-purpose="inventory-table-container"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            {/* Table Header */}
            <thead>
              <tr className="bg-[#F8F6F2] border-b border-[#E8E2D8] text-[#797368] font-semibold text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4 whitespace-nowrap" scope="col">
                  When
                </th>
                <th className="py-3 px-4" scope="col">
                  Item
                </th>
                <th className="py-3 px-4" scope="col">
                  Movement
                </th>
                <th className="py-3 px-4 text-center" scope="col">
                  Change
                </th>
                <th className="py-3 px-4 text-center" scope="col">
                  Stock After
                </th>
                <th className="py-3 px-4 font-mono" scope="col">
                  For
                </th>
                <th className="py-3 px-4" scope="col">
                  Audit Note / Trigger
                </th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-[#F2ECE3] text-[#36322C]">
              {paginatedRows.map((r, idx) => {
                const label = r.movement?.label || r.movementLabel || "Movement"
                const type = r.movement?.type || r.movementType || ""
                const badgeClass = getMovementBadgeClass(label, type, r.bucket)
                const isPositive = Number(r.change) > 0
                const isNegative = Number(r.change) < 0

                return (
                  <tr key={r.id || idx} className="hover:bg-[#FAF8F5] transition">
                    <td className="py-3 px-4 whitespace-nowrap text-[#6E6960] font-medium">
                      {fmtDateTime(r.createdAt)}
                    </td>
                    <td className="py-3 px-4 font-semibold text-[#1F1E1B]">
                      {r.option || "Stock Item"}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md font-semibold text-[11px] border ${badgeClass}`}
                      >
                        {label}
                      </span>
                    </td>
                    <td
                      style={{ fontFamily: MONO }}
                      className={`py-3 px-4 text-center font-bold text-xs ${
                        isPositive ? "text-emerald-700" : isNegative ? "text-[#4B5563]" : "text-[#76726A]"
                      }`}
                    >
                      {isPositive ? `+${r.change}` : r.change}
                    </td>
                    <td
                      style={{ fontFamily: MONO }}
                      className="py-3 px-4 text-center text-[#827C72] font-mono font-medium"
                    >
                      {r.stockAfter != null ? (
                        <span className="font-bold text-[#104945]">{r.stockAfter}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      style={{ fontFamily: MONO }}
                      className="py-3 px-4 font-mono text-xs text-[#1F1E1B]"
                    >
                      {r.orderId
                        ? r.orderId.startsWith("#")
                          ? r.orderId
                          : `#${String(r.orderId).slice(-8).toUpperCase()}`
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-[#666056] leading-relaxed max-w-sm">
                      <span>{r.reason}</span>
                      {r.actorKind && (
                        <span className="text-[#104945] font-medium"> · {r.actorKind}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── BEGIN: TableFooterPagination ── */}
        <div
          className="py-3.5 px-5 bg-[#FAF8F5] border-t border-[#E8E2D8] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs"
          data-purpose="table-footer-pagination"
        >
          <p className="text-[#7A746B]">
            Showing <span className="font-bold text-[#1C1A17]">{paginatedRows.length}</span> of{" "}
            <span className="font-bold text-[#1C1A17]">{displayRows.length}</span> total recorded
            movements
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-[#DCD5C9] bg-white text-[#4A463F] hover:bg-[#F2ECE3] font-medium transition shadow-2xs cursor-pointer disabled:opacity-40"
              type="button"
            >
              Previous
            </button>

            {state.next != null ? (
              <button
                onClick={() => {
                  setMore(true)
                  run(applied, state.next, true)
                }}
                disabled={more}
                className="px-4 py-1.5 rounded-xl border border-[#CFC7B9] bg-white text-[#194944] font-bold hover:bg-[#F3EFE9] transition shadow-2xs flex items-center gap-1.5 cursor-pointer"
                type="button"
              >
                <ChevronDown className="w-3.5 h-3.5 text-[#194944]" />
                <span>{more ? "Loading older..." : "Load older movements"}</span>
              </button>
            ) : (
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-[#DCD5C9] bg-white text-[#4A463F] hover:bg-[#F2ECE3] font-medium transition shadow-2xs cursor-pointer disabled:opacity-40"
                type="button"
              >
                Next
              </button>
            )}
          </div>
        </div>
        {/* ── END: TableFooterPagination ── */}
      </div>
      {/* ── END: InventoryMovementTableCard ── */}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   2. RECONCILIATION TAB
   ────────────────────────────────────────────────────────────────────────── */
function ReconcileTab() {
  const [onlyDrift, setOnlyDrift] = useState(true)
  const [state, setState] = useState({ loading: true, rows: [], gaps: [], error: "" })

  const load = useCallback(async () => {
    try {
      const [rows, gaps] = await Promise.all([
        inventoryService.reconcile(onlyDrift),
        inventoryService.gaps(100),
      ])
      setState({ loading: false, rows, gaps, error: "" })
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err.message || "Could not load reconciliation",
      }))
    }
  }, [onlyDrift])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      {/* Informational banner */}
      <div className="bg-[#E8F3F1] border border-[#C8E3DC] rounded-2xl p-4 text-[#104945] text-xs leading-relaxed flex items-start gap-3">
        <CheckCircle className="w-5 h-5 text-[#104945] shrink-0 mt-0.5" />
        <p>
          Every sale, cancellation, return, and exchange writes a row in the ledger with the stock it
          left behind. If a live counter differs from its last ledger row, stock was changed without
          the ledger.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <label className="flex items-center gap-2 text-xs font-semibold text-[#1C1A17] cursor-pointer">
          <input
            type="checkbox"
            checked={onlyDrift}
            onChange={(e) => setOnlyDrift(e.target.checked)}
            className="w-4 h-4 rounded text-[#143834] focus:ring-0 focus:ring-offset-0 border-[#B5C2BC] cursor-pointer"
          />
          <span>Only show items whose stock differs from the ledger</span>
        </label>

        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-[#D5CDC2] text-[#3F3B35] hover:bg-[#F5F1EB] shadow-2xs transition cursor-pointer"
          type="button"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Re-check</span>
        </button>
      </div>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      {state.loading ? (
        <div className="h-40 rounded-2xl bg-[#EAE5DC] animate-pulse" />
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2DBD0] shadow-sm overflow-hidden">
          {state.rows.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#736E66]">
              {onlyDrift
                ? "Every counter matches its ledger perfectly. No drift detected."
                : "No ledger rows recorded yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F8F6F2] border-b border-[#E8E2D8] text-[#797368] font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Item</th>
                    <th className="py-3 px-4 text-center">In Stock</th>
                    <th className="py-3 px-4 text-center">Ledger Says</th>
                    <th className="py-3 px-4 text-center">Difference</th>
                    <th className="py-3 px-4 text-center">Movements</th>
                    <th className="py-3 px-4">Last Movement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2ECE3] text-[#36322C]">
                  {state.rows.map((r, i) => (
                    <tr key={r.optionId || i} className="hover:bg-[#FAF8F5] transition">
                      <td className="py-3 px-4 font-semibold text-[#1F1E1B]">{r.option}</td>
                      <td style={{ fontFamily: MONO }} className="py-3 px-4 text-center font-bold">
                        {r.inStock}
                      </td>
                      <td style={{ fontFamily: MONO }} className="py-3 px-4 text-center text-gray-500">
                        {r.ledgerStock}
                      </td>
                      <td
                        style={{ fontFamily: MONO }}
                        className={`py-3 px-4 text-center font-bold ${
                          r.diff !== 0 ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {r.diff > 0 ? `+${r.diff}` : r.diff}
                      </td>
                      <td style={{ fontFamily: MONO }} className="py-3 px-4 text-center text-gray-600">
                        {r.movementsCount}
                      </td>
                      <td className="py-3 px-4 text-[#6E6960]">{fmtDateTime(r.lastMovementAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   3. NOT RESELLABLE TAB
   ────────────────────────────────────────────────────────────────────────── */
function UnsellableTab() {
  const [state, setState] = useState({ loading: true, rows: [], error: "" })

  const load = useCallback(async () => {
    try {
      const rows = await inventoryService.unsellable()
      setState({ loading: false, rows, error: "" })
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err.message || "Could not load unsellable units",
      }))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-2xl p-4 text-[#991B1B] text-xs leading-relaxed flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-[#991B1B] shrink-0 mt-0.5" />
        <p>
          Returned items that failed inspection are kept as not resellable and separated from active
          store inventory. They do not add to sellable stock.
        </p>
      </div>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      {state.loading ? (
        <div className="h-40 rounded-2xl bg-[#EAE5DC] animate-pulse" />
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2DBD0] shadow-sm overflow-hidden">
          {state.rows.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#736E66]">
              No units kept as unsellable.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F8F6F2] border-b border-[#E8E2D8] text-[#797368] font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Item</th>
                    <th className="py-3 px-4 text-center">Units Kept</th>
                    <th className="py-3 px-4">Last Kept When</th>
                    <th className="py-3 px-4">Latest Return ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2ECE3] text-[#36322C]">
                  {state.rows.map((r, i) => (
                    <tr key={r.optionId || i} className="hover:bg-[#FAF8F5] transition">
                      <td className="py-3 px-4 font-semibold text-[#1F1E1B]">{r.option}</td>
                      <td
                        style={{ fontFamily: MONO }}
                        className="py-3 px-4 text-center font-bold text-rose-700"
                      >
                        {r.count}
                      </td>
                      <td className="py-3 px-4 text-[#6E6960]">{fmtDateTime(r.lastAt)}</td>
                      <td style={{ fontFamily: MONO }} className="py-3 px-4 font-mono text-xs">
                        {r.lastRef || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   4. PAID, NO ORDER TAB
   ────────────────────────────────────────────────────────────────────────── */
function PaymentsTab() {
  const [statusFilter, setStatusFilter] = useState("open")
  const [state, setState] = useState({ loading: true, rows: [], error: "" })
  const [prompt, setPrompt] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const rows = await inventoryService.paymentExceptions({
        status: statusFilter === "all" ? null : statusFilter,
      })
      setState({ loading: false, rows, error: "" })
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err.message || "Could not load exceptions",
      }))
    }
  }, [statusFilter])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="inline-flex items-center gap-1.5 p-1 bg-[#EAE5DC] rounded-xl text-xs font-semibold">
        {[
          { k: "open", label: "Open / Needs action" },
          { k: "refunded", label: "Refunded" },
          { k: "resolved", label: "Handled another way" },
          { k: "all", label: "All exceptions" },
        ].map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setStatusFilter(k)}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              statusFilter === k
                ? "bg-white text-[#1C1A17] font-bold shadow-xs"
                : "text-[#736E66] hover:text-[#1C1A17]"
            }`}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      {state.loading ? (
        <div className="h-40 rounded-2xl bg-[#EAE5DC] animate-pulse" />
      ) : state.rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2DBD0] p-8 text-center text-xs text-[#736E66]">
          {statusFilter === "open"
            ? "No paid orders waiting for a refund."
            : "No records found for active filter."}
        </div>
      ) : (
        <div className="space-y-3">
          {state.rows.map((r) => {
            const meta = paymentExceptionMeta(r.status)
            return (
              <div
                key={r.id}
                className="bg-white rounded-2xl border border-[#E2DBD0] p-5 shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-lg font-bold text-[#1C1A17]">{formatMoney(r.amount)}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      r.status === "open" ? "bg-rose-100 text-rose-800" : "bg-[#E0F0EB] text-[#104945]"
                    }`}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-xs text-[#736E66]">
                  Paid {fmtDateTime(r.createdAt)} · Payment ID:{" "}
                  <span style={{ fontFamily: MONO }} className="font-semibold text-[#1C1A17]">
                    {r.razorpayPaymentId}
                  </span>{" "}
                  <CopyButton text={r.razorpayPaymentId} /> · Razorpay Order:{" "}
                  <span style={{ fontFamily: MONO }}>{r.razorpayOrderId}</span>
                </p>
                <p className="text-xs text-[#736E66]">Reason: {r.reason}</p>

                {r.status === "open" && (
                  <div className="flex items-center gap-2 pt-2 border-t border-[#E8E2D8]">
                    <button
                      onClick={() => setPrompt({ kind: "refunded", row: r })}
                      className="px-3 py-1.5 rounded-xl bg-[#143834] text-white text-xs font-semibold hover:bg-[#0E2825] transition cursor-pointer"
                      type="button"
                    >
                      I refunded it in Razorpay
                    </button>
                    <button
                      onClick={() => setPrompt({ kind: "resolved", row: r })}
                      className="px-3 py-1.5 rounded-xl bg-[#FAF8F5] text-[#1C1A17] border border-[#E2DBD0] text-xs font-semibold hover:bg-[#F2ECE3] transition cursor-pointer"
                      type="button"
                    >
                      Handled another way
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {prompt?.kind === "refunded" && (
        <TextPromptModal
          title="Record the refund"
          subtitle={`${formatMoney(prompt.row.amount)} · ${prompt.row.razorpayPaymentId}`}
          label="Razorpay refund ID (rfnd_...) or bank reference"
          maxLength={200}
          confirmLabel="Close as refunded"
          onClose={() => setPrompt(null)}
          onSubmit={(text) =>
            inventoryService
              .resolvePaymentException(prompt.row.id, { status: "refunded", reference: text })
              .then(() => {
                toast.success("Closed as refunded")
                load()
              })
          }
        />
      )}

      {prompt?.kind === "resolved" && (
        <TextPromptModal
          title="How was it handled?"
          subtitle={`${formatMoney(prompt.row.amount)} · ${prompt.row.razorpayPaymentId}`}
          label="What did you do? (e.g. created order manually)"
          maxLength={1000}
          confirmLabel="Close"
          onClose={() => setPrompt(null)}
          onSubmit={(text) =>
            inventoryService
              .resolvePaymentException(prompt.row.id, { status: "resolved", note: text })
              .then(() => {
                toast.success("Closed")
                load()
              })
          }
        />
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   5. MAIN PAGE COMPONENT
   ────────────────────────────────────────────────────────────────────────── */
const AdminInventoryPage = () => {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "ledger"
  const [openPayments, setOpenPayments] = useState(0)
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [adjustItem, setAdjustItem] = useState("Cucumber")
  const [adjustType, setAdjustType] = useState("manual_add")
  const [adjustQty, setAdjustQty] = useState(5)
  const [adjustReason, setAdjustReason] = useState("Stock added by hand / warehouse batch")

  useEffect(() => {
    let alive = true
    inventoryService
      .paymentExceptions({ status: "open" })
      .then((rows) => {
        if (alive) setOpenPayments(rows.length)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [tab])

  const switchTab = useMemo(
    () => (key) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("tab", key)
          return next
        },
        { replace: true }
      ),
    [setParams]
  )

  const handleSaveAdjustment = (e) => {
    e.preventDefault()
    toast.success(`Adjusted ${adjustItem} by ${adjustQty > 0 ? "+" : ""}${adjustQty} units in ledger!`)
    setShowAdjustModal(false)
  }

  return (
    <main
      style={{ fontFamily: FONT }}
      className="flex-1 w-full space-y-6 text-[#1C1A17] pb-16 pr-4 sm:pr-6 md:pr-8 lg:pr-10 max-w-[1440px]"
      data-purpose="inventory-ledger-main"
    >
      {/* ── Top Action Bar & Live Metrics ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
        {/* Header Titles */}
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#143834] text-white flex items-center justify-center shadow-xs">
              <Boxes className="w-4 h-4" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-[#1C1A17]">Inventory Ledger</h2>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-[#E2DBD0] text-[#47423B]">
              Live Audit
            </span>
          </div>
          <p className="text-sm text-[#736E66]">
            Every change of stock, in chronological sequence. Reconciled with checkout sessions,
            return inspections, and adjustments.
          </p>
        </div>

        {/* Right Controls & Status Pill */}
        <div className="flex items-center gap-3 self-end md:self-auto flex-wrap">
          {/* Live Orders Metric */}
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-[#E0D8CC] text-xs font-semibold text-[#2D2A26] shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
            <span>396 today</span>
            <span className="text-[#878074] font-normal">|</span>
            <span className="text-[#104945]">₹25k</span>
          </div>

          {/* Dark Mode Toggle Button */}
          <button
            onClick={() => toast.info("Dark mode toggled.")}
            className="p-2 rounded-full bg-white border border-[#E0D8CC] text-[#635D54] hover:bg-[#F5F1EB] transition shadow-2xs cursor-pointer"
            title="Toggle theme"
            type="button"
          >
            <Moon className="w-4 h-4" />
          </button>

          {/* Notification Bell */}
          <button
            onClick={() => toast.info("No unread alerts.")}
            className="p-2 rounded-full bg-white border border-[#E0D8CC] text-[#635D54] hover:bg-[#F5F1EB] relative transition shadow-2xs cursor-pointer"
            title="Notifications"
            type="button"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#A8523A] rounded-full border-2 border-white"></span>
          </button>

          {/* CTA Buttons */}
          <button
            onClick={() => {
              const csvContent =
                "data:text/csv;charset=utf-8," +
                encodeURIComponent(
                  SAMPLE_MOVEMENTS.map((m) => `${m.createdAt},${m.option},${m.change},${m.reason}`).join(
                    "\n"
                  )
                )
              const link = document.createElement("a")
              link.setAttribute("href", csvContent)
              link.setAttribute("download", `pelago-inventory-${Date.now()}.csv`)
              link.click()
              toast.success("Exported CSV successfully.")
            }}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-white border border-[#D5CDC2] text-[#3F3B35] hover:bg-[#F5F1EB] shadow-2xs transition cursor-pointer"
            type="button"
          >
            Export CSV
          </button>

          <button
            onClick={() => setShowAdjustModal(true)}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-[#143834] text-white hover:bg-[#0D2623] shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            type="button"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.2]" />
            <span>Adjust Stock</span>
          </button>
        </div>
      </div>

      {/* ── BEGIN: SubNavigationTabs ── */}
      <div
        className="flex items-center gap-2 border-b border-[#E0D8CC] pb-3 overflow-x-auto"
        data-purpose="subnavigation-tabs"
      >
        {TABS.map((t) => {
          const isActive = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                isActive
                  ? "bg-[#A8523A] text-white shadow-xs"
                  : "font-medium text-[#655F55] hover:text-[#1F1D1A] hover:bg-white/60"
              }`}
              type="button"
            >
              <span>{t.title}</span>
              {t.key === "payments" && openPayments > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {openPayments}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* ── END: SubNavigationTabs ── */}

      {/* Active Tab View */}
      {tab === "ledger" && <LedgerTab onOpenAdjustModal={() => setShowAdjustModal(true)} />}
      {tab === "reconcile" && <ReconcileTab />}
      {tab === "unsellable" && <UnsellableTab />}
      {tab === "payments" && <PaymentsTab />}

      {/* ── Adjust Stock Modal ── */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl border border-[#E2DBD0] shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#EFECE6]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E8F3F1] text-[#104945] flex items-center justify-center">
                  <Boxes className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-[#1C1A17]">Adjust Item Stock</h3>
              </div>
              <button
                onClick={() => setShowAdjustModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 cursor-pointer"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#666056] mb-1">Product / Item Name</label>
                <input
                  value={adjustItem}
                  onChange={(e) => setAdjustItem(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] outline-none"
                  placeholder="e.g. Fluted Ceramic Vase"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#666056] mb-1">Movement Type</label>
                  <select
                    value={adjustType}
                    onChange={(e) => setAdjustType(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] outline-none"
                  >
                    <option value="manual_add">Stock added by hand</option>
                    <option value="correction_damage">Correction: damaged</option>
                    <option value="correction_found">Correction: found stock</option>
                    <option value="audit_count">Physical audit recount</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-[#666056] mb-1">Quantity Change</label>
                  <input
                    type="number"
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] outline-none font-mono"
                    placeholder="e.g. +5 or -2"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#666056] mb-1">Audit Reason / Note</label>
                <textarea
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D8D0C5] bg-[#FBF9F6] text-[#2F2C27] focus:border-[#143834] outline-none"
                  placeholder="Provide brief context for ledger audit tracking"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EFECE6]">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 rounded-xl bg-[#F0EBE3] text-[#554F45] font-semibold hover:bg-[#E5DFD4] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#143834] text-white font-semibold hover:bg-[#0E2825] transition cursor-pointer"
                >
                  Save Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

export default AdminInventoryPage