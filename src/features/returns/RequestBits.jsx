import { useEffect, useRef } from "react"
import { Camera, X } from "lucide-react"
import { ExternalLink } from "lucide-react"
import { EVIDENCE_MAX_FILES, evidenceFileError, requestStatusMeta, adminStatusLabel } from "./requestModel"
import { customerRefundLine, refundsToShow } from "./refundModel"
import { CopyButton, ShipmentStatusChip } from "../orders/shipping/ShipmentBits"
import { toneColors } from "../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

/**
 * "Your replacement" of an EXCHANGE: what is being sent, where it is (courier + tracking once it ships) and the price difference in plain words.
 * `view` = exchangeModel.customerReplacement(request, bundle); renders nothing without one. Shows exactly what is stored - never an optimistic state.
 */
export function ReplacementNotice({ view }) {
  if (!view) return null
  const c = toneColors(view.status.tone)
  const adj = view.adjustment
  const a = adj ? toneColors(adj.tone) : null
  const t = view.tracking
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "12px" }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px" }}>
        <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px" }}>{view.headline}</p>
        <span style={{ background: c.bg, color: c.fg, borderRadius: "9999px", padding: "3px 10px", fontFamily: INTER, fontWeight: 700, fontSize: "11px", letterSpacing: "0.3px", whiteSpace: "nowrap" }}>{view.status.label}</span>
      </div>
      {view.lines.map((l) => <p key={l.id} style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-ink)", marginTop: "4px" }}>{l.text}</p>)}
      {t ? (
        <div className="flex items-center flex-wrap" style={{ gap: "10px", marginTop: "8px" }}>
          <span style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px" }}>{t.courier}</span>
          {t.number ? <span style={{ fontFamily: MONO, fontSize: "13px", wordBreak: "break-all" }}>{t.number}</span> : null}
          {t.number ? <CopyButton text={t.number} /> : null}
          {t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="flex items-center" style={{ gap: "4px", fontFamily: INTER, fontSize: "12px", fontWeight: 700, color: "var(--color-link)" }}>Track <ExternalLink size={12} /></a> : null}
          <ShipmentStatusChip status={t.status} small />
        </div>
      ) : null}
      {adj ? (
        <div style={{ background: a.bg, borderRadius: "8px", padding: "10px 12px", marginTop: "10px" }}>
          <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px", color: a.fg }}>{adj.headline}</p>
          <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-ink)", marginTop: "2px" }}>{adj.detail}</p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The customer's refund status for ONE request (spec 9.3): "Refund processing" / "Refund completed" / "Refund failed - contact support".
 * `refunds` = the mapped refund rows of the request. Shows exactly what is stored - never an optimistic state. Renders nothing without one.
 */
export function RefundNotice({ refunds }) {
  const shown = refundsToShow(refunds)
  if (!shown.length) return null
  return (
    <div className="flex flex-col" style={{ gap: "8px" }}>
      {shown.map((r) => {
        const l = customerRefundLine(r)
        const c = toneColors(l.tone)
        return (
          <div key={r.id} style={{ background: c.bg, borderRadius: "10px", padding: "12px" }}>
            <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "13px", color: c.fg }}>{l.headline}</p>
            <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-ink)", marginTop: "2px" }}>{l.detail}</p>
            {r.adjustmentAmount && r.adjustmentNote ? <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", marginTop: "2px" }}>Includes an adjustment: {r.adjustmentNote}</p> : null}
            <p style={{ fontFamily: INTER, fontSize: "11px", color: "var(--color-muted)", marginTop: "4px" }}>Refund {r.refundNo}</p>
          </div>
        )
      })}
    </div>
  )
}

/** Coloured pill for a request status. `staff` shows the internal state name instead of the customer wording. */
export function RequestStatusChip({ status, staff = false, small = false }) {
  const meta = requestStatusMeta(status)
  const c = toneColors(meta.tone)
  return (
    <span style={{ background: c.bg, color: c.fg, borderRadius: "9999px", padding: small ? "2px 8px" : "4px 10px", fontFamily: INTER, fontWeight: 700, fontSize: small ? "11px" : "12px", letterSpacing: "0.3px", whiteSpace: "nowrap" }}>
      {staff ? adminStatusLabel(status) : meta.label}
    </span>
  )
}

/**
 * Photo chooser with previews. `photos` = [{ id, file, url }]; `onChange(next, rejectedMessages)`.
 * Files are checked against the same rules as the server (JPEG / PNG / WebP, 5 MB, at most `max`).
 */
export function PhotoPicker({ photos, onChange, max = EVIDENCE_MAX_FILES, disabled = false }) {
  const inputRef = useRef(null)
  const latest = useRef(photos)
  useEffect(() => { latest.current = photos }, [photos])
  useEffect(() => () => { latest.current.forEach((p) => URL.revokeObjectURL(p.url)) }, [])

  const add = (e) => {
    const picked = Array.from(e.target.files || [])
    e.target.value = ""
    const next = [...photos]
    const rejected = []
    for (const f of picked) {
      const bad = evidenceFileError(f)
      if (bad) { rejected.push(`${f.name}: ${bad}`); continue }
      if (next.length >= max) { rejected.push(`${f.name}: at most ${max} photos`); continue }
      next.push({ id: `${f.name}-${f.size}-${f.lastModified}-${next.length}`, file: f, url: URL.createObjectURL(f) })
    }
    onChange(next, rejected)
  }
  const remove = (id) => {
    const gone = photos.find((p) => p.id === id)
    if (gone) URL.revokeObjectURL(gone.url)
    onChange(photos.filter((p) => p.id !== id), [])
  }

  return (
    <div>
      <div className="flex flex-wrap" style={{ gap: "8px" }}>
        {photos.map((p) => (
          <div key={p.id} style={{ position: "relative", width: "72px", height: "72px" }}>
            <img src={p.url} alt={p.file.name} style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "8px", border: "1px solid var(--color-border)" }} />
            {!disabled ? (
              <button type="button" onClick={() => remove(p.id)} aria-label={`Remove ${p.file.name}`} className="flex items-center justify-center" style={{ position: "absolute", top: "-6px", right: "-6px", width: "20px", height: "20px", borderRadius: "9999px", background: "var(--color-ink)", color: "var(--color-inverse)", cursor: "pointer" }}>
                <X size={12} />
              </button>
            ) : null}
          </div>
        ))}
        {photos.length < max && !disabled ? (
          <button type="button" onClick={() => inputRef.current?.click()} className="flex flex-col items-center justify-center" style={{ width: "72px", height: "72px", borderRadius: "8px", border: "1px dashed var(--color-border-strong)", color: "var(--color-body)", fontFamily: INTER, fontSize: "11px", cursor: "pointer", gap: "2px" }}>
            <Camera size={18} /> Add
          </button>
        ) : null}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={add} />
      <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-muted)", marginTop: "6px" }}>JPEG, PNG or WebP, up to 5 MB each, at most {max}.</p>
    </div>
  )
}