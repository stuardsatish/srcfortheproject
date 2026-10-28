import { useEffect, useMemo, useState } from "react"
import { toast } from "react-toastify"
import ModalShell from "../../../components/Common/ModalShell"
import { shippingService, courierOptions, previewTrackingUrl } from "../../../services/shipping"
import { validateShipForm, remainingByLine } from "../shipmentModel"
import { toLocalInputValue, INPUT_STYLE, LABEL_STYLE, ERROR_STYLE, HINT_STYLE, PRIMARY_BTN, GHOST_BTN } from "./shipmentUi"

const LAST_COURIER_KEY = "shipping.lastCourier"
const readLastCourier = () => {
  try { return window.localStorage.getItem(LAST_COURIER_KEY) || "manual" } catch { return "manual" }
}
const rememberCourier = (code) => {
  try { window.localStorage.setItem(LAST_COURIER_KEY, code) } catch { /* private mode: not worth a message */ }
}

/**
 * "Initiate Transit": records the shipment (courier, tracking number / link, date, charges ...) and moves the order to Shipped in ONE
 * database call (ship_order). Also used to add tracking details to an order that was shipped before shipment tracking existed.
 * Mount it only while it is needed (`{target && <ShipOrderModal key={target.id} .../>}`) so the form starts fresh each time.
 */
const ShipOrderModal = ({ order, onClose, onDone }) => {
  const [couriers, setCouriers] = useState(() => courierOptions([]))
  const [courierNote, setCourierNote] = useState("")
  const [form, setForm] = useState(() => ({
    courierCode: readLastCourier(), courierName: "", trackingNumber: "", trackingUrl: "", shippedAt: toLocalInputValue(),
    expectedDeliveryDate: "", charges: "", note: "",
  }))
  const lines = useMemo(() => remainingByLine(order), [order])
  const shippable = lines.filter((l) => l.remaining > 0)
  const [partial, setPartial] = useState(false)
  const [qty, setQty] = useState(() => Object.fromEntries(remainingByLine(order).map((l) => [l.orderItemId, String(l.remaining)])))
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

  const alreadyShipped = String(order.orderStatus || "").toLowerCase() === "shipped"
  const courier = couriers.find((c) => c.code === form.courierCode) || null
  const autoUrl = previewTrackingUrl(courier, form.trackingNumber)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const orderLabel = order.externalOrderId ? String(order.externalOrderId).replace(/^#/, "") : order.id

  const submit = async (e) => {
    e?.preventDefault()
    if (busy) return
    const remaining = Object.fromEntries(lines.map((l) => [l.orderItemId, l.remaining]))
    const items = partial ? shippable.map((l) => ({ orderItemId: l.orderItemId, quantity: Number(qty[l.orderItemId] || 0) })) : null
    const result = validateShipForm({ ...form, items }, { orderId: order.id, couriers, remaining })
    setErrors(result.errors)
    setWarnings(result.warnings)
    if (!result.ok) return
    setBusy(true)
    try {
      const r = await shippingService.shipOrder(result.payload)
      rememberCourier(form.courierCode)
      toast.success(r.created
        ? (alreadyShipped ? "Shipment details saved" : "Order marked as shipped - the customer has been notified")
        : "This parcel was already recorded")
      onDone?.(r)
    } catch (err) {
      toast.error(err.message || "Could not record the shipment")
    } finally {
      setBusy(false)
    }
  }

  const field = (label, key, control, hint) => (
    <div style={{ minWidth: 0 }}>
      <label style={LABEL_STYLE} htmlFor={`ship-${key}`}>{label}</label>
      {control}
      {errors[key] ? <p style={ERROR_STYLE}>{errors[key]}</p> : hint ? <p style={HINT_STYLE}>{hint}</p> : null}
    </div>
  )

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      width={620}
      title={alreadyShipped ? "Add shipment details" : "Ship this order"}
      subtitle={`#${orderLabel} · ${order.userName || "Guest"}${alreadyShipped ? " · already marked shipped" : ""}`}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
          <button type="submit" form="ship-order-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>
            {busy ? "Saving..." : alreadyShipped ? "Save shipment" : "Mark as shipped"}
          </button>
        </>
      )}
    >
      <form id="ship-order-form" onSubmit={submit} className="flex flex-col" style={{ gap: "14px" }} noValidate>
        {courierNote ? <p style={{ ...HINT_STYLE, color: "var(--color-error)" }}>{courierNote}</p> : null}

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {field("Courier", "courierCode", (
            <select id="ship-courierCode" value={form.courierCode} onChange={set("courierCode")} style={INPUT_STYLE}>
              {couriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          ))}
          {form.courierCode === "manual"
            ? field("Courier name (shown to the customer)", "courierName", <input id="ship-courierName" value={form.courierName} onChange={set("courierName")} placeholder="e.g. Local delivery boy, Anjani Courier" maxLength={80} style={INPUT_STYLE} />)
            : <div />}
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {field("Tracking / consignment number", "trackingNumber", <input id="ship-trackingNumber" value={form.trackingNumber} onChange={set("trackingNumber")} placeholder="e.g. D12345678" maxLength={80} autoComplete="off" style={INPUT_STYLE} />)}
          {field("Tracking link (optional)", "trackingUrl", <input id="ship-trackingUrl" value={form.trackingUrl} onChange={set("trackingUrl")} placeholder={autoUrl || "https://..."} inputMode="url" style={INPUT_STYLE} />,
            autoUrl && !form.trackingUrl ? "Left empty, the customer gets the link built from the number." : "Paste the courier's tracking page if it has one.")}
        </div>
        {warnings.trackingNumber ? <p style={{ ...HINT_STYLE, color: "var(--color-accent-strong)" }}>{warnings.trackingNumber}</p> : null}

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {field("Shipping date & time", "shippedAt", <input id="ship-shippedAt" type="datetime-local" value={form.shippedAt} onChange={set("shippedAt")} style={INPUT_STYLE} />)}
          {field("Expected delivery (optional)", "expectedDeliveryDate", <input id="ship-expectedDeliveryDate" type="date" value={form.expectedDeliveryDate} onChange={set("expectedDeliveryDate")} style={INPUT_STYLE} />, "Shown to the customer as \"Expected by ...\".")}
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {field("Shipping charges paid to the courier (₹)", "charges", <input id="ship-charges" value={form.charges} onChange={set("charges")} inputMode="decimal" placeholder="optional" style={INPUT_STYLE} />, "Internal only - the customer never sees this.")}
          {field("Internal note", "note", <input id="ship-note" value={form.note} onChange={set("note")} maxLength={500} placeholder="optional" style={INPUT_STYLE} />, "Internal only.")}
        </div>

        {shippable.length > 1 || (shippable.length === 1 && shippable[0].quantity > 1) ? (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "12px" }}>
            <label className="flex items-center" style={{ gap: "8px", fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>
              <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
              Ship only some of the items (the rest ships later)
            </label>
            {partial ? (
              <div className="flex flex-col" style={{ gap: "8px", marginTop: "10px" }}>
                {shippable.map((l) => (
                  <div key={l.orderItemId} className="flex items-center justify-between" style={{ gap: "12px" }}>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: "13px", minWidth: 0 }} className="truncate">
                      {l.title}{l.variantName ? ` · ${l.variantName}` : ""} <span style={{ color: "var(--color-muted)" }}>(left: {l.remaining})</span>
                    </span>
                    <input aria-label={`Quantity of ${l.title} to ship`} type="number" min={0} max={l.remaining} value={qty[l.orderItemId] ?? "0"} onChange={(e) => setQty((q) => ({ ...q, [l.orderItemId]: e.target.value }))} style={{ ...INPUT_STYLE, width: "84px", textAlign: "center" }} />
                  </div>
                ))}
                {errors.items ? <p style={ERROR_STYLE}>{errors.items}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </ModalShell>
  )
}

export default ShipOrderModal