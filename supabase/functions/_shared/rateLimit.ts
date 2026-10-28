// Port of functions/lib/util.js's rateLimit()/globalDailyLimit(), backed by
// the `rate_limit_check` Postgres function (02-order-rpc.sql) instead of a
// Firestore transaction. Same fixed-window semantics, same fail-closed
// default. Must be called with the SERVICE ROLE client — the RPC is REVOKEd
// from anon/authenticated.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * @param key     Unique bucket, e.g. `create-order:<uid>`
 * @param max     Max calls allowed per window
 * @param windowMs Window length in ms (converted to seconds for the RPC)
 * @param opts.failOpen  If true, allow the call when the limiter itself
 *        errors. Defaults to FAIL-CLOSED (deny), same as the original —
 *        a limiter outage must not be usable to bypass abuse protection on
 *        cost-bearing routes.
 */
export async function rateLimit(
  admin: SupabaseClient,
  key: string,
  max: number,
  windowMs: number,
  opts: { failOpen?: boolean } = {},
): Promise<boolean> {
  const { failOpen = false } = opts;
  try {
    const { data, error } = await admin.rpc("rate_limit_check", {
      p_key: key,
      p_max: max,
      p_window_seconds: Math.round(windowMs / 1000),
    });
    if (error) throw error;
    return !!data;
  } catch (e) {
    console.error("[rateLimit] error:", e);
    return failOpen;
  }
}

/**
 * Global per-day counter — port of globalDailyLimit(). Reuses the same
 * rate_limit_check primitive: a day-stamped key (`global-<name>-<day>`) with
 * an 86400s window gives the identical "resets once a UTC day boundary is
 * crossed" behavior the original's day-string key achieved. FAIL-CLOSED.
 */
export async function globalDailyLimit(admin: SupabaseClient, name: string, max: number, day: string): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("rate_limit_check", {
      p_key: `global-${name}-${day}`,
      p_max: max,
      p_window_seconds: 86400,
    });
    if (error) throw error;
    return !!data;
  } catch (e) {
    console.error("[globalDailyLimit] error:", e);
    return false; // fail-closed
  }
}