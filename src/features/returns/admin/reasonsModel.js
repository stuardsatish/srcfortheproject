// The configurable return / exchange REASONS (public.request_reasons, migration 20261017_04_return_requests.sql) as the admin edits them - website only (this app
// has no admin screens, by design). PURE: no imports, no I/O. The database stays the authority: its CHECKs (code ~ ^[a-z0-9_]{2,40}$, label <= 80 characters,
// applies_to a non-empty subset of return / exchange) are the same rules as validateReason() below, so a form that passes here is accepted there.
//
// A reason is never DELETED (requests and request lines refer to its code); an admin switches it off. Two flags drive real behaviour:
//   sellerFault          the refund rules read it: a seller-fault reason refunds the outbound shipping on a complete return and never deducts the return courier
//   requiresEvidence /   the customer's request form insists on at least one photo / a written description for this reason (create_return_request checks it too)
//   requiresDescription

export const REASON_TYPES = ['return', 'exchange']
export const REASON_TYPE_LABEL = { return: 'Return', exchange: 'Exchange' }

/** "Wrong colour sent!" -> "wrong_colour_sent" (the code the admin can still change until the reason is saved) */
export const slugReasonCode = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

export const blankReason = () => ({
  code: '', label: '', appliesTo: ['return', 'exchange'], sellerFault: false, requiresEvidence: false, requiresDescription: false, active: true, sortOrder: 100, codeTouched: false,
})

/** a request_reasons row -> the shape the card uses */
export function mapReason(row) {
  if (!row) return null
  return {
    code: row.code,
    label: row.label || '',
    appliesTo: Array.isArray(row.applies_to) ? row.applies_to.filter((t) => REASON_TYPES.includes(t)) : [],
    sellerFault: !!row.seller_fault,
    requiresEvidence: !!row.requires_evidence,
    requiresDescription: !!row.requires_description,
    active: row.active !== false,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 100,
  }
}
export const mapReasons = (rows) => (rows || []).map(mapReason).filter(Boolean)

/** a validated reason -> the columns to write */
export const reasonRow = (v) => ({
  code: v.code, label: v.label, applies_to: v.appliesTo, seller_fault: !!v.sellerFault, requires_evidence: !!v.requiresEvidence,
  requires_description: !!v.requiresDescription, active: v.active !== false, sort_order: v.sortOrder, updated_at: new Date().toISOString(),
})

/**
 * @param draft     { code, label, appliesTo[], sellerFault, requiresEvidence, requiresDescription, active, sortOrder }
 * @param existing  the reasons that exist now (mapped), to refuse a duplicate code and to keep the form usable
 * @returns {{ ok: boolean, errors: Record<string,string>, value: object }} value = the cleaned reason (what reasonRow() writes)
 */
export function validateReason(draft, { existing = [], isNew = true } = {}) {
  const d = draft || {}
  const errors = {}
  const label = String(d.label || '').trim()
  const code = String(d.code || '').trim().toLowerCase()
  if (!label) errors.label = 'Enter the name customers will see'
  else if (label.length > 80) errors.label = 'At most 80 characters'
  if (!/^[a-z0-9_]{2,40}$/.test(code)) errors.code = 'Use 2 to 40 lower-case letters, digits or underscores'
  else if (isNew && (existing || []).some((r) => r.code === code)) errors.code = 'This code is already used by another reason'
  const appliesTo = REASON_TYPES.filter((t) => Array.isArray(d.appliesTo) && d.appliesTo.includes(t))
  if (appliesTo.length === 0) errors.appliesTo = 'Tick Return, Exchange or both'
  const sortRaw = d.sortOrder === '' || d.sortOrder == null ? 100 : Number(d.sortOrder)
  if (!Number.isInteger(sortRaw) || sortRaw < 0 || sortRaw > 100000) errors.sortOrder = 'A whole number from 0 to 100000'
  const value = {
    code, label, appliesTo, sellerFault: !!d.sellerFault, requiresEvidence: !!d.requiresEvidence, requiresDescription: !!d.requiresDescription,
    active: d.active !== false, sortOrder: Number.isInteger(sortRaw) ? sortRaw : 100,
  }
  // the customer's form lists the ACTIVE reasons of its type: a change must never leave a type with none
  if (Object.keys(errors).length === 0) {
    const others = (existing || []).filter((r) => r.code !== code)
    for (const t of REASON_TYPES) {
      const hadOne = (existing || []).some((r) => r.active && (r.appliesTo || []).includes(t))
      const hasOne = [...others, value].some((r) => r.active && (r.appliesTo || []).includes(t))
      if (hadOne && !hasOne) { errors.active = `${REASON_TYPE_LABEL[t]} requests need at least one active reason`; break }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, value }
}

/** one line of the list: "Return · Exchange | seller's fault | photo required" */
export function reasonSummary(r) {
  const bits = [(r.appliesTo || []).map((t) => REASON_TYPE_LABEL[t] || t).join(' · ')]
  if (r.sellerFault) bits.push("seller's fault")
  if (r.requiresEvidence) bits.push('photo required')
  if (r.requiresDescription) bits.push('description required')
  return bits.filter(Boolean).join(' | ')
}