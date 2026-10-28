import { formatDay, summarizeTracking } from "../shipmentModel"
import { ShipmentStatusChip } from "./ShipmentBits"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

/**
 * One compact block for an order card of the admin "Shipped" tab: the real courier status instead of a made-up ETA.
 * With no shipment row (an order shipped before tracking existed) it says so instead of inventing anything.
 */
const ShipmentMini = ({ order }) => {
  const t = summarizeTracking(order)
  if (!t.hasShipments) {
    return (
      <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
        Shipped &middot; no courier or tracking number recorded. Open the order to add it.
      </p>
    )
  }
  return (
    <div className="flex flex-col" style={{ gap: "6px" }}>
      <div className="flex items-center justify-between" style={{ gap: "8px" }}>
        <ShipmentStatusChip status={t.status} label={t.multiple ? `${t.deliveredCount}/${t.total} parcels delivered` : undefined} />
        {t.expectedDeliveryDate ? <span style={{ fontFamily: MONO, fontSize: "12px", color: "var(--color-body)" }}>Expected {formatDay(t.expectedDeliveryDate)}</span> : null}
      </div>
      <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", wordBreak: "break-word" }}>
        {t.courierName || "Courier not recorded"}
        {t.trackingNumber ? <> &middot; <span style={{ fontFamily: MONO, color: "var(--color-ink)" }}>{t.trackingNumber}</span></> : null}
      </p>
      {t.needsAttention ? <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-accent-strong)" }}>Needs attention: delivery problem reported</p> : null}
    </div>
  )
}

export default ShipmentMini