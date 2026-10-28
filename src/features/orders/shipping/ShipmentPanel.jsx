import { useEffect, useState } from "react"
import { toast } from "react-toastify"
import { ExternalLink, PackageCheck, Pencil, Plus, Truck, XCircle } from "lucide-react"
import ModalShell from "../../../components/Common/ModalShell"
import { shippingService, courierOptions, newEventKey } from "../../../services/shipping"
import { ADMIN_EVENT_CHOICES, activeShipments, eventLabel, formatDay, remainingByLine, shipmentStatusMeta, summarizeTracking } from "../shipmentModel"
import ShipOrderModal from "./ShipOrderModal"
import { CopyButton, ShipmentStatusChip } from "./ShipmentBits"
import { ERROR_STYLE, GHOST_BTN, HINT_STYLE, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN, fmtDate, fmtDateTime, formatINR, toLocalInputValue, toneColors } from "./shipmentUi"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"
const smallBtn = { display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 12px", borderRadius: "8px", background: "var(--color-surface-muted)", color: "var(--color-ink)", fontFamily: INTER, fontWeight: 600, fontSize: "13px", cursor: "pointer" }

/* ───────────── "Add a tracking update" ───────────── */
function EventModal({ shipment, onClose, onDone }) {
  const choices = shipment.status === "delivered" ? ADMIN_EVENT_CHOICES.filter((c) => c.type === "note") : ADMIN_EVENT_CHOICES
  const [type, setType] = useState(choices[0].type)
  const [when, setWhen] = useState(() => toLocalInputValue())
  const [location, setLocation] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [eventKey] = useState(() => newEventKey())      // one key per modal: a retry after a network error cannot create a duplicate

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const d = new Date(when)
    if (Number.isNaN(d.getTime())) { setError("Enter a valid date and time"); return }
    if (d.getTime() > Date.now() + 5 * 60 * 1000) { setError("The time cannot be in the future"); return }
    setBusy(true)
    try {
      const r = await shippingService.addEvent({ shipmentId: shipment.id, type, occurredAt: d.toISOString(), location: location.trim(), description: description.trim(), eventKey })
      toast.success(r.inserted ? "Tracking update saved" : "This update was already saved")
      onDone?.()
    } catch (err) {
      setError(err.message || "Could not save the update")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell open onClose={onClose} busy={busy} width={480} title="Add a tracking update" subtitle={`${shipment.courierName || "Shipment"}${shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}`}
      footer={(<>
        <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
        <button type="submit" form="ship-event-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Save update"}</button>
      </>)}>
      <form id="ship-event-form" onSubmit={submit} className="flex flex-col" style={{ gap: "12px" }} noValidate>
        <div>
          <label style={LABEL_STYLE} htmlFor="ev-type">What does the courier say?</label>
          <select id="ev-type" value={type} onChange={(e) => setType(e.target.value)} style={INPUT_STYLE}>
            {choices.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
          </select>
          {type === "delivered" ? <p style={HINT_STYLE}>The order moves to Delivered and the customer is notified.</p> : null}
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ev-when">When did it happen?</label>
          <input id="ev-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={INPUT_STYLE} />
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ev-loc">Location (optional)</label>
          <input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} style={INPUT_STYLE} />
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ev-desc">Note (optional)</label>
          <input id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder={type === "delivery_failed" ? "e.g. customer not available" : ""} style={INPUT_STYLE} />
        </div>
        {error ? <p style={ERROR_STYLE}>{error}</p> : null}
      </form>
    </ModalShell>
  )
}

/* ───────────── "Edit shipment details" (typo fixes) ───────────── */
function EditShipmentModal({ shipment, onClose, onDone }) {
  const [couriers, setCouriers] = useState(() => courierOptions([]))
  const [f, setF] = useState(() => ({
    courierCode: shipment.courierCode || "manual", courierName: shipment.courierName || "", trackingNumber: shipment.trackingNumber || "", trackingUrl: shipment.trackingUrl || "",
    shippedAt: shipment.shippedAt ? toLocalInputValue(new Date(shipment.shippedAt)) : "", expectedDeliveryDate: shipment.expectedDeliveryDate || "",
    charges: shipment.charges != null ? String(shipment.charges) : "", note: shipment.note || "",
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    shippingService.listCouriers({ includeInactive: true }).then((rows) => { if (alive) setCouriers(courierOptions(rows, { includeInactive: true })) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const patch = {}
    if (f.courierCode !== (shipment.courierCode || "manual")) patch.courierCode = f.courierCode
    if (f.courierName.trim() !== (shipment.courierName || "")) patch.courierName = f.courierName.trim()
    if (f.trackingNumber.trim() !== (shipment.trackingNumber || "")) patch.trackingNumber = f.trackingNumber.trim()
    if (f.trackingUrl.trim() !== (shipment.trackingUrl || "")) patch.trackingUrl = f.trackingUrl.trim()
    if (f.expectedDeliveryDate !== (shipment.expectedDeliveryDate || "")) patch.expectedDeliveryDate = f.expectedDeliveryDate
    if (f.note.trim() !== (shipment.note || "")) patch.note = f.note.trim()
    if (f.charges.trim() !== (shipment.charges != null ? String(shipment.charges) : "")) {
      const n = Number(f.charges)
      if (f.charges.trim() !== "" && (!Number.isFinite(n) || n < 0)) { setError("Charges must be 0 or more"); return }
      patch.charges = f.charges.trim() === "" ? "" : n
    }
    if (f.shippedAt) {
      const iso = new Date(f.shippedAt).toISOString()
      if (!shipment.shippedAt || new Date(shipment.shippedAt).toISOString().slice(0, 16) !== iso.slice(0, 16)) patch.shippedAt = iso
    }
    if (Object.keys(patch).length === 0) { onClose?.(); return }
    setBusy(true)
    try {
      await shippingService.updateShipment(shipment.id, patch)
      toast.success("Shipment updated")
      onDone?.()
    } catch (err) {
      setError(err.message || "Could not update the shipment")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell open onClose={onClose} busy={busy} width={560} title="Edit shipment details"
      footer={(<>
        <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
        <button type="submit" form="ship-edit-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Save changes"}</button>
      </>)}>
      <form id="ship-edit-form" onSubmit={submit} className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "12px" }} noValidate>
        <div>
          <label style={LABEL_STYLE} htmlFor="ed-courier">Courier</label>
          <select id="ed-courier" value={f.courierCode} onChange={set("courierCode")} style={INPUT_STYLE}>{couriers.map((c) => <option key={c.code} value={c.code}>{c.name}{c.active ? "" : " (off)"}</option>)}</select>
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ed-cname">Courier name shown to the customer</label>
          <input id="ed-cname" value={f.courierName} onChange={set("courierName")} maxLength={80} style={INPUT_STYLE} />
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ed-track">Tracking number</label>
          <input id="ed-track" value={f.trackingNumber} onChange={set("trackingNumber")} maxLength={80} style={INPUT_STYLE} />
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ed-url">Tracking link</label>
          <input id="ed-url" value={f.trackingUrl} onChange={set("trackingUrl")} style={INPUT_STYLE} />
          <p style={HINT_STYLE}>A link made from the courier template follows the number automatically.</p>
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ed-shipped">Shipping date & time</label>
          <input id="ed-shipped" type="datetime-local" value={f.shippedAt} onChange={set("shippedAt")} style={INPUT_STYLE} />
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ed-exp">Expected delivery</label>
          <input id="ed-exp" type="date" value={f.expectedDeliveryDate} onChange={set("expectedDeliveryDate")} style={INPUT_STYLE} />
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ed-charges">Charges (₹, internal)</label>
          <input id="ed-charges" value={f.charges} onChange={set("charges")} inputMode="decimal" style={INPUT_STYLE} />
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="ed-note">Internal note</label>
          <input id="ed-note" value={f.note} onChange={set("note")} maxLength={500} style={INPUT_STYLE} />
        </div>
        {error ? <p style={{ ...ERROR_STYLE, gridColumn: "1 / -1" }}>{error}</p> : null}
      </form>
    </ModalShell>
  )
}

/* ───────────── one parcel ───────────── */
function ShipmentCard({ order, shipment, onAddUpdate, onEdit, onCancel }) {
  const meta = shipmentStatusMeta(shipment.status)
  const tone = toneColors(meta.tone)
  const lineTitle = (id) => (order.products || []).find((p) => p.id === id)
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "16px", padding: "16px", background: "var(--color-surface)", opacity: shipment.status === "cancelled" ? 0.6 : 1 }}>
      <div className="flex items-start justify-between" style={{ gap: "12px" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "15px", color: "var(--color-ink)" }}>{shipment.courierName || "Courier not recorded"}</p>
          {shipment.trackingNumber ? (
            <div className="flex items-center flex-wrap" style={{ gap: "10px", marginTop: "2px" }}>
              <span style={{ fontFamily: MONO, fontSize: "13px", color: "var(--color-ink)", wordBreak: "break-all" }}>{shipment.trackingNumber}</span>
              <CopyButton text={shipment.trackingNumber} />
              {shipment.trackingUrl ? (
                <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center" style={{ gap: "4px", fontFamily: INTER, fontSize: "12px", fontWeight: 600, color: "var(--color-link)" }}>
                  Track <ExternalLink size={12} />
                </a>
              ) : null}
            </div>
          ) : <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-muted)", marginTop: "2px" }}>No tracking number recorded</p>}
        </div>
        <ShipmentStatusChip status={shipment.status} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px 16px", marginTop: "12px", fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
        <span>Shipped: <b style={{ color: "var(--color-ink)" }}>{fmtDateTime(shipment.shippedAt)}</b></span>
        {shipment.expectedDeliveryDate ? <span>Expected: <b style={{ color: "var(--color-ink)" }}>{formatDay(shipment.expectedDeliveryDate)}</b></span> : null}
        {shipment.deliveredAt ? <span>Delivered: <b style={{ color: "var(--color-success)" }}>{fmtDateTime(shipment.deliveredAt)}</b></span> : null}
        {shipment.charges != null ? <span>Charges: <b style={{ color: "var(--color-ink)" }}>{formatINR(shipment.charges)}</b></span> : null}
      </div>
      {shipment.note ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", marginTop: "8px" }}>Note: {shipment.note}</p> : null}

      {shipment.items.length ? (
        <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", marginTop: "8px" }}>
          In this parcel: {shipment.items.map((it) => `${lineTitle(it.orderItemId)?.title || "Item"} x${it.quantity}`).join(", ")}
        </p>
      ) : null}

      {shipment.events.length ? (
        <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
          {shipment.events.map((ev, i) => (
            <li key={ev.id || i} className="flex" style={{ gap: "10px", paddingBottom: i === shipment.events.length - 1 ? 0 : "10px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "9999px", marginTop: "5px", flexShrink: 0, background: i === 0 ? tone.fg : "var(--color-border-strong)" }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px", color: "var(--color-ink)" }}>{eventLabel(ev.type)}</p>
                <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
                  {fmtDateTime(ev.occurredAt)}{ev.location ? ` · ${ev.location}` : ""}{ev.description && ev.description !== eventLabel(ev.type) ? ` · ${ev.description}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {shipment.status !== "cancelled" ? (
        <div className="flex flex-wrap" style={{ gap: "8px", marginTop: "14px" }}>
          <button type="button" onClick={() => onAddUpdate(shipment)} style={smallBtn}><Plus size={14} /> Add update</button>
          <button type="button" onClick={() => onEdit(shipment)} style={smallBtn}><Pencil size={14} /> Edit details</button>
          {shipment.status !== "delivered" ? <button type="button" onClick={() => onCancel(shipment)} style={{ ...smallBtn, color: "var(--color-error)" }}><XCircle size={14} /> Cancel shipment</button> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The "Shipment & tracking" block of the admin order drawer: every parcel with its history and the actions that change it.
 * `order` must come from the live orders list (so it refreshes after an action); `onChanged` reloads that list.
 */
const ShipmentPanel = ({ order, onChanged }) => {
  const [modal, setModal] = useState(null)       // { kind: 'ship' } | { kind: 'event' | 'edit', shipment }
  const [busy, setBusy] = useState(false)
  const status = String(order.orderStatus || "").toLowerCase()
  const parcels = (order.shipments || []).filter((s) => (s.direction || "outbound") === "outbound")
  const live = activeShipments(order)
  const t = summarizeTracking(order)
  const left = remainingByLine(order).reduce((n, l) => n + l.remaining, 0)
  const canShip = status === "placed" || status === "confirmed" || (status === "shipped" && left > 0)

  const done = () => { setModal(null); onChanged?.() }

  const markDelivered = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await shippingService.markDelivered(order.id)
      toast.success(r.already ? "Already delivered" : "Marked as delivered")
      onChanged?.()
    } catch (err) {
      toast.error(err.message || "Could not mark the order delivered")
    } finally {
      setBusy(false)
    }
  }
  const cancelShipment = async (shipment) => {
    if (!window.confirm("Cancel this shipment? Use this only for a parcel that was recorded by mistake.")) return
    try {
      await shippingService.cancelShipment(shipment.id, "Cancelled by admin")
      toast.success("Shipment cancelled")
      onChanged?.()
    } catch (err) {
      toast.error(err.message || "Could not cancel the shipment")
    }
  }

  if (status === "cancelled") return null

  return (
    <div style={{ paddingTop: "8px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: "12px", gap: "8px" }}>
        <div className="flex items-center gap-3">
          <span style={{ width: "4px", height: "20px", background: "var(--color-primary)", borderRadius: "9999px" }} />
          <h3 style={{ fontFamily: INTER, fontWeight: 700, fontSize: "18px", color: "var(--color-ink)" }}>Shipment &amp; tracking</h3>
        </div>
        <div className="flex" style={{ gap: "8px" }}>
          {canShip ? (
            <button type="button" onClick={() => setModal({ kind: "ship" })} style={{ ...smallBtn, background: "var(--color-primary)", color: "var(--color-inverse)" }}>
              <Truck size={14} /> {status === "shipped" ? "Ship remaining items" : "Ship this order"}
            </button>
          ) : null}
          {status === "shipped" ? (
            <button type="button" onClick={markDelivered} disabled={busy} style={{ ...smallBtn, opacity: busy ? 0.7 : 1 }}><PackageCheck size={14} /> Mark delivered</button>
          ) : null}
        </div>
      </div>

      {parcels.length === 0 ? (
        <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-body)" }}>
          {status === "shipped"
            ? "This order was shipped before shipment tracking existed, so no courier or tracking number is recorded. Use \"Ship remaining items\" to add them."
            : status === "delivered"
              ? `Delivered ${fmtDate(order.deliveredAt)}. No shipment record exists for this order.`
              : "Not shipped yet."}
        </p>
      ) : (
        <div className="flex flex-col" style={{ gap: "12px" }}>
          {t.needsAttention ? (
            <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px", color: "var(--color-accent-strong)", background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning-border)", borderRadius: "10px", padding: "10px 12px" }}>
              The courier reports a problem with this delivery. Contact the customer, then record the next step with "Add update".
            </p>
          ) : null}
          {parcels.map((s) => (
            <ShipmentCard key={s.id} order={order} shipment={s} onAddUpdate={(x) => setModal({ kind: "event", shipment: x })} onEdit={(x) => setModal({ kind: "edit", shipment: x })} onCancel={cancelShipment} />
          ))}
          {live.length === 0 ? <p style={HINT_STYLE}>Every recorded shipment was cancelled.</p> : null}
        </div>
      )}

      {order.deliveredAt && status === "delivered" ? (
        <p style={{ ...HINT_STYLE, marginTop: "10px" }}>Delivered on {fmtDateTime(order.deliveredAt)}{order.deliveredAtSource === "backfill_updated_at" ? " (approximate: taken from the last update of an order delivered before dates were recorded)" : ""}. Return and exchange windows count from this date.</p>
      ) : null}

      {modal?.kind === "ship" ? <ShipOrderModal key={order.id} order={order} onClose={() => setModal(null)} onDone={done} /> : null}
      {modal?.kind === "event" ? <EventModal key={modal.shipment.id} shipment={modal.shipment} onClose={() => setModal(null)} onDone={done} /> : null}
      {modal?.kind === "edit" ? <EditShipmentModal key={modal.shipment.id} shipment={modal.shipment} onClose={() => setModal(null)} onDone={done} /> : null}
    </div>
  )
}

export default ShipmentPanel