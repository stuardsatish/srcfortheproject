import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, ArrowLeft, Bell, CheckCircle2, CreditCard, Gift, Info, Package, RotateCcw, Tag } from "lucide-react"
import { notificationsService } from "../../services/notifications"
import { notificationIconKey, notificationRoute, timeAgo, unreadCount } from "../../features/notifications/notificationModel"
import { NOTIFICATIONS_CHANGED } from "../../features/notifications/NotificationBell"

const INTER = "'Inter', sans-serif"
const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
]
/** the model's neutral icon key -> a lucide icon */
const ICONS = { order: Package, return: RotateCcw, exchange: RotateCcw, refund: CreditCard, stock: CheckCircle2, price: Tag, promo: Gift, admin: Info, alert: AlertTriangle, bell: Bell }

/**
 * The inbox: the signed-in user's notifications, newest first (customers see their orders / returns / refunds, admins the "system" ones - a new
 * request, a failed refund). Opening one marks it read and, when it points somewhere, goes there. Twin of the app's notifications tab.
 * A notification is a message ABOUT a state: the order / request / refund pages it leads to always show the real state.
 */
const NotificationsPage = () => {
  const navigate = useNavigate()
  const [state, setState] = useState({ loading: true, items: [], error: "" })
  const [filter, setFilter] = useState("all")

  const load = useCallback(async () => {
    try {
      const items = await notificationsService.list({ limit: 100 })
      setState({ loading: false, items, error: "" })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message || "Could not load your notifications" }))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const unread = unreadCount(state.items)
  const shown = useMemo(() => (filter === "unread" ? state.items.filter((n) => !n.read) : state.items), [state.items, filter])

  const markRead = async (ids) => {
    try {
      await notificationsService.markRead(ids)
      setState((s) => ({ ...s, items: s.items.map((n) => (ids === null || ids.includes(n.id) ? { ...n, read: true } : n)) }))
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
    } catch {
      /* the badge simply stays; nothing to tell the user about */
    }
  }

  const open = async (n) => {
    if (!n.read) await markRead([n.id])
    const target = notificationRoute(n, "web")
    if (target) navigate(target)
  }

  return (
    <div style={{ background: "var(--color-background)", minHeight: "100vh", fontFamily: INTER, color: "var(--color-ink)" }}>
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "96px 24px 80px" }}>
        <button onClick={() => navigate(-1)} className="flex items-center" style={{ gap: "8px", color: "var(--color-body)", marginBottom: "20px" }}>
          <ArrowLeft size={16} /> <span style={{ fontWeight: 600, fontSize: "14px" }}>Back</span>
        </button>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: "12px" }}>
          <h1 className="flex items-center" style={{ gap: "10px", fontWeight: 700, fontSize: "30px", letterSpacing: "-0.6px" }}><Bell size={26} style={{ color: "var(--color-primary)" }} /> Notifications</h1>
          {unread > 0 ? (
            <button onClick={() => markRead(null)} style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-primary)", cursor: "pointer" }}>Mark all read</button>
          ) : null}
        </div>

        <div className="flex flex-wrap" style={{ gap: "8px", margin: "20px 0" }}>
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} style={{ padding: "8px 16px", borderRadius: "9999px", fontWeight: 600, fontSize: "13px", background: filter === f.key ? "var(--color-primary)" : "var(--color-surface-muted)", color: filter === f.key ? "var(--color-inverse)" : "var(--color-body)", cursor: "pointer" }}>
              {f.label}{f.key === "unread" && unread > 0 ? ` (${unread})` : ""}
            </button>
          ))}
        </div>

        {state.loading ? (
          <div className="animate-pulse flex flex-col" style={{ gap: "10px" }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ height: "72px", borderRadius: "10px", background: "var(--color-border)" }} />)}
          </div>
        ) : state.error ? (
          <p style={{ color: "var(--color-error)", fontSize: "14px" }}>{state.error}</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center text-center" style={{ gap: "10px", padding: "56px 0", color: "var(--color-body)" }}>
            <Bell size={40} style={{ color: "var(--color-border-strong)" }} />
            <p style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-ink)" }}>{filter === "unread" ? "You are all caught up" : "No notifications yet"}</p>
            <p style={{ fontSize: "14px" }}>We will let you know about your orders, returns, refunds and more.</p>
          </div>
        ) : (
          <ul className="flex flex-col" style={{ border: "1px solid var(--color-border)", borderRadius: "12px", overflow: "hidden", background: "var(--color-surface)" }}>
            {shown.map((n) => {
              const Icon = ICONS[notificationIconKey(n)] || Bell
              const target = notificationRoute(n, "web")
              return (
                <li key={n.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <button onClick={() => open(n)} className="flex w-full text-left" aria-label={target ? `${n.title} - open` : n.title} style={{ gap: "12px", padding: "16px", background: n.read ? "transparent" : "var(--color-surface-muted)", cursor: target || !n.read ? "pointer" : "default" }}>
                    <span className="flex items-center justify-center" style={{ width: "38px", height: "38px", borderRadius: "9999px", background: "var(--color-surface-muted)", flexShrink: 0 }}>
                      <Icon size={18} style={{ color: "var(--color-primary)" }} />
                    </span>
                    <span className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: "2px" }}>
                      <span className="flex items-center justify-between" style={{ gap: "8px" }}>
                        <span style={{ fontWeight: n.read ? 600 : 700, fontSize: "14px" }}>{n.title || "Notification"}</span>
                        <span style={{ fontSize: "11px", color: "var(--color-muted)", flexShrink: 0 }}>{timeAgo(n.createdAt)}</span>
                      </span>
                      {n.body ? <span style={{ fontSize: "13px", color: "var(--color-body)", lineHeight: 1.4 }}>{n.body}</span> : null}
                    </span>
                    {!n.read ? <span aria-label="Unread" style={{ width: "8px", height: "8px", borderRadius: "9999px", background: "var(--color-primary)", marginTop: "6px", flexShrink: 0 }} /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default NotificationsPage