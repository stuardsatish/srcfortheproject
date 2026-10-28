-- needs: m5b
-- setup: setup/exchange_in_flight.sql
-- reapply: 20261017_07_rollback.sql
-- reapply: 20261017_07_exchange_fulfilment.sql
-- Rollback of M5b followed by M5b again (a failed roll-out can be retried) on a database with four exchanges in flight (setup/exchange_in_flight.sql):
-- the back-fill gives the waiting exchanges their reservations and their replacement record back WITHOUT deducting twice and WITHOUT telling the customers
-- again; the exchange whose replacement already shipped is left alone; and a new exchange works from scratch.
begin;

do $$
declare
  rb uuid;
  rc uuid;
  v  uuid := gen_random_uuid();
  j  jsonb;
begin
  perform t.ok(to_regclass('public.exchange_reservations') is not null and to_regclass('public.replacement_fulfillments') is not null and to_regclass('public.exchange_adjustments') is not null, 'the tables are back');
  perform t.ok(to_regprocedure('public.ship_replacement(uuid,text,text,text,text,timestamptz,numeric,text,date)') is not null, 'and the RPCs');
  select id into rb from public.return_requests where order_id = 'if_o1' and status = 'replacement_pending';
  select id into rc from public.return_requests where order_id = 'if_o1' and status = 'replacement_shipped';

  -- stock: the rollback released RA / RB / RD; the back-fill reserved them again (RC's shipped replacement is NOT reserved a second time)
  perform t.eq((select stock from public.product_variants where id = 'var_1700000000001_0')::text, '19', 'Pink is 19 again (the waiting line is reserved again)');
  perform t.eq((select stock from public.product_variants where id = 'var_1700000000001_2')::text, '14', 'Violet is 14 again');
  perform t.eq((select stock from public.product_variants where id = 'var_1700000000001_1')::text, '28', 'White is 28: the approved line is reserved again, the shipped one is NOT deducted twice');
  perform t.ok((select count(*) from public.exchange_reservations where request_id in (select id from public.return_requests where order_id = 'if_o1') and status = 'reserved') = 3, 'three reservations: the approved line, the one waiting for the replacement and the one received');
  perform t.ok(not exists (select 1 from public.exchange_reservations where request_id = rc), 'nothing was reserved for the exchange that already shipped');

  -- the replacement record of the exchange that was waiting for it is back, with the price difference
  perform t.ok(exists (select 1 from public.replacement_fulfillments where request_id = rb and status = 'pending'), 'the waiting exchange has its replacement record again');
  perform t.ok((select kind || ':' || amount || ':' || status from public.exchange_adjustments where request_id = rb) = 'balance_due:50.00:open', 'and its price difference (Pink 300 -> Violet 350)');
  perform t.ok(not exists (select 1 from public.replacement_fulfillments where request_id = rc), 'the exchange that already shipped has no record (it cannot be rebuilt)');
  perform t.ok((select count(*) from public.notifications where user_id = t.alice() and title = 'Price difference on your exchange') = 1, 'the customer was NOT told again about the difference (the back-fill is silent)');

  -- a new exchange works from scratch on the rolled-forward schema
  insert into public.orders (id, user_id, order_status, payment_status, payment_method, subtotal, shipping, total, delivered_at, delivered_at_source)
  values ('rf_o1', t.alice(), 'delivered', 'paid', 'Cash', 300, 0, 300, now() - interval '1 day', 'shipment');
  insert into public.order_items (id, order_id, product_id, variant_id, title, quantity, unit_price, line_total, return_enabled, return_window_days, exchange_enabled, exchange_window_days)
  values ('a3a3a3a3-0000-0000-0000-000000000001', 'rf_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt', 1, 300, 300, true, 7, true, 7);
  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'rf_o1', 'exchange', '[{"order_item_id":"a3a3a3a3-0000-0000-0000-000000000001","quantity":1}]'::jsonb, 'incorrect_size');
  perform t.as_user(t.admin());
  perform public.decide_request_items(v, (select jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')) from public.return_request_items where request_id = v));
  perform t.as_postgres();
  perform t.ok((select stock from public.product_variants where id = 'var_1700000000001_0') = 18, 'a new approval reserves (Pink 19 -> 18)');
  perform t.as_user(t.admin());
  perform public.set_return_logistics(v, 'manual', 'post it');
  perform public.record_return_received(v);
  perform public.record_inspection(v, (select jsonb_agg(jsonb_build_object('item_id', id, 'result', 'passed')) from public.return_request_items where request_id = v));
  perform public.request_transition(v, 'replacement_pending');
  j := public.ship_replacement(v, 'manual', null, 'TRK-RF');
  perform public.mark_replacement_delivered(v);
  perform t.as_postgres();
  perform t.ok((j ->> 'created')::boolean and (select status from public.return_requests where id = v) = 'closed', 'ship + deliver: the exchange closes by itself');
end $$;

rollback;