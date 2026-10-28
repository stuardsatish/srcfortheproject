// @ts-nocheck
// ^ DELIBERATE: plain-JavaScript subset of TypeScript (no annotations), so its unit test (supabase/tests/signature.test.mjs) also runs in a browser on a
//   machine without Node/Deno (tools/browser-test/Run-TsLiteTests.ps1) - the same convention as _shared/refundGateway.ts. Signature checks guard the
//   money paths (a forged "payment captured" webhook, a forged checkout signature), so they want to be EXECUTED, not just compiled.
//
// The signature primitives behind payment-verify (HMAC of "order_id|payment_id" with the key secret) and payment-webhook (HMAC of the RAW request body with the
// webhook secret). Phase 13 extracted them from razorpay.ts unchanged in behaviour, with one tightening: every check FAILS CLOSED - an empty / missing secret,
// a missing or non-string signature or payload answers `false` instead of computing a digest with an empty key or throwing.

/** HMAC-SHA256 of `data` (UTF-8) under `secret` (UTF-8), lower-case hex - the algorithm Razorpay documents (crypto.createHmac("sha256", secret).update(data).digest("hex")). */
export async function hmacHex(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time string comparison (Deno's WebCrypto has no timingSafeEqual). A different LENGTH is refused at once: the length of a hex digest is not a secret.
 * Strings are compared as UTF-8 bytes; anything that is not a string is compared as its text.
 */
export function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * True ONLY when `signature` is the HMAC-SHA256 hex digest of `data` under `secret`. Never throws, and answers false when
 *   - the secret is not a non-empty string (a missing server secret must never validate anything: an HMAC with an empty key is a valid HMAC),
 *   - the payload is not a string, or the signature is not a non-empty string (an upper-case / padded / truncated digest does not match: Razorpay sends lower-case hex).
 */
export async function verifyHmacSignature(secret, data, signature) {
  if (typeof secret !== "string" || secret === "") return false;
  if (typeof data !== "string") return false;
  if (typeof signature !== "string" || signature === "") return false;
  try {
    return timingSafeEqual(await hmacHex(secret, data), signature);
  } catch (_e) {
    return false;
  }
}