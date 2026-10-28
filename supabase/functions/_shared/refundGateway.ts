// @ts-nocheck
// ^ DELIBERATE. This file is written in the plain-JavaScript subset of TypeScript (no annotations, no `as`, no generics): it is valid TypeScript
//   for Deno / the bundler / `npm run typecheck` (the check is skipped for this one file), AND valid JavaScript, so its unit tests also run in a
//   browser on a machine without Node (tools/browser-test/Run-TsLiteTests.ps1 copies it to .js). Money logic wants to be executed, not just compiled.
//
// Refund <-> Razorpay glue shared by the refund-create function and the payment webhook (Phase 9).
//
// WHY THIS FILE EXISTS: the decisions that matter (may this refund be sent at all? was it sent already? what did the gateway answer?) are
// made by the DATABASE (refund_begin_gateway / refund_record_gateway_result / refund_apply_gateway_event, migration 20261017_06_refunds.sql).
// This file only (a) turns a database claim into a Razorpay API call, (b) turns the gateway's answer or failure into one of the three
// outcomes the database understands, and (c) is written against INJECTED clients (`admin` = the service-role Supabase client, `razorpay` =
// the SDK instance) so it can be unit-tested with fakes (supabase/tests/refundGateway.test.mjs - no network, no Deno).
//
// THE OUTCOMES: accepted (Razorpay created the refund: id + status), rejected (a definitive 4xx: NOTHING was created, the refund fails
// and a new one can be made) and unknown (no usable answer: the refund may or may not exist -> never resend, check the status).
// Every function returns { http, body } so index.ts is only an HTTP shell.

const DEFINITIVE_STATUS = [400, 401, 403, 404, 422];       // the request itself was refused: no refund exists
const UNKNOWN_STATE_MINUTES = 2;                           // a status check may conclude "never created" once the call is this old
const SUBMITTING_STALE_MINUTES = 5;                        // ... and a call that never reported back (the function died) once it is this old

/** Razorpay's own status word -> the three the database knows ('created' = accepted, still pending). */
export function mapRazorpayRefundStatus(status) {
  const s = String(status ?? "").toLowerCase();
  if (s === "processed") return "processed";
  if (s === "failed") return "failed";
  return "pending";
}

/** Webhook event name (+ the entity's own status) -> the status word refund_apply_gateway_event() takes. */
export function refundStatusFromEvent(event, entityStatus) {
  if (event === "refund.processed") return "processed";
  if (event === "refund.failed") return "failed";
  const s = String(entityStatus ?? "").toLowerCase();
  return s === "processed" || s === "failed" ? s : "created";
}

/** Razorpay notes: at most 15 string values of up to 256 characters. */
export function sanitizeNotes(notes) {
  const out = {};
  const src = notes && typeof notes === "object" ? notes : {};
  for (const k of Object.keys(src).slice(0, 15)) {
    const v = src[k];
    if (v === null || v === undefined) continue;
    out[String(k).slice(0, 64)] = String(v).slice(0, 256);
  }
  return out;
}

/** The body of payments.refund(): the amount in paise (integer), a normal-speed refund, our refund number as the receipt, our ids as notes. */
export function buildRefundParams(begin) {
  const amount = Math.round(Number(begin?.amount_paise));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("The refund amount is not valid");
  return { amount, speed: "normal", receipt: String(begin?.receipt ?? "").slice(0, 40), notes: sanitizeNotes(begin?.notes) };
}

/** Only what is safe and useful to keep of a Razorpay refund entity (never the whole object). */
export function safeRefundPayload(entity) {
  const e = entity ?? {};
  return {
    id: e.id ?? null, status: e.status ?? null, amount: e.amount ?? null, currency: e.currency ?? null, payment_id: e.payment_id ?? null,
    receipt: e.receipt ?? null, speed_requested: e.speed_requested ?? null, speed_processed: e.speed_processed ?? null, created_at: e.created_at ?? null,
  };
}

/** A gateway failure -> { outcome: 'rejected' | 'unknown', message (short, no keys), payload (kept admin-only) }. */
export function classifyGatewayError(err) {
  const e = err ?? {};
  const status = Number(e.statusCode ?? e.status ?? e.response?.status);
  const rz = e.error ?? e.response?.data?.error ?? {};
  const description = String(rz.description ?? e.message ?? "The payment gateway did not answer");
  const definitive = Number.isFinite(status) && DEFINITIVE_STATUS.includes(status);
  // never let a key or token slip into a message the customer might read
  const message = description.replace(/rzp_(live|test)_[A-Za-z0-9]+/g, "[key]").replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    outcome: definitive ? "rejected" : "unknown",
    message,
    payload: { statusCode: Number.isFinite(status) ? status : null, code: String(rz.code ?? e.code ?? ""), description: description.slice(0, 500), field: rz.field ?? null, reason: rz.reason ?? null },
  };
}

/** Which of a payment's refunds is ours: by the id we put into the notes, else by the receipt (our refund number). */
export function findOurRefund(items, refundId, receipt) {
  const list = Array.isArray(items) ? items : [];
  return list.find((r) => r?.notes?.refund_id === refundId) ?? list.find((r) => receipt && r?.receipt === receipt) ?? null;
}

const NOT_SENT_TEXT = {
  ALREADY_SENT: "This refund was already sent to Razorpay. Use \"Check status\" to follow it.",
  NOT_PENDING: "This refund is not pending any more.",
  WRONG_METHOD: "This is not a Razorpay refund.",
  NO_PAYMENT_ID: "The order has no Razorpay payment id, so it cannot be refunded through the gateway.",
};

/** SEND: claim the refund in the database, call Razorpay once, record the answer. Never sends twice (the claim is refused the second time). */
export async function sendRefund(admin, razorpay, refundId) {
  const claim = await admin.rpc("refund_begin_gateway", { p_refund_id: refundId });
  if (claim.error) {
    return { http: claim.error.code === "P0002" ? 404 : 500, body: { success: false, code: "BEGIN_FAILED", error: claim.error.message || "Could not start the refund" } };
  }
  const begin = claim.data;
  if (!begin || !begin.proceed) {
    return { http: 409, body: { success: false, code: begin?.reason || "NOT_SENT", error: NOT_SENT_TEXT[String(begin?.reason)] || "This refund cannot be sent.", status: begin?.status || "", gatewayState: begin?.gateway_state || "" } };
  }

  let params;
  try {
    params = buildRefundParams(begin);
  } catch (err) {                                          // cannot happen for a refund the database created (amount > 0), but never leave a claim hanging
    const message = err instanceof Error ? err.message : "The refund amount is not valid";
    const saved = await admin.rpc("refund_record_gateway_result", { p_refund_id: refundId, p_outcome: "rejected", p_error: message, p_payload: { build: true } });
    if (saved.error) console.error("[refund-create] could not record the failed claim:", saved.error.message);
    return { http: 422, body: { success: false, code: "GATEWAY_REJECTED", error: message, status: "failed", gatewayState: "not_sent" } };
  }

  let entity;
  try {
    entity = await razorpay.payments.refund(begin.razorpay_payment_id, params);
  } catch (err) {
    const c = classifyGatewayError(err);
    const saved = await admin.rpc("refund_record_gateway_result", { p_refund_id: refundId, p_outcome: c.outcome, p_error: c.message, p_payload: c.payload });
    if (saved.error) console.error("[refund-create] could not record the gateway failure:", saved.error.message);
    if (c.outcome === "rejected") {
      return { http: 422, body: { success: false, code: "GATEWAY_REJECTED", error: `Razorpay refused the refund: ${c.message}`, status: "failed", gatewayState: "not_sent" } };
    }
    return { http: 502, body: { success: false, code: "GATEWAY_UNKNOWN", error: "Razorpay did not confirm the refund. Do not send it again - use \"Check status\" in a few minutes.", status: "pending", gatewayState: "unknown" } };
  }

  const saved = await admin.rpc("refund_record_gateway_result", {
    p_refund_id: refundId, p_outcome: "accepted", p_gateway_refund_id: entity?.id ?? null, p_gateway_status: mapRazorpayRefundStatus(entity?.status), p_payload: safeRefundPayload(entity),
  });
  if (saved.error) {
    console.error("[refund-create] Razorpay accepted the refund but recording it failed:", saved.error.message);
    return { http: 502, body: { success: false, code: "RECORD_FAILED", error: "Razorpay accepted the refund but saving that failed. Use \"Check status\" - it will find the refund.", status: "pending", gatewayState: "submitting" } };
  }
  const status = String(saved.data?.status ?? "pending");
  return {
    http: 200,
    body: {
      success: true, refundId, status, gatewayState: String(saved.data?.gateway_state ?? "submitted"),
      message: status === "succeeded" ? "Razorpay has refunded it." : "Sent to Razorpay. It is marked paid out when Razorpay confirms it (usually within minutes, sometimes a few days).",
    },
  };
}

/** CHECK STATUS: ask Razorpay what happened to a refund we already sent (or may have sent) and record it. Never creates a refund. */
export async function reconcileRefund(admin, razorpay, refundId) {
  const ctxRes = await admin.rpc("refund_gateway_context", { p_refund_id: refundId });
  if (ctxRes.error) return { http: ctxRes.error.code === "P0002" ? 404 : 500, body: { success: false, code: "CONTEXT_FAILED", error: ctxRes.error.message || "Could not read the refund" } };
  const ctx = ctxRes.data;
  if (ctx.method !== "razorpay") return { http: 409, body: { success: false, code: "WRONG_METHOD", error: NOT_SENT_TEXT.WRONG_METHOD } };
  if (ctx.status !== "pending") return { http: 200, body: { success: true, refundId, status: ctx.status, gatewayState: ctx.gateway_state || "", message: `This refund is already ${ctx.status}.` } };
  if (ctx.gateway_state === "not_sent") return { http: 200, body: { success: true, refundId, status: "pending", gatewayState: "not_sent", message: "This refund has not been sent to Razorpay yet." } };

  let found = null;
  try {
    if (ctx.gateway_refund_id) found = await razorpay.refunds.fetch(ctx.gateway_refund_id);
    else found = findOurRefund((await razorpay.payments.fetchMultipleRefund(ctx.razorpay_payment_id, { count: 100 }))?.items, refundId, ctx.refund_no);
  } catch (err) {
    const c = classifyGatewayError(err);
    return { http: 502, body: { success: false, code: "GATEWAY_UNAVAILABLE", error: `Could not ask Razorpay: ${c.message}`, status: "pending", gatewayState: ctx.gateway_state || "" } };
  }

  if (found) {
    const saved = await admin.rpc("refund_record_gateway_result", {
      p_refund_id: refundId, p_outcome: "accepted", p_gateway_refund_id: found.id, p_gateway_status: mapRazorpayRefundStatus(found.status), p_payload: safeRefundPayload(found),
    });
    if (saved.error) return { http: 500, body: { success: false, code: "RECORD_FAILED", error: saved.error.message || "Could not save the gateway status" } };
    const status = String(saved.data?.status ?? "pending");
    return { http: 200, body: { success: true, refundId, status, gatewayState: String(saved.data?.gateway_state ?? "submitted"), message: status === "succeeded" ? "Razorpay has paid it out." : status === "failed" ? "Razorpay reports that the refund failed." : "Razorpay has it and is still processing it." } };
  }

  // Razorpay has no such refund. A refund call that was sent is visible at once, so after a short grace period "unknown" means "never created".
  const ageMinutes = Number(ctx.state_age_seconds ?? 0) / 60;
  const gone = (ctx.gateway_state === "unknown" && ageMinutes >= UNKNOWN_STATE_MINUTES) || (ctx.gateway_state === "submitting" && ageMinutes >= SUBMITTING_STALE_MINUTES);
  if (gone) {
    const saved = await admin.rpc("refund_record_gateway_result", { p_refund_id: refundId, p_outcome: "rejected", p_error: "Razorpay has no record of this refund - it was never created", p_payload: { reconciled: true } });
    if (saved.error) return { http: 500, body: { success: false, code: "RECORD_FAILED", error: saved.error.message || "Could not save the gateway status" } };
    return { http: 200, body: { success: true, refundId, status: String(saved.data?.status ?? "failed"), gatewayState: String(saved.data?.gateway_state ?? "not_sent"), message: "Razorpay has no record of this refund, so it was never created. You can create a new refund." } };
  }
  return { http: 200, body: { success: true, refundId, status: "pending", gatewayState: ctx.gateway_state || "", message: "Razorpay does not list this refund (yet). Try again in a few minutes." } };
}