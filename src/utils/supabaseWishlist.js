import { supabase } from "../context/SupabaseConfig"

export const addWishlistItem = async (uid, product) => {
  if (!uid) return
  const { error } = await supabase.from("wishlist_items").upsert(
    {
      user_id: uid,
      product_id: String(product.id),
      title: product.title || "",
      image: product.thumbnail || product.image || "",
      price: Number(product.price) || 0,
      category: product.category || "",
    },
    { onConflict: "user_id,product_id" }
  )
  if (error) console.error("Wishlist add error:", error)
}

export const removeWishlistItem = async (uid, productId) => {
  if (!uid) return
  const { error } = await supabase
    .from("wishlist_items")
    .delete()
    .eq("user_id", uid)
    .eq("product_id", String(productId))
  if (error) console.error("Wishlist remove error:", error)
}