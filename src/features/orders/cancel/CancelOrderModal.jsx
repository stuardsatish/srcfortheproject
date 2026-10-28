import { useState } from "react"
import { toast } from "react-toastify"
import ModalShell from "../../../components/Common/ModalShell"
import { inventoryService } from "../../../services/inventory"
import { cancelResultText, isPaidOrder, razorpayRefundPossible, validateCancelForm } from "../../inventory/inventoryModel"
import { formatMoney } from "../../returns/refundModel"
import { ERROR_STYLE, GHOST_BTN, HINT_STYLE, INPUT_STYLE, LABEL_STYLE } from "../shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const newKey = () => {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return `cancel-${c.randomUUID()}`
  return `cancel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * "Cancel this order" (Phase 12) - only for an order that has NOT shipped. One database call does everything: the status becomes cancelled, the stock the order
 * took goes back to the same shelves exactly once, a PAID order gets a refund record (sent through Razorpay or recorded by hand afterwards in the order's Refund
 * section), the customer gets one message with your reason. A shipped / delivered order is refused by the server (the customer returns it instead).
 * Mount it only while it is needed so the form starts fresh each time.
 */
const CancelOrderModal = ({ order, onClose, onDone }) => {
  const paid = isPaidOrder(order)
  const rzp = razorpayRefundPossible(order)
  const [form, setForm] = useState({ reason: "", note: "", refundMethod: "" })
  const [key] = useState(newKey)                       // one idempotency key per dialog: a double click cannot refund twice
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e?.preventDefault()
    if (busy) return
    const v = validateCancelForm(form, { paid, razorpayPossible: rzp })
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true)
    try {
      const r = await inventoryService.cancelOrder({ orderId: order.id, reason: v.args.reason, refundMethod: v.args.refundMethod, key: paid ? key : null, note: v.args.note })
      toast.success(cancelResultText(r))
      onDone?.(r)
    } catch (err) {
      toast.error(err.message || "Could not cancel the order")
      setBusy(false)
    }
  }

  const label = String(order.id).slice(-8).toUpperCase()
  return (
    <ModalShell
      open onClose={onClose} busy={busy} width={560} title="Cancel this order" subtitle={`#${label} · ${order.userName || "Guest"} · ${formatMoney(order.total)}`}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Keep the order</button>
          <button type="submit" form="cancel-order-form" disabled={busy} style={{ background: "var(--color-error)", color: "var(--color-inverse)", borderRadius: "10px", height: "40px", padding: "0 18px", fontFamily: INTER, fontWeight: 700, fontSize: "14px", cursor: "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Cancelling..." : "Cancel the order"}
          </button>
        </>
      )}
    >
      <form id="cancel-order-form" onSubmit={submit} className="flex flex-col" style={{ gap: "12px" }} noValidate>
        <ul style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-body)", margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "3px" }}>
          <li>The order becomes <b>cancelled</b> and the customer is told, with your reason.</li>
          <li>The stock this order took goes back on the shelf, exactly once.</li>
          {paid ? <li>It was <b>paid</b>: a refund of the whole {formatMoney(order.total)} is created. You then send it through Razorpay or record that you paid it.</li> : <li>It is not paid yet, so there is nothing to refund.</li>}
          <li>This cannot be undone. An order that has shipped cannot be cancelled here.</li>
        </ul>
        <div>
          <label style={LABEL_STYLE} htmlFor="cancel-reason">Reason (the customer reads it)</label>
          <textarea id="cancel-reason" rows={3} value={form.reason} onChange={set("reason")} maxLength={500} placeholder="e.g. The item is no longer available" style={{ ...INPUT_STYLE, height: "auto", padding: "8px 12px" }} autoFocus />
          {errors.reason ? <p style={ERROR_STYLE}>{errors.reason}</p> : null}
        </div>
        {paid ? (
          <div role="radiogroup" aria-label="How is the refund paid?">
            <p style={LABEL_STYLE}>How is the refund paid?</p>
            <div className="flex flex-col" style={{ gap: "6px" }}>
              {[
                { v: "razorpay", title: "Through Razorpay (original payment method)", hint: rzp ? "Needs your Razorpay keys on the server. You send it from the order's Refund section." : "This order was not paid through Razorpay.", off: !rzp },
                { v: "manual", title: "I pay it myself (bank / UPI / cash)", hint: "You pay it out, then record the payment reference.", off: false },
              ].map((o) => (
                <label key={o.v} className="flex items-start" style={{ gap: "8px", opacity: o.off ? 0.5 : 1, fontFamily: INTER, fontSize: "13px" }}>
                  <input type="radio" name="cancel-refund-method" checked={form.refundMethod === o.v} onChange={() => setForm((f) => ({ ...f, refundMethod: o.v }))} disabled={busy || o.off} />
                  <span><b>{o.title}</b><span style={{ display: "block", fontSize: "12px", color: "var(--color-muted)" }}>{o.hint}</span></span>
                </label>
              ))}
            </div>
            {errors.refundMethod ? <p style={ERROR_STYLE}>{errors.refundMethod}</p> : null}
          </div>
        ) : null}
        <div>
          <label style={LABEL_STYLE} htmlFor="cancel-note">Note for staff (optional)</label>
          <input id="cancel-note" value={form.note} onChange={set("note")} maxLength={1000} style={INPUT_STYLE} />
          {errors.note ? <p style={ERROR_STYLE}>{errors.note}</p> : <p style={HINT_STYLE}>Internal only.</p>}
        </div>
      </form>
    </ModalShell>
  )
}

export default CancelOrderModal