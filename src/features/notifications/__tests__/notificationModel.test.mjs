// node --test src/features/notifications/__tests__/notificationModel.test.mjs   (npm run test:unit)
// The same file runs against the RN copy (Ecommerce-App-v2-main/src/utils/notificationModel.js) through tools/browser-test/Run-RnParity.ps1.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ADMIN_DATA_TYPES, CUSTOMER_DATA_TYPES, NOTIFICATION_COLUMNS, NOTIFICATION_KINDS, isAdminNotification, mapNotificationRow, mapNotificationRows,
  notificationIconKey, notificationRoute, routeForPushData, timeAgo, unreadCount,
} from '../notificationModel.js'

const row = (over = {}) => ({ id: 'n1', kind: 'order_update', title: 'Order confirmed', body: 'We have confirmed your order #ABCD1234.', data: { type: 'order', orderId: 'order_1' }, created_at: '2026-10-18T08:00:00Z', read_at: null, ...over })

describe('mapNotificationRow', () => {
  it('maps the columns of public.notifications; read_at decides read', () => {
    assert.equal(NOTIFICATION_COLUMNS, 'id, kind, title, body, data, created_at, read_at')
    const n = mapNotificationRow(row())
    assert.deepEqual(n, { id: 'n1', kind: 'order_update', title: 'Order confirmed', body: 'We have confirmed your order #ABCD1234.', data: { type: 'order', orderId: 'order_1' }, type: 'order', createdAt: '2026-10-18T08:00:00Z', readAt: null, read: false })
    assert.equal(mapNotificationRow(row({ read_at: '2026-10-18T09:00:00Z' })).read, true)
    assert.equal(mapNotificationRow(row({ read_at: '2026-10-18T09:00:00Z' })).readAt, '2026-10-18T09:00:00Z')
  })
  it('tolerates a null / array / unparsable data, a JSON string, a missing kind, title and body', () => {
    assert.deepEqual(mapNotificationRow(row({ data: null })).data, {})
    assert.deepEqual(mapNotificationRow(row({ data: [1, 2] })).data, {})
    assert.deepEqual(mapNotificationRow(row({ data: '{not json' })).data, {})
    assert.deepEqual(mapNotificationRow(row({ data: '[1]' })).data, {})
    assert.deepEqual(mapNotificationRow(row({ data: '{"type":"product","productId":"p1"}' })).data, { type: 'product', productId: 'p1' })
    assert.equal(mapNotificationRow(row({ data: '{"type":"product"}' })).type, 'product')
    const bare = mapNotificationRow({ id: 7 })
    assert.deepEqual([bare.id, bare.kind, bare.title, bare.body, bare.type, bare.read], ['7', 'system', '', '', '', false])
    assert.equal(mapNotificationRow(row({ data: { type: 5 } })).type, '')
  })
  it('drops rows without an id', () => {
    assert.equal(mapNotificationRow(null), null)
    assert.equal(mapNotificationRow({}), null)
    assert.deepEqual(mapNotificationRows([row(), null, {}, row({ id: 'n2' })]).map((n) => n.id), ['n1', 'n2'])
    assert.deepEqual(mapNotificationRows(null), [])
  })
  it('lists the kinds and the data types the database writes', () => {
    assert.deepEqual(NOTIFICATION_KINDS, ['order_update', 'back_in_stock', 'price_drop', 'promotion', 'system'])
    assert.deepEqual(CUSTOMER_DATA_TYPES, ['order', 'product', 'return', 'exchange', 'refund', 'payment_exception'])
    assert.deepEqual(ADMIN_DATA_TYPES, ['admin_request', 'admin_refund', 'admin_payment_exception'])
  })
})

describe('unreadCount / isAdminNotification', () => {
  it('counts the unread mapped notifications', () => {
    const list = mapNotificationRows([row(), row({ id: 'n2', read_at: '2026-10-18T09:00:00Z' }), row({ id: 'n3' })])
    assert.equal(unreadCount(list), 2)
    assert.equal(unreadCount([]), 0)
    assert.equal(unreadCount(null), 0)
    assert.equal(unreadCount([null, undefined]), 0)
  })
  it('an admin message is one whose data.type starts with admin_', () => {
    for (const t of ADMIN_DATA_TYPES) assert.equal(isAdminNotification({ data: { type: t } }), true, t)
    for (const t of CUSTOMER_DATA_TYPES) assert.equal(isAdminNotification({ data: { type: t } }), false, t)
    assert.equal(isAdminNotification(mapNotificationRow(row({ kind: 'system', data: { type: 'admin_request' } }))), true)
    assert.equal(isAdminNotification(null), false)
    assert.equal(isAdminNotification({}), false)
  })
})

describe('notificationIconKey', () => {
  const cases = [
    [{ kind: 'order_update', data: { type: 'order' } }, 'order'],
    [{ kind: 'order_update', data: { type: 'return' } }, 'return'],
    [{ kind: 'order_update', data: { type: 'exchange' } }, 'exchange'],
    [{ kind: 'order_update', data: { type: 'refund' } }, 'refund'],
    [{ kind: 'back_in_stock', data: { type: 'product' } }, 'stock'],
    [{ kind: 'price_drop', data: { type: 'product' } }, 'price'],
    [{ kind: 'order_update', data: { type: 'payment_exception' } }, 'alert'],
    [{ kind: 'system', data: { type: 'admin_payment_exception' } }, 'alert'],
    [{ kind: 'system', data: { type: 'admin_request' } }, 'admin'],
    [{ kind: 'system', data: { type: 'admin_refund' } }, 'admin'],
    // no / unknown type: the kind decides
    [{ kind: 'order_update', data: {} }, 'order'],
    [{ kind: 'back_in_stock', data: {} }, 'stock'],
    [{ kind: 'price_drop', data: null }, 'price'],
    [{ kind: 'promotion', data: {} }, 'promo'],
    [{ kind: 'system', data: { type: 'something_new' } }, 'bell'],
    [{ kind: 'something_new' }, 'bell'],
    [null, 'bell'],
  ]
  for (const [n, key] of cases) it(`${JSON.stringify(n)} -> ${key}`, () => assert.equal(notificationIconKey(n), key))
  it('works on a mapped notification too', () => assert.equal(notificationIconKey(mapNotificationRow(row({ data: { type: 'refund' } }))), 'refund'))
})

describe('timeAgo', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')
  const ago = (ms) => new Date(now - ms).toISOString()
  it('says it in the unit that fits', () => {
    assert.equal(timeAgo(ago(0), now), 'Just now')
    assert.equal(timeAgo(ago(59 * 1000), now), 'Just now')
    assert.equal(timeAgo(ago(60 * 1000), now), '1m ago')
    assert.equal(timeAgo(ago(59 * 60 * 1000), now), '59m ago')
    assert.equal(timeAgo(ago(60 * 60 * 1000), now), '1h ago')
    assert.equal(timeAgo(ago(23 * 3600 * 1000 + 59 * 60 * 1000), now), '23h ago')
    assert.equal(timeAgo(ago(24 * 3600 * 1000), now), '1d ago')
    assert.equal(timeAgo(ago(29 * 24 * 3600 * 1000), now), '29d ago')
  })
  it('a clock a little ahead of the server still reads "Just now"; later than 30 days is a date; garbage is empty', () => {
    assert.equal(timeAgo(new Date(now + 5000).toISOString(), now), 'Just now')
    assert.match(timeAgo('2026-08-01T00:00:00Z', now), /2026/)
    assert.equal(timeAgo(null, now), '')
    assert.equal(timeAgo('not a date', now), '')
  })
})

describe('notificationRoute', () => {
  const web = (data) => notificationRoute({ data }, 'web')
  const app = (data) => notificationRoute({ data }, 'app')
  it('an order notification opens the order on both platforms', () => {
    assert.equal(web({ type: 'order', orderId: 'order_RZP1' }), '/order/order_RZP1')
    assert.equal(app({ type: 'order', orderId: 'order_RZP1' }), '/orders/order_RZP1')
    assert.equal(web({ type: 'order', orderId: 'cod_6f1c2d3e-0000-4000-8000-000000000001' }), '/order/cod_6f1c2d3e-0000-4000-8000-000000000001')
    assert.equal(web({ type: 'order' }), null)
  })
  it('a product notification opens the product', () => {
    assert.equal(web({ type: 'product', productId: 'prod_1700000000001' }), '/product/prod_1700000000001')
    assert.equal(app({ type: 'product', productId: 'prod_1700000000001' }), '/products/prod_1700000000001')
    assert.equal(app({ type: 'product' }), null)
  })
  it('return / exchange requests open My Returns; a refund opens its request, or the order when it has none', () => {
    assert.equal(web({ type: 'return', requestId: 'r1' }), '/myreturns')
    assert.equal(app({ type: 'return', requestId: 'r1' }), '/returns')
    assert.equal(web({ type: 'exchange' }), '/myreturns')
    assert.equal(app({ type: 'exchange' }), '/returns')
    assert.equal(web({ type: 'refund', requestId: 'r1', orderId: 'o1' }), '/myreturns')
    assert.equal(app({ type: 'refund', requestId: 'r1', orderId: 'o1' }), '/returns')
    assert.equal(web({ type: 'refund', requestId: null, orderId: 'o1' }), '/order/o1')
    assert.equal(app({ type: 'refund', orderId: 'o1' }), '/orders/o1')
    assert.equal(web({ type: 'refund' }), null)
  })
  it('admin messages lead to the admin pages on the website and nowhere in the app', () => {
    assert.equal(web({ type: 'admin_request' }), '/admin/returns')
    assert.equal(web({ type: 'admin_refund' }), '/admin/returns')
    assert.equal(web({ type: 'admin_payment_exception' }), '/admin/inventory')
    for (const t of ADMIN_DATA_TYPES) assert.equal(app({ type: t }), null, t)
  })
  it('no destination: the customer\'s "could not complete your order", unknown types, no data, garbage', () => {
    assert.equal(web({ type: 'payment_exception' }), null)
    assert.equal(web({ type: 'brand_new' }), null)
    assert.equal(web({}), null)
    assert.equal(notificationRoute(null), null)
    assert.equal(notificationRoute({ data: null }, 'app'), null)
    assert.equal(notificationRoute({ data: 'not json' }, 'app'), null)
    assert.equal(notificationRoute({ data: '{"type":"order","orderId":"o9"}' }, 'web'), '/order/o9')
  })
  it('an unknown platform behaves like the website', () => assert.equal(notificationRoute({ data: { type: 'order', orderId: 'o1' } }, 'tv'), '/order/o1'))
  it('never builds a path from an id that does not look like one', () => {
    for (const bad of ['../../admin', 'a/b', 'a b', 'a?x=1', 'a#b', '', ' ', 'x'.repeat(129), '-leading', '<script>', 'é']) {
      assert.equal(web({ type: 'order', orderId: bad }), null, JSON.stringify(bad))
      assert.equal(app({ type: 'product', productId: bad }), null, JSON.stringify(bad))
    }
    assert.equal(web({ type: 'order', orderId: { x: 1 } }), null)
    assert.equal(web({ type: 'order', orderId: ['o1'] }), null)
    assert.equal(web({ type: 'order', orderId: 12345 }), '/order/12345')
  })
  it('every data.type the database writes is understood (has a route or deliberately none)', () => {
    const withRoute = { order: { orderId: 'o1' }, product: { productId: 'p1' }, return: {}, exchange: {}, refund: { requestId: 'r1' }, admin_request: {}, admin_refund: {}, admin_payment_exception: {} }
    for (const t of [...CUSTOMER_DATA_TYPES, ...ADMIN_DATA_TYPES]) {
      if (t === 'payment_exception') continue // customer-side, deliberately no destination
      assert.ok(web({ type: t, ...withRoute[t] }), `web route for ${t}`)
    }
  })
})

describe('routeForPushData', () => {
  it('a tapped push opens its destination in the app, else the inbox', () => {
    assert.equal(routeForPushData({ type: 'order', orderId: 'o1', notificationId: 'n1' }), '/orders/o1')
    assert.equal(routeForPushData({ type: 'return', requestId: 'r1' }), '/returns')
    assert.equal(routeForPushData({ type: 'product', productId: 'p1' }), '/products/p1')
    assert.equal(routeForPushData({ type: 'payment_exception' }), '/notifications')
    assert.equal(routeForPushData({}), '/notifications')
    assert.equal(routeForPushData(undefined), '/notifications')
    assert.equal(routeForPushData(null), '/notifications')
  })
  it('a payload without a type that names an order / a product still opens it (what the first push handler did); an order wins', () => {
    assert.equal(routeForPushData({ orderId: 'o1' }), '/orders/o1')
    assert.equal(routeForPushData({ productId: 'p1' }), '/products/p1')
    assert.equal(routeForPushData({ orderId: 'o1', productId: 'p1' }), '/orders/o1')
    assert.equal(routeForPushData({ orderId: '../x' }), '/notifications')
    assert.equal(routeForPushData({ type: 'something_new', orderId: 'o1' }), '/notifications')   // a type this build does not know: do not guess
  })
})