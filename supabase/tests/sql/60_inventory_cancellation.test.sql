-- needs: m6
-- reapply: 20261017_08_inventory_cancellation.sql
-- Phases 11-12 — M6: what a returned item does to stock (only AFTER the inspection: restock / kept as unsellable / no record), stock reports (reconciliation,
-- gaps, unsellable), cancel_order (before shipment only; the stock the order took goes back once, a paid order gets a refund, one notification), the order-level
-- refund tool, the permitted-operation matrix, privacy. Orders are placed with the REAL create_order_tx so stock and the ledger are real.
-- ("reapply" = the runner applies the migration a SECOND time before this script: the idempotency test.)
begin;

create or replace function t.vstock(p_v text) returns integer language sql security definer as $$ select stock from public.product_variants where id = p_v $$;
create or replace function t.pstock(p_p text) returns integer language sql security definer as $$ select stock from public.products where id = p_p $$;
create or replace function t.status(p_req uuid) returns text language sql security definer as $$ select status from public.return_requests where id = p_req $$;
create or replace function t.ostatus(p_o text) returns text language sql security definer as $$ select order_status from public.orders where id = p_o $$;
create or replace function t.rstatus(p_refund uuid) returns text language sql security definer as $$ select status from public.refunds where id = p_refund $$;
create or replace function t.notified(p_uid uuid, p_title text) returns integer language sql security definer as $$ select count(*)::int from public.notifications where user_id = p_uid and title = p_title $$;
create or replace function t.item_of(p_req uuid) returns uuid language sql security definer as $$ select id from public.return_request_items where request_id = p_req order by created_at, id limit 1 $$;
create or replace function t.moves(p_ref text, p_type text) returns integer language sql security definer as $$ select count(*)::int from public.inventory_logs where ref_id = p_ref and movement_type = p_type $$;
create or replace function t.omoves(p_order text, p_type text) returns integer language sql security definer as $$ select count(*)::int from public.inventory_logs where order_id = p_order and movement_type = p_type $$;
create or replace function t.unsell(p_product text, p_variant text default '') returns integer language sql security definer as $$
  select coalesce(sum(change), 0)::int from public.inventory_logs where product_id = p_product and variant_id = p_variant and bucket = 'unsellable' $$;
create or replace function t.line_id(p_order text, p_product text, p_variant text default '') returns text language sql security definer as $$
  select id::text from public.order_items where order_id = p_order and product_id = p_product and variant_id = p_variant order by id limit 1 $$;
create or replace function t.xi(p_order_item text, p_qty int, p_replacement_variant text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('order_item_id', p_order_item, 'quantity', p_qty, 'replacement_variant_id', p_replacement_variant))
$$;
-- one p_items element of create_order_tx
create or replace function t.sale(p_product text, p_variant text, p_qty int, p_unit numeric) returns jsonb language sql as $$
  select jsonb_build_object('product_id', p_product, 'variant_id', nullif(p_variant, ''), 'variant_name', null, 'title', 'Item ' || p_product, 'quantity', p_qty, 'unit_price', p_unit,
                            'discount', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'line_total', p_qty * p_unit)
$$;
-- an order placed through the REAL create_order_tx (stock deducted, ledger written)
create or replace function t.place(p_id text, p_user uuid, p_items jsonb, p_paid boolean default true, p_method text default 'Razorpay') returns void
language plpgsql as $$
declare v_total numeric;
begin
  select coalesce(sum((e.value ->> 'line_total')::numeric), 0) into v_total from jsonb_array_elements(p_items) e;
  perform public.create_order_tx(p_order_id := p_id, p_user_id := p_user, p_items := p_items, p_order_status := 'placed', p_payment_status := case when p_paid then 'paid' else 'pending' end,
    p_payment_method := p_method, p_source := 'online', p_customer_name := 'T', p_customer_email := 't@example.test', p_customer_phone := '9999999999', p_address := '{}'::jsonb,
    p_subtotal := v_total, p_shipping := 0, p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := v_total,
    p_razorpay_order_id := case when p_method = 'Razorpay' then 'rzp_' || p_id end, p_razorpay_payment_id := case when p_method = 'Razorpay' and p_paid then 'pay_' || p_id end);
end $$;
create or replace function t.delivered_order(p_id text, p_user uuid, p_items jsonb, p_paid boolean default true, p_method text default 'Razorpay') returns void
language plpgsql as $$
begin
  perform t.place(p_id, p_user, p_items, p_paid, p_method);
  perform t.as_user(t.admin());
  perform public.ship_order(p_id, 'manual');
  perform public.mark_delivered(p_id);
  perform t.as_postgres();
end $$;
-- a return / exchange request taken to "parcel received, waiting for inspection" (every line approved). Leaves the session as postgres.
create or replace function t.ret_received(p_uid uuid, p_order text, p_type text, p_items jsonb) returns uuid
language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  d jsonb;
begin
  perform t.as_user(p_uid);
  perform public.create_return_request(v, p_order, p_type, p_items, 'incorrect_size');
  perform t.as_user(t.admin());
  select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')), '[]'::jsonb) into d from public.return_request_items where request_id = v;
  perform public.decide_request_items(v, d);
  perform public.set_return_logistics(v, 'manual', 'Please post the items to us');
  perform public.record_return_received(v);
  perform t.as_postgres();
  return v;
end $$;
create or replace function t.inspect(p_req uuid, p_result text, p_disposition text default null) returns void
language plpgsql as $$
begin
  perform t.as_user(t.admin());
  perform public.record_inspection(p_req, (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item_id', id, 'result', p_result, 'disposition', p_disposition,
                                                                                                'note', case when p_result = 'failed' then 'Not the item we sold' end)))
                                              from public.return_request_items where request_id = p_req));
  perform t.as_postgres();
end $$;

-- 1. a returned item goes back on sale ONLY after the inspection, exactly once; refunds never move stock ----------------------------------------------------
do $$
declare
  o   text := 'rs_o1';
  v   uuid;
  it  uuid;
  s0  int;
  lg  public.inventory_logs;
  f   uuid;
  j   jsonb;
begin
  s0 := t.pstock('prod_single_a');
  perform t.delivered_order(o, t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 3, 500)));
  perform t.ok(t.pstock('prod_single_a') = s0 - 3, 'fixture: the order took 3 units');
  v := t.ret_received(t.alice(), o, 'return', jsonb_build_array(t.xi(t.line_id(o, 'prod_single_a'), 2)));
  it := t.item_of(v);
  perform t.ok(t.pstock('prod_single_a') = s0 - 3 and t.moves(it::text, 'return_restock') = 0, 'a request, its approval and the receiving of the parcel move NO stock');
  perform t.ok((select stock_effect from public.return_request_items where id = it) is null and (select disposition from public.return_request_items where id = it) is null, 'nothing recorded yet');

  perform t.inspect(v, 'passed');
  perform t.ok(t.pstock('prod_single_a') = s0 - 1, 'inspection passed: the 2 returned units are back on the counter (47 -> 49)');
  select * into lg from public.inventory_logs where ref_id = it::text and movement_type = 'return_restock';
  perform t.ok(lg.change = 2 and lg.bucket = 'sellable' and lg.order_id = o and lg.idempotency_key = 'retrestock:' || it::text and lg.stock_after = s0 - 1 and lg.actor_kind = 'admin' and lg.ref_type = 'return_request_item',
               'the ledger: +2, sellable, the original order, key retrestock:<line>, the admin');
  perform t.ok((select stock_effect from public.return_request_items where id = it) = 'restocked' and (select disposition from public.return_request_items where id = it) = 'restock', 'the line remembers: restocked');
  perform public.app_after_inspection(it, 'passed');
  perform public.app_after_inspection(it, 'passed');
  perform t.ok(t.pstock('prod_single_a') = s0 - 1 and t.moves(it::text, 'return_restock') = 1, 'repeating the hook changes nothing (one ledger row, same stock)');
  perform t.eq(t.status(v), 'inspection_passed', 'the request is accepted');

  -- money and stock are separate steps: a failed refund, a retry and the payout never touch stock
  perform t.as_user(t.admin());
  f := (public.create_refund(v, 'key-rs-o1-0001', 'manual') ->> 'refund_id')::uuid;
  perform public.refund_mark_manual(f, 'failed', null, 'the bank rejected it');
  perform t.as_postgres();
  perform t.ok(t.pstock('prod_single_a') = s0 - 1, 'a FAILED refund moves no stock');
  perform t.as_user(t.admin());
  f := (public.create_refund(v, 'key-rs-o1-0002', 'manual') ->> 'refund_id')::uuid;
  perform t.as_postgres();
  perform t.ok(t.pstock('prod_single_a') = s0 - 1, 'creating the retry moves no stock');
  perform t.as_user(t.admin());
  perform public.refund_mark_manual(f, 'succeeded', 'UTR-1');
  perform t.as_postgres();
  perform t.ok(t.pstock('prod_single_a') = s0 - 1 and t.rstatus(f) = 'succeeded' and t.status(v) = 'refunded', 'the paid-out refund moves no stock either');
end $$;

-- 2. a variant line restocks ITS OWN counter -------------------------------------------------------------------------------------------------------------
do $$
declare
  o  text := 'rs_o2';
  v  uuid;
  p0 int := t.vstock('var_1700000000001_0');
  m0 int := t.pstock('prod_vmain_ok');
begin
  perform t.delivered_order(o, t.alice(), jsonb_build_array(t.sale('prod_vmain_ok', 'var_1700000000001_0', 2, 300)));
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 2 and t.pstock('prod_vmain_ok') = m0, 'fixture: Pink -2, the main counter untouched');
  v := t.ret_received(t.alice(), o, 'return', jsonb_build_array(t.xi(t.line_id(o, 'prod_vmain_ok', 'var_1700000000001_0'), 1)));
  perform t.inspect(v, 'passed');
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 1 and t.pstock('prod_vmain_ok') = m0, 'Pink gets its unit back (variant counter), the product main counter is untouched');
  perform t.ok((select variant_id from public.inventory_logs where ref_id = t.item_of(v)::text and movement_type = 'return_restock') = 'var_1700000000001_0', 'the ledger names the variant');
end $$;

-- 3. accepted but NOT resellable: kept in the unsellable bucket, sellable stock unchanged -----------------------------------------------------------------------
do $$
declare
  o  text := 'rs_o3';
  v  uuid;
  it uuid;
  s0 int := t.pstock('prod_single_a');
  u0 int := t.unsell('prod_single_a');
  lg public.inventory_logs;
begin
  perform t.delivered_order(o, t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 2, 500)));
  v := t.ret_received(t.alice(), o, 'return', jsonb_build_array(t.xi(t.line_id(o, 'prod_single_a'), 1)));
  it := t.item_of(v);
  perform t.inspect(v, 'passed', 'unsellable');
  perform t.ok(t.pstock('prod_single_a') = s0 - 2, 'sellable stock is NOT raised for a damaged / defective unit');
  select * into lg from public.inventory_logs where ref_id = it::text and movement_type = 'return_unsellable';
  perform t.ok(lg.change = 1 and lg.bucket = 'unsellable' and lg.idempotency_key = 'retunsell:' || it::text and lg.stock_after = s0 - 2, 'the ledger records it in the unsellable bucket (the sellable level is kept for reference)');
  perform t.ok(t.unsell('prod_single_a') = u0 + 1, 'unsellable units +1');
  perform t.ok((select stock_effect from public.return_request_items where id = it) = 'unsellable' and (select disposition from public.return_request_items where id = it) = 'unsellable', 'the line remembers');
  perform t.eq(t.status(v), 'inspection_passed', 'the return is still accepted (refundable)');
  perform t.ok(not exists (select 1 from public.inventory_logs where ref_id = it::text and movement_type = 'return_restock'), 'and nothing was restocked');
end $$;

-- 4. a rejected item: kept as unsellable by default, or no stock record at all; combinations that make no sense are refused ----------------------------------
do $$
declare
  o  text := 'rs_o4';
  v  uuid;
  v2 uuid;
  v3 uuid;
  s0 int := t.pstock('prod_single_a');
  u0 int := t.unsell('prod_single_a');
  d  jsonb;
begin
  perform t.delivered_order(o, t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 3, 500)));
  v := t.ret_received(t.alice(), o, 'return', jsonb_build_array(t.xi(t.line_id(o, 'prod_single_a'), 1)));
  select jsonb_build_array(jsonb_build_object('item_id', id, 'result', 'passed', 'disposition', 'none')) into d from public.return_request_items where request_id = v;
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.record_inspection(%L, %L::jsonb)$q$, v, d::text), '22023', '%either put back on sale%');
  select jsonb_build_array(jsonb_build_object('item_id', id, 'result', 'failed', 'note', 'worn', 'disposition', 'restock')) into d from public.return_request_items where request_id = v;
  perform t.fails(format($q$select public.record_inspection(%L, %L::jsonb)$q$, v, d::text), '22023', '%rejected item is either kept%');
  select jsonb_build_array(jsonb_build_object('item_id', id, 'result', 'passed', 'disposition', 'bogus')) into d from public.return_request_items where request_id = v;
  perform t.fails(format($q$select public.record_inspection(%L, %L::jsonb)$q$, v, d::text), '22023');
  perform t.as_postgres();
  perform t.ok(t.status(v) = 'inspection_pending' and t.pstock('prod_single_a') = s0 - 3 and t.unsell('prod_single_a') = u0, 'refused inspections changed nothing');

  perform t.inspect(v, 'failed');                              -- default: kept as unsellable (we hold the parcel)
  perform t.ok(t.pstock('prod_single_a') = s0 - 3 and t.unsell('prod_single_a') = u0 + 1 and (select stock_effect from public.return_request_items where id = t.item_of(v)) = 'unsellable',
               'a failed line is recorded as unsellable by default; sellable stock unchanged');
  perform t.eq(t.status(v), 'inspection_failed', 'and the return is not accepted');

  v2 := t.ret_received(t.alice(), o, 'return', jsonb_build_array(t.xi(t.line_id(o, 'prod_single_a'), 1)));
  perform t.inspect(v2, 'failed', 'none');                     -- sent back to the customer: no stock record
  perform t.ok(t.unsell('prod_single_a') = u0 + 1 and not exists (select 1 from public.inventory_logs where ref_id = t.item_of(v2)::text) and (select stock_effect from public.return_request_items where id = t.item_of(v2)) = 'none',
               'disposition none: no ledger row at all');
  v3 := t.ret_received(t.alice(), o, 'return', jsonb_build_array(t.xi(t.line_id(o, 'prod_single_a'), 1)));
  perform t.inspect(v3, 'passed');
  perform t.ok(t.pstock('prod_single_a') = s0 - 2, 'the third unit of that order, accepted: +1');
end $$;

-- 5. an EXCHANGE: the returned item and the replacement are accounted for separately ------------------------------------------------------------------------
do $$
declare
  o  text := 'rs_o5';
  v  uuid;
  p0 int := t.vstock('var_1700000000001_0');
  w0 int := t.vstock('var_1700000000001_1');
begin
  perform t.delivered_order(o, t.alice(), jsonb_build_array(t.sale('prod_vmain_ok', 'var_1700000000001_0', 1, 300)));
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 1, 'fixture: Pink -1 for the order');
  v := t.ret_received(t.alice(), o, 'exchange', jsonb_build_array(t.xi(t.line_id(o, 'prod_vmain_ok', 'var_1700000000001_0'), 1, 'var_1700000000001_1')));
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 1 and t.vstock('var_1700000000001_0') = p0 - 1, 'approval reserved the replacement (White -1); the returned Pink is not back yet');
  perform t.inspect(v, 'passed');
  perform t.ok(t.vstock('var_1700000000001_0') = p0 and t.vstock('var_1700000000001_1') = w0 - 1, 'inspection: the returned Pink is back on its own counter; White stays reserved');
  perform t.ok(exists (select 1 from public.inventory_logs where ref_id = t.item_of(v)::text and movement_type = 'exchange_reserve' and variant_id = 'var_1700000000001_1')
               and exists (select 1 from public.inventory_logs where ref_id = t.item_of(v)::text and movement_type = 'return_restock' and variant_id = 'var_1700000000001_0'),
               'the ledger has both movements for the same line, on different counters');
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'replacement_pending');
  perform public.ship_replacement(v, 'manual', null, 'TRK-RS5');
  perform public.mark_replacement_delivered(v);
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_0') = p0 and t.vstock('var_1700000000001_1') = w0 - 1, 'after the replacement shipped and arrived nothing moved again');
end $$;

-- 6. an option that does not track inventory: nothing to restock, the unsellable record is still kept ----------------------------------------------------------
do $$
declare
  o  text := 'rs_o6';
  v  uuid;
  v2 uuid;
begin
  perform t.delivered_order(o, t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 2, 500)));
  update public.products set track_inventory = false where id = 'prod_single_a';
  v := t.ret_received(t.alice(), o, 'return', jsonb_build_array(t.xi(t.line_id(o, 'prod_single_a'), 1)));
  perform t.inspect(v, 'passed');
  perform t.ok((select stock_effect from public.return_request_items where id = t.item_of(v)) = 'none' and not exists (select 1 from public.inventory_logs where ref_id = t.item_of(v)::text),
               'untracked: nothing restocked, no ledger row, the line says "none"');
  perform t.delivered_order('rs_o6b', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));          -- placed while untracked: no stock moves, no ledger row
  v2 := t.ret_received(t.alice(), 'rs_o6b', 'return', jsonb_build_array(t.xi(t.line_id('rs_o6b', 'prod_single_a'), 1)));
  perform t.inspect(v2, 'passed', 'unsellable');
  perform t.ok((select stock_effect from public.return_request_items where id = t.item_of(v2)) = 'unsellable' and t.moves(t.item_of(v2)::text, 'return_unsellable') = 1, 'the unsellable record is kept even for an untracked option');
  update public.products set track_inventory = true where id = 'prod_single_a';
end $$;

-- 7. the reports: unsellable summary, reconciliation, gaps; admin only ------------------------------------------------------------------------------------
do $$
declare
  r  record;
  n  int;
  s  int;
  o  text := 'rs_o7';
begin
  perform t.as_user(t.admin());
  select count(*) into n from public.inventory_reconcile();
  perform t.ok(n = 0, 'after all the flows above the sellable counters agree with the ledger (no drift)');
  select count(*) into n from public.inventory_gaps();
  perform t.ok(n = 0, 'and the ledger has no gaps');
  select * into r from public.inventory_unsellable_summary() where product_id = 'prod_single_a';
  perform t.ok(r.units = 3 and r.movements = 3 and r.variant_id = '' and r.title = 'Classic Cotton Shirt', 'unsellable units of the shirt: 1 (accepted, not resellable: section 3) + 1 (failed: section 4) + 1 (untracked option: section 6) = 3');
  perform t.as_postgres();

  -- stock changed WITHOUT the ledger (a direct edit): the drift shows up, with its size
  update public.products set stock = stock + 5 where id = 'prod_single_a';
  perform t.as_user(t.admin());
  select * into r from public.inventory_reconcile() where product_id = 'prod_single_a';
  perform t.ok(r.drift = 5 and r.actual_stock = r.ledger_stock + 5 and r.variant_id = '' and r.movements > 0, 'a direct stock edit shows as drift +5');
  perform t.ok((select count(*) from public.inventory_reconcile(false)) >= 3, 'the full list (not only the drifting ones) has every option the ledger knows');
  perform t.as_postgres();
  -- the next sale starts from the edited counter: the chain of the ledger now has a visible break
  perform t.place(o, t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.as_user(t.admin());
  select * into r from public.inventory_gaps() where product_id = 'prod_single_a' limit 1;
  perform t.ok(r.missing = 5 and r.movement_type = 'sale' and r.change = -1, 'the gap report points at the movement after the edit: 5 units appeared outside the ledger');
  select count(*) into n from public.inventory_reconcile() where product_id = 'prod_single_a';
  perform t.ok(n = 0, 'the counter still equals the ledger after that sale (stock_after follows the real counter) - the gap report is what remembers the edit');
  perform t.as_postgres();

  -- who may read them
  perform t.as_user(t.alice());
  perform t.fails($q$select * from public.inventory_reconcile()$q$, '42501', 'Admin access required');
  perform t.fails($q$select * from public.inventory_gaps()$q$, '42501', 'Admin access required');
  perform t.fails($q$select * from public.inventory_unsellable_summary()$q$, '42501', 'Admin access required');
  perform t.as_anon();
  perform t.fails($q$select * from public.inventory_reconcile()$q$, '42501');
  perform t.as_postgres();
  select stock into s from public.products where id = 'prod_single_a';
end $$;

-- 8. cancel_order, an UNPAID (COD) order: stock back exactly once, no refund, one notification ---------------------------------------------------------------------
do $$
declare
  o   text := 'co_o1';
  s0  int := t.pstock('prod_single_a');
  p0  int := t.vstock('var_1700000000001_1');
  j   jsonb;
begin
  perform t.place(o, t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 2, 500), t.sale('prod_vmain_ok', 'var_1700000000001_1', 1, 200)), false, 'COD');
  perform t.ok(t.pstock('prod_single_a') = s0 - 2 and t.vstock('var_1700000000001_1') = p0 - 1, 'fixture: the order took 2 shirts and 1 White');
  perform t.as_user(t.admin());
  j := public.cancel_order(o, 'The customer asked us to cancel');
  perform t.as_postgres();
  perform t.ok(not (j ->> 'already')::boolean and j ->> 'order_status' = 'cancelled' and j -> 'refund_id' = 'null'::jsonb, 'cancelled; no refund (nothing was paid)');
  perform t.eq(t.ostatus(o), 'cancelled', 'the order status is cancelled');
  perform t.ok(t.pstock('prod_single_a') = s0 and t.vstock('var_1700000000001_1') = p0, 'the stock the order took is back on the SAME counters (shirt +2, White +1)');
  perform t.ok(t.omoves(o, 'cancel_restock') = 2 and exists (select 1 from public.inventory_logs where idempotency_key = 'cancel:' || o || ':prod_single_a:'), 'two cancel_restock ledger rows, keys cancel:<order>:<product>:<variant>');
  perform t.ok(jsonb_array_length(j -> 'stock_restored') = 2, 'the answer says what came back');
  perform t.ok(exists (select 1 from public.order_cancellations where order_id = o and reason = 'The customer asked us to cancel' and refund_id is null and jsonb_array_length(stock_restored) = 2)
               and exists (select 1 from public.order_cancellation_private where order_id = o and cancelled_by = t.admin()), 'the linked record: who, why, what stock came back');
  perform t.ok(t.notified(t.alice(), 'Order cancelled') = 1 and exists (select 1 from public.notifications where user_id = t.alice() and title = 'Order cancelled' and body like '%asked us to cancel%' and data ->> 'orderId' = o),
               'the customer got ONE notification with the reason (the generic status notification was replaced, not doubled)');
  -- again: the same answer, nothing happens twice
  perform t.as_user(t.admin());
  j := public.cancel_order(o, 'again');
  perform t.as_postgres();
  perform t.ok((j ->> 'already')::boolean and t.pstock('prod_single_a') = s0 and t.omoves(o, 'cancel_restock') = 2 and t.notified(t.alice(), 'Order cancelled') = 1, 'cancelling twice restocks nothing and tells nobody again');
end $$;

-- 9. cancel_order, a PAID Razorpay order: the refund is created in the same transaction; failures roll everything back -----------------------------------------------
do $$
declare
  o   text := 'co_o2';
  s0  int := t.pstock('prod_single_a');
  p0  int := t.vstock('var_1700000000001_0');
  j   jsonb;
  f   uuid;
  f2  uuid;
begin
  perform t.place(o, t.alice(), jsonb_build_array(t.sale('prod_vmain_ok', 'var_1700000000001_0', 2, 300), t.sale('prod_single_a', '', 1, 500)), true, 'Razorpay');   -- total 1100, paid
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 2 and t.pstock('prod_single_a') = s0 - 1, 'fixture: 2 Pink + 1 shirt taken');
  perform t.as_user(t.admin());
  -- refusals first: nothing may change
  perform t.fails(format($q$select public.cancel_order(%L, 'changed mind')$q$, o), '22023', '%was paid: choose how it is refunded%');
  perform t.fails(format($q$select public.cancel_order(%L, 'changed mind', 'manual')$q$, o), '22023', '%idempotency key%');
  perform t.fails(format($q$select public.cancel_order(%L, 'changed mind', 'cheque', 'key-co-o2-0001')$q$, o), '22023', '%how it is refunded%');
  perform t.fails(format($q$select public.cancel_order(%L, '   ', 'manual', 'key-co-o2-0001')$q$, o), '22023', '%reason%');
  perform t.as_postgres();
  perform t.ok(t.ostatus(o) = 'placed' and t.vstock('var_1700000000001_0') = p0 - 2 and t.pstock('prod_single_a') = s0 - 1 and not exists (select 1 from public.refunds where order_id = o)
               and not exists (select 1 from public.order_cancellations where order_id = o), 'every refused call left the order, the stock and the refunds untouched');
  -- a gateway refund needs a Razorpay payment: an order paid in cash cannot choose it (and the whole cancel rolls back)
  perform t.place('co_o2c', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), true, 'Cash');
  perform t.as_user(t.admin());
  perform t.fails($q$select public.cancel_order('co_o2c', 'no longer needed', 'razorpay', 'key-co-o2c-0001')$q$, '22023', '%not paid through Razorpay%');
  perform t.as_postgres();
  perform t.ok(t.ostatus('co_o2c') = 'placed' and t.pstock('prod_single_a') = s0 - 2, 'the failed cancellation rolled back as a whole (status and stock)');

  perform t.as_user(t.admin());
  j := public.cancel_order(o, 'We cannot supply it', 'razorpay', 'key-co-o2-0001', 'supplier problem');
  perform t.as_postgres();
  f := (j ->> 'refund_id')::uuid;
  perform t.ok(t.vstock('var_1700000000001_0') = p0 and t.pstock('prod_single_a') = s0 - 1, 'cancelled: both counters are back (Pink +2; the shirt of THIS order +1; the Cash order still holds 1)');
  perform t.ok((select kind = 'order' and amount = 1100 and items_amount = 1100 and method = 'razorpay' and status = 'pending' and gateway_state = 'not_sent' and request_id is null and reason = 'your cancelled order' and order_id = o
                from public.refunds where id = f), 'a refund of kind "order" for the whole 1100, pending, to be sent through the gateway, with the customer-readable reason');
  perform t.ok((select refund_id = f from public.order_cancellations where order_id = o), 'the cancellation record links the refund');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.alice() and title = 'Order cancelled' and data ->> 'orderId' = o and body like '%refund of ₹1100.00%'), 'the customer is told about the refund in the same notification');
  perform t.as_user(t.admin());
  j := public.cancel_order(o, 'again', 'razorpay', 'key-co-o2-0001');
  perform t.as_postgres();
  perform t.ok((j ->> 'already')::boolean and (j ->> 'refund_id')::uuid = f and (select count(*) from public.refunds where order_id = o) = 1, 'again: the same refund, not a second one');

  -- the refund goes through the normal steps; a stuck / failed one is retried with the order-level tool; stock is never involved
  perform t.as_user(t.admin());
  perform public.refund_void(f, 'the gateway is not configured yet');
  perform t.as_postgres();
  perform t.ok(t.rstatus(f) = 'failed' and t.vstock('var_1700000000001_0') = p0, 'a voided refund leaves the cancellation (and the stock) as it was');
  perform t.as_user(t.admin());
  j := public.create_order_refund(o, 1100, 'manual', 'your cancelled order', 'key-co-o2-0002', null, 'paid by UPI');
  f2 := (j ->> 'refund_id')::uuid;
  perform public.refund_mark_manual(f2, 'succeeded', 'UPI-CO2');
  perform t.as_postgres();
  perform t.ok(t.rstatus(f2) = 'succeeded' and (select count(*) from public.notifications where user_id = t.alice() and title = 'Your refund is complete' and data ->> 'refundId' = f2::text) = 1,
               'the retry was paid out: the customer is told, once, that THIS refund is complete');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_order_refund(%L, 1, 'manual', 'goodwill', 'key-co-o2-0003')$q$, o), '22023', '%more than what can still be refunded%');
  perform t.as_postgres();
end $$;

-- 10. what cannot be cancelled ------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  s0 int := t.pstock('prod_single_a');
begin
  perform t.place('co_o3', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.as_user(t.admin());
  perform public.ship_order('co_o3', 'manual', 'T-CO3');
  perform t.fails($q$select public.cancel_order('co_o3', 'too late', 'manual', 'key-co-o3-0001')$q$, '22023', '%already on its way%');
  perform public.mark_delivered('co_o3');
  perform t.fails($q$select public.cancel_order('co_o3', 'too late', 'manual', 'key-co-o3-0001')$q$, '22023', '%was delivered%return%');
  perform t.as_postgres();
  perform t.ok(t.ostatus('co_o3') = 'delivered' and t.pstock('prod_single_a') = s0 - 1 and not exists (select 1 from public.order_cancellations where order_id = 'co_o3'), 'a shipped / delivered order is untouched and points at the return workflow');

  -- a partial shipment already makes the order "shipped"
  perform t.place('co_o4', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 2, 500)));
  perform t.as_user(t.admin());
  perform public.ship_order('co_o4', 'manual', 'T-CO4', null, null, null, null, jsonb_build_array(jsonb_build_object('order_item_id', t.line_id('co_o4', 'prod_single_a'), 'quantity', 1)));
  perform t.fails($q$select public.cancel_order('co_o4', 'half sent', 'manual', 'key-co-o4-0001')$q$, '22023', '%already on its way%');
  perform t.as_postgres();
  perform t.ok(t.ostatus('co_o4') = 'shipped', 'a partly shipped order cannot be cancelled either');

  -- inconsistent data: a shipment on record while the status says "confirmed"
  perform t.place('co_o5', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.as_user(t.admin());
  perform public.ship_order('co_o5', 'manual', 'T-CO5');
  perform t.as_postgres();
  perform set_config('app.order_status_guard', 'off', true);
  update public.orders set order_status = 'confirmed' where id = 'co_o5';
  perform set_config('app.order_status_guard', 'on', true);
  perform t.as_user(t.admin());
  perform t.fails($q$select public.cancel_order('co_o5', 'x', 'manual', 'key-co-o5-0001')$q$, '22023', '%shipment on record%');
  perform t.as_postgres();

  -- an order cancelled before this feature existed (plain status update): answered as "already", no stock guesses
  perform t.place('co_o6', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), false, 'COD');
  update public.orders set order_status = 'cancelled' where id = 'co_o6';
  perform t.as_user(t.admin());
  perform t.ok((public.cancel_order('co_o6', 'late') ->> 'legacy')::boolean, 'a legacy cancelled order is reported as already cancelled');
  perform t.as_postgres();
  perform t.ok(t.omoves('co_o6', 'cancel_restock') = 0, 'and nothing was restocked on a guess');

  -- who, what
  perform t.as_user(t.alice());
  perform t.fails($q$select public.cancel_order('co_o5', 'x')$q$, '42501', 'Admin access required');
  perform t.as_anon();
  perform t.fails($q$select public.cancel_order('co_o5', 'x')$q$, '42501');
  perform t.as_user(t.admin());
  perform t.fails($q$select public.cancel_order('nope', 'x')$q$, 'P0002');
  perform t.as_postgres();
end $$;

-- 11. an order placed BEFORE variants had their own counters: the restock goes where the sale took it from -------------------------------------------------------
do $$
declare
  p0 int := t.vstock('var_1700000000001_0');
  m0 int := t.pstock('prod_vmain_ok');
begin
  -- imitate a legacy sale: the line says Pink, but the stock was taken from the MAIN counter (what the old create_order_tx did)
  insert into public.orders (id, user_id, order_status, payment_status, payment_method, subtotal, shipping, total, created_at) values ('co_leg', t.alice(), 'placed', 'pending', 'COD', 300, 0, 300, now());
  insert into public.order_items (id, order_id, product_id, variant_id, title, quantity, unit_price, line_total) values ('c0c0c0c0-0000-0000-0000-000000000001', 'co_leg', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt [Pink]', 1, 300, 300);
  update public.products set stock = stock - 1 where id = 'prod_vmain_ok';
  insert into public.inventory_logs (product_id, variant_id, change, reason, order_id, movement_type, bucket, ref_type, ref_id, actor_kind, stock_after)
  values ('prod_vmain_ok', '', -1, 'order', 'co_leg', 'sale', 'sellable', 'order', 'co_leg', 'system', m0 - 1);
  perform t.as_user(t.admin());
  perform public.cancel_order('co_leg', 'out of stock after all');
  perform t.as_postgres();
  perform t.ok(t.pstock('prod_vmain_ok') = m0 and t.vstock('var_1700000000001_0') = p0, 'the unit goes back to the MAIN counter it was taken from; Pink is not inflated');
end $$;

-- 12. create_order_refund: the generic order-level refund, and the exchange that was cancelled after the item came back (K-10) -------------------------------------
do $$
declare
  o   text := 'or_o1';
  v   uuid;
  j   jsonb;
  f   uuid;
  w0  int := t.vstock('var_1700000000001_1');
  vr  uuid;
begin
  perform t.delivered_order(o, t.alice(), jsonb_build_array(t.sale('prod_vmain_ok', 'var_1700000000001_0', 1, 300)), true, 'Razorpay');          -- paid 300
  v := t.ret_received(t.alice(), o, 'exchange', jsonb_build_array(t.xi(t.line_id(o, 'prod_vmain_ok', 'var_1700000000001_0'), 1, 'var_1700000000001_1')));
  perform t.inspect(v, 'passed');
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'replacement_pending');
  perform public.request_transition(v, 'cancelled', 'cannot send it', 'Sorry, we cannot send the replacement');
  perform t.as_postgres();
  perform t.ok(t.status(v) = 'cancelled' and t.vstock('var_1700000000001_1') = w0, 'fixture: exchange cancelled after inspection; the replacement stock is back');

  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_order_refund(%L, 200, 'manual', 'the item you returned', 'short', %L)$q$, o, v), '22023', '%idempotency key%');
  perform t.fails(format($q$select public.create_order_refund(%L, 200, 'manual', 'x', 'key-or-o1-0001', %L)$q$, o, v), '22023', '%what the refund is for%');
  perform t.fails(format($q$select public.create_order_refund(%L, 0, 'manual', 'the item you returned', 'key-or-o1-0001', %L)$q$, o, v), '22023', '%amount%');
  perform t.fails(format($q$select public.create_order_refund(%L, 301, 'manual', 'the item you returned', 'key-or-o1-0001', %L)$q$, o, v), '22023', '%more than what can still be refunded%');
  perform t.fails(format($q$select public.create_order_refund(%L, 100, 'cheque', 'the item you returned', 'key-or-o1-0001', %L)$q$, o, v), '22023', '%razorpay or manual%');
  perform t.fails(format($q$select public.create_order_refund(%L, 100, 'manual', 'the item you returned', 'key-or-o1-0001', gen_random_uuid())$q$, o), '22023', '%does not belong to this order%');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_order_refund(%L, 100, 'manual', 'the item you returned', 'key-or-o1-0001', %L)$q$, o, v), '42501', 'Admin access required');
  perform t.as_user(t.admin());

  j := public.create_order_refund(o, 300, 'manual', 'the item you returned', 'key-or-o1-0001', v, 'settle the cancelled exchange');
  f := (j ->> 'refund_id')::uuid;
  perform t.as_postgres();
  perform t.ok((j ->> 'created')::boolean and (select kind = 'order' and request_id = v and amount = 300 and reason = 'the item you returned' and status = 'pending' and method = 'manual' from public.refunds where id = f),
               'a refund of kind "order" linked to the exchange, with its customer-readable reason');
  perform t.ok((select count(*) from public.notifications where user_id = t.alice() and title = 'Your refund is being prepared' and data ->> 'refundId' = f::text) = 1
               and exists (select 1 from public.return_request_events where request_id = v and note like '%refund of ₹300.00%' and not internal), 'the customer is told, and the exchange timeline shows it');
  perform t.as_user(t.admin());
  j := public.create_order_refund(o, 300, 'manual', 'the item you returned', 'key-or-o1-0001', v);
  perform t.as_postgres();
  perform t.ok(not (j ->> 'created')::boolean and (j ->> 'refund_id')::uuid = f and (select count(*) from public.refunds where order_id = o) = 1, 'the same key again: the same refund');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_order_refund(%L, 1, 'manual', 'goodwill', 'key-or-o1-0002')$q$, o), '22023', '%more than what can still be refunded%');
  perform public.refund_mark_manual(f, 'succeeded', 'UPI-OR1');
  perform t.as_postgres();
  perform t.ok(t.rstatus(f) = 'succeeded' and (select count(*) from public.notifications where user_id = t.alice() and title = 'Your refund is complete' and data ->> 'refundId' = f::text) = 1, 'paid out: the customer is told once');

  -- a RETURN request is refunded with its own refund; a foreign key / order is refused; an unpaid order has nothing to refund
  perform t.delivered_order('or_o2', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), true, 'Cash');
  vr := t.ret_received(t.alice(), 'or_o2', 'return', jsonb_build_array(t.xi(t.line_id('or_o2', 'prod_single_a'), 1)));
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_order_refund('or_o2', 100, 'manual', 'the item you returned', 'key-or-o2-0001', %L)$q$, vr), '22023', '%create_refund%');
  perform t.fails(format($q$select public.create_order_refund('or_o1', 100, 'manual', 'goodwill', 'key-or-o2-0001', %L)$q$, vr), '22023', '%does not belong to this order%');
  perform t.as_postgres();
  perform t.delivered_order('or_o3', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), false, 'COD');
  perform t.as_user(t.admin());
  perform t.fails($q$select public.create_order_refund('or_o3', 100, 'manual', 'goodwill', 'key-or-o3-0001')$q$, '22023', '%not marked as paid%');
  perform t.fails($q$select public.create_order_refund('or_o2', 100, 'razorpay', 'goodwill', 'key-or-o2-0009')$q$, '22023', '%not paid through Razorpay%');
  perform t.fails(format($q$select public.create_order_refund('or_o2', 100, 'manual', 'goodwill', 'key-or-o1-0001')$q$), '22023', '%belongs to another refund%');
  perform t.as_postgres();
end $$;

-- 13. the permitted-operation matrix ---------------------------------------------------------------------------------------------------------------------------
do $$
declare
  j jsonb;
begin
  perform t.place('mx_o1', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 2, 500)), false, 'COD');
  perform t.as_user(t.admin());
  j := public.get_order_operations('mx_o1');
  perform t.ok(j ->> 'stage' = 'before_shipment' and (j -> 'cancel' ->> 'allowed')::boolean and (j -> 'ship' ->> 'allowed')::boolean and not (j -> 'mark_delivered' ->> 'allowed')::boolean
               and not (j -> 'return_exchange' ->> 'allowed')::boolean and not (j -> 'order_refund' ->> 'allowed')::boolean, 'before shipment: cancel + ship; no return, no delivery, nothing to refund (unpaid)');
  perform public.ship_order('mx_o1', 'manual', 'T-MX1');
  j := public.get_order_operations('mx_o1');
  perform t.ok(j ->> 'stage' = 'in_transit' and not (j -> 'cancel' ->> 'allowed')::boolean and j -> 'cancel' ->> 'reason' like '%on its way%' and (j -> 'mark_delivered' ->> 'allowed')::boolean
               and not (j -> 'ship' ->> 'allowed')::boolean and j -> 'ship' ->> 'reason' like '%already on a shipment%', 'in transit: no cancel (with the reason), deliver yes, nothing left to ship');
  perform public.mark_delivered('mx_o1');
  j := public.get_order_operations('mx_o1');
  perform t.ok(j ->> 'stage' = 'delivered' and not (j -> 'cancel' ->> 'allowed')::boolean and j -> 'cancel' ->> 'reason' like '%return / exchange%' and (j -> 'return_exchange' ->> 'allowed')::boolean, 'delivered: return / exchange only');
  perform t.as_postgres();
  perform t.place('mx_o2', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), true, 'Razorpay');
  perform t.as_user(t.admin());
  j := public.get_order_operations('mx_o2');
  perform t.ok((j -> 'order_refund' ->> 'allowed')::boolean and (j -> 'order_refund' ->> 'remaining')::numeric = 500, 'a paid order can be refunded up to what was paid');
  perform public.cancel_order('mx_o2', 'x', 'manual', 'key-mx-o2-0001');
  j := public.get_order_operations('mx_o2');
  perform t.ok(j ->> 'stage' = 'cancelled' and not (j -> 'cancel' ->> 'allowed')::boolean and j -> 'cancel' ->> 'reason' like '%already cancelled%' and not (j -> 'order_refund' ->> 'allowed')::boolean and (j ->> 'refunded_so_far')::numeric = 500,
               'cancelled: nothing more to cancel; the whole payment is already being refunded');
  perform t.fails($q$select public.get_order_operations('nope')$q$, 'P0002');
  perform t.as_user(t.alice());
  perform t.fails($q$select public.get_order_operations('mx_o1')$q$, '42501', 'Admin access required');
  perform t.as_postgres();
end $$;

-- 13b. a payment that was CAPTURED but could not become an order (the last unit sold out meanwhile: known issue K-8) is recorded, not lost --------------------------------
do $$
declare
  j    jsonb;
  v_id uuid;
begin
  perform t.as_service();
  j := public.record_payment_exception('order_RZP1', 'pay_RZP1', t.alice(), 1100.5, 'Insufficient stock for product prod_single_a (variant main)', '[{"product_id":"prod_single_a","quantity":99}]'::jsonb);
  perform t.as_postgres();
  v_id := (j ->> 'id')::uuid;
  perform t.ok((j ->> 'recorded')::boolean and (select amount = 1100.50 and status = 'open' and user_id = t.alice() and resolved_at is null and items -> 0 ->> 'quantity' = '99' from public.payment_exceptions where id = v_id),
               'the captured payment is recorded: amount, customer, what was wanted, open');
  perform t.ok(t.notified(t.alice(), 'We could not complete your order') = 1 and exists (select 1 from public.notifications where user_id = t.alice() and title = 'We could not complete your order' and body like '%refund it in full%' and body not like '%Insufficient%'),
               'the customer is told once, in plain words (not the database wording)');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.admin() and title = 'A paid order could not be created' and data ->> 'paymentExceptionId' = v_id::text), 'the admins are told');
  -- the webhook retries: the same payment again changes nothing and tells nobody again
  perform t.as_service();
  j := public.record_payment_exception('order_RZP1', 'pay_RZP1', t.alice(), 1100.5, 'again');
  perform t.as_postgres();
  perform t.ok(not (j ->> 'recorded')::boolean and (select count(*) from public.payment_exceptions) = 1 and t.notified(t.alice(), 'We could not complete your order') = 1, 'a retry of the same payment is a no-op');
  -- who may record: only the service role (the Edge Functions)
  perform t.as_user(t.admin());
  perform t.fails($q$select public.record_payment_exception('order_X', 'pay_X', null, 1, 'x')$q$, '42501');
  perform t.as_user(t.alice());
  perform t.fails($q$select public.record_payment_exception('order_X', 'pay_X', null, 1, 'x')$q$, '42501');
  perform t.as_anon();
  perform t.fails($q$select public.record_payment_exception('order_X', 'pay_X', null, 1, 'x')$q$, '42501');
  perform t.as_service();
  perform t.fails($q$select public.record_payment_exception('', 'pay_X', null, 1, 'x')$q$, '22023', '%required%');
  perform t.as_postgres();

  -- the admin refunds it in the Razorpay dashboard and records the reference
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.resolve_payment_exception(%L, 'refunded', 'rfnd_1')$q$, v_id), '42501', 'Admin access required');
  perform t.ok((select count(*) from public.payment_exceptions) = 0, 'a customer cannot read the list');
  perform t.as_user(t.admin());
  perform t.ok((select count(*) from public.payment_exceptions where status = 'open') = 1, 'the admin sees the open one');
  perform t.fails(format($q$select public.resolve_payment_exception(%L, 'refunded')$q$, v_id), '22023', '%Razorpay refund id%');
  perform t.fails(format($q$select public.resolve_payment_exception(%L, 'resolved')$q$, v_id), '22023', '%how this was handled%');
  perform t.fails(format($q$select public.resolve_payment_exception(%L, 'paid', 'x')$q$, v_id), '22023', '%refunded or resolved%');
  perform t.fails($q$select public.resolve_payment_exception(gen_random_uuid(), 'refunded', 'x')$q$, 'P0002');
  j := public.resolve_payment_exception(v_id, 'refunded', 'rfnd_RZP1', 'refunded from the dashboard');
  perform t.ok(not (j ->> 'already')::boolean and (select status = 'refunded' and refund_reference = 'rfnd_RZP1' and resolved_by = t.admin() and resolved_at is not null from public.payment_exceptions where id = v_id), 'closed as refunded, with the reference and who did it');
  perform t.ok((public.resolve_payment_exception(v_id, 'refunded', 'rfnd_RZP1') ->> 'already')::boolean, 'closing it twice is harmless');
  perform t.fails(format($q$select public.resolve_payment_exception(%L, 'resolved', null, 'handled')$q$, v_id), '22023', '%already closed%');
  perform t.as_postgres();
end $$;

-- 14. privacy and grants -------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  f uuid;
begin
  -- the customer reads the cancellation and the refund of HER order, not the staff side, not other customers'
  perform t.as_user(t.alice());
  perform t.ok((select count(*) from public.order_cancellations where order_id = 'co_o2') = 1 and (select count(*) from public.refunds where order_id = 'co_o2' and reason = 'your cancelled order') >= 1, 'the owner reads her cancellation and the reason of its refund');
  perform t.ok((select count(*) from public.order_cancellation_private) = 0, 'but never the staff-only side (who cancelled, the internal note)');
  perform t.as_user(t.bob());
  perform t.ok((select count(*) from public.order_cancellations) = 0 and (select count(*) from public.refunds where order_id in ('co_o2', 'co_o1')) = 0, 'another customer sees none of it');
  perform t.fails($q$insert into public.order_cancellations (order_id, reason) values ('co_o3', 'x')$q$, '42501');
  perform t.fails($q$update public.refunds set reason = 'x' where order_id = 'co_o2'$q$, '42501');
  perform t.fails($q$update public.return_request_items set stock_effect = 'restocked' where stock_effect is null$q$, '42501');
  perform t.fails($q$select public.app_create_order_refund('co_o2', null, 1, 'manual', 'k-12345678', 'x', null, null)$q$, '42501');
  perform t.fails($q$select public.app_after_inspection(gen_random_uuid(), 'passed')$q$, '42501');
  perform t.as_anon();
  perform t.fails($q$select * from public.order_cancellations$q$, '42501');
  perform t.fails($q$select public.cancel_order('co_o2', 'x')$q$, '42501');
  perform t.fails($q$select public.create_order_refund('co_o2', 1, 'manual', 'goodwill', 'k-12345678')$q$, '42501');
  perform t.as_service();
  perform t.fails($q$select public.app_after_inspection(gen_random_uuid(), 'passed')$q$, '42501');
  perform t.as_postgres();
  perform t.ok(has_function_privilege('authenticated', 'public.cancel_order(text,text,text,text,text)', 'execute') and not has_function_privilege('anon', 'public.cancel_order(text,text,text,text,text)', 'execute'), 'cancel_order: authenticated yes (the admin check is inside), anon no');
  perform t.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('order_cancellations', 'order_cancellation_private') and c.relrowsecurity) = 2, 'row level security is ON for both new tables');
end $$;

rollback;