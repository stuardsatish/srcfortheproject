// Port of functions/routes/orders.js POST /billing-create (offline POS / walk-in).
// Mirrors the Razorpay flow's server-authoritative pricing, then writes via
// create_order_tx. source:"billing", orderStatus:"delivered" (hand-to-customer
// sale), shipping always 0. Faithfully preserves the original's one
// inconsistency vs. the other order-creation routes: NO discount_expiry
// check here (functions/routes/orders.js's billing-create read
// `p.discount` unconditionally, unlike payment.js's activeProductDiscount()).
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAdmin, isFeatureKilled, isPromoExpired } from "../_shared/auth.ts";
import { getSellerState, loadPricingCatalog } from "../_shared/pricing.ts";
import { applyGstToItems, collectProductIds, priceCartItems, resolveInterState, sumGstTotals } from "../_shared/cartPricing.ts";
import { createOrderTx, StockError } from "../_shared/orderWriter.ts";

const VALID_PAYMENT_METHODS = ["Cash", "UPI", "Card", "Other"];

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const methodErr = methodNotAllowed(req, ["POST"]);
  if (methodErr) return methodErr;

  const admin = supabaseAdmin();

  try {
    const auth = await requireAdmin(req, admin);
    if (!auth.user) return auth.error;

    if (await isFeatureKilled(admin, "orders")) {
      return jsonResponse(req, 503, { success: false, error: "Order creation is temporarily disabled." });
    }

    const { json: body } = await readBody(req);
    const {
      items,
      customerName = "",
      customerPhone = "",
      customerEmail = "",
      paymentMethod = "Cash",
      paymentStatus = "paid",
      promoCode = "",
      manualDiscount = 0,
      manualDiscountType = "flat",
    } = body || {};

    // ── 1. Validate inputs ────────────────────────────────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return jsonResponse(req, 400, { success: false, error: "No items in the bill." });
    }
    const safeMethod = VALID_PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "Cash";
    const safeStatus = paymentStatus === "pending" ? "pending" : "paid";
    const safeDiscType = manualDiscountType === "percent" ? "percent" : "flat";

    // ── 2. Server-authoritative pricing (catalog is source of truth) ──────
    // Same option-aware pricing as the online channels. Two deliberate differences from them:
    //  * honorDiscountExpiry:false — the original billing route applies `products.discount` with NO
    //    expiry check, and that quirk is preserved exactly.
    //  * an unknown/inactive variant is now an ERROR (it used to be silently billed at the main price).
    const { productsById, variantsByProduct } = await loadPricingCatalog(admin, collectProductIds(items));
    const priced = priceCartItems(items, productsById, variantsByProduct, { honorDiscountExpiry: false });
    if (!priced.ok) {
      return jsonResponse(req, priced.status, { success: false, error: priced.error });
    }
    const resolvedItems = priced.lineItems;
    const subtotalRounded = Math.round(priced.subtotal * 100) / 100;

    // ── 3. Promo code ───────────────────────────────────────────────────────
    let promoDiscount = 0;
    let appliedPromoCode = "";
    if (promoCode && typeof promoCode === "string" && promoCode.trim()) {
      const code = promoCode.trim().toUpperCase();
      try {
        const { data: pd } = await admin.from("promo_codes").select("*").eq("code", code).maybeSingle();
        if (pd && !isPromoExpired(pd.expiry_date)) {
          const value = Number(pd.value || 0);
          if (pd.type === "percent") promoDiscount = Math.round((subtotalRounded * value) / 100);
          else if (pd.type === "flat") promoDiscount = value;
          promoDiscount = Math.max(0, promoDiscount);
          appliedPromoCode = code;
        }
      } catch (e) {
        console.warn("[orders-billing-create] promo lookup failed:", e);
      }
    }

    // ── 4. Manual discount (admin override on the whole bill) ──────────────
    const rawManual = Math.max(0, Number(manualDiscount) || 0);
    let manualDiscountAmount = 0;
    if (rawManual > 0) {
      manualDiscountAmount = safeDiscType === "percent" ? Math.round((subtotalRounded * Math.min(rawManual, 100)) / 100) : rawManual;
      manualDiscountAmount = Math.max(0, manualDiscountAmount);
    }

    // ── 5. Final total (shipping always 0 for in-store) ─────────────────────
    const total = Math.max(0, Math.round(subtotalRounded - promoDiscount - manualDiscountAmount));
    if (total <= 0) {
      return jsonResponse(req, 400, { success: false, error: "Bill total must be greater than zero." });
    }

    // ── 6. Resolve customer (existing profile by phone/email, else walk-in) ──
    let userId: string | null = null;
    let userName = "", userEmail = "", userPhone = "";
    let userAddress: unknown = null;
    let isGuest = false;
    let buyerState = "";
    const phone = String(customerPhone || "").trim();
    const email = String(customerEmail || "").trim();

    if (phone) {
      const { data: p } = await admin.from("profiles").select("*").eq("phone", phone).limit(1).maybeSingle();
      if (p) {
        userId = p.id;
        userName = p.name || customerName || "Customer";
        userEmail = p.email || email || "";
        userPhone = p.phone || phone;
        userAddress = p.address ?? null;
        buyerState = p.address?.state || "";
      }
    }
    if (!userId && email) {
      const { data: p } = await admin.from("profiles").select("*").eq("email", email).limit(1).maybeSingle();
      if (p) {
        userId = p.id;
        userName = p.name || customerName || "Customer";
        userEmail = p.email || email;
        userPhone = p.phone || phone || "";
        userAddress = p.address ?? null;
        buyerState = p.address?.state || "";
      }
    }
    if (!userId) {
      // Walk-in — orders.user_id is a real uuid FK ("null for guest/walk-in"
      // per 01-schema.sql), so no synthetic pseudo-id here.
      isGuest = true;
      userName = customerName || "Walk-in Customer";
      userEmail = email;
      userPhone = phone;
    }

    const sellerState = await getSellerState(admin);
    const isInterState = resolveInterState(buyerState, sellerState);
    const gstItems = applyGstToItems(resolvedItems, isInterState);
    const gstTotals = sumGstTotals(gstItems);
    const totalItems = resolvedItems.reduce((s, it) => s + it.quantity, 0);

    // ── 7. Write the order (stock re-validated inside the RPC) ─────────────
    const orderId = `bill_${crypto.randomUUID()}`;
    try {
      await createOrderTx(admin, {
        orderId,
        userId,
        items: gstItems,
        orderStatus: "delivered", // in-store, hand-to-customer sale
        paymentStatus: safeStatus,
        paymentMethod: safeMethod,
        source: "billing",
        customerName: userName,
        customerEmail: userEmail,
        customerPhone: userPhone,
        address: userAddress ?? "In-Store",
        subtotal: subtotalRounded,
        shipping: 0,
        cgst: gstTotals.totalCgst,
        sgst: gstTotals.totalSgst,
        igst: gstTotals.totalIgst,
        promoCode: appliedPromoCode,
        promoDiscount,
        total,
      });
    } catch (e) {
      if (e instanceof StockError) {
        return jsonResponse(req, 409, { success: false, error: e.message });
      }
      throw e;
    }

    // Full order object so the client can generate the invoice PDF without a follow-up read.
    return jsonResponse(req, 200, {
      success: true,
      orderId,
      order: {
        orderId,
        id: orderId,
        userId,
        userName,
        userEmail,
        userPhone,
        userAddress: "In-Store Pickup",
        shippingAddress: "In-Store Pickup",
        subtotal: subtotalRounded,
        shipping: 0,
        promoDiscount,
        promoCode: appliedPromoCode,
        manualDiscount: manualDiscountAmount,
        manualDiscountType: safeDiscType,
        total,
        totalItems,
        taxableTotal: gstTotals.taxableTotal,
        totalCgst: gstTotals.totalCgst,
        totalSgst: gstTotals.totalSgst,
        totalIgst: gstTotals.totalIgst,
        isInterState,
        paymentMethod: safeMethod,
        paymentStatus: safeStatus,
        orderStatus: "delivered",
        source: "billing",
        createdAt: new Date().toISOString(),
        products: gstItems,
        isGuest,
      },
    });
  } catch (err) {
    console.error("[orders-billing-create] failed:", err);
    if (err instanceof StockError) {
      return jsonResponse(req, 409, { success: false, error: err.message });
    }
    return jsonResponse(req, 500, { success: false, error: "Failed to create bill" });
  }
});