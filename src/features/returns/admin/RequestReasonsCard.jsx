import { useCallback, useEffect, useState } from "react"
import { Loader2, MessageSquare, Pencil, Plus, Save } from "lucide-react"
import { toast } from "react-toastify"
import { returnsService } from "../../../services/returns"
import { REASON_TYPES, REASON_TYPE_LABEL, blankReason, mapReasons, reasonSummary, slugReasonCode, validateReason } from "./reasonsModel"

// Admin > Optimization: the reasons a customer can pick when asking for a return or an exchange (public.request_reasons).
// A reason is never deleted (requests refer to it): switch it off to hide it from the customer's form. Two flags matter beyond the wording:
//   "seller's fault"            the refund rules read it - a complete return for such a reason also gets the outbound shipping refunded
//   "photo / description"       the request form (and the database) insist on it for that reason
// The customer's form lists the ACTIVE reasons of its type, so a type can never be left without one.

const fieldCls = "w-full h-11 px-3 rounded-xl border border-neutral-300 text-sm bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-400"

export default function RequestReasonsCard() {
  const [reasons, setReasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [draft, setDraft] = useState(null)            // null = closed; otherwise the reason being added / edited
  const [isNew, setIsNew] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setReasons(mapReasons(await returnsService.reasons()))
      setLoadError("")
    } catch (err) {
      console.error("Failed to load the request reasons:", err)
      setLoadError(err.message || "Failed to load the reasons.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const openNew = () => { setDraft(blankReason()); setIsNew(true); setErrors({}) }
  const openEdit = (r) => { setDraft({ ...r, codeTouched: true }); setIsNew(false); setErrors({}) }
  const close = () => { setDraft(null); setErrors({}) }
  const set = (key) => (e) => setDraft((d) => {
    const next = { ...d, [key]: e.target.value }
    if (key === "label" && isNew && !d.codeTouched) next.code = slugReasonCode(e.target.value)     // the code follows the name until the admin edits it
    if (key === "code") next.codeTouched = true
    return next
  })
  const setFlag = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))
  const toggleType = (type) => (e) => setDraft((d) => ({ ...d, appliesTo: e.target.checked ? [...new Set([...(d.appliesTo || []), type])] : (d.appliesTo || []).filter((t) => t !== type) }))

  const persist = async (value) => {
    await returnsService.saveReason(value)
    await load()
  }

  const save = async (e) => {
    e.preventDefault()
    if (saving) return
    const r = validateReason(draft, { existing: reasons, isNew })
    setErrors(r.errors)
    if (!r.ok) return
    setSaving(true)
    try {
      await persist(r.value)
      toast.success(isNew ? "Reason added" : "Reason saved")
      close()
    } catch (err) {
      toast.error(err.message || "Could not save the reason")
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (reason) => {
    const r = validateReason({ ...reason, active: !reason.active }, { existing: reasons, isNew: false })
    if (!r.ok) { toast.error(r.errors.active || "This change is not allowed"); return }
    try {
      await persist(r.value)
    } catch (err) {
      toast.error(err.message || "Could not update the reason")
    }
  }

  return (
    <div className="bg-white rounded-3xl border border-neutral-200/80 shadow-[0_10px_30px_rgba(0,0,0,0.02)] overflow-hidden">
      <div className="p-6 md:p-8 space-y-5">
        <div className="border-b border-neutral-100 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2"><MessageSquare className="text-amber-600" size={22} /> Return &amp; exchange reasons</h2>
            <p className="text-neutral-500 text-sm mt-1">
              What a customer can pick as the reason for a return or an exchange. A reason marked <strong>seller&apos;s fault</strong> (damaged, wrong item ...) also gets the
              outbound shipping refunded when the whole order comes back; <strong>photo required</strong> / <strong>description required</strong> make the request form insist on
              it. Reasons are never deleted - switch one off to hide it.
            </p>
          </div>
          {!draft ? (
            <button type="button" onClick={openNew} className="flex-shrink-0 px-4 h-11 rounded-xl font-bold text-sm text-white bg-amber-600 hover:bg-amber-700 flex items-center gap-2 cursor-pointer">
              <Plus size={16} /> Add reason
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-3 text-neutral-500 text-sm"><Loader2 className="animate-spin" size={18} /> Loading the reasons...</div>
        ) : loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : reasons.length === 0 ? (
          <p className="text-sm text-neutral-500">No reasons yet: apply the returns migration first (20261017_04_return_requests.sql).</p>
        ) : (
          <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100">
            {reasons.map((r) => (
              <div key={r.code} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-neutral-800 text-sm">{r.label} <span className="ml-2 text-[11px] font-mono text-neutral-400">{r.code}</span></p>
                  <p className="text-[12px] text-neutral-500 truncate">{reasonSummary(r)}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-neutral-600">
                  <input type="checkbox" checked={r.active} onChange={() => toggleActive(r)} aria-label={`${r.label} is active`} />
                  Active
                </label>
                <button type="button" onClick={() => openEdit(r)} className="h-9 px-3 rounded-lg border border-neutral-300 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 flex items-center gap-1 cursor-pointer">
                  <Pencil size={14} /> Edit
                </button>
              </div>
            ))}
          </div>
        )}

        {draft ? (
          <form onSubmit={save} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-4" noValidate>
            <h3 className="text-sm font-bold text-neutral-800 uppercase tracking-wider">{isNew ? "New reason" : `Edit ${draft.label || draft.code}`}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1" htmlFor="reason-label">Name (what the customer sees)</label>
                <input id="reason-label" className={fieldCls} value={draft.label} onChange={set("label")} maxLength={80} />
                {errors.label ? <p className="text-xs text-red-600 mt-1">{errors.label}</p> : null}
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1" htmlFor="reason-code">Code (never changes once saved)</label>
                <input id="reason-code" className={fieldCls} value={draft.code} onChange={set("code")} disabled={!isNew} maxLength={40} />
                {errors.code ? <p className="text-xs text-red-600 mt-1">{errors.code}</p> : null}
              </div>
              <div className="md:col-span-2">
                <p className="block text-xs font-semibold text-neutral-600 mb-2">Offered for</p>
                <div className="flex flex-wrap gap-5">
                  {REASON_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm text-neutral-700">
                      <input type="checkbox" checked={(draft.appliesTo || []).includes(t)} onChange={toggleType(t)} /> {REASON_TYPE_LABEL[t]} requests
                    </label>
                  ))}
                </div>
                {errors.appliesTo ? <p className="text-xs text-red-600 mt-1">{errors.appliesTo}</p> : null}
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-x-6 gap-y-3">
                <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={!!draft.sellerFault} onChange={setFlag("sellerFault")} /> Seller&apos;s fault (refund the outbound shipping on a complete return)</label>
                <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={!!draft.requiresEvidence} onChange={setFlag("requiresEvidence")} /> Photo required</label>
                <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={!!draft.requiresDescription} onChange={setFlag("requiresDescription")} /> Description required</label>
                <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={draft.active !== false} onChange={setFlag("active")} /> Active (shown to customers)</label>
              </div>
              {errors.active ? <p className="text-xs text-red-600 md:col-span-2">{errors.active}</p> : null}
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1" htmlFor="reason-sort">Position in the list</label>
                <input id="reason-sort" type="number" className={fieldCls} value={draft.sortOrder} onChange={set("sortOrder")} />
                {errors.sortOrder ? <p className="text-xs text-red-600 mt-1">{errors.sortOrder}</p> : null}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={close} disabled={saving} className="px-5 h-11 rounded-xl font-bold text-sm border border-neutral-300 text-neutral-700 hover:bg-neutral-50 cursor-pointer">Cancel</button>
              <button type="submit" disabled={saving} className="px-6 h-11 rounded-xl font-bold text-white text-sm bg-amber-600 hover:bg-amber-700 flex items-center gap-2 cursor-pointer disabled:opacity-60">
                {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Save reason</>}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}