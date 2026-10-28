-- needs: m8
-- reapply: 20261018_02_security_hardening.sql
-- Phase 13 — the BEHAVIOURAL access matrix (TESTING_CHECKLIST A7 / A8 / A9). Two customers (Alice, Bob) each get a complete world built with the REAL RPCs - a delivered order with
-- a tracked shipment, a return request with evidence taken through approval / receipt / inspection to a recorded refund, an exchange taken to "replacement pending" (reserved
-- stock, fulfilment record, price-difference record), a cancelled and refunded order - plus one payment exception, an import batch and an inactive courier / reason / variant.
-- Then, for EVERY table that holds customer or staff data, as Alice, as Bob, as an anonymous visitor and as the admin:
--   * a customer sees EXACTLY her own rows (the count equals what the database holds for her - no leak, nothing hidden), never the other customer's;
--   * staff-only tables are empty for every customer and full for the admin;  anon is refused (42501) or sees nothing;
--   * nobody - customer or admin - can INSERT / UPDATE / DELETE a row directly: the RPCs are the only door.
-- And the cross-customer RPC attempts: Bob acting on Alice's request / order is refused, and a request id cannot be hijacked to read someone else's request.
-- ("reapply" = M8 is applied a SECOND time first.)
begin;

create or replace function t.sale(p_product text, p_variant text, p_qty int, p_unit numeric) returns jsonb language sql as $$
  select jsonb_build_object('product_id', p_product, 'variant_id', nullif(p_variant, ''), 'variant_name', null, 'title', 'Item ' || p_product, 'quantity', p_qty, 'unit_price', p_unit,
                            'discount', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'line_total', p_qty * p_unit)
$$;
create or replace function t.place(p_id text, p_user uuid, p_items jsonb) returns void
language plpgsql as $$
declare v_total numeric;
begin
  select coalesce(sum((e.value ->> 'line_total')::numeric), 0) into v_total from jsonb_array_elements(p_items) e;
  perform public.create_order_tx(p_order_id := p_id, p_user_id := p_user, p_items := p_items, p_order_status := 'placed', p_payment_status := 'paid',
    p_payment_method := 'Razorpay', p_source := 'online', p_customer_name := 'T', p_customer_email := 't@example.test', p_customer_phone := '9999999999', p_address := '{}'::jsonb,
    p_subtotal := v_total, p_shipping := 0, p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := v_total,
    p_razorpay_order_id := 'rzp_' || p_id, p_razorpay_payment_id := 'pay_' || p_id);
end $$;
create or replace function t.delivered_order(p_id text, p_user uuid, p_items jsonb) returns void
language plpgsql as $$
begin
  perform t.place(p_id, p_user, p_items);
  perform t.as_user(t.admin());
  perform public.ship_order(p_id, 'manual', 'TRK-' || p_id);
  perform public.mark_delivered(p_id);
  perform t.as_postgres();
end $$;
create or replace function t.line_id(p_order text) returns text language sql security definer as $$ select id::text from public.order_items where order_id = p_order order by id limit 1 $$;
create or replace function t.xi(p_order_item text, p_qty int) returns jsonb language sql as $$ select jsonb_build_object('order_item_id', p_order_item, 'quantity', p_qty) $$;
-- a request taken to "parcel received, waiting for inspection", every line approved; returns the request id (leaves the session as postgres)
create or replace function t.received(p_uid uuid, p_order text, p_type text, p_qty int) returns uuid
language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  d jsonb;
begin
  perform t.as_user(p_uid);
  perform public.create_return_request(v, p_order, p_type, jsonb_build_array(t.xi(t.line_id(p_order), p_qty)), 'incorrect_size');
  perform t.as_user(t.admin());
  select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')), '[]'::jsonb) into d from public.return_request_items where request_id = v;
  perform public.decide_request_items(v, d);
  perform public.set_request_internal_note(v, 'internal: looks fine');
  perform public.set_return_logistics(v, 'manual', 'Please post the items to us');
  perform public.record_return_received(v);
  perform public.record_inspection(v, (select jsonb_agg(jsonb_build_object('item_id', id, 'result', 'passed')) from public.return_request_items where request_id = v));
  perform t.as_postgres();
  return v;
end $$;

-- the world of one customer: ids returned as jsonb
create or replace function t.world(p_user uuid, p text) returns jsonb
language plpgsql as $$
declare
  r1 uuid; e1 uuid; f jsonb; rf uuid;
begin
  -- 1. a delivered order with a tracked shipment, and a return request that ends in a recorded refund
  perform t.delivered_order(p || '_o1', p_user, jsonb_build_array(t.sale('prod_single_a', '', 3, 500)));
  r1 := t.received(p_user, p || '_o1', 'return', 2);
  insert into public.return_request_evidence (request_id, storage_path, mime, size_bytes, uploaded_by) values (r1, p_user::text || '/' || r1::text || '/photo.jpg', 'image/jpeg', 1000, p_user);
  perform t.as_user(t.admin());
  f := public.create_refund(r1, 'key-' || p || '-return-1', 'manual');
  rf := (f ->> 'refund_id')::uuid;
  perform public.refund_mark_manual(rf, 'succeeded', 'UTR-' || p);
  perform t.as_postgres();

  -- 2. an exchange taken to "replacement pending": stock reserved, a fulfilment record, a price-difference record (nothing owed: the same item again)
  perform t.delivered_order(p || '_o2', p_user, jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  e1 := t.received(p_user, p || '_o2', 'exchange', 1);
  perform t.as_user(t.admin());
  perform public.request_transition(e1, 'replacement_pending');
  perform t.as_postgres();
  insert into public.exchange_adjustment_private (request_id, reference, internal_note) values (e1, 'REF-' || p, 'staff only') on conflict (request_id) do nothing;

  -- 3. a paid order cancelled before shipment (stock back, an order-level refund)
  perform t.place(p || '_o3', p_user, jsonb_build_array(t.sale('prod_single_a', '', 1, 500)));
  perform t.as_user(t.admin());
  perform public.cancel_order(p || '_o3', 'The customer asked to cancel', 'manual', 'key-' || p || '-cancel-1');
  perform t.as_postgres();
  return jsonb_build_object('return', r1, 'exchange', e1, 'refund', rf);
end $$;

-- 0. the world --------------------------------------------------------------------------------------------------------------------------------------------------
create temp table t_world (who text primary key, w jsonb) on commit drop;
grant all on t_world to public;
do $$
begin
  insert into t_world values ('alice', t.world(t.alice(), 'ma')), ('bob', t.world(t.bob(), 'mb'));
  -- one payment that could not become an order (service role), an import batch, and inactive catalogue rows
  perform t.as_service();
  perform public.record_payment_exception('order_RZ_MATRIX', 'pay_RZ_MATRIX', t.alice(), 250, 'Insufficient stock', '[]'::jsonb);
  perform t.as_postgres();
  insert into public.import_batches (file_hash, file_name, created_by, payload) values (repeat('a', 64), 'matrix.xlsx', t.admin(), '{}'::jsonb);
  insert into public.couriers (code, name, active) values ('matrix_off', 'Switched-off courier', false);
  update public.request_reasons set active = false where code = 'other';
  update public.product_variants set status = 'inactive' where id = 'var_1700000000001_2';
  perform t.eq((select count(*)::text from public.refunds), '4', 'fixture: each customer has a refund for the returned items and one for the cancelled order');
  perform t.ok((select count(*) from public.replacement_fulfillments) = 2 and (select count(*) from public.exchange_reservations) = 2 and (select count(*) from public.order_cancellations) = 2,
               'fixture: both customers have a replacement fulfilment, a stock reservation and a cancelled order');
  perform t.ok((select count(*) from public.shipment_events) >= 4 and (select count(*) from public.notifications where user_id = t.admin()) >= 2, 'fixture: shipment events and admin notifications exist');
end $$;

-- 1. what each role sees, table by table ---------------------------------------------------------------------------------------------------------------------------
-- cases: (table, how a row is "hers" - :u is the customer's id, alias x - , kind): owned = a customer sees exactly her rows; staff = a customer sees none, the admin all;
--        open = every signed-in user may read everything (a public catalogue)
create temp table t_cases (tbl text primary key, owner_expr text, kind text not null) on commit drop;
grant all on t_cases to public;
insert into t_cases values
  ('orders',                        'x.user_id = :u', 'owned'),
  ('order_items',                   'exists (select 1 from public.orders o where o.id = x.order_id and o.user_id = :u)', 'owned'),
  ('shipments',                     'exists (select 1 from public.orders o where o.id = x.order_id and o.user_id = :u)', 'owned'),
  ('shipment_items',                'exists (select 1 from public.shipments s join public.orders o on o.id = s.order_id where s.id = x.shipment_id and o.user_id = :u)', 'owned'),
  ('shipment_events',               'exists (select 1 from public.shipments s join public.orders o on o.id = s.order_id where s.id = x.shipment_id and o.user_id = :u)', 'owned'),
  ('return_requests',               'x.user_id = :u', 'owned'),
  ('return_request_items',          'exists (select 1 from public.return_requests r where r.id = x.request_id and r.user_id = :u)', 'owned'),
  ('return_request_evidence',       'exists (select 1 from public.return_requests r where r.id = x.request_id and r.user_id = :u)', 'owned'),
  ('return_request_events',         'not x.internal and exists (select 1 from public.return_requests r where r.id = x.request_id and r.user_id = :u)', 'owned'),
  ('refunds',                       'exists (select 1 from public.orders o where o.id = x.order_id and o.user_id = :u)', 'owned'),
  ('refund_items',                  'exists (select 1 from public.refunds f join public.orders o on o.id = f.order_id where f.id = x.refund_id and o.user_id = :u)', 'owned'),
  ('replacement_fulfillments',      'exists (select 1 from public.return_requests r where r.id = x.request_id and r.user_id = :u)', 'owned'),
  ('replacement_fulfillment_items', 'exists (select 1 from public.replacement_fulfillments f join public.return_requests r on r.id = f.request_id where f.id = x.fulfillment_id and r.user_id = :u)', 'owned'),
  ('exchange_adjustments',          'exists (select 1 from public.return_requests r where r.id = x.request_id and r.user_id = :u)', 'owned'),
  ('order_cancellations',           'exists (select 1 from public.orders o where o.id = x.order_id and o.user_id = :u)', 'owned'),
  ('notifications',                 'x.user_id = :u', 'owned'),
  ('return_request_private',        null, 'staff'),
  ('refund_private',                null, 'staff'),
  ('refund_events',                 null, 'staff'),
  ('exchange_reservations',         null, 'staff'),
  ('exchange_adjustment_private',   null, 'staff'),
  ('order_cancellation_private',    null, 'staff'),
  ('shipment_private',              null, 'staff'),
  ('payment_exceptions',            null, 'staff'),
  ('import_batches',                null, 'staff'),
  ('inventory_logs',                null, 'staff'),
  ('request_status_transitions',    null, 'open');

do $$
declare
  c record; v_total bigint; v_a bigint; v_b bigint; v_seen bigint; v_state text; v_msg text;
  v_admin_own bigint;
  v_bad text[] := '{}';
begin
  for c in select * from t_cases order by kind, tbl loop
    execute format('select count(*) from public.%I', c.tbl) into v_total;
    if c.kind = 'owned' then
      execute format('select count(*) from public.%I x where %s', c.tbl, replace(c.owner_expr, ':u', quote_literal(t.alice()))) into v_a;
      execute format('select count(*) from public.%I x where %s', c.tbl, replace(c.owner_expr, ':u', quote_literal(t.bob()))) into v_b;
      if v_a = 0 or v_b = 0 then v_bad := v_bad || (c.tbl || ': the fixture has no rows for both customers'); end if;
      perform t.as_user(t.alice());
      execute format('select count(*) from public.%I', c.tbl) into v_seen;
      if v_seen <> v_a then v_bad := v_bad || (c.tbl || ': Alice sees ' || v_seen || ' rows, expected exactly her ' || v_a); end if;
      perform t.as_user(t.bob());
      execute format('select count(*) from public.%I', c.tbl) into v_seen;
      if v_seen <> v_b then v_bad := v_bad || (c.tbl || ': Bob sees ' || v_seen || ' rows, expected exactly his ' || v_b); end if;
      perform t.as_user(t.admin());
      execute format('select count(*) from public.%I', c.tbl) into v_seen;
      v_admin_own := case when c.tbl = 'notifications' then (select count(*) from public.notifications where user_id = t.admin()) else v_total end;      -- the inbox is personal, even for the admin
      if v_seen <> v_admin_own then v_bad := v_bad || (c.tbl || ': the admin sees ' || v_seen || ', expected ' || v_admin_own); end if;
    elsif c.kind = 'staff' then
      if v_total = 0 then v_bad := v_bad || (c.tbl || ': the fixture has no rows (the check would be vacuous)'); end if;
      perform t.as_user(t.alice());
      execute format('select count(*) from public.%I', c.tbl) into v_seen;
      if v_seen <> 0 then v_bad := v_bad || (c.tbl || ': Alice sees ' || v_seen || ' staff-only rows'); end if;
      perform t.as_user(t.admin());
      execute format('select count(*) from public.%I', c.tbl) into v_seen;
      if v_seen <> v_total then v_bad := v_bad || (c.tbl || ': the admin sees ' || v_seen || ' of ' || v_total); end if;
    else
      perform t.as_user(t.alice());
      execute format('select count(*) from public.%I', c.tbl) into v_seen;
      if v_seen <> v_total or v_total = 0 then v_bad := v_bad || (c.tbl || ': an open catalogue shows ' || v_seen || ' of ' || v_total); end if;
    end if;
    -- anonymous: refused outright, or nothing
    perform t.as_anon();
    begin
      execute format('select count(*) from public.%I', c.tbl) into v_seen;
      if v_seen <> 0 then v_bad := v_bad || (c.tbl || ': anon sees ' || v_seen || ' rows'); end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      if v_state <> '42501' then v_bad := v_bad || (c.tbl || ': anon got ' || v_state); end if;
    end;
    perform t.as_postgres();
  end loop;
  perform t.ok(coalesce(array_length(v_bad, 1), 0) = 0, 'every table: a customer sees exactly her own rows, staff tables are closed to customers, anon sees nothing' || coalesce(' - PROBLEMS: ' || array_to_string(v_bad, '; '), ''));
  perform t.ok((select count(*) from t_cases) = 27, 'the matrix covers all 27 tables that hold customer or staff data');
end $$;

-- the catalogues: customers see only what is switched on, the admin sees everything --------------------------------------------------------------------------------------
do $$
begin
  perform t.as_user(t.alice());
  perform t.ok(not exists (select 1 from public.couriers where code = 'matrix_off') and exists (select 1 from public.couriers where code = 'manual'), 'a customer sees the active couriers, not a switched-off one');
  perform t.ok(not exists (select 1 from public.request_reasons where code = 'other') and exists (select 1 from public.request_reasons where code = 'damaged'), 'a customer sees the active request reasons only');
  perform t.ok(not exists (select 1 from public.product_variants where id = 'var_1700000000001_2') and exists (select 1 from public.product_variants where id = 'var_1700000000001_0'), 'a customer sees the active variants only');
  perform t.as_anon();
  perform t.ok(not exists (select 1 from public.product_variants where id = 'var_1700000000001_2') and exists (select 1 from public.product_variants where id = 'var_1700000000001_0'), 'anon sees the active variants (the shop window) and no inactive one');
  perform t.fails($q$select count(*) from public.couriers$q$, '42501');
  perform t.as_user(t.admin());
  perform t.ok(exists (select 1 from public.couriers where code = 'matrix_off') and exists (select 1 from public.request_reasons where code = 'other') and exists (select 1 from public.product_variants where id = 'var_1700000000001_2'),
               'the admin sees the switched-off rows too');
  perform t.as_postgres();
end $$;

-- 2. nobody writes a table directly: the RPCs are the only door ------------------------------------------------------------------------------------------------------
do $$
declare
  tables text[] := (select array_agg(tbl order by tbl) from t_cases where tbl not in ('orders', 'order_items', 'notifications'));   -- those three are legacy tables with Supabase's default grants: checked below
  v_tbl text; v_col text; v_who uuid; v_op text; v_state text; v_bad text[] := '{}'; v_n integer := 0;
begin
  foreach v_who in array array[t.alice(), t.admin()] loop
    foreach v_tbl in array tables loop
      select a.attname into v_col from pg_attribute a where a.attrelid = ('public.' || v_tbl)::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum limit 1;
      foreach v_op in array array['insert', 'update', 'delete'] loop
        perform t.as_user(v_who);
        begin
          execute case v_op when 'insert' then format('insert into public.%I default values', v_tbl)
                            when 'update' then format('update public.%I set %I = %I', v_tbl, v_col, v_col)
                            else format('delete from public.%I', v_tbl) end;
          v_bad := v_bad || (v_tbl || ': ' || v_op || ' by ' || case when v_who = t.admin() then 'the admin' else 'a customer' end || ' was ACCEPTED');
        exception when others then
          get stacked diagnostics v_state = returned_sqlstate;
          if v_state <> '42501' then v_bad := v_bad || (v_tbl || ': ' || v_op || ' got ' || v_state); end if;
          v_n := v_n + 1;
        end;
        perform t.as_postgres();
      end loop;
    end loop;
  end loop;
  perform t.ok(coalesce(array_length(v_bad, 1), 0) = 0, format('%s direct writes (insert / update / delete, customer and admin) were all refused', v_n) || coalesce(' - NOT: ' || array_to_string(v_bad, '; '), ''));
end $$;

-- the legacy tables: RLS is their only guard
do $$
declare v_n integer; v_status text;
begin
  perform t.as_user(t.alice());
  perform t.fails($q$insert into public.orders (id, user_id, order_status, payment_status, total) values ('hack_o1', '00000000-0000-0000-0000-0000000000a1', 'delivered', 'paid', 1)$q$, '42501');
  perform t.fails($q$insert into public.order_items (order_id, product_id, title, quantity, unit_price, line_total) values ('ma_o1', 'prod_single_a', 'x', 1, 1, 1)$q$, '42501');
  update public.orders set order_status = 'delivered', total = 1 where user_id = t.alice();
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'a customer cannot change her own order (status, total): 0 rows updated');
  delete from public.orders where user_id = t.alice();
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'nor delete it');
  update public.order_items set quantity = 99 where order_id in (select id from public.orders where user_id = t.alice());
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'nor edit a line');
  -- the catalogue and the store settings: a customer cannot write them (TESTING_CHECKLIST A8)
  perform t.fails($q$insert into public.products (id, title, price, stock) values ('hack_p1', 'Hack', 1, 1)$q$, '42501');
  update public.products set price = 1, stock = 0 where id = 'prod_single_a';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'a customer cannot change a product (price, stock)');
  delete from public.products where id = 'prod_single_a';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'nor delete it');
  update public.settings set data = '{}'::jsonb where id = 'shippingSettings';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'nor the store settings');
  perform t.as_anon();
  update public.products set price = 1 where id = 'prod_single_a';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'an anonymous visitor cannot change a product either');
  perform t.as_postgres();
  perform t.ok((select count(*) from public.orders where id like 'hack_%') = 0 and (select total from public.orders where id = 'ma_o1') = 1500, 'the orders are exactly as they were');
  perform t.ok((select price from public.products where id = 'prod_single_a') = 500 and exists (select 1 from public.products where id = 'prod_single_a') and not exists (select 1 from public.products where id = 'hack_p1'), 'and the catalogue too');
end $$;

-- 3. one customer against the other's objects, through the RPCs ---------------------------------------------------------------------------------------------------------
do $$
declare
  ra uuid := (select (w ->> 'return')::uuid from t_world where who = 'alice');
  rb uuid := (select (w ->> 'return')::uuid from t_world where who = 'bob');
  n0 bigint := (select count(*) from public.return_requests);
  s0 text := (select status from public.return_requests where id = (select (w ->> 'return')::uuid from t_world where who = 'alice'));
  v_ok boolean;
begin
  perform t.as_user(t.bob());
  perform t.fails(format($q$select public.cancel_return_request(%L)$q$, ra), 'P0002', '%not found%');
  perform t.fails(format($q$select public.respond_to_request(%L, 'hello', '[]'::jsonb)$q$, ra), 'P0002', '%not found%');
  perform t.fails(format($q$select public.customer_submit_return_shipment(%L, 'Courier', 'TRK1', null, null)$q$, ra), 'P0002', '%not found%');
  perform t.fails($q$select public.get_order_eligibility('ma_o1')$q$, 'P0002', '%not found%');
  perform t.fails(format($q$select public.create_return_request(gen_random_uuid(), 'ma_o1', 'return', jsonb_build_array(jsonb_build_object('order_item_id', %L, 'quantity', 1)), 'incorrect_size')$q$, t.line_id('ma_o1')));
  -- hijack: Bob re-sends ALICE'S request id together with his own order; he must not get her request back
  begin
    perform public.create_return_request(ra, 'mb_o2', 'return', jsonb_build_array(jsonb_build_object('order_item_id', t.line_id('mb_o2'), 'quantity', 1)), 'incorrect_size');
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  perform t.as_postgres();
  perform t.ok(not v_ok, 'a request id that belongs to somebody else cannot be reused to read or create anything');
  perform t.eq((select count(*)::text from public.return_requests), n0::text, 'none of those attempts left a request behind');
  perform t.ok((select status from public.return_requests where id = ra) = s0 and (select user_id from public.return_requests where id = ra) = t.alice(), 'Alice''s request is untouched and still hers');
end $$;

rollback;