import { useState } from "react"
import { toast } from "react-toastify"
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import { returnsService } from "../../services/returns"
import { EVIDENCE_MAX_FILES, canCustomerCancel, canCustomerRespond, canSubmitReturnTracking, itemStatusLabel, requestProgress, requestStatusMeta, requestTypeLabel } from "./requestModel"
import { customerReplacement } from "./exchangeModel"
import { PhotoPicker, RefundNotice, ReplacementNotice, RequestStatusChip } from "./RequestBits"
import EvidenceGallery from "./EvidenceGallery"
import { CopyButton, ShipmentStatusChip } from "../orders/shipping/ShipmentBits"
import { ERROR_STYLE, GHOST_BTN, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN, fmtDate, fmtDateTime } from "../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"
const METHOD_LABEL = { courier_pickup: "Courier pickup", customer_arranged: "Send it yourself", manual: "Hand it over / arranged with us" }

/** "Send it yourself": the customer tells us which courier / post service and the tracking number of the parcel. */
function TrackingForm({ request, onDone }) {
  const [f, setF] = useState({ courierName: "", trackingNumber: "", trackingUrl: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!f.courierName.trim()) { setError("Enter the courier or post service you used"); return }
    setBusy(true)
    try {
      await returnsService.submitReturnTracking({ requestId: request.id, courierName: f.courierName.trim(), trackingNumber: f.trackingNumber.trim(), trackingUrl: f.trackingUrl.trim() })
      toast.success("Thank you - we have noted your parcel")
      onDone?.()
    } catch (err) {
      setError(err.message || "Could not save the details")
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col" style={{ gap: "8px", border: "1px solid var(--color-border)", borderRadius: "10px", padding: "12px" }} noValidate>
      <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px" }}>Sent the parcel? Tell us how</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px" }}>
        <div><label style={LABEL_STYLE} htmlFor={`rt-c-${request.id}`}>Courier / post service</label><input id={`rt-c-${request.id}`} style={INPUT_STYLE} value={f.courierName} onChange={set("courierName")} maxLength={80} /></div>
        <div><label style={LABEL_STYLE} htmlFor={`rt-n-${request.id}`}>Tracking number</label><input id={`rt-n-${request.id}`} style={INPUT_STYLE} value={f.trackingNumber} onChange={set("trackingNumber")} maxLength={80} /></div>
        <div><label style={LABEL_STYLE} htmlFor={`rt-u-${request.id}`}>Tracking link (optional)</label><input id={`rt-u-${request.id}`} style={INPUT_STYLE} value={f.trackingUrl} onChange={set("trackingUrl")} inputMode="url" /></div>
      </div>
      {error ? <p style={ERROR_STYLE}>{error}</p> : null}
      <div><button type="submit" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Save shipping details"}</button></div>
    </form>
  )
}

/** the admin asked for more information: a message and / or more photos */
function ReplyForm({ request, user, onDone }) {
  const [message, setMessage] = useState("")
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const room = Math.max(0, EVIDENCE_MAX_FILES - request.evidence.length)
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!message.trim() && photos.length === 0) { setError("Write a message or add a photo"); return }
    setBusy(true)
    try {
      const stored = photos.length
        ? await returnsService.uploadEvidence({ uid: user.uid, requestId: request.id, startIndex: request.evidence.length, files: photos.map((p) => ({ name: p.file.name, type: p.file.type, size: p.file.size, body: p.file })) })
        : []
      try {
        await returnsService.respond(request.id, message.trim(), stored)
      } catch (err) {
        await returnsService.discardEvidence(stored.map((s) => s.path))
        throw err
      }
      toast.success("Your answer was sent")
      onDone?.()
    } catch (err) {
      setError(err.message || "Could not send your answer")
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col" style={{ gap: "8px", border: "1px solid var(--color-warning-border)", background: "var(--color-warning-subtle)", borderRadius: "10px", padding: "12px" }} noValidate>
      <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px" }}>We need a little more information</p>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} placeholder="Your answer" style={{ ...INPUT_STYLE, height: "auto", padding: "8px 12px" }} aria-label="Your answer" />
      {room > 0 ? <PhotoPicker photos={photos} max={room} onChange={(next, rejected) => { setPhotos(next); rejected.forEach((m) => toast.error(m)) }} disabled={busy} /> : null}
      {error ? <p style={ERROR_STYLE}>{error}</p> : null}
      <div><button type="submit" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Sending..." : "Send answer"}</button></div>
    </form>
  )
}

/**
 * One return / exchange request as the CUSTOMER sees it: status, progress, her items with their decisions, the instructions and tracking
 * of the return parcel, her photos and the history - plus the few actions she may take (cancel, answer, add shipping details).
 */
const RequestCard = ({ request, order, refunds = [], replacement = null, user, onChanged }) => {
  const [open, setOpen] = useState(!requestStatusMeta(request.status).final)
  const [busy, setBusy] = useState(false)
  const meta = requestStatusMeta(request.status)
  const steps = requestProgress(request)
  // the RETURN parcels (direction 'return'); the replacement parcel travels inside `replacement` (exchangeModel.buildReplacementMap)
  const parcels = (order?.shipments || []).filter((s) => s.requestId === request.id && s.direction !== "replacement")
  const replacementView = customerReplacement(request, replacement)

  const cancel = async () => {
    if (busy || !window.confirm("Cancel this request? You can submit a new one later while the period is open.")) return
    setBusy(true)
    try {
      await returnsService.cancel(request.id)
      toast.success("Request cancelled")
      onChanged?.()
    } catch (err) {
      toast.error(err.message || "Could not cancel the request")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "16px", background: "var(--color-surface)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-between" style={{ width: "100%", gap: "12px", textAlign: "left", cursor: "pointer" }} aria-expanded={open}>
        <span className="flex flex-col" style={{ minWidth: 0 }}>
          <span style={{ fontFamily: INTER, fontWeight: 700, fontSize: "14px" }}>{requestTypeLabel(request.type)} {request.requestNo}</span>
          <span style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>Submitted {fmtDate(request.createdAt)} · {request.items.length} item{request.items.length === 1 ? "" : "s"}</span>
        </span>
        <span className="flex items-center" style={{ gap: "8px" }}>
          <RequestStatusChip status={request.status} />
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col" style={{ gap: "14px", marginTop: "14px" }}>
          {!meta.final || request.status === "closed" ? (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: "4px" }}>
              {steps.map((s) => (
                <li key={s.key} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                  <div style={{ height: "4px", borderRadius: "9999px", background: s.stopped ? "var(--color-error)" : s.done ? "var(--color-primary)" : s.current ? "var(--color-accent)" : "var(--color-border)" }} />
                  <p style={{ fontFamily: INTER, fontSize: "11px", marginTop: "4px", fontWeight: s.current ? 700 : 500, color: s.done || s.current ? "var(--color-ink)" : "var(--color-muted)" }}>{s.label}</p>
                </li>
              ))}
            </ol>
          ) : null}

          {request.customerNote ? (
            <p style={{ fontFamily: INTER, fontSize: "13px", background: "var(--color-surface-muted)", borderRadius: "8px", padding: "10px 12px", whiteSpace: "pre-wrap" }}>{request.customerNote}</p>
          ) : null}

          <div className="flex flex-col" style={{ gap: "8px" }}>
            {request.items.map((it) => (
              <div key={it.id} className="flex items-start justify-between" style={{ gap: "12px" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px" }}>{it.title}{it.variantName ? ` · ${it.variantName}` : ""} <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>x{it.quantity}</span></p>
                  {it.decisionNote ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>{it.decisionNote}</p> : null}
                  {it.inspectionNote ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>{it.inspectionNote}</p> : null}
                </div>
                <span style={{ fontFamily: INTER, fontSize: "12px", fontWeight: 600, color: it.status === "rejected" || it.status === "failed" ? "var(--color-error)" : "var(--color-body)", whiteSpace: "nowrap" }}>{itemStatusLabel(it.status)}</span>
              </div>
            ))}
          </div>

          {request.returnMethod ? (
            <div style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "12px" }}>
              <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px" }}>How to return it: {METHOD_LABEL[request.returnMethod] || request.returnMethod}</p>
              {request.returnInstructions ? <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-body)", marginTop: "4px", whiteSpace: "pre-wrap" }}>{request.returnInstructions}</p> : null}
              {parcels.map((s) => (
                <div key={s.id} className="flex items-center flex-wrap" style={{ gap: "10px", marginTop: "8px" }}>
                  <span style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px" }}>{s.courierName || "Courier"}</span>
                  {s.trackingNumber ? <span style={{ fontFamily: MONO, fontSize: "13px", wordBreak: "break-all" }}>{s.trackingNumber}</span> : null}
                  {s.trackingNumber ? <CopyButton text={s.trackingNumber} /> : null}
                  {s.pickupReference ? <span style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>Pickup ref {s.pickupReference}</span> : null}
                  {s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center" style={{ gap: "4px", fontFamily: INTER, fontSize: "12px", fontWeight: 700, color: "var(--color-link)" }}>Track <ExternalLink size={12} /></a> : null}
                  <ShipmentStatusChip status={s.status} small />
                </div>
              ))}
            </div>
          ) : null}

          <ReplacementNotice view={replacementView} />
          <RefundNotice refunds={refunds} />

          {canCustomerRespond(request) ? <ReplyForm request={request} user={user} onDone={onChanged} /> : null}
          {canSubmitReturnTracking(request) ? <TrackingForm request={request} onDone={onChanged} /> : null}

          {request.evidence.length ? (
            <div>
              <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-body)", marginBottom: "6px" }}>Your photos</p>
              <EvidenceGallery paths={request.evidence.map((e) => e.path)} />
            </div>
          ) : null}

          {request.events.length ? (
            <div>
              <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-body)", marginBottom: "6px" }}>History</p>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {request.events.filter((e) => !e.itemId).map((e) => (
                  <li key={e.id} style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", paddingBottom: "6px" }}>
                    <b style={{ color: "var(--color-ink)" }}>{e.to ? requestStatusMeta(e.to).label : "Update"}</b> · {fmtDateTime(e.createdAt)}{e.note ? ` · ${e.note}` : ""}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {canCustomerCancel(request) ? (
            <div><button type="button" onClick={cancel} disabled={busy} style={{ ...GHOST_BTN, color: "var(--color-error)", opacity: busy ? 0.7 : 1 }}>{busy ? "Cancelling..." : "Cancel this request"}</button></div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default RequestCard