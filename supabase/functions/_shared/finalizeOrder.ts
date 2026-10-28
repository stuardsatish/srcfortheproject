// Shared finalize path for both /payment-verify and /payment-webhook — port
// of functions/routes/payment.js's finalizeOrder(). Both callers MUST go
// through this so idempotency is handled in exactly one place (requirement
// #4): create_order_tx early-returns the existing order when `orderId`
// (= the Razorpay order id, reused as the orders.id primary key) already
// exists, so a webhook retry or a dropped /verify response just re-resolves
// to the same order instead of double-writing stock/stats.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GstLineItem } from "./cartPricing.ts";
import { createOrderTx, StockError } from "./orderWriter.ts";
import { saveGiftOptions, type GiftOptions } from "./orderExtras.ts";
import { recordUnfulfilledPayment } from "./paymentException.ts";

export class NoPendingError extends Error {
    code = "NO_PENDING";
}
export class ForbiddenError extends Error {
    code = "FORBIDDEN";
}
export { StockError };

type PendingPayload = {
    userId: string;
    items: GstLineItem[];
    subtotal: number;
    shipping: number;
    promoDiscount: number;
    promoCode: string;
    total: number;
    taxableTotal: number;
    totalCgst: number;
    totalSgst: number;
    totalIgst: number;
    isInterState: boolean;
    /** Optional gift wrap/message captured at checkout (absent on older pending rows). */
    gift?: GiftOptions | null;
};

/**
 * @param expectedUid  When called from /verify, the caller may only finalize
 *   THEIR OWN order. The webhook calls without expectedUid — it's trusted via
 *   the Razorpay signature instead.
 */
export async function finalizeOrder(admin: SupabaseClient, razorpayOrderId: string, razorpayPaymentId: string, expectedUid?: string) {
    const { data: pendingRow, error: pendingErr } = await admin
        .from("pending_orders")
        .select("*")
        .eq("id", razorpayOrderId)
        .maybeSingle();

    if (pendingErr) throw pendingErr;
    if (!pendingRow) {
        throw new NoPendingError("Order session expired or already processed");
    }

    const pending = pendingRow.payload as PendingPayload;

    if (expectedUid && pending.userId !== expectedUid) {
        throw new ForbiddenError("This order belongs to a different account");
    }

    // Fetch profile details for customer_name/email/phone/address snapshot on
    // the order row (same denormalization the original wrote onto orderDoc).
    const { data: profile } = await admin
        .from("profiles")
        .select("name, email, phone, address")
        .eq("id", pending.userId)
        .maybeSingle();

    const order = await createOrderTx(admin, {
        orderId: razorpayOrderId,
        userId: pending.userId,
        items: pending.items,
        orderStatus: "placed",
        paymentStatus: "paid",
        paymentMethod: "Razorpay",
        source: "online",
        customerName: profile?.name || "User",
        customerEmail: profile?.email || "",
        customerPhone: profile?.phone || "",
        address: profile?.address ?? null,
        subtotal: pending.subtotal,
        shipping: pending.shipping,
        cgst: pending.totalCgst,
        sgst: pending.totalSgst,
        igst: pending.totalIgst,
        promoCode: pending.promoCode,
        promoDiscount: pending.promoDiscount,
        total: pending.total,
        razorpayOrderId,
        razorpayPaymentId,
    }).catch(async (e: unknown) => {
        // The payment is CAPTURED but the order cannot exist (an item sold out meanwhile, K-8): leave a trace for the admin - who refunds it in the
        // Razorpay dashboard - and tell the customer, BEFORE the caller answers 409. Never masks the original error.
        if (e instanceof StockError) {
            await recordUnfulfilledPayment(admin, {
                razorpayOrderId,
                razorpayPaymentId,
                userId: pending.userId,
                amount: pending.total,
                reason: e.message,
                items: pending.items,
            });
        }
        throw e;
    });

    // Gift options ride along in the pending payload; applied once the order
    // exists. Safe to repeat — /verify and the webhook may both reach this point.
    await saveGiftOptions(admin, order.id as string, pending.gift);

    // Best-effort bookkeeping so the cleanup cron's `status = 'created'` filter
    // never sweeps up an order that already finalized. create_order_tx's own
    // idempotency is the real guard, not this flag.
    await admin.from("pending_orders").update({ status: "finalized" }).eq("id", razorpayOrderId);

    return order.id as string;
}