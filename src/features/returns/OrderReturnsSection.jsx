import { useCallback, useEffect, useState } from "react"
import { RotateCcw } from "lucide-react"
import { returnsService } from "../../services/returns"
import { anyEligible, describeEligibility } from "./requestModel"
import ReturnRequestModal from "./ReturnRequestModal"
import RequestCard from "./RequestCard"
import { GHOST_BTN, PRIMARY_BTN } from "../orders/shipping/shipmentUi"

const INTER = "'Inter', sans-serif"

/**
 * "Returns & exchanges" of the order-detail page: which lines can be returned / exchanged right now (the server decides, this only shows
 * its answer), the buttons to start a request, and every request already made for this order with its status. Renders nothing when the
 * server has no returns feature yet, or when the order was never delivered and has no request.
 */
const OrderReturnsSection = ({ order, user }) => {
  const [state, setState] = useState({ loading: true, eligibility: null, reasons: [], requests: [], refunds: [], replacements: {}, error: "" })
  const [modal, setModal] = useState(null)         // { type, itemId }
  const delivered = String(order?.orderStatus || "").toLowerCase() === "delivered"

  const load = useCallback(async () => {
    try {
      const [eligibility, reasons, requests] = await Promise.all([
        delivered ? returnsService.eligibility(order.id) : Promise.resolve(null),
        returnsService.reasons(),
        returnsService.listForOrder(order.id),
      ])
      // the refunds and the replacements are a convenience on top of the requests: a failure to read them must not hide the requests themselves
      const ids = requests.map((r) => r.id)
      const [refunds, replacements] = await Promise.all([
        returnsService.refundsForRequests(ids).catch(() => []),
        returnsService.replacementsFor(requests.filter((r) => r.type === "exchange").map((r) => r.id)).catch(() => ({})),
      ])
      setState({ loading: false, eligibility, reasons, requests, refunds, replacements, error: "" })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message || "Could not load your return options" }))
    }
  }, [order?.id, delivered])
  useEffect(() => { load() }, [load])

  const { loading, eligibility, reasons, requests, refunds, replacements, error } = state
  if (loading) return null
  if (!eligibility && requests.length === 0 && !error) return null

  const canReturn = anyEligible(eligibility, "return")
  const canExchange = anyEligible(eligibility, "exchange")
  const items = eligibility?.items || []
  const open = (type, itemId = null) => setModal({ type, itemId })

  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "24px", marginTop: "24px" }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: "10px", marginBottom: "14px" }}>
        <h2 className="flex items-center" style={{ gap: "8px", fontWeight: 700, fontSize: "16px" }}><RotateCcw size={18} style={{ color: "var(--color-primary)" }} /> Returns &amp; exchanges</h2>
        {canReturn || canExchange ? (
          <div className="flex flex-wrap" style={{ gap: "8px" }}>
            {canReturn ? <button type="button" onClick={() => open("return")} style={PRIMARY_BTN}>Return items</button> : null}
            {canExchange ? <button type="button" onClick={() => open("exchange")} style={GHOST_BTN}>Exchange items</button> : null}
          </div>
        ) : null}
      </div>

      {error ? <p style={{ fontFamily: INTER, fontSize: "13px", color: "var(--color-error)" }}>{error}</p> : null}

      {eligibility ? (
        <div className="flex flex-col" style={{ gap: "6px", marginBottom: requests.length ? "16px" : 0 }}>
          {items.map((line) => {
            const r = describeEligibility(line.return, "return")
            const x = describeEligibility(line.exchange, "exchange")
            return (
              <div key={line.order_item_id} className="flex items-center justify-between flex-wrap" style={{ gap: "8px", borderTop: "1px solid var(--color-info-subtle)", paddingTop: "8px" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "14px" }}>{line.title}{line.variant_name ? ` · ${line.variant_name}` : ""} <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>x{line.quantity}</span></p>
                  <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>{`Return: ${r.hint}`}{" · "}{`Exchange: ${x.hint}`}</p>
                </div>
                <div className="flex" style={{ gap: "6px" }}>
                  {r.eligible ? <button type="button" onClick={() => open("return", line.order_item_id)} style={{ ...GHOST_BTN, height: "34px", fontSize: "13px" }}>Return</button> : null}
                  {x.eligible ? <button type="button" onClick={() => open("exchange", line.order_item_id)} style={{ ...GHOST_BTN, height: "34px", fontSize: "13px" }}>Exchange</button> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {requests.length ? (
        <div className="flex flex-col" style={{ gap: "10px" }}>
          {requests.map((r) => <RequestCard key={r.id} request={r} order={order} refunds={refunds.filter((f) => f.requestId === r.id)} replacement={replacements[r.id] || null} user={user} onChanged={load} />)}
        </div>
      ) : null}

      {modal ? (
        <ReturnRequestModal
          key={`${modal.type}-${modal.itemId || "all"}`}
          order={order} eligibility={eligibility} reasons={reasons} user={user}
          initialType={modal.type} initialItemId={modal.itemId}
          onClose={() => { setModal(null); load() }}
        />
      ) : null}
    </div>
  )
}

export default OrderReturnsSection