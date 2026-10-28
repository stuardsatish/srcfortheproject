-- needs: m5b
-- reapply: 20261017_07_exchange_fulfilment.sql
-- Phase 10 — M5b: exchange processing. Replacement stock is RESERVED (ledger, idempotent) when a line is approved and RELEASED on cancel / failed inspection;
-- the price difference (equal / higher / lower) is recorded, never silently charged or refunded; the replacement is shipped as its own shipment; the exchange
-- closes by itself once the replacement is delivered and the difference is settled. The original order is never touched.
-- ("reapply" = the runner applies the migration a SECOND time before this script: the idempotency test.)
begin;

create or replace function t.vstock(p_v text) returns integer language sql security definer as $$ select stock from public.product_variants where id = p_v $$;
create or replace function t.pstock(p_p text) returns integer language sql security definer as $$ select stock from public.products where id = p_p $$;
create or replace function t.status(p_req uuid) returns text language sql security definer as $$ select status from public.return_requests where id = p_req $$;
create or replace function t.rstatus(p_refund uuid) returns text language sql security definer as $$ select status from public.refunds where id = p_refund $$;
create or replace function t.adj(p_req uuid) returns text language sql security definer as $$ select kind || ':' || amount || ':' || status from public.exchange_adjustments where request_id = p_req $$;
create or replace function t.moves(p_item uuid, p_type text) returns integer language sql security definer as $$ select count(*)::int from public.inventory_logs where ref_id = p_item::text and movement_type = p_type $$;
create or replace function t.first_item(p_req uuid) returns uuid language sql security definer as $$ select id from public.return_request_items where request_id = p_req order by created_at, id limit 1 $$;
create or replace function t.notified(p_uid uuid, p_title text) returns integer language sql security definer as $$ select count(*)::int from public.notifications where user_id = p_uid and title = p_title $$;
create or replace function t.line(p_id text, p_product text, p_variant text, p_vname text, p_qty int, p_price numeric) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'product', p_product, 'variant', p_variant, 'vname', p_vname, 'title', 'Designer Shirt', 'qty', p_qty, 'price', p_price)
$$;
create or replace function t.xi(p_order_item text, p_qty int, p_replacement_variant text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('order_item_id', p_order_item, 'quantity', p_qty, 'replacement_variant_id', p_replacement_variant))
$$;

-- a delivered order (2 days ago, inside every window) with the given lines; Razorpay orders get a payment id
create or replace function t.order_with(p_id text, p_user uuid, p_lines jsonb, p_payment text default 'paid', p_method text default 'Razorpay') returns void
language plpgsql as $$
declare v_total numeric; l jsonb;
begin
  select coalesce(sum((e.value ->> 'qty')::int * (e.value ->> 'price')::numeric), 0) into v_total from jsonb_array_elements(p_lines) e;
  insert into public.orders (id, user_id, order_status, payment_status, payment_method, customer_name, subtotal, shipping, total, razorpay_payment_id,
                             delivered_at, delivered_at_source, created_at)
  values (p_id, p_user, 'delivered', p_payment, p_method, 'Test', v_total, 0, v_total, case when p_method = 'Razorpay' then 'pay_' || p_id end,
          now() - interval '2 days', 'shipment', now() - interval '6 days');
  for l in select e.value from jsonb_array_elements(p_lines) e loop
    insert into public.order_items (id, order_id, product_id, variant_id, title, product_title, variant_name, quantity, unit_price, line_total,
                                    return_enabled, return_window_days, exchange_enabled, exchange_window_days)
    values ((l ->> 'id')::uuid, p_id, l ->> 'product', coalesce(l ->> 'variant', ''), l ->> 'title', l ->> 'title', l ->> 'vname', (l ->> 'qty')::int,
            (l ->> 'price')::numeric, (l ->> 'qty')::int * (l ->> 'price')::numeric, true, 7, true, 7);
  end loop;
end $$;

-- an exchange request taken to "return received, waiting for inspection" (every line approved). Leaves the session as postgres.
create or replace function t.exch_received(p_uid uuid, p_order text, p_items jsonb, p_reason text default 'incorrect_size') returns uuid
language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  d jsonb;
begin
  perform t.as_user(p_uid);
  perform public.create_return_request(v, p_order, 'exchange', p_items, p_reason);
  perform t.as_user(t.admin());
  select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')), '[]'::jsonb) into d from public.return_request_items where request_id = v;
  perform public.decide_request_items(v, d);
  perform public.set_return_logistics(v, 'manual', 'Please post the items to us');
  perform public.record_return_received(v);
  perform t.as_postgres();
  return v;
end $$;
-- ... and with every line PASSED the inspection
create or replace function t.exch(p_uid uuid, p_order text, p_items jsonb, p_reason text default 'incorrect_size') returns uuid
language plpgsql as $$
declare
  v uuid := t.exch_received(p_uid, p_order, p_items, p_reason);
  d jsonb;
begin
  perform t.as_user(t.admin());
  select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'result', 'passed')), '[]'::jsonb) into d from public.return_request_items where request_id = v;
  perform public.record_inspection(v, d);
  perform t.as_postgres();
  return v;
end $$;
-- ... and the admin has started the replacement
create or replace function t.exch_pending(p_uid uuid, p_order text, p_items jsonb) returns uuid
language plpgsql as $$
declare v uuid := t.exch(p_uid, p_order, p_items);
begin
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'replacement_pending');
  perform t.as_postgres();
  return v;
end $$;

-- 1. approving reserves the replacement stock; a retry never reserves twice; cancelling gives it back ---------------------------------------------------
do $$
declare
  v    uuid := gen_random_uuid();
  a    text := '77777777-0000-0000-0000-000000000001';
  it   uuid;
  w0   int;
  x    public.exchange_reservations;
  lg   public.inventory_logs;
  j    jsonb;
begin
  perform t.order_with('x_o1', t.alice(), jsonb_build_array(t.line(a, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 2, 300)));
  w0 := t.vstock('var_1700000000001_1');
  perform t.ok(w0 = 30, 'fixture: White has 30 in stock');

  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'x_o1', 'exchange', jsonb_build_array(t.xi(a, 1, 'var_1700000000001_1')), 'incorrect_size');
  perform t.as_postgres();
  it := t.first_item(v);
  perform t.ok(t.vstock('var_1700000000001_1') = w0 and not exists (select 1 from public.exchange_reservations where request_id = v), 'a submitted request does not touch stock and reserves nothing');

  perform t.as_user(t.admin());
  perform public.decide_request_items(v, jsonb_build_array(jsonb_build_object('item_id', it, 'decision', 'approve')));
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 1, 'approving the line reserves the replacement: White 30 -> 29');
  select * into x from public.exchange_reservations where request_item_id = it;
  perform t.ok(x.status = 'reserved' and x.product_id = 'prod_vmain_ok' and x.variant_id = 'var_1700000000001_1' and x.quantity = 1 and x.stock_moved, 'one reservation row: reserved, the right option and quantity');
  perform t.ok(x.unit_price = 200, 'it remembers the replacement price at that moment (White = 200)');
  select * into lg from public.inventory_logs where ref_id = it::text and movement_type = 'exchange_reserve';
  perform t.ok(lg.change = -1 and lg.bucket = 'sellable' and lg.order_id = 'x_o1' and lg.idempotency_key = 'exres:' || it::text and lg.stock_after = 29 and lg.actor_kind = 'admin',
               'the ledger has the movement: -1, sellable, the original order, key exres:<line>, actor admin');
  -- a retry (the trigger fired again, a replayed request): nothing more is reserved
  perform public.app_exchange_reserve_item(it);
  perform public.app_exchange_reserve_item(it);
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 1 and t.moves(it, 'exchange_reserve') = 1 and (select count(*) from public.exchange_reservations where request_item_id = it) = 1,
               'a retry does not reserve twice: still 29, one ledger row, one reservation');
  perform t.ok(t.status(v) = 'approved', 'the request is approved');

  -- the customer cancels: the stock comes back, exactly once
  perform t.as_user(t.alice());
  perform t.ok((select count(*) from public.exchange_reservations) = 0, 'the customer cannot read the reservations (staff only)');
  j := public.cancel_return_request(v, 'changed my mind');
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_1') = w0, 'cancelling gives the stock back: White 29 -> 30');
  select * into x from public.exchange_reservations where request_item_id = it;
  perform t.ok(x.status = 'released' and x.released_at is not null and x.release_reason = 'The exchange was cancelled', 'the reservation is released, with the reason');
  perform t.ok(t.moves(it, 'exchange_release') = 1, 'one exchange_release movement in the ledger');
  perform public.app_exchange_release_item(it, 'again');
  perform public.app_exchange_release_item(it, 'again');
  perform t.ok(t.vstock('var_1700000000001_1') = w0 and t.moves(it, 'exchange_release') = 1, 'releasing again changes nothing (idempotent)');
  perform t.as_user(t.alice());
  j := public.cancel_return_request(v);
  perform t.as_postgres();
  perform t.ok((j ->> 'already')::boolean and t.vstock('var_1700000000001_1') = w0, 'cancelling twice is harmless');

  -- the reservation row is gone but the ledger is history (what a rollback + roll-forward leaves): a NEW reservation is a new movement with its own key
  delete from public.exchange_reservations where request_item_id = it;
  perform public.app_exchange_reserve_item(it);
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 1 and t.moves(it, 'exchange_reserve') = 2
               and exists (select 1 from public.inventory_logs where idempotency_key = 'exres:' || it::text || ':1'), 'reserved again after a release: a second movement with its own key (exres:<line>:1)');
  perform public.app_exchange_release_item(it, 'again');
  perform t.ok(t.vstock('var_1700000000001_1') = w0 and t.moves(it, 'exchange_release') = 2
               and exists (select 1 from public.inventory_logs where idempotency_key = 'exrel:' || it::text || ':1'), 'and released again: the stock really comes back (exrel:<line>:1)');
end $$;

-- 2. not enough stock / unavailable replacement: the approval is refused AS A WHOLE; a rejected line reserves nothing -------------------------------------------
do $$
declare
  v    uuid := gen_random_uuid();
  v2   uuid := gen_random_uuid();
  b    text := '77777777-0000-0000-0000-000000000002';
  c    text := '77777777-0000-0000-0000-000000000003';
  ib   uuid;
  ic   uuid;
  d    jsonb;
begin
  perform t.ok(t.vstock('var_1700000000003') = 0 and t.vstock('var_1700000000002') = 5, 'fixture: Hoodie Red / XL has no stock, Red / L has 5');
  perform t.order_with('x_o2', t.alice(), jsonb_build_array(
    t.line(b, 'prod_vmain_zero', 'var_1700000000002', 'Red / L', 1, 400), t.line(c, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'x_o2', 'exchange', jsonb_build_array(t.xi(b, 1, 'var_1700000000003'), t.xi(c, 1, 'var_1700000000001_1')), 'incorrect_size');
  perform t.as_postgres();
  select id into ib from public.return_request_items where request_id = v and order_item_id = b::uuid;
  select id into ic from public.return_request_items where request_id = v and order_item_id = c::uuid;
  -- the in-stock line first, the out-of-stock line second: the first reservation must be rolled back with the failure
  d := jsonb_build_array(jsonb_build_object('item_id', ic, 'decision', 'approve'), jsonb_build_object('item_id', ib, 'decision', 'approve'));
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.decide_request_items(%L, %L::jsonb)$q$, v, d::text), '22023', '%Not enough stock for the replacement "Hoodie [Red / XL]"%');
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_1') = 30 and t.vstock('var_1700000000003') = 0, 'nothing was reserved: the failure rolled the first line back too');
  perform t.ok(t.status(v) = 'pending_review' and not exists (select 1 from public.return_request_items where request_id = v and item_status <> 'pending')
               and not exists (select 1 from public.exchange_reservations where request_id = v), 'the request and both lines are untouched');
  perform t.ok(not exists (select 1 from public.inventory_logs where movement_type = 'exchange_reserve' and ref_id in (ib::text, ic::text)), 'and the ledger has no trace');

  -- reject the line that cannot be served, approve the other: only the approved line holds stock
  d := jsonb_build_array(jsonb_build_object('item_id', ic, 'decision', 'approve'), jsonb_build_object('item_id', ib, 'decision', 'reject', 'note', 'Red / XL is sold out'));
  perform t.as_user(t.admin());
  perform public.decide_request_items(v, d);
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_1') = 29 and t.vstock('var_1700000000003') = 0, 'only the approved line reserved stock (White 30 -> 29)');
  perform t.ok(exists (select 1 from public.exchange_reservations where request_item_id = ic) and not exists (select 1 from public.exchange_reservations where request_item_id = ib), 'the rejected line has no reservation');
  perform t.ok(t.status(v) = 'approved', 'the request is approved (one line)');
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'cancelled');
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_1') = 30, 'cancelling that exchange gave White back');

  -- the replacement was switched off after the customer asked for it
  perform t.order_with('x_o2b', t.alice(), jsonb_build_array(t.line('77777777-0000-0000-0000-000000000004', 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  perform t.as_user(t.alice());
  perform public.create_return_request(v2, 'x_o2b', 'exchange', jsonb_build_array(t.xi('77777777-0000-0000-0000-000000000004', 1, 'var_1700000000001_2')), 'incorrect_size');
  perform t.as_postgres();
  update public.product_variants set status = 'inactive' where id = 'var_1700000000001_2';
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.decide_request_items(%L, %L::jsonb)$q$, v2,
                  jsonb_build_array(jsonb_build_object('item_id', t.first_item(v2), 'decision', 'approve'))::text), '22023', '%no longer available%');
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_2') = 15 and not exists (select 1 from public.exchange_reservations where request_id = v2), 'an unavailable replacement reserves nothing');
  update public.product_variants set status = 'active' where id = 'var_1700000000001_2';
  perform t.as_user(t.admin());
  perform public.request_transition(v2, 'cancelled');
  perform t.as_postgres();
end $$;

-- 3. EQUAL price: no difference; the replacement is a separate shipment of the SAME order; the exchange closes by itself on delivery -----------------------------
do $$
declare
  v    uuid;
  d    text := '77777777-0000-0000-0000-000000000005';
  it   uuid;
  f    public.replacement_fulfillments;
  fi   public.replacement_fulfillment_items;
  j    jsonb;
  sh   public.shipments;
  p0   int;
  o_before jsonb;
  n_orders int;
begin
  perform t.order_with('x_o3', t.alice(), jsonb_build_array(t.line(d, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  select to_jsonb(o) into o_before from public.orders o where o.id = 'x_o3';
  select count(*) into n_orders from public.orders;
  p0 := t.vstock('var_1700000000001_0');
  v := t.exch(t.alice(), 'x_o3', jsonb_build_array(t.xi(d, 1)));                 -- the same option again (a defective unit)
  it := t.first_item(v);
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 1, 'the same option again: its stock is reserved once (Pink -1)');
  perform t.eq(t.status(v), 'inspection_passed', 'the exchange passed inspection');
  perform t.ok(not exists (select 1 from public.replacement_fulfillments where request_id = v), 'no replacement record yet');

  perform t.as_user(t.admin());
  perform public.request_transition(v, 'replacement_pending', null, 'We are packing your new shirt');
  perform t.as_postgres();
  select * into f from public.replacement_fulfillments where request_id = v;
  perform t.ok(f.id is not null and f.status = 'pending' and f.order_id = 'x_o3' and f.shipment_id is null, 'ONE replacement record, pending, linked to the original order');
  select * into fi from public.replacement_fulfillment_items where fulfillment_id = f.id;
  perform t.ok(fi.request_item_id = it and fi.order_item_id = d::uuid and fi.quantity = 1 and fi.title = 'Designer Shirt' and fi.variant_name = 'Pink' and fi.sku = 'DESIGNER-SHIRT-PINK',
               'its line names the replacement (title, variant, sku) and the ORIGINAL order line it replaces');
  perform t.ok(fi.original_unit_price = 300 and fi.replacement_unit_price = 300 and fi.price_difference = 0, 'prices: 300 -> 300, difference 0');
  perform t.eq(t.adj(v), 'none:0.00:not_needed', 'equal price: nothing to settle');
  perform t.ok(t.notified(t.alice(), 'Your replacement is being prepared') = 1 and t.notified(t.alice(), 'Price difference on your exchange') = 0, 'the customer was told once; no price-difference notice');
  -- the transition is not repeated into a second record
  perform public.app_exchange_open_fulfilment(v);
  perform t.ok((select count(*) from public.replacement_fulfillments where request_id = v) = 1 and (select count(*) from public.replacement_fulfillment_items where fulfillment_id = f.id) = 1, 'opening it again does not duplicate it');

  -- shipping: who may, what is validated
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.ship_replacement(%L)$q$, v), '42501', 'Admin access required');
  perform t.as_anon();
  perform t.fails(format($q$select public.ship_replacement(%L)$q$, v), '42501');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.ship_replacement(%L, 'nope')$q$, v), '22023', '%Unknown courier%');
  perform t.fails(format($q$select public.ship_replacement(%L, 'manual', null, 'T1', 'ftp://x')$q$, v), '22023', '%tracking link%');
  perform t.fails(format($q$select public.ship_replacement(%L, 'manual', null, 'T1', null, now() + interval '3 days')$q$, v), '22023', '%cannot be in the future%');
  perform t.fails(format($q$select public.ship_replacement(%L, 'manual', null, 'T1', null, null, -5)$q$, v), '22023', '%cannot be negative%');
  perform t.fails($q$select public.ship_replacement(gen_random_uuid())$q$, 'P0002');
  perform t.ok(t.status(v) = 'replacement_pending' and not exists (select 1 from public.shipments where request_id = v), 'refused calls changed nothing');

  j := public.ship_replacement(v, 'manual', 'Local courier', 'TRK123', null, null, 40, 'boxed');
  perform t.as_postgres();
  perform t.ok((j ->> 'created')::boolean and j ->> 'status' = 'replacement_shipped', 'shipped: the exchange is replacement_shipped');
  select * into sh from public.shipments where id = (j ->> 'shipment_id')::uuid;
  perform t.ok(sh.direction = 'replacement' and sh.request_id = v and sh.order_id = 'x_o3' and sh.courier_name = 'Local courier' and sh.tracking_number = 'TRK123' and sh.status = 'created',
               'the replacement is its own shipment (direction replacement) tied to the request and the ORIGINAL order, with the courier and tracking number');
  perform t.ok((select count(*) from public.shipment_items where shipment_id = sh.id and order_item_id = d::uuid and quantity = 1) = 1, 'it carries the original line and quantity');
  perform t.ok((select charges from public.shipment_private where shipment_id = sh.id) = 40, 'the shipping charges are recorded (staff only)');
  perform t.ok((select count(*) from public.shipment_events where shipment_id = sh.id and event_type = 'created') = 1, 'a "created" event starts its timeline');
  perform t.ok((select status from public.replacement_fulfillments where request_id = v) = 'shipped' and (select shipment_id from public.replacement_fulfillments where request_id = v) = sh.id
               and (select status from public.exchange_reservations where request_item_id = it) = 'fulfilled', 'the record is shipped and linked; the reservation is fulfilled');
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 1, 'shipping moved no stock (it was reserved already)');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.alice() and title = 'Your replacement is on its way' and body like '%TRK123%'), 'the customer was told, with the tracking number');
  -- retries
  perform t.as_user(t.admin());
  j := public.ship_replacement(v, 'manual', 'Local courier', 'TRK123');
  perform t.ok(not (j ->> 'created')::boolean and (j ->> 'shipment_id')::uuid = sh.id, 'the same courier + tracking number again returns the same shipment');
  perform t.fails(format($q$select public.ship_replacement(%L, 'manual', null, 'OTHER')$q$, v), '22023', '%already shipped%');
  perform t.as_postgres();
  perform t.ok((select count(*) from public.shipments where request_id = v) = 1, 'still ONE replacement shipment');
  -- the customer and only the customer sees it
  perform t.as_user(t.alice());
  perform t.ok((select count(*) from public.shipments where request_id = v) = 1 and (select count(*) from public.replacement_fulfillments where request_id = v) = 1
               and (select count(*) from public.replacement_fulfillment_items) = 1 and (select count(*) from public.exchange_adjustments where request_id = v) = 1, 'the customer reads the shipment, the record, its lines and the adjustment');
  perform t.as_user(t.bob());
  perform t.ok((select count(*) from public.shipments where request_id = v) = 0 and (select count(*) from public.replacement_fulfillments) = 0
               and (select count(*) from public.replacement_fulfillment_items) = 0 and (select count(*) from public.exchange_adjustments) = 0, 'another customer sees none of it');
  perform t.as_postgres();
  perform t.ok((select count(*) from public.order_items where order_id = 'x_o3') = 1 and public.app_order_item_remaining(d::uuid) = 1, 'the original outbound arithmetic is untouched (the replacement is not an outbound shipment)');

  -- delivery
  perform t.as_user(t.admin());
  j := public.mark_replacement_delivered(v);
  perform t.as_postgres();
  perform t.ok(not (j ->> 'already')::boolean, 'delivery recorded');
  perform t.eq(t.status(v), 'closed', 'nothing is left to settle, so the exchange CLOSED by itself');
  perform t.ok((select status from public.shipments where id = sh.id) = 'delivered' and (select status from public.replacement_fulfillments where request_id = v) = 'delivered'
               and (select item_status from public.return_request_items where id = it) = 'resolved', 'the shipment and the record are delivered; the line is resolved');
  perform t.ok(t.notified(t.alice(), 'Your replacement was delivered') = 1, 'the customer was told once');
  perform t.as_user(t.admin());
  perform t.ok((public.mark_replacement_delivered(v) ->> 'already')::boolean, 'marking it again is harmless');
  perform t.as_postgres();
  -- the ORIGINAL order is exactly as it was; no order was created
  perform t.ok((select to_jsonb(o) from public.orders o where o.id = 'x_o3') = o_before, 'the original order row is unchanged');
  perform t.ok((select count(*) from public.orders) = n_orders, 'no new order was created for the exchange');
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 1 and t.moves(it, 'exchange_reserve') = 1 and t.moves(it, 'exchange_release') = 0, 'stock: one reservation, no release; the replacement left the shop');
end $$;

-- 4. HIGHER price: the difference is recorded and must be collected (or waived) before the replacement ships ---------------------------------------------------
do $$
declare
  v   uuid;
  e   text := '77777777-0000-0000-0000-000000000006';
  j   jsonb;
begin
  perform t.order_with('x_o4', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v := t.exch_pending(t.alice(), 'x_o4', jsonb_build_array(t.xi(e, 1, 'var_1700000000001_2')));        -- Pink 300 -> Violet 350
  perform t.eq(t.adj(v), 'balance_due:50.00:open', 'the replacement is dearer: 50 is due, and it is OPEN (nobody was charged)');
  perform t.ok((select price_difference from public.replacement_fulfillment_items where fulfillment_id = (select id from public.replacement_fulfillments where request_id = v)) = 50, 'the line records +50');
  perform t.ok(t.notified(t.alice(), 'Price difference on your exchange') = 1, 'the customer was told about the difference');
  perform t.ok(not exists (select 1 from public.refunds where request_id = v), 'nothing was refunded');

  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.ship_replacement(%L)$q$, v), '22023', '%price difference of ₹50.00%');
  perform t.fails(format($q$select public.request_transition(%L, 'replacement_shipped')$q$, v), '22023');
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'collected')$q$, v), '22023', '%payment reference%');
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'waived')$q$, v), '22023', '%why the price difference is waived%');
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'paid', 'x')$q$, v), '22023', '%collected or waived%');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'collected', 'cash')$q$, v), '42501');
  perform t.as_user(t.admin());
  perform t.ok(t.status(v) = 'replacement_pending' and t.adj(v) = 'balance_due:50.00:open', 'refused calls changed nothing');

  j := public.settle_exchange_adjustment(v, 'collected', 'UPI 4488 on 17 Oct', 'paid at the counter');
  perform t.ok(j ->> 'status' = 'collected' and not (j ->> 'already')::boolean, 'collected, with the payment reference');
  perform t.as_postgres();
  perform t.eq(t.adj(v), 'balance_due:50.00:collected', 'the adjustment is collected');
  perform t.ok((select reference from public.exchange_adjustment_private where request_id = v) = 'UPI 4488 on 17 Oct', 'the reference is kept (staff only)');
  perform t.ok(exists (select 1 from public.return_request_events where request_id = v and note like '%price difference of ₹50.00 was received%' and not internal), 'the timeline says it was received');
  perform t.as_user(t.alice());
  perform t.ok((select count(*) from public.exchange_adjustment_private) = 0, 'the customer cannot read the reference');
  perform t.as_user(t.admin());
  perform t.ok((public.settle_exchange_adjustment(v, 'collected', 'again') ->> 'already')::boolean, 'collecting twice is harmless');
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'waived', null, 'no')$q$, v), '22023', '%already collected%');
  perform t.ok(t.status(v) = 'replacement_pending', 'collecting does not move the exchange');
  perform public.ship_replacement(v, 'manual', null, 'TRK-HIGH');
  perform public.mark_replacement_delivered(v);
  perform t.as_postgres();
  perform t.eq(t.status(v), 'closed', 'shipped, delivered, settled: closed');
end $$;

-- 5. LOWER price: a refund is due; the replacement may ship; the exchange stays open until the difference is refunded (or waived) -----------------------------
do $$
declare
  v   uuid;
  f   uuid;
  f2  uuid;
  e   text := '77777777-0000-0000-0000-000000000007';
  j   jsonb;
  rf  public.refunds;
begin
  perform t.order_with('x_o5', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v := t.exch_pending(t.alice(), 'x_o5', jsonb_build_array(t.xi(e, 1, 'var_1700000000001_1')));        -- Pink 300 -> White 200
  perform t.eq(t.adj(v), 'refund_due:100.00:open', 'the replacement is cheaper: 100 is due back, OPEN (nobody was refunded silently)');
  perform t.ok(t.notified(t.alice(), 'Your exchange costs less') = 1 and not exists (select 1 from public.refunds where request_id = v), 'the customer was told; no refund exists yet');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'collected', 'x')$q$, v), '22023', '%owes can be collected%');
  perform public.ship_replacement(v, 'manual', null, 'TRK-LOW');            -- a refund due does not hold the shipment back
  perform public.mark_replacement_delivered(v);
  perform t.as_postgres();
  perform t.eq(t.status(v), 'replacement_delivered', 'delivered but NOT closed: the refund of the difference is still open');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.request_transition(%L, 'closed')$q$, v), '22023', '%Settle the price difference%');
  perform t.as_postgres();
  perform t.eq(t.status(v), 'replacement_delivered', 'an admin cannot close it by hand while the difference is open');

  -- refund the difference
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_exchange_refund(%L, 'key-exch-0001', 'manual')$q$, v), '42501');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_exchange_refund(%L, 'short', 'manual')$q$, v), '22023', '%idempotency key%');
  perform t.fails(format($q$select public.create_exchange_refund(%L, 'key-exch-0001', 'cheque')$q$, v), '22023', '%razorpay or manual%');
  j := public.create_exchange_refund(v, 'key-exch-0001', 'razorpay', 'refund the difference');
  f := (j ->> 'refund_id')::uuid;
  perform t.as_postgres();
  select * into rf from public.refunds where id = f;
  perform t.ok(rf.kind = 'exchange_difference' and rf.amount = 100 and rf.items_amount = 100 and rf.request_id = v and rf.order_id = 'x_o5' and rf.status = 'pending' and rf.method = 'razorpay' and rf.gateway_state = 'not_sent',
               'a refund of kind exchange_difference for 100, pending, not yet sent to the gateway');
  perform t.ok((select refund_id from public.exchange_adjustments where request_id = v) = f and t.adj(v) = 'refund_due:100.00:open', 'the adjustment points at it and stays open until it is paid');
  perform t.as_user(t.admin());
  j := public.create_exchange_refund(v, 'key-exch-0001', 'razorpay');
  perform t.ok(not (j ->> 'created')::boolean and (j ->> 'refund_id')::uuid = f, 'the same key returns the same refund');
  perform t.fails(format($q$select public.create_exchange_refund(%L, 'key-exch-0002', 'manual')$q$, v), '22023', '%already in progress%');
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'waived', null, 'no thanks')$q$, v), '22023', '%already in progress%');
  -- it did not work out: cancel it (never sent), try again by hand
  perform public.refund_void(f, 'wrong method');
  perform t.as_postgres();
  perform t.ok(t.rstatus(f) = 'failed' and t.adj(v) = 'refund_due:100.00:open', 'a voided refund leaves the difference open');
  perform t.as_user(t.admin());
  j := public.create_exchange_refund(v, 'key-exch-0002', 'manual');
  f2 := (j ->> 'refund_id')::uuid;
  perform t.ok(f2 <> f and (j ->> 'created')::boolean, 'a new refund for the same difference');
  j := public.refund_mark_manual(f2, 'succeeded', 'UPI-REF-77');
  perform t.as_postgres();
  perform t.ok(t.rstatus(f2) = 'succeeded', 'the refund is paid');
  perform t.eq(t.adj(v), 'refund_due:100.00:refunded', 'the adjustment is refunded');
  perform t.eq(t.status(v), 'closed', 'and the exchange CLOSED by itself');
  perform t.ok(t.notified(t.alice(), 'Your refund is complete') = 1, 'the customer was told the refund is complete (an exchange has no "refund pending" step to tell them)');
  perform t.ok(exists (select 1 from public.return_request_events where request_id = v and note like '%price difference of ₹100.00 was refunded%'), 'the timeline says so');
  perform t.as_user(t.alice());
  perform t.ok((select count(*) from public.refunds where request_id = v and kind = 'exchange_difference') = 2, 'the customer sees both refunds (failed + paid)');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'waived', null, 'late')$q$, v), '22023', '%already refunded%');
  perform t.as_postgres();
end $$;

-- 5b. refunds need a PAID order and the right payment method -------------------------------------------------------------------------------------------------
do $$
declare
  v   uuid;
  e   text := '77777777-0000-0000-0000-000000000008';
begin
  perform t.order_with('x_o5b', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)), 'pending', 'COD');
  v := t.exch_pending(t.alice(), 'x_o5b', jsonb_build_array(t.xi(e, 1, 'var_1700000000001_1')));
  perform t.eq(t.adj(v), 'refund_due:100.00:open', 'an unpaid COD order: the difference is still recorded');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_exchange_refund(%L, 'key-exch-cod-1', 'manual')$q$, v), '22023', '%not marked as paid%');
  perform t.as_postgres();
  update public.orders set payment_status = 'paid', payment_method = 'Cash' where id = 'x_o5b';
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_exchange_refund(%L, 'key-exch-cod-2', 'razorpay')$q$, v), '22023', '%not paid through Razorpay%');
  perform public.settle_exchange_adjustment(v, 'waived', null, 'nothing was paid online');
  perform t.as_postgres();
  perform t.eq(t.adj(v), 'refund_due:100.00:waived', 'an admin can waive a refund-due difference (with a reason)');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_exchange_refund(%L, 'key-exch-cod-3', 'manual')$q$, v), '22023', '%already waived%');
  perform public.ship_replacement(v, 'manual', null, 'TRK-COD');
  perform public.mark_replacement_delivered(v);
  perform t.as_postgres();
  perform t.eq(t.status(v), 'closed', 'waived, shipped, delivered: closed');
end $$;

-- 6. several lines: the adjustment is the NET of the lines; quantities multiply ---------------------------------------------------------------------------------
do $$
declare
  v   uuid;
  g   text := '77777777-0000-0000-0000-000000000009';
  h   text := '77777777-0000-0000-0000-00000000000a';
  w0  int := t.vstock('var_1700000000001_1');
  s0  int := t.pstock('prod_single_a');
  f   uuid;
begin
  perform t.order_with('x_o6', t.alice(), jsonb_build_array(
    t.line(g, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 2, 300), jsonb_build_object('id', h, 'product', 'prod_single_a', 'variant', '', 'title', 'Classic Cotton Shirt', 'qty', 1, 'price', 500)));
  v := t.exch_pending(t.alice(), 'x_o6', jsonb_build_array(t.xi(g, 2, 'var_1700000000001_1'), t.xi(h, 1)));
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 2 and t.pstock('prod_single_a') = s0 - 1, 'both replacements are reserved: White -2 (two units), the shirt -1');
  select id into f from public.replacement_fulfillments where request_id = v;
  perform t.ok((select count(*) from public.replacement_fulfillment_items where fulfillment_id = f) = 2, 'two lines on the replacement record');
  perform t.ok((select price_difference from public.replacement_fulfillment_items where request_item_id = (select id from public.return_request_items where request_id = v and order_item_id = g::uuid)) = -200
               and (select price_difference from public.replacement_fulfillment_items where request_item_id = (select id from public.return_request_items where request_id = v and order_item_id = h::uuid)) = 0,
               'line differences: (200 - 300) x 2 = -200 and 0 for the same shirt again');
  perform t.eq(t.adj(v), 'refund_due:200.00:open', 'the adjustment is the net: 200 back to the customer');
  perform t.as_user(t.admin());
  perform public.ship_replacement(v, 'manual', null, 'TRK-NET');
  perform t.as_postgres();
  perform t.ok((select count(*) from public.shipment_items where shipment_id = (select shipment_id from public.replacement_fulfillments where id = f)) = 2, 'one parcel carries both lines');
  perform t.ok((select count(*) from public.exchange_reservations where request_id = v and status = 'fulfilled') = 2, 'both reservations are fulfilled');
end $$;

-- 7. a replacement shipment cancelled before delivery: back to "pending", the stock is NOT deducted twice, ship again -------------------------------------------
do $$
declare
  v   uuid;
  it  uuid;
  e   text := '77777777-0000-0000-0000-00000000000b';
  j   jsonb;
  sh  uuid;
  p0  int := t.vstock('var_1700000000001_0');
begin
  perform t.order_with('x_o7', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v := t.exch_pending(t.alice(), 'x_o7', jsonb_build_array(t.xi(e, 1)));
  it := t.first_item(v);
  perform t.as_user(t.admin());
  j := public.ship_replacement(v, 'manual', null, 'TRK-WRONG');
  sh := (j ->> 'shipment_id')::uuid;
  perform t.as_postgres();
  perform t.eq(t.status(v), 'replacement_shipped', 'shipped');
  perform t.as_user(t.admin());
  perform public.cancel_shipment(sh, 'entered by mistake');
  perform t.as_postgres();
  perform t.eq(t.status(v), 'replacement_pending', 'the shipment was cancelled: the exchange is back to "replacement pending"');
  perform t.ok((select status from public.replacement_fulfillments where request_id = v) = 'pending' and (select shipment_id from public.replacement_fulfillments where request_id = v) is null
               and (select status from public.exchange_reservations where request_item_id = it) = 'reserved', 'the record is pending again with no shipment; the reservation is held again');
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 1 and t.moves(it, 'exchange_reserve') = 1 and t.moves(it, 'exchange_release') = 0, 'no stock moved (no second deduction, no release)');
  perform t.ok((select count(*) from public.replacement_fulfillments where request_id = v) = 1, 'still ONE record');
  perform t.as_user(t.admin());
  j := public.ship_replacement(v, 'manual', null, 'TRK-RIGHT');
  perform t.as_postgres();
  perform t.ok((j ->> 'created')::boolean and (j ->> 'shipment_id')::uuid <> sh, 'shipped again, as a new shipment');
  perform t.ok(t.vstock('var_1700000000001_0') = p0 - 1 and t.moves(it, 'exchange_reserve') = 1, 'still one reservation, one deduction');
  -- courier events deliver it (no admin button): the same trigger moves the exchange
  perform t.as_user(t.admin());
  perform public.add_shipment_event((j ->> 'shipment_id')::uuid, 'delivered');
  perform t.as_postgres();
  perform t.eq(t.status(v), 'closed', 'a courier "delivered" event closes the exchange (nothing to settle)');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.cancel_shipment(%L)$q$, (j ->> 'shipment_id')::uuid), '22023', '%delivered shipment cannot be cancelled%');
  perform t.as_postgres();
end $$;

-- 8. the exchange is cancelled AFTER the returned item was accepted: the stock is released, the staff is told to settle the money ------------------------------
do $$
declare
  v   uuid;
  it  uuid;
  e   text := '77777777-0000-0000-0000-00000000000c';
  v0  int := t.vstock('var_1700000000001_2');
begin
  perform t.order_with('x_o8', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v := t.exch_pending(t.alice(), 'x_o8', jsonb_build_array(t.xi(e, 1, 'var_1700000000001_2')));         -- +50 open
  it := t.first_item(v);
  perform t.ok(t.vstock('var_1700000000001_2') = v0 - 1 and t.adj(v) = 'balance_due:50.00:open', 'reserved, with a price difference open');
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'cancelled', 'cannot ship this', 'Sorry, we cannot send the replacement');
  perform t.as_postgres();
  perform t.eq(t.status(v), 'cancelled', 'cancelled');
  perform t.ok(t.vstock('var_1700000000001_2') = v0 and t.moves(it, 'exchange_release') = 1, 'the replacement stock was given back (Violet back to its level)');
  perform t.ok((select status from public.replacement_fulfillments where request_id = v) = 'cancelled' and (select status from public.exchange_reservations where request_item_id = it) = 'released', 'record cancelled, reservation released');
  perform t.eq(t.adj(v), 'balance_due:50.00:waived', 'the open price difference no longer applies');
  perform t.ok((select item_status from public.return_request_items where id = it) = 'resolved', 'the accepted line is resolved (it no longer blocks anything)');
  perform t.ok(exists (select 1 from public.return_request_events where request_id = v and internal and note like '%Settle it%'), 'a staff-only note says the money must be settled by hand');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.admin() and title = 'Exchange cancelled after inspection'), 'the admins were told');
  perform t.as_user(t.alice());
  perform t.ok(not exists (select 1 from public.return_request_events where request_id = v and internal), 'the customer cannot read that note');
  perform t.as_postgres();
end $$;

-- 9. a returned item that FAILS the inspection gives its replacement stock back; the others go on ----------------------------------------------------------------
do $$
declare
  v   uuid;
  v2  uuid;
  k   text := '77777777-0000-0000-0000-00000000000d';
  l   text := '77777777-0000-0000-0000-00000000000e';
  m   text := '77777777-0000-0000-0000-00000000000f';
  ik  uuid;
  il  uuid;
  w0  int := t.vstock('var_1700000000001_1');
  s0  int := t.pstock('prod_single_a');
begin
  perform t.order_with('x_o9', t.alice(), jsonb_build_array(
    t.line(k, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300), jsonb_build_object('id', l, 'product', 'prod_single_a', 'variant', '', 'title', 'Classic Cotton Shirt', 'qty', 1, 'price', 500)));
  v := t.exch_received(t.alice(), 'x_o9', jsonb_build_array(t.xi(k, 1, 'var_1700000000001_1'), t.xi(l, 1)));
  select id into ik from public.return_request_items where request_id = v and order_item_id = k::uuid;
  select id into il from public.return_request_items where request_id = v and order_item_id = l::uuid;
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 1 and t.pstock('prod_single_a') = s0 - 1, 'both replacements are held while the parcel is inspected');
  perform t.as_user(t.admin());
  perform public.record_inspection(v, jsonb_build_array(jsonb_build_object('item_id', ik, 'result', 'passed'), jsonb_build_object('item_id', il, 'result', 'failed', 'note', 'The shirt was washed')));
  perform t.as_postgres();
  perform t.eq(t.status(v), 'inspection_passed', 'one line passed: the exchange goes on');
  perform t.ok(t.pstock('prod_single_a') = s0 and t.moves(il, 'exchange_release') = 1, 'the failed line gave its replacement back (the shirt)');
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 1 and (select status from public.exchange_reservations where request_item_id = ik) = 'reserved', 'the passed line still holds White');
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'replacement_pending');
  perform t.as_postgres();
  perform t.ok((select count(*) from public.replacement_fulfillment_items where fulfillment_id = (select id from public.replacement_fulfillments where request_id = v)) = 1
               and (select request_item_id from public.replacement_fulfillment_items where fulfillment_id = (select id from public.replacement_fulfillments where request_id = v)) = ik, 'only the line that passed is sent');
  perform t.eq(t.adj(v), 'refund_due:100.00:open', 'and only that line counts for the difference (Pink 300 -> White 200)');

  -- every line fails: the exchange is over, nothing is held
  perform t.order_with('x_o9b', t.alice(), jsonb_build_array(t.line(m, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v2 := t.exch_received(t.alice(), 'x_o9b', jsonb_build_array(t.xi(m, 1, 'var_1700000000001_1')));
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 2, 'fixture: White held for the second exchange');
  perform t.as_user(t.admin());
  perform public.record_inspection(v2, jsonb_build_array(jsonb_build_object('item_id', t.first_item(v2), 'result', 'failed', 'note', 'Not the item we sold')));
  perform t.as_postgres();
  perform t.eq(t.status(v2), 'inspection_failed', 'no line passed');
  perform t.ok(t.vstock('var_1700000000001_1') = w0 - 1 and not exists (select 1 from public.replacement_fulfillments where request_id = v2), 'its stock is back and no replacement record exists');
  perform t.as_user(t.admin());
  perform public.request_transition(v2, 'closed');
  perform t.as_postgres();
  perform t.eq(t.status(v2), 'closed', 'it can be closed');
end $$;

-- 10. an option that does not track inventory: nothing is deducted, nothing is given back -------------------------------------------------------------------------
do $$
declare
  v   uuid := gen_random_uuid();
  it  uuid;
  e   text := '77777777-0000-0000-0000-000000000010';
  s0  int;
begin
  update public.product_variants set track_inventory = false where id = 'var_1700000000001_2';
  s0 := t.vstock('var_1700000000001_2');
  perform t.order_with('x_o10', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'x_o10', 'exchange', jsonb_build_array(t.xi(e, 1, 'var_1700000000001_2')), 'incorrect_size');
  perform t.as_user(t.admin());
  perform public.decide_request_items(v, jsonb_build_array(jsonb_build_object('item_id', t.first_item(v), 'decision', 'approve')));
  perform t.as_postgres();
  it := t.first_item(v);
  perform t.ok((select stock_moved from public.exchange_reservations where request_item_id = it) = false and t.vstock('var_1700000000001_2') = s0 and t.moves(it, 'exchange_reserve') = 0,
               'untracked: a reservation row exists, but no stock moved and no ledger row');
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'cancelled');
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_2') = s0 and t.moves(it, 'exchange_release') = 0 and (select status from public.exchange_reservations where request_item_id = it) = 'released', 'releasing it moves nothing either');
  update public.product_variants set track_inventory = true where id = 'var_1700000000001_2';
end $$;

-- 11. a RETURN never reserves anything; another product is not an exchange ------------------------------------------------------------------------------------
do $$
declare
  v   uuid := gen_random_uuid();
  v2  uuid := gen_random_uuid();
  e   text := '77777777-0000-0000-0000-000000000011';
  p0  int := t.vstock('var_1700000000001_0');
begin
  perform t.order_with('x_o11', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'x_o11', 'return', jsonb_build_array(t.xi(e, 1)), 'incorrect_size');
  perform t.as_user(t.admin());
  perform public.decide_request_items(v, jsonb_build_array(jsonb_build_object('item_id', t.first_item(v), 'decision', 'approve')));
  perform t.as_postgres();
  perform t.ok(t.vstock('var_1700000000001_0') = p0 and not exists (select 1 from public.exchange_reservations where request_id = v) and t.moves(t.first_item(v), 'exchange_reserve') = 0,
               'approving a RETURN reserves nothing and does not touch stock');
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'cancelled');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_return_request(%L, 'x_o11', 'exchange', %L::jsonb, 'incorrect_size')$q$, v2,
                  jsonb_build_array(jsonb_build_object('order_item_id', e, 'quantity', 1, 'replacement_product_id', 'prod_single_a'))::text), '22023', '%same product%');
  perform t.as_postgres();
end $$;

-- 12. privacy and grants ------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v   uuid;
  e   text := '77777777-0000-0000-0000-000000000012';
begin
  perform t.order_with('x_o12', t.bob(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v := t.exch_pending(t.bob(), 'x_o12', jsonb_build_array(t.xi(e, 1, 'var_1700000000001_1')));
  -- nobody writes the new tables through the API
  perform t.as_user(t.bob());
  perform t.fails($q$insert into public.exchange_reservations (request_item_id, request_id, product_id, quantity, unit_price) values (gen_random_uuid(), gen_random_uuid(), 'x', 1, 1)$q$, '42501');
  perform t.fails(format($q$update public.replacement_fulfillments set status = 'delivered' where request_id = %L$q$, v), '42501');
  perform t.fails(format($q$update public.exchange_adjustments set status = 'waived' where request_id = %L$q$, v), '42501');
  perform t.fails(format($q$delete from public.replacement_fulfillment_items where fulfillment_id is not null$q$), '42501');
  perform t.ok((select count(*) from public.exchange_reservations) = 0 and (select count(*) from public.exchange_adjustment_private) = 0, 'the owner cannot read the staff-only tables');
  perform t.ok((select count(*) from public.replacement_fulfillments where request_id = v) = 1 and (select count(*) from public.exchange_adjustments where request_id = v) = 1, 'but reads their own record and difference');
  perform t.fails(format($q$select public.ship_replacement(%L)$q$, v), '42501', 'Admin access required');
  perform t.fails(format($q$select public.mark_replacement_delivered(%L)$q$, v), '42501', 'Admin access required');
  perform t.fails(format($q$select public.create_exchange_refund(%L, 'key-priv-0001', 'manual')$q$, v), '42501', 'Admin access required');
  perform t.fails(format($q$select public.app_exchange_reserve_item(%L)$q$, t.first_item(v)), '42501');
  perform t.fails(format($q$select public.app_exchange_open_fulfilment(%L)$q$, v), '42501');
  perform t.as_user(t.alice());
  perform t.ok((select count(*) from public.replacement_fulfillments where request_id = v) = 0 and (select count(*) from public.exchange_adjustments where request_id = v) = 0
               and (select count(*) from public.replacement_fulfillment_items where fulfillment_id in (select id from public.replacement_fulfillments where request_id = v)) = 0, 'another customer sees nothing of it');
  perform t.as_anon();
  perform t.fails($q$select * from public.replacement_fulfillments$q$, '42501');
  perform t.fails($q$select * from public.exchange_adjustments$q$, '42501');
  perform t.fails($q$select * from public.exchange_reservations$q$, '42501');
  perform t.fails(format($q$select public.settle_exchange_adjustment(%L, 'waived', null, 'x')$q$, v), '42501');
  perform t.as_service();
  perform t.fails(format($q$select public.app_exchange_release_item(%L)$q$, t.first_item(v)), '42501');
  perform t.as_postgres();
end $$;

-- 13. an older line without a reservation (approved before this migration): reserved, or refused with a clear message, when the replacement starts -------------
do $$
declare
  v   uuid;
  v2  uuid;
  e   text := '77777777-0000-0000-0000-000000000013';
  e2  text := '77777777-0000-0000-0000-000000000014';
  it  uuid;
  w0  int;
begin
  perform t.order_with('x_o13', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v := t.exch(t.alice(), 'x_o13', jsonb_build_array(t.xi(e, 1, 'var_1700000000001_1')));
  it := t.first_item(v);
  -- imitate a record created before the reservations existed
  delete from public.exchange_reservations where request_item_id = it;
  update public.product_variants set stock = stock + 1 where id = 'var_1700000000001_1';
  delete from public.inventory_logs where ref_id = it::text;
  w0 := t.vstock('var_1700000000001_1');
  perform t.as_user(t.admin());
  perform public.request_transition(v, 'replacement_pending');
  perform t.as_postgres();
  perform t.ok(t.status(v) = 'replacement_pending' and (select status from public.exchange_reservations where request_item_id = it) = 'reserved' and t.vstock('var_1700000000001_1') = w0 - 1,
               'the stock was reserved at that moment');

  perform t.order_with('x_o13b', t.alice(), jsonb_build_array(t.line(e2, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v2 := t.exch(t.alice(), 'x_o13b', jsonb_build_array(t.xi(e2, 1, 'var_1700000000001_1')));
  delete from public.exchange_reservations where request_item_id = t.first_item(v2);
  delete from public.inventory_logs where ref_id = t.first_item(v2)::text;
  update public.product_variants set stock = 0 where id = 'var_1700000000001_1';
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.request_transition(%L, 'replacement_pending')$q$, v2), '22023', '%Not enough stock for the replacement%');
  perform t.as_postgres();
  perform t.ok(t.status(v2) = 'inspection_passed' and not exists (select 1 from public.replacement_fulfillments where request_id = v2), 'out of stock: the move is refused and nothing was created');
end $$;

-- 13b. the reservation row is lost but the ledger still shows the stock as held: the row is rebuilt WITHOUT deducting a second time ---------------------------------
do $$
declare
  v   uuid;
  e   text := '77777777-0000-0000-0000-000000000015';
  it  uuid;
  w0  int;
begin
  perform t.order_with('x_o15', t.alice(), jsonb_build_array(t.line(e, 'prod_vmain_ok', 'var_1700000000001_0', 'Pink', 1, 300)));
  v := t.exch_received(t.alice(), 'x_o15', jsonb_build_array(t.xi(e, 1, 'var_1700000000001_2')));
  it := t.first_item(v);
  w0 := t.vstock('var_1700000000001_2');
  delete from public.exchange_reservations where request_item_id = it;
  perform public.app_exchange_reserve_item(it);
  perform t.ok(t.vstock('var_1700000000001_2') = w0 and t.moves(it, 'exchange_reserve') = 1 and (select status from public.exchange_reservations where request_item_id = it) = 'reserved' and (select stock_moved from public.exchange_reservations where request_item_id = it),
               'a lost reservation row is rebuilt without taking the stock a second time');
  perform public.app_exchange_release_item(it, 'cleanup');
  perform t.ok(t.vstock('var_1700000000001_2') = w0 + 1, 'and releasing it gives the stock back once');
end $$;

-- 14. the new functions and tables are what they should be ---------------------------------------------------------------------------------------------------------
do $$
begin
  perform t.ok(to_regclass('public.exchange_reservations') is not null and to_regclass('public.replacement_fulfillments') is not null and to_regclass('public.replacement_fulfillment_items') is not null
               and to_regclass('public.exchange_adjustments') is not null and to_regclass('public.exchange_adjustment_private') is not null, 'the five tables exist');
  perform t.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in
                ('exchange_reservations', 'replacement_fulfillments', 'replacement_fulfillment_items', 'exchange_adjustments', 'exchange_adjustment_private') and c.relrowsecurity) = 5, 'row level security is ON for all five');
  perform t.ok(exists (select 1 from public.request_status_transitions where request_type = 'exchange' and from_status = 'replacement_shipped' and to_status = 'replacement_pending' and actor = 'system'), 'the cancelled-shipment transition exists');
  perform t.ok(not has_function_privilege('anon', 'public.ship_replacement(uuid,text,text,text,text,timestamptz,numeric,text,date)', 'execute'), 'anon cannot execute ship_replacement');
  perform t.ok(has_function_privilege('authenticated', 'public.ship_replacement(uuid,text,text,text,text,timestamptz,numeric,text,date)', 'execute'), 'authenticated can (the admin check is inside)');
  perform t.ok(not has_function_privilege('authenticated', 'public.app_exchange_reserve_item(uuid)', 'execute') and not has_function_privilege('service_role', 'public.app_exchange_open_fulfilment(uuid,boolean)', 'execute'), 'the internal helpers are not callable through the API');
end $$;

rollback;