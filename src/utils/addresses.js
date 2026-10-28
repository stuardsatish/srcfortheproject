/**
 * Address book (roadmap 4.x) — data access for the `addresses` table.
 *
 * The database does the heavy lifting (see 20261008_02_address_book.sql): max 10
 * per user, first one is the default, setting a default un-defaults the others,
 * the default is mirrored into `profiles.address`, and deleting the default
 * promotes the newest remaining row. This module only talks to the table and
 * keeps the Redux copy of the profile in step afterwards.
 */
import { supabase } from "../context/SupabaseConfig"
import { store } from "../context/Store"
import { setUser } from "../context/UserSlice"
import { fromRow, toRow, isBackendMissing } from "./addressLogic"

export {
    ADDRESS_LIMIT,
    LABEL_PRESETS,
    validateAddress,
    formatAddressLine,
    normalizePhone,
    emptyAddressFields,
    addressFromProfile,
} from "./addressLogic"

const UNAVAILABLE_MESSAGE = "The address book isn't available right now. Please try again later."

// Old deployments / a database without the migration must keep working: a
// missing table is a normal condition, noted once per session, never an error.
let backendMissing = false
let warned = false
const noteBackendMissing = (error) => {
    backendMissing = true
    if (!warned) {
        warned = true
        console.warn("Address book backend is not deployed yet; address features are disabled.", error?.message || "")
    }
}

/** True once a call has discovered the `addresses` table is not deployed. */
export const isAddressBookMissing = () => backendMissing

async function currentUserId() {
    const reduxUid = store.getState().user.user?.uid
    if (reduxUid) return reduxUid
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id || null
}

/**
 * Checkout, COD validation and invoices read `profiles.address` from the Redux
 * user, and the database trigger changes it behind our back — so after every
 * mutation re-read it and push it into Redux. Best effort: the mutation itself
 * has already succeeded, so a failure here must not surface as one.
 */
export async function refreshProfileAddress() {
    const current = store.getState().user.user
    if (!current?.uid) return
    try {
        const { data, error } = await supabase
            .from("profiles")
            .select("address")
            .eq("id", current.uid)
            .single()
        if (error) throw error
        // Re-read the store: the user may have changed while the request was in flight.
        const latest = store.getState().user.user
        if (latest?.uid === current.uid) store.dispatch(setUser({ ...latest, address: data?.address ?? null }))
    } catch (err) {
        console.warn("Could not refresh the profile address:", err?.message || err)
    }
}

/** Default first, then newest. Returns [] when the feature is not deployed. */
export async function listAddresses() {
    const { data, error } = await supabase
        .from("addresses")
        .select("*")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
    if (error) {
        if (isBackendMissing(error)) {
            noteBackendMissing(error)
            return []
        }
        throw new Error(error.message || "Could not load your addresses.")
    }
    return (data || []).map(fromRow)
}

// Shared by the four mutations: translate the result and refresh Redux.
async function finishMutation(error, row, fallbackMessage) {
    if (error) {
        if (isBackendMissing(error)) {
            noteBackendMissing(error)
            throw new Error(UNAVAILABLE_MESSAGE)
        }
        // Trigger messages (e.g. the 10-address limit) are written to be user-readable.
        throw new Error(error.message || fallbackMessage)
    }
    await refreshProfileAddress()
    return row ? fromRow(row) : null
}

export async function createAddress(fields) {
    const userId = await currentUserId()
    if (!userId) throw new Error("Please sign in to save an address.")
    const { data, error } = await supabase
        .from("addresses")
        .insert({ ...toRow(fields), user_id: userId })
        .select()
        .single()
    return finishMutation(error, data, "Could not save the address.")
}

export async function updateAddress(id, fields) {
    const { data, error } = await supabase
        .from("addresses")
        .update(toRow(fields))
        .eq("id", id)
        .select()
        .single()
    return finishMutation(error, data, "Could not update the address.")
}

export async function deleteAddress(id) {
    const { error } = await supabase.from("addresses").delete().eq("id", id)
    await finishMutation(error, null, "Could not delete the address.")
}

/** Selecting an address at checkout == making it the default (see header). */
export async function setDefaultAddress(id) {
    const { data, error } = await supabase
        .from("addresses")
        .update({ is_default: true })
        .eq("id", id)
        .select()
        .single()
    return finishMutation(error, data, "Could not change the default address.")
}