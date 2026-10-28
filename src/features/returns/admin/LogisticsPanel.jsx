import { useEffect, useState } from "react"
import { toast } from "react-toastify"
import { ExternalLink } from "lucide-react"
import { returnsService } from "../../../services/returns"
import { shippingService, courierOptions, newEventKey } from "../../../services/shipping"
import { ADMIN_EVENT_CHOICES, eventLabel } from "../../orders/shipmentModel"
import { CopyButton, ShipmentStatusChip } from "../../orders/shipping/ShipmentBits"
import { ERROR_STYLE, GHOST_BTN, HINT_STYLE, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN, fmtDateTime, formatINR, toLocalInputValue } from "../../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"
const METHODS = [
  { value: "courier_pickup", label: "Courier pickup (a courier collects it)" },
  { value: "customer_arranged", label: "Customer arranged (the customer sends it)" },
  { value: "manual", label: "Manual (hand-over / we arrange it ourselves)" },
]

/** one return (or replacement) parcel with its history and a small "add a tracking update" form (no courier API is assumed) */
export function ReturnParcel({ shipment, onChanged }) {
  const [type, setType] = useState("in_transit")
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(() => newEventKey())      // one key per attempt: a retry cannot add the event twice
  const add = async () => {
    if (busy) return
    setBusy(true)
    try {
      await shippingService.addEvent({ shipmentId: shipment.id, type, eventKey: key })
      setKey(newEventKey())
      toast.success("Tracking update saved")
      onChanged?.()
    } catch (err) {
      toast.error(err.message || "Could not save the update")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "10px 12px" }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px" }}>
        <span style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px" }}>{shipment.courierName || "Courier not recorded"}</span>
        <ShipmentStatusChip status={shipment.status} small />
      </div>
      <div className="flex items-center flex-wrap" style={{ gap: "10px", marginTop: "4px", fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
        {shipment.trackingNumber ? <span style={{ fontFamily: MONO, color: "var(--color-ink)" }}>{shipment.trackingNumber}</span> : <span>No tracking number</span>}
        {shipment.trackingNumber ? <CopyButton text={shipment.trackingNumber} /> : null}
        {shipment.pickupReference ? <span>Pickup ref {shipment.pickupReference}</span> : null}
        {shipment.charges != null ? <span>Charges {formatINR(shipment.charges)}</span> : null}
        {shipment.trackingUrl ? <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center" style={{ gap: "4px", fontWeight: 700, color: "var(--color-link)" }}>Track <ExternalLink size={12} /></a> : null}
      </div>
      {shipment.events.slice(0, 4).map((e) => (
        <p key={e.id} style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", marginTop: "2px" }}>{eventLabel(e.type)} · {fmtDateTime(e.occurredAt)}{e.description ? ` · ${e.description}` : ""}</p>
      ))}
      {shipment.status !== "delivered" && shipment.status !== "cancelled" ? (
        <div className="flex items-center" style={{ gap: "8px", marginTop: "8px" }}>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...INPUT_STYLE, height: "34px", width: "auto" }} aria-label="Tracking update">
            {ADMIN_EVENT_CHOICES.filter((c) => c.type !== "delivered").map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
          </select>
          <button type="button" onClick={add} disabled={busy} style={{ ...GHOST_BTN, height: "34px", fontSize: "13px" }}>{busy ? "Saving..." : "Add update"}</button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Phase 8: HOW the parcel comes back, the instructions the customer sees, and the return courier / tracking details - recorded by hand
 * (no courier API is required). Setting the method moves an approved request to "awaiting return shipment" and tells the customer.
 */
const LogisticsPanel = ({ request, parcels, onDone }) => {
  const editable = request.status === "approved" || request.status === "awaiting_return_shipment"
  const first = parcels[0] || null
  const [couriers, setCouriers] = useState(() => courierOptions([]))
  const [f, setF] = useState(() => ({
    method: request.returnMethod || "courier_pickup", instructions: request.returnInstructions || "", courierCode: first?.courierCode || "manual", courierName: first?.courierName || "",
    trackingNumber: first?.trackingNumber || "", trackingUrl: first?.trackingUrl || "", pickupReference: first?.pickupReference || "", shippedAt: toLocalInputValue(),
    charges: first?.charges != null ? String(first.charges) : "", note: first?.note || "",
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    shippingService.listCouriers().then((rows) => { if (alive) setCouriers(courierOptions(rows)) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    if (busy) return
    if (f.method !== "courier_pickup" && !f.instructions.trim()) { setError("Write the return instructions the customer will see"); return }
    if (f.charges.trim() !== "" && (!Number.isFinite(Number(f.charges)) || Number(f.charges) < 0)) { setError("Charges must be 0 or more"); return }
    const wantsParcel = f.method !== "customer_arranged"
    setBusy(true)
    try {
      await returnsService.setLogistics(request.id, {
        method: f.method, instructions: f.instructions.trim(),
        courierCode: wantsParcel && (f.trackingNumber.trim() || f.pickupReference.trim() || f.courierCode !== "manual") ? f.courierCode : null,
        courierName: wantsParcel ? f.courierName.trim() : null, trackingNumber: wantsParcel ? f.trackingNumber.trim() : null, trackingUrl: wantsParcel ? f.trackingUrl.trim() : null,
        pickupReference: wantsParcel ? f.pickupReference.trim() : null, shippedAt: wantsParcel && f.shippedAt ? new Date(f.shippedAt).toISOString() : null,
        charges: wantsParcel ? f.charges : "", note: f.note.trim(),
      })
      toast.success(request.status === "approved" ? "Return instructions sent to the customer" : "Return details updated")
      setError("")
      onDone?.()
    } catch (err) {
      setError(err.message || "Could not save the return details")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "14px", padding: "14px" }}>
      <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "14px", marginBottom: "10px" }}>Return logistics</p>
      {parcels.length ? <div className="flex flex-col" style={{ gap: "8px", marginBottom: "12px" }}>{parcels.map((p) => <ReturnParcel key={p.id} shipment={p} onChanged={onDone} />)}</div> : null}
      {request.returnMethod && !editable ? (
        <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-body)" }}>Method: <b>{(METHODS.find((m) => m.value === request.returnMethod) || {}).label || request.returnMethod}</b>{request.returnInstructions ? ` — ${request.returnInstructions}` : ""}</p>
      ) : null}
      {editable ? (
        <form onSubmit={save} className="flex flex-col" style={{ gap: "10px" }} noValidate>
          <div>
            <label style={LABEL_STYLE} htmlFor="lg-method">How will it come back?</label>
            <select id="lg-method" value={f.method} onChange={set("method")} style={INPUT_STYLE}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
          </div>
          <div>
            <label style={LABEL_STYLE} htmlFor="lg-instr">Instructions the customer will read{f.method === "courier_pickup" ? " (optional)" : ""}</label>
            <textarea id="lg-instr" rows={3} maxLength={2000} value={f.instructions} onChange={set("instructions")} style={{ ...INPUT_STYLE, height: "auto", padding: "8px 12px" }}
              placeholder={f.method === "customer_arranged" ? "Where to send it (address), how to pack it, who pays the postage ..." : f.method === "manual" ? "How and where to hand it over ..." : "e.g. Pickup tomorrow between 10 and 1; keep the invoice in the box"} />
          </div>
          {f.method !== "customer_arranged" ? (
            <>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px" }}>
                <div><label style={LABEL_STYLE} htmlFor="lg-courier">Return courier</label>
                  <select id="lg-courier" value={f.courierCode} onChange={set("courierCode")} style={INPUT_STYLE}>{couriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
                {f.courierCode === "manual" ? <div><label style={LABEL_STYLE} htmlFor="lg-cname">Courier name</label><input id="lg-cname" value={f.courierName} onChange={set("courierName")} maxLength={80} style={INPUT_STYLE} /></div> : <div />}
                <div><label style={LABEL_STYLE} htmlFor="lg-track">Return tracking number</label><input id="lg-track" value={f.trackingNumber} onChange={set("trackingNumber")} maxLength={80} style={INPUT_STYLE} /></div>
                <div><label style={LABEL_STYLE} htmlFor="lg-url">Tracking link</label><input id="lg-url" value={f.trackingUrl} onChange={set("trackingUrl")} inputMode="url" style={INPUT_STYLE} /></div>
                <div><label style={LABEL_STYLE} htmlFor="lg-pick">Pickup reference</label><input id="lg-pick" value={f.pickupReference} onChange={set("pickupReference")} maxLength={80} style={INPUT_STYLE} /></div>
                <div><label style={LABEL_STYLE} htmlFor="lg-date">Shipment date</label><input id="lg-date" type="datetime-local" value={f.shippedAt} onChange={set("shippedAt")} style={INPUT_STYLE} /></div>
                <div><label style={LABEL_STYLE} htmlFor="lg-charges">Return shipping charges (₹, internal)</label><input id="lg-charges" value={f.charges} onChange={set("charges")} inputMode="decimal" style={INPUT_STYLE} /></div>
                <div><label style={LABEL_STYLE} htmlFor="lg-note">Internal note</label><input id="lg-note" value={f.note} onChange={set("note")} maxLength={500} style={INPUT_STYLE} /></div>
              </div>
              <p style={HINT_STYLE}>All optional: record what you know now, add tracking updates as the courier reports them.</p>
            </>
          ) : <p style={HINT_STYLE}>The customer will add the courier and tracking number of the parcel herself.</p>}
          {error ? <p style={ERROR_STYLE}>{error}</p> : null}
          <div><button type="submit" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : request.status === "approved" ? "Send return instructions" : "Update return details"}</button></div>
        </form>
      ) : null}
    </div>
  )
}

export default LogisticsPanel