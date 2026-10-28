// PURE pricing logic shared by every order channel (no Deno / Supabase imports on
// purpose, so it can be unit-tested under Node: supabase/tests/pricing.test.mjs).
//
// Contents: money helpers, GST maths (moved verbatim from pricing.ts), and
// priceCartItems() — now option-aware.
//
// THE MODEL (see IMPLEMENTATION_PLAN §4.1): a purchasable option is
//   (productId, variantId)   with variantId '' / undefined = the main (or only) option.
//   * single product            -> one option: the product itself
//   * product with variants     -> the main option (when main_option_enabled) + one per ACTIVE variant
// Each option has its OWN price / stock / SKU. The main price is never derived from variants.
//
// Two modes:
//   * TABLE mode  (variantsByProduct supplied): variants come from `product_variants`
//     (migration M1). Authoritative.
//   * LEGACY mode (variantsByProduct undefined): variants are read from the products.variants
//     jsonb exactly like the pre-M1 code — kept so these functions still work if they are
//     deployed before the SQL migration has been applied.

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export type LineItem = {
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  /** 'single' | 'main' | 'variant' — informational; the DB derives the authoritative value. */
  itemType?: "single" | "main" | "variant";
  title: string;
  category: string;
  sku?: string;
  quantity: number;
  originalPrice: number;
  discount: number;
  finalPrice: number;
  gstRate: number;
  hsnCode: string;
};

export type GstLineItem = LineItem & {
  taxableValue: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
};

/** Per-UNIT taxable value + gst amount for a GST-inclusive unit price. */
export function unitGst(finalPrice: number, gstRate: number): { taxableValue: number; gstAmount: number } {
  const price = Number(finalPrice) || 0;
  const rate = Number(gstRate) || 0;
  if (rate <= 0) return { taxableValue: round2(price), gstAmount: 0 };
  const taxableValue = round2((price * 100) / (100 + rate));
  const gstAmount = round2(price - taxableValue);
  return { taxableValue, gstAmount };
}

/**
 * Enrich each line item with GST fields. CGST=ceil, SGST=floor so the two
 * always sum to the line's GST exactly (matches orderWriter.js).
 */
export function applyGstToItems(items: LineItem[], isInterState: boolean): GstLineItem[] {
  return (items || []).map((it) => {
    const rate = Number(it.gstRate) || 0;
    const qty = Number(it.quantity) || 0;
    const { taxableValue, gstAmount } = unitGst(it.finalPrice, rate);
    const lineGst = round2(gstAmount * qty);
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (isInterState) {
      igstAmount = lineGst;
    } else {
      cgstAmount = Math.ceil((lineGst / 2) * 100) / 100;
      sgstAmount = Math.floor((lineGst / 2) * 100) / 100;
    }
    return {
      ...it,
      gstRate: rate,
      hsnCode: it.hsnCode || "",
      taxableValue,
      gstAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
    };
  });
}

/** Sum GST-enriched line items into order-level totals. */
export function sumGstTotals(items: GstLineItem[]) {
  const list = items || [];
  return {
    taxableTotal: round2(list.reduce((s, it) => s + (Number(it.taxableValue) || 0) * (Number(it.quantity) || 0), 0)),
    totalCgst: round2(list.reduce((s, it) => s + (Number(it.cgstAmount) || 0), 0)),
    totalSgst: round2(list.reduce((s, it) => s + (Number(it.sgstAmount) || 0), 0)),
    totalIgst: round2(list.reduce((s, it) => s + (Number(it.igstAmount) || 0), 0)),
  };
}

/** True when buyer + seller states are both known and differ (→ IGST). */
export function resolveInterState(buyerState: string, sellerState: string): boolean {
  const b = String(buyerState || "").trim().toLowerCase();
  const s = String(sellerState || "").trim().toLowerCase();
  return !!(b && s && b !== s);
}

/**
 * Product-level discount, ignoring it once discount_expiry has passed.
 * Mirrors the frontend's isDiscountActive(). The discount is PRODUCT-level and applies to
 * every option of the product (main and variants) — there is no per-variant discount.
 */
export function activeProductDiscount(p: { discount?: number; discount_expiry?: string | null }): number {
  const raw = Number(p.discount || 0);
  if (raw > 0 && p.discount_expiry) {
    const expiryMs = new Date(p.discount_expiry).getTime();
    if (!isNaN(expiryMs) && Date.now() > expiryMs) return 0;
  }
  return raw;
}

export type LegacyVariantJson = { id: string; name: string; price: number; stock: number; sku?: string };

export type ProductRow = {
  id: string;
  title: string | null;
  category: string | null;
  sku: string | null;
  price: number;
  stock: number;
  discount: number;
  discount_expiry: string | null;
  gst_rate: number;
  hsn_code: string | null;
  // --- M1 columns (undefined before the migration) ---
  has_variants?: boolean;
  main_option_enabled?: boolean;
  track_inventory?: boolean;
  /** JSONB array of variant objects (legacy source / trigger-maintained cache). */
  variants?: LegacyVariantJson[] | null;
};

/** A row of public.product_variants (M1). */
export type VariantRow = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  price: number;
  stock: number;
  track_inventory?: boolean;
  status?: "active" | "inactive";
};

export type PriceItemsResult =
  | { ok: true; lineItems: LineItem[]; subtotal: number }
  | { ok: false; status: number; error: string };

export type CartItemInput = {
  productId?: string;
  product_id?: string;
  id?: string;
  variantId?: string | null;
  variant_id?: string | null;
  quantity?: number;
};

export type PriceOptions = {
  /** default true. orders-billing-create deliberately keeps the legacy "no expiry check" behaviour. */
  honorDiscountExpiry?: boolean;
};

/**
 * Splits a cart/bill line into (productId, variantId, qty). Variant ids carry the `var_` prefix and
 * product ids contain underscores, so a bare "_" must never be split on: the only recognised
 * compound form is `${productId}_var_${suffix}` (legacy Redux id).
 */
export function parseCartItemRef(it: CartItemInput): { pid: string; variantId: string; qty: number } {
  const rawPid = String(it?.productId || it?.product_id || it?.id || "");
  const compound = rawPid.includes("_var_");
  const pid = compound ? rawPid.split("_var_")[0] : rawPid;
  const variantId = String(it?.variantId || it?.variant_id || (compound ? "var_" + rawPid.split("_var_")[1] : "") || "");
  const qty = Math.floor(Number(it?.quantity) || 0);
  return { pid, variantId, qty };
}

/** Distinct product ids referenced by a list of cart/bill lines (for the catalog query). */
export function collectProductIds(items: CartItemInput[]): string[] {
  return [...new Set((items || []).map((i) => parseCartItemRef(i).pid).filter(Boolean))];
}

/**
 * Server-authoritative per-line pricing shared by create-order, cod-create and billing.
 * Validation order (unchanged): invalid line → 400, product missing → 400, option unknown/unavailable → 400/409,
 * not purchasable (price <= 0) → 400, insufficient stock → 409. Discount is expiry-aware by default.
 */
export function priceCartItems(
  items: CartItemInput[],
  productsById: Map<string, ProductRow>,
  variantsByProduct?: Map<string, VariantRow[]>,
  opts: PriceOptions = {},
): PriceItemsResult {
  const honorExpiry = opts.honorDiscountExpiry !== false;
  const lineItems: LineItem[] = [];
  let subtotal = 0;

  for (const it of items) {
    const { pid, variantId, qty } = parseCartItemRef(it);
    if (!pid || qty <= 0) {
      return { ok: false, status: 400, error: "Invalid cart item" };
    }

    const p = productsById.get(pid);
    if (!p) {
      return { ok: false, status: 400, error: `Product not found: ${pid}` };
    }

    let price = Number(p.price || 0);
    let stock = Number(p.stock || 0);
    let tracked = p.track_inventory !== false;
    let resolvedSku: string | undefined = p.sku ?? undefined;
    let resolvedVariantName: string | undefined = undefined;
    let itemType: LineItem["itemType"] = "single";
    let outVariantId: string | undefined = undefined;

    if (variantsByProduct) {
      // ---- TABLE mode -------------------------------------------------------------
      const variants = variantsByProduct.get(pid) || [];
      if (variantId) {
        const v = variants.find((x) => String(x.id) === variantId);
        if (!v) {
          return { ok: false, status: 400, error: `Variant not found: ${variantId} for product ${pid}` };
        }
        if (v.status && v.status !== "active") {
          return { ok: false, status: 409, error: `${p.title || pid} (${v.name}) is no longer available` };
        }
        price = Number(v.price || 0);
        stock = Number(v.stock || 0);
        tracked = v.track_inventory !== false;
        resolvedVariantName = v.name;
        resolvedSku = v.sku || undefined;
        itemType = "variant";
        outVariantId = String(v.id);
      } else if (p.has_variants || variants.length > 0) {
        if (p.main_option_enabled === false) {
          return { ok: false, status: 409, error: `Please choose an option for ${p.title || pid}` };
        }
        itemType = "main";
      }
    } else if (variantId && Array.isArray(p.variants) && p.variants.length > 0) {
      // ---- LEGACY mode (pre-M1): variant data from the products.variants jsonb --------
      const variant = p.variants.find((v) => String(v.id) === variantId);
      if (!variant) {
        return { ok: false, status: 400, error: `Variant not found: ${variantId} for product ${pid}` };
      }
      price = Number(variant.price || 0);
      stock = Number(variant.stock || 0);
      resolvedVariantName = variant.name;
      if (variant.sku) resolvedSku = variant.sku;
      itemType = "variant";
      outVariantId = variantId;
    } else if (variantId) {
      outVariantId = variantId; // legacy behaviour: unknown variant on a product without any -> priced as main
    }

    if (price <= 0) {
      return { ok: false, status: 400, error: `Product not purchasable: ${p.title || pid}` };
    }
    if (tracked && stock < qty) {
      return {
        ok: false,
        status: 409,
        error: `Not enough stock for ${p.title || pid}${resolvedVariantName ? ` (variant ${resolvedVariantName})` : ""}`,
      };
    }

    const finalDiscount = honorExpiry ? activeProductDiscount(p) : Number(p.discount || 0);
    const finalPrice = price - (price * finalDiscount) / 100;

    subtotal += finalPrice * qty;

    lineItems.push({
      productId: pid,
      variantId: outVariantId,
      variantName: resolvedVariantName,
      itemType,
      title: resolvedVariantName ? `${p.title || "Product"} [${resolvedVariantName}]` : (p.title || "Product"),
      category: p.category || "general",
      sku: resolvedSku,
      quantity: qty,
      originalPrice: price,
      discount: finalDiscount,
      finalPrice,
      gstRate: Number(p.gst_rate || 0),
      hsnCode: p.hsn_code || "",
    });
  }

  return { ok: true, lineItems, subtotal };
}

/**
 * Resolves a product + option from a catalog for the channels that identify products by TEXT
 * (WhatsApp paste, bulk order import): "Designer Shirt [Pink]" -> product "Designer Shirt", variant "Pink".
 * Tries the full text first (a product's own title may end in brackets), then the bracket split.
 * Returns an error string instead of guessing when anything is ambiguous.
 */
export function resolveOptionByTitle(
  rawTitle: string,
  products: ProductRow[],
  variantsByProduct: Map<string, VariantRow[]> | undefined,
): { ok: true; product: ProductRow; variant: VariantRow | null } | { ok: false; error: string } {
  const text = String(rawTitle || "").trim();
  const lower = (s: unknown) => String(s ?? "").toLowerCase().trim();
  const byTitle = (needle: string) => {
    let m = products.filter((p) => typeof p.title === "string" && lower(p.title) === needle);
    if (!m.length) m = products.filter((p) => typeof p.title === "string" && lower(p.title).startsWith(needle));
    return m;
  };

  // 1) the whole text is a product title
  const whole = byTitle(lower(text));
  if (whole.length === 1) return pickMain(whole[0], variantsByProduct);
  if (whole.length > 1) {
    return { ok: false, error: `Ambiguous product title "${text}". Matches: ${whole.map((p) => p.title).join(", ")}` };
  }

  // 2) "<product> [<variant>]"
  const m = text.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (m && m[1].trim()) {
    const base = byTitle(lower(m[1]));
    if (!base.length) return { ok: false, error: `Product not found: "${text}"` };
    if (base.length > 1) return { ok: false, error: `Ambiguous product title "${m[1].trim()}". Matches: ${base.map((p) => p.title).join(", ")}` };
    const p = base[0];
    const variants = (variantsByProduct?.get(p.id) || []).filter((v) => !v.status || v.status === "active");
    const named = variants.filter((v) => lower(v.name) === lower(m[2]));
    if (named.length === 1) return { ok: true, product: p, variant: named[0] };
    if (named.length > 1) return { ok: false, error: `Ambiguous variant "${m[2].trim()}" of "${p.title}" — more than one variant has that name` };
    return { ok: false, error: `Variant not found: "${m[2].trim()}" for product "${p.title}"` };
  }
  return { ok: false, error: `Product not found: "${text}"` };
}

function pickMain(p: ProductRow, variantsByProduct: Map<string, VariantRow[]> | undefined) {
  const hasVariants = !!p.has_variants || (variantsByProduct?.get(p.id)?.length ?? 0) > 0;
  if (hasVariants && p.main_option_enabled === false) {
    return { ok: false as const, error: `"${p.title}" has no main option — name the variant, e.g. "${p.title} [Variant]"` };
  }
  return { ok: true as const, product: p, variant: null };
}