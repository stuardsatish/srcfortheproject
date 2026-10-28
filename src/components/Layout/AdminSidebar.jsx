import { useState, useCallback, memo } from "react"
import { NavLink, useNavigate, useLocation } from "react-router-dom"
import { useDispatch, useSelector } from "react-redux"
import { supabase } from "../../context/SupabaseConfig"
import { clearUser } from "../../context/UserSlice"
import { broadcastAuth, clearSession } from "../../utils/sessionUtils"
import { clearLocalSession } from "../../utils/sessionManager"

/* ─── Brand colour tokens (matching the new Pelago HTML designs) ─── */
const TEAL      = "#104945"
const TEAL_DARK = "#0c3936"
const TEAL_BG   = "#E8F3F1"
const CANVAS    = "#EDE8E1"
const BORDER    = "#E2DBD0"
const MUTED     = "#78716C"
const INK       = "#1C1917"
const WHITE     = "#FFFFFF"

/* ─── Icon SVGs (inline so no extra icon library dependency) ─── */
const Icon = ({ d, d2, className = "w-4 h-4" }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    {d2 && <path d={d2} strokeLinecap="round" strokeLinejoin="round" />}
  </svg>
)

const ICONS = {
  overview:   "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  orders:     "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  chevDown:   "M19 9l-7 7-7-7",
  chevRight:  "M9 5l7 7-7 7",
  products:   "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z",
  customers:  "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
  billing:    "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
  whatsapp:   "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  optimize:   "M13 10V3L4 14h7v7l9-11h-7z",
  inventory:  "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  discount:   "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
  upload:     "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
  logout:     "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  settings:   "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4",
  returns:    "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  analytics:  "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
}

/* ─── Sidebar link styles ─── */
const linkBase = {
  display: "flex", alignItems: "center", gap: "9px",
  padding: "7px 10px", borderRadius: "10px",
  fontSize: "12.5px", fontWeight: 500,
  color: MUTED, textDecoration: "none",
  transition: "background 0.15s, color 0.15s",
  cursor: "pointer",
}
const linkActive = {
  background: TEAL_BG, color: TEAL, fontWeight: 700,
}
const subLinkBase = {
  display: "flex", alignItems: "center", gap: "8px",
  padding: "5px 10px 5px 28px", borderRadius: "8px",
  fontSize: "12px", fontWeight: 500,
  color: MUTED, textDecoration: "none",
  transition: "background 0.15s, color 0.15s",
  cursor: "pointer",
}
const subLinkActive = {
  color: TEAL, fontWeight: 700,
}

/* ─── NavItem component ─── */
function NavItem({ icon, label, to, badge, exact = false }) {
  const location = useLocation()
  const isActive = exact ? location.pathname === to : location.pathname.startsWith(to)

  return (
    <NavLink
      to={to}
      style={isActive ? { ...linkBase, ...linkActive } : linkBase}
      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "#F5F2EE"; e.currentTarget.style.color = INK } }}
      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = MUTED } }}
    >
      <Icon d={ICONS[icon]} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && (
        <span style={{ background: isActive ? TEAL : "#F0ECE8", color: isActive ? WHITE : "#78716C", fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "9999px" }}>
          {badge}
        </span>
      )}
    </NavLink>
  )
}

/* ─── Collapsible group ─── */
function NavGroup({ icon, label, children, isOpen, onToggle, matchPaths = [], defaultTo }) {
  const location = useLocation()
  const navigate = useNavigate()
  const anyActive = matchPaths.some(p => location.pathname.startsWith(p))

  const handleRowClick = () => {
    if (defaultTo) {
      navigate(defaultTo)
      if (!isOpen && onToggle) {
        onToggle(true)
      }
    } else if (onToggle) {
      onToggle()
    }
  }

  const handleChevronClick = (e) => {
    e.stopPropagation()
    if (onToggle) onToggle()
  }

  return (
    <div>
      <div
        onClick={handleRowClick}
        style={{
          ...linkBase,
          width: "100%", border: "none", background: anyActive ? TEAL_BG : "transparent",
          color: anyActive ? TEAL : MUTED, fontWeight: anyActive ? 700 : 500,
        }}
        onMouseEnter={e => { if (!anyActive) { e.currentTarget.style.background = "#F5F2EE"; e.currentTarget.style.color = INK } }}
        onMouseLeave={e => { if (!anyActive) { e.currentTarget.style.background = anyActive ? TEAL_BG : "transparent"; e.currentTarget.style.color = anyActive ? TEAL : MUTED } }}
        role="button"
        tabIndex={0}
      >
        <Icon d={ICONS[icon]} />
        <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
        <span
          onClick={handleChevronClick}
          style={{ display: "inline-flex", alignItems: "center", padding: "2px 4px", cursor: "pointer" }}
          title={isOpen ? "Collapse" : "Expand"}
        >
          <Icon d={isOpen ? ICONS.chevDown : ICONS.chevRight} className="w-3 h-3" />
        </span>
      </div>
      {isOpen && (
        <div style={{ marginTop: "2px", display: "flex", flexDirection: "column", gap: "1px" }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* ─── Sub-link ─── */
function SubNavItem({ label, to, dot }) {
  const location = useLocation()
  const currentUrl = location.pathname + (location.search || "")
  const isDefaultView =
    (!location.search || location.search === "") &&
    ((to.endsWith("?view=everyone") && location.pathname === "/admin/users") ||
     (to.endsWith("?view=catalog") && location.pathname === "/admin/add-product") ||
     (to.endsWith("?view=pack") && location.pathname === "/admin/myorders"))

  const isActive = to.includes("?")
    ? (currentUrl === to || isDefaultView)
    : location.pathname === to

  return (
    <NavLink
      to={to}
      style={isActive ? { ...subLinkBase, ...subLinkActive } : subLinkBase}
      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = INK } }}
      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = MUTED } }}
    >
      {dot && isActive && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: TEAL, display: "inline-block", flexShrink: 0 }} />}
      {!(dot && isActive) && <span style={{ width: "6px", height: "6px", display: "inline-block", flexShrink: 0 }} />}
      {label}
    </NavLink>
  )
}

/* ─── Section label ─── */
const SectionLabel = ({ children }) => (
  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A8A29E", padding: "0 10px", marginBottom: "4px", marginTop: "4px" }}>
    {children}
  </div>
)

/* ════════════════════════════════════════════════════════════════
   MAIN SIDEBAR
════════════════════════════════════════════════════════════════ */
const AdminSidebar = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const user = useSelector(state => state.user.user)

  const [ordersOpen, setOrdersOpen] = useState(() => location.pathname.startsWith("/admin/myorders") || location.pathname.startsWith("/admin/returns"))
  const [productsOpen, setProductsOpen] = useState(() => location.pathname.startsWith("/admin/add-product") || location.pathname.startsWith("/admin/edit-product"))
  const [customersOpen, setCustomersOpen] = useState(() => location.pathname.startsWith("/admin/users"))

  // Initials from name
  const name = user?.name || user?.email || "Admin"
  const initials = name.trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase() || "AD"

  const handleLogout = useCallback(async () => {
    try {
      if (user?.uid) {
        try {
          await supabase.from("profiles").update({ active_session_id: null }).eq("id", user.uid)
        } catch (e) {
          console.log("Could not clear active session:", e)
        }
      }
      clearLocalSession()
      await supabase.auth.signOut()
      dispatch(clearUser())
      clearSession()
      broadcastAuth("logout")
      navigate("/login")
    } catch (error) {
      console.error("Logout Error:", error)
    }
  }, [dispatch, navigate, user])

  return (
    <aside
      style={{
        width: "220px",
        minWidth: "220px",
        background: WHITE,
        borderRadius: "20px",
        border: `1px solid ${BORDER}`,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "16px 12px",
        height: "calc(100vh - 24px)",
        position: "sticky",
        top: "12px",
        overflow: "hidden",
        flexShrink: 0,
        userSelect: "none",
        fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
      }}
    >
      {/* Top section */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0", overflowY: "auto", flex: 1, paddingRight: "2px" }}>
        {/* Brand identity */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "4px 6px 16px" }}>
          <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: TEAL, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: WHITE, width: "18px", height: "18px" }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 16.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: "13px", color: INK, letterSpacing: "-0.3px" }}>Pelago</div>
            <div style={{ fontSize: "11px", color: MUTED, fontWeight: 500 }}>{user?.name ? user.name.split(" ")[0] + "'s Store" : "Admin Store"}</div>
          </div>
        </div>

        {/* ── SELL section ── */}
        <SectionLabel>Sell</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "12px" }}>
          <NavItem icon="overview" label="Overview" to="/admin/dashboard" exact />

          {/* Orders collapsible */}
          <NavGroup
            icon="orders" label="Orders"
            isOpen={ordersOpen} onToggle={(force) => setOrdersOpen(v => typeof force === 'boolean' ? force : !v)}
            matchPaths={["/admin/myorders", "/admin/returns"]}
            defaultTo="/admin/myorders?view=pack"
          >
            <SubNavItem label="To Pack & Ship" to="/admin/myorders?view=pack" dot />
            <SubNavItem label="All Orders" to="/admin/myorders?view=all" dot />
            <SubNavItem label="Returns" to="/admin/myorders?view=returns" dot />
          </NavGroup>

          {/* Products collapsible */}
          <NavGroup
            icon="products" label="Products"
            isOpen={productsOpen} onToggle={(force) => setProductsOpen(v => typeof force === 'boolean' ? force : !v)}
            matchPaths={["/admin/add-product", "/admin/edit-product"]}
            defaultTo="/admin/add-product?view=catalog"
          >
            <SubNavItem label="Catalog" to="/admin/add-product?view=catalog" dot />
            <SubNavItem label="Analytics" to="/admin/add-product?view=analytics" dot />
          </NavGroup>

          {/* Customers collapsible */}
          <NavGroup
            icon="customers" label="Customers"
            isOpen={customersOpen} onToggle={(force) => setCustomersOpen(v => typeof force === 'boolean' ? force : !v)}
            matchPaths={["/admin/users"]}
            defaultTo="/admin/users?view=everyone"
          >
            <SubNavItem label="Everyone" to="/admin/users?view=everyone" dot />
            <SubNavItem label="Analytics" to="/admin/users?view=analytics" dot />
          </NavGroup>
        </div>

        {/* ── GROW section ── */}
        <SectionLabel>Grow</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "12px" }}>
          <NavItem icon="billing"   label="Billing"         to="/admin/billing" />
          <NavItem icon="whatsapp"  label="WhatsApp Order"  to="/admin/createOrders" />
          <NavItem icon="optimize"  label="Optimization"    to="/admin/optimization" />
          <NavItem icon="inventory" label="Inventory"       to="/admin/inventory" />
          <NavItem icon="discount"  label="Discounts"       to="/admin/add-discount" />
          <NavItem icon="upload"    label="Upload Orders"   to="/admin/adminUploadOrders" />
        </div>
      </div>

      {/* Bottom: User profile + Logout */}
      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {/* User row */}
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "4px 6px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: TEAL, color: WHITE, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 800, flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: INK, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.name || "Admin"}
            </div>
            <div style={{ fontSize: "10px", color: MUTED, fontWeight: 500, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.email || ""}
            </div>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          style={{
            display: "flex", alignItems: "center", gap: "9px",
            padding: "7px 10px", borderRadius: "10px",
            fontSize: "12.5px", fontWeight: 600,
            color: "#DC2626", background: "transparent", border: "none",
            width: "100%", cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "#FEF2F2" }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
        >
          <Icon d={ICONS.logout} />
          Logout
        </button>
      </div>
    </aside>
  )
}

export default memo(AdminSidebar)
