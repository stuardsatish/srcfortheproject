/**
 * Pure address-book logic (no Supabase / Redux imports) so it can be exercised
 * with a plain `node` script. The data-access half lives in `./addresses.js`,
 * which re-exports everything here — screens should import from there.
 */

/** Mirrors the `addresses_before_write` trigger limit. */
export const ADDRESS_LIMIT = 10

export const LABEL_PRESETS = ["Home", "Work", "Other"]

const EMPTY_FIELDS = {
    label: "Home",
    fullName: "",
    phone: "",
    line1: "",
    line2: "",
    landmark: "",
    city: "",
    state: "",
    pincode: "",
}

const str = (v) => (v == null ? "" : String(v))

/** Strip spaces / dashes / brackets and a leading +91 or 0, keeping digits only. */
export function normalizePhone(raw) {
    let digits = str(raw).replace(/\D/g, "")
    // "+91 98765 43210" / "91 9876543210" / "0 9876543210" -> last 10 digits
    if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2)
    else if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1)
    return digits
}

/** Fresh form values, optionally seeded (e.g. with the customer's name/phone). */
export function emptyAddressFields(seed = {}) {
    return { ...EMPTY_FIELDS, ...seed }
}

/**
 * @param {object} fields camelCase form values
 * @returns {{ ok: boolean, errors: Record<string,string>, values: object }}
 *   `values` is the trimmed/normalised copy that should be sent to the DB.
 */
export function validateAddress(fields) {
    const f = fields || {}
    const values = {
        label: str(f.label).trim(),
        fullName: str(f.fullName).trim(),
        phone: normalizePhone(f.phone),
        line1: str(f.line1).trim(),
        line2: str(f.line2).trim(),
        landmark: str(f.landmark).trim(),
        city: str(f.city).trim(),
        state: str(f.state).trim(),
        pincode: str(f.pincode).replace(/\s/g, ""),
    }
    const errors = {}

    if (values.label.length < 1) errors.label = "Give this address a label"
    else if (values.label.length > 30) errors.label = "Label can be at most 30 characters"

    if (values.fullName.length < 2) errors.fullName = "Enter the receiver's full name (at least 2 characters)"
    else if (values.fullName.length > 100) errors.fullName = "Name can be at most 100 characters"

    if (!/^\d{10}$/.test(values.phone)) errors.phone = "Enter a valid 10-digit mobile number"

    if (values.line1.length < 3) errors.line1 = "Enter your house / flat / street (at least 3 characters)"
    else if (values.line1.length > 200) errors.line1 = "Address can be at most 200 characters"

    if (values.line2.length > 200) errors.line2 = "Address line 2 can be at most 200 characters"
    if (values.landmark.length > 100) errors.landmark = "Landmark can be at most 100 characters"

    if (!values.city) errors.city = "Enter the city"
    else if (values.city.length > 80) errors.city = "City can be at most 80 characters"

    if (!values.state) errors.state = "Enter the state"
    else if (values.state.length > 80) errors.state = "State can be at most 80 characters"

    if (!/^\d{6}$/.test(values.pincode)) errors.pincode = "Enter a valid 6-digit pincode"

    return { ok: Object.keys(errors).length === 0, errors, values }
}

/** "line1, line2, city, state - pincode" (landmark is shown separately by the UI). */
export function formatAddressLine(address) {
    const a = address || {}
    // Customers often type a trailing comma ("Navy Nagar 3,"); don't double it up.
    const parts = [a.line1, a.line2, a.city, a.state].map((s) => str(s).trim().replace(/[\s,]+$/, "")).filter(Boolean)
    const pin = str(a.pincode).trim()
    const head = parts.join(", ")
    if (!pin) return head
    return head ? `${head} - ${pin}` : pin
}

/** DB row (snake_case) -> UI object (camelCase). */
export function fromRow(row) {
    const r = row || {}
    return {
        id: r.id,
        label: str(r.label),
        fullName: str(r.full_name),
        phone: str(r.phone),
        line1: str(r.line1),
        line2: str(r.line2),
        landmark: str(r.landmark),
        city: str(r.city),
        state: str(r.state),
        pincode: str(r.pincode),
        country: str(r.country) || "India",
        isDefault: !!r.is_default,
        createdAt: r.created_at || null,
    }
}

/**
 * UI fields -> DB columns. Only keys present in `fields` are emitted, so this
 * works for partial updates too. `is_default` is only ever sent as `true`:
 * un-defaulting is done by choosing another address (the trigger handles it),
 * and sending `false` for the current default would leave the user without one.
 */
export function toRow(fields) {
    const f = fields || {}
    const row = {}
    if ("label" in f) row.label = str(f.label).trim()
    if ("fullName" in f) row.full_name = str(f.fullName).trim()
    if ("phone" in f) row.phone = normalizePhone(f.phone)
    if ("line1" in f) row.line1 = str(f.line1).trim()
    if ("line2" in f) row.line2 = str(f.line2).trim()
    if ("landmark" in f) row.landmark = str(f.landmark).trim()
    if ("city" in f) row.city = str(f.city).trim()
    if ("state" in f) row.state = str(f.state).trim()
    if ("pincode" in f) row.pincode = str(f.pincode).replace(/\s/g, "")
    if (f.isDefault === true) row.is_default = true
    return row
}

/**
 * `profiles.address` (legacy shape the trigger mirrors the default into) -> the
 * same camelCase shape as an address row, so one formatter serves both. Returns
 * null when there is no street on file. `id` is only present for addresses
 * mirrored by the trigger (older / signup-time addresses have none).
 */
export function addressFromProfile(profileAddress) {
    if (!profileAddress) return null
    if (typeof profileAddress === "string") {
        const s = profileAddress.trim()
        return s ? { id: null, label: "", fullName: "", phone: "", line1: s, line2: "", landmark: "", city: "", state: "", pincode: "", country: "India", isDefault: true } : null
    }
    if (typeof profileAddress !== "object") return null
    const street = str(profileAddress.street).trim()
    if (!street) return null
    return {
        id: profileAddress.addressId || null,
        label: str(profileAddress.label),
        fullName: str(profileAddress.fullName),
        phone: str(profileAddress.phone),
        line1: street,
        line2: "",
        landmark: str(profileAddress.landmark),
        city: str(profileAddress.city),
        state: str(profileAddress.state),
        pincode: str(profileAddress.pincode),
        country: str(profileAddress.country) || "India",
        isDefault: true,
    }
}

/** PostgREST signals that mean "this table / function isn't deployed yet". */
export function isBackendMissing(error) {
    if (!error) return false
    const code = String(error.code || "")
    if (["PGRST202", "PGRST205", "42883", "42P01"].includes(code)) return true
    const msg = String(error.message || "")
    return /Could not find the function|schema cache/i.test(msg)
}