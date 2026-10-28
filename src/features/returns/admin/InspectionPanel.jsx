import { useState } from "react"
import { toast } from "react-toastify"
import { returnsService } from "../../../services/returns"
import { defaultDisposition, dispositionOptions } from "../../inventory/inventoryModel"
import { ERROR_STYLE, HINT_STYLE, INPUT_STYLE, PRIMARY_BTN } from "../../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"

/**
 * Record the inspection result of every received line: passed (accepted) or failed (a reason the customer will read is required), and where the returned
 * units go: back on sale (the default for a passed line), kept as not resellable (the default for a failed line, also possible for a passed one that is
 * damaged / defective), or no stock record (a failed parcel sent back to the customer). Stock is touched only now, never earlier, and only once.
 * When every received line has a result the request becomes "inspection passed" (at least one line passed) or "inspection failed".
 */
const InspectionPanel = ({ request, onDone }) => {
  const waiting = request.items.filter((i) => i.status === "received")
  const [res, setRes] = useState({})                   // itemId -> { result, note }
  const [internalNote, setInternalNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  if (waiting.length === 0) return null
  const set = (id, patch) => setRes((c) => ({ ...c, [id]: { ...c[id], ...patch } }))
  const done = waiting.filter((i) => res[i.id]?.result)

  const save = async () => {
    if (busy) return
    if (done.length === 0) { setError("Choose passed or failed for at least one item"); return }
    const bad = done.find((i) => res[i.id].result === "failed" && !String(res[i.id].note || "").trim())
    if (bad) { setError(`Tell the customer why "${bad.title}" failed the inspection`); return }
    setBusy(true)
    try {
      const r = await returnsService.inspect(request.id, done.map((i) => ({
        item_id: i.id, result: res[i.id].result, note: String(res[i.id].note || "").trim() || null, disposition: res[i.id].disposition || defaultDisposition(res[i.id].result),
      })), internalNote.trim() || null)
      toast.success(r.waiting > 0 ? "Result saved - some items are still waiting" : r.status === "inspection_passed" ? "Inspection passed" : "Inspection failed")
      setRes({})
      setError("")
      onDone?.()
    } catch (err) {
      setError(err.message || "Could not save the inspection")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "14px", padding: "14px" }}>
      <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "14px", marginBottom: "10px" }}>Inspection</p>
      <div className="flex flex-col" style={{ gap: "10px" }}>
        {waiting.map((i) => (
          <div key={i.id} style={{ borderTop: "1px solid var(--color-info-subtle)", paddingTop: "10px" }}>
            <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px" }}>
              <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px" }}>{i.title}{i.variantName ? ` · ${i.variantName}` : ""} <span style={{ color: "var(--color-muted)" }}>x{i.quantity}</span></p>
              <div className="flex" style={{ gap: "6px" }} role="radiogroup" aria-label={`Result for ${i.title}`}>
                {[["passed", "Passed"], ["failed", "Failed"]].map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={res[i.id]?.result === v} onClick={() => set(i.id, { result: v, disposition: defaultDisposition(v) })}
                    style={{ height: "32px", padding: "0 14px", borderRadius: "8px", fontFamily: INTER, fontWeight: 700, fontSize: "12px", cursor: "pointer",
                      background: res[i.id]?.result === v ? (v === "passed" ? "var(--color-success)" : "var(--color-error)") : "var(--color-surface-muted)",
                      color: res[i.id]?.result === v ? "var(--color-inverse)" : "var(--color-ink)" }}>{label}</button>
                ))}
              </div>
            </div>
            {res[i.id]?.result ? (
              <>
                <input value={res[i.id]?.note || ""} onChange={(e) => set(i.id, { note: e.target.value })} maxLength={1000} style={{ ...INPUT_STYLE, marginTop: "6px" }}
                  placeholder={res[i.id].result === "failed" ? "Reason the customer will read (required)" : "Note for the customer (optional)"} aria-label={`Inspection note for ${i.title}`} />
                <label className="flex items-center flex-wrap" style={{ gap: "8px", marginTop: "6px", fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
                  Stock:
                  <select value={res[i.id].disposition || defaultDisposition(res[i.id].result)} onChange={(e) => set(i.id, { disposition: e.target.value })} style={{ ...INPUT_STYLE, height: "32px", width: "auto", minWidth: "220px" }} aria-label={`What happens to the stock of ${i.title}`}>
                    {dispositionOptions(res[i.id].result).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <input value={internalNote} onChange={(e) => setInternalNote(e.target.value)} maxLength={2000} placeholder="Internal note (staff only, optional)" style={{ ...INPUT_STYLE, marginTop: "12px" }} aria-label="Internal note" />
      {error ? <p style={ERROR_STYLE}>{error}</p> : <p style={HINT_STYLE}>A passed item can be refunded / replaced next. Saving also records what happens to its stock (choose above); this happens once and cannot be repeated.</p>}
      <div style={{ marginTop: "10px" }}><button type="button" onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Save inspection"}</button></div>
    </div>
  )
}

export default InspectionPanel