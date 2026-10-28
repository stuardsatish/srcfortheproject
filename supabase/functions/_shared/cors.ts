// Security headers + CORS + body-size guard for every Edge Function.
//
// Hand-rolled equivalent of helmet() + cors() + body size cap for Deno.
// Every function in this project wraps its handler with `withSecurity()`
// so none of them ship without these protections.

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

function isOriginAllowed(origin: string): boolean {
  if (!origin) return true;
  const list = allowedOrigins();
  if (list.includes("*") || list.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.hostname.endsWith(".vercel.app") || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }
  } catch (_) { }
  return false;
}

/** Security headers ported from index.js's helmet() config. */
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-site",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Referrer-Policy": "no-referrer",
};

/**
 * Resolve the CORS header set for this request's Origin. No Origin header
 * (native app / server-to-server / curl) is allowed through, same as the
 * original `cors()` config. An Origin present but not on the allow-list gets
 * no `Access-Control-Allow-Origin` header, which makes the browser block the
 * response client-side (equivalent to the Express CORS error path).
 */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
    Vary: "Origin",
  };
  if (!origin) return headers; // non-browser caller — nothing to restrict
  if (isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function jsonResponse(req: Request, status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...SECURITY_HEADERS,
      ...corsHeaders(req),
      ...extraHeaders,
    },
  });
}

export function rawResponse(req: Request, status: number, body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      ...corsHeaders(req),
      ...extraHeaders,
    },
  });
}

const MAX_BODY_BYTES = 64 * 1024; // 64kb — matches express.json({ limit: "64kb" })

/**
 * Reads the raw request body (capped at 64kb, mirroring the original body
 * limit) and returns both the raw text (needed for the webhook's HMAC check)
 * and the parsed JSON (empty object on parse failure — callers validate
 * their own required fields same as the Express routes did).
 */
export async function readBody(req: Request): Promise<{ raw: string; json: any }> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    const e = new Error("Request body too large");
    (e as any).code = "BODY_TOO_LARGE";
    throw e;
  }
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = {};
  }
  return { raw, json };
}

/** Handles the CORS preflight OPTIONS request every browser POST will send. */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
}

/** Rejects any method outside the small allow-list each route needs. */
export function methodNotAllowed(req: Request, allow: string[]): Response | null {
  if (allow.includes(req.method)) return null;
  return jsonResponse(req, 405, { success: false, error: "Method not allowed" });
}