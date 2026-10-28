// Supabase client factories.
//
//   supabaseAdmin() — SERVICE ROLE key. Bypasses RLS entirely. This is the
//     only client allowed to call create_order_tx / rate_limit_check (both
//     REVOKEd from anon/authenticated) and to read server-only tables
//     (pending_orders, rate_limits). Never send this key to a client.
//
//   supabaseForRequest(req) — ANON key + the caller's own Authorization
//     header forwarded through. Calling `.auth.getUser()` on this client
//     verifies the caller's JWT against the Auth server on every call.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let _admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

export function supabaseForRequest(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") || "";
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}