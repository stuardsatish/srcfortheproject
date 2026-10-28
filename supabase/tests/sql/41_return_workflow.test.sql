-- needs: m4b
-- reapply: 20261017_05_return_workflow.sql
-- Phases 7 + 8 — M4b: the admin decision workflow, the return / exchange state machines, return logistics, received + inspection.
-- ("reapply" = the runner applies the migration a SECOND time before this script: the idempotency test.)
begin;

-- helper: a customer submits a request (returns its id; leaves the session acting as that customer)
create or replace function t.mk(p_uid uuid, p_order text, p_type text, p_items jsonb, p_reason text default 'incorrect_size', p_desc text default null) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  perform t.as_user(p_uid);
  perform public.create_return_request(v, p_order, p_type, p_items, p_reason, p_desc);
  return v;
end $$;
create or replace function t.it(p_order_item text, p_qty int) returns jsonb language sql as $$
  select jsonb_build_object('order_item_id', p_order_item, 'quantity', p_qty)
$$;
-- the eligibility helper is not callable by API roles (by design): tests ask through this definer wrapper, whoever the session is
create or replace function t.elig(p_item uuid, p_type text, p_now timestamptz default now()) returns jsonb
language sql security definer as $$ select public.app_item_eligibility(p_item, p_type, p_now) $$;create or replace function t.status(p_req uuid) returns text language sql as $$ select status from public.return_requests where id = p_req $$;
create or replace function t.istatus(p_req uuid, p_order_item text) returns text language sql as $$
  select item_status from public.return_request_items where request_id = p_req and order_item_id = p_order_item::uuid
$$;
create or replace function t.iid(p_req uuid, p_order_item text) returns uuid language sql as $$
  select id from public.return_request_items where request_id = p_req and order_item_id = p_order_item::uuid
$$;

-- fixtures: two delivered orders (Alice 3 lines, Bob 1 line) --------------------------------------------------------------------------------
insert into public.orders (id, user_id, order_status, payment_status, customer_name, total, delivered_at, delivered_at_source, created_at) values
  ('w_o1', t.alice(), 'delivered', 'paid', 'Alice', 3000, now() - interval '2 days', 'shipment', now() - interval '6 days'),
  ('w_o2', t.bob(),   'delivered', 'paid', 'Bob',   500,  now() - interval '2 days', 'shipment', now() - interval '6 days'),
  ('w_o3', t.alice(), 'delivered', 'paid', 'Alice', 2000, now() - interval '2 days', 'shipment', now() - interval '6 days'),
  ('w_o4', t.alice(), 'delivered', 'paid', 'Alice', 900,  now() - interval '2 days', 'shipment', now() - interval '6 days');
insert into public.order_items (id, order_id, product_id, variant_id, title, product_title, variant_name, quantity, unit_price, line_total,
                                return_enabled, return_window_days, exchange_enabled, exchange_window_days) values
  ('55555555-0000-0000-0000-000000000001', 'w_o1', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 2, 500, 1000, true, 7, true, 7),
  ('55555555-0000-0000-0000-000000000002', 'w_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt [Pink]', 'Designer Shirt', 'Pink', 1, 300, 300, true, 7, true, 7),
  ('55555555-0000-0000-0000-000000000003', 'w_o1', 'prod_vmain_ok', 'var_1700000000001_1', 'Designer Shirt [White]', 'Designer Shirt', 'White', 3, 200, 600, true, 7, true, 7),
  ('55555555-0000-0000-0000-000000000004', 'w_o2', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 1, 500, 500, true, 7, true, 7),
  ('55555555-0000-0000-0000-000000000005', 'w_o3', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 2, 500, 1000, true, 7, true, 7),
  ('55555555-0000-0000-0000-000000000006', 'w_o3', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt [Pink]', 'Designer Shirt', 'Pink', 2, 300, 600, true, 7, true, 7),
  ('55555555-0000-0000-0000-000000000007', 'w_o4', 'prod_vmain_ok', 'var_1700000000001_1', 'Designer Shirt [White]', 'Designer Shirt', 'White', 3, 200, 600, true, 7, true, 7);

-- 1. a return, decided line by line ---------------------------------------------------------------------------------------------------------------
do $$
declare
  r    uuid;
  v_j  jsonb;
  a    text := '55555555-0000-0000-0000-000000000001';
  b    text := '55555555-0000-0000-0000-000000000002';
  c    text := '55555555-0000-0000-0000-000000000003';
begin
  r := t.mk(t.alice(), 'w_o1', 'return', jsonb_build_array(t.it(a, 1), t.it(b, 1)));
  -- who may decide
  perform t.fails(format($q$select public.decide_request_items(%L, '[{"item_id":"%s","decision":"approve"}]'::jsonb)$q$, r, t.iid(r, a)), '42501', 'Admin access required');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.decide_request_items(%L, '[]'::jsonb)$q$, r), '22023', '%approve or reject%');
  perform t.fails(format($q$select public.decide_request_items(%L, '[{"item_id":"%s","decision":"maybe"}]'::jsonb)$q$, r, t.iid(r, a)), '22023', '%approve or reject%');
  perform t.fails(format($q$select public.decide_request_items(%L, '[{"item_id":"%s","decision":"reject"}]'::jsonb)$q$, r, t.iid(r, b)), '22023', '%reason for rejecting%');
  perform t.fails(format($q$select public.decide_request_items(%L, '[{"item_id":"%s","decision":"approve"}]'::jsonb)$q$, r, gen_random_uuid()), '22023', '%not part of this request%');
  perform t.fails(format($q$select public.decide_request_items(%L, '[{"item_id":"zzz","decision":"approve"}]'::jsonb)$q$, r), '22023', '%valid item_id%');
  perform t.fails($q$select public.decide_request_items(gen_random_uuid(), '[]'::jsonb)$q$, 'P0002');
  perform t.eq(t.status(r), 'pending_review', 'failed decisions changed nothing');

  -- approve ONE line: the request waits for the other
  v_j := public.decide_request_items(r, format('[{"item_id":"%s","decision":"approve","note":"ok"}]', t.iid(r, a))::jsonb, 'looks fine');
  perform t.eq(v_j ->> 'status', 'pending_review', 'one line decided: the request is still pending');
  perform t.eq(v_j ->> 'pending', '1', 'one line is still waiting');
  perform t.eq(t.istatus(r, a), 'approved', 'line A approved');
  perform t.eq(t.istatus(r, b), 'pending', 'line B untouched (per-line decisions)');
  perform t.fails(format($q$select public.decide_request_items(%L, '[{"item_id":"%s","decision":"reject","note":"x"}]'::jsonb)$q$, r, t.iid(r, a)), '22023', '%already decided%');

  -- reject the other with a reason: the request is approved for what was approved, and says what was not
  v_j := public.decide_request_items(r, format('[{"item_id":"%s","decision":"reject","note":"The item was used"}]', t.iid(r, b))::jsonb);
  perform t.eq(v_j ->> 'status', 'approved', 'every line decided and one approved: the request is Approved');
  perform t.eq(t.istatus(r, b), 'rejected', 'line B rejected');
  perform t.eq(t.istatus(r, a), 'approved', 'line A still approved');
  perform t.ok((select decided_at is not null from public.return_requests where id = r), 'the decision time is stored');
  perform t.ok((select decided_by = t.admin() from public.return_request_private where request_id = r), 'and who decided (admin-only table)');
  perform t.ok((select customer_note like '%Not approved%The item was used%' from public.return_requests where id = r), 'the customer is told what was not approved and why');
  perform t.fails(format($q$select public.decide_request_items(%L, '[{"item_id":"%s","decision":"approve"}]'::jsonb)$q$, r, t.iid(r, a)), '22023', '%pending review%');
  -- a rejected line's units go back to the pool; the approved one stays tied up; an untouched line is untouched
  perform t.eq(t.elig(b::uuid, 'return') ->> 'remaining_qty', '1', 'the rejected line can be asked for again');
  perform t.ok((t.elig(a::uuid, 'return') -> 'reasons') ? 'ACTIVE_REQUEST', 'the approved line is in progress');
  perform t.ok((t.elig(c::uuid, 'return') ->> 'eligible')::boolean, 'a line that was never in the request is unaffected');

  -- what the customer sees
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.notifications where user_id = t.alice() and title = 'Return approved' and data ->> 'requestId' = r::text), '1', 'the customer got ONE "Return approved" notification');
  perform t.as_user(t.alice());
  perform t.ok((select decision_note from public.return_request_items where order_item_id = b::uuid and request_id = r) = 'The item was used', 'the customer sees the rejection reason of the line');
  perform t.ok(not exists (select 1 from public.return_request_events where request_id = r and internal), 'staff-only events are invisible to the customer');
  perform t.ok(exists (select 1 from public.return_request_events where request_id = r and note like 'Item rejected%'), 'the decisions are in her history');
  perform t.as_user(t.bob());
  perform t.ok((select count(*) from public.return_request_events) = 0, 'and invisible to other customers');
  perform t.as_postgres();
end $$;

-- 2. return logistics (Phase 8) ---------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r      uuid := (select id from public.return_requests where order_id = 'w_o1' and status = 'approved');
  v_j    jsonb;
  v_ship uuid;
  a      text := '55555555-0000-0000-0000-000000000001';
begin
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.set_return_logistics(%L, 'courier_pickup')$q$, r), '42501');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.set_return_logistics(%L, 'teleport', 'x')$q$, r), '22023', '%courier_pickup, customer_arranged or manual%');
  perform t.fails(format($q$select public.set_return_logistics(%L, 'customer_arranged')$q$, r), '22023', '%instructions%');
  perform t.fails(format($q$select public.set_return_logistics(%L, 'manual', 'x', 'nope')$q$, r), '22023', 'Unknown courier%');
  perform t.fails(format($q$select public.set_return_logistics(%L, 'courier_pickup', null, 'dtdc', null, 'P-1', 'ftp://x')$q$, r), '22023', '%http://%');
  perform t.fails(format($q$select public.set_return_logistics(%L, 'courier_pickup', null, 'dtdc', null, 'P-1', null, null, null, -5)$q$, r), '22023', '%negative%');
  perform t.eq(t.status(r), 'approved', 'failed attempts changed nothing');

  v_j := public.set_return_logistics(r, 'courier_pickup', null, 'dtdc', null, 'P-1', null, 'PK-9', now() - interval '1 hour', 40, 'booked by phone');
  v_ship := (v_j ->> 'shipment_id')::uuid;
  perform t.eq(v_j ->> 'status', 'awaiting_return_shipment', 'the request now awaits the return parcel');
  perform t.eq((select return_method from public.return_requests where id = r), 'courier_pickup', 'the method is stored');
  perform t.ok((select return_instructions like 'A courier will contact you%' from public.return_requests where id = r), 'with default instructions for a booked pickup');
  perform t.ok(exists (select 1 from public.shipments where id = v_ship and direction = 'return' and request_id = r and tracking_number = 'P-1' and pickup_reference = 'PK-9'), 'the return parcel is a shipment (direction return) tied to the request');
  perform t.eq((select quantity::text from public.shipment_items where shipment_id = v_ship), '1', 'carrying the approved quantity');
  perform t.eq((select charges::text from public.shipment_private where shipment_id = v_ship), '40.00', 'the return shipping charges are recorded (admin-only)');
  perform t.ok(exists (select 1 from public.shipment_events where shipment_id = v_ship and event_type = 'created'), 'with its creation event');
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.notifications where user_id = t.alice() and title = 'Return instructions are ready'), '1', 'the customer was told the instructions are ready');
  perform t.as_user(t.alice());
  perform t.ok(exists (select 1 from public.shipments where id = v_ship), 'the customer can see the return shipment (tracking number, courier)');
  perform t.eq((select count(*)::text from public.shipment_private), '0', 'but never its charges / notes');

  -- editing the details while the request awaits the parcel
  perform t.as_user(t.admin());
  v_j := public.set_return_logistics(r, 'courier_pickup', 'Pickup moved to tomorrow, 10-1', 'dtdc', null, 'P-1B', null, 'PK-9', null, null, null);
  perform t.eq((select tracking_number from public.shipments where id = v_ship), 'P-1B', 'the return tracking number can be corrected');
  perform t.eq((select count(*)::text from public.shipments where request_id = r), '1', 'still ONE return shipment per request');
  perform t.eq((select customer_note from public.return_requests where id = r), 'Pickup moved to tomorrow, 10-1', 'the customer sees the new instructions');

  -- the courier reports the parcel moving -> the request follows
  perform public.add_shipment_event(v_ship, 'picked_up', now() - interval '30 minutes');
  perform t.eq(t.status(r), 'return_in_transit', 'a courier pickup event moves the request to Return In Transit');
  perform t.fails(format($q$select public.set_return_logistics(%L, 'manual', 'x')$q$, r), '22023', '%approved request%');

  -- it arrives
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.record_return_received(%L)$q$, r), '42501');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.record_return_received(%L, now() + interval '2 days')$q$, gen_random_uuid()), 'P0002');
  perform t.fails(format($q$select public.record_return_received(%L, now() + interval '2 days')$q$, r), '22023', '%future%');
  v_j := public.record_return_received(r, now() - interval '5 minutes', 'Parcel intact');
  perform t.eq(v_j ->> 'status', 'inspection_pending', 'received -> straight to Inspection Pending');
  perform t.ok((select received_at is not null from public.return_requests where id = r), 'the received time is stored');
  perform t.eq(t.istatus(r, a), 'received', 'the approved line is marked received');
  perform t.eq((select status from public.shipments where id = v_ship), 'delivered', 'and the return shipment is closed as delivered');
  perform t.eq((select count(*)::text from public.return_request_events where request_id = r and to_status in ('return_received', 'inspection_pending')), '2', 'both steps are in the audit trail');
  perform t.fails(format($q$select public.record_return_received(%L)$q$, r), '22023', '%awaited or in transit%');

  -- inspection
  perform t.fails(format($q$select public.record_inspection(%L, '[{"item_id":"%s","result":"failed"}]'::jsonb)$q$, r, t.iid(r, a)), '22023', '%why the item failed%');
  perform t.fails(format($q$select public.record_inspection(%L, '[{"item_id":"%s","result":"great"}]'::jsonb)$q$, r, t.iid(r, a)), '22023', '%passed or failed%');
  perform t.fails(format($q$select public.record_inspection(%L, '[{"item_id":"%s","result":"passed"}]'::jsonb)$q$, r, gen_random_uuid()), '22023', '%not part of this request%');
  v_j := public.record_inspection(r, format('[{"item_id":"%s","result":"passed","note":"Unused, tags on"}]', t.iid(r, a))::jsonb, 'restock');
  perform t.eq(v_j ->> 'status', 'inspection_passed', 'all inspected and one passed: Inspection Passed');
  perform t.eq(t.istatus(r, a), 'passed', 'the line passed');
  perform t.fails(format($q$select public.record_inspection(%L, '[{"item_id":"%s","result":"passed"}]'::jsonb)$q$, r, t.iid(r, a)), '22023', '%waiting for inspection%');

  -- onwards (the refund itself is Phase 9)
  v_j := public.request_transition(r, 'refund_pending', 'ready for refund');
  perform t.eq(v_j ->> 'status', 'refund_pending', 'the admin moves it to Refund Pending');
  perform t.fails(format($q$select public.request_transition(%L, 'refunded')$q$, r), '22023', '%completed by the refund%');
  perform t.fails(format($q$select public.request_transition(%L, 'closed')$q$, r), '22023', '%cannot go from%');
  perform t.ok(exists (select 1 from public.return_request_events where request_id = r and internal and note = 'ready for refund'), 'the admin note stayed internal');
  perform t.as_user(t.alice());
  perform t.ok(not exists (select 1 from public.return_request_events where request_id = r and note = 'ready for refund'), 'the customer does not see it');
  perform t.as_postgres();
end $$;

-- 3. everything rejected -> Rejected, final ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  r uuid;
begin
  r := t.mk(t.bob(), 'w_o2', 'return', jsonb_build_array(t.it('55555555-0000-0000-0000-000000000004', 1)), 'other', 'changed my mind');
  perform t.as_user(t.admin());
  perform t.eq(public.decide_request_items(r, format('[{"item_id":"%s","decision":"reject","note":"Outside what we accept"}]', t.iid(r, '55555555-0000-0000-0000-000000000004'))::jsonb) ->> 'status', 'rejected', 'every line rejected: the request is Rejected');
  perform t.ok((select closed_at is not null from public.return_requests where id = r), 'a rejected request is closed');
  perform t.fails(format($q$select public.request_transition(%L, 'pending_review')$q$, r), '22023', '%no longer change%');
  perform t.fails(format($q$select public.cancel_return_request(%L)$q$, r), '22023', '%no longer change%');
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.notifications where user_id = t.bob() and title like '%was not approved'), '1', 'the customer was told');
  perform t.ok((t.elig('55555555-0000-0000-0000-000000000004'::uuid, 'return') ->> 'eligible')::boolean, 'a rejected line can be requested again');
end $$;

-- 4. "customer arranged" return -----------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r      uuid;
  v_j    jsonb;
  v_ship uuid;
  c      text := '55555555-0000-0000-0000-000000000003';
begin
  r := t.mk(t.alice(), 'w_o1', 'return', jsonb_build_array(t.it(c, 2)));
  perform t.as_user(t.admin());
  perform public.decide_request_items(r, format('[{"item_id":"%s","decision":"approve"}]', t.iid(r, c))::jsonb);
  perform t.eq(t.status(r), 'approved', 'approved');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.customer_submit_return_shipment(%L, 'India Post', 'RR123')$q$, r), '22023', '%asked you to send it yourself%');
  perform t.as_user(t.admin());
  v_j := public.set_return_logistics(r, 'customer_arranged', 'Send the parcel to: Returns desk, 12 Market Road, Chennai 600001. We refund once it arrives and passes inspection.');
  perform t.eq(v_j ->> 'status', 'awaiting_return_shipment', 'awaiting the customer''s parcel');
  perform t.ok(v_j ->> 'shipment_id' is null, 'no shipment yet: the customer will enter it');
  perform t.as_user(t.bob());
  perform t.fails(format($q$select public.customer_submit_return_shipment(%L, 'x')$q$, r), 'P0002');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.customer_submit_return_shipment(%L, '')$q$, r), '22023', '%courier or post service%');
  perform t.fails(format($q$select public.customer_submit_return_shipment(%L, 'India Post', 'RR123', 'ftp://x')$q$, r), '22023', '%http%');
  perform t.fails(format($q$select public.customer_submit_return_shipment(%L, 'India Post', 'RR123', null, now() + interval '3 days')$q$, r), '22023', '%future%');
  v_j := public.customer_submit_return_shipment(r, 'India Post', 'RR123456789IN', 'https://track.example.test/RR123456789IN', now() - interval '3 hours');
  v_ship := (v_j ->> 'shipment_id')::uuid;
  perform t.eq(v_j ->> 'status', 'return_in_transit', 'the request is now in transit');
  perform t.ok(exists (select 1 from public.shipments where id = v_ship and direction = 'return' and request_id = r and courier_name = 'India Post' and tracking_number = 'RR123456789IN'), 'the customer''s parcel is recorded');
  perform t.as_postgres();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.admin() and title = 'Return sent by the customer'), 'the admin was told');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.customer_submit_return_shipment(%L, 'India Post')$q$, r), '22023', '%asked you to send it yourself%');     -- no longer awaiting
  perform t.as_postgres();
end $$;

-- 5. "we need more information" -----------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r uuid;
begin
  r := t.mk(t.alice(), 'w_o3', 'return', jsonb_build_array(t.it('55555555-0000-0000-0000-000000000005', 1)), 'other', 'it stopped working');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.request_transition(%L, 'needs_info')$q$, r), '22023', '%what information%');
  perform t.eq(public.request_transition(r, 'needs_info', 'photo missing', 'Please send a photo of the label') ->> 'status', 'needs_info', 'the admin asks for more information');
  perform t.eq((select customer_note from public.return_requests where id = r), 'Please send a photo of the label', 'the customer sees the question');
  perform t.as_user(t.alice());
  perform t.eq(public.respond_to_request(r, 'Here is the label text: S-100') ->> 'status', 'pending_review', 'the answer returns the request to review');
  perform t.as_user(t.admin());
  perform t.eq(public.request_transition(r, 'needs_info', null, 'Still unclear: which batch?') ->> 'status', 'needs_info', 'asked again');
  -- the admin can decide straight from "needs info"
  perform t.eq(public.decide_request_items(r, format('[{"item_id":"%s","decision":"approve"}]', t.iid(r, '55555555-0000-0000-0000-000000000005'))::jsonb) ->> 'status', 'approved', 'decided from needs-info: approved');
end $$;

-- 6. an exchange: same road, then a replacement (Phase 10 completes it) ---------------------------------------------------------------------------------------------
do $$
declare
  r   uuid;
  v_j jsonb;
  x   text := '55555555-0000-0000-0000-000000000006';
begin
  r := t.mk(t.alice(), 'w_o3', 'exchange', jsonb_build_array(jsonb_build_object('order_item_id', x, 'quantity', 2, 'replacement_variant_id', 'var_1700000000001_1')), 'incorrect_color');
  perform t.as_user(t.admin());
  perform public.decide_request_items(r, format('[{"item_id":"%s","decision":"approve"}]', t.iid(r, x))::jsonb);
  perform t.eq(public.set_return_logistics(r, 'manual', 'Hand the parcel to our delivery boy on his next visit.') ->> 'status', 'awaiting_return_shipment', 'logistics set');
  perform t.eq(public.request_transition(r, 'return_in_transit') ->> 'status', 'return_in_transit', 'moved to in transit by hand (no courier API)');
  perform t.eq(public.record_return_received(r) ->> 'status', 'inspection_pending', 'received');
  -- a mixed inspection of two lines would be below; here the one line passes
  v_j := public.record_inspection(r, format('[{"item_id":"%s","result":"passed"}]', t.iid(r, x))::jsonb);
  perform t.eq(v_j ->> 'status', 'inspection_passed', 'inspection passed');
  perform t.fails(format($q$select public.request_transition(%L, 'refund_pending')$q$, r), '22023', '%cannot go from%');           -- an exchange is not refunded
  perform t.eq(public.request_transition(r, 'replacement_pending') ->> 'status', 'replacement_pending', 'an exchange goes to Replacement Pending');
  perform t.fails(format($q$select public.request_transition(%L, 'replacement_shipped')$q$, r), '22023', '%completed by the refund / replacement%');
  perform t.fails(format($q$select public.request_transition(%L, 'closed')$q$, r), '22023', '%cannot go from%');                   -- NOT complete just because the admin approved
  perform t.ok((select status <> 'closed' from public.return_requests where id = r), 'an exchange is not complete until the replacement is delivered');
end $$;

-- 7. mixed inspection, cancel rules ----------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r   uuid;
  v_j jsonb;
  p   text := '55555555-0000-0000-0000-000000000001';
  q   text := '55555555-0000-0000-0000-000000000007';
begin
  -- A and C may be requested again (the first A request is in refund_pending, so use the lines that are free: q) plus a fresh order line
  r := t.mk(t.alice(), 'w_o4', 'return', jsonb_build_array(t.it(q, 1)));
  perform t.as_user(t.admin());
  perform public.decide_request_items(r, format('[{"item_id":"%s","decision":"approve"}]', t.iid(r, q))::jsonb);
  perform public.set_return_logistics(r, 'manual', 'Bring it to the shop');
  perform public.record_return_received(r);
  v_j := public.record_inspection(r, format('[{"item_id":"%s","result":"failed","note":"Worn and washed"}]', t.iid(r, q))::jsonb);
  perform t.eq(v_j ->> 'status', 'inspection_failed', 'nothing accepted: Inspection Failed');
  perform t.eq(t.istatus(r, q), 'failed', 'the line failed');
  perform t.ok((select inspection_note = 'Worn and washed' from public.return_request_items where request_id = r), 'the customer-visible reason is stored');
  perform t.eq(t.elig(q::uuid, 'return') ->> 'remaining_qty', '2', 'a failed unit stays consumed: 3 ordered, 1 failed, 2 left');
  perform t.eq(public.request_transition(r, 'closed') ->> 'status', 'closed', 'a failed inspection is closed');
  perform t.as_postgres();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.alice() and title = 'Your return could not be accepted'), 'the customer was told');

  -- cancel rules: a customer may cancel until the parcel is received; never after
  r := t.mk(t.alice(), 'w_o4', 'return', jsonb_build_array(t.it(q, 1)));
  perform t.as_user(t.admin());
  perform public.decide_request_items(r, format('[{"item_id":"%s","decision":"approve"}]', t.iid(r, q))::jsonb);
  perform public.set_return_logistics(r, 'manual', 'Bring it to the shop');
  perform t.as_user(t.alice());
  perform t.eq(public.cancel_return_request(r, 'found it fits') ->> 'status', 'cancelled', 'a customer may cancel while the parcel is awaited');
  perform t.eq(t.istatus(r, q), 'cancelled', 'the approved line is released');
  r := t.mk(t.alice(), 'w_o4', 'return', jsonb_build_array(t.it(q, 1)));
  perform t.as_user(t.admin());
  perform public.decide_request_items(r, format('[{"item_id":"%s","decision":"approve"}]', t.iid(r, q))::jsonb);
  perform public.set_return_logistics(r, 'manual', 'Bring it to the shop');
  perform public.record_return_received(r);
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.cancel_return_request(%L)$q$, r), '22023', '%cannot go from%');
  perform t.as_user(t.admin());
  -- the transition table has no "cancel" out of inspection either: the parcel is here, the request must be finished, not dropped
  perform t.fails(format($q$select public.cancel_return_request(%L, 'Customer asked to keep it')$q$, r), '22023', '%cannot go from%');
end $$;

-- 8. the state machine as a table: legal and illegal moves for each actor -------------------------------------------------------------------------------------------
do $$
declare
  c record;
  r uuid;
  n integer := 0;
begin
  for c in
    select * from (values
      ('return',   'pending_review',           'approved',                 'admin',    true),
      ('return',   'pending_review',           'refunded',                 'admin',    false),
      ('return',   'pending_review',           'inspection_passed',        'system',   false),
      ('return',   'pending_review',           'cancelled',                'customer', true),
      ('return',   'pending_review',           'approved',                 'customer', false),
      ('return',   'needs_info',               'pending_review',           'customer', true),
      ('return',   'approved',                 'awaiting_return_shipment', 'customer', false),
      ('return',   'approved',                 'awaiting_return_shipment', 'admin',    true),
      ('return',   'awaiting_return_shipment', 'return_in_transit',        'customer', true),
      ('return',   'awaiting_return_shipment', 'inspection_pending',       'admin',    false),
      ('return',   'return_in_transit',        'cancelled',                'customer', false),
      ('return',   'return_in_transit',        'cancelled',                'admin',    true),
      ('return',   'return_received',          'inspection_pending',       'admin',    true),
      ('return',   'inspection_pending',       'inspection_passed',        'admin',    false),
      ('return',   'inspection_pending',       'inspection_passed',        'system',   true),
      ('return',   'inspection_pending',       'refund_pending',           'admin',    false),
      ('return',   'inspection_passed',        'refund_pending',           'admin',    true),
      ('return',   'inspection_passed',        'replacement_pending',      'admin',    false),
      ('return',   'inspection_failed',        'refund_pending',           'admin',    false),
      ('return',   'refund_pending',           'refunded',                 'system',   true),
      ('return',   'refund_pending',           'cancelled',                'customer', false),
      ('return',   'refunded',                 'closed',                   'admin',    true),
      ('exchange', 'inspection_passed',        'replacement_pending',      'admin',    true),
      ('exchange', 'inspection_passed',        'refund_pending',           'admin',    false),
      ('exchange', 'replacement_pending',      'replacement_shipped',      'system',   true),
      ('exchange', 'replacement_pending',      'replacement_shipped',      'customer', false),
      ('exchange', 'replacement_shipped',      'replacement_delivered',    'system',   true),
      ('exchange', 'replacement_shipped',      'closed',                   'admin',    false),
      ('exchange', 'replacement_delivered',    'closed',                   'admin',    true),
      ('exchange', 'approved',                 'replacement_pending',      'admin',    false),
      ('exchange', 'pending_review',           'refund_pending',           'admin',    false)
    ) as v(typ, from_s, to_s, actor, allowed)
  loop
    n := n + 1;
    r := gen_random_uuid();
    perform t.as_postgres();
    insert into public.return_requests (id, request_no, order_id, user_id, type, status, reason_code, delivered_at)
    values (r, 'MATRIX-' || n, 'w_o2', t.bob(), c.typ, c.from_s, 'other', now());
    if c.allowed then
      perform public.app_apply_request_transition(r, c.to_s, c.actor, null, null, null, false);
      perform t.eq(t.status(r), c.to_s, c.typ || ': ' || c.from_s || ' -> ' || c.to_s || ' allowed for ' || c.actor);
    else
      perform t.fails(format('select public.app_apply_request_transition(%L, %L, %L, null, null, null, false)', r, c.to_s, c.actor), '22023', '%cannot go from%');
    end if;
  end loop;
  -- final states are final
  for c in select * from (values ('rejected'), ('closed'), ('cancelled')) as v(s) loop
    r := gen_random_uuid();
    insert into public.return_requests (id, request_no, order_id, user_id, type, status, reason_code, delivered_at) values (r, 'FINAL-' || c.s, 'w_o2', t.bob(), 'return', c.s, 'other', now());
    perform t.fails(format('select public.app_apply_request_transition(%L, %L, %L, null, null, null, false)', r, 'pending_review', 'admin'), '22023', '%no longer change%');
  end loop;
end $$;

-- 9. messages, internal notes, the helpers are not callable by API roles -----------------------------------------------------------------------------------------------
do $$
declare
  r uuid := (select id from public.return_requests where order_id = 'w_o3' and type = 'return' and status = 'approved' limit 1);
begin
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.send_request_message(%L, '')$q$, r), '22023', '%1 to 1000%');
  perform public.send_request_message(r, 'We will collect it on Monday');
  perform t.eq((select customer_note from public.return_requests where id = r), 'We will collect it on Monday', 'a customer-visible message');
  perform public.set_request_internal_note(r, 'VIP customer - be generous');
  perform t.eq((select internal_note from public.return_request_private where request_id = r), 'VIP customer - be generous', 'an internal note is stored (admin-only table)');
  perform t.as_user(t.alice());
  perform t.eq((select count(*)::text from public.return_request_private), '0', 'the customer cannot read it');
  perform t.ok(exists (select 1 from public.return_request_events where request_id = r and note = 'We will collect it on Monday'), 'but sees the message in the history');
  perform t.ok(not exists (select 1 from public.return_request_events where note like 'VIP%'), 'and never the internal note');
  perform t.fails(format($q$select public.send_request_message(%L, 'hi')$q$, r), '42501');
  perform t.fails(format($q$select public.set_request_internal_note(%L, 'hi')$q$, r), '42501');
  perform t.fails(format($q$select public.app_apply_request_transition(%L, 'cancelled', 'customer', null)$q$, r), '42501');
  perform t.fails($q$select public.app_lock_request_for_admin(gen_random_uuid())$q$, '42501');
  perform t.as_anon();
  perform t.fails(format($q$select public.request_transition(%L, 'closed')$q$, r), '42501');
  perform t.as_postgres();
end $$;

rollback;