import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useSelector } from "react-redux"
import { Bell } from "lucide-react"
import { notificationsService } from "../../services/notifications"

/** The inbox page fires this after it marks notifications read, so the badge does not wait for the next poll. */
export const NOTIFICATIONS_CHANGED = "notifications-changed"
const POLL_MS = 60000

/**
 * The bell in the header (customers AND admins): the number of unread notifications, refreshed every minute, whenever the tab comes back into view
 * and whenever the inbox page changes something. It is a convenience: a failure to count never shows an error, the badge just stays as it was.
 * Renders nothing for a visitor who is not signed in.
 */
const NotificationBell = ({ size = 18, className = "relative text-ink hover:text-accent-strong transition-colors", badgeClassName = "absolute -top-2 -right-2", color }) => {
  const navigate = useNavigate()
  const signedIn = useSelector((state) => !!state.user.user)
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setCount(await notificationsService.unreadCount())
    } catch {
      /* keep the last number */
    }
  }, [])

  useEffect(() => {
    if (!signedIn) return undefined
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    const onVisible = () => { if (document.visibilityState === "visible") refresh() }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh)
    }
  }, [signedIn, refresh])

  if (!signedIn) return null
  const shown = count > 99 ? "99+" : String(count)
  return (
    <button
      type="button"
      onClick={() => navigate("/notifications")}
      className={className}
      style={color ? { color } : undefined}
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      title="Notifications"
    >
      <Bell size={size} />
      {count > 0 && (
        <span className={`${badgeClassName} bg-accent-strong text-inverse text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center font-bold`}>
          {shown}
        </span>
      )}
    </button>
  )
}

export default NotificationBell