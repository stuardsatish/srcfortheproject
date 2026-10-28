// Port of functions/routes/payment.js POST /create-order.
// Prices the cart server-side, creates a Razorpay order, stashes the priced
// copy in `pending_orders` — /payment-verify or /payment-webhook finalize
// from that stashed copy, never from client input at verify time.
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAuth, isFeatureKilled, isUserBlocked } from "../_shared/auth.ts";
import { rateLimit, globalDailyLimit } from "../_shared/rateLimit.ts";
import {
    getBuyerState,
    getSellerState,
    getShippingConfig,
    loadPricingCatalog,
    resolvePromoDiscount,
} from "../_shared/pricing.ts";
import {
    applyGstToItems,
    collectProductIds,
    priceCartItems,
    resolveInterState,
    sumGstTotals,
} from "../_shared/cartPricing.ts";
import { getRazorpay } from "../_shared/razorpay.ts";
import { clientIp, isGuestUser, sanitizeGift, validateGuestContact } from "../_shared/orderExtras.ts";

// Hard ceiling on Razorpay order creations per UTC day, across ALL users —
// tune via the ORDERS_DAILY_CAP secret. Same default as the original.
const ORDERS_DAILY_CAP = Number(Deno.env.get("ORDERS_DAILY_CAP") || 2000);
const CURRENCY = "INR";

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

        if (await isFeatureKilled(admin, "orders")) {
            return jsonResponse(req, 503, { success: false, error: "Checkout is temporarily unavailable. Please try again later." });
        }
        if (await isUserBlocked(admin, userId)) {
            return jsonResponse(req, 403, { success: false, error: "Your account is not able to place orders. Please contact support." });
        }
        if (!(await rateLimit(admin, `create-order:${userId}`, 15, 60000, { failOpen: false }))) {
            return jsonResponse(req, 429, { success: false, error: "Too many requests. Please wait a moment and try again." });
        }
        // Guests (anonymous sessions) are free to mint, so also throttle per network address.
        const guest = isGuestUser(auth.user);
        if (guest) {
            const ip = clientIp(req);
            if (ip !== "unknown" && !(await rateLimit(admin, `guest-order-ip:${ip}`, 20, 3600000, { failOpen: false }))) {
                return jsonResponse(req, 429, { success: false, error: "Too many requests. Please try again later." });
            }
        }
        const utcDay = new Date().toISOString().slice(0, 10);
        if (!(await globalDailyLimit(admin, "orders", ORDERS_DAILY_CAP, utcDay))) {
            return jsonResponse(req, 503, { success: false, error: "The store is experiencing very high volume. Please try again later." });
        }

        const { json: body } = await readBody(req);
        const { items, promoCode } = body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return jsonResponse(req, 400, { success: false, error: "Cart is empty" });
        }

        // Fresh email-verified check — requireAuth's getUser() call already
        // round-tripped to the Auth server, so `email_confirmed_at` here is
        // current, not a cached token claim.
        // Guests have no email to verify; they must instead supply complete delivery
        // details (the client saves them to the guest's profile first).
        if (guest) {
            const { data: guestProfile, error: guestErr } = await admin
                .from("profiles")
                .select("name, email, phone, address")
                .eq("id", userId)
                .maybeSingle();
            if (guestErr) throw guestErr;
            const problem = validateGuestContact(guestProfile);
            if (problem) return jsonResponse(req, 400, { success: false, error: problem });
        } else if (!auth.user.email_confirmed_at) {
            return jsonResponse(req, 403, { success: false, error: "Email not verified. Please verify your email before checking out." });
        }
        const gift = sanitizeGift(body?.gift);

        // ---- SERVER-SIDE PRICING (single source of truth) ----
        // Option-aware (single / main / variant) — products + product_variants (falls back to the
        // legacy jsonb variants if migration M1 has not been applied yet).
        const { productsById, variantsByProduct } = await loadPricingCatalog(admin, collectProductIds(items));

        const priced = priceCartItems(items, productsById, variantsByProduct);
        if (!priced.ok) return jsonResponse(req, priced.status, { success: false, error: priced.error });
        const { lineItems, subtotal } = priced;

        const { discount: promoDiscount, appliedCode: appliedPromoCode } = await resolvePromoDiscount(admin, promoCode, subtotal);

        const { threshold, fee } = await getShippingConfig(admin);
        const shipping = subtotal >= threshold ? 0 : fee;

        const subtotalRounded = Math.round(subtotal);
        const total = Math.max(0, Math.round(subtotalRounded + shipping - promoDiscount));
        if (total <= 0) {
            return jsonResponse(req, 400, { success: false, error: "Invalid order total" });
        }

        // ---- GST BREAKDOWN ----
        const buyerState = await getBuyerState(admin, userId);
        const sellerState = await getSellerState(admin);
        const isInterState = resolveInterState(buyerState, sellerState);
        const gstItems = applyGstToItems(lineItems, isInterState);
        const gstTotals = sumGstTotals(gstItems);

        const order = await getRazorpay().orders.create({
            amount: total * 100, // paise — SERVER computed
            currency: CURRENCY,
            receipt: `rcpt_${String(userId).slice(0, 8)}_${Date.now()}`,
        });

        const { error: pendingErr } = await admin.from("pending_orders").insert({
            id: order.id,
            status: "created",
            payload: {
                userId,
                items: gstItems,
                subtotal: subtotalRounded,
                shipping,
                promoDiscount,
                promoCode: appliedPromoCode,
                total,
                totalItems: gstItems.reduce((s, i) => s + i.quantity, 0),
                taxableTotal: gstTotals.taxableTotal,
                totalCgst: gstTotals.totalCgst,
                totalSgst: gstTotals.totalSgst,
                totalIgst: gstTotals.totalIgst,
                isInterState,
                gift,
            },
        });
        if (pendingErr) throw pendingErr;

        return jsonResponse(req, 200, {
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            subtotal: subtotalRounded,
            shipping,
            promoDiscount,
            total,
            keyId: Deno.env.get("RAZORPAY_KEY_ID"),
        });
    } catch (err) {
        console.error("[payment-create-order] failed:", err);
        return jsonResponse(req, 500, { success: false, error: "Failed to create payment order" });
    }
});