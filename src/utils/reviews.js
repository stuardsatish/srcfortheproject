import { callFunction } from "./edgeFunctions"

/**
 * Submit a product review via the `reviews-create` Edge Function, which
 * verifies the user actually purchased the product in this order (client-side
 * review inserts are blocked — reviews has no insert RLS policy at all).
 * @param {{ orderId:string, productId:string, productTitle?:string, rating:number, comment?:string }} payload
 * @returns {Promise<{ reviewId:string }>}
 */
export async function submitReview({ orderId, productId, productTitle, rating, comment }) {
  const { res, data } = await callFunction("reviews-create", { orderId, productId, productTitle, rating, comment })
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Could not submit review.")
  }
  return data
}