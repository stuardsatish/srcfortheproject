import { supabase } from "../context/SupabaseConfig"
import { mapProductRows } from "../utils/supabaseProducts"

/**
 * Typo-tolerant product search (roadmap task 2.2).
 *
 * Primary path is the `search_products` RPC added by
 * `supabase/migrations/20261006_01_product_search_trgm.sql`, which uses
 * pg_trgm to match both substrings ("bed" → "Annibale Colombo Bed") and
 * near-misses ("furnitre" → furniture).
 *
 * It falls back to a local substring scan over an already-loaded catalog when
 * the RPC isn't reachable. That matters for two real cases, not just
 * theoretically:
 *   1. The migration is written but not yet applied to the shared project —
 *      search keeps working exactly as it did before, just without typo
 *      tolerance, instead of the page breaking.
 *   2. Any transient network/RPC failure degrades instead of erroring out.
 *
 * `rpcUnavailable` is latched after the first failure so a missing function
 * costs one round trip per page load rather than one per keystroke.
 */

let rpcUnavailable = false

const MIN_QUERY_LENGTH = 2

/** Local fallback: the same title/brand/category substring match, client-side. */
const localSearch = (query, catalog, limit) => {
    const needle = query.trim().toLowerCase()
    if (needle.length < MIN_QUERY_LENGTH) return []
    return catalog
        .filter((p) => {
            const title = String(p.title || p.name || "").toLowerCase()
            const brand = String(p.brand || "").toLowerCase()
            const category = String(p.category || "").toLowerCase()
            return (
                title.includes(needle) || brand.includes(needle) || category.includes(needle)
            )
        })
        .slice(0, limit)
}

/**
 * @param {string} query
 * @param {object} [options]
 * @param {Array}  [options.catalog=[]] Already-loaded products, used only by the fallback.
 * @param {number} [options.limit=20]
 * @returns {Promise<{ results: Array, typoTolerant: boolean }>}
 *          `typoTolerant` reports which path actually ran, so the UI can be
 *          honest about whether fuzzy matching was in play.
 */
export const searchProducts = async (query, { catalog = [], limit = 20 } = {}) => {
    const cleaned = String(query || "").trim()
    if (cleaned.length < MIN_QUERY_LENGTH) {
        return { results: [], typoTolerant: false }
    }

    if (!rpcUnavailable) {
        try {
            const { data, error } = await supabase.rpc("search_products", {
                q: cleaned,
                limit_count: limit,
            })
            if (error) throw error
            return { results: mapProductRows(data || []), typoTolerant: true }
        } catch (err) {
            // PGRST202 = function not found in the schema cache, i.e. the
            // migration hasn't been applied yet. Anything else (network, RLS)
            // is treated the same way: degrade, don't break.
            rpcUnavailable = true
            console.log("search_products RPC unavailable, using local fallback:", err?.message || err)
        }
    }

    return { results: localSearch(cleaned, catalog, limit), typoTolerant: false }
}

/** Test/debug helper — lets the latched flag be reset after a failure. */
export const resetSearchRpcState = () => {
    rpcUnavailable = false
}