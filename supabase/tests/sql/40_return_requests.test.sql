-- needs: m4
-- reapply: 20261017_04_return_requests.sql
-- Phase 6 — M4: eligibility (deadline rule at its boundary), request creation / cancellation / reply, evidence, privacy, storage policies.
-- ("reapply" = the runner applies the migration a SECOND time before this script: the idempotency test.)
begin;

-- the eligibility helper is not callable by API roles (by design): tests ask through this definer wrapper, whoever the session is
create or replace function t.elig(p_item uuid, p_type text, p_now timestamptz default now()) returns jsonb
language sql security definer as $$ select public.app_item_eligibility(p_item, p_type, p_now) $$;
-- this suite must not depend on the calendar day it runs on (create_return_request judges a delivery against the REAL clock):
-- "day 0" is three days ago in IST, and every instant compared with a fixture row is written as an offset from it:  t.at(<days>, '<clock>'[, '<zone>'])
-- (the pure deadline-function checks in section 1 keep literal dates: they never read the clock)
create or replace function t.day0() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date - 3 $$;
create or replace function t.at(p_days integer, p_clock text, p_zone text default 'Asia/Kolkata') returns timestamptz
language sql stable as $$ select ((t.day0() + p_days)::timestamp + p_clock::time) at time zone p_zone $$;
-- fixtures ----------------------------------------------------------------------------------------------------------------------
-- Alice's delivered order: a snapshot policy (7 days both), a line with returns switched off, and a legacy line without a snapshot
insert into public.orders (id, user_id, order_status, payment_status, customer_name, total, delivered_at, delivered_at_source, created_at) values
  ('q_o1', t.alice(), 'delivered', 'paid', 'Alice', 3000, t.at(0, '10:00'), 'shipment', t.at(-5, '10:00')),
  ('q_o2', t.bob(),   'delivered', 'paid', 'Bob',   500,  t.at(0, '10:00'), 'shipment', t.at(-5, '10:00')),
  ('q_o3', t.alice(), 'confirmed', 'paid', 'Alice', 500,  null, null, t.at(-5, '10:00')),
  ('q_o4', null,      'delivered', 'paid', 'Walk-in', 500, t.at(-70, '10:00'), 'born_delivered', t.at(-70, '10:00')),
  ('q_o5', t.alice(), 'delivered', 'paid', 'Alice', 1200, t.at(0, '10:00'), 'shipment', t.at(-5, '10:00')),
  ('q_o6', t.alice(), 'delivered', 'paid', 'Alice', 1000, t.at(0, '10:00'), 'shipment', t.at(-5, '10:00')),
  ('q_o7', t.alice(), 'delivered', 'paid', 'Alice', 500,  t.at(0, '10:00'), 'shipment', t.at(-5, '10:00'));
insert into public.order_items (id, order_id, product_id, variant_id, title, product_title, variant_name, quantity, unit_price, line_total,
                                return_enabled, return_window_days, exchange_enabled, exchange_window_days) values
  ('44444444-0000-0000-0000-000000000001', 'q_o1', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 3, 500, 1500, true,  7,    true,  7),
  ('44444444-0000-0000-0000-000000000002', 'q_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt [Pink]', 'Designer Shirt', 'Pink', 1, 300, 300, false, null, true, 7),
  ('44444444-0000-0000-0000-000000000003', 'q_o1', 'prod_vmain_ok', '', 'Designer Shirt', 'Designer Shirt', null, 2, 450, 900, null, null, null, null),
  ('44444444-0000-0000-0000-000000000004', 'q_o2', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 1, 500, 500, true, 7, true, 7),
  ('44444444-0000-0000-0000-000000000005', 'q_o3', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 1, 500, 500, true, 7, true, 7),
  ('44444444-0000-0000-0000-000000000006', 'q_o4', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 1, 500, 500, true, 7, true, 7),
  ('44444444-0000-0000-0000-000000000007', 'q_o5', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 2, 500, 1000, true, 7, true, 7),
  ('44444444-0000-0000-0000-000000000008', 'q_o5', 'gone_product',  '', 'Discontinued thing', 'Discontinued thing', null, 1, 200, 200, null, null, null, null),
  ('44444444-0000-0000-0000-000000000009', 'q_o6', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 2, 500, 1000, true, 7, true, 7),
  ('44444444-0000-0000-0000-000000000010', 'q_o7', 'prod_single_a', '', 'Classic Cotton Shirt', 'Classic Cotton Shirt', null, 1, 500, 500, true, 7, true, 7);

-- 1. the deadline rule, at its boundary -------------------------------------------------------------------------------------------
do $$
begin
  -- delivered 2026-10-10 10:00 IST, 7 days => valid through 2026-10-17 23:59:59.999 IST (= 18:29:59.999 UTC)
  perform t.eq(to_char(public.app_return_deadline('2026-10-10 10:00:00+05:30', 7) at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS.MS'), '2026-10-17 23:59:59.999', 'deadline = end of the 7th day after delivery (IST)');
  perform t.eq(to_char(public.app_return_deadline('2026-10-10 00:00:00+05:30', 7) at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), '2026-10-17', 'delivered at IST midnight: same day');
  perform t.eq(to_char(public.app_return_deadline('2026-10-09 23:59:59+05:30', 7) at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), '2026-10-16', 'one second before IST midnight: the previous calendar day counts');
  perform t.eq(to_char(public.app_return_deadline('2026-10-09 19:00:00+00', 7) at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), '2026-10-17', '19:00 UTC is already the next day in IST');
  perform t.ok(public.app_return_deadline(null, 7) is null and public.app_return_deadline(now(), null) is null, 'no date or no window -> no deadline');

  -- (the fixtures are delivered on day 0 at 10:00 IST, so the last valid instant is day 7 at 23:59:59.999 IST = 18:29:59.999 UTC)
  perform t.eq(t.elig('44444444-0000-0000-0000-000000000001', 'return', t.at(7, '18:29:59.999', 'UTC')) ->> 'eligible', 'true', 'eligible at the last millisecond');
  perform t.eq(t.elig('44444444-0000-0000-0000-000000000001', 'return', t.at(7, '18:30:00', 'UTC')) ->> 'eligible', 'false', 'expired one millisecond later');
  perform t.ok((t.elig('44444444-0000-0000-0000-000000000001', 'return', t.at(7, '18:30:00', 'UTC')) -> 'reasons') ? 'WINDOW_EXPIRED', 'with the reason code WINDOW_EXPIRED');
  perform t.eq(t.elig('44444444-0000-0000-0000-000000000001', 'return', t.at(0, '12:00', 'UTC')) ->> 'remaining_qty', '3', 'all 3 units are still open');
  perform t.eq(t.elig('44444444-0000-0000-0000-000000000001', 'return') -> 'deadline' #>> '{}', t.elig('44444444-0000-0000-0000-000000000001', 'return') ->> 'deadline', 'the deadline is returned as a timestamp');
end $$;

-- 2. effective policy: snapshot -> variant -> product -> store default ---------------------------------------------------------------------
do $$
declare
  p jsonb;
begin
  p := public.app_item_policy('44444444-0000-0000-0000-000000000002');
  perform t.eq(p ->> 'returnEnabled', 'false', 'a snapshot with returns OFF wins');
  perform t.eq(p ->> 'returnSource', 'snapshot', 'source = snapshot');
  perform t.eq(p ->> 'exchangeWindowDays', '7', 'the exchange side is independent');
  perform t.ok(p -> 'returnWindowDays' = 'null'::jsonb, 'a disabled side has no window');

  -- a legacy line (no snapshot) follows the CURRENT product; the seeded product has the column defaults (true / 7)
  p := public.app_item_policy('44444444-0000-0000-0000-000000000003');
  perform t.eq(p ->> 'returnSource', 'product', 'no snapshot -> the current product');
  perform t.eq(p ->> 'returnWindowDays', '7', 'product default window');
  update public.products set return_window_days = 14, exchange_enabled = false, exchange_window_days = null where id = 'prod_vmain_ok';
  p := public.app_item_policy('44444444-0000-0000-0000-000000000003');
  perform t.eq(p ->> 'returnWindowDays', '14', 'a product change reaches legacy lines');
  perform t.eq(p ->> 'exchangeEnabled', 'false', '... on both sides');
  -- a variant override sits between the snapshot and the product (only for lines whose snapshot is empty)
  update public.order_items set variant_id = 'var_1700000000001_1', return_enabled = null, return_window_days = null, exchange_enabled = null, exchange_window_days = null
   where id = '44444444-0000-0000-0000-000000000003';
  update public.product_variants set return_enabled = true, return_window_days = 3 where id = 'var_1700000000001_1';
  p := public.app_item_policy('44444444-0000-0000-0000-000000000003');
  perform t.eq(p ->> 'returnSource', 'variant', 'the variant override wins over the product');
  perform t.eq(p ->> 'returnWindowDays', '3', 'with the variant window');
  update public.order_items set variant_id = '' where id = '44444444-0000-0000-0000-000000000003';
  update public.products set return_window_days = 7, exchange_enabled = true, exchange_window_days = 7 where id = 'prod_vmain_ok';
  -- a deleted product falls back to the store defaults
  p := public.app_item_policy('44444444-0000-0000-0000-000000000008');
  perform t.eq(p ->> 'returnSource', 'store', 'a line whose product no longer exists -> store default');
  update public.settings set data = '{"returnEnabled":true,"returnWindowDays":10,"exchangeEnabled":false,"exchangeWindowDays":null}' where id = 'returnPolicyDefaults';
  p := public.app_item_policy('44444444-0000-0000-0000-000000000008');
  perform t.eq(p ->> 'returnWindowDays', '10', 'the store default window is read from settings');
  perform t.eq(p ->> 'exchangeEnabled', 'false', 'and its switches');
  update public.settings set data = '{"returnEnabled":true,"returnWindowDays":7,"exchangeEnabled":true,"exchangeWindowDays":7}' where id = 'returnPolicyDefaults';
end $$;

-- 3. eligibility reason codes ----------------------------------------------------------------------------------------------------------------
do $$
declare
  e jsonb;
begin
  e := t.elig('44444444-0000-0000-0000-000000000002', 'return', t.at(2, '00:00', 'UTC'));
  perform t.ok(not (e ->> 'eligible')::boolean and (e -> 'reasons') ? 'POLICY_DISABLED', 'returns OFF on this line: POLICY_DISABLED');
  e := t.elig('44444444-0000-0000-0000-000000000002', 'exchange', t.at(2, '00:00', 'UTC'));
  perform t.ok((e ->> 'eligible')::boolean, 'but the same line can be exchanged');
  e := t.elig('44444444-0000-0000-0000-000000000005', 'return');
  perform t.ok((e -> 'reasons') ? 'NOT_DELIVERED', 'an undelivered order: NOT_DELIVERED');
  -- "delivered without a date" cannot be produced through the guard / delivered_at triggers any more; switch them off to prove the defence anyway
  set local session_replication_role = replica;
  update public.orders set order_status = 'delivered' where id = 'q_o3';
  e := t.elig('44444444-0000-0000-0000-000000000005', 'return');
  perform t.ok((e -> 'reasons') ? 'NO_DELIVERY_DATE', 'delivered without a date (should not exist): NO_DELIVERY_DATE');
  update public.orders set order_status = 'confirmed' where id = 'q_o3';
  set local session_replication_role = origin;
  e := t.elig('44444444-0000-0000-0000-000000000006', 'return', t.at(7, '00:00', 'UTC'));
  perform t.ok((e -> 'reasons') ? 'WINDOW_EXPIRED', 'an old delivery: WINDOW_EXPIRED');
  e := t.elig('44444444-0000-0000-0000-000000000001', 'return', t.at(2, '00:00', 'UTC'));
  perform t.ok((e ->> 'eligible')::boolean and e -> 'reasons' = '[]'::jsonb, 'an open, enabled, unrequested line is eligible with no reasons');
  perform t.ok(t.elig(gen_random_uuid(), 'return') is null, 'an unknown line -> null');
end $$;

-- 4. get_order_eligibility: who may ask ---------------------------------------------------------------------------------------------------------
do $$
declare
  e jsonb;
begin
  perform t.as_user(t.alice());
  e := public.get_order_eligibility('q_o1');
  perform t.eq(e ->> 'order_status', 'delivered', 'the owner gets her order');
  perform t.ok(jsonb_array_length(e -> 'items') = 3, 'with every line');
  perform t.ok((e -> 'items' -> 0 -> 'return' ->> 'remaining_qty') is not null and (e -> 'items' -> 0 -> 'exchange') is not null, 'each line carries return AND exchange verdicts');
  perform t.fails($q$select public.get_order_eligibility('q_o2')$q$, 'P0002', 'Order not found');     -- Bob's order: same answer as for a missing one
  perform t.fails($q$select public.get_order_eligibility('no_such')$q$, 'P0002');
  perform t.as_anon();
  perform t.fails($q$select public.get_order_eligibility('q_o1')$q$, '42501');
  perform t.as_user(t.admin());
  perform t.eq(public.get_order_eligibility('q_o2') ->> 'order_id', 'q_o2', 'an admin can ask about any order');
  perform t.as_user(t.bob());
  perform t.fails($q$select public.app_item_eligibility('44444444-0000-0000-0000-000000000001', 'return')$q$, '42501');     -- internal helper: not callable by customers
  perform t.as_postgres();
end $$;

-- 5. creating a request ------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_id  uuid := gen_random_uuid();
  v_r   jsonb;
  v_n   integer;
  q     public.return_requests;
  v_stock0 text := (select stock::text from public.products where id = 'prod_single_a');       -- the inventory rule: a request never touches stock
  v_logs0  text := (select count(*)::text from public.inventory_logs);
begin
  perform t.as_user(t.alice());
  v_r := public.create_return_request(v_id, 'q_o1', 'return',
           '[{"order_item_id":"44444444-0000-0000-0000-000000000001","quantity":2,"condition":"opened"}]'::jsonb, 'incorrect_size', 'It is too small', '+91 98765 43210');
  perform t.ok((v_r ->> 'created')::boolean, 'the request was created');
  perform t.ok(v_r ->> 'request_no' ~ '^RET-[0-9]{4}-[0-9]{6}$', 'request number RET-YYYY-NNNNNN');
  perform t.eq(v_r ->> 'status', 'pending_review', 'status = Pending Review (never auto-approved, never refunded)');
  select * into q from public.return_requests where id = v_id;
  perform t.ok(q.user_id = t.alice() and q.type = 'return' and q.delivered_at = t.at(0, '10:00'), 'owner, type and the delivery snapshot are stored');
  perform t.eq(q.contact_phone, '+91 98765 43210', 'the contact phone is stored');
  perform t.eq((select quantity::text || '/' || unit_price::text || '/' || item_status from public.return_request_items where request_id = v_id), '2/500/pending', 'the item, quantity and the PURCHASE price snapshot');
  perform t.ok((select policy_deadline from public.return_request_items where request_id = v_id) = t.at(7, '23:59:59.999'), 'the policy deadline is stored per line');
  perform t.eq((select count(*)::text from public.return_request_events where request_id = v_id and to_status = 'pending_review'), '1', 'the audit trail starts with the submission');
  perform t.as_postgres();
  perform t.eq((select stock::text from public.products where id = 'prod_single_a'), v_stock0, 'submitting a request does NOT change sellable stock');
  perform t.eq((select count(*)::text from public.inventory_logs), v_logs0, '... and writes no inventory ledger row');
  perform t.ok(exists (select 1 from public.return_request_private where request_id = v_id), 'the admin-only row exists');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.admin() and data ->> 'requestId' = v_id::text), 'the admin was notified');
  perform t.as_user(t.alice());

  -- the same request id again (double click / lost response) returns it
  v_r := public.create_return_request(v_id, 'q_o1', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000001","quantity":2}]'::jsonb, 'incorrect_size');
  perform t.ok(not (v_r ->> 'created')::boolean, 'a retry is idempotent');
  perform t.eq((select count(*)::text from public.return_requests where order_id = 'q_o1'), '1', 'still one request');
  perform t.as_user(t.bob());
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o2', 'return', '[]'::jsonb, 'other')$q$, v_id), 'P0002');   -- someone else's request id

  -- the line is now busy: one request in progress per line
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o1', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000001","quantity":1}]'::jsonb, 'incorrect_size')$q$, gen_random_uuid()),
                  '22023', '%ACTIVE_REQUEST%');
  perform t.as_postgres();
  -- ... and the database itself refuses a second active item on the line (the race a UI cannot prevent)
  perform t.fails(format($f$insert into public.return_request_items (request_id, order_item_id, quantity, unit_price) values (%L, '44444444-0000-0000-0000-000000000001', 1, 500)$f$, v_id), '23505');
  -- remaining units shown to the screens: 3 - 2 = 1, but the line is blocked meanwhile
  perform t.eq(t.elig('44444444-0000-0000-0000-000000000001', 'return', t.at(2, '00:00', 'UTC')) ->> 'remaining_qty', '1', 'remaining quantity = ordered - requested');
  perform t.ok((t.elig('44444444-0000-0000-0000-000000000001', 'return', t.at(2, '00:00', 'UTC')) -> 'reasons') ? 'ACTIVE_REQUEST', 'the line reports ACTIVE_REQUEST while the request is open');
end $$;

-- 6. validation table ------------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r record;
  v_sql text;
begin
  perform t.as_user(t.alice());
  for r in
    select * from (values
      ('type must be return or exchange',        'q_o5', 'swap',     '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]', 'incorrect_size', null, '%return or exchange%'),
      ('no items',                               'q_o5', 'return',   '[]', 'incorrect_size', null, '%at least one item%'),
      ('items not an array',                     'q_o5', 'return',   '{"a":1}', 'incorrect_size', null, '%at least one item%'),
      ('unknown reason',                         'q_o5', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]', 'nope', null, '%reason%'),
      ('quantity zero',                          'q_o5', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":0}]', 'incorrect_size', null, '%at least 1%'),
      ('quantity above what is left',            'q_o5', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":3}]', 'incorrect_size', null, 'Only 2 unit(s)%'),
      ('same line twice',                        'q_o5', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1},{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]', 'incorrect_size', null, '%twice%'),
      ('a line of ANOTHER order',                'q_o5', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000001","quantity":1}]', 'incorrect_size', null, '%does not belong%'),
      ('garbage item id',                        'q_o5', 'return',   '[{"order_item_id":"zzz","quantity":1}]', 'incorrect_size', null, '%valid order_item_id%'),
      ('a delivered order is required',          'q_o3', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000005","quantity":1}]', 'incorrect_size', null, '%delivered order%'),
      ('expired window',                         'q_o4', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000006","quantity":1}]', 'incorrect_size', null, '%WINDOW_EXPIRED%'),
      ('returns switched off on the line',       'q_o1', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000002","quantity":1}]', 'incorrect_size', null, '%POLICY_DISABLED%'),
      ('a reason that needs a description',      'q_o5', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]', 'missing_item', null, '%describe the problem%'),
      ('a reason that needs a photo',            'q_o5', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]', 'damaged', 'it broke', '%at least one photo%'),
      ('bad phone number',                       'q_o5', 'return',   '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]', 'incorrect_size', null, '%phone%')
    ) as v(label, order_id, typ, items, reason, descr, expect_like)
  loop
    v_sql := format('select public.create_return_request(%L, %L, %L, %L::jsonb, %L, %L, %L)', gen_random_uuid(), r.order_id, r.typ, r.items, r.reason, r.descr, case when r.label = 'bad phone number' then 'call me' else null end);
    perform t.fails(v_sql, null, r.expect_like);
  end loop;
  perform t.eq((select count(*)::text from public.return_requests where order_id in ('q_o3', 'q_o4', 'q_o5')), '0', 'no failed attempt left a row behind');
  -- someone else's order, and an order that does not exist: the same answer
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o2', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000004","quantity":1}]'::jsonb, 'incorrect_size')$q$, gen_random_uuid()), 'P0002', 'Order not found');
  perform t.fails(format($q$select public.create_return_request(%L, 'no_such', 'return', '[]'::jsonb, 'incorrect_size')$q$, gen_random_uuid()), 'P0002', 'Order not found');
  perform t.as_anon();
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o5', 'return', '[]'::jsonb, 'incorrect_size')$q$, gen_random_uuid()), '42501');
  perform t.as_user(t.alice());
  -- a non-admin cannot waive the rules
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o4', 'return', '[]'::jsonb, 'incorrect_size', null, null, '[]'::jsonb, true)$q$, gen_random_uuid()), '42501', '%administrator%');
  -- a reason that only fits one type
  perform t.as_postgres();
  update public.request_reasons set applies_to = array['return'] where code = 'incorrect_color';
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o5', 'exchange', '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]'::jsonb, 'incorrect_color')$q$, gen_random_uuid()), '22023', '%does not apply%');
  perform t.as_postgres();
  update public.request_reasons set applies_to = array['return', 'exchange'] where code = 'incorrect_color';
end $$;

-- 7. evidence: own folder of THIS request, JPEG / PNG / WebP, 5 MB, at most 6 --------------------------------------------------------------------------
do $$
declare
  v_id  uuid := gen_random_uuid();
  v_ok  text;
  v_r   jsonb;
begin
  perform t.as_user(t.alice());
  v_ok := t.alice()::text || '/' || v_id::text || '/photo1.jpg';
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o5', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, format('[{"path":"%s/%s/x.jpg","mime":"image/jpeg","size":1000}]', t.bob(), v_id)), '22023', '%not in your folder%');
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o5', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, format('[{"path":"%s/%s/x.jpg","mime":"image/jpeg","size":1000}]', t.alice(), gen_random_uuid())), '22023', '%not in your folder%');      -- another request's folder
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o5', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, format('[{"path":"%s","mime":"application/pdf","size":1000}]', v_ok)), '22023', '%JPEG, PNG or WebP%');
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o5', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, format('[{"path":"%s","mime":"image/jpeg","size":6000000}]', v_ok)), '22023', '%5 MB%');
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o5', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, format('[{"path":"%s/../x.jpg","mime":"image/jpeg","size":1000}]', t.alice())), '22023');
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o5', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, (select jsonb_agg(jsonb_build_object('path', t.alice()::text || '/' || v_id::text || '/p' || g || '.jpg', 'mime', 'image/jpeg', 'size', 1000))::text from generate_series(1, 7) g)), '54000', '%At most 6%');
  perform t.eq((select count(*)::text from public.return_requests where id = v_id), '0', 'a rejected submission leaves nothing behind');
  v_r := public.create_return_request(v_id, 'q_o5', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000007","quantity":1}]'::jsonb, 'damaged', 'cracked', null,
           format('[{"path":"%s","mime":"image/jpeg","size":120000},{"path":"%s/%s/p2.webp","mime":"image/webp","size":50000}]', v_ok, t.alice(), v_id)::jsonb);
  perform t.ok((v_r ->> 'created')::boolean, 'a request with two valid photos is accepted');
  perform t.eq((select count(*)::text from public.return_request_evidence where request_id = v_id), '2', 'both photos are recorded');
  -- the customer can read her evidence rows, nobody else's
  perform t.eq((select count(*)::text from public.return_request_evidence), '2', 'the owner sees her photos');
  perform t.as_user(t.bob());
  perform t.eq((select count(*)::text from public.return_request_evidence), '0', 'another customer sees none');
  perform t.eq((select count(*)::text from public.return_requests), '0', '... nor the request');
  perform t.eq((select count(*)::text from public.return_request_items), '0', '... nor its items');
  perform t.eq((select count(*)::text from public.return_request_events), '0', '... nor its history');
  perform t.as_user(t.alice());
  perform t.eq((select count(*)::text from public.return_request_private), '0', 'the owner never sees the admin-only side');
  perform t.as_user(t.admin());
  perform t.ok((select count(*) from public.return_request_private) >= 1 and (select count(*) from public.return_request_evidence) >= 2, 'the admin sees everything');
  perform t.as_postgres();
end $$;

-- 8. exchange ------------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_id uuid := gen_random_uuid();
  v_r  jsonb;
  i    public.return_request_items;
begin
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o1', 'exchange', '[{"order_item_id":"44444444-0000-0000-0000-000000000002","quantity":1,"replacement_variant_id":"var_missing"}]'::jsonb, 'incorrect_size')$q$, gen_random_uuid()), '22023', '%replacement variant%');
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o1', 'exchange', '[{"order_item_id":"44444444-0000-0000-0000-000000000002","quantity":1,"replacement_product_id":"prod_single_a"}]'::jsonb, 'incorrect_size')$q$, gen_random_uuid()), '22023', '%same product%');
  v_r := public.create_return_request(v_id, 'q_o1', 'exchange', '[{"order_item_id":"44444444-0000-0000-0000-000000000002","quantity":1,"replacement_variant_id":"var_1700000000001_1"}]'::jsonb, 'incorrect_color');
  perform t.ok(v_r ->> 'request_no' ~ '^EXC-[0-9]{4}-[0-9]{6}$', 'an exchange gets an EXC- number');
  select * into i from public.return_request_items where request_id = v_id;
  perform t.eq(i.replacement_variant_id, 'var_1700000000001_1', 'the requested replacement variant is stored');
  perform t.eq(i.replacement_product_id, 'prod_vmain_ok', 'on the same product');
  perform t.eq(i.replacement_qty::text, '1', 'one for one');
  perform t.eq(i.price_difference::text, '-100.00', 'the price difference is an ESTIMATE: replacement (White 200) - purchased (Pink 300)');
  -- the same item again (a defective unit) needs no replacement_variant: it defaults to the purchased option
  perform t.as_postgres();
  update public.return_request_items set item_status = 'cancelled' where request_id = v_id;
  update public.return_requests set status = 'cancelled' where id = v_id;
  perform t.as_user(t.alice());
  v_r := public.create_return_request(gen_random_uuid(), 'q_o1', 'exchange', '[{"order_item_id":"44444444-0000-0000-0000-000000000002","quantity":1}]'::jsonb, 'incorrect_size');
  perform t.eq((select replacement_variant_id from public.return_request_items where request_id = (v_r ->> 'request_id')::uuid), 'var_1700000000001_0', 'no replacement given: the same option again');
  perform t.as_postgres();
end $$;

-- 9. cancelling, replying, and the admin override --------------------------------------------------------------------------------------------------------------
do $$
declare
  v_id uuid := gen_random_uuid();
  v_r  jsonb;
begin
  perform t.as_user(t.alice());
  v_r := public.create_return_request(v_id, 'q_o6', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000009","quantity":2}]'::jsonb, 'incorrect_size');
  perform t.eq(t.elig('44444444-0000-0000-0000-000000000009', 'return', t.at(2, '00:00', 'UTC')) ->> 'remaining_qty', '0', 'both units are tied up');
  perform t.as_user(t.bob());
  perform t.fails(format($q$select public.cancel_return_request(%L)$q$, v_id), 'P0002');
  perform t.as_user(t.alice());
  v_r := public.cancel_return_request(v_id, 'changed my mind');
  perform t.eq(v_r ->> 'status', 'cancelled', 'the customer cancelled the request');
  perform t.eq((select item_status from public.return_request_items where request_id = v_id), 'cancelled', 'its line is released');
  perform t.eq(t.elig('44444444-0000-0000-0000-000000000009', 'return', t.at(2, '00:00', 'UTC')) ->> 'remaining_qty', '2', 'the units are available again');
  perform t.ok((public.cancel_return_request(v_id) ->> 'already')::boolean, 'cancelling twice is a no-op');
  perform t.fails(format($q$select public.respond_to_request(%L, 'hello')$q$, v_id), '22023', '%not waiting%');
  v_r := public.create_return_request(gen_random_uuid(), 'q_o6', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000009","quantity":1}]'::jsonb, 'incorrect_size');
  perform t.ok((v_r ->> 'created')::boolean, 'a new request on the freed line works');

  -- reply to "we need more information"
  perform t.as_postgres();
  update public.return_requests set status = 'needs_info', customer_note = 'Which size did you order?' where id = (v_r ->> 'request_id')::uuid;
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.respond_to_request(%L, '')$q$, (v_r ->> 'request_id')::uuid), '22023', '%message or add a photo%');
  v_r := public.respond_to_request((v_r ->> 'request_id')::uuid, 'Size M, the label says S');
  perform t.eq(v_r ->> 'status', 'pending_review', 'the answer puts the request back in review');
  perform t.ok(exists (select 1 from public.return_request_events where note = 'Size M, the label says S' and actor_role = 'customer'), 'the answer is in the history');
  perform t.as_user(t.bob());
  perform t.fails(format($q$select public.respond_to_request(%L, 'x')$q$, gen_random_uuid()), 'P0002');

  -- an admin creating a request for a walk-in (guest) order, past the window, with the rules waived
  perform t.as_user(t.admin());
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o4', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000006","quantity":1}]'::jsonb, 'incorrect_size')$q$, gen_random_uuid()), '22023', '%WINDOW_EXPIRED%');
  v_r := public.create_return_request(gen_random_uuid(), 'q_o4', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000006","quantity":1}]'::jsonb, 'incorrect_size', 'goodwill', null, '[]'::jsonb, true);
  perform t.ok((v_r ->> 'created')::boolean, 'an administrator can waive the window for a guest order');
  perform t.ok((select user_id is null from public.return_requests where id = (v_r ->> 'request_id')::uuid), 'the request has no customer account');
  perform t.ok(exists (select 1 from public.return_request_events where request_id = (v_r ->> 'request_id')::uuid and internal and note like '%waived%'), 'and the waiver is logged as an internal event');
  -- ... but quantity / duplicate-line rules cannot be waived
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o4', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000006","quantity":1}]'::jsonb, 'incorrect_size', null, null, '[]'::jsonb, true)$q$, gen_random_uuid()), '22023', '%ACTIVE_REQUEST%');
  perform t.as_postgres();
end $$;

-- 10. direct writes are refused; reasons are configurable ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  perform t.as_user(t.alice());
  perform t.fails($q$insert into public.return_requests (id, request_no, order_id, user_id, type, reason_code) values (gen_random_uuid(), 'RET-X', 'q_o1', null, 'return', 'other')$q$, '42501');
  perform t.fails($q$update public.return_requests set status = 'refunded'$q$, '42501');
  perform t.fails($q$delete from public.return_requests$q$, '42501');
  perform t.fails($q$update public.return_request_items set item_status = 'passed'$q$, '42501');
  perform t.fails($q$insert into public.return_request_events (request_id, actor_role) values (gen_random_uuid(), 'admin')$q$, '42501');
  perform t.fails($q$insert into public.request_status_transitions values ('return', 'pending_review', 'refunded', 'customer')$q$, '42501');
  perform t.ok((select count(*) from public.request_reasons) >= 8, 'a customer can read the reason list');
  update public.request_reasons set label = 'hacked' where code = 'other';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'but cannot change it');
  perform t.as_user(t.admin());
  insert into public.request_reasons (code, label, applies_to, requires_evidence) values ('wrong_colour_shade', 'Colour shade is different', array['return', 'exchange'], true);
  update public.request_reasons set active = false where code = 'other';
  perform t.as_user(t.alice());
  perform t.ok(exists (select 1 from public.request_reasons where code = 'wrong_colour_shade'), 'a new reason appears for customers');
  perform t.ok(not exists (select 1 from public.request_reasons where code = 'other'), 'a switched-off reason disappears');
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o6', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000009","quantity":1}]'::jsonb, 'other', 'x')$q$, gen_random_uuid()), '22023', '%reason%');
  perform t.as_postgres();
end $$;

-- 11. the private evidence bucket: policies (a stub of Supabase Storage stands in for the real one) -----------------------------------------------------
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid, metadata jsonb, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, delete on storage.objects to authenticated;
select public.app_setup_return_evidence_storage();
select public.app_setup_return_evidence_storage();      -- re-running is harmless

do $$
declare
  v_id uuid := gen_random_uuid();
  v_n  integer;
  v_p  text;
  v_r  jsonb;
begin
  perform t.ok((select not public from storage.buckets where id = 'return-evidence'), 'the bucket is PRIVATE');
  perform t.eq((select file_size_limit::text from storage.buckets where id = 'return-evidence'), '5242880', '5 MB limit');
  perform t.eq((select array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'return-evidence'), 'image/jpeg,image/png,image/webp', 'images only');
  perform t.eq((select count(*)::text from pg_policies where schemaname = 'storage' and policyname like 'return evidence:%'), '5', 'five policies, created once');

  v_p := t.alice()::text || '/' || v_id::text || '/a.jpg';
  perform t.as_user(t.alice());
  insert into storage.objects (bucket_id, name, owner, metadata) values ('return-evidence', v_p, t.alice(), '{"mimetype":"image/jpeg","size":1234}');
  perform t.ok(true, 'a customer can upload into her own folder');
  perform t.fails(format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('return-evidence', '%s/x/a.jpg', %L, '{}')$q$, t.bob(), t.alice()), '42501');
  perform t.ok((select count(*) from storage.objects where bucket_id = 'return-evidence') = 1, 'she reads her own file');
  perform t.as_user(t.bob());
  perform t.ok((select count(*) from storage.objects where bucket_id = 'return-evidence') = 0, 'another customer cannot see it');
  perform t.as_user(t.admin());
  perform t.ok((select count(*) from storage.objects where bucket_id = 'return-evidence') = 1, 'an admin can read every customer''s evidence');

  -- the RPC checks the object really is in storage, and its stored type / size
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o7', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000010","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, format('[{"path":"%s/%s/missing.jpg","mime":"image/jpeg","size":10}]', t.alice(), v_id)), '22023', '%was not uploaded%');
  perform t.as_postgres();
  insert into storage.objects (bucket_id, name, owner, metadata) values ('return-evidence', t.alice()::text || '/' || v_id::text || '/big.jpg', t.alice(), '{"mimetype":"image/jpeg","size":9999999}');
  insert into storage.objects (bucket_id, name, owner, metadata) values ('return-evidence', t.alice()::text || '/' || v_id::text || '/doc.jpg', t.alice(), '{"mimetype":"application/pdf","size":100}');
  perform t.as_user(t.alice());
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o7', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000010","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, format('[{"path":"%s/%s/big.jpg"}]', t.alice(), v_id)), '22023', '%5 MB%');
  perform t.fails(format($q$select public.create_return_request(%L, 'q_o7', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000010","quantity":1}]'::jsonb, 'damaged', 'cracked', null, %L::jsonb)$q$,
                         v_id, format('[{"path":"%s/%s/doc.jpg"}]', t.alice(), v_id)), '22023', '%JPEG, PNG or WebP%');
  v_r := public.create_return_request(v_id, 'q_o7', 'return', '[{"order_item_id":"44444444-0000-0000-0000-000000000010","quantity":1}]'::jsonb, 'damaged', 'cracked', null, format('[{"path":"%s"}]', v_p)::jsonb);
  perform t.ok((v_r ->> 'created')::boolean, 'with the real object in storage the request is accepted (type and size come from storage)');
  perform t.eq((select mime || '/' || size_bytes from public.return_request_evidence where request_id = v_id), 'image/jpeg/1234', 'the stored metadata, not the client claim, is recorded');

  -- evidence of a SUBMITTED request cannot be deleted by the customer; an unsubmitted upload can
  delete from storage.objects where name = v_p;
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'a submitted photo cannot be deleted by its owner');
  perform t.as_postgres();
  insert into storage.objects (bucket_id, name, owner, metadata) values ('return-evidence', t.alice()::text || '/' || gen_random_uuid()::text || '/orphan.jpg', t.alice(), '{}');
  perform t.as_user(t.alice());
  delete from storage.objects where name like '%/orphan.jpg';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '1', 'an upload that never became a request can be cleaned up');
  perform t.as_postgres();
end $$;

rollback;