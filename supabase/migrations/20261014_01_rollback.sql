-- ============================================================================
-- M1 ROLLBACK — restores the pre-M1 behaviour of the order flow.
--
-- Restores: the legacy create_order_tx (exact copy of the live function captured
-- on 2026-10-13), the legacy trg_notify_product_changes, and removes the M1
-- triggers (variants cache / guard / SKU check / compat insert / touch).
--
-- DELIBERATELY KEPT (nothing is dropped, no data is lost):
--   * product_variants and all added columns / the ledger rows written since M1
--   * products.variants jsonb — it is the trigger-maintained cache, i.e. ALREADY in
--     the legacy shape and current. It is NOT overwritten from
--     _backup_products_variants_20261014 on purpose: restoring that old copy would
--     silently undo stock changes made after M1. After the rollback the legacy
--     path owns products.variants again (edits made through the OLD admin form);
--     product_variants stops being read by anything.
--   * _backup_products_variants_20261014 (use it manually if you need the pre-M1 jsonb)
--
-- To remove the new tables/columns as well, do it as a separate, explicit step
-- after verifying nothing references them (see DATABASE_CHANGE_PLAN §4.10).
-- SAFE TO RE-RUN.
-- ============================================================================
begin;

drop trigger if exists guard_products_variants_write on public.products;
drop trigger if exists products_explode_on_insert    on public.products;
drop trigger if exists products_sku_unique           on public.products;
drop trigger if exists products_touch_updated_at     on public.products;
drop trigger if exists products_id_conventions        on public.products;
drop trigger if exists product_variants_id_conventions on public.product_variants;
drop trigger if exists product_variants_cache        on public.product_variants;
drop trigger if exists product_variants_sku_unique   on public.product_variants;
drop trigger if exists product_variants_touch_updated_at on public.product_variants;
drop trigger if exists notify_variant_stock          on public.product_variants;

-- legacy trg_notify_product_changes (alerts are matched by product only, as before)
create or replace function public.trg_notify_product_changes()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_old_price numeric := public.app_effective_price(old.price, old.discount, old.discount_expiry);
  v_new_price numeric := public.app_effective_price(new.price, new.discount, new.discount_expiry);
  r record;
begin
  begin
    if coalesce(old.stock, 0) <= 0 and coalesce(new.stock, 0) > 0 then
      for r in select sa.user_id from public.stock_alerts sa where sa.product_id = new.id loop
        perform public.app_queue_notification(
          r.user_id, 'back_in_stock', 'Back in stock',
          coalesce(new.title, 'An item you wanted') || ' is available again.',
          jsonb_build_object('type', 'product', 'productId', new.id));
      end loop;
      delete from public.stock_alerts where product_id = new.id;
    end if;
    if v_new_price < v_old_price then
      for r in
        select pa.id, pa.user_id from public.price_alerts pa
        where pa.product_id = new.id and v_new_price < pa.price_when_set
          and (pa.target_price is null or v_new_price <= pa.target_price)
      loop
        perform public.app_queue_notification(
          r.user_id, 'price_drop', 'Price drop',
          coalesce(new.title, 'An item you are watching') || ' is now ' || to_char(v_new_price, 'FM999999990.00') || '.',
          jsonb_build_object('type', 'product', 'productId', new.id, 'price', v_new_price));
        delete from public.price_alerts where id = r.id;
      end loop;
    end if;
  exception when others then
    raise warning 'trg_notify_product_changes skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

-- legacy create_order_tx (same signature; CREATE OR REPLACE keeps the existing ACL)
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


commit;
notify pgrst, 'reload schema';