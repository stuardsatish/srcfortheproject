-- needs: m6
-- setup: setup/inventory_in_flight.sql
-- reapply: 20261017_08_rollback.sql
-- reapply: 20261017_08_inventory_cancellation.sql
-- Rollback of M6 followed by M6 again (a failed roll-out can be retried) on the state of setup/inventory_in_flight.sql: an order that was cancelled
-- before the roll-forward is reported as "already cancelled" (its record was lost with the rollback, its stock is NOT restored a second time),
-- the ledger got its strict order back, and cancelling / inspecting work from scratch.
begin;

do $$
declare
  j   jsonb;
begin
  perform t.ok(to_regclass('public.order_cancellations') is not null and to_regprocedure('public.cancel_order(text,text,text,text,text)') is not null, 'the tables and the RPCs are back');
  perform t.ok((select count(*) from public.order_cancellations) = 0, 'the cancellation records of before the rollback are gone (documented)');
  perform t.ok((select count(*) from public.inventory_logs where seq is null) = 0 and (select count(distinct seq) from public.inventory_logs) = (select count(*) from public.inventory_logs), 'every old ledger row has a distinct seq again');
  perform t.ok((select reason from public.refunds where order_id = 'if_c2') is null, 'the old order refund has no reason text any more (the column was dropped and re-added)');

  -- the order cancelled before: answered as "already", and nothing is restocked a second time
  perform t.as_user(t.admin());
  j := public.cancel_order('if_c1', 'again');
  perform t.as_postgres();
  perform t.ok((j ->> 'already')::boolean and (j ->> 'legacy')::boolean, 'if_c1: reported as already cancelled (legacy)');
  perform t.ok((select count(*) from public.inventory_logs where movement_type = 'cancel_restock' and order_id = 'if_c1') = 1 and (select stock from public.products where id = 'prod_single_a') = 48, 'and its stock is not restored again');
end $$;

do $$
declare
  j   jsonb;
  v   uuid := gen_random_uuid();
  s0  int;
  li  uuid;
begin
  s0 := (select stock from public.products where id = 'prod_single_a');
  perform public.create_order_tx(p_order_id := 'rf_c1', p_user_id := t.alice(),
    p_items := jsonb_build_array(jsonb_build_object('product_id', 'prod_single_a', 'variant_id', null, 'variant_name', null, 'title', 'Item', 'quantity', 2, 'unit_price', 500, 'discount', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'line_total', 1000)),
    p_order_status := 'placed', p_payment_status := 'pending', p_payment_method := 'COD', p_source := 'online', p_customer_name := 'T', p_customer_email := 't@example.test', p_customer_phone := '9999999999',
    p_address := '{}'::jsonb, p_subtotal := 1000, p_shipping := 0, p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := 1000);
  perform t.ok((select stock from public.products where id = 'prod_single_a') = s0 - 2, 'fixture: a new order took 2 shirts');
  perform t.as_user(t.admin());
  j := public.cancel_order('rf_c1', 'Changed my mind');
  perform t.as_postgres();
  perform t.ok(not (j ->> 'already')::boolean and (select stock from public.products where id = 'prod_single_a') = s0 and exists (select 1 from public.order_cancellations where order_id = 'rf_c1'),
               'a new cancellation restocks and records, from scratch');

  -- and an inspection restocks again
  insert into public.orders (id, user_id, order_status, payment_status, payment_method, subtotal, shipping, total, delivered_at, delivered_at_source)
  values ('rf_r1', t.alice(), 'delivered', 'paid', 'Cash', 500, 0, 500, now() - interval '1 day', 'shipment');
  insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total, return_enabled, return_window_days, exchange_enabled, exchange_window_days)
  values ('d7d7d7d7-0000-0000-0000-000000000001', 'rf_r1', 'prod_single_a', 'Shirt', 1, 500, 500, true, 7, true, 7);
  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'rf_r1', 'return', '[{"order_item_id":"d7d7d7d7-0000-0000-0000-000000000001","quantity":1}]'::jsonb, 'incorrect_size');
  perform t.as_user(t.admin());
  perform public.decide_request_items(v, (select jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')) from public.return_request_items where request_id = v));
  perform public.set_return_logistics(v, 'manual', 'post it');
  perform public.record_return_received(v);
  perform public.record_inspection(v, (select jsonb_agg(jsonb_build_object('item_id', id, 'result', 'passed')) from public.return_request_items where request_id = v));
  perform t.as_postgres();
  perform t.ok((select stock from public.products where id = 'prod_single_a') = s0 + 1 and (select stock_effect from public.return_request_items where request_id = v) = 'restocked', 'an accepted return is restocked again after the roll-forward');
  perform t.as_user(t.admin());
  perform t.ok((select count(*) from public.inventory_gaps()) = 0, 'the ledger of the new flows has no gaps');
  perform t.as_postgres();
end $$;

rollback;