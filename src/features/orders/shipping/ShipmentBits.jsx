import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { shipmentStatusMeta } from "../shipmentModel"
import { toneColors } from "./shipmentUi"

/** Coloured pill for a shipment status ("In transit", "Delivered", ...). */
export function ShipmentStatusChip({ status, label, small = false }) {
  const meta = shipmentStatusMeta(status)
  const c = toneColors(meta.tone)
  return (
    <span style={{ background: c.bg, color: c.fg, borderRadius: "9999px", padding: small ? "2px 8px" : "4px 10px", fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: small ? "11px" : "12px", letterSpacing: "0.3px", whiteSpace: "nowrap" }}>
      {label || meta.label}
    </span>
  )
}

/** Small "copy" button for a tracking number. Silent when the browser blocks the clipboard. */
export function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false)
  const copy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(String(text))
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {
      /* clipboard not available (insecure origin / permission): the number is still visible to select by hand */
    }
  }
  return (
    <button type="button" onClick={copy} aria-label={`${label} ${text}`} className="flex items-center" style={{ gap: "4px", color: "var(--color-body)", fontFamily: "'Inter', sans-serif", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
      {done ? <Check size={13} style={{ color: "var(--color-success)" }} /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </button>
  )
}