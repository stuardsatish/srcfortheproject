-- ============================================================================
-- base_schema.sql — TEST FIXTURE ONLY (never run against Supabase)
-- ----------------------------------------------------------------------------
-- A faithful-as-possible reconstruction of the parts of the LIVE schema that
-- migration M1 touches, rebuilt from the 2026-10-13 inventory
-- (supabase/introspection/00_schema_inventory.sql output). Columns, defaults,
-- NOT NULLs, constraints, indexes, RLS policies, the helper functions and the
-- two product/order triggers are copied from that output. Tables M1 does not
-- touch (addresses, reviews, Q&A, device_tokens, …) are omitted.
--
-- The live `create_order_tx` is NOT here: the harness loads it from
-- supabase/introspection/live_create_order_tx.sql right after this file, so
-- tests always start from the exact legacy RPC.
--
-- Also imitates just enough of Supabase: roles, auth.users/uid()/jwt()/role().
-- ============================================================================

-- -- Supabase imitation -------------------------------------------------------
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id           uuid primary key default gen_random_uuid(),
  email        text,
  is_anonymous boolean not null default false
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', 'anon')
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- -- tables --------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  name              text,
  email             text,
  phone             text,
  address           jsonb,
  photo_url         text,
  role              text not null default 'user'   check (role in ('user', 'admin')),
  status            text not null default 'active' check (status in ('active', 'blocked', 'suspended')),
  active_session_id text,
  last_login_at     timestamptz,
  last_login_ip     text,
  last_login_device text,
  total_orders      integer not null default 0,
  total_spent       numeric not null default 0,
  created_at        timestamptz not null default now(),
  gender            text,
  date_of_birth     date
);

create table public.products (
  id                text primary key,
  title             text not null,
  description       text,
  category          text,
  brand             text,
  badge             text,
  price             numeric not null default 0,
  price_type        text default 'inclusive',
  discount          numeric not null default 0,
  discount_expiry   timestamptz,
  stock             integer not null default 0,
  max_stock         integer,
  image             text,
  thumbnail         text,
  gallery           text[] not null default '{}',
  rating            numeric not null default 0,
  review_count      integer not null default 0,
  created_at        timestamptz not null default now(),
  short_description text,
  sku               text,
  gst_rate          numeric not null default 0,
  hsn_code          text,
  status            text not null default 'active' check (status in ('active', 'draft')),
  has_variants      boolean not null default false,
  variants          jsonb not null default '[]'::jsonb,
  attributes        jsonb not null default '{}'::jsonb
);
create index products_category_idx on public.products (category);

create table public.orders (
  id                  text primary key,
  user_id             uuid references public.profiles (id) on delete set null,
  order_status        text not null default 'pending',
  payment_status      text not null default 'pending',
  payment_method      text,
  source              text not null default 'online',
  customer_name       text,
  customer_email      text,
  customer_phone      text,
  address             jsonb,
  subtotal            numeric not null default 0,
  shipping            numeric not null default 0,
  cgst                numeric not null default 0,
  sgst                numeric not null default 0,
  igst                numeric not null default 0,
  promo_code          text,
  promo_discount      numeric not null default 0,
  total               numeric not null default 0,
  razorpay_order_id   text,
  razorpay_payment_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  gift_wrap           boolean not null default false,
  gift_message        text,
  constraint orders_gift_message_len check (gift_message is null or char_length(gift_message) <= 300)
);
create index orders_created_at_idx on public.orders (created_at desc);
create index orders_user_id_idx    on public.orders (user_id);

create table public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   text not null references public.orders (id) on delete cascade,
  product_id text not null,                       -- deliberately NO foreign key (live schema)
  title      text not null,
  quantity   integer not null,
  unit_price numeric not null,
  discount   numeric not null default 0,
  cgst       numeric not null default 0,
  sgst       numeric not null default 0,
  igst       numeric not null default 0,
  line_total numeric not null
);
create index order_items_order_id_idx on public.order_items (order_id);

create table public.cart_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  product_id        text not null references public.products (id) on delete cascade,
  quantity          integer not null check (quantity > 0),
  title             text,
  image             text,
  category          text,
  price             numeric,
  discount          numeric,
  discount_expiry   timestamptz,
  updated_at        timestamptz not null default now(),
  variant_id        text,                          -- live: nullable, no default
  variant_name      text,
  parent_product_id text,
  selected_variant  jsonb,
  constraint cart_items_user_product_variant_key unique (user_id, product_id, variant_id)
);

create table public.saved_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  product_id       text not null,
  variant_id       text not null default '',
  variant_name     text,
  selected_variant jsonb,
  quantity         integer not null default 1 check (quantity between 1 and 999),
  title            text, image text, category text, price numeric, discount numeric,
  discount_expiry  timestamptz,
  saved_at         timestamptz not null default now(),
  unique (user_id, product_id, variant_id)
);

create table public.inventory_logs (
  id         uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  change     integer not null,
  reason     text not null default 'order',
  order_id   text references public.orders (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.product_stats (
  product_id     text primary key references public.products (id) on delete cascade,
  total_orders   integer not null default 0,
  total_revenue  numeric not null default 0,
  total_quantity integer not null default 0,
  last_sold_at   timestamptz
);

create table public.customer_stats (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  total_orders    integer not null default 0,
  total_spent     numeric not null default 0,
  avg_order_value numeric not null default 0,
  last_order_date timestamptz
);

create table public.analytics (
  period_type text not null check (period_type in ('daily', 'monthly', 'yearly')),
  period_key  text not null,
  revenue     numeric not null default 0,
  orders      integer not null default 0,
  customers   integer not null default 0,
  primary key (period_type, period_key)
);

create table public.settings (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.stock_alerts (
  id         uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

create table public.notification_preferences (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  order_updates boolean not null default true,
  back_in_stock boolean not null default true,
  price_drops   boolean not null default true,
  promotions    boolean not null default false,
  updated_at    timestamptz not null default now()
);

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('order_update', 'back_in_stock', 'price_drop', 'promotion', 'system')),
  title         text not null,
  body          text not null,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  push_status   text not null default 'pending' check (push_status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  push_attempts integer not null default 0,
  claimed_at    timestamptz,
  pushed_at     timestamptz
);

-- -- helper functions (bodies as in the live DB) --------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.app_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

create or replace function public.app_is_guest() returns boolean
language sql stable set search_path = public, pg_catalog as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

create or replace function public.app_effective_price(p_price numeric, p_discount numeric, p_expiry timestamptz)
returns numeric language sql stable as $$
  select case
    when coalesce(p_discount, 0) > 0 and (p_expiry is null or p_expiry > now())
      then round(coalesce(p_price, 0) - coalesce(p_price, 0) * p_discount / 100, 2)
    else round(coalesce(p_price, 0), 2)
  end;
$$;

create or replace function public.app_queue_notification(
  p_user_id uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_push boolean;
begin
  select case p_kind
           when 'order_update'  then np.order_updates
           when 'back_in_stock' then np.back_in_stock
           when 'price_drop'    then np.price_drops
           when 'promotion'     then np.promotions
           else true end
    into v_push
  from public.notification_preferences np where np.user_id = p_user_id;
  if not found then v_push := p_kind <> 'promotion'; end if;
  insert into public.notifications (user_id, kind, title, body, data, push_status)
  values (p_user_id, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb),
          case when v_push then 'pending' else 'skipped' end);
end;
$$;

create table public.price_alerts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  product_id     text not null references public.products (id) on delete cascade,
  price_when_set numeric not null,
  target_price   numeric,
  created_at     timestamptz not null default now(),
  unique (user_id, product_id)
);

-- live trigger function, verbatim from the inventory (back-in-stock + price-drop)
create or replace function public.trg_notify_product_changes() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_old_price numeric := public.app_effective_price(old.price, old.discount, old.discount_expiry);
  v_new_price numeric := public.app_effective_price(new.price, new.discount, new.discount_expiry);
  r record;
begin
  begin
    -- back in stock: one-shot, so the alert rows are consumed
    if coalesce(old.stock, 0) <= 0 and coalesce(new.stock, 0) > 0 then
      for r in select sa.user_id from public.stock_alerts sa where sa.product_id = new.id loop
        perform public.app_queue_notification(
          r.user_id, 'back_in_stock',
          'Back in stock',
          coalesce(new.title, 'An item you wanted') || ' is available again.',
          jsonb_build_object('type', 'product', 'productId', new.id));
      end loop;
      delete from public.stock_alerts where product_id = new.id;
    end if;

    -- price drop: one-shot as well
    if v_new_price < v_old_price then
      for r in
        select pa.id, pa.user_id
        from public.price_alerts pa
        where pa.product_id = new.id
          and v_new_price < pa.price_when_set
          and (pa.target_price is null or v_new_price <= pa.target_price)
      loop
        perform public.app_queue_notification(
          r.user_id, 'price_drop',
          'Price drop',
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
create trigger notify_product_changes
  after update of stock, price, discount, discount_expiry on public.products
  for each row
  when (old.stock is distinct from new.stock or old.price is distinct from new.price
        or old.discount is distinct from new.discount or old.discount_expiry is distinct from new.discount_expiry)
  execute function public.trg_notify_product_changes();

-- -- RLS (policies as listed in the inventory) ------------------------------------
alter table public.profiles       enable row level security;
alter table public.products       enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.cart_items     enable row level security;
alter table public.saved_items    enable row level security;
alter table public.inventory_logs enable row level security;
alter table public.product_stats  enable row level security;
alter table public.customer_stats enable row level security;
alter table public.analytics      enable row level security;
alter table public.settings       enable row level security;
alter table public.stock_alerts   enable row level security;
alter table public.notifications  enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.price_alerts enable row level security;

create policy profiles_select      on public.profiles for select using (auth.uid() = id or is_admin());
create policy profiles_update_self on public.profiles for update using (auth.uid() = id or is_admin());

create policy products_select_all  on public.products for select using (true);
create policy products_admin_write on public.products for all using (is_admin()) with check (is_admin());

create policy orders_select              on public.orders for select using (auth.uid() = user_id or is_admin());
create policy orders_admin_update_status on public.orders for update using (is_admin()) with check (is_admin());

create policy order_items_select on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_items.order_id and (o.user_id = auth.uid() or is_admin())));

create policy cart_items_owner on public.cart_items for all
  using (auth.uid() = user_id or is_admin()) with check (auth.uid() = user_id or is_admin());

create policy "saved items: own" on public.saved_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy inventory_logs_admin on public.inventory_logs for select using (is_admin());
create policy product_stats_admin  on public.product_stats  for select using (is_admin());
create policy customer_stats_admin on public.customer_stats for select using (is_admin());
create policy analytics_admin      on public.analytics      for select using (is_admin());

create policy settings_select_all  on public.settings for select using (true);
create policy settings_admin_write on public.settings for all using (is_admin()) with check (is_admin());

create policy stock_alerts_admin_select on public.stock_alerts for select using (is_admin());
create policy stock_alerts_insert_own   on public.stock_alerts for insert with check (auth.uid() = user_id or user_id is null);

create policy "notifications: read own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "prefs: own" on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Supabase hands every API role ALL privileges on public tables (RLS is the guard)
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- the live create_order_tx is revoked from API roles (service-role only)
-- (applied by the harness after loading live_create_order_tx.sql)