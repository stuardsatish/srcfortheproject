// Razorpay integration — unchanged from functions/routes/payment.js, only
// the runtime moves (Cloud Function -> Edge Function). Same npm package,
// same HMAC-SHA256 signature scheme, same env var names. Keys are read from
// Edge Function secrets (`supabase secrets set`), never from client code.
import Razorpay from "npm:razorpay@2.9.4";
import { verifyHmacSignature } from "./signature.ts";

let _razorpay: Razorpay | null = null;

/** Lazily builds the Razorpay client (env isn't present at deploy-analysis time). */
export function getRazorpay(): Razorpay {
  if (_razorpay) return _razorpay;
  const key_id = Deno.env.get("RAZORPAY_KEY_ID");
  const key_secret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!key_id || !key_secret) {
    throw new Error("Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env vars");
  }
  _razorpay = new Razorpay({ key_id, key_secret });
  return _razorpay;
}

// The HMAC primitives live in ./signature.ts (plain-JavaScript subset, unit-tested in supabase/tests/signature.test.mjs); they FAIL CLOSED: a missing
// secret or signature answers false (Phase 13 - before, a missing key secret made crypto.subtle throw, a missing webhook secret was handled here only).

/** Verifies a /verify payload's signature: HMAC(order_id|payment_id) with the key secret. */
export async function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): Promise<boolean> {
  return verifyHmacSignature(Deno.env.get("RAZORPAY_KEY_SECRET") || "", `${orderId}|${paymentId}`, String(signature));
}

/** Verifies a webhook payload's signature: HMAC(raw body) with the webhook secret. */
export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  return verifyHmacSignature(Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "", rawBody, String(signature));
}