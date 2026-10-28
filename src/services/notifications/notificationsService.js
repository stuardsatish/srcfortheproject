// The in-app inbox on the website (public.notifications, migration 20261008_04_notifications.sql): a customer reads THEIR notifications, an admin theirs
// (the "system" ones: a new return request, a failed refund, a paid order that could not be created). RLS limits every read to the signed-in user's own rows
// and the only write allowed is marking them read, through mark_notifications_read().
// The Supabase client is INJECTED (createNotificationsService(client)) so this file has no npm imports and is unit-tested with a fake client
// (src/services/notifications/__tests__/notificationsService.test.mjs). services/notifications/index.js wires the real client.
// The RN app has its own twin of the same calls in src/services/inbox.js.
import { NOTIFICATION_COLUMNS, mapNotificationRows } from '../../features/notifications/notificationModel.js'

/** a PostgREST error is a plain object: callers (and the screens' error text) want a real Error that still carries the code */
const toError = (err) => Object.assign(new Error((err && err.message) || 'Something went wrong'), { code: (err && err.code) || '' })

export function createNotificationsService(client) {
  return {
    /** the newest notifications of the signed-in user, mapped (see features/notifications/notificationModel.js) */
    async list({ limit = 50 } = {}) {
      const { data, error } = await client.from('notifications').select(NOTIFICATION_COLUMNS).order('created_at', { ascending: false }).limit(limit)
      if (error) throw toError(error)
      return mapNotificationRows(data)
    },

    /** how many are unread (the badge on the bell): a head-only count, no rows travel */
    async unreadCount() {
      const { count, error } = await client.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      if (error) throw toError(error)
      return count || 0
    },

    /** marks the given notifications read (an array of ids) - or every unread one when ids is null / omitted. Returns how many changed. */
    async markRead(ids = null) {
      const { data, error } = await client.rpc('mark_notifications_read', { p_ids: Array.isArray(ids) ? ids : null })
      if (error) throw toError(error)
      return typeof data === 'number' ? data : 0
    },
  }
}