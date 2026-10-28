// @ts-nocheck
// Phase 12 (known issue K-8): a payment that Razorpay CAPTURED but that could not become an order because the last unit sold out between the customer
// paying and create_order_tx running. Until now the money stayed captured with no order and no trace; finalizeOrder() now calls this BEFORE it rethrows
// the StockError, so the admin gets a row in `payment_exceptions` (+ a notification) and refunds the payment in the Razorpay dashboard, and the customer is
// told that a refund is coming.
//
// Written in the plain-JavaScript subset of TypeScript (no annotations; this marker is the first line) so its test also runs in a browser on a machine
// without Node/Deno (tools/browser-test/Run-TsLiteTests.ps1) - the same convention as _shared/refundGateway.ts. The Supabase client is INJECTED.
// NEVER throws: recording is best-effort and must not hide the original StockError from the caller (the customer still gets the 409).

/** The few fields of the customer's cart worth keeping next to the payment (no prices, no addresses). */
export function summarizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map((it) => ({
    product_id: it && it.productId ? String(it.productId) : "",
    variant_id: it && it.variantId ? String(it.variantId) : "",
    quantity: Number(it && it.quantity) || 0,
    title: it && it.title ? String(it.title).slice(0, 120) : "",
  }));
}

/**
 * @param admin  a service-role Supabase client (only that role may call record_payment_exception)
 * @param p      { razorpayOrderId, razorpayPaymentId, userId, amount, reason, items }
 * @returns {{ recorded: boolean, id?: string|null, error?: string }}
 */
export async function recordUnfulfilledPayment(admin, p) {
  try {
    const { data, error } = await admin.rpc("record_payment_exception", {
      p_razorpay_order_id: p.razorpayOrderId,
      p_razorpay_payment_id: p.razorpayPaymentId,
      p_user_id: p.userId || null,
      p_amount: Number(p.amount) || 0,
      p_reason: String(p.reason || "").slice(0, 500),
      p_items: summarizeItems(p.items),
    });
    if (error) {
      // PGRST202 = the cancellation migration (M6) is not applied yet: nothing to record into, and nothing more we can do here
      console.error("[payment-exception] could not record the payment:", (error && error.message) || error);
      return { recorded: false, error: (error && error.message) || String(error) };
    }
    return { recorded: !!(data && data.recorded), id: (data && data.id) || null };
  } catch (e) {
    console.error("[payment-exception] could not record the payment:", e);
    return { recorded: false, error: (e && e.message) || String(e) };
  }
}