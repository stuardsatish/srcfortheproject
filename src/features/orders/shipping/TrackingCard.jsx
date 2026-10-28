import { useState } from "react"
import { AlertTriangle, Check, ExternalLink, Truck } from "lucide-react"
import { customerEvents, eventLabel, formatDay, shipmentStatusMeta, summarizeTracking, trackingSteps } from "../shipmentModel"
import { CopyButton, ShipmentStatusChip } from "./ShipmentBits"
import { fmtDate, fmtDateTime, toneColors } from "./shipmentUi"

const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

/**
 * Customer-facing "Track your order" card (order detail page).
 * Shows only what the customer may see: courier, tracking number / link, expected date and the courier's history - never charges or
 * staff notes (those columns are not readable for customers at all). Renders nothing for cancelled orders.
 */
const TrackingCard = ({ order }) => {
  const [showAll, setShowAll] = useState(false)
  const t = summarizeTracking(order)
  if (t.orderStatus === "cancelled") return null

  const steps = trackingSteps(order)
  const events = t.shipments.flatMap((s) => customerEvents(s).map((e) => ({ ...e, parcel: t.multiple ? s.trackingNumber || s.courierName : "" })))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
  const shown = showAll ? events : events.slice(0, 4)

  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "24px", marginTop: "24px" }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px", marginBottom: "20px" }}>
        <h2 className="flex items-center" style={{ gap: "8px", fontWeight: 700, fontSize: "16px" }}><Truck size={18} style={{ color: "var(--color-primary)" }} /> Track your order</h2>
        {t.hasShipments ? <ShipmentStatusChip status={t.status} label={t.multiple ? `${t.deliveredCount} of ${t.total} parcels delivered` : undefined} /> : null}
      </div>

      {/* 5-step progress */}
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: "4px" }}>
        {steps.map((s, i) => (
          <li key={s.key} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
            <div className="flex items-center" style={{ justifyContent: "center" }}>
              <span style={{ flex: 1, height: "3px", background: i === 0 ? "transparent" : s.done ? "var(--color-primary)" : "var(--color-border)" }} />
              <span style={{ width: "22px", height: "22px", borderRadius: "9999px", display: "flex", alignItems: "center", justifyContent: "center", background: s.warn ? "var(--color-accent-strong)" : s.done ? "var(--color-primary)" : "var(--color-border)", color: "var(--color-inverse)" }}>
                {s.done ? <Check size={13} /> : null}
              </span>
              <span style={{ flex: 1, height: "3px", background: i === steps.length - 1 ? "transparent" : steps[i + 1].done ? "var(--color-primary)" : "var(--color-border)" }} />
            </div>
            <p style={{ fontFamily: INTER, fontSize: "11px", fontWeight: s.current ? 700 : 500, color: s.done ? "var(--color-ink)" : "var(--color-muted)", marginTop: "6px" }}>{s.label}</p>
          </li>
        ))}
      </ol>

      {t.needsAttention ? (
        <p className="flex items-start" style={{ gap: "8px", marginTop: "18px", fontFamily: INTER, fontSize: "13px", color: "var(--color-accent-strong)", background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning-border)", borderRadius: "10px", padding: "10px 12px" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
          <span>{shipmentStatusMeta(t.status).label}. We will get in touch to arrange another attempt - or contact us if you have not heard from us.</span>
        </p>
      ) : null}

      {/* the parcel(s) */}
      {t.hasShipments ? (
        <div className="flex flex-col" style={{ gap: "12px", marginTop: "20px" }}>
          {t.shipments.map((s) => (
            <div key={s.id} style={{ border: "1px solid var(--color-border)", borderRadius: "10px", padding: "12px 14px" }}>
              <div className="flex items-center justify-between flex-wrap" style={{ gap: "8px" }}>
                <span style={{ fontFamily: INTER, fontWeight: 700, fontSize: "14px" }}>{s.courierName || "Courier"}</span>
                {t.multiple ? <ShipmentStatusChip status={s.status} small /> : null}
              </div>
              {s.trackingNumber ? (
                <div className="flex items-center flex-wrap" style={{ gap: "12px", marginTop: "4px" }}>
                  <span style={{ fontFamily: MONO, fontSize: "13px", wordBreak: "break-all" }}>{s.trackingNumber}</span>
                  <CopyButton text={s.trackingNumber} />
                  {s.trackingUrl ? (
                    <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center" style={{ gap: "4px", fontFamily: INTER, fontSize: "13px", fontWeight: 700, color: "var(--color-link)" }}>
                      Track on courier site <ExternalLink size={13} />
                    </a>
                  ) : null}
                </div>
              ) : null}
              <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)", marginTop: "6px" }}>
                {s.shippedAt ? `Shipped ${fmtDate(s.shippedAt)}` : ""}
                {s.status !== "delivered" && s.expectedDeliveryDate ? `${s.shippedAt ? " · " : ""}Expected by ${formatDay(s.expectedDeliveryDate)}` : ""}
                {s.status === "delivered" && s.deliveredAt ? ` · Delivered ${fmtDateTime(s.deliveredAt)}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontFamily: INTER, fontSize: "14px", color: "var(--color-body)", marginTop: "20px" }}>
          {t.legacyShipped
            ? "Your order has been shipped. The courier details were not recorded for this order - contact us if you need them."
            : t.orderStatus === "delivered"
              ? `Delivered${order.deliveredAt ? ` on ${fmtDate(order.deliveredAt)}` : ""}.`
              : "We will show the courier and tracking number here as soon as your order ships."}
        </p>
      )}

      {/* history */}
      {events.length ? (
        <div style={{ marginTop: "20px" }}>
          <p style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-body)", marginBottom: "10px" }}>Updates</p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((e, i) => {
              const c = toneColors(shipmentStatusMeta(e.type).tone)
              return (
                <li key={e.id || i} className="flex" style={{ gap: "10px", paddingBottom: "10px" }}>
                  <span style={{ width: "10px", height: "10px", borderRadius: "9999px", marginTop: "5px", flexShrink: 0, background: i === 0 ? c.fg : "var(--color-border-strong)" }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontFamily: INTER, fontWeight: 600, fontSize: "13px" }}>{eventLabel(e.type)}{e.parcel ? <span style={{ color: "var(--color-muted)", fontWeight: 500 }}> ({e.parcel})</span> : null}</p>
                    <p style={{ fontFamily: INTER, fontSize: "12px", color: "var(--color-body)" }}>
                      {fmtDateTime(e.occurredAt)}{e.location ? ` · ${e.location}` : ""}{e.description && e.description !== "Shipment created" && e.description !== eventLabel(e.type) ? ` · ${e.description}` : ""}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          {events.length > 4 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} style={{ fontFamily: INTER, fontWeight: 700, fontSize: "12px", color: "var(--color-link)", cursor: "pointer" }}>
              {showAll ? "Show fewer" : `Show all ${events.length} updates`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default TrackingCard