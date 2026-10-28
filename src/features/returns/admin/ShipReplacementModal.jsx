import { useEffect, useState } from "react"
import { toast } from "react-toastify"
import ModalShell from "../../../components/Common/ModalShell"
import { returnsService } from "../../../services/returns"
import { shippingService, courierOptions, previewTrackingUrl } from "../../../services/shipping"
import { validateShipForm } from "../../orders/shipmentModel"
import { ERROR_STYLE, GHOST_BTN, HINT_STYLE, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN, toLocalInputValue } from "../../orders/shipping/shipmentUi"

const LAST_COURIER_KEY = "shipping.lastCourier"
const readLastCourier = () => {
  try { return window.localStorage.getItem(LAST_COURIER_KEY) || "manual" } catch { return "manual" }
}

/**
 * "Ship the replacement": records the courier / tracking details of the parcel that carries the replacement items to the customer
 * (ship_replacement) and moves the exchange to "replacement shipped". The stock was reserved when the item was approved, so shipping
 * moves no stock. Same fields and the same checks as shipping an order; the server enforces them again.
 * Mount it only while it is needed so the form starts fresh each time.
 */
const ShipReplacementModal = ({ request, lines, onClose, onDone }) => {
  const [couriers, setCouriers] = useState(() => courierOptions([]))
  const [courierNote, setCourierNote] = useState("")
  const [form, setForm] = useState(() => ({
    courierCode: readLastCourier(), courierName: "", trackingNumber: "", trackingUrl: "", shippedAt: toLocalInputValue(), expectedDeliveryDate: "", charges: "", note: "",
  }))
  const [errors, setErrors] = useState({})
  const [warnings, setWarnings] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    shippingService.listCouriers()
      .then((rows) => { if (alive) setCouriers(courierOptions(rows)) })
      .catch((e) => { if (alive) setCourierNote(`The courier list could not be loaded (${e.message}). "Other courier" still works.`) })
    return () => { alive = false }
  }, [])

  const courier = couriers.find((c) => c.code === form.courierCode) || null
  const autoUrl = previewTrackingUrl(courier, form.trackingNumber)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e?.preventDefault()
    if (busy) return
    const result = validateShipForm(form, { orderId: request.orderId, couriers })
    setErrors(result.errors)
    setWarnings(result.warnings)
    if (!result.ok) return
    setBusy(true)
    try {
      const r = await returnsService.shipReplacement(request.id, result.payload)
      try { window.localStorage.setItem(LAST_COURIER_KEY, form.courierCode) } catch { /* private mode: not worth a message */ }
      toast.success(r.created ? "Replacement shipped - the customer has been notified" : "This parcel was already recorded")
      onDone?.(r)
    } catch (err) {
      toast.error(err.message || "Could not record the shipment")
    } finally {
      setBusy(false)
    }
  }

  const field = (label, key, control, hint) => (
    <div style={{ minWidth: 0 }}>
      <label style={LABEL_STYLE} htmlFor={`rship-${key}`}>{label}</label>
      {control}
      {errors[key] ? <p style={ERROR_STYLE}>{errors[key]}</p> : hint ? <p style={HINT_STYLE}>{hint}</p> : null}
    </div>
  )

  return (
    <ModalShell
      open onClose={onClose} busy={busy} width={620} title="Ship the replacement" subtitle={`${request.requestNo} · ${lines.map((l) => l.text).join(", ")}`}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
          <button type="submit" form="ship-replacement-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Mark as shipped"}</button>
        </>
      )}
    >
      <form id="ship-replacement-form" onSubmit={submit} className="flex flex-col" style={{ gap: "14px" }} noValidate>
        {courierNote ? <p style={{ ...HINT_STYLE, color: "var(--color-error)" }}>{courierNote}</p> : null}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {field("Courier", "courierCode", (
            <select id="rship-courierCode" value={form.courierCode} onChange={set("courierCode")} style={INPUT_STYLE}>
              {couriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          ))}
          {form.courierCode === "manual"
            ? field("Courier name (shown to the customer)", "courierName", <input id="rship-courierName" value={form.courierName} onChange={set("courierName")} placeholder="e.g. Local delivery boy" maxLength={80} style={INPUT_STYLE} />)
            : <div />}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {field("Tracking / consignment number", "trackingNumber", <input id="rship-trackingNumber" value={form.trackingNumber} onChange={set("trackingNumber")} placeholder="e.g. D12345678" maxLength={80} autoComplete="off" style={INPUT_STYLE} />)}
          {field("Tracking link (optional)", "trackingUrl", <input id="rship-trackingUrl" value={form.trackingUrl} onChange={set("trackingUrl")} placeholder={autoUrl || "https://..."} inputMode="url" style={INPUT_STYLE} />,
            autoUrl && !form.trackingUrl ? "Left empty, the customer gets the link built from the number." : "Paste the courier's tracking page if it has one.")}
        </div>
        {warnings.trackingNumber ? <p style={{ ...HINT_STYLE, color: "var(--color-accent-strong)" }}>{warnings.trackingNumber}</p> : null}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {field("Shipping date & time", "shippedAt", <input id="rship-shippedAt" type="datetime-local" value={form.shippedAt} onChange={set("shippedAt")} style={INPUT_STYLE} />)}
          {field("Expected delivery (optional)", "expectedDeliveryDate", <input id="rship-expectedDeliveryDate" type="date" value={form.expectedDeliveryDate} onChange={set("expectedDeliveryDate")} style={INPUT_STYLE} />, "Shown to the customer as \"Expected by ...\".")}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {field("Shipping charges paid to the courier (₹)", "charges", <input id="rship-charges" value={form.charges} onChange={set("charges")} inputMode="decimal" placeholder="optional" style={INPUT_STYLE} />, "Internal only - the customer never sees this.")}
          {field("Internal note", "note", <input id="rship-note" value={form.note} onChange={set("note")} maxLength={500} placeholder="optional" style={INPUT_STYLE} />, "Internal only.")}
        </div>
      </form>
    </ModalShell>
  )
}

export default ShipReplacementModal