-- ============================================================================
-- Roadmap tasks 7.1 / 7.3 (database half) / 7.4 — Notifications backend
--
--   device_tokens             one row per phone that can receive pushes
--   notification_preferences  per-customer on/off switches
--   price_alerts              "tell me when this gets cheaper"
--   notifications             the in-app inbox AND the push outbox (one table)
--
-- Triggers turn real store events into `notifications` rows:
--   * orders.order_status changes  -> order update
--   * products.stock 0 -> >0       -> "back in stock" for everyone in stock_alerts
--   * products effective price drops -> "price drop" for matching price_alerts
--
-- Sending the actual push is done by the `notifications-dispatch` Edge Function
-- (supabase/functions/notifications-dispatch), which claims pending rows with
-- claim_pending_notifications() and posts them to Expo. Until that function is
-- deployed and a webhook points at it, notifications simply wait in the table -
-- they still show up in-app. Nothing here can send anything by itself.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.
--
-- SAFETY: every trigger body is wrapped so that a failure while WRITING a
-- notification can never block the underlying order status change or stock
-- update (those must always succeed, e.g. while an order is being placed).
-- ============================================================================


-- 0 -- helpers (identical copies live in the other 2026-10-08 migrations) ------
create or replace function public.app_is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.app_is_guest()
returns boolean
language sql stable
set search_path = public, pg_catalog
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- Price a customer actually pays: product price less an un-expired discount.
create or replace function public.app_effective_price(p_price numeric, p_discount numeric, p_expiry timestamptz)
returns numeric
language sql stable
as $$
  select case
    when coalesce(p_discount, 0) > 0 and (p_expiry is null or p_expiry > now())
      then round(coalesce(p_price, 0) - coalesce(p_price, 0) * p_discount / 100, 2)
    else round(coalesce(p_price, 0), 2)
  end;
$$;


-- 1 -- tables -------------------------------------------------------------------
create table if not exists public.device_tokens (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  token        text        not null unique,
  platform     text        not null check (platform in ('ios', 'android', 'web')),
  device_name  text,
  app_version  text,
  enabled      boolean     not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on public.device_tokens (user_id) where enabled;

create table if not exists public.notification_preferences (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  order_updates boolean     not null default true,
  back_in_stock boolean     not null default true,
  price_drops   boolean     not null default true,
  promotions    boolean     not null default false,
  updated_at    timestamptz not null default now()
);

create table if not exists public.price_alerts (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users (id) on delete cascade,
  product_id     text        not null references public.products (id) on delete cascade,
  price_when_set numeric     not null,
  target_price   numeric,                       -- null = notify on any drop
  created_at     timestamptz not null default now(),
  unique (user_id, product_id)
);
create index if not exists price_alerts_product_idx on public.price_alerts (product_id);

create table if not exists public.notifications (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  kind          text        not null check (kind in ('order_update', 'back_in_stock', 'price_drop', 'promotion', 'system')),
  title         text        not null,
  body          text        not null,
  data          jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  push_status   text        not null default 'pending'
                check (push_status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  push_attempts integer     not null default 0,
  claimed_at    timestamptz,
  pushed_at     timestamptz
);
create index if not exists notifications_user_idx    on public.notifications (user_id, created_at desc);
create index if not exists notifications_pending_idx on public.notifications (created_at)
  where push_status in ('pending', 'sending');


-- 2 -- row level security ---------------------------------------------------------
alter table public.device_tokens            enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.price_alerts             enable row level security;
alter table public.notifications            enable row level security;

drop policy if exists "device tokens: read own"   on public.device_tokens;
drop policy if exists "device tokens: delete own" on public.device_tokens;
create policy "device tokens: read own"   on public.device_tokens
  for select to authenticated using (user_id = auth.uid());
create policy "device tokens: delete own" on public.device_tokens
  for delete to authenticated using (user_id = auth.uid());
-- registration goes through register_device_token() (a token can move between
-- accounts on a shared phone, which a plain row-owner policy cannot express)
revoke insert, update on public.device_tokens from anon, authenticated;

drop policy if exists "prefs: own" on public.notification_preferences;
create policy "prefs: own" on public.notification_preferences
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "price alerts: read own"   on public.price_alerts;
drop policy if exists "price alerts: delete own" on public.price_alerts;
create policy "price alerts: read own"   on public.price_alerts
  for select to authenticated using (user_id = auth.uid());
create policy "price alerts: delete own" on public.price_alerts
  for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.price_alerts from anon, authenticated;   -- via set_price_alert()

drop policy if exists "notifications: read own"   on public.notifications;
drop policy if exists "notifications: update own" on public.notifications;
drop policy if exists "notifications: delete own" on public.notifications;
create policy "notifications: read own"   on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications: update own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: delete own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());
-- customers may only flip read_at; everything else is system-managed
revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

revoke all on public.device_tokens, public.notification_preferences,
              public.price_alerts, public.notifications from anon;


-- 3 -- customer-facing RPCs --------------------------------------------------------
create or replace function public.register_device_token(
  p_token text, p_platform text, p_device_name text default null, p_app_version text default null)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_token is null or char_length(btrim(p_token)) < 10 or char_length(p_token) > 300 then
    raise exception 'Invalid device token' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;

  -- A token identifies a physical install. If someone else signs in on the same
  -- phone, the token simply moves to them (so the previous user stops getting
  -- this phone's notifications).
  insert into public.device_tokens (user_id, token, platform, device_name, app_version, enabled, last_seen_at)
  values (v_uid, btrim(p_token), p_platform, left(p_device_name, 100), left(p_app_version, 30), true, now())
  on conflict (token) do update
    set user_id      = excluded.user_id,
        platform     = excluded.platform,
        device_name  = excluded.device_name,
        app_version  = excluded.app_version,
        enabled      = true,
        last_seen_at = now();

  insert into public.notification_preferences (user_id) values (v_uid)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.unregister_device_token(p_token text)
returns void
language sql security definer
set search_path = public, pg_catalog
as $$
  delete from public.device_tokens where token = btrim(p_token) and user_id = auth.uid();
$$;

-- "Tell me when this gets cheaper." The baseline is read from the product row
-- here on the server, so a client cannot fake it.
create or replace function public.set_price_alert(p_product_id text, p_target_price numeric default null)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_now numeric;
begin
  if v_uid is null or public.app_is_guest() then
    raise exception 'Please sign in to set a price alert' using errcode = '28000';
  end if;
  if p_target_price is not null and p_target_price <= 0 then
    raise exception 'Target price must be positive' using errcode = '22023';
  end if;

  select public.app_effective_price(p.price, p.discount, p.discount_expiry) into v_now
  from public.products p where p.id = p_product_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  if p_target_price is not null and p_target_price >= v_now then
    raise exception 'Pick a target below the current price (%)', v_now using errcode = '22023';
  end if;
  if (select count(*) from public.price_alerts a where a.user_id = v_uid) >= 50
     and not exists (select 1 from public.price_alerts a where a.user_id = v_uid and a.product_id = p_product_id) then
    raise exception 'You can have up to 50 price alerts' using errcode = '54000';
  end if;

  insert into public.price_alerts (user_id, product_id, price_when_set, target_price)
  values (v_uid, p_product_id, v_now, p_target_price)
  on conflict (user_id, product_id) do update
    set price_when_set = excluded.price_when_set,
        target_price   = excluded.target_price,
        created_at     = now();

  insert into public.notification_preferences (user_id) values (v_uid)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language sql security definer
set search_path = public, pg_catalog
as $$
  with u as (
    update public.notifications n
       set read_at = now()
     where n.user_id = auth.uid()
       and n.read_at is null
       and (p_ids is null or n.id = any (p_ids))
     returning 1)
  select count(*)::integer from u;
$$;

revoke all on function public.register_device_token(text, text, text, text) from public, anon;
revoke all on function public.unregister_device_token(text)                  from public, anon;
revoke all on function public.set_price_alert(text, numeric)                 from public, anon;
revoke all on function public.mark_notifications_read(uuid[])                from public, anon;
grant execute on function public.register_device_token(text, text, text, text) to authenticated;
grant execute on function public.unregister_device_token(text)                  to authenticated;
grant execute on function public.set_price_alert(text, numeric)                 to authenticated;
grant execute on function public.mark_notifications_read(uuid[])                to authenticated;


-- 4 -- queueing notifications (used by the triggers) ---------------------------------
-- Writes the in-app row for ANY customer's event, honouring that customer's
-- push preference: with the switch off the row is still created (it shows in
-- the inbox) but marked 'skipped' so no push is sent.
create or replace function public.app_queue_notification(
  p_user_id uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_push boolean;
begin
  select case p_kind
           when 'order_update'   then np.order_updates
           when 'back_in_stock'  then np.back_in_stock
           when 'price_drop'     then np.price_drops
           when 'promotion'      then np.promotions
           else true
         end
    into v_push
  from public.notification_preferences np
  where np.user_id = p_user_id;

  -- no preferences row yet = defaults (everything on except promotions)
  if not found then
    v_push := p_kind <> 'promotion';
  end if;

  insert into public.notifications (user_id, kind, title, body, data, push_status)
  values (p_user_id, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb),
          case when v_push then 'pending' else 'skipped' end);
end;
$$;
revoke all on function public.app_queue_notification(uuid, text, text, text, jsonb) from public, anon, authenticated;


-- 5 -- triggers -----------------------------------------------------------------------

-- 5a. order status changes ---------------------------------------------------------
create or replace function public.trg_notify_order_status()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_ref   text := upper(right(new.id::text, 8));
  v_title text;
  v_body  text;
begin
  begin
    if new.user_id is null then return new; end if;
    case lower(coalesce(new.order_status, ''))
      when 'confirmed' then
        v_title := 'Order confirmed';
        v_body  := 'We have confirmed your order #' || v_ref || '.';
      when 'shipped' then
        v_title := 'Your order is on its way';
        v_body  := 'Order #' || v_ref || ' has been shipped.';
      when 'delivered' then
        v_title := 'Order delivered';
        v_body  := 'Order #' || v_ref || ' was delivered. Enjoying it? Leave a review.';
      when 'cancelled' then
        v_title := 'Order cancelled';
        v_body  := 'Order #' || v_ref || ' has been cancelled.';
      else
        return new;
    end case;
    perform public.app_queue_notification(
      new.user_id, 'order_update', v_title, v_body,
      jsonb_build_object('type', 'order', 'orderId', new.id::text, 'status', lower(new.order_status)));
  exception when others then
    raise warning 'trg_notify_order_status skipped: %', sqlerrm;   -- never block the order update
  end;
  return new;
end;
$$;

drop trigger if exists notify_order_status on public.orders;
create trigger notify_order_status
  after update of order_status on public.orders
  for each row
  when (old.order_status is distinct from new.order_status)
  execute function public.trg_notify_order_status();

-- 5b. back in stock + price drops ------------------------------------------------------
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
    raise warning 'trg_notify_product_changes skipped: %', sqlerrm;   -- never block a stock/price update
  end;
  return new;
end;
$$;

drop trigger if exists notify_product_changes on public.products;
create trigger notify_product_changes
  after update of stock, price, discount, discount_expiry on public.products
  for each row
  when (old.stock is distinct from new.stock
        or old.price is distinct from new.price
        or old.discount is distinct from new.discount
        or old.discount_expiry is distinct from new.discount_expiry)
  execute function public.trg_notify_product_changes();


-- 6 -- for the dispatcher Edge Function (service role only) -----------------------------
-- Atomically hands out up to p_limit notifications to ONE caller. FOR UPDATE
-- SKIP LOCKED means two overlapping runs never receive the same row. A row left
-- in 'sending' for over 10 minutes (the function crashed) is handed out again,
-- up to 5 attempts.
create or replace function public.claim_pending_notifications(p_limit integer default 50)
returns setof public.notifications
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  return query
  with picked as (
    select n.id
    from public.notifications n
    where (n.push_status = 'pending'
           or (n.push_status = 'sending' and n.claimed_at < now() - interval '10 minutes'))
      and n.push_attempts < 5
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update skip locked)
  update public.notifications n
     set push_status = 'sending', push_attempts = n.push_attempts + 1, claimed_at = now()
    from picked
   where n.id = picked.id
  returning n.*;
end;
$$;
revoke all on function public.claim_pending_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;

notify pgrst, 'reload schema';