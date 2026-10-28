-- needs: m7
-- setup: setup/order_status_trigger.sql
-- reapply: 20261018_01_rollback.sql
-- reapply: 20261018_01_notification_events.sql
-- M7 rolled back and applied again (roll-forward): the triggers are back, exactly one of each, and they announce again.
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
  perform t.eq((select count(*)::text from pg_trigger where tgname = 'notify_order_placed' and not tgisinternal), '1', 'one "order placed" trigger');
  perform t.eq((select count(*)::text from pg_trigger where tgname = 'notify_request_received' and not tgisinternal), '1', 'one "request received" trigger');
  perform t.eq((select count(*)::text from pg_trigger where tgname in ('notify_shipment_added', 'notify_shipment_tracking_added') and not tgisinternal), '2', 'two shipment triggers');

  perform public.create_order_tx(p_order_id := 'rf_o1', p_user_id := t.alice(), p_items := jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), p_order_status := 'placed', p_payment_status := 'paid',
    p_payment_method := 'Razorpay', p_source := 'online', p_customer_name := 'T', p_customer_email := 't@example.test', p_customer_phone := '9999999999', p_address := '{}'::jsonb,
    p_subtotal := 500, p_shipping := 0, p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := 500,
    p_razorpay_order_id := 'rzp_rf_o1', p_razorpay_payment_id := 'pay_rf_o1');
  perform t.eq(t.n(t.alice(), 'Order placed')::text, '1', 'after the roll-forward an order is announced once again');

  perform t.as_user(t.admin());
  s := ((public.ship_order('rf_o1', 'manual')) -> 'shipment' ->> 'id')::uuid;
  perform public.update_shipment(s, '{"tracking_number":"TRK-RF"}'::jsonb);
  perform t.as_postgres();
  perform t.eq(t.n(t.alice(), 'Tracking number added')::text, '1', 'and so is a tracking number added later');
end $$;

rollback;