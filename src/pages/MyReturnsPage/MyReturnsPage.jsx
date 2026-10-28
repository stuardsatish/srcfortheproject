import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useSelector } from "react-redux"
import { ArrowLeft, RotateCcw } from "lucide-react"
import { returnsService } from "../../services/returns"
import RequestCard from "../../features/returns/RequestCard"
import { requestStatusMeta } from "../../features/returns/requestModel"

const INTER = "'Inter', sans-serif"
const FILTERS = [
  { key: "active", label: "In progress" },
  { key: "all", label: "All" },
  { key: "return", label: "Returns" },
  { key: "exchange", label: "Exchanges" },
]

/** Customer: every return / exchange request she has made, newest first, with the same detail and actions as on the order page. */
const MyReturnsPage = () => {
  const navigate = useNavigate()
  const user = useSelector((state) => state.user.user)
  const [state, setState] = useState({ loading: true, requests: [], parcels: [], refunds: [], replacements: {}, error: "" })
  const [filter, setFilter] = useState("active")

  const load = useCallback(async () => {
    try {
      const requests = await returnsService.listMine()
      const parcels = await returnsService.returnShipmentsFor(requests.map((r) => r.id))
      const refunds = await returnsService.refundsForRequests(requests.map((r) => r.id)).catch(() => [])       // a convenience: never hides the requests
      const replacements = await returnsService.replacementsFor(requests.filter((r) => r.type === "exchange").map((r) => r.id)).catch(() => ({}))
      setState({ loading: false, requests, parcels, refunds, replacements, error: "" })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message || "Could not load your requests" }))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => state.requests.filter((r) => {
    if (filter === "active") return !requestStatusMeta(r.status).final
    if (filter === "all") return true
    return r.type === filter
  }), [state.requests, filter])

  return (
    <div style={{ background: "var(--color-background)", minHeight: "100vh", fontFamily: INTER, color: "var(--color-ink)" }}>
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "96px 24px 80px" }}>
        <button onClick={() => navigate(-1)} className="flex items-center" style={{ gap: "8px", color: "var(--color-body)", marginBottom: "20px" }}>
          <ArrowLeft size={16} /> <span style={{ fontWeight: 600, fontSize: "14px" }}>Back</span>
        </button>
        <h1 className="flex items-center" style={{ gap: "10px", fontWeight: 700, fontSize: "30px", letterSpacing: "-0.6px" }}><RotateCcw size={26} style={{ color: "var(--color-primary)" }} /> My returns &amp; exchanges</h1>

        <div className="flex flex-wrap" style={{ gap: "8px", margin: "20px 0" }}>
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} style={{ padding: "8px 16px", borderRadius: "9999px", fontWeight: 600, fontSize: "13px", background: filter === f.key ? "var(--color-primary)" : "var(--color-surface-muted)", color: filter === f.key ? "var(--color-inverse)" : "var(--color-body)", cursor: "pointer" }}>{f.label}</button>
          ))}
        </div>

        {state.loading ? (
          <div className="animate-pulse flex flex-col" style={{ gap: "12px" }}>
            {[0, 1].map((i) => <div key={i} style={{ height: "88px", borderRadius: "10px", background: "var(--color-border)" }} />)}
          </div>
        ) : state.error ? (
          <p style={{ color: "var(--color-error)", fontSize: "14px" }}>{state.error}</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center text-center" style={{ gap: "10px", padding: "56px 0", color: "var(--color-body)" }}>
            <RotateCcw size={40} style={{ color: "var(--color-border-strong)" }} />
            <p style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}>{filter === "active" ? "Nothing in progress" : "No requests yet"}</p>
            <p style={{ fontSize: "14px" }}>To return or exchange something, open the order it came in (My Past Orders).</p>
            <button onClick={() => navigate("/userpastorders")} style={{ background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "13px", padding: "12px 22px", borderRadius: "8px", cursor: "pointer" }}>Go to my past orders</button>
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: "14px" }}>
            {shown.map((r) => (
              <div key={r.id}>
                <button onClick={() => navigate(`/order/${r.orderId}`)} style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-link)", marginBottom: "4px", cursor: "pointer" }}>View order #{String(r.orderId).slice(-8).toUpperCase()}</button>
                <RequestCard request={r} order={{ shipments: state.parcels.filter((p) => p.requestId === r.id) }} refunds={state.refunds.filter((f) => f.requestId === r.id)} replacement={state.replacements[r.id] || null} user={user} onChanged={load} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default MyReturnsPage