import { useEffect, useMemo, useState } from "react"
import { toast } from "react-toastify"
import { CheckCircle2 } from "lucide-react"
import ModalShell from "../../components/Common/ModalShell"
import { supabase } from "../../context/SupabaseConfig"
import { returnsService } from "../../services/returns"
import { defaultReplacement, describeEligibility, reasonOptions, replacementOptions, requestTypeLabel, validateRequestForm } from "./requestModel"
import { PhotoPicker } from "./RequestBits"
import { ERROR_STYLE, GHOST_BTN, HINT_STYLE, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN } from "../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"
const cur = (n) => `₹${Number(n || 0).toFixed(2)}`
const newRequestId = () => {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * "Return items" / "Exchange items": the customer picks lines and quantities, a reason, adds photos and submits. Every rule shown here is the
 * server's own answer (get_order_eligibility); the form only explains it, and create_return_request() re-checks everything.
 * Mount it only while open (`{open && <ReturnRequestModal key=... />}`) so the form starts fresh each time.
 */
const ReturnRequestModal = ({ order, eligibility, reasons, user, initialType = "return", initialItemId = null, onClose, onDone }) => {
  const [requestId] = useState(newRequestId)             // one id per form: a retry can never create a second request
  const canReturn = (eligibility?.items || []).some((i) => i.return?.eligible)
  const canExchange = (eligibility?.items || []).some((i) => i.exchange?.eligible)
  const [type, setType] = useState(initialType === "exchange" ? (canExchange ? "exchange" : "return") : (canReturn ? "return" : "exchange"))
  const [lines, setLines] = useState(() => Object.fromEntries((eligibility?.items || []).map((i) => [i.order_item_id, {
    selected: i.order_item_id === initialItemId, quantity: 1, replacementVariantId: undefined,
  }])))
  const [reasonCode, setReasonCode] = useState("")
  const [description, setDescription] = useState("")
  const [contactPhone, setContactPhone] = useState(user?.phone || "")
  const [photos, setPhotos] = useState([])
  const [uploaded, setUploaded] = useState([])           // photos already stored for this request id (reused on a retry)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [catalog, setCatalog] = useState({})              // productId -> { product, variants } (exchange only)

  const items = eligibility?.items || []
  const reasonList = useMemo(() => reasonOptions(reasons, type), [reasons, type])
  const selectedReason = reasonList.find((r) => r.code === reasonCode)

  // exchange: what each product can be swapped for
  useEffect(() => {
    if (type !== "exchange") return undefined
    let alive = true
    const ids = [...new Set(items.filter((i) => i.exchange?.eligible).map((i) => i.product_id))]
    if (ids.length === 0) return undefined
    ;(async () => {
      const [{ data: prods }, { data: vars }] = await Promise.all([
        supabase.from("products").select("id, title, price, discount, discount_expiry, has_variants, main_option_enabled, stock, track_inventory, status").in("id", ids),
        supabase.from("product_variants").select("id, product_id, name, price, stock, track_inventory, status").in("product_id", ids),
      ])
      if (!alive) return
      const next = {}
      for (const id of ids) next[id] = { product: (prods || []).find((p) => p.id === id) || null, variants: (vars || []).filter((v) => v.product_id === id) }
      setCatalog(next)
    })().catch(() => { /* the exchange list simply shows no options; the server still validates */ })
    return () => { alive = false }
  }, [type, items])

  const optionsFor = (line) => {
    const c = catalog[line.product_id]
    return c ? replacementOptions(c.product, c.variants, { variantId: line.variant_id || "", unitPrice: line.unit_price }) : []
  }
  const setLine = (id, patch) => setLines((cur0) => ({ ...cur0, [id]: { ...cur0[id], ...patch } }))

  const toggle = (line, on) => {
    const patch = { selected: on }
    if (on && type === "exchange" && lines[line.order_item_id].replacementVariantId === undefined) patch.replacementVariantId = defaultReplacement(optionsFor(line)) ?? undefined
    setLine(line.order_item_id, patch)
  }
  const eligibleLines = items.filter((i) => i[type]?.eligible)
  const everySelected = eligibleLines.length > 0 && eligibleLines.every((i) => lines[i.order_item_id]?.selected)
  const selectAll = () => eligibleLines.forEach((i) => toggle(i, !everySelected))
  const switchType = (next) => { setType(next); setReasonCode(""); setErrors({}); setLines((cur0) => Object.fromEntries(Object.entries(cur0).map(([k, v]) => [k, { ...v, selected: false, replacementVariantId: undefined }]))) }

  const close = async () => {
    if (!done && uploaded.length) await returnsService.discardEvidence(uploaded.map((u) => u.path))
    onClose?.()
  }

  const submit = async (e) => {
    e?.preventDefault()
    if (busy) return
    const lineArray = items.map((i) => ({ orderItemId: i.order_item_id, ...lines[i.order_item_id] }))
    const v = validateRequestForm({ type, reasonCode, description, contactPhone, lines: lineArray, photos: photos.map((p) => p.file) },
      { orderId: order.id, requestId, eligibility, reasons: reasonList, uploaded })
    setErrors(v.errors)
    if (!v.ok) return
    setBusy(true)
    try {
      let evidence = uploaded
      if (evidence.length === 0 && photos.length) {
        evidence = await returnsService.uploadEvidence({ uid: user.uid, requestId, files: photos.map((p) => ({ name: p.file.name, type: p.file.type, size: p.file.size, body: p.file })) })
        setUploaded(evidence)
      }
      const r = await returnsService.submit({ ...v.payload, p_evidence: evidence })
      setDone(r)
      toast.success(`${requestTypeLabel(type)} request submitted`)
      onDone?.(r)
    } catch (err) {
      setErrors({ form: err.message || "Could not submit the request" })
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <ModalShell open onClose={onClose} width={520} title="Request submitted" footer={<button type="button" onClick={onClose} style={PRIMARY_BTN}>Done</button>}>
        <div className="flex flex-col items-center text-center" style={{ gap: "10px", padding: "12px 0" }}>
          <CheckCircle2 size={44} style={{ color: "var(--color-success)" }} />
          <p style={{ fontFamily: INTER, fontWeight: 800, fontSize: "20px" }}>{done.requestNo}</p>
          <p style={{ fontFamily: INTER, fontSize: "14px", color: "var(--color-body)" }}>
            Your {type} request is <b>pending review</b>. We will look at it and let you know here and by notification. Nothing is refunded or replaced until it is approved{type === "return" ? " and the items have reached us" : ""}.
          </p>
        </div>
      </ModalShell>
    )
  }

  const noun = type === "exchange" ? "exchange" : "return"
  return (
    <ModalShell
      open onClose={close} busy={busy} width={700}
      title={type === "exchange" ? "Exchange items" : "Return items"}
      subtitle={`Order #${order.externalOrderId ? String(order.externalOrderId).replace(/^#/, "") : order.id}`}
      footer={(<>
        <button type="button" onClick={close} disabled={busy} style={GHOST_BTN}>Cancel</button>
        <button type="submit" form="return-request-form" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.7 : 1 }}>{busy ? "Submitting..." : `Submit ${noun} request`}</button>
      </>)}
    >
      <form id="return-request-form" onSubmit={submit} className="flex flex-col" style={{ gap: "16px" }} noValidate>
        {canReturn && canExchange ? (
          <div className="flex" style={{ gap: "8px" }} role="tablist" aria-label="Request type">
            {["return", "exchange"].map((t) => (
              <button key={t} type="button" role="tab" aria-selected={type === t} onClick={() => switchType(t)} style={{ ...GHOST_BTN, background: type === t ? "var(--color-primary)" : "var(--color-surface-muted)", color: type === t ? "var(--color-inverse)" : "var(--color-ink)" }}>{requestTypeLabel(t)}</button>
            ))}
          </div>
        ) : null}

        <div>
          <div className="flex items-center justify-between" style={{ gap: "8px" }}>
            <p style={LABEL_STYLE}>Which items?</p>
            <button type="button" onClick={selectAll} disabled={busy} style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-link)", cursor: "pointer" }}>
              {everySelected ? "Clear selection" : "Select all eligible items"}
            </button>
          </div>
          <div className="flex flex-col" style={{ gap: "8px" }}>
            {items.map((line) => {
              const verdict = describeEligibility(line[type], type)
              const st = lines[line.order_item_id] || {}
              const opts = type === "exchange" && st.selected ? optionsFor(line) : []
              return (
                <div key={line.order_item_id} style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "10px 12px", opacity: verdict.eligible ? 1 : 0.65 }}>
                  <div className="flex items-center" style={{ gap: "10px" }}>
                    <input type="checkbox" id={`rl-${line.order_item_id}`} checked={!!st.selected} disabled={!verdict.eligible || busy} onChange={(e) => toggle(line, e.target.checked)} />
                    <label htmlFor={`rl-${line.order_item_id}`} style={{ flex: 1, minWidth: 0, cursor: verdict.eligible ? "pointer" : "default" }}>
                      <span style={{ fontFamily: INTER, fontWeight: 600, fontSize: "14px" }}>{line.title}{line.variant_name ? ` · ${line.variant_name}` : ""}</span>
                      <span style={{ display: "block", fontFamily: INTER, fontSize: "12px", color: verdict.eligible ? "var(--color-body)" : "var(--color-muted)" }}>
                        Ordered {line.quantity} · {cur(line.unit_price)} each · {verdict.eligible ? verdict.hint : verdict.hint || verdict.label}
                      </span>
                    </label>
                    {verdict.eligible && st.selected ? (
                      <select aria-label={`Quantity of ${line.title}`} value={st.quantity} onChange={(e) => setLine(line.order_item_id, { quantity: Number(e.target.value) })} style={{ ...INPUT_STYLE, width: "76px" }}>
                        {Array.from({ length: verdict.remaining }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    ) : null}
                  </div>
                  {type === "exchange" && st.selected ? (
                    <div style={{ marginTop: "8px" }}>
                      <label style={LABEL_STYLE} htmlFor={`rr-${line.order_item_id}`}>I would like instead</label>
                      <select id={`rr-${line.order_item_id}`} value={st.replacementVariantId ?? "__none"} onChange={(e) => setLine(line.order_item_id, { replacementVariantId: e.target.value === "__none" ? undefined : e.target.value })} style={INPUT_STYLE}>
                        <option value="__none" disabled>Choose an option</option>
                        {opts.map((o) => (
                          <option key={o.variantId || "main"} value={o.variantId} disabled={!o.inStock}>
                            {o.label}{o.isSame ? " (same as bought)" : ""} - {cur(o.price)}{o.difference ? ` (${o.difference > 0 ? "+" : "-"}${cur(Math.abs(o.difference))} vs. what you paid)` : ""}{o.inStock ? "" : " - out of stock"}
                          </option>
                        ))}
                      </select>
                      {opts.length === 0 ? <p style={HINT_STYLE}>Loading the options...</p> : <p style={HINT_STYLE}>Any price difference is noted on your request; you are not charged or refunded automatically.</p>}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          {errors.items ? <p style={ERROR_STYLE}>{errors.items}</p> : null}
          {errors.replacement ? <p style={ERROR_STYLE}>{errors.replacement}</p> : null}
        </div>

        <div>
          <label style={LABEL_STYLE} htmlFor="rr-reason">What is the problem?</label>
          <select id="rr-reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} style={INPUT_STYLE} disabled={busy}>
            <option value="" disabled>Choose a reason</option>
            {reasonList.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
          {errors.reasonCode ? <p style={ERROR_STYLE}>{errors.reasonCode}</p> : null}
        </div>

        <div>
          <label style={LABEL_STYLE} htmlFor="rr-desc">Tell us more{selectedReason?.requires_description ? "" : " (optional)"}</label>
          <textarea id="rr-desc" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...INPUT_STYLE, height: "auto", padding: "8px 12px" }} disabled={busy} />
          {errors.description ? <p style={ERROR_STYLE}>{errors.description}</p> : null}
        </div>

        <div>
          <p style={LABEL_STYLE}>Photos{selectedReason?.requires_evidence ? " (required for this reason)" : " (optional)"}</p>
          <PhotoPicker photos={photos} onChange={(next, rejected) => { setPhotos(next); rejected.forEach((m) => toast.error(m)) }} disabled={busy || uploaded.length > 0} />
          {uploaded.length > 0 ? <p style={HINT_STYLE}>Your photos are already uploaded; press Submit to try again.</p> : null}
          {errors.photos ? <p style={ERROR_STYLE}>{errors.photos}</p> : null}
        </div>

        <div>
          <label style={LABEL_STYLE} htmlFor="rr-phone">Phone number we can reach you on (optional)</label>
          <input id="rr-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputMode="tel" style={INPUT_STYLE} disabled={busy} />
          {errors.contactPhone ? <p style={ERROR_STYLE}>{errors.contactPhone}</p> : null}
        </div>

        {errors.form ? <p style={{ ...ERROR_STYLE, fontWeight: 600 }}>{errors.form}</p> : null}
      </form>
    </ModalShell>
  )
}

export default ReturnRequestModal