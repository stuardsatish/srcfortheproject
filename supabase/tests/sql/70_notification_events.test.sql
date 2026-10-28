-- needs: m7
-- setup: setup/order_status_trigger.sql
-- reapply: 20261018_01_notification_events.sql
-- Phase 14 — M7: the four notification events the earlier migrations did not raise (order placed, request received, tracking number added later, another
-- parcel), exactly ONE message per event and recipient, none on a retry, preferences respected, a failure to write a notification never blocks the order /
-- request / shipment, and the payload contract (kind + data.type) the clients (notificationModel.js) understand.
-- Orders are placed with the REAL create_order_tx, shipped with the REAL ship_order. ("reapply" = M7 is applied a SECOND time first: the idempotency test.)
begin;

create or replace function t.sale(p_product text, p_variant text, p_qty int, p_unit numeric) returns jsonb language sql as $$
  select jsonb_build_object('product_id', p_product, 'variant_id', nullif(p_variant, ''), 'variant_name', null, 'title', 'Item ' || p_product, 'quantity', p_qty, 'unit_price', p_unit,
                            'discount', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'line_total', p_qty * p_unit)
$$;
-- an order placed through the REAL create_order_tx, with the source / status of the channel under test
create or replace function t.place2(p_id text, p_user uuid, p_items jsonb, p_source text default 'online', p_status text default 'placed', p_method text default 'Razorpay') returns void
language plpgsql as $$
declare v_total numeric;
begin
  select coalesce(sum((e.value ->> 'line_total')::numeric), 0) into v_total from jsonb_array_elements(p_items) e;
  perform public.create_order_tx(p_order_id := p_id, p_user_id := p_user, p_items := p_items, p_order_status := p_status, p_payment_status := 'paid',
    p_payment_method := p_method, p_source := p_source, p_customer_name := 'T', p_customer_email := 't@example.test', p_customer_phone := '9999999999', p_address := '{}'::jsonb,
    p_subtotal := v_total, p_shipping := 0, p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := v_total,
    p_razorpay_order_id := case when p_method = 'Razorpay' then 'rzp_' || p_id end, p_razorpay_payment_id := case when p_method = 'Razorpay' then 'pay_' || p_id end);
end $$;
create or replace function t.delivered_order(p_id text, p_user uuid, p_items jsonb) returns void
language plpgsql as $$
begin
  perform t.place2(p_id, p_user, p_items);
  perform t.as_user(t.admin());
  perform public.ship_order(p_id, 'manual');
  perform public.mark_delivered(p_id);
  perform t.as_postgres();
end $$;
create or replace function t.line_id(p_order text, p_product text, p_variant text default '') returns text language sql security definer as $$
  select id::text from public.order_items where order_id = p_order and product_id = p_product and variant_id = p_variant order by id limit 1 $$;
create or replace function t.xi(p_order_item text, p_qty int) returns jsonb language sql as $$
  select jsonb_build_object('order_item_id', p_order_item, 'quantity', p_qty)
$$;
-- counting what a user was told (security definer: the suite also counts as other roles)
create or replace function t.n(p_uid uuid, p_title text, p_order text default null) returns integer language sql security definer as $$
  select count(*)::int from public.notifications where user_id = p_uid and title = p_title and (p_order is null or data ->> 'orderId' = p_order) $$;
create or replace function t.nrow(p_uid uuid, p_title text, p_order text default null) returns public.notifications language sql security definer as $$
  select * from public.notifications where user_id = p_uid and title = p_title and (p_order is null or data ->> 'orderId' = p_order) order by id limit 1 $$;
create or replace function t.nall() returns integer language sql security definer as $$ select count(*)::int from public.notifications $$;

-- 1. ORDER PLACED: the customer's own checkout, once ---------------------------------------------------------------------------------------------------------
do $$
declare
  r public.notifications;
  n0 integer;
begin
  perform t.place2('nt_o1', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.eq(t.n(t.alice(), 'Order placed', 'nt_o1')::text, '1', 'a customer''s own checkout sends "Order placed" once');
  r := t.nrow(t.alice(), 'Order placed', 'nt_o1');
  perform t.eq(r.kind, 'order_update', 'kind order_update (the kind old app builds can render)');
  perform t.eq(r.data ->> 'type', 'order', 'data.type = order');
  perform t.eq(r.data ->> 'status', 'placed', 'data.status = placed');
  perform t.ok(r.body like '%#NT_O1%', 'the body names the order by its short reference');
  perform t.eq(r.push_status, 'pending', 'queued for the push dispatcher');

  n0 := (select stock from public.products where id = 'prod_single_a');
  perform t.place2('nt_o1', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));      -- the same order id again = create_order_tx replays, inserts nothing
  perform t.eq(t.n(t.alice(), 'Order placed', 'nt_o1')::text, '1', 'a replay of the same order (a retry) sends nothing more');
  perform t.ok((select stock from public.products where id = 'prod_single_a') = n0 and (select count(*) from public.orders where id = 'nt_o1') = 1
               and (select count(*) from public.inventory_logs where order_id = 'nt_o1' and movement_type = 'sale') = 1,
               'and the replay is idempotent where it matters: one order row, one ledger row, the stock deducted once (a duplicate webhook + checkout verify)');

  -- other channels: nothing
  n0 := t.nall();
  perform t.place2('nt_o2', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), 'manual', 'placed', 'WhatsApp');
  perform t.eq(t.n(t.alice(), 'Order placed', 'nt_o2')::text, '0', 'a WhatsApp order the admin keyed in for her: no "Order placed" (she already chatted it)');
  perform t.place2('nt_o3', null, jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), 'billing', 'delivered', 'Cash');
  perform t.place2('nt_o4', null, jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));          -- online but a guest without an account
  perform t.place2('nt_o5', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), 'manual', 'delivered', 'Imported');
  perform t.ok(t.nall() = n0, 'POS billing, a guest checkout and an imported historic order send nothing (and fail nothing)');
  -- a historic online order inserted as delivered is not "placed"
  insert into public.orders (id, user_id, order_status, payment_status, source, customer_name, total) values ('nt_hist', t.alice(), 'delivered', 'paid', 'online', 'Alice', 100);
  perform t.ok(t.nall() = n0, 'an online order that is already delivered is not announced as placed');

  -- inserted already confirmed: still one message
  perform t.place2('nt_o6', t.bob(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), 'online', 'confirmed');
  perform t.eq(t.n(t.bob(), 'Order placed', 'nt_o6')::text, '1', 'an online order that starts as confirmed is announced once');
  perform t.eq((t.nrow(t.bob(), 'Order placed', 'nt_o6')).data ->> 'status', 'confirmed', 'with its real status');
end $$;

-- 2. the existing status messages are untouched and not doubled -----------------------------------------------------------------------------------------------
do $$
begin
  perform t.as_user(t.admin());
  perform public.ship_order('nt_o1', 'manual');
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Your order is on its way', 'nt_o1')::text, '1', 'shipping the first parcel: ONE "on its way" (from ship_order)');
  perform t.eq(t.n(t.alice(), 'Another parcel is on its way', 'nt_o1')::text, '0', 'the first parcel is not announced twice');
  perform t.eq(t.n(t.alice(), 'Tracking number added', 'nt_o1')::text, '0', 'no tracking number was added later');
  perform t.as_user(t.admin());
  perform public.mark_delivered('nt_o1');
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Order delivered', 'nt_o1')::text, '1', 'delivered: one message');
  perform t.eq(t.n(t.alice(), 'Order placed', 'nt_o1')::text, '1', 'and the order-placed message is still the only one of its kind');
end $$;

-- 3. TRACKING NUMBER ADDED later, once ------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_ship uuid;
  r      public.notifications;
begin
  perform t.place2('nt_t1', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.as_user(t.admin());
  v_ship := ((public.ship_order('nt_t1', 'manual')) -> 'shipment' ->> 'id')::uuid;      -- shipped with NO tracking number
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Your order is on its way', 'nt_t1')::text, '1', 'shipped without a number: the customer is told it is on its way');
  perform t.ok((t.nrow(t.alice(), 'Your order is on its way', 'nt_t1')).body not like '%Tracking number%', '... without a tracking number in it');
  perform t.eq(t.n(t.alice(), 'Tracking number added', 'nt_t1')::text, '0', 'nothing about tracking yet');

  perform t.as_user(t.admin());
  perform public.update_shipment(v_ship, '{"tracking_number":"TRK-1001"}'::jsonb);
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Tracking number added', 'nt_t1')::text, '1', 'the admin types the number later: ONE "Tracking number added"');
  r := t.nrow(t.alice(), 'Tracking number added', 'nt_t1');
  perform t.ok(r.body like '%TRK-1001%', 'the body carries the number');
  perform t.eq(r.data ->> 'trackingNumber', 'TRK-1001', 'and so does the data (the app can show it)');
  perform t.eq(r.data ->> 'shipmentId', v_ship::text, 'with the shipment id');
  perform t.eq(r.data ->> 'type', 'order', 'data.type = order: the message opens the order');

  perform t.as_user(t.admin());
  perform public.update_shipment(v_ship, '{"tracking_number":"TRK-1002"}'::jsonb);      -- a typo corrected: not news
  perform public.update_shipment(v_ship, '{"note":"called the depot"}'::jsonb);          -- another edit: not news
  perform public.update_shipment(v_ship, '{"tracking_number":"TRK-1002"}'::jsonb);      -- the same value again
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Tracking number added', 'nt_t1')::text, '1', 'correcting the number, or editing something else, sends nothing more');

  -- a courier's own number given at ship time is part of "on its way" and is never announced a second time
  perform t.place2('nt_t2', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.as_user(t.admin());
  perform public.ship_order('nt_t2', 'manual', 'TRK-2001');
  perform public.ship_order('nt_t2', 'manual', 'TRK-2001');                               -- the admin double-clicks: the same parcel
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Your order is on its way', 'nt_t2')::text, '1', 'shipped WITH a number: one message, and a retry of the same parcel adds none');
  perform t.ok((t.nrow(t.alice(), 'Your order is on its way', 'nt_t2')).body like '%TRK-2001%', 'carrying the number');
  perform t.eq(t.n(t.alice(), 'Tracking number added', 'nt_t2')::text, '0', 'no separate "tracking added"');
  perform t.eq(t.n(t.alice(), 'Another parcel is on its way', 'nt_t2')::text, '0', 'and the retried parcel is not "another parcel"');
end $$;

-- 4. ANOTHER PARCEL of an order that is already shipped (partial shipments) ---------------------------------------------------------------------------------------
do $$
declare
  l1 text; l2 text;
begin
  perform t.place2('nt_p1', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 2, 500), t.sale('prod_vmain_ok', '', 1, 450)));
  l1 := t.line_id('nt_p1', 'prod_single_a');
  l2 := t.line_id('nt_p1', 'prod_vmain_ok');
  perform t.as_user(t.admin());
  perform public.ship_order('nt_p1', 'manual', 'TRK-A', null, null, null, null, jsonb_build_array(t.xi(l1, 2)));
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Your order is on its way', 'nt_p1')::text, '1', 'parcel 1: the order is on its way');
  perform t.eq(t.n(t.alice(), 'Another parcel is on its way', 'nt_p1')::text, '0', 'parcel 1 is not "another"');
  perform t.as_user(t.admin());
  perform public.ship_order('nt_p1', 'manual', 'TRK-B', null, null, null, null, jsonb_build_array(t.xi(l2, 1)));
  perform public.ship_order('nt_p1', 'manual', 'TRK-B', null, null, null, null, jsonb_build_array(t.xi(l2, 1)));   -- retry
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Another parcel is on its way', 'nt_p1')::text, '1', 'parcel 2: ONE "Another parcel is on its way" (the retry adds none)');
  perform t.ok((t.nrow(t.alice(), 'Another parcel is on its way', 'nt_p1')).body like '%TRK-B%', 'with its own tracking number');
  perform t.eq(t.n(t.alice(), 'Your order is on its way', 'nt_p1')::text, '1', 'and the first announcement is unchanged');
end $$;

-- 5. RETURN / EXCHANGE REQUEST RECEIVED: the customer is told, the admins as before, once ------------------------------------------------------------------------------
do $$
declare
  v1 uuid := gen_random_uuid();
  v2 uuid := gen_random_uuid();
  v3 uuid := gen_random_uuid();
  l  text;
  l2 text;
  l3 text;
  r  public.notifications;
begin
  -- one delivered order per request: an order line can have only ONE request in progress
  perform t.delivered_order('nt_r1', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 3, 500)));
  perform t.delivered_order('nt_r2', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.delivered_order('nt_r3', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  l  := t.line_id('nt_r1', 'prod_single_a');
  l2 := t.line_id('nt_r2', 'prod_single_a');
  l3 := t.line_id('nt_r3', 'prod_single_a');

  perform t.as_user(t.alice());
  perform public.create_return_request(v1, 'nt_r1', 'return', jsonb_build_array(t.xi(l, 1)), 'incorrect_size');
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'We received your return request')::text, '1', 'a return request: the customer is told it arrived');
  r := t.nrow(t.alice(), 'We received your return request');
  perform t.eq(r.data ->> 'type', 'return', 'data.type = return');
  perform t.eq(r.data ->> 'requestId', v1::text, 'with the request id');
  perform t.eq(r.data ->> 'status', 'pending_review', 'and the status at that moment');
  perform t.ok(r.body like 'RET-%', 'the body starts with the request number');
  perform t.eq(t.n(t.admin(), 'New return request')::text, '1', 'the admins were told by M4 and still are, once');

  perform t.as_user(t.alice());
  perform public.create_return_request(v1, 'nt_r1', 'return', jsonb_build_array(t.xi(l, 1)), 'incorrect_size');     -- the app retried the same submit
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'We received your return request')::text, '1', 'a retry of the same request id sends nothing more (the customer)');
  perform t.eq(t.n(t.admin(), 'New return request')::text, '1', '... nor to the admins');

  perform t.as_user(t.alice());
  perform public.create_return_request(v2, 'nt_r2', 'exchange', jsonb_build_array(t.xi(l2, 1)), 'incorrect_size');
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'We received your exchange request')::text, '1', 'an exchange request says exchange');
  perform t.eq((t.nrow(t.alice(), 'We received your exchange request')).data ->> 'type', 'exchange', 'data.type = exchange');
  perform t.eq(t.n(t.admin(), 'New exchange request')::text, '1', 'and the admins hear it as before');

  -- an admin opens a request on the customer's behalf
  perform t.as_user(t.admin());
  perform public.create_return_request(v3, 'nt_r3', 'return', jsonb_build_array(t.xi(l3, 1)), 'incorrect_size', null, null, '[]'::jsonb, true);
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Return request opened for you')::text, '1', 'a request the admin opened on her behalf says so');
  perform t.ok((t.nrow(t.alice(), 'Return request opened for you')).body like '%on your behalf%', 'in plain words');
  perform t.eq(t.n(t.alice(), 'We received your return request')::text, '1', 'and the "we received" message is not repeated');
  perform t.ok(t.n(t.bob(), 'We received your return request') = 0, 'nothing leaks to another customer');
end $$;

-- 6. PREFERENCES: the row still exists (inbox) but no push is queued when the customer switched order updates off ------------------------------------------------------
do $$
begin
  insert into public.notification_preferences (user_id, order_updates) values (t.bob(), false) on conflict (user_id) do update set order_updates = false;
  perform t.place2('nt_pref', t.bob(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.eq(t.n(t.bob(), 'Order placed', 'nt_pref')::text, '1', 'the inbox row is written even with order updates switched off');
  perform t.eq((t.nrow(t.bob(), 'Order placed', 'nt_pref')).push_status, 'skipped', 'but no push is queued for it');
end $$;

-- 7. A FAILURE TO WRITE A NOTIFICATION NEVER BLOCKS THE ORDER, THE REQUEST OR THE SHIPMENT -----------------------------------------------------------------------------
do $$
declare
  v uuid := gen_random_uuid();
  l text;
  n0 integer;
  s uuid;
begin
  perform t.delivered_order('nt_f1', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  l := t.line_id('nt_f1', 'prod_single_a');
  perform t.place2('nt_f2', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  n0 := t.nall();

  alter table public.notifications add constraint t_block_every_insert check (false) not valid;        -- every INSERT into the inbox now fails

  perform t.place2('nt_f3', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.ok(exists (select 1 from public.orders where id = 'nt_f3'), 'the order is created although "Order placed" could not be written');

  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'nt_f1', 'return', jsonb_build_array(t.xi(l, 1)), 'incorrect_size');
  perform t.as_postgres();
  perform t.ok(exists (select 1 from public.return_requests where id = v and status = 'pending_review'), 'the request is created although no notification could be written (customer or admins)');

  perform t.as_user(t.admin());
  s := ((public.ship_order('nt_f2', 'manual')) -> 'shipment' ->> 'id')::uuid;
  perform public.update_shipment(s, '{"tracking_number":"TRK-F"}'::jsonb);
  perform t.as_postgres();
  perform t.ok((select order_status from public.orders where id = 'nt_f2') = 'shipped' and (select tracking_number from public.shipments where id = s) = 'TRK-F',
               'the shipment, its status change and the tracking number are saved although no notification could be written');
  perform t.ok(t.nall() = n0, 'and no notification row appeared');

  alter table public.notifications drop constraint t_block_every_insert;
  perform t.place2('nt_f4', t.alice(), jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.eq(t.n(t.alice(), 'Order placed', 'nt_f4')::text, '1', 'once the inbox accepts rows again the next order is announced as usual');
end $$;

-- 8. THE PAYLOAD CONTRACT: every data.type the installed functions can write is one the clients understand --------------------------------------------------------------
-- (keep in step with CUSTOMER_DATA_TYPES + ADMIN_DATA_TYPES of src/features/notifications/notificationModel.js - its own test pins that list)
do $$
declare
  known text[] := array['order', 'product', 'return', 'exchange', 'refund', 'payment_exception', 'admin_request', 'admin_refund', 'admin_payment_exception'];
  found text[];
  unknown_types text[];
begin
  -- only functions that queue notifications (directly or through the app_notify_* helpers) are looked at
  select array_agg(distinct s.x order by s.x) into found
    from (select (regexp_matches(p.prosrc, '''type'',\s*''([a-z_]+)''', 'g'))[1] as x
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.prosrc ilike '%app_queue_notification%' or p.prosrc ilike '%app_notify_%')) s;
  select coalesce(array_agg(x), '{}') into unknown_types from unnest(found) x where x <> all (known);
  perform t.ok(coalesce(array_length(found, 1), 0) >= 6, format('the scan found the literal data.type values the functions write (%s)', array_to_string(found, ', ')));
  perform t.ok(coalesce(array_length(unknown_types, 1), 0) = 0, 'every literal data.type written by the database is one the clients understand: ' || coalesce(array_to_string(unknown_types, ','), 'none unknown'));
  -- the dynamic ones: a request notification carries the request TYPE, which is return | exchange
  perform t.ok(not exists (select 1 from public.notifications where kind not in ('order_update', 'back_in_stock', 'price_drop', 'promotion', 'system')), 'every notification this suite produced has a kind the CHECK allows');
  perform t.ok(not exists (select 1 from public.notifications where coalesce(data ->> 'type', '') <> '' and (data ->> 'type') <> all (known)), 'every notification this suite produced has a known data.type');
end $$;

-- 9. the trigger functions are not callable through the API -------------------------------------------------------------------------------------------------------------
do $$
begin
  perform t.as_user(t.alice());
  perform t.fails($q$select public.trg_notify_order_placed()$q$, '42501');
  perform t.fails($q$select public.trg_notify_request_received()$q$, '42501');
  perform t.fails($q$select public.trg_notify_shipment_tracking()$q$, '42501');
  perform t.as_postgres();
  perform t.ok(not has_function_privilege('anon', 'public.trg_notify_order_placed()', 'execute') and not has_function_privilege('authenticated', 'public.trg_notify_shipment_tracking()', 'execute'),
               'anon and authenticated have no EXECUTE on the new trigger functions');
end $$;

rollback;