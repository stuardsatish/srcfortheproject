import { useState } from "react"
import { toast } from "react-toastify"
import { returnsService } from "../../../services/returns"
import { formatMoney, gatewayStateLabel, refundAdminActions, refundMethodLabel, refundStatusMeta } from "../refundModel"
import TextPromptModal from "./TextPromptModal"
import { GHOST_BTN, PRIMARY_BTN, fmtDateTime, toneColors } from "../../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

/** "Paid out" / "Pending" / "Failed" pill (the refund's own states: pending, succeeded, failed) */
export const RefundChip = ({ status }) => {
  const meta = refundStatusMeta(status)
  const c = toneColors(meta.tone)
  const word = status === "pending" ? "Pending" : status === "succeeded" ? "Paid out" : status === "failed" ? "Failed" : meta.label
  return <span style={{ background: c.bg, color: c.fg, borderRadius: "9999px", padding: "3px 10px", fontFamily: INTER, fontWeight: 700, fontSize: "11px", letterSpacing: "0.3px", whiteSpace: "nowrap" }}>{word}</span>
}

/**
 * ONE refund as the admin works with it: amount and how it splits, method, state, the gateway state of a Razorpay refund, and the buttons the state allows
 * (send to Razorpay / check the status / "I paid it" with the reference / it failed / cancel it). Used for the refunds of a return request (RefundPanel), of an
 * exchange's price difference (also RefundPanel) and of a whole order (OrderRefundsPanel in the order drawer). A refund is paid out only when the gateway
 * confirms it or the admin records the payment - never because a button was pressed. The server enforces every rule; `onChanged()` reloads the owner.
 */
const RefundCard = ({ refund: r, onChanged }) => {
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState(null)               // "paid" | "failed" | "void" while a small dialog is open
  const actions = refundAdminActions(r)
  const run = async (fn, okText) => {
    if (busy) return
    setBusy(true)
    try { const x = await fn(); toast.success(typeof okText === "function" ? okText(x) : okText); await onChanged?.() } catch (err) { toast.error(err.message || "Could not do that") } finally { setBusy(false) }
  }
  const kindText = r.kind === "exchange_difference" ? "price difference of an exchange" : r.kind === "order" ? `order refund${r.reason ? ` - ${r.reason}` : ""}` : ""

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "12px" }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px" }}>
        <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: "13px" }}>{r.refundNo}</span>
        <RefundChip status={r.status} />
      </div>
      <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "16px", marginTop: "4px" }}>{formatMoney(r.amount, r.currency)}</p>
      {kindText ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>{kindText}</p> : null}
      <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
        {refundMethodLabel(r.method)} · items {formatMoney(r.itemsAmount, r.currency)}{r.shippingAmount ? ` + shipping ${formatMoney(r.shippingAmount, r.currency)}` : ""}{r.adjustmentAmount ? ` ${r.adjustmentAmount > 0 ? "+" : "-"} adjustment ${formatMoney(Math.abs(r.adjustmentAmount), r.currency)}${r.adjustmentNote ? ` (${r.adjustmentNote})` : ""}` : ""}
      </p>
      <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
        Created {fmtDateTime(r.initiatedAt)}{r.completedAt ? ` · paid out ${fmtDateTime(r.completedAt)}` : ""}{r.reference ? ` · reference ${r.reference}` : ""}
      </p>
      {r.method === "razorpay" && r.status === "pending" && r.gatewayState ? <p style={{ fontFamily: INTER, fontSize: "12px", fontWeight: 600, color: r.gatewayState === "unknown" ? "var(--color-error)" : "var(--color-accent-strong)" }}>{gatewayStateLabel(r.gatewayState)}{r.gatewayRefundId ? ` (${r.gatewayRefundId})` : ""}</p> : null}
      {r.failureReason ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-error)" }}>Failure: {r.failureReason}</p> : null}
      {r.gatewayError ? <p style={{ fontFamily: INTER, fontSize: "11px", color: "var(--color-muted)", wordBreak: "break-word" }}>Gateway said: {r.gatewayError}</p> : null}
      {r.internalNote ? <p style={{ fontFamily: INTER, fontSize: "12px" }}>Staff note: {r.internalNote}</p> : null}
      {actions.length ? (
        <div className="flex flex-wrap" style={{ gap: "8px", marginTop: "10px" }}>
          {actions.includes("send") ? <button type="button" disabled={busy} style={PRIMARY_BTN} onClick={() => { if (window.confirm(`Send ${formatMoney(r.amount, r.currency)} to Razorpay now? It cannot be sent twice.`)) run(() => returnsService.sendRefund(r.id), (x) => x.message || "Sent to Razorpay") }}>Send to Razorpay</button> : null}
          {actions.includes("check_status") ? <button type="button" disabled={busy} style={PRIMARY_BTN} onClick={() => run(() => returnsService.checkRefund(r.id), (x) => x.message || "Status refreshed")}>Check status with Razorpay</button> : null}
          {actions.includes("mark_paid") ? <button type="button" disabled={busy} style={PRIMARY_BTN} onClick={() => setPrompt("paid")}>I paid it - record the reference</button> : null}
          {actions.includes("mark_failed") ? <button type="button" disabled={busy} style={GHOST_BTN} onClick={() => setPrompt("failed")}>It failed</button> : null}
          {actions.includes("void") ? <button type="button" disabled={busy} style={{ ...GHOST_BTN, color: "var(--color-error)" }} onClick={() => setPrompt("void")}>Cancel this refund</button> : null}
        </div>
      ) : null}
      {r.events.length ? (
        <details style={{ marginTop: "8px" }}>
          <summary style={{ fontFamily: INTER, fontSize: "12px", fontWeight: 600, cursor: "pointer", color: "var(--color-link)" }}>History ({r.events.length})</summary>
          <ol style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {r.events.map((e) => (
              <li key={e.id} style={{ fontFamily: INTER, fontSize: "11px", color: "var(--color-body)", paddingBottom: "3px" }}>
                <b style={{ color: "var(--color-ink)" }}>{e.type.replace(/_/g, " ")}</b> · {fmtDateTime(e.createdAt)} · {e.actorRole}{e.note ? ` · ${e.note}` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {prompt === "paid" ? (
        <TextPromptModal title="Record the payment" subtitle={`${r.refundNo} · ${formatMoney(r.amount, r.currency)}`} label="Payment reference (bank / UPI transaction id, or how it was paid)" maxLength={200}
          confirmLabel="Mark as paid out" onClose={() => setPrompt(null)} hint="The customer is told the refund is complete as soon as you save this."
          onSubmit={(text) => returnsService.markRefund(r.id, "succeeded", { reference: text }).then(() => { toast.success("Refund recorded as paid out"); onChanged?.() })} />
      ) : null}
      {prompt === "failed" ? (
        <TextPromptModal title="The refund failed" subtitle={r.refundNo} label="What went wrong? (the customer reads this)" confirmLabel="Record the failure" danger onClose={() => setPrompt(null)}
          onSubmit={(text) => returnsService.markRefund(r.id, "failed", { note: text }).then(() => { toast.success("Refund marked as failed"); onChanged?.() })} />
      ) : null}
      {prompt === "void" ? (
        <TextPromptModal title="Cancel this refund" subtitle={`${r.refundNo} - nothing has been paid out yet`} label="Why is it cancelled?" confirmLabel="Cancel the refund" danger onClose={() => setPrompt(null)}
          onSubmit={(text) => returnsService.voidRefund(r.id, text).then(() => { toast.success("Refund cancelled"); onChanged?.() })} />
      ) : null}
    </div>
  )
}

export default RefundCard