-- needs: m3
-- reapply: 20261017_03_shipping.sql
-- Phase 5 — M3: couriers, shipments (+items, +events), orders.delivered_at, the order-status guard and the RPCs.
-- ("reapply" = the runner applies the migration a SECOND time before this script: the idempotency test.)
begin;

-- the live "order status changed" notification trigger (20261008_04) is not part of the base fixture: install it so that the
-- "the customer is notified exactly once" rules can be tested
create trigger notify_order_status after update of order_status on public.orders
  for each row when (old.order_status is distinct from new.order_status) execute function public.trg_notify_order_status();

-- fixtures --------------------------------------------------------------------------------------------------------------
insert into public.orders (id, user_id, order_status, payment_status, customer_name, total) values
  ('t_o1', t.alice(), 'placed',    'paid', 'Alice', 1500),     -- two lines: A x2, B x1  (single parcel flow)
  ('t_o2', t.alice(), 'confirmed', 'paid', 'Alice', 300),      -- created-by-mistake / cancel flow
  ('t_o3', t.alice(), 'confirmed', 'paid', 'Alice', 900),      -- one line x3 shipped as 2 + 1 (multi parcel)
  ('t_o4', t.alice(), 'confirmed', 'paid', 'Alice', 900),      -- one line x3, only 2 shipped at first (partial)
  ('t_o5', t.bob(),   'placed',    'paid', 'Bob',   400),
  ('t_o6', t.alice(), 'confirmed', 'paid', 'Alice', 600);      -- two parcels delivered together by mark_delivered
insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total) values
  ('22222222-0000-0000-0000-000000000001', 't_o1', 'p1', 'Item A', 2, 500, 1000),
  ('22222222-0000-0000-0000-000000000002', 't_o1', 'p2', 'Item B', 1, 500, 500),
  ('22222222-0000-0000-0000-000000000003', 't_o3', 'p1', 'Item X', 3, 300, 900),
  ('22222222-0000-0000-0000-000000000004', 't_o4', 'p1', 'Item Y', 3, 300, 900),
  ('22222222-0000-0000-0000-000000000005', 't_o5', 'p1', 'Item Z', 1, 400, 400),
  ('22222222-0000-0000-0000-000000000006', 't_o2', 'p1', 'Item W', 1, 300, 300),
  ('22222222-0000-0000-0000-000000000007', 't_o6', 'p1', 'Item V', 2, 300, 600);

-- 1. structure, seeds, courier catalogue -------------------------------------------------------------------------------
do $$
declare
  v_rows integer;
begin
  perform t.ok((select count(*) from public.couriers) >= 5, 'the courier catalogue is seeded');
  perform t.ok(exists (select 1 from public.couriers where code = 'manual' and active), 'courier "manual" exists and is active');
  perform t.ok(exists (select 1 from pg_trigger where tgname = 'orders_10_status_guard' and not tgisinternal), 'status guard trigger exists');
  perform t.ok(exists (select 1 from pg_trigger where tgname = 'orders_20_delivered_at' and not tgisinternal), 'delivered_at trigger exists');
  perform t.ok((select count(*) from public.couriers where tracking_url_template is not null) = 0, 'no tracking link template was guessed by the migration');

  perform t.fails($q$insert into public.couriers (code, name, tracking_url_template) values ('bad1', 'Bad', 'ftp://x/{tracking}')$q$, '23514');
  perform t.fails($q$insert into public.couriers (code, name, tracking_url_template) values ('bad2', 'Bad', 'https://x.test/track')$q$, '23514');
  perform t.fails($q$insert into public.couriers (code, name) values ('B', 'Bad code')$q$, '23514');
  perform t.eq(public.app_urlencode('AB 12/3'), 'AB%2012%2F3', 'url-encoding keeps unreserved characters and escapes the rest');
  perform t.eq(public.app_urlencode('x&y=z'), 'x%26y%3Dz', 'url-encoding of reserved characters');
  perform t.eq(public.app_urlencode(''), '', 'url-encoding of nothing');
  perform t.eq(public.app_urlencode('Rs.5'), 'Rs.5', 'dot stays');

  -- customers read, never write
  perform t.as_user(t.alice());
  perform t.ok((select count(*) from public.couriers) >= 5, 'a customer can list the active couriers');
  perform t.fails($q$insert into public.couriers (code, name) values ('mine', 'Mine')$q$);
  update public.couriers set name = 'x' where code = 'manual';      -- RLS hides the rows from a customer: zero rows, no error
  get diagnostics v_rows = row_count;
  perform t.eq(v_rows::text, '0', 'a customer''s update touches no courier row');
  perform t.as_user(t.admin());
  insert into public.couriers (code, name, tracking_url_template) values ('acme', 'Acme Express', 'https://track.example.test/acme/{tracking}');
  update public.couriers set tracking_url_template = 'https://track.example.test/dtdc?awb={tracking}' where code = 'dtdc';
  update public.couriers set active = false where code = 'indiapost';
  perform t.as_user(t.alice());
  perform t.ok(not exists (select 1 from public.couriers where code = 'indiapost'), 'a switched-off courier is hidden from customers');
  perform t.as_user(t.admin());
  perform t.ok(exists (select 1 from public.couriers where code = 'indiapost'), 'but the admin still sees it');
  perform t.eq(public.app_courier_tracking_url('dtdc', ' AB 12/3 '), 'https://track.example.test/dtdc?awb=AB%2012%2F3', 'tracking link built from the courier template');
  perform t.eq(public.app_courier_tracking_url('manual', 'X1'), null, 'no template -> no link');
  perform t.eq(public.app_courier_tracking_url('dtdc', '  '), null, 'no tracking number -> no link');
  perform t.as_postgres();
end $$;

-- 2. delivered_at: back-fill (flagged) and trigger ------------------------------------------------------------------------
do $$
declare
  v_at timestamptz;
  v_src text;
  v_upd timestamptz;
begin
  select delivered_at, delivered_at_source, updated_at into v_at, v_src, v_upd from public.orders where id = 'order_legacy_1';
  perform t.ok(v_at is not null and v_at = v_upd, 'a legacy delivered order was back-filled from updated_at');
  perform t.eq(v_src, 'backfill_updated_at', 'and flagged as approximate');
  perform t.ok((select delivered_at from public.orders where id = 'bill_legacy_3') is not null, 'every legacy delivered order has a delivered_at');
  perform t.ok((select delivered_at from public.orders where id = 'cod_legacy_2') is null, 'a legacy SHIPPED order has none yet');

  -- legacy write path (admin updates the status directly) keeps working and still stamps delivered_at
  perform t.as_user(t.admin());
  update public.orders set order_status = 'delivered' where id = 'cod_legacy_2';
  perform t.as_postgres();
  select delivered_at, delivered_at_source into v_at, v_src from public.orders where id = 'cod_legacy_2';
  perform t.ok(v_at is not null and v_at > now() - interval '1 minute', 'direct admin update stamps delivered_at = now');
  perform t.eq(v_src, 'status_change', 'source = status_change');

  -- once set it does not move for API callers ...
  perform t.as_user(t.admin());
  update public.orders set delivered_at = '2020-01-01 00:00+00' where id = 'cod_legacy_2';
  perform t.as_postgres();
  perform t.ok((select delivered_at from public.orders where id = 'cod_legacy_2') = v_at, 'an admin API update cannot move delivered_at');
  -- ... the DB owner can correct a back-filled value
  update public.orders set delivered_at = '2026-01-02 10:00+00', delivered_at_source = 'manual' where id = 'order_legacy_1';
  perform t.ok((select delivered_at from public.orders where id = 'order_legacy_1') = '2026-01-02 10:00+00', 'the DB owner can correct delivered_at');

  -- born delivered (billing / bulk import)
  insert into public.orders (id, order_status, created_at, source) values ('t_born', 'delivered', now() - interval '3 days', 'billing');
  select delivered_at, delivered_at_source into v_at, v_src from public.orders where id = 't_born';
  perform t.ok(v_at = (select created_at from public.orders where id = 't_born'), 'a born-delivered order gets delivered_at = created_at');
  perform t.eq(v_src, 'born_delivered', 'source = born_delivered');
end $$;

-- 3. the order-status guard, table-driven ---------------------------------------------------------------------------------
do $$
declare
  r record;
  n integer := 0;
  v_id text;
begin
  for r in
    select * from (values
      ('pending',   'placed',    true),  ('pending',   'confirmed', true),  ('pending',   'shipped',   true),  ('pending',   'cancelled', true),
      ('pending',   'delivered', false),
      ('placed',    'confirmed', true),  ('placed',    'shipped',   true),  ('placed',    'cancelled', true),  ('placed',    'delivered', false),
      ('placed',    'pending',   false),
      ('confirmed', 'shipped',   true),  ('confirmed', 'cancelled', true),  ('confirmed', 'delivered', false), ('confirmed', 'placed',    false),
      ('shipped',   'delivered', true),  ('shipped',   'confirmed', false), ('shipped',   'placed',    false), ('shipped',   'cancelled', false),
      ('delivered', 'shipped',   false), ('delivered', 'cancelled', false), ('delivered', 'confirmed', false),
      ('cancelled', 'confirmed', false), ('cancelled', 'placed',    false),
      ('processing','confirmed', true),  ('processing','delivered', true),  ('processing','mystery',   false),
      ('placed',    'mystery',   false), ('placed',    'Shipped',   true)
    ) as v(from_s, to_s, allowed)
  loop
    n := n + 1;
    v_id := 'g_' || n;
    perform t.as_postgres();
    insert into public.orders (id, user_id, order_status) values (v_id, t.alice(), r.from_s);
    perform t.as_user(t.admin());
    if r.allowed then
      update public.orders set order_status = r.to_s where id = v_id;
      perform t.eq((select order_status from public.orders where id = v_id), r.to_s, 'guard allows ' || r.from_s || ' -> ' || r.to_s);
    else
      perform t.fails(format('update public.orders set order_status = %L where id = %L', r.to_s, v_id), '23514');
    end if;
  end loop;

  -- an API caller cannot switch the guard off by setting the flag itself
  perform t.as_postgres();
  insert into public.orders (id, user_id, order_status) values ('g_bypass', t.alice(), 'shipped');
  perform t.as_user(t.admin());
  perform set_config('app.order_status_guard', 'off', true);
  perform t.fails($q$update public.orders set order_status = 'confirmed' where id = 'g_bypass'$q$, '23514');
  perform t.as_postgres();
  -- born rows are not constrained (billing / bulk import insert 'delivered' directly)
  insert into public.orders (id, user_id, order_status) values ('g_born', null, 'delivered');
  perform t.ok(true, 'inserting a born-delivered order is not constrained');
end $$;

-- 4. ship_order ---------------------------------------------------------------------------------------------------------------
do $$
declare
  v_r     jsonb;
  v_sid   uuid;
  v_n     integer;
  v_ship  record;
  v_priv  record;
  v_note  record;
begin
  perform t.as_user(t.alice());
  perform t.fails($q$select public.ship_order('t_o1')$q$, '42501', 'Admin access required');
  perform t.as_anon();
  perform t.fails($q$select public.ship_order('t_o1')$q$, '42501');
  perform t.as_user(t.admin());
  perform t.fails($q$select public.ship_order('no_such_order')$q$, 'P0002');
  perform t.fails($q$select public.ship_order('order_legacy_1')$q$, '22023', '%cannot be shipped%');     -- delivered
  perform t.fails($q$select public.ship_order('t_o1', 'nope')$q$, '22023', 'Unknown courier%');
  perform t.fails($q$select public.ship_order('t_o1', 'indiapost')$q$, '22023', '%switched off%');
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'X1', 'ftp://bad')$q$, '22023');
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'X1', null, null, -5)$q$, '22023');
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'X1', null, now() + interval '3 days')$q$, '22023');
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'X1', null, null, null, null, '{"a":1}'::jsonb)$q$, '22023');
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'X1', null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000003","quantity":1}]'::jsonb)$q$, '22023', '%does not belong%');
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'X1', null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000001","quantity":3}]'::jsonb)$q$, '22023', 'Only 2 unit(s)%');
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'X1', null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000001","quantity":0}]'::jsonb)$q$, '22023');
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'X1', null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000001","quantity":1},{"order_item_id":"22222222-0000-0000-0000-000000000001","quantity":1}]'::jsonb)$q$, '22023', '%twice%');
  perform t.ok((select order_status from public.orders where id = 't_o1') = 'placed', 'failed attempts changed nothing');
  perform t.ok((select count(*) from public.shipments where order_id = 't_o1') = 0, 'and created no shipment');

  -- the happy path: DTDC with a tracking number, charges, a note and an expected date
  v_r := public.ship_order('t_o1', 'dtdc', 'AWB 123/4', null, now() - interval '1 hour', 55.5, 'fragile', null, null, (current_date + 5));
  perform t.ok((v_r ->> 'ok')::boolean and (v_r ->> 'created')::boolean, 'ship_order created the shipment');
  perform t.eq(v_r ->> 'order_status', 'shipped', 'and the order is shipped');
  v_sid := (v_r -> 'shipment' ->> 'id')::uuid;
  select * into v_ship from public.shipments where id = v_sid;
  perform t.eq(v_ship.courier_code, 'dtdc', 'courier recorded');
  perform t.eq(v_ship.courier_name, 'DTDC', 'courier name snapshot');
  perform t.eq(v_ship.tracking_number, 'AWB 123/4', 'tracking number recorded');
  perform t.eq(v_ship.tracking_url, 'https://track.example.test/dtdc?awb=AWB%20123%2F4', 'tracking link generated from the courier template');
  perform t.eq(v_ship.status, 'created', 'status = created');
  perform t.eq(v_ship.direction, 'outbound', 'direction = outbound');
  perform t.ok(v_ship.expected_delivery_date = current_date + 5, 'expected delivery date recorded');
  select * into v_priv from public.shipment_private where shipment_id = v_sid;
  perform t.eq(v_priv.charges::text, '55.50', 'charges recorded (admin-only table)');
  perform t.eq(v_priv.note, 'fragile', 'internal note recorded (admin-only table)');
  perform t.ok((select count(*) from public.shipment_items where shipment_id = v_sid) = 2, 'both order lines are on the shipment');
  perform t.ok((select sum(quantity) from public.shipment_items where shipment_id = v_sid) = 3, 'with their full quantities');
  perform t.ok(exists (select 1 from public.shipment_events where shipment_id = v_sid and event_type = 'created'), 'a "created" event was written');

  -- the customer is notified ONCE, with the courier and the tracking number (the generic trigger message is suppressed)
  perform t.as_postgres();
  select count(*) into v_n from public.notifications where user_id = t.alice() and kind = 'order_update' and data ->> 'orderId' = 't_o1';
  perform t.eq(v_n::text, '1', 'exactly one notification for the shipment');
  select * into v_note from public.notifications where user_id = t.alice() and data ->> 'orderId' = 't_o1';
  perform t.eq(v_note.title, 'Your order is on its way', 'notification title');
  perform t.ok(v_note.body like '%DTDC%' and v_note.body like '%AWB 123/4%', 'the notification names the courier and the tracking number');
  perform t.eq(v_note.data ->> 'trackingNumber', 'AWB 123/4', 'the notification data carries the tracking number');
  perform t.as_user(t.admin());

  -- retrying the same parcel is harmless
  v_r := public.ship_order('t_o1', 'dtdc', 'AWB 123/4');
  perform t.ok(not (v_r ->> 'created')::boolean, 'the same courier + tracking number is the same parcel (idempotent)');
  perform t.ok((select count(*) from public.shipments where order_id = 't_o1') = 1, 'still exactly one shipment');
  perform t.as_postgres();
  perform t.ok((select count(*) from public.notifications where user_id = t.alice() and data ->> 'orderId' = 't_o1') = 1, 'and no second notification');
  perform t.as_user(t.admin());
  perform t.fails($q$select public.ship_order('t_o1', 'manual', 'OTHER-1')$q$, '22023', '%already on a shipment%');

  -- partial shipments: 3 units of one line go out as 2 + 1
  v_r := public.ship_order('t_o3', 'manual', null, null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000003","quantity":2}]'::jsonb, 'Local rider');
  perform t.eq(v_r -> 'shipment' ->> 'courier_name', 'Local rider', 'a free-text courier name is kept for "manual"');
  perform t.ok(v_r -> 'shipment' ->> 'tracking_number' is null, 'tracking number is optional');
  perform t.eq(public.app_order_item_remaining('22222222-0000-0000-0000-000000000003')::text, '1', 'one unit left to ship');
  perform t.fails($q$select public.ship_order('t_o3', 'manual', 'R-9', null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000003","quantity":2}]'::jsonb)$q$, '22023', 'Only 1 unit(s)%');
  v_r := public.ship_order('t_o3', 'manual', 'R-2');
  perform t.ok((v_r ->> 'created')::boolean, 'the remaining unit ships with an empty item list = "everything left"');
  perform t.eq(public.app_order_item_remaining('22222222-0000-0000-0000-000000000003')::text, '0', 'nothing left');
  perform t.fails($q$select public.ship_order('t_o3', 'manual', 'R-3')$q$, '22023', '%already on a shipment%');

  -- writes only through the RPCs
  perform t.fails($q$insert into public.shipments (order_id) values ('t_o5')$q$, '42501');
  perform t.fails($q$update public.shipments set status = 'delivered'$q$, '42501');
  perform t.fails($q$delete from public.shipments$q$, '42501');
  perform t.fails($q$insert into public.shipment_events (shipment_id, provider_event_id, event_type) values (gen_random_uuid(), 'x', 'delivered')$q$, '42501');

  -- the units-per-line cap holds even for a writer that bypasses the RPC (the DB owner)
  perform t.as_postgres();
  perform t.fails(format($f$insert into public.shipment_items (shipment_id, order_item_id, quantity) values (%L, '22222222-0000-0000-0000-000000000001', 1)$f$,
                         (select s.id from public.shipments s where s.order_id = 't_o3' limit 1)), '23514', '%does not belong%');
  perform t.fails(format($f$update public.shipment_items set quantity = 9 where shipment_id = %L$f$, v_sid), '23514', 'Cannot ship%');
end $$;

-- 5. add_shipment_event: statuses, idempotency, out-of-order, order delivery ------------------------------------------------------
do $$
declare
  v_sid   uuid := (select id from public.shipments where order_id = 't_o1');
  v_r     jsonb;
  v_t0    timestamptz := now() - interval '50 minutes';
  v_n     integer;
  v_at    timestamptz;
  v_key   text := 'evt-' || gen_random_uuid()::text;
begin
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.add_shipment_event(%L, 'picked_up')$q$, v_sid), '42501', 'Admin access required');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.add_shipment_event(%L, 'bogus')$q$, v_sid), '22023', 'Unknown shipment event type%');
  perform t.fails(format($q$select public.add_shipment_event(%L, 'cancelled')$q$, v_sid), '22023');
  perform t.fails(format($q$select public.add_shipment_event(%L, 'picked_up', now() + interval '1 day')$q$, v_sid), '22023', '%future%');
  perform t.fails($q$select public.add_shipment_event(gen_random_uuid(), 'picked_up')$q$, 'P0002');

  v_r := public.add_shipment_event(v_sid, 'picked_up', v_t0, 'Chennai hub', 'Picked up by courier', 'manual', 'k-pick');
  perform t.eq(v_r ->> 'status', 'picked_up', 'picked up');
  v_r := public.add_shipment_event(v_sid, 'in_transit', v_t0 + interval '10 minutes', 'Bengaluru', null, 'manual', 'k-transit');
  perform t.eq(v_r ->> 'status', 'in_transit', 'in transit');
  perform t.eq(v_r ->> 'order_status', 'shipped', 'the order stays shipped');
  -- a late, OLDER event arriving after a newer one does not move the status backwards
  v_r := public.add_shipment_event(v_sid, 'picked_up', v_t0 - interval '5 minutes', null, 'late scan', 'manual', 'k-late');
  perform t.eq(v_r ->> 'status', 'in_transit', 'a late older event cannot move the status backwards');
  v_r := public.add_shipment_event(v_sid, 'out_for_delivery', v_t0 + interval '20 minutes', 'Local depot', null, 'manual', v_key);
  perform t.eq(v_r ->> 'status', 'out_for_delivery', 'out for delivery');
  perform t.as_postgres();
  perform t.ok((select count(*) from public.notifications where user_id = t.alice() and title = 'Out for delivery' and data ->> 'orderId' = 't_o1') = 1, 'the customer was told once');
  perform t.as_user(t.admin());
  -- the same event again (retry / double click / duplicate webhook)
  v_r := public.add_shipment_event(v_sid, 'out_for_delivery', v_t0 + interval '20 minutes', 'Local depot', null, 'manual', v_key);
  perform t.ok(not (v_r ->> 'inserted')::boolean, 'a repeated event key is ignored');
  perform t.ok((select count(*) from public.shipment_events where shipment_id = v_sid and event_type = 'out_for_delivery') = 1, 'no duplicate event row');
  perform t.as_postgres();
  perform t.ok((select count(*) from public.notifications where user_id = t.alice() and title = 'Out for delivery' and data ->> 'orderId' = 't_o1') = 1, 'and no duplicate notification');
  perform t.as_user(t.admin());

  -- failed attempt, then retry
  v_r := public.add_shipment_event(v_sid, 'delivery_failed', v_t0 + interval '25 minutes', null, 'Customer not available', 'manual', 'k-fail');
  perform t.eq(v_r ->> 'status', 'delivery_failed', 'delivery failed');
  v_r := public.add_shipment_event(v_sid, 'out_for_delivery', v_t0 + interval '30 minutes', null, null, 'manual', 'k-ofd2');
  perform t.eq(v_r ->> 'status', 'out_for_delivery', 'a new attempt is allowed after a failure');

  -- delivered: the shipment AND the order advance, delivered_at comes from the event
  v_r := public.add_shipment_event(v_sid, 'delivered', v_t0 + interval '40 minutes', 'Customer address', 'Signed by customer', 'manual', 'k-deliv');
  perform t.eq(v_r ->> 'status', 'delivered', 'delivered');
  perform t.eq(v_r ->> 'order_status', 'delivered', 'the order advanced to delivered');
  perform t.ok((select delivered_at from public.orders where id = 't_o1') = v_t0 + interval '40 minutes', 'orders.delivered_at = the delivery event time');
  perform t.eq((select delivered_at_source from public.orders where id = 't_o1'), 'shipment', 'source = shipment');
  perform t.ok((select delivered_at from public.shipments where id = v_sid) = v_t0 + interval '40 minutes', 'shipments.delivered_at set');
  -- duplicates / late scans after delivery change nothing
  v_r := public.add_shipment_event(v_sid, 'delivered', v_t0 + interval '45 minutes', null, 'duplicate scan', 'manual', 'k-deliv2');
  perform t.ok((v_r ->> 'inserted')::boolean, 'a second delivery scan is recorded as history');
  perform t.ok((select delivered_at from public.orders where id = 't_o1') = v_t0 + interval '40 minutes', 'but delivered_at does not move');
  v_r := public.add_shipment_event(v_sid, 'in_transit', v_t0 + interval '50 minutes', null, 'late scan after delivery', 'manual', 'k-after');
  perform t.eq(v_r ->> 'status', 'delivered', 'delivered is sticky');
  perform t.as_postgres();
  select count(*) into v_n from public.notifications where user_id = t.alice() and title = 'Order delivered' and data ->> 'orderId' = 't_o1';
  perform t.eq(v_n::text, '1', 'the order-delivered notification was sent exactly once');
  perform t.as_user(t.admin());
  perform t.fails($q$update public.orders set order_status = 'shipped' where id = 't_o1'$q$, '23514');

  -- service role (courier webhook): may name its provider; replays are harmless
  perform t.as_postgres();
  perform t.as_service();
  v_r := public.add_shipment_event((select id from public.shipments where order_id = 't_o3' and tracking_number = 'R-2'), 'in_transit', now() - interval '5 minutes', 'Hub', null, 'dtdc', 'DTDC-77', '{"raw":"x"}'::jsonb);
  perform t.ok((v_r ->> 'inserted')::boolean, 'the service role (webhook) can record an event');
  v_r := public.add_shipment_event((select id from public.shipments where order_id = 't_o3' and tracking_number = 'R-2'), 'in_transit', now() - interval '5 minutes', 'Hub', null, 'dtdc', 'DTDC-77', '{"raw":"x"}'::jsonb);
  perform t.ok(not (v_r ->> 'inserted')::boolean, 'a replayed webhook delivery is ignored');
  perform t.as_postgres();
  perform t.eq((select provider from public.shipment_events where provider_event_id = 'DTDC-77'), 'dtdc', 'the webhook provider was kept');
  perform t.as_user(t.admin());
  v_r := public.add_shipment_event((select id from public.shipments where order_id = 't_o3' and tracking_number = 'R-2'), 'note', now() - interval '4 minutes', null, 'spoof attempt', 'dtdc', 'DTDC-78');
  perform t.as_postgres();
  perform t.eq((select provider from public.shipment_events where description = 'spoof attempt'), 'manual', 'an admin cannot pose as a courier provider');
end $$;

-- 6. multi-parcel orders and partial shipping --------------------------------------------------------------------------------------
do $$
declare
  v_a uuid := (select id from public.shipments where order_id = 't_o3' and tracking_number is null);       -- the first parcel (2 units, no number)
  v_b uuid := (select id from public.shipments where order_id = 't_o3' and tracking_number = 'R-2');       -- the second parcel (1 unit)
  v_r jsonb;
  v_t timestamptz := now() - interval '30 minutes';
begin
  perform t.as_user(t.admin());
  perform t.ok(v_a <> v_b, 'the multi-parcel order has two shipments');
  v_r := public.add_shipment_event(v_a, 'delivered', v_t);
  perform t.eq(v_r ->> 'order_status', 'shipped', 'one parcel delivered: the order is still shipped');
  v_r := public.add_shipment_event(v_b, 'delivered', v_t + interval '10 minutes');
  perform t.eq(v_r ->> 'order_status', 'delivered', 'both parcels delivered: the order is delivered');
  perform t.ok((select delivered_at from public.orders where id = 't_o3') = v_t + interval '10 minutes', 'delivered_at = the LAST parcel');

  -- partial: 2 of 3 units shipped and delivered; the order is not delivered yet
  v_r := public.ship_order('t_o4', 'manual', 'P-1', null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000004","quantity":2}]'::jsonb);
  v_a := (v_r -> 'shipment' ->> 'id')::uuid;
  v_r := public.add_shipment_event(v_a, 'delivered', v_t);
  perform t.eq(v_r ->> 'order_status', 'shipped', 'a delivered partial shipment does not deliver the order');
  v_r := public.ship_order('t_o4', 'manual', 'P-2');
  v_b := (v_r -> 'shipment' ->> 'id')::uuid;
  v_r := public.add_shipment_event(v_b, 'delivered', v_t + interval '5 minutes');
  perform t.eq(v_r ->> 'order_status', 'delivered', 'the last unit delivered: the order is delivered');
end $$;

-- 7. mark_delivered -------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
  v_a uuid;
  v_b uuid;
begin
  perform t.as_user(t.alice());
  perform t.fails($q$select public.mark_delivered('t_o6')$q$, '42501');
  perform t.as_user(t.admin());
  perform t.fails($q$select public.mark_delivered('t_o6')$q$, '22023', '%Only a shipped order%');           -- confirmed
  perform t.fails($q$select public.mark_delivered('nope')$q$, 'P0002');
  -- two open parcels are delivered together
  v_r := public.ship_order('t_o6', 'manual', 'M-1', null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000007","quantity":1}]'::jsonb);
  v_r := public.ship_order('t_o6', 'manual', 'M-2');
  v_r := public.mark_delivered('t_o6');
  perform t.eq(v_r ->> 'order_status', 'delivered', 'mark_delivered delivered the order');
  perform t.ok((v_r ->> 'shipments_delivered')::int = 2, 'and both open parcels');
  perform t.ok((select count(*) from public.shipments where order_id = 't_o6' and status = 'delivered') = 2, 'both shipments are delivered');
  v_r := public.mark_delivered('t_o6');
  perform t.ok((v_r ->> 'already')::boolean, 'a second call is a no-op');

  -- a legacy order that was shipped before M3 (no shipment row): the order itself is delivered
  perform t.as_postgres();
  insert into public.orders (id, user_id, order_status) values ('t_legacy_shipped', t.bob(), 'shipped');
  perform t.as_user(t.admin());
  v_r := public.mark_delivered('t_legacy_shipped', now() - interval '2 hours');
  perform t.eq(v_r ->> 'order_status', 'delivered', 'a legacy shipped order can be delivered without a shipment row');
  perform t.eq((select delivered_at_source from public.orders where id = 't_legacy_shipped'), 'manual', 'source = manual');
  perform t.ok((select delivered_at from public.orders where id = 't_legacy_shipped') < now() - interval '1 hour', 'with the given delivery time');
end $$;

-- 8. update_shipment / cancel_shipment ----------------------------------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_sid uuid;
  v_sid2 uuid;
  v_n   integer;
begin
  perform t.as_user(t.admin());
  -- t_o2: shipped by mistake, with a typo in the tracking number
  v_r := public.ship_order('t_o2', 'dtdc', 'TYPO123');
  v_sid := (v_r -> 'shipment' ->> 'id')::uuid;
  perform t.eq(v_r -> 'shipment' ->> 'tracking_url', 'https://track.example.test/dtdc?awb=TYPO123', 'link built from the template');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.update_shipment(%L, '{"tracking_number":"X"}')$q$, v_sid), '42501');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.update_shipment(%L, '{"colour":"red"}')$q$, v_sid), '22023', 'Unknown shipment field%');
  perform t.fails(format($q$select public.update_shipment(%L, '[1]')$q$, v_sid), '22023');
  perform t.fails(format($q$select public.update_shipment(%L, '{"tracking_url":"javascript:x"}')$q$, v_sid), '22023');
  v_r := public.update_shipment(v_sid, '{"tracking_number":"GOOD456","charges":42,"note":"fixed typo"}'::jsonb);
  perform t.eq(v_r -> 'shipment' ->> 'tracking_number', 'GOOD456', 'tracking number corrected');
  perform t.eq(v_r -> 'shipment' ->> 'tracking_url', 'https://track.example.test/dtdc?awb=GOOD456', 'an auto-generated link follows the corrected number');
  perform t.eq(v_r ->> 'charges', '42.00', 'charges updated');
  v_r := public.update_shipment(v_sid, '{"tracking_url":"https://courier.example.test/t/777"}'::jsonb);
  v_r := public.update_shipment(v_sid, '{"tracking_number":"AGAIN789"}'::jsonb);
  perform t.eq(v_r -> 'shipment' ->> 'tracking_url', 'https://courier.example.test/t/777', 'a link typed by hand is never overwritten');
  v_r := public.update_shipment(v_sid, '{"expected_delivery_date":null}'::jsonb);
  perform t.ok(v_r -> 'shipment' ->> 'expected_delivery_date' is null, 'a key present with null clears the field');
  perform t.ok((select count(*) from public.shipment_events where shipment_id = v_sid and event_type = 'note') >= 3, 'every edit leaves a history note');

  -- cancel: the only parcel of the order -> back to confirmed, without a second "confirmed" message
  perform t.as_postgres();
  select count(*) into v_n from public.notifications where user_id = t.alice() and data ->> 'orderId' = 't_o2';
  perform t.as_user(t.admin());
  v_r := public.cancel_shipment(v_sid, 'sent to the wrong address');
  perform t.eq(v_r ->> 'order_status', 'confirmed', 'cancelling the last parcel takes the order back to confirmed');
  perform t.eq((select status from public.shipments where id = v_sid), 'cancelled', 'the shipment is cancelled');
  perform t.as_postgres();
  perform t.eq((select count(*) from public.notifications where user_id = t.alice() and data ->> 'orderId' = 't_o2')::text, v_n::text, 'no extra notification for the revert');
  perform t.as_user(t.admin());
  v_r := public.cancel_shipment(v_sid);
  perform t.ok((v_r ->> 'already')::boolean, 'cancelling twice is a no-op');
  perform t.fails(format($q$select public.add_shipment_event(%L, 'picked_up')$q$, v_sid), '22023', '%cancelled%');
  perform t.fails(format($q$select public.update_shipment(%L, '{"note":"x"}')$q$, v_sid), '22023', '%cancelled%');
  -- the same tracking number can be used again on a new shipment (the cancelled one does not count)
  v_r := public.ship_order('t_o2', 'dtdc', 'GOOD456');
  perform t.ok((v_r ->> 'created')::boolean, 're-shipping after a cancel works');
  v_sid2 := (v_r -> 'shipment' ->> 'id')::uuid;
  perform t.fails(format($q$select public.cancel_shipment(%L)$q$, (select id from public.shipments where order_id = 't_o1')), '22023', '%delivered%');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.cancel_shipment(%L)$q$, v_sid2), '42501');
  perform t.as_user(t.admin());

  -- two parcels: cancelling one keeps the order shipped
  perform t.as_postgres();
  insert into public.orders (id, user_id, order_status) values ('t_o7', t.alice(), 'confirmed');
  insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total) values ('22222222-0000-0000-0000-000000000008', 't_o7', 'p1', 'Item Q', 2, 10, 20);
  perform t.as_user(t.admin());
  v_r := public.ship_order('t_o7', 'manual', 'Q-1', null, null, null, null, '[{"order_item_id":"22222222-0000-0000-0000-000000000008","quantity":1}]'::jsonb);
  v_sid := (v_r -> 'shipment' ->> 'id')::uuid;
  v_r := public.ship_order('t_o7', 'manual', 'Q-2');
  v_r := public.cancel_shipment(v_sid);
  perform t.eq(v_r ->> 'order_status', 'shipped', 'with another parcel still out the order stays shipped');
end $$;

-- 9. who can see what ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  -- alice owns t_o1 .. t_o4, t_o6, t_o7; bob owns t_o5 (no shipment)
  perform t.as_user(t.alice());
  select count(*) into v_n from public.shipments;
  perform t.ok(v_n >= 6, 'a customer sees the shipments of her own orders');
  perform t.ok(not exists (select 1 from public.shipments s join public.orders o on o.id = s.order_id where o.user_id <> t.alice()), 'and only those');
  perform t.ok((select count(*) from public.shipment_items) >= 6, 'she sees the items of her own shipments');
  perform t.ok((select count(*) from public.shipment_private) = 0, 'but never the admin-only fields (charges, notes)');
  perform t.ok((select count(*) from public.shipment_events where event_type in ('picked_up', 'in_transit', 'delivered')) >= 3, 'she sees the tracking history ...');
  perform t.fails($q$select provider from public.shipment_events$q$, '42501');
  perform t.fails($q$select payload from public.shipment_events$q$, '42501');
  perform t.fails($q$select * from public.shipment_events$q$, '42501');
  perform t.ok((select count(*) from (select id, shipment_id, event_type, occurred_at, location, description, created_at from public.shipment_events) e) >= 3, '... through the customer-safe columns');

  perform t.as_user(t.bob());
  perform t.ok((select count(*) from public.shipments) = 0, 'another customer sees none of them');
  perform t.ok((select count(*) from public.shipment_items) = 0, '... nor their items');
  perform t.ok((select count(*) from (select id from public.shipment_events) e) = 0, '... nor their events');

  perform t.as_anon();
  perform t.fails($q$select * from public.shipments$q$, '42501');
  perform t.fails($q$select * from public.couriers$q$, '42501');

  perform t.as_user(t.admin());
  perform t.ok((select count(*) from public.shipment_private) >= 6, 'the admin sees the private fields');
  perform t.ok((select count(*) from public.shipments) >= 8, 'the admin sees every shipment');
  perform t.as_postgres();
end $$;

rollback;