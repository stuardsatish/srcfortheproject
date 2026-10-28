-- needs: m6
-- setup: setup/inventory_in_flight.sql
-- reapply: 20261017_08_rollback.sql
-- reapply: 20261017_08_rollback.sql
-- M6 rollback applied TWICE (a rollback must be safe to re-run) on a database with cancelled orders, an order refund and returned items already
-- restocked / kept as unsellable (setup/inventory_in_flight.sql): the cancellation records, the RPCs, the stock hook and the new columns are gone; what
-- already happened to stock and money stays; an inspection no longer touches stock. M5b / M5 / M4 / M3 are intact.
-- 62_inventory_cancellation_roll_forward.test.sql proves the migration can be applied again.
begin;

do $$
declare
  v  uuid := gen_random_uuid();
  s0 int;
begin
  perform t.ok(to_regclass('public.order_cancellations') is null and to_regclass('public.order_cancellation_private') is null and to_regclass('public.payment_exceptions') is null, 'the cancellation tables and the payment-exception list are gone');
  perform t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname in ('cancel_order', 'create_order_refund', 'get_order_operations', 'app_create_order_refund',
                                                                          'inventory_reconcile', 'inventory_gaps', 'inventory_unsellable_summary', 'record_payment_exception', 'resolve_payment_exception')), 'every function of M6 is gone');
  perform t.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'return_request_items' and column_name in ('disposition', 'stock_effect'))
               and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'refunds' and column_name = 'reason')
               and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_logs' and column_name = 'seq'), 'the new columns are gone (disposition, stock_effect, refunds.reason, inventory_logs.seq)');

  -- what already happened stays
  perform t.ok((select order_status from public.orders where id = 'if_c1') = 'cancelled' and (select order_status from public.orders where id = 'if_c2') = 'cancelled', 'both orders are still cancelled');
  perform t.ok((select count(*) from public.inventory_logs where movement_type = 'cancel_restock' and order_id in ('if_c1', 'if_c2')) = 2, 'their cancel_restock ledger rows are history and stay');
  perform t.ok((select count(*) from public.refunds where order_id = 'if_c2' and kind = 'order' and amount = 300 and status = 'pending') = 1, 'the refund of the cancelled paid order (money) stays');
  perform t.ok(exists (select 1 from public.inventory_logs where movement_type = 'return_restock' and order_id = 'if_r1') and exists (select 1 from public.inventory_logs where movement_type = 'return_unsellable' and order_id = 'if_r2' and bucket = 'unsellable'),
               'the restock and the unsellable record of the returned items stay in the ledger');
  perform t.ok((select stock from public.products where id = 'prod_single_a') = 48 and (select stock from public.product_variants where id = 'var_1700000000001_0') = 20,
               'stock stays as it was: shirt 50 - 2 (if_c1 back) ... = 48, Pink back at 20');

  -- M4b's inspection again: it ignores a disposition and never touches stock
  perform t.as_postgres();
  insert into public.orders (id, user_id, order_status, payment_status, payment_method, subtotal, shipping, total, delivered_at, delivered_at_source)
  values ('rb_m6', t.alice(), 'delivered', 'paid', 'Cash', 500, 0, 500, now() - interval '1 day', 'shipment');
  insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total, return_enabled, return_window_days, exchange_enabled, exchange_window_days)
  values ('d6d6d6d6-0000-0000-0000-000000000001', 'rb_m6', 'prod_single_a', 'Shirt', 1, 500, 500, true, 7, true, 7);
  s0 := (select stock from public.products where id = 'prod_single_a');
  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'rb_m6', 'return', '[{"order_item_id":"d6d6d6d6-0000-0000-0000-000000000001","quantity":1}]'::jsonb, 'incorrect_size');
  perform t.as_user(t.admin());
  perform public.decide_request_items(v, (select jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')) from public.return_request_items where request_id = v));
  perform public.set_return_logistics(v, 'manual', 'post it');
  perform public.record_return_received(v);
  perform public.record_inspection(v, (select jsonb_agg(jsonb_build_object('item_id', id, 'result', 'passed', 'disposition', 'unsellable')) from public.return_request_items where request_id = v));
  perform t.as_postgres();
  perform t.ok((select status from public.return_requests where id = v) = 'inspection_passed' and (select stock from public.products where id = 'prod_single_a') = s0
               and not exists (select 1 from public.inventory_logs where ref_type = 'return_request_item' and ref_id in (select id::text from public.return_request_items where request_id = v)),
               'after the rollback an inspection moves no stock (and the old function simply ignores a disposition)');

  -- the rest of the chain is intact
  perform t.ok(to_regprocedure('public.ship_replacement(uuid,text,text,text,text,timestamptz,numeric,text,date)') is not null and to_regclass('public.exchange_reservations') is not null
               and to_regprocedure('public.create_refund(uuid,text,text,boolean,numeric,text,text)') is not null and to_regprocedure('public.ship_order(text,text,text,text,timestamptz,numeric,text,jsonb,text,date)') is not null
               and to_regprocedure('public.apply_inventory_movement(text,text,integer,text,text,text,text,text,uuid,text,text,text)') is not null,
               'exchanges (M5b), refunds (M5), shipping (M3) and the stock function (M1) are intact');
end $$;

rollback;