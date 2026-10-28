// Port of functions/routes/orders.js POST /manual-create.
// Admin pastes a WhatsApp order message; this parses it, resolves the
// customer + products against the live catalog, validates the pasted total
// against the server-recomputed one, and writes the order via create_order_tx.
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAdmin, isFeatureKilled } from "../_shared/auth.ts";
import { getSellerState, loadFullCatalog } from "../_shared/pricing.ts";
import {
    activeProductDiscount,
    applyGstToItems,
    resolveInterState,
    resolveOptionByTitle,
    sumGstTotals,
    type LineItem,
    type ProductRow,
    type VariantRow,
} from "../_shared/cartPricing.ts";
import { createOrderTx, StockError } from "../_shared/orderWriter.ts";
import { parseWhatsAppMessage } from "../_shared/whatsappMessage.ts";

// Max rupee gap tolerated between the admin-supplied total and the total the
// server recomputes from the live catalog before it demands explicit override.
const PRICE_TOLERANCE = 1;


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
        const { message, paymentStatus = "paid", allowPriceOverride = false } = body || {};
        if (!message || typeof message !== "string" || !message.trim()) {
            return jsonResponse(req, 400, { success: false, error: "Order message is required" });
        }
        const safeStatus = paymentStatus === "pending" ? "pending" : "paid";

        // ── 1. Parse ──────────────────────────────────────────────────────────
        const parsed = parseWhatsAppMessage(message);
        if (!parsed.items.length) {
            return jsonResponse(req, 400, { success: false, error: "No items found in the message." });
        }
        if (!parsed.customerId && !parsed.email) {
            return jsonResponse(req, 400, { success: false, error: "Could not find Customer ID or Email in the message." });
        }
        if (!parsed.totalAmount) {
            return jsonResponse(req, 400, { success: false, error: "Could not extract Total Amount from the message." });
        }

        // ── 2. Resolve customer ──────────────────────────────────────────────
        let userId: string | null = null;
        let userName = "", userEmail = "", userPhone = "", userAddress: unknown = null;
        let isGuest = false;

        if (parsed.customerId) {
            const { data: p } = await admin.from("profiles").select("*").eq("id", parsed.customerId).maybeSingle();
            if (p) {
                userId = parsed.customerId;
                userName = p.name || parsed.customerName || "User";
                userEmail = p.email || parsed.email || "";
                userPhone = p.phone || parsed.phone || "";
                userAddress = p.address ?? null;
            }
        }
        if (!userId && parsed.email) {
            const { data: p } = await admin.from("profiles").select("*").eq("email", parsed.email).limit(1).maybeSingle();
            if (p) {
                userId = p.id;
                userName = p.name || parsed.customerName || "User";
                userEmail = p.email || parsed.email || "";
                userPhone = p.phone || parsed.phone || "";
                userAddress = p.address ?? null;
            }
        }
        // Guest fallback — no matching profile. orders.user_id is a real uuid FK
        // (`on delete set null` — "null for guest/walk-in" per 01-schema.sql), so
        // a guest order carries userId:null and relies on the denormalized
        // customer_name/email/phone columns instead of a synthetic pseudo-id.
        if (!userId) {
            isGuest = true;
            userName = parsed.customerName || "Guest";
            userEmail = parsed.email || "";
            userPhone = parsed.phone || "";
        }

        // ── 3. Resolve products + options (fetch all, match in-memory — same as the original) ──
        // A line is a purchasable OPTION: the product's main option, or one of its variants. The message
        // carries it either as an explicit "Ref: <productId>|<variantId>" line (newer clients — exact, no
        // guessing) or as the text "Title [Variant]" (what every client has always sent).
        const { products: allProducts, productsById, variantsByProduct } = await loadFullCatalog(admin);

        const resolvedItems: LineItem[] = [];
        const errors: string[] = [];

        for (const item of parsed.items) {
            let p: ProductRow | undefined;
            let variant: VariantRow | null = null;

            if (item.ref) {
                const [refPid, refVid = ""] = item.ref.split("|").map((s: string) => s.trim());
                p = productsById.get(refPid);
                if (!p) {
                    errors.push(`Product not found for ref "${item.ref}" ("${item.title}")`);
                    continue;
                }
                if (refVid) {
                    variant = (variantsByProduct?.get(refPid) || []).find((v) => v.id === refVid && (!v.status || v.status === "active")) || null;
                    if (!variant) {
                        errors.push(`Variant not found for ref "${item.ref}" ("${item.title}")`);
                        continue;
                    }
                } else if ((p.has_variants || (variantsByProduct?.get(refPid)?.length ?? 0) > 0) && p.main_option_enabled === false) {
                    errors.push(`"${p.title}" cannot be bought as the main product — choose a variant`);
                    continue;
                }
            } else {
                const r = resolveOptionByTitle(item.title, allProducts, variantsByProduct);
                if (!r.ok) {
                    errors.push(r.error);
                    continue;
                }
                p = r.product;
                variant = r.variant;
            }

            // the option's OWN price; the product-level discount applies to every option
            const catalogPrice = variant ? Number(variant.price) || 0 : Number(p.price) || 0;
            // Respect discount_expiry on the server — same logic as the frontend's isDiscountActive().
            const catalogDiscount = activeProductDiscount(p); // no separate category_discount column post-migration
            const catalogFinalPrice = catalogPrice - (catalogPrice * catalogDiscount) / 100;

            const waUnitPrice = Number(item.discountedPrice) > 0 ? Number(item.discountedPrice) : catalogFinalPrice;
            const finalPrice = allowPriceOverride ? waUnitPrice : catalogFinalPrice;

            resolvedItems.push({
                productId: p.id,
                variantId: variant ? variant.id : undefined,
                variantName: variant ? variant.name : undefined,
                itemType: variant ? "variant" : (p.has_variants ? "main" : "single"),
                title: variant ? `${p.title} [${variant.name}]` : (p.title as string),
                category: p.category || "general",
                sku: (variant ? variant.sku : p.sku) || undefined,
                quantity: item.quantity,
                originalPrice: allowPriceOverride ? item.mrp || catalogPrice : catalogPrice,
                discount: allowPriceOverride ? item.discountPct || 0 : catalogDiscount,
                finalPrice,
                gstRate: Number(p.gst_rate || 0),
                hsnCode: p.hsn_code || "",
            });
        }

        if (errors.length) {
            return jsonResponse(req, 400, { success: false, error: errors.join("\n") });
        }

        // ── 3b. Price integrity check ─────────────────────────────────────────
        const serverSubtotal = Math.round(resolvedItems.reduce((s, it) => s + it.finalPrice * it.quantity, 0) * 100) / 100;
        const msgShipping = Number(parsed.shipping) || 0;
        const msgPromoDiscount = Number(parsed.promoDiscount) || 0;
        const serverTotal = Math.max(0, Math.round(serverSubtotal + msgShipping - msgPromoDiscount));
        const pastedTotal = Math.round(Number(parsed.totalAmount) || 0);
        const priceMismatch = Math.abs(serverTotal - pastedTotal) > PRICE_TOLERANCE;

        if (priceMismatch && !allowPriceOverride) {
            return jsonResponse(req, 409, {
                success: false,
                code: "PRICE_MISMATCH",
                error: `The pasted total (₹${pastedTotal}) does not match the catalog total (₹${serverTotal}). Review the order and re-submit with confirmation to override.`,
                serverTotal,
                pastedTotal,
            });
        }
        const recordedTotal = priceMismatch ? pastedTotal : serverTotal;

        // GST breakdown — buyer state from the resolved profile (guests have none).
        const sellerState = await getSellerState(admin);
        const buyerState = (userAddress as any)?.state || "";
        const isInterState = resolveInterState(buyerState, sellerState);
        const gstItems = applyGstToItems(resolvedItems, isInterState);
        const gstTotals = sumGstTotals(gstItems);
        const totalItems = resolvedItems.reduce((s, it) => s + it.quantity, 0);

        const orderId = `wa_${crypto.randomUUID()}`;
        try {
            await createOrderTx(admin, {
                orderId,
                userId,
                items: gstItems,
                orderStatus: "placed",
                paymentStatus: safeStatus,
                paymentMethod: "WhatsApp",
                source: "manual",
                customerName: userName,
                customerEmail: userEmail,
                customerPhone: userPhone,
                address: userAddress,
                subtotal: serverSubtotal,
                shipping: msgShipping,
                cgst: gstTotals.totalCgst,
                sgst: gstTotals.totalSgst,
                igst: gstTotals.totalIgst,
                promoCode: parsed.promoCode || "",
                promoDiscount: msgPromoDiscount,
                total: recordedTotal,
            });
        } catch (e) {
            if (e instanceof StockError) {
                return jsonResponse(req, 409, { success: false, error: e.message });
            }
            throw e;
        }

        return jsonResponse(req, 200, {
            success: true,
            orderId,
            parsedOrder: {
                customerId: userId,
                customerName: userName,
                email: userEmail,
                phone: userPhone,
                itemCount: resolvedItems.length,
                totalItems,
                total: parsed.totalAmount,
                paymentStatus: safeStatus,
                isGuest,
            },
        });
    } catch (err) {
        console.error("[orders-manual-create] failed:", err);
        if (err instanceof StockError) {
            return jsonResponse(req, 409, { success: false, error: err.message });
        }
        return jsonResponse(req, 500, { success: false, error: "Failed to create order" });
    }
});