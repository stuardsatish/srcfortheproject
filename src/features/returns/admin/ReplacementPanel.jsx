import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "react-toastify"
import ModalShell from "../../../components/Common/ModalShell"
import { returnsService } from "../../../services/returns"
import {
  adjustmentAdminLine, fulfilmentStatusMeta, money, replacementAdminActions, replacementAdminState, reservationLabel, validateExchangeRefundForm,
} from "../exchangeModel"
import TextPromptModal from "./TextPromptModal"
import ShipReplacementModal from "./ShipReplacementModal"
import { OrderRefundModal } from "../../orders/cancel/OrderRefundsPanel"
import { ReturnParcel } from "./LogisticsPanel"
import { ERROR_STYLE, GHOST_BTN, HINT_STYLE, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN, fmtDateTime, toLocalInputValue, toneColors } from "../../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const newKey = () => {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return `xrefund-${c.randomUUID()}`
  return `xrefund-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** "I received the replacement" (the customer confirmed, or the courier's page says so): when, and an optional note */
function DeliveredModal({ onSubmit, onClose }) {
  const [when, setWhen] = useState(() => toLocalInputValue())
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const d = new Date(when)
    if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 5 * 60 * 1000) { setError("Enter a valid time that is not in the future"); return }
    setBusy(true)
    try { await onSubmit(d.toISOString(), note.trim()); onClose?.() } catch (err) { setError(err.message || "Could not save"); setBusy(false) }
  }
  return (
    <ModalShell open onClose={onClose} busy={busy} width={460} title="Replacement delivered"
      footer={(<>
        <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
        <button type="submit" form="delivered-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Mark delivered"}</button>
      </>)}>
      <form id="delivered-form" onSubmit={submit} className="flex flex-col" style={{ gap: "10px" }} noValidate>
        <div><label style={LABEL_STYLE} htmlFor="dlv-when">When was it delivered?</label><input id="dlv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={INPUT_STYLE} /></div>
        <div><label style={LABEL_STYLE} htmlFor="dlv-note">Note (optional)</label><input id="dlv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={INPUT_STYLE} /></div>
        {error ? <p style={ERROR_STYLE}>{error}</p> : null}
        <p style={HINT_STYLE}>The exchange closes by itself once the price difference (if any) is settled.</p>
      </form>
    </ModalShell>
  )
}

/** "Refund the price difference": how it is paid back. The refund is then sent / recorded in the Refund section like any refund. */
function RefundDifferenceModal({ amount, razorpayPossible, onSubmit, onClose }) {
  const [method, setMethod] = useState("")
  const [note, setNote] = useState("")
  const [key] = useState(newKey)                     // one idempotency key per dialog: a double click cannot create two refunds
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const v = validateExchangeRefundForm({ method, note })
    if (!v.ok) { setError(Object.values(v.errors)[0]); return }
    setBusy(true)
    try { await onSubmit(key, v.args); onClose?.() } catch (err) { setError(err.message || "Could not create the refund"); setBusy(false) }
  }
  return (
    <ModalShell open onClose={onClose} busy={busy} width={500} title="Refund the price difference" subtitle={money(amount)}
      footer={(<>
        <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
        <button type="submit" form="xrefund-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Creating..." : "Create the refund"}</button>
      </>)}>
      <form id="xrefund-form" onSubmit={submit} className="flex flex-col" style={{ gap: "10px" }} noValidate>
        <div role="radiogroup" aria-label="How is the refund paid?" className="flex flex-col" style={{ gap: "6px" }}>
          {[
            { v: "razorpay", title: "Through Razorpay (original payment method)", hint: razorpayPossible ? "Needs your Razorpay keys on the server." : "This order was not paid through Razorpay.", off: !razorpayPossible },
            { v: "manual", title: "I pay it myself (bank / UPI / cash)", hint: "You pay it out, then record the payment reference.", off: false },
          ].map((o) => (
            <label key={o.v} className="flex items-start" style={{ gap: "8px", opacity: o.off ? 0.5 : 1, fontFamily: INTER, fontSize: "13px" }}>
              <input type="radio" name="xrefund-method" checked={method === o.v} onChange={() => setMethod(o.v)} disabled={busy || o.off} />
              <span><b>{o.title}</b><span style={{ display: "block", fontSize: "12px", color: "var(--color-muted)" }}>{o.hint}</span></span>
            </label>
          ))}
        </div>
        <div><label style={LABEL_STYLE} htmlFor="xrefund-note">Note for staff (optional)</label><input id="xrefund-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={INPUT_STYLE} /></div>
        {error ? <p style={ERROR_STYLE}>{error}</p> : null}
      </form>
    </ModalShell>
  )
}

/**
 * Phase 10: the REPLACEMENT of an exchange - what is sent, the stock held for it, the price difference, the replacement parcel.
 * The server decides everything (stock reservation, the difference, who may ship when); this panel shows its answer and asks for the next step:
 *   * a price difference the customer owes must be collected (or waived) BEFORE the replacement ships; a difference owed to the customer is
 *     refunded through the normal refund steps (Refund section) or waived - nothing is ever charged or refunded silently;
 *   * shipping the replacement moves no stock (it was reserved when the item was approved);
 *   * the exchange closes by itself once the replacement is delivered and the difference is settled.
 */
const ReplacementPanel = ({ request, onDone }) => {
  const [data, setData] = useState(null)
  const [refunds, setRefunds] = useState([])
  const [names, setNames] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [modal, setModal] = useState(null)               // 'ship' | 'delivered' | 'collect' | 'waive' | 'refund' (every action runs inside its own dialog, which shows the busy state)

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([returnsService.adminReplacement(request.id), returnsService.adminRefundsForRequest(request.id)])
      setData(d); setRefunds(r)
      setNames(await returnsService.variantNames(d.reservations.map((x) => x.variantId)))
      setLoadError("")
    } catch (err) {
      setLoadError(err.message || "Could not load the replacement")
    } finally {
      setLoaded(true)
    }
  }, [request.id])
  useEffect(() => { load() }, [load])

  const bundle = useMemo(() => ({ fulfilment: data && data.fulfilment, adjustment: data && data.adjustment }), [data])
  const state = useMemo(() => replacementAdminState(request, bundle, refunds), [request, bundle, refunds])
  const actions = replacementAdminActions(state)
  const refresh = async () => { await load(); onDone?.() }
  if (request.type !== "exchange" || !loaded) return null
  const f = data && data.fulfilment
  const reservations = (data && data.reservations) || []
  if (!f && reservations.length === 0 && !loadError) return null
  const adj = data && data.adjustment
  const shipments = ((data && data.shipments) || []).filter((s) => s.status !== "cancelled")
  const resByItem = Object.fromEntries(reservations.map((r) => [r.requestItemId, r]))
  const meta = f ? fulfilmentStatusMeta(f.status) : null
  const colors = meta ? toneColors(meta.tone) : null
  const razorpayPossible = String(request.order?.paymentMethod || "").toLowerCase() === "razorpay"

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "14px", padding: "14px" }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px", marginBottom: "4px" }}>
        <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "14px" }}>Replacement</p>
        {meta ? <span style={{ background: colors.bg, color: colors.fg, borderRadius: "9999px", padding: "3px 10px", fontFamily: INTER, fontWeight: 700, fontSize: "11px", letterSpacing: "0.3px" }}>{meta.label}</span> : null}
      </div>
      <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", marginBottom: "10px" }}>
        The stock of each replacement is held from the moment its line is approved and given back if the exchange is cancelled or the returned item fails the check. Shipping moves no stock.
      </p>
      {loadError ? <p style={ERROR_STYLE}>{loadError}</p> : null}

      {f ? (
        <div className="flex flex-col" style={{ gap: "6px", marginBottom: "12px" }}>
          {f.lines.map((l) => (
            <div key={l.id} className="flex items-start justify-between flex-wrap" style={{ gap: "8px", borderTop: "1px solid var(--color-info-subtle)", paddingTop: "6px" }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px" }}>{l.title}{l.variantName ? ` · ${l.variantName}` : ""} <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>x{l.quantity}</span></p>
                <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
                  returned item {money(l.originalUnitPrice)} → replacement {money(l.replacementUnitPrice)} each · difference {l.priceDifference >= 0 ? "+" : "-"}{money(Math.abs(l.priceDifference))}{l.sku ? ` · SKU ${l.sku}` : ""}
                </p>
              </div>
              <span style={{ fontFamily: INTER, fontSize: "12px", fontWeight: 600, color: "var(--color-body)", whiteSpace: "nowrap" }}>{reservationLabel(resByItem[l.requestItemId])}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: "6px", marginBottom: "12px" }}>
          {reservations.map((r) => (
            <div key={r.requestItemId} className="flex items-start justify-between flex-wrap" style={{ gap: "8px", borderTop: "1px solid var(--color-info-subtle)", paddingTop: "6px" }}>
              <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px" }}>{r.variantId ? (names[r.variantId] || r.variantId) : "Main option"} <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>x{r.quantity} · {money(r.unitPrice)} each</span></p>
              <span style={{ fontFamily: INTER, fontSize: "12px", fontWeight: 600, color: "var(--color-body)", whiteSpace: "nowrap" }}>{reservationLabel(r)}</span>
            </div>
          ))}
          <p style={HINT_STYLE}>The replacement record (and the price difference) is created when you prepare the replacement, after the returned item is accepted.</p>
        </div>
      )}

      {adj ? (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "10px 12px", marginBottom: "12px" }}>
          <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px" }}>Price difference</p>
          <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-ink)" }}>{adjustmentAdminLine(adj)}</p>
          {adj.settledAt ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>Settled {fmtDateTime(adj.settledAt)}{adj.reference ? ` · reference ${adj.reference}` : ""}</p> : null}
          {adj.internalNote ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>Staff note: {adj.internalNote}</p> : null}
          {state.shipBlocked ? <p style={{ ...ERROR_STYLE, marginTop: "6px" }}>{state.shipBlocked}</p> : null}
          {state.waitingToClose ? <p style={HINT_STYLE}>The replacement is delivered. The exchange closes by itself once this difference is settled.</p> : null}
          {state.refundActive && adj.status === "open" ? <p style={HINT_STYLE}>A refund of the difference is in progress: finish it in the Refund section below.</p> : null}
          {actions.some((a) => ["collect", "refund", "waive"].includes(a)) ? (
            <div className="flex flex-wrap" style={{ gap: "8px", marginTop: "8px" }}>
              {actions.includes("collect") ? <button type="button" style={PRIMARY_BTN} onClick={() => setModal("collect")}>Record the payment</button> : null}
              {actions.includes("refund") ? <button type="button" style={PRIMARY_BTN} onClick={() => setModal("refund")}>Refund the difference</button> : null}
              {actions.includes("waive") ? <button type="button" style={GHOST_BTN} onClick={() => setModal("waive")}>Waive it</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {request.status === "cancelled" && f && f.status === "cancelled" ? (
        <div style={{ border: "1px solid var(--color-error-subtle)", background: "var(--color-error-subtle)", borderRadius: "10px", padding: "10px 12px", marginBottom: "12px" }}>
          <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px", color: "var(--color-error)" }}>Cancelled after the returned item came back</p>
          <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-ink)" }}>The customer has no replacement and has not been paid for the item(s) they returned. Refund them here, or settle it another way.</p>
          <div style={{ marginTop: "8px" }}>
            <button type="button" style={PRIMARY_BTN} onClick={() => setModal("orderRefund")}>Refund the returned item(s)</button>
          </div>
        </div>
      ) : null}

      {shipments.length ? (
        <div className="flex flex-col" style={{ gap: "8px", marginBottom: "12px" }}>
          {shipments.map((s) => <ReturnParcel key={s.id} shipment={s} onChanged={refresh} />)}
        </div>
      ) : null}

      {actions.includes("ship") || actions.includes("mark_delivered") ? (
        <div className="flex flex-wrap" style={{ gap: "8px" }}>
          {actions.includes("ship") ? <button type="button" style={PRIMARY_BTN} onClick={() => setModal("ship")}>Ship the replacement</button> : null}
          {actions.includes("mark_delivered") ? <button type="button" style={PRIMARY_BTN} onClick={() => setModal("delivered")}>Mark as delivered</button> : null}
        </div>
      ) : null}

      {modal === "ship" && f ? (
        <ShipReplacementModal request={request} lines={f.lines.map((l) => ({ text: `${l.title}${l.variantName ? ` · ${l.variantName}` : ""} x${l.quantity}` }))} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh() }} />
      ) : null}
      {modal === "delivered" ? (
        <DeliveredModal onClose={() => setModal(null)} onSubmit={(iso, note) => returnsService.markReplacementDelivered(request.id, { deliveredAt: iso, note: note || null }).then(() => { toast.success("Replacement marked as delivered"); refresh() })} />
      ) : null}
      {modal === "collect" && adj ? (
        <TextPromptModal title="Record the payment" subtitle={`${request.requestNo} · ${money(adj.amount)} owed by the customer`} label="Payment reference (UPI / bank transaction id, or how and when they paid)" maxLength={200}
          confirmLabel="Mark as collected" hint="Collect the difference yourself (nothing is charged automatically), then record it here. The replacement can ship after this."
          onClose={() => setModal(null)} onSubmit={(text) => returnsService.settleAdjustment(request.id, "collected", { reference: text }).then(() => { toast.success("Payment recorded"); refresh() })} />
      ) : null}
      {modal === "waive" && adj ? (
        <TextPromptModal title="Waive the price difference" subtitle={`${request.requestNo} · ${money(adj.amount)}`} label="Why is it waived? (staff only)" confirmLabel="Waive it" danger
          onClose={() => setModal(null)} onSubmit={(text) => returnsService.settleAdjustment(request.id, "waived", { note: text }).then(() => { toast.success("Price difference waived"); refresh() })} />
      ) : null}
      {modal === "orderRefund" && f ? (
        <OrderRefundModal orderId={request.orderId} razorpayPossible={razorpayPossible} requestId={request.id}
          defaultAmount={Math.round(f.lines.reduce((s, l) => s + l.originalUnitPrice * l.quantity, 0) * 100) / 100} defaultReason="the item you returned"
          onClose={() => setModal(null)} onDone={() => { setModal(null); refresh() }} />
      ) : null}
      {modal === "refund" && adj ? (
        <RefundDifferenceModal amount={adj.amount} razorpayPossible={razorpayPossible} onClose={() => setModal(null)}
          onSubmit={(key, args) => returnsService.createExchangeRefund({ requestId: request.id, key, method: args.method, note: args.note || null }).then((r) => { toast.success(`Refund ${r.refundNo} created - send or record it in the Refund section`); refresh() })} />
      ) : null}
    </div>
  )
}

export default ReplacementPanel