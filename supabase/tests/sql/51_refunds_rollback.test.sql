-- needs: m5
-- reapply: 20261017_06_rollback.sql
-- reapply: 20261017_06_rollback.sql
-- M5 rollback applied TWICE (a rollback must be safe to re-run); the state is checked afterwards. M4 / M4b / M3 must be untouched.
-- 52_refunds_roll_forward.test.sql proves the migration can be applied again after that.
begin;

do $$
begin
  perform t.ok(to_regclass('public.refunds') is null and to_regclass('public.refund_items') is null and to_regclass('public.refund_private') is null
               and to_regclass('public.refund_events') is null, 'every refund table is gone');
  perform t.ok(to_regclass('public.refund_no_seq') is null, 'and the number sequence');
  perform t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname in ('refund_calculate', 'create_refund', 'refund_mark_manual', 'refund_void', 'refund_begin_gateway',
                              'refund_gateway_context', 'refund_record_gateway_result', 'refund_apply_gateway_event', 'app_refund_compute', 'app_refund_finish', 'app_notify_refund',
                              'app_next_refund_no', 'trg_refunds_cap', 'trg_refund_items_cap')), 'every function of M5 is gone');
  -- the request side (M4 / M4b) and shipping (M3) are intact
  perform t.ok(to_regclass('public.return_requests') is not null and to_regprocedure('public.create_return_request(uuid,text,text,jsonb,text,text,text,jsonb,boolean)') is not null
               and to_regprocedure('public.record_inspection(uuid,jsonb,text)') is not null and to_regprocedure('public.ship_order(text,text,text,text,timestamptz,numeric,text,jsonb,text,date)') is not null,
               'returns (M4 / M4b) and shipping (M3) are intact');
  -- a request can still be created after the rollback
  insert into public.orders (id, user_id, order_status, delivered_at, delivered_at_source) values ('rr_o1', t.alice(), 'delivered', now() - interval '1 day', 'shipment');
  insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total, return_enabled, return_window_days, exchange_enabled, exchange_window_days)
  values ('88888888-0000-0000-0000-000000000001', 'rr_o1', 'prod_single_a', 'Shirt', 1, 500, 500, true, 7, true, 7);
  perform t.as_user(t.alice());
  perform t.ok((public.create_return_request(gen_random_uuid(), 'rr_o1', 'return', '[{"order_item_id":"88888888-0000-0000-0000-000000000001","quantity":1}]'::jsonb, 'incorrect_size') ->> 'created')::boolean,
               'a return request can still be submitted after the rollback');
  perform t.as_postgres();
end $$;

rollback;