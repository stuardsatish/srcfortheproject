// Database-facing pricing helpers (shipping/seller/buyer settings, promo codes, catalog loading).
//
// The PURE maths — GST, discount expiry, option resolution, priceCartItems — moved to
// ./cartPricing.ts (dependency-free, unit-tested under Node). This file keeps what needs a
// Supabase client. Import pure functions from "./cartPricing.ts" directly.
//
// Original note kept: this is exact financial math ported from functions/lib/orderWriter.js
// and functions/routes/payment.js — keep every formula, rounding rule and check order identical.
// Buyer state comes from `profiles.address->>'state'`, seller state from the
// `invoiceSettings` row's `data->>'state'`.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isPromoExpired } from "./auth.ts";
import type { ProductRow, VariantRow } from "./cartPricing.ts";

/**
 * NOTE on category discounts: the original Firestore products carried a separate
 * `categoryDiscount` field and every route did Math.max(productDiscount, categoryDiscount).
 * The Supabase products table has no such column — AddDiscountPage's bulk "apply to category"
 * writes straight into the single `discount` column for every matching product, so that max()
 * has already collapsed into one value. Nothing is left to max() against.
 */

/** Catalog rows needed to price a set of lines. `variantsByProduct` is undefined in LEGACY mode (M1 not applied). */
export type PricingCatalog = {
  productsById: Map<string, ProductRow>;
  variantsByProduct: Map<string, VariantRow[]> | undefined;
};

/** True when a PostgREST/Postgres error means "this table does not exist (yet)". */
export function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" ||
    /could not find the table|relation .* does not exist/i.test(err.message || "");
}

function groupVariants(rows: any[] | null): Map<string, VariantRow[]> {
  const m = new Map<string, VariantRow[]>();
  for (const r of rows || []) {
    const list = m.get(r.product_id) || [];
    list.push({
      id: String(r.id),
      product_id: String(r.product_id),
      name: String(r.name ?? ""),
      sku: r.sku ?? null,
      price: Number(r.price) || 0,
      stock: Number(r.stock) || 0,
      track_inventory: r.track_inventory !== false,
      status: r.status === "inactive" ? "inactive" : "active",
    });
    m.set(r.product_id, list);
  }
  return m;
}

const VARIANT_COLUMNS = "id, product_id, name, sku, price, stock, track_inventory, status";

/** Products + variants for the given product ids. Falls back to LEGACY mode if product_variants does not exist. */
export async function loadPricingCatalog(admin: SupabaseClient, productIds: string[]): Promise<PricingCatalog> {
  const { data: productRows, error: productErr } = await admin.from("products").select("*").in("id", productIds);
  if (productErr) throw productErr;
  const productsById = new Map<string, ProductRow>((productRows || []).map((p: ProductRow) => [p.id, p]));

  const { data: variantRows, error: variantErr } = await admin
    .from("product_variants").select(VARIANT_COLUMNS).in("product_id", productIds);
  if (variantErr) {
    if (isMissingRelation(variantErr)) return { productsById, variantsByProduct: undefined };
    throw variantErr;
  }
  return { productsById, variantsByProduct: groupVariants(variantRows) };
}

/** The whole catalog (WhatsApp paste / bulk order import match products by TEXT, so they need everything). */
export async function loadFullCatalog(admin: SupabaseClient): Promise<PricingCatalog & { products: ProductRow[] }> {
  const { data: productRows, error: productErr } = await admin.from("products").select("*");
  if (productErr) throw productErr;
  const products = (productRows || []) as ProductRow[];
  const productsById = new Map<string, ProductRow>(products.map((p) => [p.id, p]));

  const { data: variantRows, error: variantErr } = await admin.from("product_variants").select(VARIANT_COLUMNS);
  if (variantErr) {
    if (isMissingRelation(variantErr)) return { products, productsById, variantsByProduct: undefined };
    throw variantErr;
  }
  return { products, productsById, variantsByProduct: groupVariants(variantRows) };
}

/** Reads settings row id='shippingSettings'. Same defaults as the original (₹500 / ₹49). */
export async function getShippingConfig(admin: SupabaseClient): Promise<{ threshold: number; fee: number }> {
  let threshold = 500;
  let fee = 49;
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "shippingSettings").maybeSingle();
    if (!error && data?.data) {
      const sd = data.data;
      if (typeof sd.freeShippingThreshold === "number") threshold = sd.freeShippingThreshold;
      if (typeof sd.shippingCost === "number") fee = sd.shippingCost;
    }
  } catch (e) {
    console.warn("[pricing] shipping settings lookup failed, using defaults:", e);
  }
  return { threshold, fee };
}

/** Reads settings row id='invoiceSettings'.state — the seller's state for the GST split. */
export async function getSellerState(admin: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "invoiceSettings").maybeSingle();
    if (error || !data?.data) return "";
    return data.data.state || "";
  } catch (e) {
    console.warn("[pricing] seller state lookup failed:", e);
    return "";
  }
}

/** Reads profiles.address->>'state' for the given user — the buyer's state for the GST split. */
export async function getBuyerState(admin: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data, error } = await admin.from("profiles").select("address").eq("id", userId).maybeSingle();
    if (error || !data) return "";
    return data.address?.state || "";
  } catch (e) {
    console.warn("[pricing] buyer state lookup failed:", e);
    return "";
  }
}

/** Reads settings row id='paymentSettings'.codPayment. Defaults to enabled (matches the original). */
export async function isCodEnabled(admin: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await admin.from("settings").select("data").eq("id", "paymentSettings").maybeSingle();
    if (error || !data?.data) return true;
    return data.data.codPayment !== false;
  } catch (e) {
    console.warn("[pricing] payment settings lookup failed:", e);
    return true;
  }
}

export type PromoResult = { discount: number; appliedCode: string };

/**
 * Validates + resolves a promo code against `promo_codes`. Silently ignores
 * invalid/unknown/expired codes (amount stays 0), same as the original — the
 * client only ever sends a code string, never a discount amount.
 */
export async function resolvePromoDiscount(admin: SupabaseClient, promoCode: string | undefined, subtotal: number): Promise<PromoResult> {
  if (!promoCode || typeof promoCode !== "string" || !promoCode.trim()) {
    return { discount: 0, appliedCode: "" };
  }
  const code = promoCode.trim().toUpperCase();
  try {
    const { data: pd, error } = await admin.from("promo_codes").select("*").eq("code", code).maybeSingle();
    if (error || !pd) return { discount: 0, appliedCode: "" };

    if (isPromoExpired(pd.expiry_date)) return { discount: 0, appliedCode: "" };

    const value = Number(pd.value || 0);
    let discount = 0;
    if (pd.type === "percent") discount = Math.round((subtotal * value) / 100);
    else if (pd.type === "flat") discount = value;
    discount = Math.max(0, discount);
    return { discount, appliedCode: code };
  } catch (e) {
    console.warn("[pricing] promo lookup failed:", e);
    return { discount: 0, appliedCode: "" };
  }
}