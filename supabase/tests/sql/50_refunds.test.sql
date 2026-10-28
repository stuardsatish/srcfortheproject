-- needs: m5
-- reapply: 20261017_06_refunds.sql
-- Phase 9 — M5: refund calculation (snapshot-based allocation, partial returns, shipping rule, cap), creation (idempotent, one per request),
-- manual and gateway completion (webhook idempotency, never sent twice, never regress), privacy, guards.
-- ("reapply" = the runner applies the migration a SECOND time before this script: the idempotency test.)
begin;

create or replace function t.it(p_order_item text, p_qty int) returns jsonb language sql as $$
  select jsonb_build_object('order_item_id', p_order_item, 'quantity', p_qty)
$$;
create or replace function t.status(p_req uuid) returns text language sql as $$ select status from public.return_requests where id = p_req $$;
create or replace function t.rstatus(p_refund uuid) returns text language sql as $$ select status from public.refunds where id = p_refund $$;
create or replace function t.num(p_j jsonb, p_key text) returns numeric language sql as $$ select (p_j ->> p_key)::numeric $$;

-- a return request that has PASSED inspection: the customer submits it, the admin approves every line, arranges the return (manual),
-- receives it and passes every line. Leaves the session as postgres.
create or replace function t.passed(p_uid uuid, p_order text, p_items jsonb, p_reason text default 'incorrect_size') returns uuid
language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  d jsonb;
begin
  perform t.as_user(p_uid);
  perform public.create_return_request(v, p_order, 'return', p_items, p_reason, case when p_reason = 'missing_item' then 'it was not in the parcel' end);
  perform t.as_user(t.admin());
  select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')), '[]'::jsonb) into d from public.return_request_items where request_id = v;
  perform public.decide_request_items(v, d);
  perform public.set_return_logistics(v, 'manual', 'Please post the items to us');
  perform public.record_return_received(v);
  select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'result', 'passed')), '[]'::jsonb) into d from public.return_request_items where request_id = v;
  perform public.record_inspection(v, d);
  perform t.as_postgres();
  return v;
end $$;

-- fixtures ------------------------------------------------------------------------------------------------------------------------------------------
-- f_o1: Razorpay, promo 100 and shipping 49: subtotal 1800 - 100 + 49 = 1749 (the customer paid 1749). f_o2: paid in cash. f_o3: COD, not paid yet.
-- f_o4 / f_o5: Razorpay, for the gateway flow. f_o6: Bob's.
insert into public.orders (id, user_id, order_status, payment_status, payment_method, customer_name, subtotal, shipping, promo_discount, total, razorpay_payment_id,
                           delivered_at, delivered_at_source, created_at) values
  ('f_o1', t.alice(), 'delivered', 'paid',    'Razorpay', 'Alice', 1800, 49, 100, 1749, 'pay_T1', now() - interval '2 days', 'shipment', now() - interval '6 days'),
  ('f_o2', t.alice(), 'delivered', 'paid',    'Cash',     'Alice', 1000, 0,  0,   1000, null,     now() - interval '2 days', 'shipment', now() - interval '6 days'),
  ('f_o3', t.alice(), 'delivered', 'pending', 'COD',      'Alice', 500,  0,  0,   500,  null,     now() - interval '2 days', 'shipment', now() - interval '6 days'),
  ('f_o4', t.alice(), 'delivered', 'paid',    'Razorpay', 'Alice', 1000, 0,  0,   1000, 'pay_T4', now() - interval '2 days', 'shipment', now() - interval '6 days'),
  ('f_o5', t.alice(), 'delivered', 'paid',    'Razorpay', 'Alice', 1000, 0,  0,   1000, 'pay_T5', now() - interval '2 days', 'shipment', now() - interval '6 days'),
  ('f_o6', t.bob(),   'delivered', 'paid',    'Razorpay', 'Bob',   500,  0,  0,   500,  'pay_T6', now() - interval '2 days', 'shipment', now() - interval '6 days');
insert into public.order_items (id, order_id, product_id, variant_id, title, product_title, variant_name, quantity, unit_price, line_total,
                                return_enabled, return_window_days, exchange_enabled, exchange_window_days) values
  ('66666666-0000-0000-0000-000000000001', 'f_o1', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 3, 500, 1500, true, 7, true, 7),
  ('66666666-0000-0000-0000-000000000002', 'f_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt [Pink]', 'Designer Shirt', 'Pink', 1, 300, 300, true, 7, true, 7),
  ('66666666-0000-0000-0000-000000000003', 'f_o2', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 2, 500, 1000, true, 7, true, 7),
  ('66666666-0000-0000-0000-000000000004', 'f_o3', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 1, 500, 500, true, 7, true, 7),
  ('66666666-0000-0000-0000-000000000005', 'f_o4', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 2, 500, 1000, true, 7, true, 7),
  ('66666666-0000-0000-0000-000000000006', 'f_o5', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 2, 500, 1000, true, 7, true, 7),
  ('66666666-0000-0000-0000-000000000007', 'f_o6', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 1, 500, 500, true, 7, true, 7);

-- 1. the calculation: partial return, allocation of the promo discount, no shipping for a partial / not-seller-fault return --------------------------
do $$
declare
  r1 uuid;
  v  jsonb;
  a  text := '66666666-0000-0000-0000-000000000001';
  b  text := '66666666-0000-0000-0000-000000000002';
begin
  r1 := t.passed(t.alice(), 'f_o1', jsonb_build_array(t.it(a, 2), t.it(b, 1)), 'incorrect_size');
  perform t.eq(t.status(r1), 'inspection_passed', 'fixture: the return passed inspection');

  -- who may calculate
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.refund_calculate(%L)$q$, r1), '42501', 'Admin access required');
  perform t.as_anon();
  perform t.fails(format($q$select public.refund_calculate(%L)$q$, r1), '42501');
  perform t.as_user(t.admin());
  perform t.fails($q$select public.refund_calculate(gen_random_uuid())$q$, 'P0002');

  v := public.refund_calculate(r1);
  perform t.ok(t.num(v, 'paid_total') = 1749, 'the customer paid 1749 (subtotal 1800 - promo 100 + shipping 49)');
  perform t.ok(t.num(v, 'paid_for_goods') = 1700, 'what was paid for the GOODS = total - shipping = 1700 (the promo discount is already inside it)');
  -- line A: allocated 1500/1800 of 1700 = 1416.67; 2 of its 3 units = 944.45. line B (the last line takes the remainder): 1700 - 1416.67 = 283.33
  perform t.ok(((v -> 'lines') -> 0 ->> 'paid_share')::numeric = 1416.67, 'line A paid share = 1416.67');
  perform t.ok(((v -> 'lines') -> 0 ->> 'amount')::numeric = 944.45, '2 of 3 units of line A = 944.45');
  perform t.ok(((v -> 'lines') -> 1 ->> 'paid_share')::numeric = 283.33, 'line B takes the remainder so the shares add up to 1700 exactly');
  perform t.ok(((v -> 'lines') -> 1 ->> 'amount')::numeric = 283.33, 'the single unit of line B = 283.33');
  perform t.ok(t.num(v, 'items_amount') = 1227.78, 'items = 944.45 + 283.33 = 1227.78');
  perform t.ok(not (v ->> 'shipping_eligible')::boolean, 'a partial return does not refund the shipping');
  perform t.ok(t.num(v, 'shipping_amount') = 0, '... so the shipping amount is 0');
  perform t.ok(v ->> 'shipping_reason' like '%every item of the order%', 'and the screen can say why');
  perform t.ok(not (v ->> 'seller_fault')::boolean, 'incorrect_size is not the seller''s fault');
  perform t.ok(t.num(v, 'amount') = 1227.78, 'the refund = 1227.78');
  perform t.ok(t.num(v, 'refundable_remaining') = 1749, 'nothing refunded yet: 1749 is still refundable');
  perform t.ok((v ->> 'razorpay_possible')::boolean, 'a Razorpay order can be refunded through the gateway');
  -- the same request, asked for shipping explicitly: refused with the reason
  perform t.fails(format($q$select public.refund_calculate(%L, true)$q$, r1), '22023', '%shipping charge cannot be refunded here%');
  -- the price comes from the PURCHASE snapshot: changing today's catalogue price changes nothing
  perform t.as_postgres();
  update public.products set price = 99999 where id = 'prod_single_a';
  perform t.as_user(t.admin());
  perform t.ok(t.num(public.refund_calculate(r1), 'amount') = 1227.78, 'the refund ignores the current catalogue price');
  perform t.as_postgres();
  update public.products set price = 500 where id = 'prod_single_a';
end $$;

-- 2. refusals of the calculation ------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r3 uuid;
  rx uuid;
  v_ex uuid := gen_random_uuid();
begin
  -- an order that is not paid (COD, cash not collected / not marked paid): nothing was captured, nothing to refund
  perform t.as_user(t.alice());
  r3 := gen_random_uuid();
  perform public.create_return_request(r3, 'f_o3', 'return', jsonb_build_array(t.it('66666666-0000-0000-0000-000000000004', 1)), 'incorrect_size');
  perform t.as_postgres();
  -- walk it to inspection_passed through the admin RPCs
  perform t.as_user(t.admin());
  perform public.decide_request_items(r3, (select jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')) from public.return_request_items where request_id = r3));
  perform public.set_return_logistics(r3, 'manual', 'post it');
  perform public.record_return_received(r3);
  perform public.record_inspection(r3, (select jsonb_agg(jsonb_build_object('item_id', id, 'result', 'passed')) from public.return_request_items where request_id = r3));
  perform t.fails(format($q$select public.refund_calculate(%L)$q$, r3), '22023', '%not marked as paid%');
  perform t.fails(format($q$select public.create_refund(%L, 'key-unpaid-0001', 'manual')$q$, r3), '22023', '%not marked as paid%');
  perform t.eq(t.status(r3), 'inspection_passed', 'a refused refund changed nothing');

  -- a request that has not passed inspection yet
  perform t.as_user(t.alice());
  rx := gen_random_uuid();
  perform public.create_return_request(rx, 'f_o2', 'return', jsonb_build_array(t.it('66666666-0000-0000-0000-000000000003', 1)), 'incorrect_size');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.refund_calculate(%L)$q$, rx), '22023', '%passed inspection%');
  perform public.request_transition(rx, 'cancelled');                     -- frees the line for the exchange below
  -- an exchange is not refunded here
  perform t.as_user(t.alice());
  perform public.create_return_request(v_ex, 'f_o2', 'exchange', jsonb_build_array(jsonb_build_object('order_item_id', '66666666-0000-0000-0000-000000000003', 'quantity', 1)), 'incorrect_size');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.refund_calculate(%L)$q$, v_ex), '22023', '%return request%');
  perform public.request_transition(v_ex, 'cancelled');                   -- park it so it does not interfere with later sections
  perform t.as_postgres();
end $$;

-- 3. creating a refund: idempotent, one per request, validated ------------------------------------------------------------------------------------------
do $$
declare
  r1 uuid := (select id from public.return_requests where order_id = 'f_o1' and status = 'inspection_passed');
  v  jsonb;
  v2 jsonb;
  f  uuid;
begin
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_refund(%L, 'key-customer-001', 'manual')$q$, r1), '42501', 'Admin access required');
  perform t.as_anon();
  perform t.fails(format($q$select public.create_refund(%L, 'key-anon-0000001', 'manual')$q$, r1), '42501');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_refund(%L, 'short', 'manual')$q$, r1), '22023', '%idempotency key%');
  perform t.fails(format($q$select public.create_refund(%L, 'key-bad-method-01', 'cheque')$q$, r1), '22023', '%razorpay or manual%');
  perform t.fails(format($q$select public.create_refund(%L, 'key-adj-nonote-01', 'manual', null, -50)$q$, r1), '22023', '%Explain the adjustment%');
  perform t.fails(format($q$select public.create_refund(%L, 'key-adj-too-big-1', 'manual', null, 99999, 'goodwill')$q$, r1), '22023', '%more than what can still be refunded%');
  perform t.fails(format($q$select public.create_refund(%L, 'key-adj-negative-1', 'manual', null, -5000, 'deduction')$q$, r1), '22023', '%greater than zero%');
  perform t.eq((select count(*)::text from public.refunds where request_id = r1), '0', 'refused attempts left no refund behind');
  perform t.eq(t.status(r1), 'inspection_passed', '... and did not move the request');

  -- the real one: a -27.78 deduction with a written reason (the customer can read it)
  v := public.create_refund(r1, 'key-r1-manual-0001', 'manual', null, -27.78, 'Return courier cost deducted', 'checked with the owner');
  f := (v ->> 'refund_id')::uuid;
  perform t.ok((v ->> 'created')::boolean, 'the refund was created');
  perform t.ok(t.num(v, 'amount') = 1200.00, '1227.78 - 27.78 = 1200.00');
  perform t.ok(v ->> 'refund_no' ~ '^RFD-[0-9]{4}-[0-9]{6}$', 'refund number RFD-YYYY-NNNNNN');
  perform t.eq(v ->> 'status', 'pending', 'a new refund is pending - never "done" because someone clicked');
  perform t.eq(v ->> 'request_status', 'refund_pending', 'the request moved to Refund Pending');
  perform t.eq(t.status(r1), 'refund_pending', '... in the database too');
  perform t.ok((select items_amount = 1227.78 and shipping_amount = 0 and adjustment_amount = -27.78 and amount = 1200.00 and currency = 'INR' and method = 'manual'
                  and adjustment_note = 'Return courier cost deducted' and gateway_state is null from public.refunds where id = f), 'amounts, split, currency, method and the adjustment note are stored');
  perform t.eq((select count(*)::text || '/' || sum(quantity)::text from public.refund_items where refund_id = f), '2/3', 'two lines, 3 units');
  perform t.ok((select internal_note = 'checked with the owner' and initiated_by = t.admin() from public.refund_private where refund_id = f), 'the staff note and who initiated it are kept admin-only');
  perform t.ok(exists (select 1 from public.refund_events where refund_id = f and event_type = 'created' and actor_role = 'admin'), 'the audit trail starts with the creation');
  perform t.as_postgres();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.alice() and title = 'Your refund is being prepared' and data ->> 'requestId' = r1::text), 'the customer was told a refund is being prepared');
  perform t.as_user(t.admin());

  -- a retry with the same key returns the SAME refund
  v2 := public.create_refund(r1, 'key-r1-manual-0001', 'manual', null, -27.78, 'Return courier cost deducted');
  perform t.ok(not (v2 ->> 'created')::boolean and (v2 ->> 'refund_id')::uuid = f, 'the same key again returns the same refund (idempotent)');
  perform t.eq((select count(*)::text from public.refunds where request_id = r1), '1', 'still ONE refund');
  -- ... another key for the same request while one is in progress: refused (one refund per request), by the function and by the database
  perform t.fails(format($q$select public.create_refund(%L, 'key-r1-second-0001', 'manual')$q$, r1), '22023', '%already in progress or completed%');
  perform t.as_postgres();
  perform t.fails(format($f$insert into public.refunds (refund_no, order_id, request_id, kind, amount, items_amount, method, idempotency_key) values ('RFD-X', 'f_o1', %L, 'return', 10, 10, 'manual', 'key-dup-active-0001')$f$, r1), '23505');
  -- the key of another request cannot be reused
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_refund((select id from public.return_requests where order_id = 'f_o2' limit 1), 'key-r1-manual-0001', 'manual')$q$), '22023', '%another refund%');
  perform t.as_postgres();
end $$;

-- 4. manual completion: only an admin, only with a reference; the request and its lines follow ---------------------------------------------------------
do $$
declare
  r1 uuid := (select id from public.return_requests where order_id = 'f_o1' and status = 'refund_pending');
  f  uuid := (select id from public.refunds where idempotency_key = 'key-r1-manual-0001');
  v  jsonb;
begin
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.refund_mark_manual(%L, 'succeeded', 'UTR123')$q$, f), '42501', 'Admin access required');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.refund_mark_manual(%L, 'succeeded')$q$, f), '22023', '%payment reference%');
  perform t.fails(format($q$select public.refund_mark_manual(%L, 'maybe', 'x')$q$, f), '22023', '%succeeded or failed%');
  perform t.fails(format($q$select public.refund_mark_manual(%L, 'succeeded', 'UTR1', null, now() + interval '2 days')$q$, f), '22023', '%future%');
  perform t.fails(format($q$select public.refund_mark_manual(%L, 'failed')$q$, f), '22023', '%Say why%');
  perform t.eq(t.rstatus(f), 'pending', 'refused confirmations changed nothing');

  v := public.refund_mark_manual(f, 'succeeded', 'UTR-889977', 'paid by bank transfer');
  perform t.eq(v ->> 'status', 'succeeded', 'the refund is succeeded ONLY after the admin recorded the reference');
  perform t.ok((select completed_at is not null and reference = 'UTR-889977' and failure_reason is null from public.refunds where id = f), 'completion time and reference stored');
  perform t.eq(t.status(r1), 'refunded', 'the request is Refunded');
  perform t.ok((select count(*) = 2 and bool_and(item_status = 'resolved') from public.return_request_items where request_id = r1), 'its lines are resolved (the units are used up)');
  perform t.ok(exists (select 1 from public.return_request_events where request_id = r1 and to_status = 'refunded' and actor_role = 'system'), 'the move to Refunded is in the audit trail');
  perform t.as_postgres();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.alice() and title = 'Your refund is complete' and data ->> 'requestId' = r1::text), 'the customer was told the refund is complete');
  perform t.ok(exists (select 1 from public.refund_events where refund_id = f and event_type = 'marked_succeeded' and from_status = 'pending' and to_status = 'succeeded'), 'the refund audit trail has the confirmation');
  perform t.as_user(t.admin());
  v := public.refund_mark_manual(f, 'succeeded', 'UTR-889977');
  perform t.ok((v ->> 'already')::boolean, 'confirming twice is a no-op');
  perform t.fails(format($q$select public.refund_mark_manual(%L, 'failed', 'x', 'why')$q$, f), '22023', '%already succeeded%');
  perform t.fails(format($q$select public.refund_void(%L, 'oops')$q$, f), '22023', '%paid out%');
  -- the units that were refunded cannot be asked for again (3 units: 2 + 1 refunded; 1 left)
  perform t.as_postgres();
end $$;

-- 5. the second return of the same order completes it: the shipping charge is refunded (seller fault, all units) and the total is EXACT ----------------------
do $$
declare
  a  text := '66666666-0000-0000-0000-000000000001';
  r2 uuid;
  v  jsonb;
  f  uuid;
begin
  r2 := t.passed(t.alice(), 'f_o1', jsonb_build_array(t.it(a, 1)), 'missing_item');
  perform t.as_user(t.admin());
  v := public.refund_calculate(r2);
  perform t.ok(((v -> 'lines') -> 0 ->> 'amount')::numeric = 472.22, 'the last unit of line A = its share 1416.67 minus the 944.45 already refunded = 472.22 (cumulative difference)');
  perform t.ok((v ->> 'shipping_eligible')::boolean and (v ->> 'seller_fault')::boolean, 'every unit is back and the reason is the seller''s fault: the shipping is eligible');
  perform t.ok(t.num(v, 'shipping_amount') = 49, 'the 49 shipping charge is included');
  perform t.ok(t.num(v, 'amount') = 521.22, '472.22 + 49 = 521.22');
  perform t.ok(t.num(v, 'refunded_so_far') = 1200 and t.num(v, 'refundable_remaining') = 549, 'the first refund (1200) is counted');
  -- the shipping can be left out on purpose
  perform t.ok(t.num(public.refund_calculate(r2, false), 'amount') = 472.22, 'the admin may decide not to refund the shipping');
  v := public.create_refund(r2, 'key-r2-razorpay-001', 'razorpay');
  f := (v ->> 'refund_id')::uuid;
  perform t.ok(t.num(v, 'amount') = 521.22, 'the refund = 521.22');
  perform t.eq((select gateway_state from public.refunds where id = f), 'not_sent', 'a gateway refund starts as "not sent"');
  -- 1200.00 + 521.22 = 1721.22: the part of 1749 that was not refunded is the 27.78 deduction. Never more than was paid:
  perform t.ok((select sum(amount) from public.refunds where order_id = 'f_o1' and status in ('pending', 'succeeded')) = 1721.22, 'all refunds of the order add up to 1721.22 <= 1749');
  perform t.as_postgres();
  perform t.eq(t.rstatus(f), 'pending', 'pending until the gateway says so');
end $$;

-- 6. the guards behind the functions (a direct write cannot get around them) ---------------------------------------------------------------------------------
do $$
declare
  r2 uuid := (select id from public.return_requests where order_id = 'f_o1' and status = 'refund_pending');
begin
  perform t.as_postgres();
  -- the cap: 1721.22 are in progress / paid of 1749, so another 30 is too much
  perform t.fails($q$insert into public.refunds (refund_no, order_id, kind, amount, items_amount, method, idempotency_key) values ('RFD-CAP1', 'f_o1', 'order', 30, 30, 'manual', 'key-cap-direct-0001')$q$, '23514', '%customer paid%');
  perform t.ok((select count(*) = 0 from public.refunds where refund_no = 'RFD-CAP1'), '... and nothing was written');
  perform t.ok(public.app_next_refund_no() ~ '^RFD-[0-9]{4}-[0-9]{6}$', 'the number generator works');
  -- a FAILED refund moved no money, so it does not count toward the cap ...
  insert into public.refunds (refund_no, order_id, kind, amount, items_amount, method, idempotency_key, status) values ('RFD-CAP2', 'f_o1', 'order', 100, 100, 'manual', 'key-cap-direct-0002', 'failed');
  perform t.ok(exists (select 1 from public.refunds where refund_no = 'RFD-CAP2'), 'a failed refund of 100 can exist although only 27.78 is left');
  -- ... and cannot be brought back to life beyond the cap
  perform t.fails($q$update public.refunds set status = 'pending' where refund_no = 'RFD-CAP2'$q$, '23514', '%customer paid%');
  delete from public.refunds where refund_no = 'RFD-CAP2';
  -- per-line quantity: the fixture line A has 3 units and all 3 are refunded or in progress - a 4th unit is refused
  insert into public.refunds (refund_no, order_id, kind, amount, items_amount, method, idempotency_key) values ('RFD-QTY', 'f_o1', 'order', 1, 1, 'manual', 'key-qty-direct-0001');
  perform t.fails($f$insert into public.refund_items (refund_id, order_item_id, quantity, amount) select r.id, '66666666-0000-0000-0000-000000000001', 1, 1 from public.refunds r where r.refund_no = 'RFD-QTY'$f$, '23514', '%than were ordered%');
  delete from public.refunds where refund_no = 'RFD-QTY';
  -- amount parts must add up
  perform t.fails($q$insert into public.refunds (refund_no, order_id, kind, amount, items_amount, method, idempotency_key) values ('RFD-BAD1', 'f_o2', 'order', 10, 5, 'manual', 'key-bad-parts-0001')$q$, '23514');
  perform t.fails($q$insert into public.refunds (refund_no, order_id, kind, amount, items_amount, method, idempotency_key) values ('RFD-BAD2', 'f_o2', 'order', 0, 0, 'manual', 'key-bad-zero-00001')$q$, '23514');
  perform t.fails($q$insert into public.refunds (refund_no, order_id, kind, amount, items_amount, method, gateway_refund_id, idempotency_key) values ('RFD-BAD3', 'f_o2', 'order', 10, 10, 'manual', 'rfnd_x', 'key-bad-gw-000001')$q$, '23514');
end $$;

-- 7. a refund that FAILS keeps the request at "refund pending" and can be retried -------------------------------------------------------------------------
do $$
declare
  c  uuid;
  f1 uuid;
  f2 uuid;
  v  jsonb;
begin
  c := t.passed(t.alice(), 'f_o2', jsonb_build_array(t.it('66666666-0000-0000-0000-000000000003', 2)), 'incorrect_size');
  perform t.as_user(t.admin());
  v := public.create_refund(c, 'key-c-first-000001', 'manual');
  f1 := (v ->> 'refund_id')::uuid;
  perform t.ok(t.num(v, 'amount') = 1000, 'a cash order refunded in full = 1000 (no shipping, no promo)');
  perform t.fails(format($q$select public.refund_void(%L, '')$q$, f1), '22023', '%Say why%');
  v := public.refund_mark_manual(f1, 'failed', null, 'The customer''s bank rejected the transfer');
  perform t.eq(v ->> 'status', 'failed', 'the admin recorded a failure');
  perform t.ok((select failure_reason = 'The customer''s bank rejected the transfer' and completed_at is null from public.refunds where id = f1), 'the customer-safe reason is stored');
  perform t.eq(t.status(c), 'refund_pending', 'a failed refund does not close the request');
  perform t.ok((select count(*) = 1 and bool_and(item_status = 'passed') from public.return_request_items where request_id = c), 'its line stays passed (not refunded)');
  perform t.as_postgres();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.alice() and title like 'Refund failed%' and data ->> 'refundId' = f1::text), 'the customer was told: refund failed - contact support');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.admin() and title = 'Refund failed'), 'the admins were told');
  perform t.as_user(t.admin());
  -- the retry is a NEW refund (new key); the failed one stays as history
  v := public.create_refund(c, 'key-c-retry-0000001', 'manual', null, 0, null, 'retry after the bank rejected it');
  f2 := (v ->> 'refund_id')::uuid;
  perform t.ok(f2 <> f1 and t.num(v, 'amount') = 1000, 'a retry creates a new refund for the same amount');
  perform t.eq((select count(*)::text from public.refunds where request_id = c), '2', 'two refund rows: the failed one and the retry');
  -- void the retry before anything is paid out
  v := public.refund_void(f2, 'the customer asked us to wait');
  perform t.eq(v ->> 'status', 'failed', 'a pending manual refund can be cancelled');
  perform t.ok((select failure_reason like 'Cancelled:%' from public.refunds where id = f2), 'with the reason');
  v := public.refund_void(f2, 'again');
  perform t.ok((v ->> 'already')::boolean, 'cancelling twice is a no-op');
  -- a third refund can still be created and paid
  v := public.create_refund(c, 'key-c-third-0000001', 'manual');
  v := public.refund_mark_manual((v ->> 'refund_id')::uuid, 'succeeded', 'UPI-ref-5521');
  perform t.eq(t.status(c), 'refunded', 'the request is refunded once a refund succeeded');
  perform t.as_postgres();
  perform t.ok((select count(*) = 1 from public.refunds where request_id = c and status = 'succeeded'), 'exactly one succeeded refund');
end $$;

-- 8. the gateway path (Razorpay): never sent twice, webhook events are idempotent and cannot regress a refund ----------------------------------------------------
do $$
declare
  g   uuid;
  f   uuid;
  v   jsonb;
  v2  jsonb;
begin
  g := t.passed(t.alice(), 'f_o4', jsonb_build_array(t.it('66666666-0000-0000-0000-000000000005', 2)), 'incorrect_size');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_refund(%L, 'key-g-cash-method-1', 'razorpay')$q$, (select id from public.return_requests where order_id = 'f_o2' and status = 'refunded' limit 1)), '22023');
  v := public.create_refund(g, 'key-g-razorpay-0001', 'razorpay');
  f := (v ->> 'refund_id')::uuid;
  perform t.ok(t.num(v, 'amount') = 1000, 'the full return of a 1000 order = 1000');

  -- nobody but the service role may touch the gateway steps
  perform t.fails(format($q$select public.refund_begin_gateway(%L)$q$, f), '42501');
  perform t.fails(format($q$select public.refund_record_gateway_result(%L, 'accepted', 'rfnd_1', 'pending')$q$, f), '42501');
  perform t.fails($q$select public.refund_apply_gateway_event('evt_1', 'rfnd_1', 'processed')$q$, '42501');
  perform t.as_anon();
  perform t.fails(format($q$select public.refund_begin_gateway(%L)$q$, f), '42501');
  perform t.as_service();

  v := public.refund_begin_gateway(f);
  perform t.ok((v ->> 'proceed')::boolean, 'the first claim may call the gateway');
  perform t.ok((v ->> 'amount_paise')::bigint = 100000 and v ->> 'razorpay_payment_id' = 'pay_T4' and v ->> 'currency' = 'INR', 'it sends 1000.00 INR = 100000 paise for the SAME payment');
  perform t.ok(v -> 'notes' ->> 'refund_id' = f::text and v ->> 'receipt' like 'RFD-%', 'our id travels in the gateway notes (so a lost answer can be matched later)');
  perform t.as_postgres();
  perform t.eq((select gateway_state from public.refunds where id = f), 'submitting', 'the refund is marked "submitting"');
  perform t.eq((select attempts::text from public.refund_private where refund_id = f), '1', 'one gateway call so far');
  perform t.as_service();
  v := public.refund_begin_gateway(f);
  perform t.ok(not (v ->> 'proceed')::boolean and v ->> 'reason' = 'ALREADY_SENT', 'a second claim is refused: the refund is NEVER sent twice');
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.refund_void(%L, 'x')$q$, f), '22023', '%already sent to the gateway%');
  perform t.fails(format($q$select public.refund_mark_manual(%L, 'succeeded', 'x')$q$, f), '22023', '%gateway refund follows the gateway%');
  perform t.as_service();

  -- the gateway accepted it (status pending): the refund waits for the webhook
  v := public.refund_record_gateway_result(f, 'accepted', 'rfnd_T4_001', 'pending');
  perform t.ok(v ->> 'status' = 'pending' and v ->> 'gateway_state' = 'submitted', 'accepted but still pending');
  perform t.as_postgres();
  perform t.ok((select gateway_refund_id = 'rfnd_T4_001' and gateway_status = 'pending' and reference = 'rfnd_T4_001' from public.refunds where id = f), 'the gateway reference is stored');
  perform t.as_service();

  -- webhook: refund.created (pending), then refund.processed
  v := public.refund_apply_gateway_event('evt_T4_created', 'rfnd_T4_001', 'created');
  perform t.ok((v ->> 'matched')::boolean and v ->> 'status' = 'pending', 'refund.created leaves it pending');
  v := public.refund_apply_gateway_event('evt_T4_processed', 'rfnd_T4_001', 'processed');
  perform t.ok((v ->> 'matched')::boolean and v ->> 'status' = 'succeeded', 'refund.processed completes it');
  perform t.as_postgres();
  perform t.eq(t.status(g), 'refunded', 'the request is Refunded');
  perform t.ok((select completed_at is not null from public.refunds where id = f), 'the completion time is stored');
  perform t.as_service();
  -- the same event again (Razorpay retries): nothing happens twice
  v2 := public.refund_apply_gateway_event('evt_T4_processed', 'rfnd_T4_001', 'processed');
  perform t.ok((v2 ->> 'duplicate')::boolean, 'a duplicate webhook event is recognised');
  -- a late / contradictory event cannot take a completed refund back
  v2 := public.refund_apply_gateway_event('evt_T4_failed_late', 'rfnd_T4_001', 'failed', 'weird');
  perform t.ok(v2 ->> 'status' = 'succeeded', 'a late "failed" event cannot regress a succeeded refund');
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.notifications where user_id = t.alice() and title = 'Your refund is complete' and data ->> 'requestId' = g::text), '1', 'the customer was told ONCE');
  perform t.eq((select count(*)::text from public.refund_events where provider = 'razorpay' and provider_event_id like 'evt_T4_%'), '3', 'each distinct event is in the audit trail once');
  -- an event for a refund we do not know (made in the Razorpay dashboard) is recorded, not applied
  perform t.as_service();
  v := public.refund_apply_gateway_event('evt_unknown_1', 'rfnd_not_ours', 'processed');
  perform t.ok(not (v ->> 'matched')::boolean, 'an unknown gateway refund is not matched');
  perform t.as_postgres();
  perform t.ok(exists (select 1 from public.refund_events where provider_event_id = 'evt_unknown_1' and refund_id is null), '... but it is kept in the audit trail');
end $$;

-- 9. the answer to the API call is lost: "unknown" -> the webhook finds the refund through the notes; a definitive rejection fails it ----------------------------
do $$
declare
  h  uuid;
  f  uuid;
  v  jsonb;
  h2 uuid;
  f2 uuid;
  f3 uuid;
begin
  h := t.passed(t.alice(), 'f_o5', jsonb_build_array(t.it('66666666-0000-0000-0000-000000000006', 1)), 'incorrect_size');
  perform t.as_user(t.admin());
  f := (public.create_refund(h, 'key-h-razorpay-0001', 'razorpay') ->> 'refund_id')::uuid;
  perform t.as_service();
  perform public.refund_begin_gateway(f);
  v := public.refund_record_gateway_result(f, 'unknown', null, null, 'timeout while calling Razorpay');
  perform t.eq(v ->> 'gateway_state', 'unknown', 'no answer: the state is "unknown" (the admin must check - never resend blindly)');
  perform t.eq(v ->> 'status', 'pending', 'the refund stays pending');
  v := public.refund_begin_gateway(f);
  perform t.ok(not (v ->> 'proceed')::boolean, 'an unknown refund cannot be re-sent');
  v := public.refund_gateway_context(f);
  perform t.ok(v ->> 'razorpay_payment_id' = 'pay_T5' and v ->> 'gateway_state' = 'unknown', 'the status check can see the payment id');
  perform t.as_postgres();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.admin() and title = 'Refund needs a status check'), 'the admins were told');
  perform t.ok((select gateway_error like 'timeout%' from public.refund_private where refund_id = f), 'the raw error is kept admin-only');
  perform t.as_service();
  -- the webhook arrives for a gateway id we never recorded: matched through notes.refund_id
  v := public.refund_apply_gateway_event('evt_T5_processed', 'rfnd_T5_001', 'processed', null, jsonb_build_object('refund_id', f::text));
  perform t.ok((v ->> 'matched')::boolean and v ->> 'status' = 'succeeded', 'matched through the id we put in the gateway notes');
  perform t.as_postgres();
  perform t.ok((select gateway_refund_id = 'rfnd_T5_001' and gateway_state = 'submitted' from public.refunds where id = f), 'and the gateway id was recorded');

  -- a definitive rejection (nothing was sent): failed, retryable with a new refund
  h2 := t.passed(t.bob(), 'f_o6', jsonb_build_array(t.it('66666666-0000-0000-0000-000000000007', 1)), 'incorrect_size');
  perform t.as_user(t.admin());
  f2 := (public.create_refund(h2, 'key-h2-razorpay-001', 'razorpay') ->> 'refund_id')::uuid;
  perform t.as_service();
  perform public.refund_begin_gateway(f2);
  v := public.refund_record_gateway_result(f2, 'rejected', null, null, 'The payment was already fully refunded');
  perform t.eq(v ->> 'status', 'failed', 'a definitive rejection fails the refund');
  perform t.as_postgres();
  perform t.ok((select failure_reason = 'The payment gateway could not process this refund' and gateway_state = 'not_sent' from public.refunds where id = f2), 'the customer reads a plain sentence; nothing was sent');
  perform t.ok((select gateway_error = 'The payment was already fully refunded' from public.refund_private where refund_id = f2), 'the gateway''s own wording stays admin-only');
  perform t.eq(t.status(h2), 'refund_pending', 'the request waits for a new attempt');
  -- and the failed gateway refund cannot be "accepted" into success by a stray late event? it can (the gateway is the authority) - only through a real event
  perform t.as_service();
  v := public.refund_apply_gateway_event('evt_T6_failed', 'rfnd_T6_x', 'failed', 'bank refused', jsonb_build_object('refund_id', f2::text));
  perform t.ok((v ->> 'matched')::boolean and v ->> 'status' = 'failed', 'a failed event on a failed refund is harmless');
  perform t.as_postgres();
  -- a retry that Razorpay itself fails later (webhook): the customer reads a plain sentence, the staff read the gateway's own words
  perform t.as_user(t.admin());
  f3 := (public.create_refund(h2, 'key-h2-retry-razorpay1', 'razorpay') ->> 'refund_id')::uuid;
  perform t.as_service();
  perform public.refund_begin_gateway(f3);
  perform public.refund_record_gateway_result(f3, 'accepted', 'rfnd_T6_002', 'pending');
  v := public.refund_apply_gateway_event('evt_T6_failed_2', 'rfnd_T6_002', 'failed', 'Customer''s bank account is closed');
  perform t.eq(v ->> 'status', 'failed', 'a failed event fails a pending gateway refund');
  perform t.as_postgres();
  perform t.ok((select failure_reason = 'The payment gateway could not complete this refund' from public.refunds where id = f3), 'the customer reads a plain sentence');
  perform t.ok((select gateway_error like '%bank account is closed%' from public.refund_private where refund_id = f3), 'the staff read the gateway''s own words');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.bob() and title like 'Refund failed%' and data ->> 'refundId' = f3::text), 'the customer was told: refund failed - contact support');
  -- the gateway is the authority: a "processed" event after that failure brings the refund back and completes the request
  perform t.as_service();
  v := public.refund_apply_gateway_event('evt_T6_processed_late', 'rfnd_T6_002', 'processed');
  perform t.eq(v ->> 'status', 'succeeded', 'a processed event after a failure completes the refund');
  perform t.as_postgres();
  perform t.eq(t.status(h2), 'refunded', '... and the request');
  perform t.ok((select count(*) = 1 from public.refunds where request_id = h2 and status = 'succeeded'), 'exactly one succeeded refund for the request');
end $$;

-- 10. who can read what ------------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r1 uuid := (select id from public.return_requests where order_id = 'f_o1' and status = 'refunded' limit 1);
begin
  perform t.as_user(t.alice());
  perform t.ok((select count(*) >= 4 from public.refunds), 'a customer sees her own refunds');
  perform t.ok((select count(*) >= 1 from public.refund_items), '... and their lines');
  perform t.eq((select count(*)::text from public.refund_private), '0', 'but never the staff notes');
  perform t.eq((select count(*)::text from public.refund_events), '0', '... nor the audit trail / gateway payloads');
  perform t.fails($q$insert into public.refunds (refund_no, order_id, amount, items_amount, method, idempotency_key) values ('RFD-HACK', 'f_o2', 1, 1, 'manual', 'key-hack-000000001')$q$, '42501');
  perform t.fails($q$update public.refunds set status = 'succeeded'$q$, '42501');
  perform t.fails($q$delete from public.refunds$q$, '42501');
  perform t.as_user(t.bob());
  perform t.ok((select count(*) = 2 and bool_and(order_id = 'f_o6') from public.refunds), 'Bob sees only his own refunds (the two of f_o6)');
  perform t.eq((select count(*)::text from public.refund_items where refund_id in (select id from public.refunds where order_id = 'f_o1')), '0', 'and none of Alice''s lines');
  perform t.as_anon();
  perform t.fails($q$select * from public.refunds$q$, '42501');
  perform t.as_user(t.admin());
  perform t.ok((select count(*) >= 6 from public.refunds), 'the admin sees every refund');
  perform t.ok((select count(*) >= 6 from public.refund_private), '... the staff notes');
  perform t.ok((select count(*) >= 10 from public.refund_events), '... and the audit trail');
  perform t.as_postgres();
end $$;

rollback;