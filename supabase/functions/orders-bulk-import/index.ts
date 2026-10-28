// Admin bulk CSV order import. Admin uploads a CSV of historical orders;
// this validates each row, matches every "product" cell against the live
// catalog (so stock/stats/GST stay real), groups rows by `order_id`, and
// writes one order per group via create_order_tx — the same atomic path
// (stock/customer_stats/product_stats/inventory_logs/analytics) that every
// other order-creation route (Razorpay/COD/billing/WhatsApp-paste) uses.
// One bad order group never blocks the rest of the batch.
import { handlePreflight, jsonResponse, methodNotAllowed, readBody } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";
import { requireAdmin, isFeatureKilled } from "../_shared/auth.ts";
import { getSellerState, loadFullCatalog } from "../_shared/pricing.ts";
import { applyGstToItems, resolveInterState, resolveOptionByTitle, sumGstTotals, round2, type LineItem } from "../_shared/cartPricing.ts";
import { createOrderTx, StockError } from "../_shared/orderWriter.ts";

// Matches the UI copy ("Supports up to 5,000 rows per batch").
const MAX_ROWS = 5000;

type CsvRow = {
    order_id: string;
    customer_id?: string;
    customer_email?: string;
    customer_name?: string;
    product: string;
    price: number | string;
    qty: number | string;
    status?: string;
};

type RowResult = {
    externalOrderId: string;
    status: "created" | "failed";
    orderId?: string;
    itemCount?: number;
    total?: number;
    error?: string;
};

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
        const { rows, paymentStatus = "paid" } = body || {};
        if (!Array.isArray(rows) || !rows.length) {
            return jsonResponse(req, 400, { success: false, error: "No rows to import" });
        }
        if (rows.length > MAX_ROWS) {
            return jsonResponse(req, 400, { success: false, error: `Too many rows — max ${MAX_ROWS} per batch` });
        }
        const safeStatus = paymentStatus === "pending" ? "pending" : "paid";

        // ── 1. Validate + group by order_id — same required-column contract as
        //      the client's pre-flight preview (order_id, customer_id/email,
        //      product, price, qty). ─────────────────────────────────────────
        const groups = new Map<string, CsvRow[]>();
        const rowErrors: string[] = [];
        (rows as CsvRow[]).forEach((r, i) => {
            const orderId = String(r.order_id || "").trim();
            const price = Number(r.price);
            const qty = Number(r.qty);
            if (!orderId) { rowErrors.push(`Row ${i + 1}: missing order_id`); return; }
            if (!r.customer_id && !r.customer_email) { rowErrors.push(`Row ${i + 1} (${orderId}): missing customer_id/customer_email`); return; }
            if (!r.product || !String(r.product).trim()) { rowErrors.push(`Row ${i + 1} (${orderId}): missing product`); return; }
            if (!(price > 0)) { rowErrors.push(`Row ${i + 1} (${orderId}): invalid price`); return; }
            if (!(qty > 0)) { rowErrors.push(`Row ${i + 1} (${orderId}): invalid qty`); return; }
            const list = groups.get(orderId) || [];
            list.push(r);
            groups.set(orderId, list);
        });

        // ── 2. Catalog + seller state, fetched once for the whole batch ─────
        const { products: allProducts, variantsByProduct } = await loadFullCatalog(admin);
        const sellerState = await getSellerState(admin);

        // ── 3. Process each order group independently ───────────────────────
        const results: RowResult[] = [];

        for (const [externalOrderId, groupRows] of groups) {
            try {
                const master = groupRows[0];

                // Resolve customer: uuid match -> email match -> guest (order.user_id
                // stays null for guests, same rule orders-manual-create uses — no
                // synthetic pseudo-id, real uuid FK or nothing).
                let userId: string | null = null;
                let userName = master.customer_name || "Imported Customer";
                let userEmail = master.customer_email || "";
                let userAddress: unknown = null;

                if (master.customer_id) {
                    const { data: p } = await admin.from("profiles").select("*").eq("id", master.customer_id).maybeSingle();
                    if (p) { userId = p.id; userName = p.name || userName; userEmail = p.email || userEmail; userAddress = p.address ?? null; }
                }
                if (!userId && master.customer_email) {
                    const { data: p } = await admin.from("profiles").select("*").eq("email", master.customer_email).maybeSingle();
                    if (p) { userId = p.id; userName = p.name || userName; userEmail = p.email || userEmail; userAddress = p.address ?? null; }
                }

                // Resolve every line item against the live catalog. A bulk import is
                // backfilling historical sales at their *own* price, not today's
                // catalog price — the catalog is only consulted for a real
                // product_id/category/gst_rate/hsn_code so stock, product_stats and
                // the GST split stay consistent with a real product.
                const lineItems: LineItem[] = []
                for (const r of groupRows) {
                    // "Designer Shirt" = the product's main option; "Designer Shirt [Pink]" = its Pink variant
                    const resolved = resolveOptionByTitle(String(r.product), allProducts, variantsByProduct)
                    if (!resolved.ok) throw new Error(resolved.error)
                    const p = resolved.product
                    const v = resolved.variant
                    const price = Number(r.price)
                    lineItems.push({
                        productId: p.id,
                        variantId: v ? v.id : undefined,
                        variantName: v ? v.name : undefined,
                        itemType: v ? "variant" : (p.has_variants ? "main" : "single"),
                        title: v ? `${p.title} [${v.name}]` : (p.title as string),
                        category: p.category || "general",
                        quantity: Math.floor(Number(r.qty)),
                        originalPrice: price,
                        discount: 0,
                        finalPrice: price,
                        gstRate: Number(p.gst_rate || 0),
                        hsnCode: p.hsn_code || "",
                    })
                }

                const buyerState = (userAddress as any)?.state || ""
                const isInterState = resolveInterState(buyerState, sellerState)
                const gstItems = applyGstToItems(lineItems, isInterState)
                const gstTotals = sumGstTotals(gstItems)
                const subtotal = round2(lineItems.reduce((s, it) => s + it.finalPrice * it.quantity, 0))
                const total = Math.round(subtotal)

                const orderId = `import_${crypto.randomUUID()}`
                await createOrderTx(admin, {
                    orderId,
                    userId,
                    items: gstItems,
                    orderStatus: (master.status || "delivered").toLowerCase(),
                    paymentStatus: safeStatus,
                    paymentMethod: "Imported",
                    source: "manual",
                    customerName: userName,
                    customerEmail: userEmail,
                    customerPhone: "",
                    address: userAddress,
                    subtotal,
                    shipping: 0,
                    cgst: gstTotals.totalCgst,
                    sgst: gstTotals.totalSgst,
                    igst: gstTotals.totalIgst,
                    promoCode: "",
                    promoDiscount: 0,
                    total,
                })

                results.push({ externalOrderId, status: "created", orderId, itemCount: lineItems.length, total })
            } catch (e) {
                results.push({
                    externalOrderId,
                    status: "failed",
                    error: e instanceof StockError ? e.message : (e as Error).message || "Import failed",
                })
            }
        }

        const created = results.filter((r) => r.status === "created").length
        const failed = results.length - created

        return jsonResponse(req, 200, {
            success: true,
            results,
            rowErrors,
            created,
            failed,
            recordCount: rows.length,
        })
    } catch (err) {
        console.error("[orders-bulk-import] failed:", err)
        return jsonResponse(req, 500, { success: false, error: "Bulk import failed" })
    }
})