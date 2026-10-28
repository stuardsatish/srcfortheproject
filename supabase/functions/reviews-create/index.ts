// Port of functions/routes/reviews.js POST /create — server-enforced
// "must have purchased to review".
//
// Schema note: `reviews.order_id` is NOT NULL in 01-schema.sql (unlike the
// Firestore doc's nullable `orderId`), so the original's "no orderId — check
// any of the user's orders" fallback path has no valid insert target here.
// Every current client call site already passes orderId (review modals are
// only opened from within a specific order card — see UserOrdersPage /
// UserPastOrdersPage), so this makes orderId a required field instead.
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAuth, isFeatureKilled, isUserBlocked } from "../_shared/auth.ts";
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
    const userId = auth.user.id;

    if (await isFeatureKilled(admin, "reviews")) {
      return jsonResponse(req, 503, { success: false, error: "Reviews are temporarily disabled." });
    }
    if (await isUserBlocked(admin, userId)) {
      return jsonResponse(req, 403, { success: false, error: "Your account cannot post reviews." });
    }
    if (!(await rateLimit(admin, `review:${userId}`, 10, 60000, { failOpen: false }))) {
      return jsonResponse(req, 429, { success: false, error: "Too many requests. Please wait a moment." });
    }

    const { json: body } = await readBody(req);
    const { orderId, productId, rating, comment } = body || {};
    const pid = String(productId || "").trim();
    const oid = String(orderId || "").trim();
    const r = Math.round(Number(rating));
    const text = String(comment || "").slice(0, 2000);
    if (!pid) return jsonResponse(req, 400, { success: false, error: "Missing product" });
    if (!oid) return jsonResponse(req, 400, { success: false, error: "Missing order" });
    if (!Number.isFinite(r) || r < 1 || r > 5) {
      return jsonResponse(req, 400, { success: false, error: "Rating must be between 1 and 5" });
    }

    // Purchase check: the order must belong to this user and actually contain the product.
    const { data: order, error: orderErr } = await admin.from("orders").select("id, user_id").eq("id", oid).maybeSingle();
    if (orderErr) throw orderErr;
    let purchased = false;
    if (order && order.user_id === userId) {
      const { data: item, error: itemErr } = await admin
        .from("order_items")
        .select("product_id")
        .eq("order_id", oid)
        .eq("product_id", pid)
        .maybeSingle();
      if (itemErr) throw itemErr;
      purchased = !!item;
    }
    if (!purchased) {
      return jsonResponse(req, 403, { success: false, error: "You can only review products you've purchased in this order." });
    }

    // Deterministic id — same shape as the original, kept for idempotency (resubmits update in place).
    const reviewId = `${userId}_${oid}_${pid}`;
    const { error: upsertErr } = await admin.from("reviews").upsert({
      id: reviewId,
      user_id: userId,
      order_id: oid,
      product_id: pid,
      rating: r,
      comment: text,
    });
    if (upsertErr) throw upsertErr;

    return jsonResponse(req, 200, { success: true, reviewId });
  } catch (err) {
    console.error("[reviews-create] failed:", err);
    return jsonResponse(req, 500, { success: false, error: "Could not submit review" });
  }
});