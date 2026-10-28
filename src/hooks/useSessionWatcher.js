import { useEffect, useRef } from "react"
import { supabase } from "../context/SupabaseConfig"
import { getLocalSessionId, forceLogout, inSessionGrace } from "../utils/sessionManager"

/**
 * Watches profiles.active_session_id in realtime. When another device logs in
 * it overwrites that column; this device then sees its stored id no longer
 * match and logs itself out. Mount once near the app root with the current
 * user's id.
 *
 * Important safety properties (so a normal login never logs itself out):
 *  - the local id is read fresh on every event (not captured once),
 *  - a logout only fires when BOTH ids exist and differ,
 *  - mismatches during the post-login grace window are ignored.
 *
 * @param {string|null|undefined} uid
 */
const useSessionWatcher = (uid) => {
    const channelRef = useRef(null)

    useEffect(() => {
        if (!uid) return

        const handleRow = (row) => {
            if (!row) return
            const remoteSessionId = row.active_session_id
            const localSessionId = getLocalSessionId()

            // Genuine cross-device takeover only: both ids present, they differ, and
            // we're not mid-login. A missing local id (pre-feature / just cleared) is
            // NOT treated as a conflict, so it can never bounce a fresh login.
            if (
                remoteSessionId &&
                localSessionId &&
                remoteSessionId !== localSessionId &&
                !inSessionGrace()
            ) {
                console.warn("Session conflict detected. Logging out this device.")
                if (channelRef.current) supabase.removeChannel(channelRef.current)
                forceLogout("session_conflict")
            }
        }

        // Pick up a conflicting session that was already written before this
        // listener attached (e.g. page just loaded).
        supabase
            .from("profiles")
            .select("active_session_id")
            .eq("id", uid)
            .single()
            .then(({ data, error }) => {
                if (!error) handleRow(data)
            })

        channelRef.current = supabase
            .channel(`profile-session-${uid}`)
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
                (payload) => handleRow(payload.new),
            )
            .subscribe()

        return () => {
            if (channelRef.current) supabase.removeChannel(channelRef.current)
        }
    }, [uid])
}

export default useSessionWatcher