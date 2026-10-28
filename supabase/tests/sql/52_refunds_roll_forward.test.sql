-- needs: m5
-- reapply: 20261017_06_rollback.sql
-- reapply: 20261017_06_refunds.sql
-- Rollback of M5 followed by M5 again (a failed roll-out can be retried): a refund works from scratch.
begin;

do $$
declare
  r   uuid := gen_random_uuid();
  v_j jsonb;
  f   uuid;
begin
  perform t.ok(to_regclass('public.refunds') is not null and to_regclass('public.refund_items') is not null and to_regclass('public.refund_events') is not null, 'the tables are back');
  perform t.ok(to_regprocedure('public.create_refund(uuid,text,text,boolean,numeric,text,text)') is not null, 'and the functions');

  insert into public.orders (id, user_id, order_status, payment_status, payment_method, subtotal, shipping, total, delivered_at, delivered_at_source)
  values ('rf_o2', t.alice(), 'delivered', 'paid', 'Cash', 500, 0, 500, now() - interval '1 day', 'shipment');
  insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total, return_enabled, return_window_days, exchange_enabled, exchange_window_days)
  values ('99999999-0000-0000-0000-000000000001', 'rf_o2', 'prod_single_a', 'Shirt', 1, 500, 500, true, 7, true, 7);
  perform t.as_user(t.alice());
  perform public.create_return_request(r, 'rf_o2', 'return', '[{"order_item_id":"99999999-0000-0000-0000-000000000001","quantity":1}]'::jsonb, 'incorrect_size');
  perform t.as_user(t.admin());
  perform public.decide_request_items(r, ('[{"item_id":"' || (select id from public.return_request_items where request_id = r) || '","decision":"approve"}]')::jsonb);
  perform public.set_return_logistics(r, 'manual', 'Bring it to the shop');
  perform public.record_return_received(r);
  perform public.record_inspection(r, ('[{"item_id":"' || (select id from public.return_request_items where request_id = r) || '","result":"passed"}]')::jsonb);
  v_j := public.create_refund(r, 'key-roll-forward-0001', 'manual');
  f := (v_j ->> 'refund_id')::uuid;
  perform t.ok((v_j ->> 'amount')::numeric = 500, 'a refund of 500 can be created after the roll-forward');
  v_j := public.refund_mark_manual(f, 'succeeded', 'CASH-1');
  perform t.eq(v_j ->> 'status', 'succeeded', 'and paid out');
  perform t.eq((select status from public.return_requests where id = r), 'refunded', 'the request is refunded');
  perform t.as_postgres();
end $$;

rollback;