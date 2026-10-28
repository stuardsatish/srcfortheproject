// Port of functions/routes/payment.js POST /verify.
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAuth } from "../_shared/auth.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { verifyPaymentSignature } from "../_shared/razorpay.ts";
import { finalizeOrder, ForbiddenError, NoPendingError, StockError } from "../_shared/finalizeOrder.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const auth = await requireAuth(req);
    if (!auth.user) return auth.error;

    if (!(await rateLimit(admin, `verify:${auth.user.id}`, 30, 60000, { failOpen: false }))) {
      return jsonResponse(req, 429, { success: false, verified: false, error: "Too many requests. Please wait a moment." });
    }

    const { json: body } = await readBody(req);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return jsonResponse(req, 400, { success: false, verified: false, error: "Missing payment fields" });
    }

    const verified = await verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!verified) {
      return jsonResponse(req, 400, { success: false, verified: false, error: "Invalid signature" });
    }

    // Signature valid → finalize from the server-stored pending copy. Passing
    // the authenticated uid means a user can only finalize their own order.
    const orderId = await finalizeOrder(admin, razorpay_order_id, razorpay_payment_id, auth.user.id);
    return jsonResponse(req, 200, { success: true, verified: true, paymentId: razorpay_payment_id, orderId });
  } catch (err) {
    console.error("[payment-verify] failed:", err);
    const status = err instanceof StockError ? 409 : err instanceof NoPendingError ? 410 : err instanceof ForbiddenError ? 403 : 500;
    return jsonResponse(req, status, { success: false, verified: false, error: (err as Error).message || "Could not finalize order" });
  }
});