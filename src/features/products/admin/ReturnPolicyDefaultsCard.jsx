import React, { useEffect, useMemo, useState } from "react"
import { Loader2, RotateCcw, Save } from "lucide-react"
import { toast } from "react-toastify"
import { supabase } from "../../../context/SupabaseConfig"
import { getReturnPolicyDefaults, saveReturnPolicyDefaults } from "../../../services/settingsService"
import PolicyFields from "./PolicyFields"
import { categoryListsFromSettings, policyError, policyFromSettings, policyToSettings } from "./productForm"

// Admin ▸ Optimization: the STORE-WIDE return / exchange defaults (settings.returnPolicyDefaults).
// What they do: pre-fill the policy of every NEW product (and bulk-import rows that leave the policy blank). What they do NOT do:
// change existing products, or the policy an order was bought under. The two category lists answer "which categories are not
// returnable / exchangeable by default" (perishables, customised items …): a new product in such a category starts with that
// policy OFF — the admin can still switch it back on for that one product.
// The database validates the same rules (windows 1–365 while enabled, none while disabled).

const sameCategory = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

export default function ReturnPolicyDefaultsCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [policy, setPolicy] = useState(() => policyFromSettings(null))
  const [lists, setLists] = useState({ noReturnCategories: [], noExchangeCategories: [] })
  const [known, setKnown] = useState([])     // categories that exist in the catalogue

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [doc, rows] = await Promise.all([getReturnPolicyDefaults(), supabase.from("products").select("category")])
        if (!active) return
        setPolicy(policyFromSettings(doc))
        setLists(categoryListsFromSettings(doc))
        const names = (rows.data || []).map((r) => String(r.category || "").trim()).filter(Boolean)
        setKnown([...new Set(names)].sort((a, b) => a.localeCompare(b)))
      } catch (err) {
        console.error("Failed to load the return policy defaults:", err)
        toast.error("Failed to load the return & exchange defaults.")
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  // every catalogue category, plus any listed category that no product uses (yet)
  const rows = useMemo(() => {
    const out = [...known]
    for (const c of [...lists.noReturnCategories, ...lists.noExchangeCategories]) if (!out.some((x) => sameCategory(x, c))) out.push(c)
    return out
  }, [known, lists])

  const toggle = (key, category) => setLists((cur) => {
    const has = cur[key].some((c) => sameCategory(c, category))
    return { ...cur, [key]: has ? cur[key].filter((c) => !sameCategory(c, category)) : [...cur[key], category] }
  })
  const listed = (key, category) => lists[key].some((c) => sameCategory(c, category))

  const handleSave = async (e) => {
    e.preventDefault()
    const problem = policyError(policy)
    if (problem) { toast.error(`Store defaults: ${problem}`); return }
    setSaving(true)
    try {
      await saveReturnPolicyDefaults(policyToSettings(policy, lists))
      toast.success("Return & exchange defaults saved")
    } catch (err) {
      console.error("Failed to save the return policy defaults:", err)
      toast.error(String(err?.message || "").startsWith("Invalid return policy defaults") ? err.message : "Failed to save the return & exchange defaults.")
    } finally {
      setSaving(false)
    }
  }

  const reset = () => { setPolicy(policyFromSettings(null)); setLists({ noReturnCategories: [], noExchangeCategories: [] }) }

  if (loading) {
    return (
      <div className="bg-white rounded-3xl border border-neutral-200/80 p-8 flex items-center gap-3 text-neutral-500 text-sm">
        <Loader2 className="animate-spin" size={18} /> Loading return &amp; exchange defaults…
      </div>
    )
  }

  return (
    <div className="bg-white rounded-3xl border border-neutral-200/80 shadow-[0_10px_30px_rgba(0,0,0,0.02)] overflow-hidden">
      <form onSubmit={handleSave} className="p-6 md:p-8 space-y-6">
        <div className="border-b border-neutral-100 pb-4">
          <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
            <RotateCcw className="text-amber-600" size={22} /> Return &amp; Exchange Defaults
          </h2>
          <p className="text-neutral-500 text-sm mt-1">
            What a NEW product starts with (and what a bulk-import row gets when it leaves the policy blank). Existing products and
            existing orders are never changed by this page; each product can still override it in its own form.
          </p>
        </div>

        <PolicyFields idPrefix="store-policy" value={policy} onChange={setPolicy} />

        <div>
          <h3 className="text-sm font-bold text-neutral-800 uppercase tracking-wider mb-1">Categories that start with the policy OFF</h3>
          <p className="text-[12px] text-neutral-500 mb-3">
            Tick the categories whose new products should NOT be returnable / exchangeable by default (for example perishables or
            customised items). Remember any legal duty to remedy damaged or wrong items.
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-400">No categories yet — they appear here once products exist.</p>
          ) : (
            <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100">
              <div className="grid grid-cols-[1fr_auto_auto] gap-6 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                <span>Category</span><span>No returns</span><span>No exchanges</span>
              </div>
              {rows.map((c) => (
                <div key={c} className="grid grid-cols-[1fr_auto_auto] gap-6 px-4 py-2 items-center text-sm">
                  <span className="text-neutral-800">{c}</span>
                  <input type="checkbox" aria-label={`${c}: no returns`} checked={listed("noReturnCategories", c)} onChange={() => toggle("noReturnCategories", c)} className="mx-auto" />
                  <input type="checkbox" aria-label={`${c}: no exchanges`} checked={listed("noExchangeCategories", c)} onChange={() => toggle("noExchangeCategories", c)} className="mx-auto" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
          <button
            type="button" onClick={reset} disabled={saving}
            className="px-5 h-12 rounded-xl font-bold text-sm border border-neutral-300 text-neutral-700 hover:bg-neutral-50 cursor-pointer"
          >
            Reset to 7 / 7
          </button>
          <button
            type="submit" disabled={saving}
            className={`px-6 h-12 rounded-xl font-bold text-white text-sm tracking-wide flex items-center justify-center gap-2 shadow-md transition-all ${saving ? "bg-neutral-300 text-neutral-500 cursor-not-allowed shadow-none" : "bg-amber-600 hover:bg-amber-700 active:scale-[0.99] cursor-pointer"}`}
          >
            {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> Save defaults</>}
          </button>
        </div>
      </form>
    </div>
  )
}