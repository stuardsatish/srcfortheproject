import { useCallback, useEffect, useState } from "react"
import { toast } from "react-toastify"
import ModalShell from "../../../components/Common/ModalShell"
import { inventoryService } from "../../../services/inventory"
import { isPaidOrder, razorpayRefundPossible, validateOrderRefundForm } from "../../inventory/inventoryModel"
import { formatMoney } from "../../returns/refundModel"
import RefundCard from "../../returns/admin/RefundCard"
import { ERROR_STYLE, GHOST_BTN, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN, fmtDateTime } from "../shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const newKey = () => {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return `orefund-${c.randomUUID()}`
  return `orefund-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * "Refund an amount" of a PAID order: a failed refund of a cancelled order, goodwill, or - with `requestId` - an exchange that was cancelled AFTER the returned
 * item came back (the customer has no replacement and has not been paid for it). The server caps it at what is still refundable. The refund is then sent through
 * Razorpay or recorded by hand like any refund (the order's Refund section). One idempotency key per dialog: a double click cannot refund twice.
 */
export function OrderRefundModal({ orderId, remaining, razorpayPossible, requestId = null, defaultAmount = "", defaultReason = "", onClose, onDone }) {
  const [form, setForm] = useState({ amount: defaultAmount === "" ? "" : String(defaultAmount), reason: defaultReason, method: "", note: "" })
  const [key] = useState(newKey)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const submit = async (e) => {
    e?.preventDefault()
    if (busy) return
    const v = validateOrderRefundForm(form, { remaining, razorpayPossible })
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true)
    try {
      const r = await inventoryService.createOrderRefund({ orderId, amount: v.args.amount, method: v.args.method, reason: v.args.reason, key, requestId, note: v.args.note || null })
      toast.success(r.created ? `Refund ${r.refundNo} created - send or record it in the Refund section` : `Refund ${r.refundNo} already existed`)
      onDone?.(r)
    } catch (err) {
      toast.error(err.message || "Could not create the refund")
      setBusy(false)
    }
  }
  return (
    <ModalShell open onClose={onClose} busy={busy} width={520} title="Refund an amount" subtitle={Number.isFinite(remaining) ? `${formatMoney(remaining)} can still be refunded for this order` : undefined}
      footer={(<>
        <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
        <button type="submit" form="order-refund-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Creating..." : "Create the refund"}</button>
      </>)}>
      <form id="order-refund-form" onSubmit={submit} className="flex flex-col" style={{ gap: "10px" }} noValidate>
        <div>
          <label style={LABEL_STYLE} htmlFor="orf-amount">Amount (₹)</label>
          <input id="orf-amount" inputMode="decimal" value={form.amount} onChange={set("amount")} style={INPUT_STYLE} autoFocus />
          {errors.amount ? <p style={ERROR_STYLE}>{errors.amount}</p> : null}
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="orf-reason">What is it for? (the customer reads it)</label>
          <input id="orf-reason" value={form.reason} onChange={set("reason")} maxLength={300} placeholder="e.g. the item you returned" style={INPUT_STYLE} />
          {errors.reason ? <p style={ERROR_STYLE}>{errors.reason}</p> : null}
        </div>
        <div role="radiogroup" aria-label="How is the refund paid?">
          <p style={LABEL_STYLE}>How is it paid back?</p>
          <div className="flex flex-col" style={{ gap: "6px" }}>
            {[
              { v: "razorpay", title: "Through Razorpay (original payment method)", hint: razorpayPossible === false ? "This order was not paid through Razorpay." : "Needs your Razorpay keys on the server.", off: razorpayPossible === false },
              { v: "manual", title: "I pay it myself (bank / UPI / cash)", hint: "You pay it out, then record the payment reference.", off: false },
            ].map((o) => (
              <label key={o.v} className="flex items-start" style={{ gap: "8px", opacity: o.off ? 0.5 : 1, fontFamily: INTER, fontSize: "13px" }}>
                <input type="radio" name="orf-method" checked={form.method === o.v} onChange={() => setForm((f) => ({ ...f, method: o.v }))} disabled={busy || o.off} />
                <span><b>{o.title}</b><span style={{ display: "block", fontSize: "12px", color: "var(--color-muted)" }}>{o.hint}</span></span>
              </label>
            ))}
          </div>
          {errors.method ? <p style={ERROR_STYLE}>{errors.method}</p> : null}
        </div>
        <div>
          <label style={LABEL_STYLE} htmlFor="orf-note">Note for staff (optional)</label>
          <input id="orf-note" value={form.note} onChange={set("note")} maxLength={1000} style={INPUT_STYLE} />
          {errors.note ? <p style={ERROR_STYLE}>{errors.note}</p> : null}
        </div>
      </form>
    </ModalShell>
  )
}

/**
 * The money side of ONE order in the admin drawer (Phase 12): why / when it was cancelled (and how much stock came back), every refund of the order with the steps
 * that finish it (send to Razorpay, record the payment, cancel), and "Refund an amount" for a paid order. Renders nothing for an unpaid order that was never cancelled
 * and has no refund. The server enforces every rule; this only shows its answer.
 */
const OrderRefundsPanel = ({ order, onChanged }) => {
  const [refunds, setRefunds] = useState([])
  const [cancellation, setCancellation] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [modal, setModal] = useState(false)

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([inventoryService.orderRefunds(order.id), inventoryService.orderCancellation(order.id)])
      setRefunds(r); setCancellation(c); setLoadError("")
    } catch (err) {
      setLoadError(err.message || "Could not load the refunds")
    } finally {
      setLoaded(true)
    }
  }, [order.id])
  useEffect(() => { load() }, [load])
  const refresh = async () => { await load(); onChanged?.() }

  const paid = isPaidOrder(order)
  const counted = refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount, 0)
  const remaining = Math.max(0, Math.round(((Number(order.total) || 0) - counted) * 100) / 100)
  if (!loaded || (!cancellation && refunds.length === 0 && !paid && !loadError)) return null

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "16px", padding: "16px", marginTop: "24px" }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px", marginBottom: "6px" }}>
        <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "15px" }}>{cancellation ? "Cancellation & refunds" : "Refunds"}</p>
        {paid && remaining > 0 ? <button type="button" style={{ ...GHOST_BTN, height: "34px", fontSize: "13px" }} onClick={() => setModal(true)}>Refund an amount</button> : null}
      </div>
      {loadError ? <p style={ERROR_STYLE}>{loadError}</p> : null}
      {cancellation ? (
        <div style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-body)", marginBottom: "10px" }}>
          <p>Cancelled {fmtDateTime(cancellation.cancelledAt)}: <b style={{ color: "var(--color-ink)" }}>{cancellation.reason}</b></p>
          <p>Stock returned to {cancellation.stockRestored.length} option(s){cancellation.internalNote ? ` · staff note: ${cancellation.internalNote}` : ""}</p>
        </div>
      ) : null}
      {refunds.length ? (
        <div className="flex flex-col" style={{ gap: "10px" }}>
          {refunds.map((r) => <RefundCard key={r.id} refund={r} onChanged={refresh} />)}
        </div>
      ) : paid ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-muted)" }}>No refund has been made for this order.</p> : null}
      {paid ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-muted)", marginTop: "8px" }}>Paid {formatMoney(order.total)} · {formatMoney(counted)} refunded or being refunded · {formatMoney(remaining)} left</p> : null}
      {modal ? (
        <OrderRefundModal orderId={order.id} remaining={remaining} razorpayPossible={razorpayRefundPossible(order)} onClose={() => setModal(false)} onDone={() => { setModal(false); refresh() }} />
      ) : null}
    </div>
  )
}

export default OrderRefundsPanel