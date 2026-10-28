// Website-only presentation helpers for the shipping screens (the RN app has its own className mapping).
// The data rules live in ../shipmentModel.js; nothing here talks to the server.

/** tone (from shipmentModel.shipmentStatusMeta) -> chip colours, as CSS variables of the website theme */
const TONES = {
  info: { bg: "var(--color-info-subtle)", fg: "var(--color-info)" },
  accent: { bg: "var(--color-accent-subtle)", fg: "var(--color-accent-strong)" },
  success: { bg: "var(--color-success-subtle)", fg: "var(--color-success)" },
  warning: { bg: "var(--color-warning-subtle)", fg: "var(--color-accent-strong)" },
  danger: { bg: "var(--color-error-subtle)", fg: "var(--color-error)" },
  neutral: { bg: "var(--color-surface-muted)", fg: "var(--color-body)" },
}
export const toneColors = (tone) => TONES[tone] || TONES.neutral

const toDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
/** "17 Oct 2026, 3:05 pm" (the admin and the customer read the same wording) */
export const fmtDateTime = (v) => {
  const d = toDate(v)
  return d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"
}
export const fmtDate = (v) => {
  const d = toDate(v)
  return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"
}
export const formatINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** value for <input type="datetime-local"> in the browser's own time zone */
export const toLocalInputValue = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export const INPUT_STYLE = { width: "100%", height: "40px", padding: "0 12px", border: "1px solid var(--color-border)", borderRadius: "8px", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "'Inter', sans-serif", fontSize: "14px" }
export const LABEL_STYLE = { display: "block", fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: "12px", letterSpacing: "0.4px", color: "var(--color-body)", marginBottom: "4px" }
export const ERROR_STYLE = { fontFamily: "'Inter', sans-serif", fontSize: "12px", color: "var(--color-error)", marginTop: "4px" }
export const HINT_STYLE = { fontFamily: "'Inter', sans-serif", fontSize: "12px", color: "var(--color-muted)", marginTop: "4px" }
export const PRIMARY_BTN = { background: "var(--color-primary)", color: "var(--color-inverse)", borderRadius: "10px", height: "40px", padding: "0 18px", fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: "14px", cursor: "pointer" }
export const GHOST_BTN = { background: "var(--color-surface-muted)", color: "var(--color-ink)", borderRadius: "10px", height: "40px", padding: "0 16px", fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: "14px", cursor: "pointer" }