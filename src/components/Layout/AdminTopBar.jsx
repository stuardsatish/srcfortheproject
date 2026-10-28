/**
 * AdminTopBar — shared top action bar used by all admin pages.
 * Renders: global search, live-orders pill, notification bell, + New button.
 * Matches the header pattern from all Pelago HTML designs.
 */
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useSelector } from "react-redux"

const TEAL   = "#104945"
const WHITE  = "#FFFFFF"
const BORDER = "#DCD5C9"
const CANVAS = "#EDE8E1"
const INK    = "#172220"
const MUTED  = "#78716C"
const FONT   = "'Plus Jakarta Sans','Inter',sans-serif"

const AdminTopBar = ({
  title,
  subtitle = "Online shop, studio shop and wholesale",
  actions, // array of { label, icon?, onClick, primary? }
  searchPlaceholder = "Search orders, products, customers...",
  onSearch,
  searchValue = "",
}) => {
  const navigate = useNavigate()
  const [query, setQuery] = useState(searchValue)

  const handleSearch = (e) => {
    setQuery(e.target.value)
    onSearch?.(e.target.value)
  }

  return (
    <div style={{ padding: "16px 24px 0", fontFamily: FONT }}>
      {/* ── Top utility row ───────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "12px", marginBottom: "14px", flexWrap: "wrap"
      }}>
        {/* Global search */}
        <div style={{ position: "relative", width: "320px", maxWidth: "100%" }}>
          <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#A8A29E", pointerEvents: "none" }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <input
            value={query}
            onChange={handleSearch}
            placeholder={searchPlaceholder}
            style={{
              width: "100%", height: "34px",
              background: "rgba(255,255,255,0.8)", border: `1px solid ${BORDER}`,
              borderRadius: "999px", padding: "0 36px 0 34px",
              fontSize: "12px", color: INK, fontFamily: FONT,
              outline: "none", transition: "all 0.15s",
            }}
            onFocus={e => { e.target.style.background = WHITE; e.target.style.boxShadow = `0 0 0 2px ${TEAL}33` }}
            onBlur={e => { e.target.style.background = "rgba(255,255,255,0.8)"; e.target.style.boxShadow = "none" }}
          />
          <kbd style={{
            position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
            fontSize: "9px", color: MUTED, background: "#F2EDE6",
            border: "1px solid #E0D8CE", borderRadius: "4px", padding: "1px 4px", fontFamily: FONT
          }}>⌘K</kbd>
        </div>

        {/* Right utilities */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Live orders pill */}
          <div style={{
            background: "rgba(255,255,255,0.9)", border: `1px solid ${BORDER}`,
            borderRadius: "999px", padding: "5px 12px",
            display: "flex", alignItems: "center", gap: "7px",
            fontSize: "12px", fontWeight: 600, color: INK,
          }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10B981", animation: "pulse 2s infinite" }} />
            <span id="adm-today-label">Live</span>
          </div>

          {/* Notification bell */}
          <button
            onClick={() => navigate("/notifications")}
            style={{
              width: "32px", height: "32px", borderRadius: "50%",
              background: "rgba(255,255,255,0.8)", border: `1px solid ${BORDER}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: MUTED, position: "relative",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = WHITE}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.8)"}
            title="Notifications"
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ position: "absolute", top: "6px", right: "6px", width: "6px", height: "6px", borderRadius: "50%", background: "#EF4444", boxShadow: "0 0 0 2px white" }} />
          </button>
        </div>
      </div>

      {/* ── Page title row ───────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
        <div>
          {subtitle && <p style={{ fontSize: "11px", color: MUTED, fontWeight: 500, marginBottom: "2px" }}>{subtitle}</p>}
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: INK, letterSpacing: "-0.5px", lineHeight: 1.1 }}>{title}</h1>
        </div>
        {/* Action buttons */}
        {actions && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={action.onClick}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "7px 14px", borderRadius: "8px",
                  background: action.primary ? TEAL : WHITE,
                  border: `1px solid ${action.primary ? TEAL : BORDER}`,
                  color: action.primary ? WHITE : INK,
                  fontSize: "12px", fontWeight: 700, cursor: "pointer",
                  fontFamily: FONT, transition: "opacity 0.15s",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                {action.icon && <span style={{ display: "flex" }}>{action.icon}</span>}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminTopBar
