-- needs: m4b
-- reapply: 20261017_05_rollback.sql
-- reapply: 20261017_04_rollback.sql
-- reapply: 20261017_04_return_requests.sql
-- reapply: 20261017_05_return_workflow.sql
-- Rollback of both migrations followed by both migrations again (a failed roll-out can be retried): everything works from scratch.
begin;

do $$
declare
  r   uuid := gen_random_uuid();
  v_j jsonb;
begin
  perform t.ok(to_regclass('public.return_requests') is not null and to_regclass('public.request_reasons') is not null, 'tables are back');
  perform t.ok((select count(*) from public.request_reasons) >= 8, 'the reasons are seeded again');
  perform t.ok((select count(*) from public.request_status_transitions) > 40, 'and the state machine');
  perform t.ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipments' and column_name = 'request_id'), 'shipments.request_id is back');

  insert into public.orders (id, user_id, order_status, delivered_at, delivered_at_source) values ('rf_o1', t.alice(), 'delivered', now() - interval '1 day', 'shipment');
  insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total, return_enabled, return_window_days, exchange_enabled, exchange_window_days)
  values ('66666666-0000-0000-0000-000000000001', 'rf_o1', 'prod_single_a', 'Shirt', 1, 500, 500, true, 7, true, 7);
  perform t.as_user(t.alice());
  v_j := public.create_return_request(r, 'rf_o1', 'return', '[{"order_item_id":"66666666-0000-0000-0000-000000000001","quantity":1}]'::jsonb, 'incorrect_size');
  perform t.ok((v_j ->> 'created')::boolean, 'a request can be created after the roll-forward');
  perform t.as_user(t.admin());
  v_j := public.decide_request_items(r, ('[{"item_id":"' || (select id from public.return_request_items where request_id = r) || '","decision":"approve"}]')::jsonb);
  perform t.eq(v_j ->> 'status', 'approved', 'and decided');
  perform t.eq(public.set_return_logistics(r, 'manual', 'Bring it to the shop') ->> 'status', 'awaiting_return_shipment', 'with its logistics');
  perform t.as_postgres();
end $$;

rollback;