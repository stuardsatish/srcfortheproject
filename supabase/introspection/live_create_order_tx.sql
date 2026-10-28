-- ============================================================================
-- live_create_order_tx.sql — ROLLBACK REFERENCE (do not edit; do not run unless rolling back)
-- ----------------------------------------------------------------------------
-- Verbatim copy of public.create_order_tx exactly as it existed in the LIVE
-- database on 2026-10-13, reconstructed from the output of
-- 00_schema_inventory.sql (pg_get_functiondef).
--
-- Why it is kept: migration 20261014_01 replaces this function (same signature)
-- so that variants, SKU/policy snapshots and the inventory ledger are honoured.
-- Running THIS file restores the pre-migration behaviour. It is the rollback
-- for that one function; see DATABASE_CHANGE_PLAN.md §Rollback for the rest.
--
-- Behaviour of this legacy version (verified from the body below):
--   * ignores p_items[].variant_id / variant_name entirely (order_items has no
--     variant columns), so the variant is only recorded inside `title`
--     ("Title [Variant]");
--   * decrements products.stock (the MAIN product) even for variant sales, and
--     never touches products.variants[].stock;
--   * writes inventory_logs(product_id, change, reason='order', order_id).
--
-- CREATE OR REPLACE keeps the function's existing ACL (it is REVOKEd from
-- anon/authenticated and callable by service_role only), so re-running it does
-- not widen access.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order_tx(p_order_id text, p_user_id uuid, p_items jsonb, p_order_status text, p_payment_status text, p_payment_method text, p_source text, p_customer_name text, p_customer_email text, p_customer_phone text, p_address jsonb, p_subtotal numeric, p_shipping numeric, p_cgst numeric, p_sgst numeric, p_igst numeric, p_promo_code text, p_promo_discount numeric, p_total numeric, p_razorpay_order_id text DEFAULT NULL::text, p_razorpay_payment_id text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_order public.orders;
  v_today text := to_char(now(), 'YYYY-MM-DD');
  v_month text := to_char(now(), 'YYYY-MM');
  v_year text := to_char(now(), 'YYYY');
begin
  -- Idempotency: mirror finalizeOrder()'s ALREADY_FINALIZED behavior instead
  -- of raising, so a Razorpay webhook retry (or a dropped /verify response)
  -- doesn't error out — it just returns the order that already exists.
  select * into v_order from public.orders where id = p_order_id;
  if found then
    return v_order;
  end if;

  insert into public.orders (
    id, user_id, order_status, payment_status, payment_method, source,
    customer_name, customer_email, customer_phone, address,
    subtotal, shipping, cgst, sgst, igst, promo_code, promo_discount, total,
    razorpay_order_id, razorpay_payment_id
  ) values (
    p_order_id, p_user_id, p_order_status, p_payment_status, p_payment_method, p_source,
    p_customer_name, p_customer_email, p_customer_phone, p_address,
    p_subtotal, p_shipping, p_cgst, p_sgst, p_igst, p_promo_code, p_promo_discount, p_total,
    p_razorpay_order_id, p_razorpay_payment_id
  )
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, title, quantity, unit_price, discount, cgst, sgst, igst, line_total
    ) values (
      p_order_id,
      v_item->>'product_id',
      v_item->>'title',
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      coalesce((v_item->>'discount')::numeric, 0),
      coalesce((v_item->>'cgst')::numeric, 0),
      coalesce((v_item->>'sgst')::numeric, 0),
      coalesce((v_item->>'igst')::numeric, 0),
      (v_item->>'line_total')::numeric
    );

    -- Stock decrement — raise if it would go negative (matches the original
    -- transactional re-check in finalizeOrder()/writeOrderInTx()).
    update public.products
      set stock = stock - (v_item->>'quantity')::int
      where id = v_item->>'product_id'
        and stock >= (v_item->>'quantity')::int;

    if not found then
      raise exception 'Insufficient stock for product %', v_item->>'product_id';
    end if;

    insert into public.inventory_logs (product_id, change, reason, order_id)
    values (v_item->>'product_id', -(v_item->>'quantity')::int, 'order', p_order_id);

    insert into public.product_stats (product_id, total_orders, total_revenue, total_quantity, last_sold_at)
    values (v_item->>'product_id', 1, (v_item->>'line_total')::numeric, (v_item->>'quantity')::int, now())
    on conflict (product_id) do update set
      total_orders = public.product_stats.total_orders + 1,
      total_revenue = public.product_stats.total_revenue + excluded.total_revenue,
      total_quantity = public.product_stats.total_quantity + excluded.total_quantity,
      last_sold_at = now();
  end loop;

  if p_user_id is not null then
    insert into public.customer_stats (user_id, total_orders, total_spent, avg_order_value, last_order_date)
    values (p_user_id, 1, p_total, p_total, now())
    on conflict (user_id) do update set
      total_orders = public.customer_stats.total_orders + 1,
      total_spent = public.customer_stats.total_spent + p_total,
      avg_order_value = (public.customer_stats.total_spent + p_total) / (public.customer_stats.total_orders + 1),
      last_order_date = now();

    update public.profiles
      set total_orders = total_orders + 1,
          total_spent = total_spent + p_total
      where id = p_user_id;

    delete from public.cart_items where user_id = p_user_id;
  end if;

  insert into public.analytics (period_type, period_key, revenue, orders, customers)
  values ('daily', v_today, p_total, 1, 1)
  on conflict (period_type, period_key) do update set
    revenue = public.analytics.revenue + p_total,
    orders = public.analytics.orders + 1;

  insert into public.analytics (period_type, period_key, revenue, orders, customers)
  values ('monthly', v_month, p_total, 1, 1)
  on conflict (period_type, period_key) do update set
    revenue = public.analytics.revenue + p_total,
    orders = public.analytics.orders + 1;

  insert into public.analytics (period_type, period_key, revenue, orders, customers)
  values ('yearly', v_year, p_total, 1, 1)
  on conflict (period_type, period_key) do update set
    revenue = public.analytics.revenue + p_total,
    orders = public.analytics.orders + 1;

  return v_order;
end;
$function$;