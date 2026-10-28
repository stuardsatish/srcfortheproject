import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { RotateCcw, Search } from "lucide-react"
import { supabase } from "../../context/SupabaseConfig"
import { returnsService } from "../../services/returns"
import RightDrawer from "../../components/Common/RightDrawer"
import RequestDetail from "../../features/returns/admin/RequestDetail"
import { RequestStatusChip } from "../../features/returns/RequestBits"
import { FINAL_STATUSES, requestTypeLabel } from "../../features/returns/requestModel"
import { fmtDate } from "../../features/orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"
const TABS = [{ key: "return", title: "Return Requests" }, { key: "exchange", title: "Exchange Requests" }]
// statuses where the NEXT move is the admin's (not the customer's or the courier's)
// (an exchange that is delivered but not closed is waiting for its price difference to be settled)
const NEEDS_ACTION = ["pending_review", "approved", "return_received", "inspection_pending", "inspection_passed", "refund_pending", "replacement_pending", "replacement_delivered"]
const FILTERS = [
  { key: "action", label: "Needs action", test: (r) => NEEDS_ACTION.includes(r.status) },
  { key: "open", label: "In progress", test: (r) => !FINAL_STATUSES.includes(r.status) },
  { key: "done", label: "Finished", test: (r) => FINAL_STATUSES.includes(r.status) },
  { key: "all", label: "All", test: () => true },
]
const ageText = (iso) => {
  const d = iso ? Date.now() - new Date(iso).getTime() : NaN
  if (!Number.isFinite(d) || d < 0) return ""
  const h = Math.floor(d / 3600000)
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

/**
 * Admin: Return Requests and Exchange Requests (spec 7). Same patterns as the Orders page: tabs with counts, a list, a right-hand drawer.
 * Every decision, move and note goes through the RPCs of the database state machine (the screen only offers the steps that are legal).
 */
const AdminReturnsPage = () => {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "return"
  const filterKey = FILTERS.some((f) => f.key === params.get("status")) ? params.get("status") : "action"
  const selectedId = params.get("open") || ""
  const [search, setSearch] = useState("")
  const [state, setState] = useState({ loading: true, requests: [], error: "" })

  const update = useCallback((patch) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(patch)) { if (!v) next.delete(k); else next.set(k, v) }
    return next
  }, { replace: true }), [setParams])

  const load = useCallback(async () => {
    try {
      const requests = await returnsService.adminList({ limit: 500 })
      setState({ loading: false, requests, error: "" })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message || "Could not load the requests" }))
    }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    // its own channel: if the returns tables are missing only this subscription fails
    const channel = supabase.channel("admin-returns-realtime").on("postgres_changes", { event: "*", schema: "public", table: "return_requests" }, load).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const counts = useMemo(() => {
    const out = { return: { action: 0 }, exchange: { action: 0 } }
    for (const r of state.requests) if (out[r.type] && NEEDS_ACTION.includes(r.status)) out[r.type].action += 1
    return out
  }, [state.requests])

  const filter = FILTERS.find((f) => f.key === filterKey)
  const q = search.trim().toLowerCase()
  const shown = useMemo(() => state.requests.filter((r) => r.type === tab && filter.test(r) && (!q
    || r.requestNo.toLowerCase().includes(q) || r.orderId.toLowerCase().includes(q) || (r.order?.customerName || "").toLowerCase().includes(q) || (r.order?.customerEmail || "").toLowerCase().includes(q))),
  [state.requests, tab, filter, q])
  const selected = state.requests.find((r) => r.id === selectedId) || null

  const FONT = "'Plus Jakarta Sans','Inter',sans-serif"
  const INK  = "#171412"
  const MUTED = "#78716C"
  const TEAL = "#104945"
  const TEAL_L = "#DDF0EB"
  const BORDER = "#E6E0D8"

  return (
    <div style={{ minHeight: "100vh", fontFamily: FONT, color: INK }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px 24px 80px" }}>

        {/* Page header */}
        <div style={{ marginBottom: "20px" }}>
          <p style={{ fontSize: "11px", color: MUTED, fontWeight: 500, marginBottom: "2px" }}>Post-order management</p>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: INK, letterSpacing: "-0.5px", margin: 0 }}>Returns &amp; Exchanges</h1>
          <p style={{ fontSize: "13px", color: MUTED, marginTop: "4px" }}>Review, decide, arrange the return, inspect. Nothing is refunded or restocked from this list directly.</p>
        </div>

        {/* Tab switcher — Pelago pill style */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "16px", background: "#EDE8E2", borderRadius: "999px", padding: "3px", width: "fit-content" }} role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => update({ tab: t.key, open: "" })}
              style={{ padding: "6px 16px", borderRadius: "999px", fontWeight: tab === t.key ? 700 : 500, fontSize: "13px", cursor: "pointer", background: tab === t.key ? "#fff" : "transparent", color: tab === t.key ? INK : MUTED, border: "none", boxShadow: tab === t.key ? "0 1px 2px rgba(0,0,0,0.08)" : "none", fontFamily: FONT, display: "flex", alignItems: "center", gap: "6px" }}>
              {t.title}
              {counts[t.key].action > 0 ? <span style={{ background: TEAL, color: "#fff", borderRadius: "999px", padding: "1px 7px", fontSize: "11px" }}>{counts[t.key].action}</span> : null}
            </button>
          ))}
        </div>

        {/* Filter + search bar */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {FILTERS.map((f) => (
              <button key={f.key} aria-pressed={filterKey === f.key} onClick={() => update({ status: f.key === "action" ? "" : f.key, open: "" })}
                style={{ padding: "5px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", background: filterKey === f.key ? TEAL : "#F7F5F2", color: filterKey === f.key ? "#fff" : MUTED, border: filterKey === f.key ? "none" : `1px solid ${BORDER}`, fontFamily: FONT }}>{f.label}</button>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: "999px", padding: "0 14px", height: "36px" }}>
            <Search size={14} style={{ color: MUTED }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Request no, order id, customer" aria-label="Search requests" style={{ border: "none", outline: "none", background: "transparent", fontSize: "13px", width: "220px", fontFamily: FONT }} />
          </label>
        </div>

        {/* Content */}
        {state.loading ? (
          <div className="animate-pulse flex flex-col" style={{ gap: "10px" }}>{[0, 1, 2].map((i) => <div key={i} style={{ height: "76px", borderRadius: "14px", background: "#E9E4DD" }} />)}</div>
        ) : state.error ? (
          <p style={{ color: "#EF4444", fontSize: "14px" }}>{state.error}</p>
        ) : shown.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", border: `2px dashed ${BORDER}`, borderRadius: "20px", padding: "56px 20px", gap: "6px" }}>
            <RotateCcw size={40} style={{ color: BORDER }} />
            <p style={{ fontWeight: 800, fontSize: "20px", color: INK }}>No {tab} requests here</p>
            <p style={{ fontSize: "13px", color: MUTED }}>{filterKey === "action" ? "Nothing needs your action right now." : "Nothing matches this filter."}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {shown.map((r) => (
              <button key={r.id} onClick={() => update({ open: r.id })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", textAlign: "left", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: "14px", padding: "14px 18px", cursor: "pointer", width: "100%", fontFamily: FONT, transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = "#FAF8F5"}
                onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: "2px" }}>
                  <span style={{ fontWeight: 800, fontSize: "13px", color: INK }}>{r.requestNo}</span>
                  <span style={{ fontSize: "12.5px", color: "#44403C" }}>{r.order?.customerName || "Guest"} · order {String(r.orderId).slice(-10)} · {r.items.length} item{r.items.length === 1 ? "" : "s"}: {r.items.map((i) => `${i.title}${i.variantName ? ` (${i.variantName})` : ""} x${i.quantity}`).join(", ")}</span>
                  <span style={{ fontSize: "11.5px", color: MUTED }}>{requestTypeLabel(r.type)} · {r.reasonCode.replace(/_/g, " ")} · {fmtDate(r.createdAt)} ({ageText(r.createdAt)})</span>
                </span>
                <RequestStatusChip status={r.status} staff />
              </button>
            ))}
          </div>
        )}
      </div>

      <RightDrawer open={!!selected} onClose={() => update({ open: "" })} title={selected ? `${requestTypeLabel(selected.type)} ${selected.requestNo}` : ""} widthPx={680}>
        {selected ? <RequestDetail key={selected.id} request={selected} onChanged={load} /> : null}
      </RightDrawer>
    </div>
  )

}

export default AdminReturnsPage
