import { useCallback, useEffect, useState } from "react"
import { Loader2, Pencil, Plus, Save, Truck } from "lucide-react"
import { toast } from "react-toastify"
import { shippingService, slugCourierCode, validateCourier } from "../../../services/shipping"

// Admin > Optimization: the courier catalogue behind the "Ship this order" form.
// Nothing is guessed: a courier ships WITHOUT a tracking-link template (the admin pastes a link per shipment, or the customer just sees the
// number). A template - e.g. https://courier.example/track?no={tracking} - makes the customer's "Track" link automatic.
// Couriers are never deleted (shipments refer to them): switch one off to hide it from the form. "manual" always stays on.

const emptyDraft = () => ({ code: "", name: "", trackingUrlTemplate: "", supportsApi: false, active: true, sortOrder: 100, codeTouched: false })
const fieldCls = "w-full h-11 px-3 rounded-xl border border-neutral-300 text-sm bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-400"

export default function CouriersCard() {
  const [couriers, setCouriers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [draft, setDraft] = useState(null)            // null = closed; otherwise the courier being added / edited
  const [isNew, setIsNew] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setCouriers(await shippingService.listCouriers({ includeInactive: true }))
      setLoadError("")
    } catch (err) {
      console.error("Failed to load couriers:", err)
      setLoadError(err.message || "Failed to load the couriers.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const openNew = () => { setDraft(emptyDraft()); setIsNew(true); setErrors({}) }
  const openEdit = (c) => { setDraft({ ...c, codeTouched: true }); setIsNew(false); setErrors({}) }
  const close = () => { setDraft(null); setErrors({}) }
  const set = (key) => (e) => setDraft((d) => {
    const next = { ...d, [key]: e.target.value }
    if (key === "name" && isNew && !d.codeTouched) next.code = slugCourierCode(e.target.value)     // the code follows the name until the admin edits it
    if (key === "code") next.codeTouched = true
    return next
  })

  const save = async (e) => {
    e.preventDefault()
    if (saving) return
    const r = validateCourier(draft, { existing: couriers, isNew })
    setErrors(r.errors)
    if (!r.ok) return
    setSaving(true)
    try {
      await shippingService.saveCourier(r.value)
      toast.success(isNew ? "Courier added" : "Courier saved")
      close()
      await load()
    } catch (err) {
      toast.error(err.message || "Could not save the courier")
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (c) => {
    if (c.code === "manual") return
    try {
      await shippingService.saveCourier({ ...c, active: !c.active })
      await load()
    } catch (err) {
      toast.error(err.message || "Could not update the courier")
    }
  }

  return (
    <div className="bg-white rounded-3xl border border-neutral-200/80 shadow-[0_10px_30px_rgba(0,0,0,0.02)] overflow-hidden">
      <div className="p-6 md:p-8 space-y-5">
        <div className="border-b border-neutral-100 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2"><Truck className="text-amber-600" size={22} /> Couriers &amp; tracking links</h2>
            <p className="text-neutral-500 text-sm mt-1">
              The couriers you can pick when shipping an order. Add a tracking-link template (use <code className="font-mono">{"{tracking}"}</code> where the
              tracking number goes) to give customers a ready &quot;Track&quot; link; leave it empty if the courier has none - you can paste a link per shipment.
              Tracking updates are entered by hand (no courier API is connected).
            </p>
          </div>
          {!draft ? (
            <button type="button" onClick={openNew} className="flex-shrink-0 px-4 h-11 rounded-xl font-bold text-sm text-white bg-amber-600 hover:bg-amber-700 flex items-center gap-2 cursor-pointer">
              <Plus size={16} /> Add courier
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-3 text-neutral-500 text-sm"><Loader2 className="animate-spin" size={18} /> Loading couriers...</div>
        ) : loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : (
          <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100">
            {couriers.map((c) => (
              <div key={c.code} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-neutral-800 text-sm">{c.name} <span className="ml-2 text-[11px] font-mono text-neutral-400">{c.code}</span></p>
                  <p className="text-[12px] text-neutral-500 truncate">{c.trackingUrlTemplate || "No tracking-link template"}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-neutral-600">
                  <input type="checkbox" checked={c.active} disabled={c.code === "manual"} onChange={() => toggleActive(c)} aria-label={`${c.name} is active`} />
                  Active
                </label>
                <button type="button" onClick={() => openEdit(c)} className="h-9 px-3 rounded-lg border border-neutral-300 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 flex items-center gap-1 cursor-pointer">
                  <Pencil size={14} /> Edit
                </button>
              </div>
            ))}
          </div>
        )}

        {draft ? (
          <form onSubmit={save} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-4" noValidate>
            <h3 className="text-sm font-bold text-neutral-800 uppercase tracking-wider">{isNew ? "New courier" : `Edit ${draft.name || draft.code}`}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1" htmlFor="courier-name">Name</label>
                <input id="courier-name" className={fieldCls} value={draft.name} onChange={set("name")} maxLength={80} />
                {errors.name ? <p className="text-xs text-red-600 mt-1">{errors.name}</p> : null}
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1" htmlFor="courier-code">Code (never changes once shipments use it)</label>
                <input id="courier-code" className={fieldCls} value={draft.code} onChange={set("code")} disabled={!isNew} maxLength={40} />
                {errors.code ? <p className="text-xs text-red-600 mt-1">{errors.code}</p> : null}
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-neutral-600 mb-1" htmlFor="courier-tpl">Tracking link template (optional)</label>
                <input id="courier-tpl" className={fieldCls} value={draft.trackingUrlTemplate} onChange={set("trackingUrlTemplate")} placeholder="https://www.example-courier.com/track?no={tracking}" inputMode="url" />
                {errors.trackingUrlTemplate ? <p className="text-xs text-red-600 mt-1">{errors.trackingUrlTemplate}</p> : <p className="text-[12px] text-neutral-500 mt-1">Copy the courier&apos;s own tracking page address for one parcel and replace its number with {"{tracking}"}.</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1" htmlFor="courier-sort">Position in the list</label>
                <input id="courier-sort" type="number" className={fieldCls} value={draft.sortOrder} onChange={set("sortOrder")} />
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-700 pt-6">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} /> Active (shown in the ship form)
                {errors.active ? <span className="text-xs text-red-600">{errors.active}</span> : null}
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={close} disabled={saving} className="px-5 h-11 rounded-xl font-bold text-sm border border-neutral-300 text-neutral-700 hover:bg-neutral-50 cursor-pointer">Cancel</button>
              <button type="submit" disabled={saving} className="px-6 h-11 rounded-xl font-bold text-white text-sm bg-amber-600 hover:bg-amber-700 flex items-center gap-2 cursor-pointer disabled:opacity-60">
                {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Save courier</>}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}