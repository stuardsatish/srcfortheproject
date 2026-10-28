import { useEffect, useRef } from "react"
import { useDispatch, useSelector } from "react-redux"
import { supabase } from "../context/SupabaseConfig"
import { clearUser } from "../context/UserSlice"
import { clearCart } from "../context/CartSlice"
import { getChannel, setSession, clearSession, broadcastAuth } from "../utils/sessionUtils"

/**
 * Headless component (renders nothing) that keeps auth state consistent across
 * tabs:
 *  - mirrors the Redux user into this tab's sessionStorage,
 *  - logs this tab out when any other tab broadcasts "logout",
 *  - answers "who" probes so a new tab can detect an existing session and
 *    block a conflicting second login.
 *
 * Mount once, inside the Router/Provider tree (e.g. in App.jsx).
 */
export default function SessionManager() {
    const dispatch = useDispatch()
    const user = useSelector((s) => s.user.user)
    const userRef = useRef(user)

    // Mirror Redux auth into sessionStorage (per-tab) whenever it changes.
    useEffect(() => {
        userRef.current = user
        if (user) {
            setSession({ token: user.uid, role: user.role, userId: user.uid, userName: user.name, email: user.email })
        } else {
            clearSession()
        }
    }, [user])

    // Cross-tab BroadcastChannel listener for auth events.
    useEffect(() => {
        const ch = getChannel()
        if (!ch) return
        const onMsg = (e) => {
            const { type } = e.data || {}
            if (type === "logout") {
                // Another tab logged out → tear down here too.
                clearSession()
                dispatch(clearUser())
                supabase.auth.signOut().catch(() => { })
            } else if (type === "who") {
                // A new tab is probing for an existing session — answer if authenticated.
                if (userRef.current) {
                    broadcastAuth("present", { role: userRef.current.role, userName: userRef.current.name })
                }
            }
        }
        ch.addEventListener("message", onMsg)
        return () => ch.removeEventListener("message", onMsg)
    }, [dispatch])

    // Cross-tab cart clearance listener via localStorage storage event.
    // NOTE: The storage event only fires in OTHER tabs/windows, not the one
    // that set the item. The primary real-time sync now uses Firestore onSnapshot
    // in App.jsx, so this is a belt-and-suspenders fallback for cross-tab reloads.
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === "cart-clear-trigger") {
                dispatch(clearCart())
                if (window.location.pathname.includes("/cart")) {
                    window.location.reload()
                }
            }
        }
        window.addEventListener("storage", handleStorageChange)
        return () => window.removeEventListener("storage", handleStorageChange)
    }, [dispatch])

    return null
}