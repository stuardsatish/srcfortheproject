// Maps a `products` row (snake_case) to the camelCase shape used throughout the app.
export const mapProductRow = (row) => {
  if (!row) return row
  return {
    id: row.id,
    productId: row.id,
    title: row.title || "",
    description: row.description || "",
    shortDescription: row.short_description || "",
    category: row.category || "",
    brand: row.brand || "",
    badge: row.badge || "",
    sku: row.sku || "",
    price: Number(row.price) || 0,
    priceType: row.price_type || "inclusive",
    discount: Number(row.discount) || 0,
    discountExpiry: row.discount_expiry || "",
    gstRate: Number(row.gst_rate) || 0,
    hsnCode: row.hsn_code || "",
    stock: Number(row.stock) || 0,
    maxStock: row.max_stock,
    image: row.image || "",
    thumbnail: row.thumbnail || row.image || "",
    gallery: row.gallery || [],
    rating: Number(row.rating) || 0,
    reviewCount: Number(row.review_count) || 0,
    status: row.status || "active",
    createdAt: row.created_at,
    // Variant / combination product fields
    hasVariants: Boolean(row.has_variants),
    // products.variants is a trigger-maintained CACHE of the ACTIVE rows of product_variants
    // ([{id,name,price,stock,sku,image}]) — enough for the storefront. The admin pages read the real table.
    variants: Array.isArray(row.variants) ? row.variants : [],
    attributes: Array.isArray(row.attributes) ? row.attributes : [],

    // ── Purchasable-option model (migration 20261014_01). Defaults keep pre-migration rows behaving as before.
    // May the MAIN product itself be bought when it also has variants? (always true for a single product)
    mainOptionEnabled: row.main_option_enabled !== false,
    trackInventory: row.track_inventory !== false,
    tags: Array.isArray(row.tags) ? row.tags : [],
    importKey: row.import_key || "",
    // Return / exchange policy of the main (or only) option. null window = that policy is OFF.
    returnEnabled: row.return_enabled !== false,
    returnWindowDays: row.return_window_days ?? null,
    exchangeEnabled: row.exchange_enabled !== false,
    exchangeWindowDays: row.exchange_window_days ?? null,
    // Raw timestamptz string, deliberately NOT converted: it is handed back to save_product as the
    // optimistic-concurrency token ("someone else edited this product").
    updatedAt: row.updated_at || null,
  }
}

// Maps a `product_variants` row (admin reads the real table; shoppers read the cache above).
export const mapVariantRow = (row) => {
  if (!row) return row
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name || "",
    sku: row.sku || "",
    price: Number(row.price) || 0,
    stock: Number(row.stock) || 0,
    trackInventory: row.track_inventory !== false,
    image: row.image || "",
    gallery: Array.isArray(row.gallery) ? row.gallery : [],
    attributes: row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes) ? row.attributes : {},
    status: row.status === "inactive" ? "inactive" : "active",
    sortOrder: Number(row.sort_order) || 0,
    // null = inherit the product's policy
    returnEnabled: row.return_enabled ?? null,
    returnWindowDays: row.return_window_days ?? null,
    exchangeEnabled: row.exchange_enabled ?? null,
    exchangeWindowDays: row.exchange_window_days ?? null,
    importKey: row.import_key || "",
  }
}

export const mapVariantRows = (rows) => (rows || []).map(mapVariantRow)

export const mapProductRows = (rows) => (rows || []).map(mapProductRow)