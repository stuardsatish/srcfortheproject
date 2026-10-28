// Thin wrapper around the `create_order_tx` Postgres function.
// Must be called with the SERVICE ROLE client; the RPC is REVOKEd from anon/authenticated.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { round2, type GstLineItem } from "./cartPricing.ts";

export type CreateOrderParams = {
  orderId: string;
  userId: string | null;
  items: GstLineItem[];
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  source: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: unknown;
  subtotal: number;
  shipping: number;
  cgst: number;
  sgst: number;
  igst: number;
  promoCode: string;
  promoDiscount: number;
  total: number;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
};

export class StockError extends Error {
  code = "STOCK";
}

/**
 * Maps GST-enriched line items into create_order_tx's p_items jsonb shape.
 *
 * `mrp`, `gst_rate`, `hsn_code` are the purchase-time snapshot values (migration M1). The RPC derives
 * the remaining snapshot fields (variant name, SKU, image, return/exchange policy, item type) from
 * the database INSIDE the transaction, so they are deliberately not sent from here. An RPC that
 * predates M1 simply ignores the extra keys.
 */
export function toOrderItemsJson(items: GstLineItem[]) {
  return items.map((it) => ({
    product_id: it.productId,
    variant_id: it.variantId || null,
    variant_name: it.variantName || null,
    title: it.title,
    quantity: it.quantity,
    unit_price: it.finalPrice,
    mrp: it.originalPrice,
    discount: it.discount,
    gst_rate: it.gstRate,
    hsn_code: it.hsnCode || null,
    cgst: it.cgstAmount,
    sgst: it.sgstAmount,
    igst: it.igstAmount,
    line_total: round2(it.finalPrice * it.quantity),
  }));
}

/**
 * Calls create_order_tx. Idempotent by design (the RPC returns the existing
 * row if `orderId` already exists — see its comment block) — both /verify
 * and /webhook rely on this instead of re-implementing ALREADY_FINALIZED
 * checks themselves.
 *
 * Throws StockError when the RPC raises "Insufficient stock for product %",
 * so callers can map it to a 409 the same way the original STOCK-coded
 * errors were handled.
 */
export async function createOrderTx(admin: SupabaseClient, p: CreateOrderParams) {
  const { data, error } = await admin.rpc("create_order_tx", {
    p_order_id: p.orderId,
    p_user_id: p.userId,
    p_items: toOrderItemsJson(p.items),
    p_order_status: p.orderStatus,
    p_payment_status: p.paymentStatus,
    p_payment_method: p.paymentMethod,
    p_source: p.source,
    p_customer_name: p.customerName,
    p_customer_email: p.customerEmail,
    p_customer_phone: p.customerPhone,
    p_address: p.address,
    p_subtotal: p.subtotal,
    p_shipping: p.shipping,
    p_cgst: p.cgst,
    p_sgst: p.sgst,
    p_igst: p.igst,
    p_promo_code: p.promoCode,
    p_promo_discount: p.promoDiscount,
    p_total: p.total,
    p_razorpay_order_id: p.razorpayOrderId ?? null,
    p_razorpay_payment_id: p.razorpayPaymentId ?? null,
  });

  if (error) {
    // "Insufficient stock for product …" (stock) and "… no longer available" (an option that was
    // deactivated/deleted/disabled between pricing and writing) are both customer-facing 409s.
    if (/insufficient stock|no longer available/i.test(error.message || "")) {
      throw new StockError(error.message);
    }
    throw error;
  }
  return data; // the orders row (existing or newly-inserted)
}