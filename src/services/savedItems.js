// Save-for-later service for the web app (roadmap task 5.2 + 5.5 [Web]).
// Backed by `public.saved_items` (20261008_03_cart_enhancements.sql, applied).
// Mirrors Ecommerce-app/src/services/savedItems.js with web-specific field names.
import { supabase } from "../context/SupabaseConfig";
import { upsertCartItem } from "../utils/supabaseCart";
import { mapProductRow } from "../utils/supabaseProducts";
import { optionForVariantId, isAvailable } from "../features/products/purchaseOptions";
import { savedItemRow } from "./savedItemRow";

const MISSING_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);
let warnedMissing = false;

function isMissing(err) {
  return (
    MISSING_CODES.has(err?.code) ||
    String(err?.message || "").toLowerCase().includes("schema cache")
  );
}
function warnOnce(err) {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn("[savedItems] save-for-later backend not available; hiding section.", err?.message || "");
}

/**
 * DB row → camelCase item matching the web app's cart item shape.
 * The id follows the CART convention: `${productId}_${variantId}` (variant ids already start with "var_", so the
 * old `_var_${variantId}` produced "P_var_var_x", which never matched the cart's "P_var_x").
 */
function fromRow(row) {
  const cartId = row.product_id + (row.variant_id ? `_${row.variant_id}` : "");
  return {
    id: cartId,
    compound_id: cartId,
    productId: row.product_id,
    variant_id: row.variant_id || "",
    variant_name: row.variant_name || "",
    selected_variant: row.selected_variant || null,
    quantity: row.quantity,
    title: row.title || "",
    image: row.image || "",
    thumbnail: row.image || "",
    category: row.category || "",
    price: row.price,
    discount: row.discount,
    discountExpiry: row.discount_expiry,
    savedAt: row.saved_at,
  };
}

/** Load all saved items for the signed-in user. Returns [] gracefully if backend missing. */
export async function listSavedItems() {
  const { data, error } = await supabase
    .from("saved_items")
    .select("*")
    .order("saved_at", { ascending: false });
  if (error) {
    if (isMissing(error)) { warnOnce(error); return []; }
    throw new Error(error.message || "Could not load saved items.");
  }
  return (data || []).map(fromRow);
}

/**
 * Move a cart item to saved-for-later.
 * @param {object} cartItem  — the Redux cart item
 * @param {string} uid       — auth user id
 * @param {function} deleteCartFn — (item) => void, Redux + DB removal
 */
export async function saveForLater(cartItem, uid, deleteCartFn) {
  // The row must carry user_id (no column default; RLS is user_id = auth.uid()) - see savedItemRow.js.
  const owner = uid || (await supabase.auth.getSession()).data?.session?.user?.id;
  const row = savedItemRow(cartItem, owner);

  const { error } = await supabase.from("saved_items").upsert(row, {
    onConflict: "user_id,product_id,variant_id",
    ignoreDuplicates: false,
  });
  if (error) {
    if (isMissing(error)) { warnOnce(error); throw new Error("Save for later isn't available right now."); }
    throw new Error(error.message || "Could not save item for later.");
  }

  // Remove from cart
  deleteCartFn(cartItem);
}

/**
 * Move a saved item back to the cart. Clamps to live stock.
 * @returns {{ clamped: boolean, clampedTo?: number }}
 */
export async function moveSavedToCart(savedItem, uid) {
  // Fetch the live product and resolve THE OPTION that was saved (main product or that specific variant): its own
  // price and stock apply — the old code clamped a variant to the PARENT's stock and priced it at the parent's price.
  const { data: row } = await supabase
    .from("products")
    .select("*")
    .eq("id", savedItem.productId)
    .maybeSingle();
  const product = row ? mapProductRow(row) : null;

  let option = null;
  if (product) {
    option = optionForVariantId(product, savedItem.variant_id || "");
    if (!option) throw new Error(`${savedItem.title || "This item"} is no longer available.`);
    if (!isAvailable(option)) throw new Error(`${savedItem.title || "This item"} is out of stock.`);
  }

  // stock === null means "not tracked" (always available)
  const liveStock = option && option.stock !== null ? Number(option.stock) : null;
  const qty = liveStock !== null ? Math.min(savedItem.quantity, liveStock) : savedItem.quantity;

  await upsertCartItem(uid, {
    productId: savedItem.productId,
    variantId: savedItem.variant_id,
    variant_name: option ? option.name : savedItem.variant_name,
    selected_variant: option ? option.variant : savedItem.selected_variant,
    title: savedItem.title,
    image: (option && option.image) || savedItem.image || savedItem.thumbnail,
    category: savedItem.category,
    // The cart row stores the option's LIST price plus the product-level discount separately (exactly like the product
    // page does). The old code wrote an already-discounted price AND the discount, i.e. discounted twice.
    price: option ? option.price : savedItem.price,
    discount: product ? product.discount : savedItem.discount,
    discountExpiry: product ? (product.discountExpiry || null) : savedItem.discountExpiry,
  }, qty);

  // Remove from saved_items
  const { error } = await supabase
    .from("saved_items")
    .delete()
    .eq("product_id", savedItem.productId)
    .eq("variant_id", savedItem.variant_id);
  if (error && !isMissing(error)) throw new Error(error.message || "Could not move item to cart.");

  return { clamped: liveStock !== null && qty < savedItem.quantity, clampedTo: qty };
}

/** Remove a saved item without adding to cart. */
export async function removeSavedItem(savedItem) {
  const { error } = await supabase
    .from("saved_items")
    .delete()
    .eq("product_id", savedItem.productId)
    .eq("variant_id", savedItem.variant_id);
  if (error && !isMissing(error)) throw new Error(error.message || "Could not remove saved item.");
}

/** List available (listed, non-expired) coupons via the RPC. */
export async function listAvailableCoupons() {
  const { data, error } = await supabase.rpc("list_available_coupons");
  if (error) {
    if (isMissing(error)) { warnOnce(error); return []; }
    throw new Error(error.message || "Could not load coupons.");
  }
  return data || [];
}

/**
 * Human-readable coupon description.
 * { code, type:'percent'|'flat', value, expiry_date }
 */
export function describeCoupon(coupon) {
  if (!coupon) return "";
  const val = coupon.type === "percent" ? `${coupon.value}% off` : `\u20b9${coupon.value} off`;
  const expiry = coupon.expiry_date
    ? ` \u00b7 Valid till ${new Date(coupon.expiry_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
    : "";
  return `${val}${expiry}`;
}