// node --test src/services/notifications/__tests__/notificationsService.test.mjs   (npm run test:unit)
// The inbox calls of the website, against a FAKE Supabase client: the real columns (kind / read_at), the head-only unread count, and the only write a
// customer may make (mark_notifications_read). Nothing touches the network.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createNotificationsService } from '../notificationsService.js'
import { NOTIFICATION_COLUMNS } from '../../../features/notifications/notificationModel.js'

function builder(result, log) {
  const b = {}
  for (const m of ['select', 'order', 'limit', 'is']) b[m] = (...args) => { log.push([m, ...args]); return b }
  b.then = (res, rej) => Promise.resolve(result).then(res, rej)
  return b
}
function fakeClient({ rows = { data: [], error: null }, rpcs = {} } = {}) {
  const log = []
  return {
    log,
    from: (t) => { log.push(['from', t]); return builder(rows, log) },
    rpc: async (name, args) => { log.push(['rpc', name, args]); return rpcs[name] !== undefined ? rpcs[name] : { data: null, error: null } },
  }
}

describe('list', () => {
  it('reads the real columns, newest first, and maps the rows', async () => {
    const c = fakeClient({ rows: { data: [
      { id: 'n2', kind: 'order_update', title: 'Your refund is complete', body: 'RFD-1', data: { type: 'refund', requestId: 'r1' }, created_at: '2026-10-18T10:00:00Z', read_at: null },
      { id: 'n1', kind: 'system', title: 'New return request', body: 'RET-1', data: { type: 'admin_request' }, created_at: '2026-10-17T10:00:00Z', read_at: '2026-10-17T11:00:00Z' },
    ], error: null } })
    const list = await createNotificationsService(c).list({ limit: 20 })
    assert.deepEqual(c.log, [['from', 'notifications'], ['select', NOTIFICATION_COLUMNS], ['order', 'created_at', { ascending: false }], ['limit', 20]])
    assert.doesNotMatch(NOTIFICATION_COLUMNS, /is_read/)
    assert.deepEqual(list.map((n) => [n.id, n.kind, n.type, n.read]), [['n2', 'order_update', 'refund', false], ['n1', 'system', 'admin_request', true]])
  })
  it('defaults to 50 rows; an empty table is an empty list', async () => {
    const c = fakeClient()
    assert.deepEqual(await createNotificationsService(c).list(), [])
    assert.deepEqual(c.log[3], ['limit', 50])
    const none = fakeClient({ rows: { data: null, error: null } })
    assert.deepEqual(await createNotificationsService(none).list(), [])
  })
  it('a database error is thrown as a real Error that keeps the code and the message', async () => {
    const c = fakeClient({ rows: { data: null, error: { code: '42501', message: 'permission denied' } } })
    await assert.rejects(() => createNotificationsService(c).list(), (e) => e instanceof Error && e.code === '42501' && e.message === 'permission denied')
    await assert.rejects(() => createNotificationsService(fakeClient({ rows: { data: null, error: {} } })).list(), (e) => e instanceof Error && e.message === 'Something went wrong' && e.code === '')
  })
})

describe('unreadCount', () => {
  it('is a head-only count of the rows whose read_at is null', async () => {
    const c = fakeClient({ rows: { count: 7, error: null } })
    assert.equal(await createNotificationsService(c).unreadCount(), 7)
    assert.deepEqual(c.log, [['from', 'notifications'], ['select', 'id', { count: 'exact', head: true }], ['is', 'read_at', null]])
  })
  it('no count (an empty answer) is zero; an error is thrown', async () => {
    assert.equal(await createNotificationsService(fakeClient({ rows: { count: null, error: null } })).unreadCount(), 0)
    await assert.rejects(() => createNotificationsService(fakeClient({ rows: { count: null, error: { message: 'boom' } } })).unreadCount(), /boom/)
  })
})

describe('markRead', () => {
  it('marks the given ids through mark_notifications_read (the only write a customer may make) and returns the count', async () => {
    const c = fakeClient({ rpcs: { mark_notifications_read: { data: 2, error: null } } })
    assert.equal(await createNotificationsService(c).markRead(['n1', 'n2']), 2)
    assert.deepEqual(c.log, [['rpc', 'mark_notifications_read', { p_ids: ['n1', 'n2'] }]])
  })
  it('no ids (or anything that is not an array) = every unread notification', async () => {
    for (const arg of [undefined, null, 'n1']) {
      const c = fakeClient({ rpcs: { mark_notifications_read: { data: 5, error: null } } })
      assert.equal(await createNotificationsService(c).markRead(arg), 5)
      assert.deepEqual(c.log[0], ['rpc', 'mark_notifications_read', { p_ids: null }])
    }
  })
  it('a non-numeric answer counts as 0; an error is thrown', async () => {
    assert.equal(await createNotificationsService(fakeClient({ rpcs: { mark_notifications_read: { data: null, error: null } } })).markRead(['n1']), 0)
    await assert.rejects(() => createNotificationsService(fakeClient({ rpcs: { mark_notifications_read: { data: null, error: { message: 'boom' } } } })).markRead(['n1']), /boom/)
  })
})