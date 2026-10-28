// refund-create — pays a REFUND back through Razorpay (admin only) or asks Razorpay what happened to one. IMPLEMENTATION_PLAN Phase 9.
//
// The refund itself (amount, lines, who may be refunded how much) is created and calculated by the database (create_refund / refund_calculate,
// migration 20261017_06_refunds.sql). This function is only the bridge to the gateway:
//   POST { refundId, action: "send" }       claim the refund in the database (refused if it was sent before), call the Razorpay Refund API for the
//                                           SAME payment, record the answer. A refund is "paid out" only when Razorpay says processed (here or by
//                                           the refund.processed webhook handled in payment-webhook).
//   POST { refundId, action: "reconcile" }  ask Razorpay what happened to a refund that was sent (or may have been: a lost answer) and record it.
//                                           Never creates a refund.
// The orchestration lives in _shared/refundGateway.ts (unit-tested with fakes: supabase/tests/refundGateway.test.mjs).
//
// NEEDS CREDENTIALS: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (the same secrets the payment functions already use; the key must be allowed to
// create refunds - Razorpay keys are by default). Without them the function answers 503 NOT_CONFIGURED and nothing is claimed or changed.
// BLOCKED-CREDENTIALS for end-to-end verification: it has been tested against a fake Razorpay only (see TESTING_CHECKLIST G20-G22).
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { getRazorpay } from "../_shared/razorpay.ts";
import { reconcileRefund, sendRefund } from "../_shared/refundGateway.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const auth = await requireAdmin(req, admin);
    if (!auth.user) return auth.error;

    if (!(await rateLimit(admin, `refund:${auth.user.id}`, 20, 60000, { failOpen: false }))) {
      return jsonResponse(req, 429, { success: false, code: "RATE_LIMITED", error: "Too many requests. Please wait a moment." });
    }

    const { json: body } = await readBody(req);
    const refundId = String(body?.refundId || "");
    const action = body?.action === "reconcile" ? "reconcile" : body?.action === "send" || body?.action === undefined ? "send" : "";
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(refundId) || !action) {
      return jsonResponse(req, 400, { success: false, code: "BAD_REQUEST", error: "refundId (uuid) and action (send | reconcile) are required" });
    }

    // before anything is claimed in the database: is the gateway configured at all?
    let razorpay: ReturnType<typeof getRazorpay>;
    try {
      razorpay = getRazorpay();
    } catch (_e) {
      return jsonResponse(req, 503, { success: false, code: "NOT_CONFIGURED", error: "Razorpay is not configured on the server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)." });
    }

    const reply = action === "send" ? await sendRefund(admin, razorpay, refundId) : await reconcileRefund(admin, razorpay, refundId);
    return jsonResponse(req, reply.http, reply.body);
  } catch (err) {
    console.error("[refund-create] failed:", err);
    return jsonResponse(req, 500, { success: false, code: "FAILED", error: "The refund request failed. Check the refund's status before trying again." });
  }
});