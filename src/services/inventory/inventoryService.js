// Admin service for the stock ledger, the stock reports, the payments that could not become an order and the order lifecycle (cancel an order, refund an order)
// (migration 20261017_08_inventory_cancellation.sql). WEBSITE ONLY - the RN app has no admin screens.
// The Supabase client is INJECTED (createInventoryService(client)) so this file has no npm imports and is unit-tested with a fake client
// (src/services/inventory/__tests__/inventoryService.test.mjs). services/inventory/index.js wires the real client.
import {
  LEDGER_PAGE, LEDGER_SELECT, LEDGER_SELECT_LEGACY, PAYMENT_EXCEPTION_COLUMNS, ledgerFilters, mapGapRow, mapLedgerRow, mapPaymentException, mapReconcileRow, mapUnsellableRow,
} from '../../features/inventory/inventoryModel.js'
import { REFUNDS_SELECT_ADMIN, mapRefundRows } from '../../features/returns/refundModel.js'

/** A PostgREST error -> an Error whose message is fit for a toast (the database messages are already readable). */
export function toInventoryError(err) {
  const code = err?.code
  const msg = String(err?.message || 'Something went wrong')
  const e = new Error(code === 'PGRST202' || code === '42883' ? 'This is not available on the server yet: the database update (inventory and cancellation migration) has not been applied.'
    : code === '42501' && /permission denied/i.test(msg) ? 'You do not have permission to do that.' : msg)
  e.code = code || ''
  e.detail = err?.details || err?.detail || ''
  e.original = err
  return e
}
/** True while the objects of the migration are missing on the server (SQL not applied yet): the screens say so instead of failing. */
export function isInventoryUnavailable(error) {
  if (!error) return false
  return ['PGRST202', 'PGRST205', '42883', '42P01'].includes(error.code)
}

export function createInventoryService(client) {
  const unwrap = (res) => { if (res.error) throw toInventoryError(res.error); return res.data }
  const rpc = async (name, args) => unwrap(await client.rpc(name, args))
  const nextDay = (day) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

  return {
    // ───────── the ledger ─────────
    /**
     * One page of the ledger, newest first. `before` = the `seq` of the last row of the previous page. Without the `seq` column (the migration is not applied) the
     * page is ordered by time and there is no next page.
     * @returns {{ rows: object[], nextBefore: number|null, ordered: boolean }}
     */
    async ledger({ filters = {}, before = null, limit = LEDGER_PAGE } = {}) {
      const f = ledgerFilters(filters)
      const build = (select, order) => {
        let q = client.from('inventory_logs').select(select).order(order, { ascending: false }).limit(limit)
        if (f.type) q = q.eq('movement_type', f.type)
        if (f.bucket) q = q.eq('bucket', f.bucket)
        if (f.orderId) q = q.eq('order_id', f.orderId)
        if (f.productId) q = q.eq('product_id', f.productId)
        if (f.from) q = q.gte('created_at', `${f.from}T00:00:00Z`)
        if (f.to) q = q.lt('created_at', `${nextDay(f.to)}T00:00:00Z`)
        if (before != null && order === 'seq') q = q.lt('seq', before)
        return q
      }
      let ordered = true
      let res = await build(LEDGER_SELECT, 'seq')
      if (res.error && res.error.code === '42703') { ordered = false; res = await build(LEDGER_SELECT_LEGACY, 'created_at') }   // no `seq` column yet
      if (res.error) throw toInventoryError(res.error)
      const data = res.data || []
      const ids = [...new Set(data.map((r) => r.variant_id).filter(Boolean))]
      let names = {}
      if (ids.length) {
        const v = await client.from('product_variants').select('id, name').in('id', ids)
        if (!v.error) names = Object.fromEntries((v.data || []).map((x) => [x.id, x.name]))        // a label is a convenience: any error leaves the id
      }
      const rows = data.map((r) => mapLedgerRow(r, names))
      return { rows, nextBefore: ordered && data.length === limit ? rows[rows.length - 1].seq : null, ordered }
    },

    // ───────── the reports (admin RPCs) ─────────
    /** the sellable counter vs the ledger; by default only the options that drifted */
    async reconcile(onlyDrift = true) { return (await rpc('inventory_reconcile', { p_only_drift: onlyDrift }) || []).map(mapReconcileRow) },
    async gaps(limit = 200) { return (await rpc('inventory_gaps', { p_limit: limit }) || []).map(mapGapRow) },
    async unsellable() { return (await rpc('inventory_unsellable_summary', {}) || []).map(mapUnsellableRow) },

    // ───────── payments that could not become an order ─────────
    async paymentExceptions({ status = null, limit = 100 } = {}) {
      let q = client.from('payment_exceptions').select(PAYMENT_EXCEPTION_COLUMNS).order('created_at', { ascending: false }).limit(limit)
      if (status) q = q.eq('status', status)
      const res = await q
      if (res.error) { if (isInventoryUnavailable(res.error)) return []; throw toInventoryError(res.error) }
      return (res.data || []).map(mapPaymentException)
    },
    /** status = 'refunded' (needs `reference`) | 'resolved' (needs `note`) */
    async resolvePaymentException(id, { status, reference = null, note = null }) {
      const d = await rpc('resolve_payment_exception', { p_id: id, p_status: status, p_reference: reference || null, p_note: note || null })
      return { already: !!d.already, status: d.status }
    },

    // ───────── the order lifecycle ─────────
    /** cancel an order BEFORE shipment (stock back once; a paid order also gets a refund row to send / record). Idempotent: the second call answers `already`. */
    async cancelOrder({ orderId, reason, refundMethod = null, key = null, note = null }) {
      const d = await rpc('cancel_order', { p_order_id: orderId, p_reason: reason, p_refund_method: refundMethod, p_idempotency_key: key, p_internal_note: note || null })
      return {
        already: !!d.already, legacy: !!d.legacy, orderStatus: d.order_status, refundId: d.refund_id || null, refundNo: d.refund_no || '',
        refundAmount: d.refund_amount == null ? null : Number(d.refund_amount), refundMethod: d.refund_method || '', stockRestored: Array.isArray(d.stock_restored) ? d.stock_restored : [],
      }
    },
    /** a refund of any paid order up to what is still refundable (a failed cancellation refund, goodwill, an exchange cancelled after the item came back). Idempotent on `key`. */
    async createOrderRefund({ orderId, amount, method, reason, key, requestId = null, note = null }) {
      const d = await rpc('create_order_refund', {
        p_order_id: orderId, p_amount: Number(amount), p_method: method, p_reason: reason, p_idempotency_key: key, p_request_id: requestId || null, p_note: note || null,
      })
      return { created: !!d.created, refundId: d.refund_id, refundNo: d.refund_no, status: d.status, amount: Number(d.amount), method: d.method }
    },
    /** what each stage of the order permits (the documented matrix) - for showing / hiding buttons */
    async orderOperations(orderId) { return rpc('get_order_operations', { p_order_id: orderId }) },
    /** the cancellation record of an order with the staff side (who, the internal note), or null */
    async orderCancellation(orderId) {
      const res = await client.from('order_cancellations').select('order_id, reason, refund_id, stock_restored, cancelled_at, order_cancellation_private(cancelled_by, internal_note)').eq('order_id', orderId)
      if (res.error) { if (isInventoryUnavailable(res.error)) return null; throw toInventoryError(res.error) }
      const r = (res.data || [])[0]
      if (!r) return null
      const priv = Array.isArray(r.order_cancellation_private) ? r.order_cancellation_private[0] : r.order_cancellation_private
      return {
        orderId: r.order_id, reason: r.reason, refundId: r.refund_id || null, stockRestored: Array.isArray(r.stock_restored) ? r.stock_restored : [], cancelledAt: r.cancelled_at || null,
        cancelledBy: (priv && priv.cancelled_by) || null, internalNote: (priv && priv.internal_note) || '',
      }
    },
    /** EVERY refund of an order (return, exchange difference, order-level) with the staff notes, lines and history - for the order drawer */
    async orderRefunds(orderId) {
      const res = await client.from('refunds').select(REFUNDS_SELECT_ADMIN).eq('order_id', orderId).order('created_at', { ascending: false })
      if (res.error) { if (isInventoryUnavailable(res.error)) return []; throw toInventoryError(res.error) }
      return mapRefundRows(res.data)
    },
  }
}