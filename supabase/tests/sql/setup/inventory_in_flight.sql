-- setup/inventory_in_flight.sql — builds the state a ROLLBACK / roll-forward of M6 (tests 61 and 62) has to cope with. Run by the runners (`-- setup:`
-- directive) after _helpers.sql and BEFORE any `-- reapply:`. Customer: Alice. Orders are placed with the REAL create_order_tx (stock + ledger are real).
--   if_c1  COD, unpaid, CANCELLED with cancel_order        2 shirts back on the counter, a cancellation record, no refund
--   if_c2  Razorpay, paid, CANCELLED with cancel_order      1 Pink back, a refund of kind 'order' (pending, razorpay, not sent), a cancellation record
--   if_r1  Razorpay, paid, delivered; a RETURN passed        the returned shirt restocked (ledger return_restock, line.stock_effect = restocked)
--   if_r2  Razorpay, paid, delivered; a RETURN passed        kept as not resellable (ledger return_unsellable, bucket unsellable)
-- Stock after this file (seed shirt 50, Pink 20): shirt 50 - 1 (if_r1: 2 bought, 1 restocked) - 1 (if_r2) = 48 ... see test 61 for the exact numbers it checks.
begin;

create or replace function t.sx_place(p_id text, p_paid boolean, p_method text, p_product text, p_variant text, p_qty int, p_unit numeric) returns void language plpgsql as $$
declare v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', p_product, 'variant_id', nullif(p_variant, ''), 'variant_name', null, 'title', 'Item', 'quantity', p_qty, 'unit_price', p_unit,
                                                              'discount', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'line_total', p_qty * p_unit));
begin
  perform public.create_order_tx(p_order_id := p_id, p_user_id := t.alice(), p_items := v_items, p_order_status := 'placed', p_payment_status := case when p_paid then 'paid' else 'pending' end,
    p_payment_method := p_method, p_source := 'online', p_customer_name := 'T', p_customer_email := 't@example.test', p_customer_phone := '9999999999', p_address := '{}'::jsonb,
    p_subtotal := p_qty * p_unit, p_shipping := 0, p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := p_qty * p_unit,
    p_razorpay_order_id := case when p_method = 'Razorpay' then 'rzp_' || p_id end, p_razorpay_payment_id := case when p_method = 'Razorpay' and p_paid then 'pay_' || p_id end);
end $$;

create or replace function t.sx_return_passed(p_order text, p_disposition text) returns void language plpgsql as $$
declare
  v  uuid := gen_random_uuid();
  li uuid;
begin
  select id into li from public.order_items where order_id = p_order limit 1;
  perform t.as_user(t.alice());
  perform public.create_return_request(v, p_order, 'return', jsonb_build_array(jsonb_build_object('order_item_id', li, 'quantity', 1)), 'incorrect_size');
  perform t.as_user(t.admin());
  perform public.decide_request_items(v, (select jsonb_agg(jsonb_build_object('item_id', id, 'decision', 'approve')) from public.return_request_items where request_id = v));
  perform public.set_return_logistics(v, 'manual', 'post it');
  perform public.record_return_received(v);
  perform public.record_inspection(v, (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item_id', id, 'result', 'passed', 'disposition', p_disposition))) from public.return_request_items where request_id = v));
  perform t.as_postgres();
end $$;

do $$
begin
  perform t.sx_place('if_c1', false, 'COD', 'prod_single_a', '', 2, 500);
  perform t.sx_place('if_c2', true, 'Razorpay', 'prod_vmain_ok', 'var_1700000000001_0', 1, 300);
  perform t.as_user(t.admin());
  perform public.cancel_order('if_c1', 'Customer asked to cancel');
  perform public.cancel_order('if_c2', 'Out of stock at the supplier', 'razorpay', 'key-ifl-c2-0001', 'supplier delay');
  perform t.as_postgres();

  perform t.sx_place('if_r1', true, 'Razorpay', 'prod_single_a', '', 2, 500);
  perform t.sx_place('if_r2', true, 'Razorpay', 'prod_single_a', '', 1, 500);
  perform t.as_user(t.admin());
  perform public.ship_order('if_r1', 'manual', 'T-IF-R1');
  perform public.mark_delivered('if_r1');
  perform public.ship_order('if_r2', 'manual', 'T-IF-R2');
  perform public.mark_delivered('if_r2');
  perform t.as_postgres();
  perform t.sx_return_passed('if_r1', null);                    -- default: restock
  perform t.sx_return_passed('if_r2', 'unsellable');
end $$;

commit;