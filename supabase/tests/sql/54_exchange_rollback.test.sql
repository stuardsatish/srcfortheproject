-- needs: m5b
-- setup: setup/exchange_in_flight.sql
-- reapply: 20261017_07_rollback.sql
-- reapply: 20261017_07_rollback.sql
-- M5b rollback applied TWICE (a rollback must be safe to re-run) on a database with four exchanges in flight (setup/exchange_in_flight.sql):
-- the reserved stock is given back, the stock of the shipped replacement stays deducted, the fulfilment tables / triggers / RPCs are gone, the money
-- record (the price-difference refund) and M3 / M4 / M4b / M5 are untouched. 55_exchange_roll_forward.test.sql proves the migration can be applied again.
begin;

do $$
declare
  rc uuid;
begin
  -- the stock: seed Pink 20 / White 30 / Violet 15; the setup reserved Pink 1, White 2, Violet 1
  perform t.ok((select stock from public.product_variants where id = 'var_1700000000001_0') = 20, 'Pink is back at 20 (the reservation of the line waiting for inspection was released)');
  perform t.ok((select stock from public.product_variants where id = 'var_1700000000001_2') = 15, 'Violet is back at 15 (released)');
  perform t.ok((select stock from public.product_variants where id = 'var_1700000000001_1') = 29, 'White is at 29: the approved line was released (+1) but the replacement that already SHIPPED stays deducted (-1)');
  perform t.ok((select count(*) from public.inventory_logs where movement_type = 'exchange_release' and order_id = 'if_o1' and idempotency_key like 'exrel:%') = 3, 'three exchange_release movements in the ledger (RA, RB, RD)');
  perform t.ok((select count(*) from public.inventory_logs where movement_type = 'exchange_reserve' and order_id = 'if_o1') = 4, 'the four reservations are still in the ledger (history is never deleted)');

  perform t.ok(to_regclass('public.exchange_reservations') is null and to_regclass('public.replacement_fulfillments') is null and to_regclass('public.replacement_fulfillment_items') is null
               and to_regclass('public.exchange_adjustments') is null and to_regclass('public.exchange_adjustment_private') is null, 'the five fulfilment tables are gone');
  perform t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname in ('ship_replacement', 'mark_replacement_delivered', 'settle_exchange_adjustment', 'create_exchange_refund',
                              'app_exchange_reserve_item', 'app_exchange_release_item', 'app_exchange_open_fulfilment', 'app_exchange_try_close', 'app_replacement_unit_price',
                              'trg_exchange_item_reservation', 'trg_exchange_replacement_pending', 'trg_exchange_cancelled', 'trg_exchange_close_guard',
                              'trg_replacement_shipment_progress', 'trg_exchange_refund_sync')), 'every function of M5b is gone');
  perform t.ok(not exists (select 1 from pg_trigger where tgname in ('return_request_items_exchange_stock', 'return_requests_exchange_open', 'return_requests_exchange_cancelled',
                                                                      'return_requests_exchange_close_guard', 'shipments_replacement_progress', 'refunds_exchange_sync')), 'and every trigger');
  perform t.ok(not exists (select 1 from pg_indexes where indexname = 'refunds_one_active_exchange_difference'), 'and the index');
  perform t.ok(not exists (select 1 from public.request_status_transitions where request_type = 'exchange' and from_status = 'replacement_shipped' and to_status = 'replacement_pending'), 'and the extra transition');
  perform t.ok(not exists (select 1 from public.shipments where direction = 'replacement'), 'replacement shipments are deleted');

  -- the exchanges keep their status; the money record survives
  perform t.ok((select count(*) from public.return_requests where order_id = 'if_o1' and type = 'exchange') = 4, 'the four exchange requests are still there');
  perform t.ok(exists (select 1 from public.return_requests where order_id = 'if_o1' and status = 'approved') and exists (select 1 from public.return_requests where order_id = 'if_o1' and status = 'replacement_pending')
               and exists (select 1 from public.return_requests where order_id = 'if_o1' and status = 'replacement_shipped') and exists (select 1 from public.return_requests where order_id = 'if_o1' and status = 'inspection_pending'),
               'each keeps the status it had');
  select id into rc from public.return_requests where order_id = 'if_o1' and status = 'replacement_shipped';
  perform t.ok(exists (select 1 from public.refunds where request_id = rc and kind = 'exchange_difference' and amount = 100 and status = 'pending'), 'the price-difference refund (money) is untouched');

  -- M3 / M4 / M4b / M5 are intact
  perform t.ok(to_regprocedure('public.ship_order(text,text,text,text,timestamptz,numeric,text,jsonb,text,date)') is not null and to_regprocedure('public.create_refund(uuid,text,text,boolean,numeric,text,text)') is not null
               and to_regprocedure('public.app_refund_finish(uuid,text,text,uuid,text,text,timestamptz,text)') is not null and to_regprocedure('public.decide_request_items(uuid,jsonb,text,text)') is not null,
               'shipping, returns and refunds are intact');
  perform t.ok(to_regclass('public.refunds') is not null and to_regclass('public.return_requests') is not null and to_regclass('public.shipments') is not null, 'and their tables');

  -- an exchange no longer reserves anything, but still works as a request (the stock is simply not touched any more)
  insert into public.orders (id, user_id, order_status, delivered_at, delivered_at_source) values ('rb_o1', t.alice(), 'delivered', now() - interval '1 day', 'shipment');
  insert into public.order_items (id, order_id, product_id, variant_id, title, quantity, unit_price, line_total, return_enabled, return_window_days, exchange_enabled, exchange_window_days)
  values ('a2a2a2a2-0000-0000-0000-000000000001', 'rb_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt', 1, 300, 300, true, 7, true, 7);
  perform t.as_user(t.alice());
  perform public.create_return_request(gen_random_uuid(), 'rb_o1', 'exchange', '[{"order_item_id":"a2a2a2a2-0000-0000-0000-000000000001","quantity":1,"replacement_variant_id":"var_1700000000001_1"}]'::jsonb, 'incorrect_size');
  perform t.as_user(t.admin());
  perform public.decide_request_items((select id from public.return_requests where order_id = 'rb_o1'),
            (select jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')) from public.return_request_items where request_id = (select id from public.return_requests where order_id = 'rb_o1')));
  perform t.as_postgres();
  perform t.ok((select stock from public.product_variants where id = 'var_1700000000001_1') = 29, 'after the rollback an approval no longer touches stock');
end $$;

rollback;