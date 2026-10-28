/**
 * Promo-code helper. `promo_codes` has no client-select RLS policy (admin-only
 * — see 01-schema.sql), so we validate through the `promo-validate` Edge
 * Function, which returns only the resolved discount for this code +
 * subtotal. The authoritative discount is still recomputed in
 * `payment-create-order` at checkout.
 */
import { callFunction } from "./edgeFunctions"

/**
 * @param {string} code
 * @param {number} subtotal
 * @returns {Promise<{ code:string, type:"percent"|"flat", value:number, discount:number }>}
 * @throws {Error} with a user-friendly message on invalid/expired/failed codes
 */
export async function validatePromoCode(code, subtotal) {
  const { res, data } = await callFunction("promo-validate", { code, subtotal })
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Could not validate promo code.")
  }
  return data
}