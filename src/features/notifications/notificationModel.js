// Notification model shared by the website (the inbox page + the bell in the header) and the React Native app (the inbox tab + what a tapped push opens).
//
// PURE: no imports, no I/O, no framework. This file exists TWICE and the two copies must stay byte-identical:
//   website  src/features/notifications/notificationModel.js   (tests: src/features/notifications/__tests__/notificationModel.test.mjs)
//   RN app   src/utils/notificationModel.js                      (the same test file runs against this copy: tools/browser-test/Run-RnParity.ps1)
// It mirrors the database (migration 20261008_04_notifications.sql + the helpers of 20261017_04 ... _09): public.notifications has
//   kind  order_update | back_in_stock | price_drop | promotion | system,   title, body,   data jsonb,   read_at
// and `data.type` says WHAT happened:
//   customers: order · product · return · exchange · refund · payment_exception
//   admins   : admin_request · admin_refund · admin_payment_exception      (kind 'system'; admins read them on the website - the app has no admin screens)
// THE DATABASE REMAINS THE SOURCE OF TRUTH (spec phase 14): a notification is a message ABOUT a state, never the state itself. The screens that
// matter (the order, the request, the refund) always read their own tables; this module only decides how a message looks and where it leads.

/** the columns the inbox selects (customers may read their own rows; `read_at` is the only column they may write, through mark_notifications_read) */
export const NOTIFICATION_COLUMNS = 'id, kind, title, body, data, created_at, read_at'
export const NOTIFICATION_KINDS = ['order_update', 'back_in_stock', 'price_drop', 'promotion', 'system']
/** every `data.type` the database writes today (a test in the SQL suite 72 checks the database against this list) */
export const CUSTOMER_DATA_TYPES = ['order', 'product', 'return', 'exchange', 'refund', 'payment_exception']
export const ADMIN_DATA_TYPES = ['admin_request', 'admin_refund', 'admin_payment_exception']

const asObject = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

// ───────────── mapping rows ─────────────
/** a notifications row -> what the screens use. A row without an id (never happens) is dropped by mapNotificationRows. */
export function mapNotificationRow(row) {
  if (!row || !row.id) return null
  const data = asObject(row.data)
  return {
    id: String(row.id),
    kind: String(row.kind || 'system'),
    title: String(row.title || ''),
    body: String(row.body || ''),
    data,
    type: typeof data.type === 'string' ? data.type : '',
    createdAt: row.created_at || null,
    readAt: row.read_at || null,
    read: !!row.read_at,
  }
}
export const mapNotificationRows = (rows) => (rows || []).map(mapNotificationRow).filter(Boolean)

/** how many of the mapped notifications are still unread (the badge on the bell) */
export const unreadCount = (list) => (list || []).filter((n) => n && !n.read).length

/** an admin-only message (kind 'system', data.type admin_*) */
export const isAdminNotification = (n) => String((n && (n.type || asObject(n.data).type)) || '').startsWith('admin_')

// ───────────── how a message looks ─────────────
/**
 * A neutral icon key (each app maps it to its own icon set): order | return | exchange | refund | stock | price | promo | admin | alert | bell
 * `data.type` decides first (a refund is a refund although its kind is order_update), the kind is the fallback.
 */
export function notificationIconKey(n) {
  const type = (n && n.type) || asObject(n && n.data).type
  const kind = n && n.kind
  switch (type) {
    case 'order': return 'order'
    case 'return': return 'return'
    case 'exchange': return 'exchange'
    case 'refund': return 'refund'
    case 'product': return kind === 'price_drop' ? 'price' : 'stock'
    case 'payment_exception':
    case 'admin_payment_exception': return 'alert'
    case 'admin_request':
    case 'admin_refund': return 'admin'
    default: break
  }
  switch (kind) {
    case 'order_update': return 'order'
    case 'back_in_stock': return 'stock'
    case 'price_drop': return 'price'
    case 'promotion': return 'promo'
    default: return 'bell'
  }
}

/** "Just now" · "5m ago" · "3h ago" · "2d ago" · a date after a month. `now` is injectable so the rule is testable. */
export function timeAgo(iso, now = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN
  if (Number.isNaN(t)) return ''
  const mins = Math.floor((now - t) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

// ───────────── where a message leads ─────────────
// A route is only built from an id that looks like one (letters, digits, _ . : -): a notification's `data` is written by the database, but a path
// is never assembled from text we have not checked.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const safeId = (v) => ((typeof v === 'string' || typeof v === 'number') && SAFE_ID.test(String(v)) ? String(v) : null)

const ROUTES = {
  web: {
    order: (id) => `/order/${id}`,
    product: (id) => `/product/${id}`,
    requests: '/myreturns',
    adminRequests: '/admin/returns',
    adminInventory: '/admin/inventory',
  },
  app: {
    order: (id) => `/orders/${id}`,
    product: (id) => `/products/${id}`,
    requests: '/returns',
    adminRequests: null, // the app has no admin screens, by design
    adminInventory: null,
  },
}

/**
 * The path a notification opens, or null when it has no destination (it just stays in the inbox).
 * @param n         a mapped notification ({ data }) or a raw row
 * @param platform  'web' | 'app'
 */
export function notificationRoute(n, platform = 'web') {
  const r = ROUTES[platform] || ROUTES.web
  const d = asObject(n && n.data)
  // a payload without a type that still names an order / a product behaves as the app's first push handler did (it looked at orderId, then productId)
  const type = d.type || (d.orderId ? 'order' : d.productId ? 'product' : '')
  switch (type) {
    case 'order': {
      const id = safeId(d.orderId)
      return id ? r.order(id) : null
    }
    case 'product': {
      const id = safeId(d.productId)
      return id ? r.product(id) : null
    }
    case 'return':
    case 'exchange':
      return r.requests
    case 'refund': {
      // a refund of a return / exchange lives on its request card; an order-level refund (a cancelled order) on the order
      if (safeId(d.requestId)) return r.requests
      const id = safeId(d.orderId)
      return id ? r.order(id) : null
    }
    case 'admin_request':
    case 'admin_refund':
      return r.adminRequests
    case 'admin_payment_exception':
      return r.adminInventory
    default:
      return null // payment_exception (the customer's "we could not complete your order"), unknown types of a newer server, no type at all
  }
}

/** what a tapped push notification opens in the app: its own destination, else the inbox */
export const routeForPushData = (data) => notificationRoute({ data }, 'app') || '/notifications'