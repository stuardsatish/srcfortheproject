import { useEffect, useState, useRef, useMemo } from "react"
import { supabase } from "../../context/SupabaseConfig"
import { toast } from "react-toastify"
import {
  Users,
  UserPlus,
  Shield,
  Zap,
  Search,
  Filter,
  CircleDot,
  Calendar,
  AlignLeft,
  Upload,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  X,
  Mail,
  MessageSquare,
  Phone,
  Info,
  KeyRound,
  Ban,
  Check,
} from "lucide-react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

/* ============================== CONSTANTS ============================== */
const ITEMS_PER_PAGE = 10
const INTER = "'Inter', sans-serif"
const MONO = "'JetBrains Mono', 'Liberation Mono', monospace"

// const ROLE_OPTIONS = ["all", "admin", "user", "strategist", "director", "operator"]
const ROLE_OPTIONS = ["all", "admin", "user"]
const STATUS_OPTIONS = ["all", "active", "pending", "suspended", "inactive"]
const SORT_OPTIONS = [
  { key: "createdAt", label: "Newest First" },
  { key: "oldest", label: "Oldest First" },
  { key: "name", label: "Name (A–Z)" },
  { key: "role", label: "Role" },
]

/* ============================== HELPERS ============================== */
const toDate = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}
const fmtDate = (v) => {
  const d = toDate(v)
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—"
}
const relativeTime = (v) => {
  const d = toDate(v)
  if (!d) return "Never"
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins} min${mins > 1 ? "s" : ""} ago`
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
}
const initials = (name) =>
  String(name || "?").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?"

const GRADIENTS = [
  ["var(--color-primary)", "var(--color-accent)"],
  ["var(--color-info)", "var(--color-info-border)"],
  ["var(--color-chart-6)", "color-mix(in srgb, var(--color-chart-6) 55%, white)"],
  ["var(--color-chart-7)", "var(--color-error-border)"],
  ["var(--color-accent-strong)", "var(--color-accent)"],
  ["var(--color-success)", "var(--color-success)"],
]
const gradientFor = (name) => {
  const s = String(name || "x")
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  const [a, b] = GRADIENTS[Math.abs(h) % GRADIENTS.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

const roleOf = (u) => (u.role || "user").toLowerCase()
const statusOf = (u) => (u.status || "active").toLowerCase()
const networkIdOf = (u) => u.networkId || `EX-${String(u.id || "").slice(0, 6).toUpperCase()}`

const ROLE_BADGE = {
  admin: { bg: "var(--color-info-subtle)", color: "var(--color-info)" },
     strategist: { bg: "var(--color-info-subtle)", color: "var(--color-info)" },
     director: { bg: "var(--color-accent-subtle)", color: "var(--color-accent-strong)" },
     operator: { bg: "var(--color-accent-subtle)", color: "var(--color-accent-strong)" },
  user: { bg: "var(--color-surface-muted)", color: "var(--color-body)" },
}
const roleBadge = (r) => ROLE_BADGE[r] || ROLE_BADGE.user

const STATUS_BADGE = {
  active: { bg: "var(--color-success-subtle)", dot: "var(--color-success)", color: "var(--color-success)" },
  pending: { bg: "var(--color-accent-subtle)", dot: "var(--color-accent-strong)", color: "var(--color-accent-strong)" },
  suspended: { bg: "var(--color-error-subtle)", dot: "var(--color-error)", color: "var(--color-error)" },
  inactive: { bg: "var(--color-surface-muted)", dot: "var(--color-muted)", color: "var(--color-body)" },
}
const statusBadge = (s) => STATUS_BADGE[s] || STATUS_BADGE.inactive

/* Build a compact page list with ellipsis (max 5 numbers + last page). */
const buildPages = (page, totalPages) => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages = []
  let start = Math.max(1, page - 2)
  let end = Math.min(totalPages, start + 4)
  start = Math.max(1, end - 4)
  for (let p = start; p <= end; p++) pages.push(p)
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push("…")
    pages.push(totalPages)
  }
  if (start > 1) pages.unshift("…")
  return pages
}

/* ============================== COMPONENT ============================== */
const UsersPage = () => {
  const [usersData, setUsersData] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [globalSearch, setGlobalSearch] = useState("")
  const [filterSearch, setFilterSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [sortBy, setSortBy] = useState("createdAt")
  const [dateStart, setDateStart] = useState("")
  const [dateEnd, setDateEnd] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [openMenu, setOpenMenu] = useState(null) // "role" | "status" | "sort" | "date"
  const [rowMenu, setRowMenu] = useState(null) // { user, top, left } — fixed-position actions popover

  // KPI stats
  const [totalUsers, setTotalUsers] = useState(0)
  const [newRegistrations, setNewRegistrations] = useState(0)
  const [adminCount, setAdminCount] = useState(0)
  const [activeCount, setActiveCount] = useState(0)

  const drawerRef = useRef(null)
  const containerRef = useRef(null)

  /* ---------------- REALTIME USERS + KPIs ---------------- */
  useEffect(() => {
    // Read all users and sort client-side. (orderBy("createdAt") would silently
    // drop legacy docs missing the field.)
         const fetchUsers = async () => {
       const { data, error } = await supabase.from("profiles").select("*")
       if (error) { console.error("profiles fetch:", error); return }
       setUsersData(data || [])
       setLoading(false)
       const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
       setTotalUsers((data || []).length)
       setNewRegistrations((data || []).filter((u) => { const d = toDate(u.created_at); return d && d.getTime() >= cutoff }).length)
       setAdminCount((data || []).filter((u) => roleOf(u) === "admin").length)
       setActiveCount((data || []).filter((u) => statusOf(u) === "active").length)
     }
     fetchUsers()
     const channel = supabase
       .channel("admin-users-realtime")
       .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, fetchUsers)
       .subscribe()
     return () => { supabase.removeChannel(channel) }
  }, [])

  /* ---------------- FILTER + SORT ---------------- */
  const filteredUsers = useMemo(() => {
    const g = globalSearch.toLowerCase()
    const f = filterSearch.toLowerCase()
    const startMs = dateStart ? new Date(dateStart).getTime() : null
    const endMs = dateEnd ? new Date(dateEnd).getTime() + 86400000 : null // inclusive end day

    const list = usersData.filter((u) => {
      const matchesGlobal =
        !g ||
        u.name?.toLowerCase().includes(g) ||
        u.email?.toLowerCase().includes(g) ||
        networkIdOf(u).toLowerCase().includes(g)
      const matchesFilter =
        !f || u.name?.toLowerCase().includes(f) || u.email?.toLowerCase().includes(f)
      const matchesRole = roleFilter === "all" || roleOf(u) === roleFilter
      const matchesStatus = statusFilter === "all" || statusOf(u) === statusFilter
      const created = toDate(u.createdAt)?.getTime() ?? null
      const matchesDate =
        (!startMs || (created != null && created >= startMs)) &&
        (!endMs || (created != null && created < endMs))
      return matchesGlobal && matchesFilter && matchesRole && matchesStatus && matchesDate
    })

    list.sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "")
      if (sortBy === "role") return roleOf(a).localeCompare(roleOf(b))
      const ad = toDate(a.createdAt)?.getTime() || 0
      const bd = toDate(b.createdAt)?.getTime() || 0
      return sortBy === "oldest" ? ad - bd : bd - ad
    })
    return list
  }, [usersData, globalSearch, filterSearch, roleFilter, statusFilter, sortBy, dateStart, dateEnd])

  // Reset to page 1 whenever the filter set changes.
  useEffect(() => { setCurrentPage(1) }, [globalSearch, filterSearch, roleFilter, statusFilter, sortBy, dateStart, dateEnd])

  // The row actions popover is fixed-positioned, so close it on scroll to avoid drift.
  useEffect(() => {
    if (!rowMenu) return
    const close = () => setRowMenu(null)
    window.addEventListener("scroll", close, true)
    return () => window.removeEventListener("scroll", close, true)
  }, [rowMenu])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedUsers = filteredUsers.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE)
  const showingFrom = filteredUsers.length === 0 ? 0 : (safePage - 1) * ITEMS_PER_PAGE + 1
  const showingTo = Math.min(safePage * ITEMS_PER_PAGE, filteredUsers.length)

  /* ---------------- PER-USER ORDER STATS ----------------
     Reads the pre-computed customer_stats aggregate (same data, no full scan). */
   const fetchUserStats = async (userId) => {
     try {
       const { data: stat } = await supabase.from("customer_stats").select("*").eq("user_id", userId).single()
       if (stat) {
         setSelectedUser((prev) =>
           prev && prev.id === userId
             ? { ...prev, totalSpent: Number(stat.total_spent || 0), orderCount: Number(stat.total_orders || 0) }
             : prev
         )
       }
     } catch (e) {
       console.log("user stats", e)
     }
   }

/* ---------------- DRAWER ---------------- */
  const openUser = (user) => {
    setSelectedUser({ ...user, totalSpent: undefined, orderCount: undefined })
    setDrawerOpen(true)
    fetchUserStats(user.id)
  }
  const closeDrawer = () => {
    if (drawerRef.current) {
      gsap.to(drawerRef.current, {
        right: -400, duration: 0.25, ease: "power3.in",
        onComplete: () => { setDrawerOpen(false); setSelectedUser(null) },
      })
    } else {
      setDrawerOpen(false); setSelectedUser(null)
    }
  }
  useEffect(() => {
    if (drawerOpen && drawerRef.current) {
      gsap.fromTo(drawerRef.current, { right: -400 }, { right: 0, duration: 0.35, ease: "power3.out" })
    }
  }, [drawerOpen])

  /* ---------------- ADMIN ACTIONS ---------------- */
  const suspendUser = async (user) => {
     try {
       const { error } = await supabase.from("profiles").update({ status: "suspended" }).eq("id", user.id)
       if (error) throw error
       toast.success(`${user.name || "User"} suspended.`)
       if (selectedUser?.id === user.id) closeDrawer()
     } catch (e) {
       console.log(e); toast.error("Could not suspend account.")
     }
   }
  const deleteUser = async (user) => {
     if (!window.confirm(`Delete ${user.name || "this user"}? This cannot be undone.`)) return
     try {
       const { error } = await supabase.from("profiles").delete().eq("id", user.id)
       if (error) throw error
       toast.success("User deleted.")
       if (selectedUser?.id === user.id) closeDrawer()
     } catch (e) {
       console.log(e); toast.error("Could not delete user.")
     }
   }
 
  const resetKeys = async (user) => {
    // Old behavior: fired a success toast unconditionally with no backend/email call at all -
    // functions/ has no user-management or email route, so nothing was ever sent.
    // Fixed to genuinely dispatch via Supabase Auth built-in reset email and only toast
    // success once that call resolves; failures surface as errors.
    if (!user.email) {
      toast.error("Cannot reset security keys: no email on file for this user.")
      return
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email)
      if (error) throw error
      toast.success(`Security key reset link sent to ${user.email}.`)
    } catch (e) {
      console.error("resetKeys: resetPasswordForEmail failed", { recipient: user.email, message: e.message })
      toast.error(`Could not send reset email to ${user.email}: ${e.message || "unknown error"}`)
    }
  }

  /* ---------------- CSV EXPORT ---------------- */
  const exportCSV = () => {
    if (!filteredUsers.length) { toast.info("No entities to export."); return }
    const headers = ["Name", "Email", "Role", "Status", "Date Added", "Last Login", "Network ID"]
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const rows = filteredUsers.map((u) =>
      [u.name || "", u.email || "", roleOf(u), statusOf(u), fmtDate(u.createdAt),
       u.lastLoginAt != null ? relativeTime(u.lastLoginAt) : "Never", networkIdOf(u)].map(esc).join(",")
    )
    const csv = [headers.map(esc).join(","), ...rows].join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `nexus_entities_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${filteredUsers.length} entities.`)
  }

  /* ---------------- ANIMATIONS ---------------- */
  useGSAP(() => {
    if (loading) return
    gsap.from(".stat-card", { y: 30, opacity: 0, stagger: 0.1, duration: 0.6, ease: "power3.out" })
  }, { scope: containerRef, dependencies: [loading] })

  useGSAP(() => {
    if (loading) return
    gsap.from(".table-row", { opacity: 0, y: 10, stagger: 0.03, duration: 0.3, ease: "power2.out" })
  }, { scope: containerRef, dependencies: [safePage, filteredUsers.length, roleFilter, statusFilter, sortBy] })

  /* ============================== STATS CARD CONFIG ============================== */
  const cards = [
    { icon: Users, label: "TOTAL USERS", value: totalUsers, trend: "+12%", dir: "up" },
    { icon: UserPlus, label: "NEW REGISTRATIONS", value: newRegistrations, trend: "+8%", dir: "up" },
    { icon: Shield, label: "ADMINISTRATORS", value: adminCount, trend: "Neutral", dir: "neutral" },
    { icon: Zap, label: "ACTIVE USERS", value: activeCount, trend: "-2%", dir: "down" },
  ]

  /* ============================== SHARED STYLES ============================== */
  const glassCard = {
    background: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
    boxShadow: "0px 8px 32px rgba(139,92,246,0.08)",
    backdropFilter: "blur(10px)",
  }
  const pillBtn = {
    background: "var(--color-surface-muted)",
    border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
    borderRadius: "48px",
    padding: "10px 16px",
    color: "var(--color-body)",
    fontFamily: INTER,
    fontSize: "15px",
  }
  const menuStyle = {
    position: "absolute", top: "calc(100% + 8px)", zIndex: 40, minWidth: "180px",
    background: "var(--color-surface)", borderRadius: "16px", border: "1px solid color-mix(in srgb, var(--color-border) 40%, transparent)",
    boxShadow: "0px 12px 32px rgba(29,26,35,0.12)", padding: "8px", fontFamily: INTER,
  }
  const menuItem = "w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[var(--color-surface-muted)] transition-colors capitalize"

  /* ============================== LOADING SKELETON ============================== */
  if (loading) {
    const skel = (w = "80px", h = "14px", r = "6px") => (
      <div className="animate-pulse" style={{ width: w, height: h, borderRadius: r, background: "#E9E4DD" }} />
    )
    return (
      <div style={{ padding: "20px 24px", fontFamily: "'Plus Jakarta Sans','Inter',sans-serif" }}>
        {/* KPI row skeleton */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "12px", marginBottom: "24px" }}>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} style={{ background: "#fff", border: "1px solid #E6E0D8", borderRadius: "16px", padding: "16px", height: "90px" }}>
              {skel("70%", "11px")} <div style={{ marginTop: "16px" }}>{skel("50%", "22px", "8px")}</div>
            </div>
          ))}
        </div>
        {/* Table skeleton */}
        <div style={{ background: "#fff", border: "1px solid #E6E0D8", borderRadius: "16px", overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #EFECE6" }}>{skel("200px", "14px")}</div>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "14px 24px", borderBottom: "1px solid #F2EFEA" }}>
              <div className="animate-pulse" style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#E9E4DD", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{skel("60%", "13px")}</div>
              {skel("80px", "12px")} {skel("60px", "12px")} {skel("40px", "12px")} {skel("70px", "12px")}
            </div>
          ))}
        </div>
      </div>
    )
  }

  /* ============================== RENDER ============================== */
  // Pelago design tokens
  const TEAL   = "#104945"
  const TEAL_L = "#DDF0EB"
  const WHITE  = "#FFFFFF"
  const BORDER = "#E6E0D8"
  const STONE  = "#FAF8F5"
  const INK    = "#171412"
  const MUTED  = "#78716C"
  const FONT   = "'Plus Jakarta Sans','Inter',sans-serif"

  // Avatar colour buckets (warm Pelago palette)
  const avatarColor = (name) => {
    const palettes = [
      { bg: "#F6DDCC", fg: "#93441A" }, { bg: "#FAECD6", fg: "#8E5C1E" },
      { bg: "#FBDBE4", fg: "#9B294C" }, { bg: "#DCF1EB", fg: "#1C695A" },
      { bg: "#DBE8F1", fg: "#215A7F" }, { bg: "#DDF0EB", fg: "#0F4C4C" },
      { bg: "#E9E4F0", fg: "#5B3F8A" }, { bg: "#FDE8D8", fg: "#A0410D" },
    ]
    let h = 0
    for (let i = 0; i < (name || "?").length; i++) h = (name.charCodeAt(i) + ((h << 5) - h)) | 0
    return palettes[Math.abs(h) % palettes.length]
  }

  // Status pill style
  const statusStyle = (s) => ({
    confirmed: { bg: "#FEF3C7", color: "#92400E" },
    active:    { bg: "#DDF0EB", color: "#0F4C4C" },
    pending:   { bg: "#FEF3C7", color: "#92400E" },
    suspended: { bg: "#FEE2E2", color: "#991B1B" },
    inactive:  { bg: "#F3F4F6", color: "#374151" },
  })[s] || { bg: "#F3F4F6", color: "#374151" }

  return (
    <div ref={containerRef} style={{ fontFamily: FONT, padding: "20px 24px 40px" }}>

      {/* ── KPI Cards ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        {[
          { label: "Total Users",       value: totalUsers       },
          { label: "New (30 days)",      value: newRegistrations },
          { label: "Administrators",     value: adminCount       },
          { label: "Active Users",       value: activeCount      },
        ].map(card => (
          <div key={card.label} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: "16px", padding: "14px 16px", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: MUTED, marginBottom: "10px" }}>{card.label}</div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: INK, lineHeight: 1 }}>{card.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* ── Main table card ───────────────────────────────────── */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>

        {/* Table toolbar */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid #EFECE6`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            {/* Search */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#A8A29E" }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
              <input
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Search name or email…"
                style={{ width: "240px", paddingLeft: "30px", paddingRight: "10px", height: "32px", fontSize: "12.5px", border: `1px solid #D8D2C9`, borderRadius: "999px", background: WHITE, color: INK, fontFamily: FONT, outline: "none" }}
              />
            </div>

            {/* Role filter pills */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#EDE8E2", borderRadius: "999px", padding: "3px" }}>
              {["all", "admin", "user"].map(r => (
                <button key={r} onClick={() => setRoleFilter(r)} style={{ padding: "3px 10px", fontSize: "12px", fontWeight: roleFilter === r ? 700 : 500, background: roleFilter === r ? WHITE : "transparent", color: roleFilter === r ? INK : MUTED, border: "none", borderRadius: "999px", cursor: "pointer", boxShadow: roleFilter === r ? "0 1px 2px rgba(0,0,0,0.08)" : "none", fontFamily: FONT }}>
                  {r === "all" ? `All ${totalUsers}` : r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Sort segmented */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: MUTED, fontWeight: 500 }}>Sort</span>
            <div style={{ display: "flex", alignItems: "center", gap: "2px", background: "#EDE8E2", borderRadius: "999px", padding: "3px" }}>
              {[{ key: "createdAt", label: "Newest" }, { key: "name", label: "Name" }, { key: "role", label: "Role" }].map(s => (
                <button key={s.key} onClick={() => setSortBy(s.key)} style={{ padding: "3px 10px", fontSize: "12px", fontWeight: sortBy === s.key ? 700 : 500, background: sortBy === s.key ? WHITE : "transparent", color: sortBy === s.key ? INK : MUTED, border: "none", borderRadius: "999px", cursor: "pointer", boxShadow: sortBy === s.key ? "0 1px 2px rgba(0,0,0,0.08)" : "none", fontFamily: FONT }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
            <thead>
              <tr style={{ background: "#FAF8F5" }}>
                {["Customer", "Joined", "Email", "Role", "Status", "Orders", "Spent", "Actions"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: "10.5px", fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedUsers.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "40px", textAlign: "center", color: MUTED, fontSize: "13px" }}>No users match your filters</td></tr>
              ) : paginatedUsers.map(user => {
                const av = avatarColor(user.name || user.email || "?")
                const role = roleOf(user)
                const stat = statusOf(user)
                const ss = statusStyle(stat)
                const rb = roleBadge(role)
                return (
                  <tr
                    key={user.id}
                    className="table-row"
                    style={{ cursor: "pointer", transition: "background 0.1s", borderBottom: `1px solid #F2EFEA` }}
                    onMouseEnter={e => e.currentTarget.style.background = STONE}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    onClick={() => { setSelectedUser(user); setDrawerOpen(true); fetchUserStats(user.id) }}
                  >
                    {/* Customer avatar + name */}
                    <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: av.bg, color: av.fg, fontWeight: 700, fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {initials(user.name || user.email)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: INK, fontSize: "13px" }}>{user.name || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#44403C", fontWeight: 500, whiteSpace: "nowrap" }}>{fmtDate(user.created_at || user.createdAt)}</td>
                    <td style={{ padding: "12px 16px", color: MUTED, maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email || "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ background: rb.bg, color: rb.color, padding: "3px 8px", borderRadius: "9999px", fontSize: "11px", fontWeight: 700 }}>
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ background: ss.bg, color: ss.color, padding: "3px 8px", borderRadius: "9999px", fontSize: "11px", fontWeight: 700 }}>
                        {stat.charAt(0).toUpperCase() + stat.slice(1)}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 700, color: INK }}>{user.orderCount ?? "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div>
                        <div style={{ fontWeight: 700, color: INK, fontSize: "13px" }}>
                          {user.totalSpent != null ? `₹${Number(user.totalSpent).toLocaleString("en-IN")}` : "—"}
                        </div>
                        {user.totalSpent != null && totalUsers > 0 && (
                          <div style={{ marginTop: "4px", width: "80px", height: "3px", background: "#E2DCD4", borderRadius: "999px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(100, (user.totalSpent / 25000) * 100)}%`, background: TEAL, borderRadius: "999px" }} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedUser(user); setDrawerOpen(true); fetchUserStats(user.id) }}
                        style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 10px", borderRadius: "8px", background: TEAL_L, color: TEAL, border: "none", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}
                        onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
                        onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid #EFECE6`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "12.5px", color: MUTED }}>
            Showing <strong style={{ color: INK }}>{showingFrom}–{showingTo}</strong> of <strong style={{ color: INK }}>{filteredUsers.length}</strong>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1} style={{ padding: "4px 10px", borderRadius: "8px", border: `1px solid ${BORDER}`, background: WHITE, color: safePage === 1 ? MUTED : INK, fontSize: "12px", fontWeight: 600, cursor: safePage === 1 ? "default" : "pointer", fontFamily: FONT }}>←</button>
            {buildPages(safePage, totalPages).map((p, i) => (
              <button key={i} onClick={() => typeof p === "number" && setCurrentPage(p)} style={{ padding: "4px 10px", borderRadius: "8px", border: `1px solid ${typeof p === "number" && p === safePage ? TEAL : BORDER}`, background: typeof p === "number" && p === safePage ? TEAL : WHITE, color: typeof p === "number" && p === safePage ? WHITE : INK, fontSize: "12px", fontWeight: 600, cursor: typeof p === "number" ? "pointer" : "default", fontFamily: FONT }}>
                {p}
              </button>
            ))}
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={{ padding: "4px 10px", borderRadius: "8px", border: `1px solid ${BORDER}`, background: WHITE, color: safePage === totalPages ? MUTED : INK, fontSize: "12px", fontWeight: 600, cursor: safePage === totalPages ? "default" : "pointer", fontFamily: FONT }}>→</button>
          </div>
        </div>
      </div>

      {/* ── User Detail Drawer (preserved from original) ──────── */}
      {drawerOpen && selectedUser && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 40, backdropFilter: "blur(2px)" }} />
          <div ref={drawerRef} style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: "380px", maxWidth: "95vw", background: WHITE, zIndex: 50, boxShadow: "-8px 0 32px rgba(0,0,0,0.12)", overflowY: "auto", fontFamily: FONT }}>
            <div style={{ padding: "20px 24px" }}>
              {/* Drawer header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <h2 style={{ fontWeight: 800, fontSize: "18px", color: INK }}>User Details</h2>
                <button onClick={() => setDrawerOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, padding: "4px" }}>
                  <X size={20} />
                </button>
              </div>

              {/* Avatar + name */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
                <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: gradientFor(selectedUser.name), display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  {selectedUser.photoURL
                    ? <img src={selectedUser.photoURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ color: "white", fontWeight: 800, fontSize: "22px" }}>{initials(selectedUser.name || selectedUser.email)}</span>
                  }
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: "18px", color: INK }}>{selectedUser.name || "Unknown"}</div>
                  <div style={{ fontSize: "12px", color: TEAL, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px" }}>{roleOf(selectedUser)}</div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <a href={`mailto:${selectedUser.email}`} style={{ width: "36px", height: "36px", borderRadius: "50%", background: TEAL_L, color: TEAL, display: "flex", alignItems: "center", justifyContent: "center" }}><Mail size={16}/></a>
                  <button onClick={() => toast.info("Messaging not configured.")} style={{ width: "36px", height: "36px", borderRadius: "50%", background: TEAL_L, color: TEAL, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><MessageSquare size={16}/></button>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
                {[{ label: "Total Spent", value: selectedUser.totalSpent !== undefined ? `₹${Number(selectedUser.totalSpent).toLocaleString("en-IN")}` : "…" },
                  { label: "Orders", value: selectedUser.orderCount !== undefined ? selectedUser.orderCount : "…" }
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, background: "#F7F5F2", borderRadius: "12px", padding: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.8px" }}>{s.label}</div>
                    <div style={{ fontWeight: 700, fontSize: "16px", color: INK, marginTop: "4px" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Registry data */}
              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px", color: MUTED, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "12px" }}>Registry Data</div>
                {[
                  { label: "Network ID", value: networkIdOf(selectedUser) },
                  { label: "Status", value: statusOf(selectedUser) },
                  { label: "Email", value: selectedUser.email || "—" },
                  { label: "Joined", value: fmtDate(selectedUser.created_at || selectedUser.createdAt) },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F2EFEA" }}>
                    <span style={{ fontSize: "13px", color: MUTED }}>{row.label}</span>
                    <span style={{ fontSize: "13px", color: INK, fontWeight: 600 }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Admin controls */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <button onClick={() => resetKeys(selectedUser)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "44px", background: "#F7F5F2", border: "none", borderRadius: "12px", fontWeight: 600, fontSize: "14px", color: INK, cursor: "pointer", fontFamily: FONT }}>
                  <KeyRound size={17}/> Reset Security Keys
                </button>
                <button onClick={() => suspendUser(selectedUser)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "44px", background: "#FEE2E2", border: "none", borderRadius: "12px", fontWeight: 600, fontSize: "14px", color: "#991B1B", cursor: "pointer", fontFamily: FONT }}>
                  <Ban size={16}/> Suspend Account
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default UsersPage
