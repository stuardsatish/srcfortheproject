import { supabase } from "../../context/SupabaseConfig"
import { mapProductRows } from "../../utils/supabaseProducts"
import { upsertCartItem } from "../../utils/supabaseCart"
import { addCart } from "../../context/CartSlice"
import { buildBuyAgainPlan, describeBuyAgain } from "./buyAgainPlan"

/**
 * Re-adds the lines of a past order to the cart (same option, ordered quantity, CURRENT price and stock).
 * One implementation for the three places that offer "Buy again". Returns { added, skipped, message }.
 */
export async function buyAgain({ orderLines, cartItems, dispatch, uid }) {
  const ids = [...new Set((orderLines || []).map((l) => l.productId).filter(Boolean))]
  let productsById = new Map()
  if (ids.length) {
    const { data, error } = await supabase.from("products").select("*").in("id", ids)
    if (error) throw error
    productsById = new Map(mapProductRows(data).map((p) => [p.id, p]))
  }

  const plan = buildBuyAgainPlan(orderLines, productsById, cartItems)
  for (const a of plan.add) {
    dispatch(addCart({ ...a.payload, id: a.compoundId, compound_id: a.compoundId, qtyToAdd: a.quantity }))
    await upsertCartItem(uid, a.payload, a.nextTotal)
  }
  return { added: plan.add.length, skipped: plan.skipped, message: describeBuyAgain(plan) }
}