// ============================================================================
// reviews-create — SELF-CONTAINED Dashboard bundle.
// Paste this whole file as the function's index.ts in the Supabase Dashboard
// (Edge Functions -> Deploy a new function -> name it "reviews-create").
// ============================================================================
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

/* ============================== cors.ts ============================== */
const DEFAULT_ORIGINS = [
    "https://e-commerce-demo-website1.web.app",
    "https://my-sweet-bec4a.web.app",
    "http://localhost:5173",
];
function allowedOrigins(): string[] {
    const env = Deno.env.get("ALLOWED_ORIGINS");
    if (!env) return DEFAULT_ORIGINS;
    return env.split(",").map((s) => s.trim()).filter(Boolean);
}
const SECURITY_HEADERS: Record<string, string> = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-site",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Referrer-Policy": "no-referrer",
};
function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get("Origin");
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
        Vary: "Origin",
    };
    if (!origin) return headers;
    if (allowedOrigins().includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
    return headers;
}
function jsonResponse(req: Request, status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...corsHeaders(req), ...extraHeaders },
    });
}
const MAX_BODY_BYTES = 64 * 1024;
async function readBody(req: Request): Promise<{ raw: string; json: any }> {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
        const e = new Error("Request body too large");
        (e as any).code = "BODY_TOO_LARGE";
        throw e;
    }
    let json: any = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch { json = {}; }
    return { raw, json };
}
function handlePreflight(req: Request): Response | null {
    if (req.method !== "OPTIONS") return null;
    return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
}
function methodNotAllowed(req: Request, allow: string[]): Response | null {
    if (allow.includes(req.method)) return null;
    return jsonResponse(req, 405, { success: false, error: "Method not allowed" });
}

/* ============================== clients.ts ============================== */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let _admin: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
    if (_admin) return _admin;
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    return _admin;
}
function supabaseForRequest(req: Request): SupabaseClient {
    const authHeader = req.headers.get("Authorization") || "";
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: authHeader } },
    });
}

/* ============================== auth.ts (subset) ============================== */
type AuthResult = { user: User; error: null } | { user: null; error: Response };
async function requireAuth(req: Request): Promise<AuthResult> {
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
async function isFeatureKilled(admin: SupabaseClient, feature: string): Promise<boolean> {
    try {
        const { data, error } = await admin.from("settings").select("data").eq("id", "security").maybeSingle();
        if (error || !data) return false;
        const d = data.data || {};
        if (d.allDisabled === true) return true;
        return d[`${feature}Enabled`] === false;
    } catch (e) {
        console.error("[isFeatureKilled] error:", e);
        return false;
    }
}
async function isUserBlocked(admin: SupabaseClient, userId: string): Promise<boolean> {
    try {
        const { data, error } = await admin.from("profiles").select("status").eq("id", userId).maybeSingle();
        if (error || !data) return false;
        return data.status === "blocked" || data.status === "suspended";
    } catch (e) {
        console.error("[isUserBlocked] error:", e);
        return false;
    }
}

/* ============================== rateLimit.ts (rateLimit only) ============================== */
async function rateLimit(admin: SupabaseClient, key: string, max: number, windowMs: number, opts: { failOpen?: boolean } = {}): Promise<boolean> {
    const { failOpen = false } = opts;
    try {
        const { data, error } = await admin.rpc("rate_limit_check", { p_key: key, p_max: max, p_window_seconds: Math.round(windowMs / 1000) });
        if (error) throw error;
        return !!data;
    } catch (e) {
        console.error("[rateLimit] error:", e);
        return failOpen;
    }
}

/* ============================== function logic (index.ts) ============================== */
// Port of functions/routes/reviews.js POST /create — server-enforced
// "must have purchased to review". reviews.order_id is NOT NULL in
// 01-schema.sql, so orderId is required here (every current client call site
// already passes it).
Deno.serve(async (req) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;
    const methodErr = methodNotAllowed(req, ["POST"]);
    if (methodErr) return methodErr;

    const admin = supabaseAdmin();

    try {
        const auth = await requireAuth(req);
        if (!auth.user) return auth.error;
        const userId = auth.user.id;

        if (await isFeatureKilled(admin, "reviews")) {
            return jsonResponse(req, 503, { success: false, error: "Reviews are temporarily disabled." });
        }
        if (await isUserBlocked(admin, userId)) {
            return jsonResponse(req, 403, { success: false, error: "Your account cannot post reviews." });
        }
        if (!(await rateLimit(admin, `review:${userId}`, 10, 60000, { failOpen: false }))) {
            return jsonResponse(req, 429, { success: false, error: "Too many requests. Please wait a moment." });
        }

        const { json: body } = await readBody(req);
        const { orderId, productId, rating, comment } = body || {};
        const pid = String(productId || "").trim();
        const oid = String(orderId || "").trim();
        const r = Math.round(Number(rating));
        const text = String(comment || "").slice(0, 2000);
        if (!pid) return jsonResponse(req, 400, { success: false, error: "Missing product" });
        if (!oid) return jsonResponse(req, 400, { success: false, error: "Missing order" });
        if (!Number.isFinite(r) || r < 1 || r > 5) {
            return jsonResponse(req, 400, { success: false, error: "Rating must be between 1 and 5" });
        }

        const { data: order, error: orderErr } = await admin.from("orders").select("id, user_id").eq("id", oid).maybeSingle();
        if (orderErr) throw orderErr;
        let purchased = false;
        if (order && order.user_id === userId) {
            const { data: item, error: itemErr } = await admin
                .from("order_items")
                .select("product_id")
                .eq("order_id", oid)
                .eq("product_id", pid)
                .maybeSingle();
            if (itemErr) throw itemErr;
            purchased = !!item;
        }
        if (!purchased) {
            return jsonResponse(req, 403, { success: false, error: "You can only review products you've purchased in this order." });
        }

        const reviewId = `${userId}_${oid}_${pid}`;
        const { error: upsertErr } = await admin.from("reviews").upsert({
            id: reviewId, user_id: userId, order_id: oid, product_id: pid, rating: r, comment: text,
        });
        if (upsertErr) throw upsertErr;

        return jsonResponse(req, 200, { success: true, reviewId });
    } catch (err) {
        console.error("[reviews-create] failed:", err);
        return jsonResponse(req, 500, { success: false, error: "Could not submit review" });
    }
});