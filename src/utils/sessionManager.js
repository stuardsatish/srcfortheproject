import { supabase } from "../context/SupabaseConfig"

/**
 * Single-session enforcement helpers.
 *
 * Source of truth is profiles.active_session_id (Supabase Postgres). Each
 * device stores its own copy in localStorage (SESSION_KEY). A logging-in
 * device overwrites the row; every other device's watcher (useSessionWatcher)
 * sees the mismatch via a Realtime subscription and logs itself out.
 *
 * NOTE: this is separate from the cross-tab layer in sessionUtils.js
 * (key "auth_session"); this one uses key "app_session_id" and works across
 * devices/browsers, not just tabs.
 */

export const SESSION_KEY = "app_session_id"

/** Random unique session id (crypto when available, fallback otherwise). */
export const generateSessionId = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

/**
 * Register a new session for this device on login. Overwrites any session held
 * by other devices for the same account, then mirrors the id into localStorage.
 * @param {string} uid
 * @returns {Promise<string>} the new session id
 */
// Brief window after a login during which the session watcher ignores
// local/profiles id mismatches — they're expected while the new id propagates,
// and acting on them would log the user out of the very session they just opened.
let _graceUntil = 0
export const beginSessionGrace = (ms = 10000) => { _graceUntil = Date.now() + ms }
export const inSessionGrace = () => Date.now() < _graceUntil

export const registerNewSession = async (uid) => {
  const sessionId = generateSessionId()

  // Suppress the watcher while local + profiles settle to the new id.
  beginSessionGrace()

  // Mirror locally, then write the id to the profiles row IMMEDIATELY (no
  // slow calls in between) so the two stay in sync within the grace window.
  localStorage.setItem(SESSION_KEY, sessionId)
  const deviceInfo = (navigator.userAgent || "").substring(0, 150)

  try {
    const { error } = await supabase
      .from("profiles")
      .update({
        active_session_id: sessionId,
        last_login_at: new Date().toISOString(),
        last_login_device: deviceInfo,
      })
      .eq("id", uid)
    if (error) console.log("registerNewSession: failed to write session:", error)
  } catch (e) {
    console.log("registerNewSession: failed to write session:", e)
  }

  // IP is optional — fetch + store in the background; never block or fail login.
  fetch("https://api.ipify.org?format=json")
    .then((r) => r.json())
    .then((d) => d?.ip && supabase.from("profiles").update({ last_login_ip: d.ip }).eq("id", uid))
    .catch(() => { })

  return sessionId
}

/** Remove this device's stored session id. */
export const clearLocalSession = () => {
  localStorage.removeItem(SESSION_KEY)
}

/** This device's stored session id (or null). */
export const getLocalSessionId = () => localStorage.getItem(SESSION_KEY)

/**
 * Force this device to log out and bounce to /login with a reason.
 * @param {"session_conflict"|"no_session"|string} reason
 */
export const forceLogout = async (reason = "session_conflict") => {
  clearLocalSession()
  try {
    // scope: 'local' — this call runs on the STALE device detecting a newer
    // login elsewhere. The default (global) scope revokes every session for
    // the user, including the new one that's supposed to remain active,
    // which defeats single-session enforcement entirely.
    await supabase.auth.signOut({ scope: "local" })
  } catch (e) {
    console.log("Sign out error:", e)
  }
  window.location.href = `/login?reason=${reason}`
}