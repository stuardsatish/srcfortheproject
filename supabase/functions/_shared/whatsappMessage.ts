// Parser for the order message a customer sends through the "Order on WhatsApp" button (web CartPage / RN cart).
// An admin pastes it into /admin/createOrders and orders-manual-create turns it into a real order.
// PURE (no Deno / Supabase imports) so it can be unit-tested under Node: supabase/tests/whatsapp.test.mjs.
//
// Each item block looks like:
//   1. Designer Shirt [Pink]            <- title, with the variant name in brackets for a variant
//    Ref: prod_1700000000|var_1700_0     <- OPTIONAL (newer clients): exact "productId|variantId"; variantId empty = main option
//    Quantity: 2
//    MRP: ₹300.00
//    Discount: 10%
//    Discounted Price: ₹270.00
// Older clients omit the Ref line; the server then resolves the product by title (and the variant from the brackets).

/* ──────────────────────────────────────────────────────────────────────────
   PARSER — verbatim port of orders.js's parseWhatsAppMessage(). Handles the
   exact format emitted by CartPage.jsx's sendOrderToWhatsApp().
────────────────────────────────────────────────────────────────────────── */
/** `ref` = optional "productId|variantId" line emitted by newer clients (variantId may be empty = main option). */
export type ParsedItem = { title: string; quantity: number; mrp: number; discountPct: number; discountedPrice: number; ref: string };
export type ParsedMessage = {
    customerId: string;
    customerName: string;
    email: string;
    phone: string;
    items: ParsedItem[];
    totalItems: number;
    subtotal: number;
    shipping: number;
    promoCode: string;
    promoDiscount: number;
    totalAmount: number;
};

export function parseWhatsAppMessage(text: string): ParsedMessage {
    const cleanText = text.replace(/\*+/g, "");
    const lines = cleanText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const result: ParsedMessage = {
        customerId: "", customerName: "", email: "", phone: "",
        items: [], totalItems: 0,
        subtotal: 0, shipping: 0, promoCode: "", promoDiscount: 0, totalAmount: 0,
    };

    const pick = (line: string) => line.slice(line.toLowerCase().indexOf(":") + 1).trim();
    const parsePrice = (str: string) => parseFloat(String(str).replace(/[^-0-9.]/g, "")) || 0;

    for (const line of lines) {
        const lc = line.toLowerCase();
        if (lc.startsWith("customer id:")) result.customerId = pick(line);
        else if (lc.startsWith("customer name:")) result.customerName = pick(line);
        else if (lc.startsWith("email:")) result.email = pick(line);
        else if (lc.startsWith("phone:")) result.phone = pick(line);
        else if (/^total items\s*:/.test(lc)) result.totalItems = parseInt(pick(line), 10) || 0;
        else if (/^subtotal\s*:/.test(lc)) result.subtotal = parsePrice(pick(line));
        else if (/^shipping\s*:/.test(lc)) result.shipping = parsePrice(pick(line));
        else if (/^promo code\s*:/.test(lc)) {
            const v = pick(line);
            result.promoCode = v === "None" || v === "none" ? "" : v;
        } else if (/^promo discount\s*:/.test(lc)) result.promoDiscount = parsePrice(pick(line));
        else if (/^total amount\s*:/.test(lc)) result.totalAmount = parsePrice(pick(line));
    }

    let i = 0;
    while (i < lines.length) {
        const match = lines[i].match(/^(\d+)[.)\s]+(.+)$/);
        if (match) {
            const title = match[2].trim();
            let quantity = 0, mrp = 0, discountPct = 0, discountedPrice = 0, legacyPrice = 0, ref = "";
            let j = i + 1;

            while (j < lines.length) {
                const nl = lines[j].toLowerCase();
                if (nl.startsWith("ref:")) {
                    ref = lines[j].slice(lines[j].indexOf(":") + 1).trim();
                    j++;
                } else if (nl.startsWith("quantity:")) {
                    quantity = parseInt(lines[j].slice(lines[j].indexOf(":") + 1).trim(), 10) || 0;
                    j++;
                } else if (nl.startsWith("mrp:")) {
                    mrp = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1));
                    j++;
                } else if (nl.startsWith("discount:")) {
                    discountPct = parseFloat(lines[j].slice(lines[j].indexOf(":") + 1).replace(/%/g, "").trim()) || 0;
                    j++;
                } else if (nl.startsWith("discounted price:")) {
                    discountedPrice = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1));
                    j++;
                } else if (nl.startsWith("price:")) {
                    legacyPrice = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1));
                    j++;
                } else if (/^\d+[.)\s]/.test(lines[j]) || /^total/.test(nl)) {
                    break;
                } else {
                    j++;
                }
            }

            if (title && quantity > 0) {
                result.items.push({
                    title,
                    quantity,
                    mrp: mrp || legacyPrice,
                    discountPct,
                    discountedPrice: discountedPrice || mrp || legacyPrice,
                    ref,
                });
            }
            i = j;
        } else {
            i++;
        }
    }

    return result;
}