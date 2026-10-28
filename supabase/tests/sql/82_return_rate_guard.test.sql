-- needs: m8
-- reapply: 20261018_02_security_hardening.sql
-- Phase 13 — M8's rate guard on new return / exchange requests: a customer's 21st request inside one rolling hour is refused (54000); an admin opening a request on
-- someone's behalf, another customer, and the same customer an hour later are not. Real orders, real create_return_request.
-- ("reapply" = M8 is applied a SECOND time first: the idempotency test.)
begin;

create or replace function t.sale(p_product text, p_variant text, p_qty int, p_unit numeric) returns jsonb language sql as $$
  select jsonb_build_object('product_id', p_product, 'variant_id', nullif(p_variant, ''), 'variant_name', null, 'title', 'Item ' || p_product, 'quantity', p_qty, 'unit_price', p_unit,
                            'discount', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'line_total', p_qty * p_unit)
$$;
create or replace function t.delivered_order(p_id text, p_user uuid) returns text
language plpgsql as $$
declare v_total numeric := 500;
begin
  perform public.create_order_tx(p_order_id := p_id, p_user_id := p_user, p_items := jsonb_build_array(t.sale('prod_single_a', '', 1, 500)), p_order_status := 'placed', p_payment_status := 'paid',
    p_payment_method := 'Razorpay', p_source := 'online', p_customer_name := 'T', p_customer_email := 't@example.test', p_customer_phone := '9999999999', p_address := '{}'::jsonb,
    p_subtotal := v_total, p_shipping := 0, p_cgst := 0, p_sgst := 0, p_igst := 0, p_promo_code := null, p_promo_discount := 0, p_total := v_total,
    p_razorpay_order_id := 'rzp_' || p_id, p_razorpay_payment_id := 'pay_' || p_id);
  perform t.as_user(t.admin());
  perform public.ship_order(p_id, 'manual');
  perform public.mark_delivered(p_id);
  perform t.as_postgres();
  return (select id::text from public.order_items where order_id = p_id order by id limit 1);
end $$;
create or replace function t.ask(p_user uuid, p_order text, p_line text) returns void
language plpgsql as $$
begin
  perform t.as_user(p_user);
  perform public.create_return_request(gen_random_uuid(), p_order, 'return', jsonb_build_array(jsonb_build_object('order_item_id', p_line, 'quantity', 1)), 'incorrect_size');
  perform t.as_postgres();
end $$;

do $$
declare
  i integer; v_line text; v_lines text[] := '{}'; v_state text; v_msg text;
begin
  -- 22 delivered orders for Alice, one line each (an order line can have only one request in progress)
  for i in 1..22 loop
    v_lines := v_lines || t.delivered_order('rg_a' || i, t.alice());
  end loop;
  perform t.ok(array_length(v_lines, 1) = 22, 'fixture: 22 delivered orders for Alice');

  -- twenty requests in the hour: fine
  for i in 1..20 loop
    perform t.ask(t.alice(), 'rg_a' || i, v_lines[i]);
  end loop;
  perform t.eq((select count(*)::text from public.return_requests where user_id = t.alice()), '20', 'Alice sent 20 requests inside the hour: all accepted');

  -- the 21st is refused with a plain sentence and SQLSTATE 54000; nothing is left behind
  begin
    perform t.ask(t.alice(), 'rg_a21', v_lines[21]);
    raise exception 'the 21st request was accepted';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  perform t.as_postgres();
  perform t.eq(v_state, '54000', 'the 21st request inside the hour is refused (54000)');
  perform t.ok(v_msg like 'You have sent too many requests%', 'with a sentence a customer can read: ' || v_msg);
  perform t.eq((select count(*)::text from public.return_requests where user_id = t.alice()), '20', 'and no request was stored');

  -- an admin opening a request on her behalf is not "her" submission
  perform t.as_user(t.admin());
  perform public.create_return_request(gen_random_uuid(), 'rg_a21', 'return', jsonb_build_array(jsonb_build_object('order_item_id', v_lines[21], 'quantity', 1)), 'incorrect_size', null, null, '[]'::jsonb, true);
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.return_requests where user_id = t.alice()), '21', 'an admin can still open a request for her (the guard counts only her own submissions)');

  -- another customer is unaffected
  perform t.delivered_order('rg_b1', t.bob());
  perform t.ask(t.bob(), 'rg_b1', (select id::text from public.order_items where order_id = 'rg_b1' limit 1));
  perform t.eq((select count(*)::text from public.return_requests where user_id = t.bob()), '1', 'Bob''s first request is accepted');

  -- an hour later the window has moved on
  update public.return_requests set created_at = now() - interval '2 hours' where user_id = t.alice();
  perform t.ask(t.alice(), 'rg_a22', v_lines[22]);
  perform t.eq((select count(*)::text from public.return_requests where user_id = t.alice()), '22', 'two hours later she can send another one');
end $$;

-- the guard is an internal trigger function
do $$
begin
  perform t.ok(not has_function_privilege('authenticated', 'public.trg_return_requests_rate_guard()', 'execute') and not has_function_privilege('anon', 'public.trg_return_requests_rate_guard()', 'execute'),
               'the guard function is not callable through the API');
  perform t.eq((select count(*)::text from pg_trigger where tgname = 'return_requests_rate_guard' and not tgisinternal), '1', 'exactly one guard trigger (the second apply of M8 did not duplicate it)');
end $$;

rollback;