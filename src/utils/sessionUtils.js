/**
 * Cross-tab auth session helpers.
 *
 * Mirrors the authenticated identity (Supabase + Redux) into `sessionStorage`
 * (per-tab) and coordinates tabs over a `BroadcastChannel` so login/logout
 * stay in sync everywhere.
 */

const SESSION_KEY = "auth_session"
const CHANNEL_NAME = "auth_channel"

let _channel = null

/**
 * Lazily create/return the shared BroadcastChannel (null if unsupported).
 * @returns {BroadcastChannel|null}
 */
export const getChannel = () => {
  if (typeof BroadcastChannel === "undefined") return null
  if (!_channel) _channel = new BroadcastChannel(CHANNEL_NAME)
  return _channel
}

/** Strip HTML tags from a string value (no-op for non-strings). */
const stripHtml = (v) => (typeof v === "string" ? v.replace(/<[^>]*>/g, "").trim() : v)

/**
 * Read the current tab's auth session.
 * @returns {{token?:string, role?:string, userId?:string, userName?:string, email?:string}|null}
 */
export const getSession = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Persist the auth session for this tab, sanitising every stored field.
 * @param {{token?:string, role?:string, userId?:string, userName?:string, email?:string}} data
 */
export const setSession = (data) => {
  if (!data) return
  const clean = {
    token: stripHtml(data.token || ""),
    role: stripHtml(data.role || ""),
    userId: stripHtml(data.userId || ""),
    userName: stripHtml(data.userName || ""),
    email: stripHtml(data.email || ""),
  }
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(clean)) } catch { /* quota / disabled */ }
}

/** Clear this tab's auth session. */
export const clearSession = () => {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
}

/**
 * Broadcast an auth event to all other tabs.
 * @param {"login"|"logout"|"who"|"present"} type
 * @param {Object} [payload]
 */
export const broadcastAuth = (type, payload = {}) => {
  const ch = getChannel()
  if (ch) ch.postMessage({ type, payload, ts: Date.now() })
}

/**
 * Ask other tabs whether one is already authenticated. Resolves with the
 * first responding tab's `{ role, userName }`, or `null` after a short timeout.
 * Used to block a conflicting second login in a new tab.
 * @returns {Promise<{role:string, userName?:string}|null>}
 */
export const queryActiveTabs = () =>
  new Promise((resolve) => {
    const ch = getChannel()
    if (!ch) return resolve(null)
    let done = false
    const onMsg = (e) => {
      if (e.data?.type === "present" && !done) {
        done = true
        ch.removeEventListener("message", onMsg)
        resolve(e.data.payload || null)
      }
    }
    ch.addEventListener("message", onMsg)
    broadcastAuth("who")
    setTimeout(() => {
      if (!done) { ch.removeEventListener("message", onMsg); resolve(null) }
    }, 300)
  })