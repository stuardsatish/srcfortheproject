-- needs: m7
-- setup: setup/order_status_trigger.sql
-- reapply: 20261018_01_rollback.sql
-- reapply: 20261018_01_rollback.sql
-- M7 rollback applied TWICE: the four triggers and their functions are gone, everything else keeps working (orders, shipments, requests), the notifications
-- that were already written stay, and the older notification triggers of M3 / M4 / M5 are untouched.
begin;

create or replace function t.sale(p_product text, p_variant text, p_qty int, p_unit numeric) returns jsonb language sql as $$
  select jsonb_build_object('product_id', p_product, 'variant_id', nullif(p_variant, ''), 'variant_name', null, 'title', 'Item ' || p_product, 'quantity', p_qty, 'unit_price', p_unit,
                            'discount', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'line_total', p_qty * p_unit)
$$;
create or replace function t.n(p_uid uuid, p_title text) returns integer language sql security definer as $$
  select count(*)::int from public.notifications where user_id = p_uid and title = p_title $$;

do $$
declare
  s uuid;
begin
  perform t.ok(to_regprocedure('public.trg_notify_order_placed()') is null and to_regprocedure('public.trg_notify_request_received()') is null
               and to_regprocedure('public.trg_notify_shipment_tracking()') is null, 'the three trigger functions are gone');
  perform t.ok(not exists (select 1 from pg_trigger where tgname in ('notify_order_placed', 'notify_request_received', 'notify_shipment_added', 'notify_shipment_tracking_added') and not tgisinternal),
               'and so are the four triggers');
  perform t.ok(exists (select 1 from pg_trigger where tgname = 'notify_order_status' and not tgisinternal), 'the older "order status" notification trigger is untouched');

  -- orders still work, they just do not announce themselves any more
  perform public.create_order_tx(p_order_id := 'rb_o1', p_user_id := t.alice(), p_items := jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), p_order_status := 'placed', p_payment_status := 'paid',
    p_payment_method := 'Razorpay', p_source := 'online', p_customer_name := 'T', p_customer_email := 't@example.test', p_customer_phone := '9999999999', p_address := '{}'::jsonb,
    p_subtotal := 500, p_shipping := 0, p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := 500,
    p_razorpay_order_id := 'rzp_rb_o1', p_razorpay_payment_id := 'pay_rb_o1');
  perform t.ok(exists (select 1 from public.orders where id = 'rb_o1'), 'an order can still be placed');
  perform t.eq(t.n(t.alice(), 'Order placed')::text, '0', 'without the "Order placed" message');

  perform t.as_user(t.admin());
  s := ((public.ship_order('rb_o1', 'manual')) -> 'shipment' ->> 'id')::uuid;
  perform public.update_shipment(s, '{"tracking_number":"TRK-RB"}'::jsonb);
  perform t.as_postgres();
  perform t.ok((select order_status from public.orders where id = 'rb_o1') = 'shipped' and (select tracking_number from public.shipments where id = s) = 'TRK-RB', 'shipping and editing the tracking number still work');
  perform t.eq(t.n(t.alice(), 'Your order is on its way')::text, '1', 'ship_order''s own "on its way" message still goes out (it is part of M3, not M7)');
  perform t.eq(t.n(t.alice(), 'Tracking number added')::text, '0', 'but "Tracking number added" is gone');
end $$;

rollback;