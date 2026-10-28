import { useEffect, useState } from "react"
import { returnsService } from "../../services/returns"
import { RefundNotice } from "./RequestBits"
import { fmtDate } from "../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"

/**
 * What the customer needs to know about the MONEY of one order that is not part of a return / exchange request: why her order was cancelled and where the refund of
 * it stands (Phase 12), or a refund the shop made for her on its own (e.g. for an exchange that could not be completed). Shows exactly what is stored, never an
 * optimistic state. Renders nothing for an order without a cancellation or an order-level refund - and nothing at all while the server has no such records yet.
 */
const OrderRefundSection = ({ order }) => {
  const [state, setState] = useState({ loaded: false, cancellation: null, refunds: [] })
  const id = order?.id
  useEffect(() => {
    if (!id) return undefined
    let alive = true
    Promise.all([returnsService.cancellationForOrder(id).catch(() => null), returnsService.refundsForOrder(id).catch(() => [])])
      .then(([cancellation, refunds]) => { if (alive) setState({ loaded: true, cancellation, refunds }) })
    return () => { alive = false }
  }, [id])

  const { loaded, cancellation, refunds } = state
  if (!loaded || (!cancellation && refunds.length === 0)) return null
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "24px", marginTop: "24px" }}>
      <h2 style={{ fontWeight: 700, fontSize: "16px", marginBottom: "10px" }}>{cancellation ? "Order cancelled" : "Refund"}</h2>
      {cancellation ? (
        <p style={{ fontFamily: INTER, fontSize: "14px", color: "var(--color-ink)", marginBottom: refunds.length ? "12px" : 0 }}>
          This order was cancelled on {fmtDate(cancellation.cancelledAt)}. {cancellation.reason}
        </p>
      ) : null}
      <RefundNotice refunds={refunds} />
    </div>
  )
}

export default OrderRefundSection