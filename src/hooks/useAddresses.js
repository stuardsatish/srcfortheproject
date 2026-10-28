import { useCallback, useEffect, useState } from "react"
import { listAddresses } from "../utils/addresses"

/**
 * Loads the signed-in customer's saved addresses (default first).
 * `enabled` lets a drawer defer the fetch until it is opened.
 *
 * @returns {{
 *   addresses: object[],
 *   status: "loading"|"ready"|"error",
 *   error: string,
 *   reload: () => void
 * }}
 */
export default function useAddresses(enabled = true) {
    const [state, setState] = useState({ addresses: [], status: "loading", error: "" })
    const [reloadKey, setReloadKey] = useState(0)

    useEffect(() => {
        if (!enabled) return
        let active = true
        listAddresses()
            .then((addresses) => { if (active) setState({ addresses, status: "ready", error: "" }) })
            .catch((err) => { if (active) setState({ addresses: [], status: "error", error: err.message || "Could not load your addresses." }) })
        return () => { active = false }
    }, [enabled, reloadKey])

    // Keep the previous list on screen while refetching (no skeleton flash after
    // an edit); only a failed first load shows the loading state again.
    const reload = useCallback(() => {
        setState((s) => (s.status === "error" ? { ...s, status: "loading" } : s))
        setReloadKey((k) => k + 1)
    }, [])

    return { ...state, reload }
}