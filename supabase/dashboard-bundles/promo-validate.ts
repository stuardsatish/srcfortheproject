// ============================================================================
// promo-validate — SELF-CONTAINED Dashboard bundle.
// Paste this whole file as the function's index.ts in the Supabase Dashboard
// (Edge Functions -> Deploy a new function -> name it "promo-validate").
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
function isPromoExpired(expiryDate: string | number | null | undefined): boolean {
    if (!expiryDate) return false;
    let expTime: number;
    if (typeof expiryDate === "string" && !expiryDate.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(expiryDate)) {
        const parts = expiryDate.split(/[-T:]/);
        if (parts.length >= 5) {
            expTime = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), Number(parts[3]), Number(parts[4])).getTime();
        } else {
            expTime = new Date(expiryDate).getTime();
        }
    } else {
        expTime = new Date(expiryDate).getTime();
    }
    return !isNaN(expTime) && Date.now() > expTime;
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
// Port of functions/routes/promo.js POST /validate.
Deno.serve(async (req) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;
    const methodErr = methodNotAllowed(req, ["POST"]);
    if (methodErr) return methodErr;

    const admin = supabaseAdmin();

    try {
        const auth = await requireAuth(req);
        if (!auth.user) return auth.error;

        if (!(await rateLimit(admin, `promo-validate:${auth.user.id}`, 20, 60000))) {
            return jsonResponse(req, 429, { success: false, error: "Too many attempts. Please wait a moment." });
        }

        const { json: body } = await readBody(req);
        const rawCode = String(body?.code || "").trim().toUpperCase();
        const subtotal = Math.max(0, Number(body?.subtotal || 0));
        if (!rawCode) return jsonResponse(req, 400, { success: false, error: "Enter a code" });

        const { data: pd, error } = await admin.from("promo_codes").select("*").eq("code", rawCode).maybeSingle();
        if (error) throw error;
        if (!pd) return jsonResponse(req, 404, { success: false, error: "Invalid promo code" });

        if (isPromoExpired(pd.expiry_date)) {
            return jsonResponse(req, 410, { success: false, error: "This promo code has expired" });
        }

        const value = Number(pd.value || 0);
        let discount = 0;
        if (pd.type === "percent") discount = Math.round((subtotal * value) / 100);
        else if (pd.type === "flat") discount = value;
        discount = Math.max(0, discount);

        return jsonResponse(req, 200, {
            success: true,
            code: rawCode,
            type: pd.type === "flat" ? "flat" : "percent",
            value,
            discount,
            expiryDate: pd.expiry_date || null,
        });
    } catch (err) {
        console.error("[promo-validate] failed:", err);
        return jsonResponse(req, 500, { success: false, error: "Could not validate code" });
    }
});