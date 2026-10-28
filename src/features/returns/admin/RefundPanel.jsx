import { useCallback, useEffect, useState } from "react"
import { toast } from "react-toastify"
import { returnsService } from "../../../services/returns"
import { formatMoney, refundBreakdownRows, validateRefundForm } from "../refundModel"
import RefundCard from "./RefundCard"
import ModalShell from "../../../components/Common/ModalShell"
import { ERROR_STYLE, GHOST_BTN, HINT_STYLE, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN } from "../../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const EMPTY_FORM = { method: "", includeShipping: null, adjustment: "", adjustmentNote: "", note: "" }
const newKey = () => {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return `refund-${c.randomUUID()}`
  return `refund-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Refunds of ONE return request (Phase 9); for an exchange it lists the refund of the price difference (created in the Replacement panel). Shows what the server calculated (never a number typed here), lets the admin choose
 * "pay back through Razorpay" or "I pay it myself", then follows the refund until the gateway confirms it or the admin records
 * the manual reference. A refund is paid out only by those two things - never because a button was pressed.
 * The server enforces every rule (cap, one refund per request, idempotency); this panel only explains and asks.
 */
const RefundPanel = ({ request, onDone }) => {
  const [refunds, setRefunds] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [form, setForm] = useState(EMPTY_FORM)
  const [key, setKey] = useState(newKey)                   // one idempotency key per form: a double click cannot create two refunds
  const [calc, setCalc] = useState(null)
  const [calcError, setCalcError] = useState("")
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [confirmModal, setConfirmModal] = useState(false)

  const load = useCallback(async () => {
    try {
      setRefunds(await returnsService.adminRefundsForRequest(request.id))
      setLoadError("")
    } catch (err) {
      setLoadError(err.message || "Could not load the refunds")
    } finally {
      setLoaded(true)
    }
  }, [request.id])
  useEffect(() => { load() }, [load])

  const active = refunds.find((r) => r.status !== "failed") || null
  const canCreate = loaded && !active && request.type === "return" && ["inspection_passed", "refund_pending"].includes(request.status)
  const adjNumber = Number(form.adjustment)
  const adj = Number.isFinite(adjNumber) ? adjNumber : 0

  // the server's answer for the current choices (debounced: the admin types the adjustment)
  useEffect(() => {
    if (!canCreate) return undefined
    let alive = true
    const timer = setTimeout(() => {
      returnsService.refundCalculate(request.id, { includeShipping: form.includeShipping, adjustment: adj })
        .then((c) => { if (alive) { setCalc(c); setCalcError("") } })
        .catch((err) => { if (alive) { setCalc(null); setCalcError(err.message || "Could not calculate the refund") } })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [canCreate, request.id, form.includeShipping, adj])

  // Smart-default payment method based on server calculation
  useEffect(() => {
    if (calc && (!form.method || (form.method === "razorpay" && !calc.razorpayPossible))) {
      setForm((f) => ({
        ...f,
        method: calc.razorpayPossible ? "razorpay" : "manual",
      }))
    }
  }, [calc, form.method])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const refresh = async () => { await load(); onDone?.() }

  const handleInitiateCreate = () => {
    if (busy) return
    if (!calc) {
      toast.error("Refund calculation is still loading. Please wait a moment.")
      return
    }
    const v = validateRefundForm(form)
    setErrors(v.errors)
    if (!v.ok) {
      const firstErr = v.errors.method || v.errors.adjustment || v.errors.adjustmentNote || v.errors.note
      if (firstErr) toast.error(firstErr)
      return
    }
    if (v.args.method === "razorpay" && !calc.razorpayPossible) {
      setErrors({ method: "This order was not paid through Razorpay - choose a manual refund" })
      toast.error("This order was not paid through Razorpay - choose a manual refund")
      return
    }
    setConfirmModal(true)
  }

  const executeCreate = async () => {
    if (busy || !calc) return
    const v = validateRefundForm(form)
    if (!v.ok) {
      setErrors(v.errors)
      toast.error(Object.values(v.errors)[0] || "Validation failed")
      setConfirmModal(false)
      return
    }
    setBusy(true)
    try {
      const r = await returnsService.createRefund({
        requestId: request.id,
        key,
        method: v.args.method,
        includeShipping: v.args.includeShipping,
        adjustment: v.args.adjustment,
        adjustmentNote: v.args.adjustmentNote,
        note: v.args.note,
      })
      toast.success(r.created ? `Refund ${r.refundNo} created` : `Refund ${r.refundNo} already existed`)
      setKey(newKey())
      setForm(EMPTY_FORM)
      setErrors({})
      setConfirmModal(false)
      await refresh()
    } catch (err) {
      console.error("Refund creation error:", err)
      toast.error(err.message || "Could not create the refund")
    } finally {
      setBusy(false)
    }
  }

  const rows = refundBreakdownRows(calc)
  // a return shows the panel from the moment it passes inspection; an exchange only when a price-difference refund exists (it is created in the Replacement panel)
  const showPanel = loaded && (refunds.length > 0 || (request.type === "return" && (canCreate || ["inspection_passed", "refund_pending", "refunded"].includes(request.status))))
  if (!showPanel) return null

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "14px", padding: "14px" }}>
      <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>{request.type === "exchange" ? "Refund of the price difference" : "Refund"}</p>
      <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", marginBottom: "10px" }}>
        The amount comes from what the customer paid for these items - never from today's prices. It is marked paid out only when Razorpay confirms it or you record the payment.
      </p>
      {loadError ? <p style={ERROR_STYLE}>{loadError}</p> : null}

      {canCreate ? (
        <div className="flex flex-col" style={{ gap: "10px" }}>
          {calcError ? <p style={ERROR_STYLE}>{calcError}</p> : null}
          {calc ? (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: INTER, fontSize: "13px" }}>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={{ borderTop: r.key === "total" ? "2px solid var(--color-ink)" : "1px solid var(--color-info-subtle)" }}>
                      <td style={{ padding: "6px 0", verticalAlign: "top" }}>
                        <span style={{ fontWeight: r.key === "total" ? 800 : 600 }}>{r.label}</span>
                        {r.note ? <span style={{ display: "block", fontSize: "11px", color: "var(--color-muted)" }}>{r.note}</span> : null}
                      </td>
                      <td style={{ padding: "6px 0", textAlign: "right", fontWeight: r.key === "total" ? 800 : 600, whiteSpace: "nowrap", verticalAlign: "top" }}>{formatMoney(r.amount, calc.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {calc.shippingEligible ? (
                <label className="flex items-center" style={{ gap: "8px", fontFamily: INTER, fontSize: "13px" }}>
                  <input type="checkbox" checked={form.includeShipping !== false} onChange={(e) => set("includeShipping", e.target.checked)} disabled={busy} />
                  Refund the shipping charge ({formatMoney(calc.shippingCharge, calc.currency)}) - every item is coming back for a seller-fault reason
                </label>
              ) : null}

              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                <div>
                  <label style={LABEL_STYLE} htmlFor="rf-adj">Adjustment in rupees (optional; - for a deduction)</label>
                  <input id="rf-adj" inputMode="decimal" value={form.adjustment} onChange={(e) => set("adjustment", e.target.value)} style={INPUT_STYLE} disabled={busy} placeholder="0" />
                  {errors.adjustment ? <p style={ERROR_STYLE}>{errors.adjustment}</p> : null}
                </div>
                <div>
                  <label style={LABEL_STYLE} htmlFor="rf-adjn">Reason for the adjustment (the customer reads it)</label>
                  <input id="rf-adjn" value={form.adjustmentNote} onChange={(e) => set("adjustmentNote", e.target.value)} style={INPUT_STYLE} maxLength={300} disabled={busy} />
                  {errors.adjustmentNote ? <p style={ERROR_STYLE}>{errors.adjustmentNote}</p> : null}
                </div>
              </div>

              <div role="radiogroup" aria-label="How is the refund paid?">
                <p style={LABEL_STYLE}>How is it paid back?</p>
                <div className="flex flex-col" style={{ gap: "6px" }}>
                  {[
                    { v: "razorpay", title: "Through Razorpay (original payment method)", hint: calc.razorpayPossible ? "Needs your Razorpay keys on the server. Razorpay sends it back to the customer's card / UPI." : "This order was not paid through Razorpay.", off: !calc.razorpayPossible },
                    { v: "manual", title: "I pay it myself (bank / UPI / cash)", hint: "You pay it out, then record the payment reference here.", off: false },
                  ].map((o) => (
                    <label key={o.v} className="flex items-start" style={{ gap: "8px", opacity: o.off ? 0.5 : 1, fontFamily: INTER, fontSize: "13px" }}>
                      <input type="radio" name="refund-method" checked={form.method === o.v} onChange={() => set("method", o.v)} disabled={busy || o.off} />
                      <span><b>{o.title}</b><span style={{ display: "block", fontSize: "12px", color: "var(--color-muted)" }}>{o.hint}</span></span>
                    </label>
                  ))}
                </div>
                {errors.method ? <p style={ERROR_STYLE}>{errors.method}</p> : null}
              </div>

              <div>
                <label style={LABEL_STYLE} htmlFor="rf-note">Note for staff (optional)</label>
                <input id="rf-note" value={form.note} onChange={(e) => set("note", e.target.value)} style={INPUT_STYLE} maxLength={1000} disabled={busy} />
              </div>
              <div>
                <button
                  type="button"
                  id="create-refund-btn"
                  onClick={handleInitiateCreate}
                  disabled={busy}
                  style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}
                >
                  {busy ? "Working..." : `Create refund of ${formatMoney(calc.amount, calc.currency)}`}
                </button>
              </div>
            </>
          ) : !calcError ? <p style={HINT_STYLE}>Calculating...</p> : null}
        </div>
      ) : null}

      {/* Confirmation Modal */}
      {confirmModal && calc ? (
        <ModalShell
          open
          onClose={() => { if (!busy) setConfirmModal(false) }}
          busy={busy}
          width={480}
          title="Confirm Refund"
          subtitle={`Return #${request.requestNo || ""}`}
          footer={(
            <>
              <button
                type="button"
                onClick={() => setConfirmModal(false)}
                disabled={busy}
                style={GHOST_BTN}
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-execute-refund"
                onClick={executeCreate}
                disabled={busy}
                style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}
              >
                {busy ? "Creating refund..." : `Confirm refund of ${formatMoney(calc.amount, calc.currency)}`}
              </button>
            </>
          )}
        >
          <div className="flex flex-col" style={{ gap: "14px", fontFamily: INTER, fontSize: "13px" }}>
            <div style={{ background: "var(--color-surface-muted, #F4EFEA)", padding: "16px", borderRadius: "12px", textAlign: "center" }}>
              <p style={{ fontSize: "12px", color: "var(--color-muted, #78716C)", marginBottom: "4px" }}>Refund Amount</p>
              <p style={{ fontSize: "28px", fontWeight: 800, color: "var(--color-ink, #1C1917)" }}>
                {formatMoney(calc.amount, calc.currency)}
              </p>
              <p style={{ fontSize: "12px", color: "var(--color-body, #44403C)", marginTop: "4px" }}>
                Method: <b>{form.method === "razorpay" ? "Through Razorpay" : "Manual (bank / UPI / cash)"}</b>
              </p>
            </div>

            <p style={{ color: "var(--color-body, #44403C)", lineHeight: 1.5 }}>
              {form.method === "razorpay"
                ? "This refund will be registered and queued to be sent to Razorpay."
                : "You will pay out this refund yourself and record the payment reference in the next step."}
            </p>

            {form.adjustment && Number(form.adjustment) !== 0 ? (
              <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(0,0,0,0.03)", border: "1px solid var(--color-border)" }}>
                <p style={{ fontWeight: 600 }}>Adjustment: {formatMoney(form.adjustment, calc.currency)}</p>
                {form.adjustmentNote ? <p style={{ fontSize: "12px", color: "var(--color-muted)" }}>Reason: {form.adjustmentNote}</p> : null}
              </div>
            ) : null}

            {form.note ? (
              <p style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                Staff note: {form.note}
              </p>
            ) : null}
          </div>
        </ModalShell>
      ) : null}

      {refunds.length > 0 ? (
        <div className="flex flex-col" style={{ gap: "10px", marginTop: canCreate ? "14px" : 0 }}>
          {refunds.map((r) => <RefundCard key={r.id} refund={r} onChanged={refresh} />)}
        </div>
      ) : null}
    </div>
  )
}

export default RefundPanel