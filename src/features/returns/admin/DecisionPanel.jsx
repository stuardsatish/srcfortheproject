import { useState } from "react"
import { toast } from "react-toastify"
import { returnsService } from "../../../services/returns"
import { ERROR_STYLE, HINT_STYLE, INPUT_STYLE, PRIMARY_BTN, GHOST_BTN } from "../../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"

/**
 * Approve / reject the lines of a request ONE BY ONE (a decision on one line never touches another). A rejection must carry a reason the
 * customer will read. The request itself moves on once every line is decided (the database does that, not this screen).
 */
const DecisionPanel = ({ request, onDone }) => {
  const pending = request.items.filter((i) => i.status === "pending")
  const [choice, setChoice] = useState({})                  // itemId -> { decision: 'approve' | 'reject', note }
  const [internalNote, setInternalNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  if (pending.length === 0) return null

  const set = (id, patch) => setChoice((c) => ({ ...c, [id]: { ...c[id], ...patch } }))
  const decided = pending.filter((i) => choice[i.id]?.decision)
  const approveAll = () => setChoice(Object.fromEntries(pending.map((i) => [i.id, { ...choice[i.id], decision: "approve" }])))

  const save = async () => {
    if (busy) return
    if (decided.length === 0) { setError("Choose approve or reject for at least one item"); return }
    const missing = decided.find((i) => choice[i.id].decision === "reject" && !String(choice[i.id].note || "").trim())
    if (missing) { setError(`Give the customer a reason for rejecting "${missing.title}"`); return }
    setBusy(true)
    try {
      const r = await returnsService.decide(request.id, decided.map((i) => ({ item_id: i.id, decision: choice[i.id].decision, note: String(choice[i.id].note || "").trim() || null })), { internalNote: internalNote.trim() || null })
      toast.success(r.pending > 0 ? "Decision saved - some items still need a decision" : r.status === "approved" ? "Request approved" : "Request rejected")
      setChoice({})
      setInternalNote("")
      setError("")
      onDone?.()
    } catch (err) {
      setError(err.message || "Could not save the decision")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "14px", padding: "14px" }}>
      <div className="flex items-center justify-between" style={{ gap: "8px", marginBottom: "10px" }}>
        <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "14px" }}>Decide each item</p>
        <button type="button" onClick={approveAll} style={{ ...GHOST_BTN, height: "32px", fontSize: "12px" }}>Approve all</button>
      </div>
      <div className="flex flex-col" style={{ gap: "10px" }}>
        {pending.map((i) => (
          <div key={i.id} style={{ borderTop: "1px solid var(--color-info-subtle)", paddingTop: "10px" }}>
            <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px" }}>
              <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px" }}>{i.title}{i.variantName ? ` · ${i.variantName}` : ""} <span style={{ color: "var(--color-muted)" }}>x{i.quantity}</span></p>
              <div className="flex" style={{ gap: "6px" }} role="radiogroup" aria-label={`Decision for ${i.title}`}>
                {[["approve", "Approve"], ["reject", "Reject"]].map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={choice[i.id]?.decision === v} onClick={() => set(i.id, { decision: v })}
                    style={{ height: "32px", padding: "0 14px", borderRadius: "8px", fontFamily: INTER, fontWeight: 700, fontSize: "12px", cursor: "pointer",
                      background: choice[i.id]?.decision === v ? (v === "approve" ? "var(--color-success)" : "var(--color-error)") : "var(--color-surface-muted)",
                      color: choice[i.id]?.decision === v ? "var(--color-inverse)" : "var(--color-ink)" }}>{label}</button>
                ))}
              </div>
            </div>
            {choice[i.id]?.decision ? (
              <input value={choice[i.id]?.note || ""} onChange={(e) => set(i.id, { note: e.target.value })} maxLength={1000} style={{ ...INPUT_STYLE, marginTop: "6px" }}
                placeholder={choice[i.id].decision === "reject" ? "Reason the customer will read (required)" : "Note for the customer (optional)"} aria-label={`Note for ${i.title}`} />
            ) : null}
          </div>
        ))}
      </div>
      <input value={internalNote} onChange={(e) => setInternalNote(e.target.value)} maxLength={2000} placeholder="Internal note (staff only, optional)" style={{ ...INPUT_STYLE, marginTop: "12px" }} aria-label="Internal note" />
      {error ? <p style={ERROR_STYLE}>{error}</p> : <p style={HINT_STYLE}>The request is approved when at least one item is approved and none is left undecided; rejected when every item is rejected.</p>}
      <div style={{ marginTop: "10px" }}><button type="button" onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Save decision"}</button></div>
    </div>
  )
}

export default DecisionPanel