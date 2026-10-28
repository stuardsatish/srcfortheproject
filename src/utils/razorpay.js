/**
 * Razorpay client helpers.
 *
 * Requests go to the Supabase Edge Functions
 * (`payment-create-order` / `payment-verify`), authenticated with the
 * current Supabase session's access token — see src/utils/edgeFunctions.js.
 */
import { callFunction } from "./edgeFunctions"

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js"

/**
 * Inject the Razorpay Checkout script; resolves true when ready.
 * If the first load fails (e.g. a corrupt browser disk cache →
 * ERR_CACHE_READ_FAILURE), it removes the dead tag and retries once with a
 * cache-busting query so a bad cache entry can't permanently break checkout.
 */
export function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true)

    const inject = (src, isRetry) => {
      // Clear any prior (possibly failed) tag so the retry is clean.
      const prev = document.querySelector('script[data-razorpay="1"]')
      if (prev) prev.remove()

      const script = document.createElement("script")
      script.src = src
      script.async = true
      script.dataset.razorpay = "1"
      script.onload = () => resolve(true)
      script.onerror = () => {
        if (!isRetry) inject(`${CHECKOUT_SRC}?cb=${Date.now()}`, true) // bypass the cache
        else resolve(false)
      }
      document.body.appendChild(script)
    }

    inject(CHECKOUT_SRC, false)
  })
}

/**
 * Create a Razorpay order on the backend. The client sends only the cart's
 * { productId, quantity } pairs plus an optional promoCode string (the server
 * prices from the catalog and validates the code — never a client-supplied amount).
 * @param {{ items: Array<{productId:string, quantity:number}>, promoCode?: string }} params
 * @returns {Promise<{orderId:string, amount:number, currency:string, subtotal:number, shipping:number, promoDiscount:number, total:number, keyId:string}>}
 */
export async function createRazorpayOrder({ items, promoCode }) {
  const { res, data } = await callFunction("payment-create-order", { items, promoCode: promoCode || "" })
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Could not start payment. Please try again.")
  }
  return data
}

/**
 * Place a Cash-on-Delivery order on the backend. Like createRazorpayOrder, the
 * client sends only { productId, quantity } pairs + an optional promoCode; the
 * server prices from the catalog, validates the delivery address & stock, and
 * writes the order with paymentMethod:"COD", paymentStatus:"pending".
 * @param {{ items: Array<{productId:string, quantity:number}>, promoCode?: string }} params
 * @returns {Promise<{ success:boolean, orderId:string }>}
 */
export async function createCodOrder({ items, promoCode }) {
  const { res, data } = await callFunction("payment-cod-create", { items, promoCode: promoCode || "" })
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Could not place your COD order. Please try again.")
  }
  return data
}

/**
 * Verify a completed payment's signature on the backend.
 * @param {{razorpay_order_id:string, razorpay_payment_id:string, razorpay_signature:string}} payload
 */
export async function verifyRazorpayPayment(payload) {
  const { res, data } = await callFunction("payment-verify", payload)
  if (!res.ok || !data.verified) {
    throw new Error(data.error || "Payment could not be verified.")
  }
  return data
}