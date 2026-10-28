-- setup/exchange_in_flight.sql — builds four exchanges in four different states, so that a ROLLBACK / roll-forward of M5b (tests 54 and 55) has real
-- reservations, a fulfilment record, a replacement shipment and a price-difference refund to act on. Run by the runners (`-- setup:` directive) after
-- _helpers.sql and BEFORE any `-- reapply:`. Customer: Alice. Order if_o1, four Pink lines of 300 each (the exchange options differ).
--   RA  approved                      Pink -> White   White  -1 reserved
--   RB  replacement_pending           Pink -> Violet  Violet -1 reserved, fulfilment + adjustment balance_due 50 open, customer notified
--   RC  replacement_shipped           Pink -> White   White  -1 reserved + FULFILLED, replacement shipment, adjustment refund_due 100 + a pending manual refund
--   RD  inspection_pending            Pink -> Pink    Pink   -1 reserved (the line is `received`)
-- Stock after this file (seed 20 / 30 / 15): Pink 19, White 28, Violet 14.
begin;

insert into public.orders (id, user_id, order_status, payment_status, payment_method, customer_name, subtotal, shipping, total, razorpay_payment_id, delivered_at, delivered_at_source, created_at)
values ('if_o1', t.alice(), 'delivered', 'paid', 'Razorpay', 'Alice', 1200, 0, 1200, 'pay_if_o1', now() - interval '2 days', 'shipment', now() - interval '6 days');
insert into public.order_items (id, order_id, product_id, variant_id, title, product_title, variant_name, quantity, unit_price, line_total, return_enabled, return_window_days, exchange_enabled, exchange_window_days) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'if_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt', 'Designer Shirt', 'Pink', 1, 300, 300, true, 7, true, 7),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'if_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt', 'Designer Shirt', 'Pink', 1, 300, 300, true, 7, true, 7),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'if_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt', 'Designer Shirt', 'Pink', 1, 300, 300, true, 7, true, 7),
  ('a1a1a1a1-0000-0000-0000-000000000004', 'if_o1', 'prod_vmain_ok', 'var_1700000000001_0', 'Designer Shirt', 'Designer Shirt', 'Pink', 1, 300, 300, true, 7, true, 7);

create or replace function t.setup_xr(p_line text, p_replacement text default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  perform t.as_user(t.alice());
  perform public.create_return_request(v, 'if_o1', 'exchange',
    jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('order_item_id', p_line, 'quantity', 1, 'replacement_variant_id', p_replacement))), 'incorrect_size');
  perform t.as_postgres();
  return v;
end $$;
create or replace function t.setup_approve(p_req uuid) returns void language plpgsql as $$
begin
  perform t.as_user(t.admin());
  perform public.decide_request_items(p_req, (select jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')) from public.return_request_items where request_id = p_req));
  perform t.as_postgres();
end $$;
create or replace function t.setup_received(p_req uuid) returns void language plpgsql as $$
begin
  perform t.as_user(t.admin());
  perform public.set_return_logistics(p_req, 'manual', 'Please post the item to us');
  perform public.record_return_received(p_req);
  perform t.as_postgres();
end $$;
create or replace function t.setup_passed(p_req uuid) returns void language plpgsql as $$
begin
  perform t.as_user(t.admin());
  perform public.record_inspection(p_req, (select jsonb_agg(jsonb_build_object('item_id', id, 'result', 'passed')) from public.return_request_items where request_id = p_req));
  perform public.request_transition(p_req, 'replacement_pending');
  perform t.as_postgres();
end $$;

do $$
declare
  ra uuid := t.setup_xr('a1a1a1a1-0000-0000-0000-000000000001', 'var_1700000000001_1');
  rb uuid := t.setup_xr('a1a1a1a1-0000-0000-0000-000000000002', 'var_1700000000001_2');
  rc uuid := t.setup_xr('a1a1a1a1-0000-0000-0000-000000000003', 'var_1700000000001_1');
  rd uuid := t.setup_xr('a1a1a1a1-0000-0000-0000-000000000004');
begin
  perform t.setup_approve(ra);
  perform t.setup_approve(rb); perform t.setup_received(rb); perform t.setup_passed(rb);
  perform t.setup_approve(rc); perform t.setup_received(rc); perform t.setup_passed(rc);
  perform t.setup_approve(rd); perform t.setup_received(rd);
  perform t.as_user(t.admin());
  perform public.ship_replacement(rc, 'manual', 'Setup courier', 'TRK-SETUP-RC');
  perform public.create_exchange_refund(rc, 'key-setup-rc-0001', 'manual');
  perform t.as_postgres();
end $$;

commit;