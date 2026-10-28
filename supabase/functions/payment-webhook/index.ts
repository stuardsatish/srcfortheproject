// Port of functions/routes/payment.js POST /webhook.
// Razorpay -> server-to-server callback, no Supabase JWT — verified purely
// via the webhook secret + raw body HMAC. Finalizes the order even if the
// customer's browser dropped before calling /payment-verify. Configure in
// Razorpay Dashboard -> Webhooks; set RAZORPAY_WEBHOOK_SECRET as a secret.
import { handlePreflight, methodNotAllowed, rawResponse, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { verifyWebhookSignature } from "../_shared/razorpay.ts";
import { finalizeOrder, NoPendingError, StockError } from "../_shared/finalizeOrder.ts";
import { refundStatusFromEvent, safeRefundPayload } from "../_shared/refundGateway.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    if (!secret) {
      console.error("[payment-webhook] webhook secret not configured");
      return rawResponse(req, 500, "webhook not configured");
    }
    const signature = req.headers.get("x-razorpay-signature");
    const { raw, json: body } = await readBody(req);
    if (!raw || !signature) {
      return rawResponse(req, 400, "missing signature/body");
    }

    const verified = await verifyWebhookSignature(raw, signature);
    if (!verified) {
      return rawResponse(req, 400, "invalid signature");
    }

    const event = body?.event;
    if (event === "payment.captured" || event === "order.paid") {
      const payment = body?.payload?.payment?.entity || {};
      const orderId = payment.order_id;
      const paymentId = payment.id;
      if (orderId && paymentId) {
        try {
          await finalizeOrder(admin, orderId, paymentId);
        } catch (e) {
          // No pending record → nothing to do. Out of stock after the payment was captured (K-8): finalizeOrder already recorded it for the admin
          // (payment_exceptions) and told the customer - answer 200 so Razorpay stops retrying a call that can only fail the same way. Anything else is real.
          if (e instanceof StockError) {
            console.error("[payment-webhook] captured payment without an order (recorded for the admin):", paymentId, e.message);
          } else if (!(e instanceof NoPendingError)) {
            throw e;
          }
        }
      }
    } else if (event === "refund.created" || event === "refund.processed" || event === "refund.failed") {
      // Phase 9: the gateway's word on a refund. The database applies it idempotently (a repeated event id is a no-op, a completed refund is
      // never taken back) and ignores refunds it does not know (e.g. one made by hand in the Razorpay dashboard).
      const refund = body?.payload?.refund?.entity || {};
      if (refund.id) {
        const eventId = req.headers.get("x-razorpay-event-id") || `${event}:${refund.id}`;
        const { error } = await admin.rpc("refund_apply_gateway_event", {
          p_event_id: eventId,
          p_gateway_refund_id: refund.id,
          p_status: refundStatusFromEvent(event, refund.status),
          p_error: refund.error_description || refund.error?.description || null,
          p_notes: refund.notes && typeof refund.notes === "object" && !Array.isArray(refund.notes) ? refund.notes : {},
          p_payload: { event, refund: safeRefundPayload(refund) },
        });
        // PGRST202 = the refunds migration is not applied yet: nothing to do (and no point in Razorpay retrying); anything else is real
        if (error && error.code !== "PGRST202") throw error;
      }
    }
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[payment-webhook] error:", err);
    return rawResponse(req, 500, "error");
  }
});