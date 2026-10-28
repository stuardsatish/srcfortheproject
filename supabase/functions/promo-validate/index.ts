// Port of functions/routes/promo.js POST /validate.
// promo_codes has no client-select RLS policy (admin-only — see 01-schema.sql),
// so the cart's "Apply" preview asks this function instead of enumerating
// codes. Returns ONLY the resolved discount for the given code + subtotal —
// never the full code list. The authoritative discount is still recomputed
// independently in /payment-create-order.
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAuth, isPromoExpired } from "../_shared/auth.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const auth = await requireAuth(req);
    if (!auth.user) return auth.error;

    // Fail-closed limiter: cheap read, but stops code-enumeration by brute force.
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