// Returns / exchanges service: the ONE place the website talks to the request tables / RPCs / the private evidence bucket
// (migrations 20261017_04_return_requests.sql, 20261017_05_return_workflow.sql, 20261017_06_refunds.sql, 20261017_07_exchange_fulfilment.sql).
// The Supabase client is INJECTED (createReturnsService(client)) so this file has no npm imports and is unit-tested with a fake client
// (src/services/returns/__tests__/returnsService.test.mjs). services/returns/index.js wires the real client. The RN app has a twin at
// src/services/returns.js (customer functions only - no admin screens exist there, by design).
import {
  EVIDENCE_MAX_FILES, REQUESTS_COLUMNS_CUSTOMER, REQUESTS_SELECT_ADMIN, evidenceFileError, evidencePath, mapRequestRow, mapRequestRows,
} from '../../features/returns/requestModel.js'
import { SHIPMENT_EVENT_COLUMNS, mapShipmentRows } from '../../features/orders/shipmentModel.js'
import { mapReason, reasonRow } from '../../features/returns/admin/reasonsModel.js'
import { REFUNDS_COLUMNS_CUSTOMER, REFUNDS_COLUMNS_ORDER, REFUNDS_SELECT_ADMIN, mapCalculation, mapRefundRows } from '../../features/returns/refundModel.js'
import {
  ADJUSTMENT_COLUMNS_CUSTOMER, ADJUSTMENT_SELECT_ADMIN, REPLACEMENT_COLUMNS_CUSTOMER, RESERVATIONS_COLUMNS_ADMIN, buildReplacementMap, mapAdjustmentRow, mapAdjustmentRows,
  mapFulfilmentRow, mapFulfilmentRows, mapReservationRows, shipReplacementArgs,
} from '../../features/returns/exchangeModel.js'

export const EVIDENCE_BUCKET = 'return-evidence'

/** A PostgREST / storage error -> an Error whose message is fit for a toast. The database messages are already readable. */
export function toReturnsError(err) {
  const e = new Error(friendly(err))
  e.code = err?.code || ''
  e.detail = err?.details || err?.detail || ''
  e.original = err
  return e
}
function friendly(err) {
  const code = err?.code
  const msg = String(err?.message || 'Something went wrong')
  if (code === 'PGRST202' || code === '42883') return 'Returns are not available on the server yet: the database update (returns migration) has not been applied.'
  if (code === '23505') return 'A request for one of these items already exists.'
  if (code === '42501' && /permission denied/i.test(msg)) return 'You do not have permission to do that.'
  return msg
}

/** True while the returns tables / functions are missing on the server (SQL not applied yet): screens hide the feature instead of failing. */
export function isReturnsUnavailable(error) {
  if (!error) return false
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(error.code)) return true       // 42703 = a column of a newer migration is missing
  const m = String(error.message || '')
  return /(get_order_eligibility|return_requests|request_reasons)/i.test(m) && /not find|does not exist|schema cache/i.test(m)
}

/** camelCase admin / customer fields -> the RPC argument objects (kept here so screens never spell parameter names) */
export const logisticsArgs = (requestId, f) => ({
  p_request_id: requestId,
  p_method: f.method,
  p_instructions: f.instructions || null,
  p_courier_code: f.courierCode || null,
  p_courier_name: f.courierName || null,
  p_tracking_number: f.trackingNumber || null,
  p_tracking_url: f.trackingUrl || null,
  p_pickup_reference: f.pickupReference || null,
  p_shipped_at: f.shippedAt || null,
  p_charges: f.charges === '' || f.charges == null ? null : Number(f.charges),
  p_note: f.note || null,
})

/**
 * The Edge Function that talks to Razorpay (refund-create). `callFunction(name, body)` = utils/edgeFunctions.callFunction ({ res, data }); it is
 * INJECTED like the Supabase client, so this file stays free of imports and testable with a fake.
 */
async function callRefundFunction(deps, body) {
  if (!deps || typeof deps.callFunction !== 'function') throw new Error('The refund service is not connected to the server functions')
  const { res, data } = await deps.callFunction('refund-create', body)
  if (!res.ok || !data || data.success === false) {
    const e = new Error((data && data.error) || 'The refund could not be processed')
    e.code = (data && data.code) || ''
    throw e
  }
  return { status: data.status || '', gatewayState: data.gatewayState || '', message: data.message || '', refundId: data.refundId || body.refundId }
}

export function createReturnsService(client, deps = {}) {
  const unwrap = (res) => { if (res.error) throw toReturnsError(res.error); return res.data }
  const rpc = async (name, args) => unwrap(await client.rpc(name, args))

  return {
    // ───────── customer ─────────
    /** get_order_eligibility(): what every line of the order can do. Returns null when the feature is not on the server yet. */
    async eligibility(orderId) {
      const res = await client.rpc('get_order_eligibility', { p_order_id: orderId })
      if (res.error) { if (isReturnsUnavailable(res.error)) return null; throw toReturnsError(res.error) }
      return res.data
    },
    /** the configurable reasons (active ones; the admin sees all) */
    async reasons() {
      const res = await client.from('request_reasons').select('code, label, applies_to, seller_fault, requires_evidence, requires_description, active, sort_order').order('sort_order', { ascending: true })
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return res.data || []
    },
    /**
     * Uploads the photos to <uid>/<request id>/<n>-<name>.<ext> in the PRIVATE bucket. `files` = [{ name, type, size, body }] (body: File / Blob / ArrayBuffer).
     * All-or-nothing: if one fails the ones already stored are removed again. Returns [{ path, mime, size }] for create_return_request().
     */
    async uploadEvidence({ uid, requestId, files, startIndex = 0 }) {
      const list = files || []
      if (list.length + startIndex > EVIDENCE_MAX_FILES) throw new Error(`At most ${EVIDENCE_MAX_FILES} photos`)
      for (const f of list) { const bad = evidenceFileError(f); if (bad) throw new Error(bad) }
      const stored = []
      try {
        for (let i = 0; i < list.length; i++) {
          // startIndex = photos already stored for this request, so an extra photo never reuses an earlier file name
          const path = evidencePath(uid, requestId, startIndex + i, list[i])
          const { error } = await client.storage.from(EVIDENCE_BUCKET).upload(path, list[i].body, { contentType: list[i].type, upsert: false })
          if (error) throw toReturnsError(error)
          stored.push({ path, mime: list[i].type, size: list[i].size })
        }
      } catch (e) {
        if (stored.length) await client.storage.from(EVIDENCE_BUCKET).remove(stored.map((s) => s.path)).catch(() => {})
        throw e
      }
      return stored
    },
    /** removes uploads that never became a request (the policy only allows this for unsubmitted files) */
    async discardEvidence(paths) {
      if (!paths || !paths.length) return
      await client.storage.from(EVIDENCE_BUCKET).remove(paths).catch(() => {})
    },
    /** `payload` = validateRequestForm(...).payload. Idempotent on p_request_id. */
    async submit(payload) {
      const d = await rpc('create_return_request', payload)
      return { created: !!d.created, requestId: d.request_id, requestNo: d.request_no, status: d.status }
    },
    async cancel(requestId, note = null) {
      const d = await rpc('cancel_return_request', { p_request_id: requestId, p_note: note || null })
      return { already: !!d.already, status: d.status }
    },
    async respond(requestId, message, evidence = []) {
      const d = await rpc('respond_to_request', { p_request_id: requestId, p_message: message || null, p_evidence: evidence })
      return { status: d.status }
    },
    /** "I sent it myself": courier + tracking number of the parcel (customer-arranged returns) */
    async submitReturnTracking({ requestId, courierName, trackingNumber = null, trackingUrl = null, shippedAt = null }) {
      const d = await rpc('customer_submit_return_shipment', {
        p_request_id: requestId, p_courier_name: courierName, p_tracking_number: trackingNumber || null, p_tracking_url: trackingUrl || null, p_shipped_at: shippedAt,
      })
      return { status: d.status, shipmentId: d.shipment_id }
    },
    /** this customer's requests for ONE order (newest first) with lines, photos (paths) and the customer-visible history */
    async listForOrder(orderId) {
      const res = await client.from('return_requests').select(REQUESTS_COLUMNS_CUSTOMER).eq('order_id', orderId).order('created_at', { ascending: false })
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return mapRequestRows(res.data)
    },
    /** all of this customer's requests, newest first */
    async listMine() {
      const res = await client.from('return_requests').select(REQUESTS_COLUMNS_CUSTOMER).order('created_at', { ascending: false })
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return mapRequestRows(res.data)
    },
    /** the return parcels of these requests as the CUSTOMER may see them (courier, tracking, pickup reference, history; never charges) */
    async returnShipmentsFor(requestIds) {
      if (!requestIds || !requestIds.length) return []
      const res = await client.from('shipments').select(`*, shipment_items(order_item_id, quantity), shipment_events(${SHIPMENT_EVENT_COLUMNS})`).in('request_id', requestIds).eq('direction', 'return')
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return mapShipmentRows(res.data)
    },
    /** the refunds of these requests as the CUSTOMER may see them (amounts, state, reference, a safe failure reason; never the staff notes) */
    async refundsForRequests(requestIds) {
      if (!requestIds || !requestIds.length) return []
      const res = await client.from('refunds').select(REFUNDS_COLUMNS_CUSTOMER).in('request_id', requestIds).order('created_at', { ascending: false })
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return mapRefundRows(res.data)
    },
    /** the refunds of ONE order that belong to no return request (a cancelled order, an exchange cancelled after the item came back), newest first, with the customer-readable reason */
    async refundsForOrder(orderId) {
      if (!orderId) return []
      const res = await client.from('refunds').select(REFUNDS_COLUMNS_ORDER).eq('order_id', orderId).eq('kind', 'order').order('created_at', { ascending: false })
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return mapRefundRows(res.data)
    },
    /** why this order was cancelled (what the customer was told), or null when it was not cancelled through the app / the feature is not on the server yet */
    async cancellationForOrder(orderId) {
      if (!orderId) return null
      const res = await client.from('order_cancellations').select('order_id, reason, refund_id, cancelled_at').eq('order_id', orderId)
      if (res.error) { if (isReturnsUnavailable(res.error)) return null; throw toReturnsError(res.error) }
      const row = (res.data || [])[0]
      return row ? { orderId: row.order_id, reason: row.reason, refundId: row.refund_id || null, cancelledAt: row.cancelled_at || null } : null
    },
    /**
     * The replacement of these EXCHANGES as the CUSTOMER may see it: { [requestId]: { fulfilment, adjustment, shipment } } - the replacement record with its lines,
     * the price difference, and the live replacement parcel (courier, tracking; never charges). The stock reservations and the staff notes are never selected.
     * Returns {} while the exchange tables are missing on the server (the SQL is not applied yet).
     */
    async replacementsFor(requestIds) {
      if (!requestIds || !requestIds.length) return {}
      const [f, a, s] = await Promise.all([
        client.from('replacement_fulfillments').select(REPLACEMENT_COLUMNS_CUSTOMER).in('request_id', requestIds),
        client.from('exchange_adjustments').select(ADJUSTMENT_COLUMNS_CUSTOMER).in('request_id', requestIds),
        client.from('shipments').select(`*, shipment_items(order_item_id, quantity), shipment_events(${SHIPMENT_EVENT_COLUMNS})`).in('request_id', requestIds).eq('direction', 'replacement'),
      ])
      for (const res of [f, a, s]) if (res.error) { if (isReturnsUnavailable(res.error)) return {}; throw toReturnsError(res.error) }
      return buildReplacementMap(mapFulfilmentRows(f.data), mapAdjustmentRows(a.data), mapShipmentRows(s.data))
    },
    /** short-lived links for the private photos: { [path]: url } */
    async signedEvidenceUrls(paths, expiresIn = 3600) {
      if (!paths || !paths.length) return {}
      const { data, error } = await client.storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, expiresIn)
      if (error) throw toReturnsError(error)
      return Object.fromEntries((data || []).filter((d) => d && d.signedUrl).map((d) => [d.path, d.signedUrl]))
    },

    // ───────── admin (website only) ─────────
    /** the admin list: one type, optional status filter, newest first; includes the order, private note and everything */
    async adminList({ type, status = null, limit = 200 } = {}) {
      let q = client.from('return_requests').select(REQUESTS_SELECT_ADMIN).order('created_at', { ascending: false }).limit(limit)
      if (type) q = q.eq('type', type)
      if (status) q = q.eq('status', status)
      const res = await q
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return mapRequestRows(res.data)
    },
    async adminGet(requestId) {
      const res = await client.from('return_requests').select(REQUESTS_SELECT_ADMIN).eq('id', requestId).single()
      if (res.error) throw toReturnsError(res.error)
      return mapRequestRow(res.data)
    },
    /** the return shipment(s) of a request (courier, tracking, pickup reference + the admin-only charges) */
    async returnShipments(requestId) {
      const res = await client.from('shipments').select('*, shipment_private(charges, note), shipment_events(id, event_type, occurred_at, location, description, created_at)').eq('request_id', requestId).eq('direction', 'return').order('created_at', { ascending: true })
      if (res.error) throw toReturnsError(res.error)
      return mapShipmentRows(res.data)
    },
    /** the shipments that DELIVERED this order to the customer (courier, tracking), for the admin's request view */
    async outboundShipments(orderId) {
      const res = await client.from('shipments').select('*, shipment_private(charges, note), shipment_events(id, event_type, occurred_at, location, description, created_at)').eq('order_id', orderId).eq('direction', 'outbound').order('created_at', { ascending: true })
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return mapShipmentRows(res.data)
    },
    /** items = [{ item_id, decision: 'approve' | 'reject', note }] */
    async decide(requestId, items, { internalNote = null, customerNote = null } = {}) {
      const d = await rpc('decide_request_items', { p_request_id: requestId, p_decisions: items, p_internal_note: internalNote, p_customer_note: customerNote })
      return { status: d.status, approved: d.approved, rejected: d.rejected, pending: d.pending }
    },
    async transition(requestId, toStatus, { note = null, customerNote = null } = {}) {
      const d = await rpc('request_transition', { p_request_id: requestId, p_to_status: toStatus, p_note: note, p_customer_note: customerNote })
      return { status: d.status }
    },
    async setLogistics(requestId, fields) {
      const d = await rpc('set_return_logistics', logisticsArgs(requestId, fields))
      return { status: d.status, method: d.method, shipmentId: d.shipment_id }
    },
    async markReceived(requestId, { receivedAt = null, note = null } = {}) {
      const d = await rpc('record_return_received', { p_request_id: requestId, p_received_at: receivedAt, p_note: note })
      return { status: d.status }
    },
    /** results = [{ item_id, result: 'passed' | 'failed', note }] */
    async inspect(requestId, results, internalNote = null) {
      const d = await rpc('record_inspection', { p_request_id: requestId, p_results: results, p_internal_note: internalNote })
      return { status: d.status, passed: d.passed, failed: d.failed, waiting: d.waiting }
    },
    async message(requestId, text) { await rpc('send_request_message', { p_request_id: requestId, p_message: text }) },
    async internalNote(requestId, text) { await rpc('set_request_internal_note', { p_request_id: requestId, p_note: text }) },

    // ───────── refunds (admin; Phase 9) ─────────
    /** what a refund of this request would be (server arithmetic: refund_calculate) - nothing is written */
    async refundCalculate(requestId, { includeShipping = null, adjustment = 0 } = {}) {
      return mapCalculation(await rpc('refund_calculate', { p_request_id: requestId, p_include_shipping: includeShipping, p_adjustment: Number(adjustment) || 0 }))
    },
    /** creates the refund (idempotent on `key`: a retry returns the same refund) and moves the request to "refund pending" */
    async createRefund({ requestId, key, method, includeShipping = null, adjustment = 0, adjustmentNote = null, note = null }) {
      const d = await rpc('create_refund', {
        p_request_id: requestId, p_idempotency_key: key, p_method: method, p_include_shipping: includeShipping, p_adjustment: Number(adjustment) || 0,
        p_adjustment_note: adjustmentNote || null, p_note: note || null,
      })
      return { created: !!d.created, refundId: d.refund_id, refundNo: d.refund_no, status: d.status, amount: Number(d.amount), method: d.method, requestStatus: d.request_status || null }
    },
    /** manual refund: "I paid it" (needs the reference) / "it failed" (needs a reason the customer can read) */
    async markRefund(refundId, outcome, { reference = null, note = null, completedAt = null } = {}) {
      const d = await rpc('refund_mark_manual', { p_refund_id: refundId, p_outcome: outcome, p_reference: reference, p_note: note, p_completed_at: completedAt })
      return { status: d.status, already: !!d.already }
    },
    /** cancels a refund that has not paid anything out yet */
    async voidRefund(refundId, reason) {
      const d = await rpc('refund_void', { p_refund_id: refundId, p_reason: reason })
      return { status: d.status, already: !!d.already }
    },
    /** gateway refund: sends it to Razorpay through the Edge Function (never twice: the server claims it first) */
    async sendRefund(refundId) { return callRefundFunction(deps, { refundId, action: 'send' }) },
    /** gateway refund: asks Razorpay what happened to it (after a lost answer, or to see a pending one finish) */
    async checkRefund(refundId) { return callRefundFunction(deps, { refundId, action: 'reconcile' }) },
    /** the refunds of ONE request with the staff notes, lines and history */
    async adminRefundsForRequest(requestId) {
      const res = await client.from('refunds').select(REFUNDS_SELECT_ADMIN).eq('request_id', requestId).order('created_at', { ascending: false })
      if (res.error) { if (isReturnsUnavailable(res.error)) return []; throw toReturnsError(res.error) }
      return mapRefundRows(res.data)
    },
    // ───────── exchanges: the replacement (admin; Phase 10) ─────────
    /**
     * Everything the admin's Replacement panel shows for ONE exchange: { fulfilment, adjustment (with the staff reference / note), reservations, shipments }.
     * Empty (all null / []) while the exchange tables are missing on the server.
     */
    async adminReplacement(requestId) {
      const [f, a, r, s] = await Promise.all([
        client.from('replacement_fulfillments').select(REPLACEMENT_COLUMNS_CUSTOMER).eq('request_id', requestId),
        client.from('exchange_adjustments').select(ADJUSTMENT_SELECT_ADMIN).eq('request_id', requestId),
        client.from('exchange_reservations').select(RESERVATIONS_COLUMNS_ADMIN).eq('request_id', requestId),
        client.from('shipments').select('*, shipment_items(order_item_id, quantity), shipment_private(charges, note), shipment_events(id, event_type, occurred_at, location, description, created_at)').eq('request_id', requestId).eq('direction', 'replacement').order('created_at', { ascending: true }),
      ])
      for (const res of [f, a, r, s]) if (res.error) { if (isReturnsUnavailable(res.error)) return { fulfilment: null, adjustment: null, reservations: [], shipments: [] }; throw toReturnsError(res.error) }
      return { fulfilment: mapFulfilmentRow((f.data || [])[0]), adjustment: mapAdjustmentRow((a.data || [])[0]), reservations: mapReservationRows(r.data), shipments: mapShipmentRows(s.data) }
    },
    /** names of product variants by id (the admin's request view says "White", not "var_17000..."): { [variantId]: name }. A label is a convenience: any error gives {}. */
    async variantNames(variantIds) {
      const ids = [...new Set((variantIds || []).filter(Boolean))]
      if (!ids.length) return {}
      const res = await client.from('product_variants').select('id, name').in('id', ids)
      if (res.error) return {}
      return Object.fromEntries((res.data || []).map((v) => [v.id, v.name]))
    },
    /** `payload` = shipmentModel.validateShipForm(...).payload (the replacement takes the same courier / tracking / charges fields). Idempotent on courier + tracking number. */
    async shipReplacement(requestId, payload) {
      const d = await rpc('ship_replacement', shipReplacementArgs(requestId, payload))
      return { created: !!d.created, shipmentId: d.shipment_id, status: d.status }
    },
    async markReplacementDelivered(requestId, { deliveredAt = null, note = null } = {}) {
      const d = await rpc('mark_replacement_delivered', { p_request_id: requestId, p_delivered_at: deliveredAt, p_note: note })
      return { already: !!d.already, status: d.status }
    },
    /** resolution = 'collected' (needs `reference`) | 'waived' (needs `note`) */
    async settleAdjustment(requestId, resolution, { reference = null, note = null } = {}) {
      const d = await rpc('settle_exchange_adjustment', { p_request_id: requestId, p_resolution: resolution, p_reference: reference || null, p_note: note || null })
      return { already: !!d.already, status: d.status }
    },
    /** a refund of the price difference (the replacement is cheaper); then sent / recorded with sendRefund / markRefund like any refund. Idempotent on `key`. */
    async createExchangeRefund({ requestId, key, method, note = null }) {
      const d = await rpc('create_exchange_refund', { p_request_id: requestId, p_idempotency_key: key, p_method: method, p_note: note || null })
      return { created: !!d.created, refundId: d.refund_id, refundNo: d.refund_no, status: d.status, amount: Number(d.amount), method: d.method }
    },
    /**
     * The admin editor of the configurable reasons (Optimization -> "Return & exchange reasons"): creates or updates one request_reasons row. The reason CODE never
     * changes once saved (requests refer to it) and a reason is never deleted - switch it off. RLS lets only an admin write the table; the database's CHECKs
     * repeat the rules of validateReason() (features/returns/admin/reasonsModel.js), which the card runs first.
     */
    async saveReason(value) {
      const row = unwrap(await client.from('request_reasons').upsert(reasonRow(value), { onConflict: 'code' }).select().single())
      return mapReason(row)
    },
    /** counts for the admin tabs: { return: { pending_review: n, ... }, exchange: {...} } */
    async adminCounts() {
      const res = await client.from('return_requests').select('type, status')
      if (res.error) { if (isReturnsUnavailable(res.error)) return { return: {}, exchange: {} }; throw toReturnsError(res.error) }
      const out = { return: {}, exchange: {} }
      for (const r of res.data || []) { const bucket = out[r.type] || (out[r.type] = {}); bucket[r.status] = (bucket[r.status] || 0) + 1 }
      return out
    },
  }
}