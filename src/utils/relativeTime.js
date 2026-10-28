// "5 minutes ago" style labels for the Q&A list. `now` is injectable so the
// output is deterministic in tests; callers just pass the timestamp.
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function relativeTime(value, now = Date.now()) {
    const d = value instanceof Date ? value : new Date(value)
    const t = d.getTime()
    if (!value || Number.isNaN(t)) return ""

    // A timestamp slightly in the future (client clock behind the server) reads as "just now".
    const diff = Math.max(0, now - t)
    const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"} ago`

    if (diff < MINUTE) return "just now"
    if (diff < HOUR) return plural(Math.floor(diff / MINUTE), "minute")
    if (diff < DAY) return plural(Math.floor(diff / HOUR), "hour")
    const days = Math.floor(diff / DAY)
    if (days === 1) return "yesterday"
    if (days < 7) return plural(days, "day")
    if (days < 30) return plural(Math.floor(days / 7), "week")
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}