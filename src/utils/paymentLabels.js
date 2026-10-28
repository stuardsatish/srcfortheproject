/**
 * Human-friendly labels for an order's payment method + status.
 * Shared by the customer order views, the admin drawer, and the PDF invoice so
 * "COD" always reads the same way everywhere.
 */

/** e.g. "COD" -> "Cash on Delivery (COD)", "Razorpay" -> "Razorpay". */
export const paymentMethodLabel = (method) => {
  const m = String(method || "").toLowerCase()
  if (m === "cod") return "Cash on Delivery (COD)"
  if (m === "razorpay") return "Razorpay"
  if (m === "whatsapp") return "WhatsApp"
  return method || "N/A"
}

/**
 * e.g. pending + COD -> "Pending (Pay on Delivery)", pending -> "Pending",
 * paid -> "Paid". `method` is optional and only tweaks the pending wording.
 */
export const paymentStatusLabel = (status, method) => {
  const s = String(status || "").toLowerCase()
  const m = String(method || "").toLowerCase()
  if (s === "pending") {
    if (m === "cod") return "Pending (Pay on Delivery)"
    if (m === "whatsapp") return "Pending (WhatsApp)"
    return "Pending"
  }
  if (s === "paid") return "Paid"
  return status || "N/A"
}

/** True when the order is a Cash-on-Delivery order still awaiting payment. */
export const isCodPending = (order) =>
  String(order?.paymentMethod || "").toLowerCase() === "cod" &&
  String(order?.paymentStatus || "").toLowerCase() === "pending"

/**
 * True when the order was paid via COD or WhatsApp and payment is still
 * pending — i.e. the admin needs to manually collect / confirm cash or
 * WhatsApp payment and then mark it as paid.
 */
export const isPendingPayment = (order) => {
  const method = String(order?.paymentMethod || "").toLowerCase()
  const status = String(order?.paymentStatus || "").toLowerCase()
  return (method === "cod" || method === "whatsapp") && status === "pending"
}