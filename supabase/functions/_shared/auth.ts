// Auth and permission helpers for Supabase Edge Functions.
// Uses Supabase Auth + `profiles` table for all auth and role checks.
import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";
import { supabaseForRequest } from "./clients.ts";

export type AuthResult = { user: User; error: null } | { user: null; error: Response };

/**
 * Verifies the caller's Supabase JWT (sent as `Authorization: Bearer <token>`).
 * `supabase.auth.getUser()` round-trips to the Auth server, so this is a
 * fresh check every call — not just decoding a locally-cached claim, the
 * same guarantee the original's per-request `verifyIdToken()` gave.
 */
export async function requireAuth(req: Request): Promise<AuthResult> {
    const header = req.headers.get("Authorization") || "";
    if (!/^Bearer .+$/.test(header)) {
        return { user: null, error: jsonResponse(req, 401, { success: false, error: "Not authenticated" }) };
    }
    const client = supabaseForRequest(req);
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) {
        return { user: null, error: jsonResponse(req, 401, { success: false, error: "Invalid or expired session. Please log in again." }) };
    }
    return { user: data.user, error: null };
}

/**
 * requireAuth() + a `profiles.role === 'admin'` check.
 */
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<AuthResult> {
    const auth = await requireAuth(req);
    if (!auth.user) return auth;

    const { data: profile, error } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (error || !profile || profile.role !== "admin") {
        return { user: null, error: jsonResponse(req, 403, { success: false, error: "Admin access required" }) };
    }
    return auth;
}

/**
 * Admin-controlled kill switch. Reads settings/security's jsonb `data`.
 * A feature is disabled when `${feature}Enabled === false` OR `allDisabled === true`.
 * Missing row / missing flag → enabled (default-on), matching the original.
 */
export async function isFeatureKilled(admin: SupabaseClient, feature: string): Promise<boolean> {
    try {
        const { data, error } = await admin.from("settings").select("data").eq("id", "security").maybeSingle();
        if (error || !data) return false;
        const d = data.data || {};
        if (d.allDisabled === true) return true;
        return d[`${feature}Enabled`] === false;
    } catch (e) {
        console.error("[isFeatureKilled] error:", e);
        return false; // don't take the whole site down if this read fails
    }
}

/**
 * Per-user block check. Reads `profiles.status`;
 * both 'blocked' and 'suspended' values are treated as blocked.
 */
export async function isUserBlocked(admin: SupabaseClient, userId: string): Promise<boolean> {
    try {
        const { data, error } = await admin.from("profiles").select("status").eq("id", userId).maybeSingle();
        if (error || !data) return false;
        return data.status === "blocked" || data.status === "suspended";
    } catch (e) {
        console.error("[isUserBlocked] error:", e);
        return false;
    }
}

/**
 * Checks if a promo code expiryDate is past the current time. Port of
 * isPromoExpired — handles ISO strings and naive local datetime strings.
 * expiry_date is stored as `timestamptz`, so values read back from Postgres
 * are always timezone-aware ISO strings in practice; the naive-datetime
 * branch is kept for parity with hand-entered/legacy values.
 */
export function isPromoExpired(expiryDate: string | number | null | undefined): boolean {
    if (!expiryDate) return false;
    let expTime: number;
    if (typeof expiryDate === "string" && !expiryDate.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(expiryDate)) {
        const parts = expiryDate.split(/[-T:]/);
        if (parts.length >= 5) {
            expTime = new Date(
                Number(parts[0]),
                Number(parts[1]) - 1,
                Number(parts[2]),
                Number(parts[3]),
                Number(parts[4]),
            ).getTime();
        } else {
            expTime = new Date(expiryDate).getTime();
        }
    } else {
        expTime = new Date(expiryDate).getTime();
    }
    return !isNaN(expTime) && Date.now() > expTime;
}