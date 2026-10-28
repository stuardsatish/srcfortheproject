import { useCallback, useEffect, useState } from "react"
import { toast } from "react-toastify"
import { returnsService } from "../../../services/returns"
import { adminActions, adminStatusLabel, itemStatusLabel, requestTypeLabel } from "../requestModel"
import { stockEffectText } from "../../inventory/inventoryModel"
import { RequestStatusChip } from "../RequestBits"
import EvidenceGallery from "../EvidenceGallery"
import DecisionPanel from "./DecisionPanel"
import LogisticsPanel from "./LogisticsPanel"
import InspectionPanel from "./InspectionPanel"
import RefundPanel from "./RefundPanel"
import ReplacementPanel from "./ReplacementPanel"
import TextPromptModal from "./TextPromptModal"
import ModalShell from "../../../components/Common/ModalShell"
import { ShipmentStatusChip } from "../../orders/shipping/ShipmentBits"
import { ERROR_STYLE, GHOST_BTN, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN, fmtDate, fmtDateTime, formatINR, toLocalInputValue } from "../../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"
const Section = ({ title, children }) => (
  <div>
    <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--color-body)", marginBottom: "6px" }}>{title}</p>
    {children}
  </div>
)
const addressText = (a) => (a && typeof a === "object" ? [a.street, a.city, a.state, a.pincode].filter(Boolean).join(", ") : String(a || ""))

/** "I have received the parcel": when, and an optional note the customer can read. */
function ReceivedModal({ onSubmit, onClose }) {
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
    <ModalShell open onClose={onClose} busy={busy} width={460} title="Parcel received"
      footer={(<>
        <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
        <button type="submit" form="received-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Mark received"}</button>
      </>)}>
      <form id="received-form" onSubmit={submit} className="flex flex-col" style={{ gap: "10px" }} noValidate>
        <div><label style={LABEL_STYLE} htmlFor="rcv-when">When did it arrive?</label><input id="rcv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={INPUT_STYLE} /></div>
        <div><label style={LABEL_STYLE} htmlFor="rcv-note">Note for the customer (optional)</label><input id="rcv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={INPUT_STYLE} /></div>
        {error ? <p style={ERROR_STYLE}>{error}</p> : null}
      </form>
    </ModalShell>
  )
}

/**
 * Everything the admin needs for ONE return / exchange request: who and what, the evidence, the policy deadline, the original shipment,
 * the decision per item, the return logistics, the inspection, the history - and the next step buttons the state machine allows.
 */
const RequestDetail = ({ request, onChanged, onSwitchType }) => {
  const [parcels, setParcels] = useState([])
  const [outbound, setOutbound] = useState([])
  const [prompt, setPrompt] = useState(null)             // { kind } while a small dialog is open
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)                    // bumped on every change so the refund / replacement panels load again
  const [variantNames, setVariantNames] = useState({})   // "White" instead of "var_17000..." in the exchange lines
  const actions = adminActions(request)

  const loadParcels = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([returnsService.returnShipments(request.id), returnsService.outboundShipments(request.orderId)])
      setParcels(r); setOutbound(o)
    } catch { /* the request itself is still shown; the parcel blocks just stay empty */ }
  }, [request.id, request.orderId])
  useEffect(() => { loadParcels() }, [loadParcels])
  const wantedVariants = request.type === "exchange" ? request.items.map((i) => i.replacementVariantId).filter(Boolean).join(",") : ""
  useEffect(() => {
    if (!wantedVariants) return undefined
    let alive = true
    returnsService.variantNames(wantedVariants.split(",")).then((n) => { if (alive) setVariantNames(n) })
    return () => { alive = false }
  }, [wantedVariants])

  const refresh = () => { loadParcels(); setTick((t) => t + 1); onChanged?.() }
  const run = async (fn, okMessage) => {
    if (busy) return
    setBusy(true)
    try { await fn(); toast.success(okMessage); refresh() } catch (err) { toast.error(err.message || "Could not do that") } finally { setBusy(false) }
  }
  const confirmMove = (to, text, ok) => { if (window.confirm(text)) run(() => returnsService.transition(request.id, to), ok) }

  const o = request.order
  const deadlines = request.items.map((i) => i.policyDeadline).filter(Boolean).sort()
  const showDecision = request.status === "pending_review" || request.status === "needs_info"
  const showLogistics = !["pending_review", "needs_info", "rejected", "cancelled"].includes(request.status) && request.items.some((i) => i.status !== "rejected" && i.status !== "cancelled")
  const returnShown = showLogistics && ["approved", "awaiting_return_shipment", "return_in_transit", "return_received", "inspection_pending", "inspection_passed", "inspection_failed", "refund_pending", "refunded", "replacement_pending", "replacement_shipped", "replacement_delivered", "closed"].includes(request.status)

  return (
    <div className="flex flex-col" style={{ gap: "18px" }}>
      <div className="flex items-start justify-between flex-wrap" style={{ gap: "10px" }}>
        <div>
          <p style={{ fontFamily: MONO, fontWeight: 800, fontSize: "18px" }}>{request.requestNo}</p>
          <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>{requestTypeLabel(request.type)} · submitted {fmtDateTime(request.createdAt)}</p>
        </div>
        <RequestStatusChip status={request.status} staff />
      </div>

      <Section title="Customer & order">
        <div style={{ fontFamily: INTER, fontSize: "13px", lineHeight: 1.6 }}>
          <p><b>{o?.customerName || "Guest"}</b>{o?.customerEmail ? ` · ${o.customerEmail}` : ""}{request.contactPhone || o?.customerPhone ? ` · ${request.contactPhone || o.customerPhone}` : ""}</p>
          <p>Order <span style={{ fontFamily: MONO }}>{request.orderId}</span> · {o ? `${o.paymentMethod || "payment n/a"} (${o.paymentStatus || "n/a"}) · ${formatINR(o.total)}` : ""}</p>
          <p>Delivered {fmtDateTime(request.deliveredAt || o?.deliveredAt)}{deadlines.length ? ` · policy deadline ${fmtDate(deadlines[0])}${deadlines.length > 1 && deadlines[deadlines.length - 1] !== deadlines[0] ? ` – ${fmtDate(deadlines[deadlines.length - 1])}` : ""}` : ""}</p>
          {o?.address ? <p style={{ color: "var(--color-body)" }}>{addressText(o.address)}</p> : null}
        </div>
      </Section>

      <Section title={`Items (${request.items.length})`}>
        <div className="flex flex-col" style={{ gap: "8px" }}>
          {request.items.map((i) => (
            <div key={i.id} style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "10px 12px" }}>
              <div className="flex items-start justify-between" style={{ gap: "10px" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px" }}>{i.title}{i.variantName ? ` · ${i.variantName}` : ""}</p>
                  <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>Quantity {i.quantity} of {i.orderedQuantity || "?"} · bought at {formatINR(i.unitPrice)} each{i.condition ? ` · condition: ${i.condition}` : ""}</p>
                  {request.type === "exchange" ? (
                    <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>Wants: {i.replacementVariantId ? (variantNames[i.replacementVariantId] || `variant ${i.replacementVariantId}`) : "the main option"} x{i.replacementQty || i.quantity}{i.priceDifference != null ? ` · estimated difference ${i.priceDifference >= 0 ? "+" : "-"}${formatINR(Math.abs(i.priceDifference))} (an estimate: the final difference is worked out when the replacement is prepared, and is never charged or refunded automatically)` : ""}</p>
                  ) : null}
                  {i.decisionNote ? <p style={{ fontFamily: INTER, fontSize: "12px" }}>Decision note: {i.decisionNote}</p> : null}
                  {i.inspectionNote ? <p style={{ fontFamily: INTER, fontSize: "12px" }}>Inspection note: {i.inspectionNote}</p> : null}
                  {stockEffectText(i.stockEffect) ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>Returned units: {stockEffectText(i.stockEffect)}</p> : null}
                </div>
                <span style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", whiteSpace: "nowrap", color: i.status === "rejected" || i.status === "failed" ? "var(--color-error)" : i.status === "approved" || i.status === "passed" ? "var(--color-success)" : "var(--color-body)" }}>{itemStatusLabel(i.status)}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Reason">
        <p style={{ fontFamily: INTER, fontSize: "13px" }}><b>{request.reasonCode.replace(/_/g, " ")}</b>{request.description ? ` — ${request.description}` : ""}</p>
        {request.evidence.length ? <div style={{ marginTop: "8px" }}><EvidenceGallery paths={request.evidence.map((e) => e.path)} size={84} /></div> : <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-muted)" }}>No photos attached.</p>}
      </Section>

      {outbound.length ? (
        <Section title="Original shipment">
          {outbound.map((s) => (
            <p key={s.id} style={{ fontFamily: INTER, fontSize: "13px" }}>{s.courierName || "Courier"}{s.trackingNumber ? ` · ${s.trackingNumber}` : ""} · <ShipmentStatusChip status={s.status} small /></p>
          ))}
        </Section>
      ) : null}

      {request.customerNote ? <Section title="Last message to the customer"><p style={{ fontFamily: INTER, fontSize: "13px", whiteSpace: "pre-wrap" }}>{request.customerNote}</p></Section> : null}
      {request.internalNote ? <Section title="Internal note (staff only)"><p style={{ fontFamily: INTER, fontSize: "13px", whiteSpace: "pre-wrap" }}>{request.internalNote}</p></Section> : null}

      {showDecision ? <DecisionPanel request={request} onDone={refresh} /> : null}
      {returnShown ? <LogisticsPanel key={`${request.id}-${request.status}-${parcels.length}`} request={request} parcels={parcels} onDone={refresh} /> : null}
      {request.status === "inspection_pending" ? <InspectionPanel request={request} onDone={refresh} /> : null}
      {request.type === "exchange" ? <ReplacementPanel key={`${request.id}-replacement-${tick}`} request={request} onDone={refresh} /> : null}
      <RefundPanel key={`${request.id}-refund-${tick}`} request={request} onDone={refresh} />

      <Section title="Next step">
        <div className="flex flex-wrap" style={{ gap: "8px" }}>
          {actions.includes("needs_info") ? <button type="button" disabled={busy} style={GHOST_BTN} onClick={() => setPrompt({ kind: "needs_info" })}>Ask for information</button> : null}
          {actions.includes("back_to_review") ? <button type="button" disabled={busy} style={GHOST_BTN} onClick={() => run(() => returnsService.transition(request.id, "pending_review"), "Back in review")}>Back to review</button> : null}
          {actions.includes("in_transit") ? <button type="button" disabled={busy} style={GHOST_BTN} onClick={() => confirmMove("return_in_transit", "Mark the return parcel as on its way?", "Marked in transit")}>Mark in transit</button> : null}
          {actions.includes("received") ? <button type="button" disabled={busy} style={PRIMARY_BTN} onClick={() => setPrompt({ kind: "received" })}>Mark parcel received</button> : null}
          {actions.includes("refund") ? <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-body)", alignSelf: "center" }}>The refund is created in the Refund section above.</p> : null}
          {actions.includes("replacement_pending") ? <button type="button" disabled={busy} style={PRIMARY_BTN} onClick={() => confirmMove("replacement_pending", "Prepare the replacement? This works out the price difference between the returned item and the replacement.", "Replacement is being prepared")}>Prepare the replacement</button> : null}
          {actions.includes("replacement") ? <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-body)", alignSelf: "center" }}>The replacement is shipped, settled and delivered in the Replacement section above.</p> : null}
          {actions.includes("close") ? <button type="button" disabled={busy} style={GHOST_BTN} onClick={() => confirmMove("closed", "Close this request? It cannot be changed afterwards.", "Request closed")}>Close request</button> : null}
          {actions.includes("message") ? <button type="button" disabled={busy} style={GHOST_BTN} onClick={() => setPrompt({ kind: "message" })}>Message the customer</button> : null}
          {actions.includes("cancel") ? <button type="button" disabled={busy} style={{ ...GHOST_BTN, color: "var(--color-error)" }} onClick={() => setPrompt({ kind: "cancel" })}>Cancel request</button> : null}
          {["pending_review", "needs_info", "approved"].includes(request.status) ? (
            <button
              type="button"
              disabled={busy}
              style={GHOST_BTN}
              onClick={async () => {
                const nextType = request.type === "return" ? "exchange" : "return"
                if (window.confirm(`Switch this request from ${requestTypeLabel(request.type)} to ${requestTypeLabel(nextType)}?`)) {
                  if (onSwitchType) {
                    await onSwitchType(nextType)
                    refresh()
                  }
                }
              }}
            >
              Switch to {request.type === "return" ? "Exchange" : "Return"}
            </button>
          ) : null}
          {actions.length === 0 ? <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-muted)" }}>This request is {adminStatusLabel(request.status).toLowerCase()}; nothing more can be done.</p> : null}
        </div>
      </Section>

      <Section title="History">
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {request.events.map((e) => (
            <li key={e.id} style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", paddingBottom: "6px" }}>
              <b style={{ color: e.internal ? "var(--color-accent-strong)" : "var(--color-ink)" }}>{e.to ? adminStatusLabel(e.to) : e.internal ? "Internal note" : "Message"}</b>
              {" · "}{fmtDateTime(e.createdAt)} · {e.actorRole}{e.note ? ` · ${e.note}` : ""}{e.internal ? " (staff only)" : ""}
            </li>
          ))}
        </ol>
      </Section>

      {prompt?.kind === "needs_info" ? (
        <TextPromptModal title="Ask the customer for information" label="What do you need? (the customer reads this)" confirmLabel="Send request" onClose={() => setPrompt(null)}
          onSubmit={(text) => returnsService.transition(request.id, "needs_info", { customerNote: text }).then(() => { toast.success("The customer was asked"); refresh() })} />
      ) : null}
      {prompt?.kind === "message" ? (
        <TextPromptModal title="Message the customer" label="Message (the customer reads this)" confirmLabel="Send" onClose={() => setPrompt(null)}
          onSubmit={(text) => returnsService.message(request.id, text).then(() => { toast.success("Message sent"); refresh() })} />
      ) : null}
      {prompt?.kind === "note" ? (
        <TextPromptModal title="Internal note" label="Note (staff only - the customer never sees it)" required={false} initial={request.internalNote} maxLength={2000} confirmLabel="Save note" onClose={() => setPrompt(null)}
          onSubmit={(text) => returnsService.internalNote(request.id, text).then(() => { toast.success("Note saved"); refresh() })} />
      ) : null}
      {prompt?.kind === "cancel" ? (
        <TextPromptModal title="Cancel this request" subtitle="The items become available to request again." label="Reason (the customer reads this)" required={false} confirmLabel="Cancel request" danger onClose={() => setPrompt(null)}
          onSubmit={(text) => returnsService.transition(request.id, "cancelled", { customerNote: text || null }).then(() => { toast.success("Request cancelled"); refresh() })} />
      ) : null}
      {prompt?.kind === "received" ? (
        <ReceivedModal onClose={() => setPrompt(null)} onSubmit={(iso, note) => returnsService.markReceived(request.id, { receivedAt: iso, note: note || null }).then(() => { toast.success("Parcel received - inspection is next"); refresh() })} />
      ) : null}
    </div>
  )
}

export default RequestDetail