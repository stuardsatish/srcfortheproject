// Shared helper for calling Supabase Edge Functions from the client.
// Auth is Supabase-only (see src/hooks/useAuth.js);
// the bearer token is the current Supabase session's access_token.
import { supabase } from "../context/SupabaseConfig"

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL || "https://hexosjsftzdqmwqbeahy.supabase.co"
export const FUNCTIONS_BASE = `${PROJECT_URL}/functions/v1`

/** JSON headers + the current Supabase session's access token, if any. */
export async function functionAuthHeaders() {
  const headers = { "Content-Type": "application/json" }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    /* sent without token → the function 401s */
  }
  return headers
}

/**
 * POSTs JSON to an Edge Function with the caller's Supabase session attached.
 * @param {string} name  Edge Function name, e.g. "payment-create-order"
 * @param {object} body
 */
export async function callFunction(name, body) {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: await functionAuthHeaders(),
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}