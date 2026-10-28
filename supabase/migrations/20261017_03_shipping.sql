-- ============================================================================
-- M3 — Shipping & tracking: couriers, shipments (+items, +events), orders.delivered_at, order-status guard
--      (IMPLEMENTATION_PLAN Phase 5, DATABASE_CHANGE_PLAN §5 / §6.4; requires M1 .. M2, independent of them otherwise)
--
-- WHAT THIS GIVES THE APP
--   * `orders.delivered_at` — set exactly once, by a trigger, the first time an order becomes 'delivered' (from the shipment's
--     delivery event when there is one). It is the anchor of every return / exchange window (Phase 6+). Existing delivered
--     orders are back-filled from `updated_at` and FLAGGED (`delivered_at_source = 'backfill_updated_at'`): that value is only an
--     approximation (updated_at is rewritten by "mark paid"), the owner can correct single rows as the DB owner.
--   * `couriers` (admin-editable catalogue; 'manual' always exists), `shipments` (what was sent, with which courier, tracking
--     number / link, charges), `shipment_items` (which order lines / quantities are in the parcel), `shipment_events`
--     (courier tracking history, UNIQUE (provider, provider_event_id) => duplicate webhook deliveries are harmless).
--   * RPCs (the ONLY write path; admin-only, one transaction each):
--         ship_order(...)            confirmed/placed -> shipped, creates the shipment, idempotent per (courier, tracking number)
--         add_shipment_event(...)    courier / manual tracking event; recomputes the shipment status from ALL events, so late,
--                                    duplicate and out-of-order events cannot move anything backwards or advance an order twice.
--                                    Callable by the service role as well (courier webhooks).
--         mark_delivered(...)        one click for the admin: delivers every open shipment of the order (or just the order, for
--                                    legacy orders that were shipped before this migration and have no shipment row)
--         update_shipment(...)       fix a typo in the tracking number / link / courier / charges / note
--         cancel_shipment(...)       a parcel recorded by mistake; takes an otherwise-empty order back to 'confirmed'
--   * an order-status GUARD (pending|placed -> confirmed|shipped|cancelled, confirmed -> shipped|cancelled, shipped -> delivered;
--     delivered / cancelled are terminal; inserts such as billing / bulk-import "born delivered" rows are not constrained).
--   * the "order is on its way" notification now carries the courier and tracking number (the generic trigger notification is
--     suppressed for that one update so the customer is not notified twice).
--
-- PRIVACY: customers can read their own shipments / items / events (RLS via the order owner) but NOT the business-side fields:
--   charges, internal note, creator live in `shipment_private` (admin only); the raw event `payload`, provider and creator
--   columns of `shipment_events` are not granted to API roles (select explicit columns, never `*`, on that table).
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M1 / M1b / M1c / M2). SAFE TO RE-RUN. Rollback: 20261017_03_rollback.sql.
-- ROLL-OUT ORDER: SQL first, then the Edge Functions (none change here), then the website, then the RN app.
-- The legacy admin write (orders.update({order_status})) keeps working: the guard only forbids illegal moves, and the
-- delivered_at trigger fires either way.
-- ============================================================================
begin;

-- 1 -- couriers --------------------------------------------------------------------------------------------------------
create table if not exists public.couriers (
  code                  text        primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name                  text        not null check (btrim(name) <> '' and char_length(name) <= 80),
  -- optional link pattern; {tracking} is replaced by the (URL-encoded) tracking number. NULL = the admin pastes a link per shipment.
  tracking_url_template text        check (tracking_url_template is null
                                           or (tracking_url_template ~* '^https?://[^ ]+$' and position('{tracking}' in tracking_url_template) > 0)),
  supports_api          boolean     not null default false,
  active                boolean     not null default true,
  sort_order            integer     not null default 100,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- Names only: the real tracking-link templates are the owner's to fill in (Optimization -> Couriers). Nothing is guessed here.
insert into public.couriers (code, name, supports_api, sort_order) values
  ('manual',       'Other courier (manual)',           false, 10),
  ('pickup',       'Customer pickup / hand delivery',  false, 20),
  ('dtdc',         'DTDC',                             false, 30),
  ('professional', 'Professional Couriers',            false, 40),
  ('indiapost',    'India Post',                       false, 50)
on conflict (code) do nothing;

alter table public.couriers enable row level security;
revoke all on public.couriers from anon, authenticated;
grant select on public.couriers to authenticated;
grant insert, update, delete on public.couriers to authenticated;          -- every write is limited to admins by the policy below
drop policy if exists couriers_read on public.couriers;
create policy couriers_read on public.couriers for select to authenticated using (active or public.app_is_admin());
drop policy if exists couriers_admin_write on public.couriers;
create policy couriers_admin_write on public.couriers for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

-- 2 -- orders.delivered_at ---------------------------------------------------------------------------------------------
alter table public.orders add column if not exists delivered_at        timestamptz;
alter table public.orders add column if not exists delivered_at_source text;
alter table public.orders drop constraint if exists orders_delivered_at_source_check;
alter table public.orders add constraint orders_delivered_at_source_check
  check (delivered_at_source is null or delivered_at_source in ('shipment', 'status_change', 'born_delivered', 'backfill_updated_at', 'manual'));
create index if not exists orders_delivered_at_idx on public.orders (delivered_at) where delivered_at is not null;

-- back-fill (flagged, approximate — see the header). Runs before the triggers exist and touches only these two columns.
update public.orders
   set delivered_at = coalesce(updated_at, created_at), delivered_at_source = 'backfill_updated_at'
 where lower(btrim(coalesce(order_status, ''))) = 'delivered' and delivered_at is null;

-- 3 -- shipments --------------------------------------------------------------------------------------------------------
create table if not exists public.shipments (
  id                     uuid        primary key default gen_random_uuid(),
  order_id               text        not null references public.orders (id) on delete cascade,
  direction              text        not null default 'outbound' check (direction in ('outbound', 'return', 'replacement')),
  courier_code           text        references public.couriers (code) on update cascade on delete restrict,
  courier_name           text        check (courier_name is null or char_length(courier_name) <= 80),     -- snapshot / free text for 'manual'
  tracking_number        text        check (tracking_number is null or (btrim(tracking_number) <> '' and char_length(tracking_number) <= 80)),
  tracking_url           text        check (tracking_url is null or (tracking_url ~* '^https?://[^ ]+$' and char_length(tracking_url) <= 1000)),
  shipped_at             timestamptz,
  expected_delivery_date date,
  delivered_at           timestamptz,
  status                 text        not null default 'created'
                                     check (status in ('created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned_to_sender', 'cancelled')),
  last_event_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists shipments_order_idx    on public.shipments (order_id);
create index if not exists shipments_open_idx     on public.shipments (status) where status not in ('delivered', 'cancelled');
create index if not exists shipments_tracking_idx on public.shipments (courier_code, tracking_number) where tracking_number is not null;

-- business-side fields: admin only (a customer must not see what the parcel cost or what staff wrote about it)
create table if not exists public.shipment_private (
  shipment_id uuid          primary key references public.shipments (id) on delete cascade,
  charges     numeric(12,2) check (charges is null or charges >= 0),
  note        text          check (note is null or char_length(note) <= 500),
  meta        jsonb         not null default '{}'::jsonb,
  created_by  uuid          references public.profiles (id) on delete set null
);

create table if not exists public.shipment_items (
  shipment_id   uuid    not null references public.shipments (id) on delete cascade,
  order_item_id uuid    not null references public.order_items (id) on delete cascade,
  quantity      integer not null check (quantity > 0),
  primary key (shipment_id, order_item_id)
);
create index if not exists shipment_items_order_item_idx on public.shipment_items (order_item_id);

create table if not exists public.shipment_events (
  id                uuid        primary key default gen_random_uuid(),
  shipment_id       uuid        not null references public.shipments (id) on delete cascade,
  provider          text        not null default 'manual' check (provider ~ '^[a-z0-9_]{2,40}$'),
  provider_event_id text        not null check (btrim(provider_event_id) <> '' and char_length(provider_event_id) <= 200),
  event_type        text        not null check (event_type in ('created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered',
                                                              'delivery_failed', 'returned_to_sender', 'cancelled', 'note')),
  occurred_at       timestamptz not null default now(),
  location          text        check (location is null or char_length(location) <= 200),
  description       text        check (description is null or char_length(description) <= 1000),
  payload           jsonb       not null default '{}'::jsonb,
  created_by        uuid        references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint shipment_events_provider_event_uq unique (provider, provider_event_id)
);
create index if not exists shipment_events_shipment_idx on public.shipment_events (shipment_id, occurred_at desc);

alter table public.shipments        enable row level security;
alter table public.shipment_private enable row level security;
alter table public.shipment_items   enable row level security;
alter table public.shipment_events  enable row level security;
revoke all on public.shipments, public.shipment_private, public.shipment_items, public.shipment_events from anon, authenticated;
grant select on public.shipments, public.shipment_private, public.shipment_items to authenticated;
-- events: only the customer-safe columns (the admin UI does not need the raw payload either); writes are RPC-only
grant select (id, shipment_id, event_type, occurred_at, location, description, created_at) on public.shipment_events to authenticated;

drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.orders o where o.id = shipments.order_id and o.user_id = auth.uid()));
drop policy if exists shipment_private_select on public.shipment_private;
create policy shipment_private_select on public.shipment_private for select to authenticated using (public.app_is_admin());
drop policy if exists shipment_items_select on public.shipment_items;
create policy shipment_items_select on public.shipment_items for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.shipments s join public.orders o on o.id = s.order_id
                                            where s.id = shipment_items.shipment_id and o.user_id = auth.uid()));
drop policy if exists shipment_events_select on public.shipment_events;
create policy shipment_events_select on public.shipment_events for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.shipments s join public.orders o on o.id = s.order_id
                                            where s.id = shipment_events.shipment_id and o.user_id = auth.uid()));

-- 4 -- small helpers --------------------------------------------------------------------------------------------------
create or replace function public.app_is_service_role()
returns boolean
language sql stable
set search_path = public, pg_catalog
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

-- percent-encoding of one path/query value (unreserved characters are kept)
create or replace function public.app_urlencode(p text)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select coalesce(string_agg(
           case when s.ch ~ '^[A-Za-z0-9_.~-]$' then s.ch
                else (select string_agg('%' || upper(lpad(to_hex(get_byte(s.b, g.i)), 2, '0')), '' order by g.i)
                        from generate_series(0, length(s.b) - 1) as g(i)) end,
           '' order by s.ord), '')
  from (select r.ch, convert_to(r.ch, 'UTF8') as b, r.ord
          from regexp_split_to_table(coalesce(p, ''), '') with ordinality as r(ch, ord)) s
$$;

create or replace function public.app_courier_tracking_url(p_code text, p_tracking text)
returns text
language sql stable
set search_path = public, pg_catalog
as $$
  select case when nullif(btrim(coalesce(p_tracking, '')), '') is null then null
              else replace(c.tracking_url_template, '{tracking}', public.app_urlencode(btrim(p_tracking))) end
    from public.couriers c
   where c.code = p_code and c.tracking_url_template is not null
$$;

create or replace function public.app_shipment_event_rank(p text)
returns integer
language sql immutable
as $$
  select case p when 'created' then 0 when 'picked_up' then 1 when 'in_transit' then 2 when 'out_for_delivery' then 3
               when 'delivery_failed' then 4 when 'returned_to_sender' then 5 when 'delivered' then 6 else -1 end
$$;

-- units of an order line that are not yet on an active outbound shipment
create or replace function public.app_order_item_remaining(p_order_item_id uuid)
returns integer
language sql stable
set search_path = public, pg_catalog
as $$
  select oi.quantity - coalesce((select sum(si.quantity)::integer
                                   from public.shipment_items si join public.shipments s on s.id = si.shipment_id
                                  where si.order_item_id = oi.id and s.direction = 'outbound' and s.status <> 'cancelled'), 0)
    from public.order_items oi where oi.id = p_order_item_id
$$;

-- 5 -- guards -----------------------------------------------------------------------------------------------------------
-- 5a. order status transitions. BEFORE UPDATE OF order_status; fires only when the value changes.
create or replace function public.trg_orders_status_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_old   text := lower(btrim(coalesce(old.order_status, '')));
  v_new   text := lower(btrim(coalesce(new.order_status, '')));
  v_known text[] := array['pending', 'placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  v_ok    boolean;
begin
  if v_old = v_new then return new; end if;
  -- cancel_shipment() may take an order whose last parcel was recorded by mistake back from 'shipped'. It runs as the function
  -- owner; an API role (anon / authenticated / service_role) can never switch the guard off by setting the flag itself.
  if coalesce(current_setting('app.order_status_guard', true), '') = 'off'
     and current_user <> all (array['anon', 'authenticated', 'service_role']) then
    return new;
  end if;
  if v_new <> all (v_known) then
    raise exception 'Illegal order status "%": allowed values are %', new.order_status, array_to_string(v_known, ', ')
      using errcode = '23514';
  end if;
  v_ok := case v_old
            when 'pending'   then v_new in ('placed', 'confirmed', 'shipped', 'cancelled')
            when 'placed'    then v_new in ('confirmed', 'shipped', 'cancelled')
            when 'confirmed' then v_new in ('shipped', 'cancelled')
            when 'shipped'   then v_new in ('delivered')
            when 'delivered' then false
            when 'cancelled' then false
            else v_new in ('confirmed', 'shipped', 'delivered', 'cancelled')       -- an unknown legacy value may move to any known state
          end;
  if not v_ok then
    raise exception 'Illegal order status change: % -> %', coalesce(old.order_status, '(none)'), new.order_status
      using errcode = '23514', hint = 'Allowed: pending/placed -> confirmed|shipped|cancelled, confirmed -> shipped|cancelled, shipped -> delivered.';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_10_status_guard on public.orders;
create trigger orders_10_status_guard
  before update of order_status on public.orders
  for each row
  when (old.order_status is distinct from new.order_status)
  execute function public.trg_orders_status_guard();

-- 5b. delivered_at: set once, never moved by an API caller (the DB owner may still correct a back-filled value)
create or replace function public.trg_orders_delivered_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_ship timestamptz;
begin
  if tg_op = 'UPDATE' and old.delivered_at is not null and new.delivered_at is distinct from old.delivered_at
     and current_user = any (array['anon', 'authenticated', 'service_role']) then
    new.delivered_at := old.delivered_at;
    new.delivered_at_source := old.delivered_at_source;
  end if;
  if lower(btrim(coalesce(new.order_status, ''))) = 'delivered' and new.delivered_at is null then
    if tg_op = 'INSERT' then
      new.delivered_at := coalesce(new.created_at, now());
      new.delivered_at_source := coalesce(new.delivered_at_source, 'born_delivered');
    else
      select max(s.delivered_at) into v_ship
        from public.shipments s where s.order_id = new.id and s.direction = 'outbound' and s.status = 'delivered';
      new.delivered_at := coalesce(v_ship, now());
      new.delivered_at_source := case when v_ship is not null then 'shipment' else 'status_change' end;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_20_delivered_at on public.orders;
create trigger orders_20_delivered_at
  before insert or update on public.orders
  for each row
  execute function public.trg_orders_delivered_at();

-- 5c. a shipment line can never carry more units than the order line has (outbound, summed over active shipments)
create or replace function public.trg_shipment_items_cap()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_dir    text;
  v_status text;
  v_cap    integer;
  v_used   integer;
begin
  if not exists (select 1 from public.shipments s join public.order_items oi on oi.order_id = s.order_id
                  where s.id = new.shipment_id and oi.id = new.order_item_id) then
    raise exception 'Order line % does not belong to the order of shipment %', new.order_item_id, new.shipment_id using errcode = '23514';
  end if;
  select s.direction, s.status into v_dir, v_status from public.shipments s where s.id = new.shipment_id;
  if v_dir = 'outbound' and v_status <> 'cancelled' then
    select oi.quantity into v_cap from public.order_items oi where oi.id = new.order_item_id;
    select coalesce(sum(si.quantity), 0) into v_used
      from public.shipment_items si join public.shipments s on s.id = si.shipment_id
     where si.order_item_id = new.order_item_id and s.direction = 'outbound' and s.status <> 'cancelled'
       and si.shipment_id <> new.shipment_id;
    if v_used + new.quantity > v_cap then
      raise exception 'Cannot ship % unit(s) of order line % (ordered %, already on other shipments %)', new.quantity, new.order_item_id, v_cap, v_used
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists shipment_items_10_cap on public.shipment_items;
create trigger shipment_items_10_cap
  before insert or update on public.shipment_items
  for each row
  execute function public.trg_shipment_items_cap();

-- 6 -- the generic "order status changed" notification, now skippable for ONE statement ----------------------------------
-- Identical to the live function (20261008_04) except for the first lines: ship_order() / cancel_shipment() set the
-- transaction-local flag `app.skip_order_notify` so the customer gets the richer message (courier + tracking number) once.
create or replace function public.trg_notify_order_status()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_ref   text := upper(right(new.id::text, 8));
  v_title text;
  v_body  text;
begin
  begin
    if coalesce(current_setting('app.skip_order_notify', true), '') = 'on' then return new; end if;
    if new.user_id is null then return new; end if;
    case lower(coalesce(new.order_status, ''))
      when 'confirmed' then
        v_title := 'Order confirmed';
        v_body  := 'We have confirmed your order #' || v_ref || '.';
      when 'shipped' then
        v_title := 'Your order is on its way';
        v_body  := 'Order #' || v_ref || ' has been shipped.';
      when 'delivered' then
        v_title := 'Order delivered';
        v_body  := 'Order #' || v_ref || ' was delivered. Enjoying it? Leave a review.';
      when 'cancelled' then
        v_title := 'Order cancelled';
        v_body  := 'Order #' || v_ref || ' has been cancelled.';
      else
        return new;
    end case;
    perform public.app_queue_notification(
      new.user_id, 'order_update', v_title, v_body,
      jsonb_build_object('type', 'order', 'orderId', new.id::text, 'status', lower(new.order_status)));
  exception when others then
    raise warning 'trg_notify_order_status skipped: %', sqlerrm;   -- never block the order update
  end;
  return new;
end;
$$;

-- 7 -- the internal event recorder (NOT callable by API roles; the public RPCs below check who is calling) -----------------
create or replace function public.app_record_shipment_event(
  p_shipment_id uuid, p_event_type text, p_occurred_at timestamptz, p_location text, p_description text,
  p_provider text, p_key text, p_payload jsonb, p_actor uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_order_id  text;
  v_order     public.orders;
  v_ship      public.shipments;
  v_rows      integer;
  v_old       text;
  v_new       text;
  v_latest    text;
  v_last      timestamptz;
  v_deliv     timestamptz;
  v_done      boolean;
  v_ref       text;
  v_title     text;
  v_body      text;
begin
  select s.order_id into v_order_id from public.shipments s where s.id = p_shipment_id;
  if v_order_id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  -- lock order: ORDER first, then SHIPMENT (ship_order / cancel_shipment use the same order)
  select * into v_order from public.orders where id = v_order_id for update;
  select * into v_ship  from public.shipments where id = p_shipment_id for update;
  if v_ship.status = 'cancelled' then raise exception 'This shipment was cancelled' using errcode = '22023'; end if;
  v_old := v_ship.status;

  insert into public.shipment_events (shipment_id, provider, provider_event_id, event_type, occurred_at, location, description, payload, created_by)
  values (p_shipment_id, p_provider, p_key, p_event_type, coalesce(p_occurred_at, now()),
          nullif(btrim(coalesce(p_location, '')), ''), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_payload, '{}'::jsonb), p_actor)
  on conflict (provider, provider_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then      -- the same event delivered again (retry, double click, duplicate webhook): nothing changes
    return jsonb_build_object('ok', true, 'inserted', false, 'status', v_ship.status, 'order_status', v_order.order_status);
  end if;

  if p_event_type <> 'note' then
    -- the status is recomputed from ALL events, so arrival order does not matter; 'delivered' is sticky
    select min(e.occurred_at) into v_deliv from public.shipment_events e where e.shipment_id = p_shipment_id and e.event_type = 'delivered';
    if v_deliv is not null then
      v_new := 'delivered';
    else
      select e.event_type into v_latest
        from public.shipment_events e
       where e.shipment_id = p_shipment_id and e.event_type not in ('note', 'cancelled')
       order by e.occurred_at desc, public.app_shipment_event_rank(e.event_type) desc, e.created_at desc
       limit 1;
      v_new := coalesce(v_latest, 'created');
    end if;
    select max(e.occurred_at) into v_last from public.shipment_events e where e.shipment_id = p_shipment_id and e.event_type <> 'note';
    update public.shipments
       set status = v_new, last_event_at = v_last, updated_at = now(),
           delivered_at = case when v_new = 'delivered' then v_deliv else delivered_at end
     where id = p_shipment_id;

    -- the order is delivered when EVERY unit of it has arrived (outbound shipments only)
    if v_ship.direction = 'outbound' and v_new = 'delivered' and lower(btrim(coalesce(v_order.order_status, ''))) = 'shipped' then
      v_done := not exists (select 1 from public.shipments s
                             where s.order_id = v_order.id and s.direction = 'outbound' and s.id <> p_shipment_id
                               and s.status not in ('delivered', 'cancelled'))
            and not exists (select 1 from public.order_items oi
                             where oi.order_id = v_order.id
                               and oi.quantity > coalesce((select sum(si.quantity) from public.shipment_items si join public.shipments s on s.id = si.shipment_id
                                                            where si.order_item_id = oi.id and s.direction = 'outbound' and s.status = 'delivered'), 0));
      -- an order recorded without any item rows (legacy) has nothing to compare: the shipment decides
      if v_done then
        update public.orders set order_status = 'delivered', updated_at = now() where id = v_order.id;     -- delivered_at comes from the shipment
      end if;
    end if;

    -- customer-visible changes only (not for late events that do not change the current status)
    if v_old is distinct from v_new and v_new in ('out_for_delivery', 'delivery_failed', 'returned_to_sender') and v_order.user_id is not null
       and v_ship.direction = 'outbound' then
      begin
        v_ref := upper(right(v_order.id::text, 8));
        if v_new = 'out_for_delivery' then
          v_title := 'Out for delivery'; v_body := 'Order #' || v_ref || ' is out for delivery.';
        elsif v_new = 'delivery_failed' then
          v_title := 'Delivery attempt failed'; v_body := 'The courier could not deliver order #' || v_ref || '. We will get in touch to arrange a new attempt.';
        else
          v_title := 'Parcel returned to us'; v_body := 'The parcel of order #' || v_ref || ' is coming back to us. We will contact you.';
        end if;
        perform public.app_queue_notification(
          v_order.user_id, 'order_update', v_title, v_body,
          jsonb_build_object('type', 'order', 'orderId', v_order.id, 'status', lower(v_order.order_status),
                             'shipmentId', v_ship.id, 'shipmentStatus', v_new));
      exception when others then
        raise warning 'shipment notification skipped: %', sqlerrm;
      end;
    end if;
  end if;

  select * into v_ship from public.shipments where id = p_shipment_id;
  return jsonb_build_object('ok', true, 'inserted', true, 'status', v_ship.status,
                            'order_status', (select o.order_status from public.orders o where o.id = v_order.id));
end;
$$;
revoke all on function public.app_record_shipment_event(uuid, text, timestamptz, text, text, text, text, jsonb, uuid) from public, anon, authenticated, service_role;

-- 8 -- ship_order ---------------------------------------------------------------------------------------------------------
create or replace function public.ship_order(
  p_order_id              text,
  p_courier_code          text    default 'manual',
  p_tracking_number       text    default null,
  p_tracking_url          text    default null,
  p_shipped_at            timestamptz default null,
  p_charges               numeric default null,
  p_note                  text    default null,
  p_items                 jsonb   default null,       -- [{ "order_item_id": "<uuid>", "quantity": n }]; NULL / [] = every unit not yet shipped
  p_courier_name          text    default null,       -- free text, used when the courier is 'manual' (or to override the catalogue name)
  p_expected_delivery_date date   default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid     uuid := auth.uid();
  v_order   public.orders;
  v_status  text;
  v_courier public.couriers;
  v_code    text := coalesce(nullif(btrim(coalesce(p_courier_code, '')), ''), 'manual');
  v_track   text := nullif(btrim(coalesce(p_tracking_number, '')), '');
  v_url     text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  v_name    text;
  v_plan    jsonb := '[]'::jsonb;
  v_seen    uuid[] := '{}';
  v_e       jsonb;
  v_iid     uuid;
  v_qty     integer;
  v_rem     integer;
  v_dup     public.shipments;
  v_ship    public.shipments;
  v_when    timestamptz := coalesce(p_shipped_at, now());
  v_ref     text;
  v_body    text;
begin
  if v_uid is null or not public.app_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  v_status := lower(btrim(coalesce(v_order.order_status, '')));
  if v_status not in ('placed', 'confirmed', 'shipped') then
    raise exception 'An order that is "%" cannot be shipped', coalesce(v_order.order_status, '(no status)') using errcode = '22023';
  end if;
  select * into v_courier from public.couriers where code = v_code;
  if not found then raise exception 'Unknown courier "%"', v_code using errcode = '22023'; end if;
  if not v_courier.active then raise exception 'The courier "%" is switched off', v_courier.name using errcode = '22023'; end if;
  if v_url is not null and v_url !~* '^https?://[^ ]+$' then
    raise exception 'The tracking link must start with http:// or https:// and contain no spaces' using errcode = '22023';
  end if;
  if p_charges is not null and p_charges < 0 then raise exception 'Shipping charges cannot be negative' using errcode = '22023'; end if;
  if v_when > now() + interval '1 day' then raise exception 'The shipping date cannot be in the future' using errcode = '22023'; end if;
  v_name := coalesce(nullif(btrim(coalesce(p_courier_name, '')), ''), v_courier.name);

  -- retry safety: the same courier + tracking number on this order is the same parcel
  if v_track is not null then
    select * into v_dup from public.shipments s
     where s.order_id = v_order.id and s.direction = 'outbound' and s.status <> 'cancelled'
       and s.courier_code = v_code and s.tracking_number = v_track
     limit 1;
    if found then
      return jsonb_build_object('ok', true, 'created', false, 'shipment', to_jsonb(v_dup), 'order_status', v_order.order_status);
    end if;
  end if;

  -- what goes into the parcel
  if p_items is null or p_items = 'null'::jsonb or (jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) = 0) then
    select coalesce(jsonb_agg(jsonb_build_object('order_item_id', r.id, 'quantity', r.remaining) order by r.id), '[]'::jsonb) into v_plan
      from (select oi.id, public.app_order_item_remaining(oi.id) as remaining from public.order_items oi where oi.order_id = v_order.id) r
     where r.remaining > 0;
  else
    if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a list of { order_item_id, quantity }' using errcode = '22023'; end if;
    for v_e in select e.value from jsonb_array_elements(p_items) as e loop
      if jsonb_typeof(v_e) <> 'object' then raise exception 'Each shipped item must be an object' using errcode = '22023'; end if;
      begin
        v_iid := (v_e ->> 'order_item_id')::uuid;
        v_qty := (v_e ->> 'quantity')::integer;
      exception when others then
        raise exception 'Each shipped item needs a valid order_item_id and a whole-number quantity' using errcode = '22023';
      end;
      if v_qty is null or v_qty < 1 then raise exception 'The quantity of a shipped item must be at least 1' using errcode = '22023'; end if;
      if v_iid = any (v_seen) then raise exception 'Order line % appears twice in the shipment', v_iid using errcode = '22023'; end if;
      v_seen := v_seen || v_iid;
      if not exists (select 1 from public.order_items oi where oi.id = v_iid and oi.order_id = v_order.id) then
        raise exception 'Order line % does not belong to order %', v_iid, v_order.id using errcode = '22023';
      end if;
      v_rem := public.app_order_item_remaining(v_iid);
      if v_qty > v_rem then
        raise exception 'Only % unit(s) of order line % are left to ship (asked for %)', v_rem, v_iid, v_qty using errcode = '22023';
      end if;
      v_plan := v_plan || jsonb_build_array(jsonb_build_object('order_item_id', v_iid, 'quantity', v_qty));
    end loop;
  end if;
  if jsonb_array_length(v_plan) = 0 then
    raise exception 'Every item of this order is already on a shipment' using errcode = '22023';
  end if;

  insert into public.shipments (order_id, direction, courier_code, courier_name, tracking_number, tracking_url, shipped_at, expected_delivery_date, status, last_event_at)
  values (v_order.id, 'outbound', v_code, v_name, v_track, coalesce(v_url, public.app_courier_tracking_url(v_code, v_track)), v_when, p_expected_delivery_date, 'created', v_when)
  returning * into v_ship;
  insert into public.shipment_private (shipment_id, charges, note, created_by)
  values (v_ship.id, p_charges, nullif(btrim(coalesce(p_note, '')), ''), v_uid);
  insert into public.shipment_items (shipment_id, order_item_id, quantity)
  select v_ship.id, (x.value ->> 'order_item_id')::uuid, (x.value ->> 'quantity')::integer from jsonb_array_elements(v_plan) as x;
  insert into public.shipment_events (shipment_id, provider, provider_event_id, event_type, occurred_at, description, created_by)
  values (v_ship.id, 'manual', 'created:' || v_ship.id::text, 'created', v_when, 'Shipment created', v_uid);

  if v_status in ('placed', 'confirmed') then
    perform set_config('app.skip_order_notify', 'on', true);
    update public.orders set order_status = 'shipped', updated_at = now() where id = v_order.id;
    perform set_config('app.skip_order_notify', 'off', true);
    if v_order.user_id is not null then
      begin
        v_ref  := upper(right(v_order.id::text, 8));
        v_body := 'Order #' || v_ref || ' has been shipped' || case when v_name is not null then ' with ' || v_name else '' end
                  || case when v_track is not null then '. Tracking number: ' || v_track else '' end || '.';
        perform public.app_queue_notification(
          v_order.user_id, 'order_update', 'Your order is on its way', v_body,
          jsonb_build_object('type', 'order', 'orderId', v_order.id, 'status', 'shipped', 'shipmentId', v_ship.id,
                             'courier', v_name, 'trackingNumber', v_track, 'trackingUrl', v_ship.tracking_url));
      exception when others then
        raise warning 'ship_order notification skipped: %', sqlerrm;
      end;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'created', true, 'shipment', to_jsonb(v_ship),
                            'order_status', (select o.order_status from public.orders o where o.id = v_order.id));
end;
$$;

-- 9 -- add_shipment_event -------------------------------------------------------------------------------------------------
create or replace function public.add_shipment_event(
  p_shipment_id       uuid,
  p_event_type        text,
  p_occurred_at       timestamptz default null,
  p_location          text        default null,
  p_description       text        default null,
  p_provider          text        default 'manual',
  p_provider_event_id text        default null,      -- the courier's own id (webhooks) or a client-generated uuid (retry-safe manual calls)
  p_payload           jsonb       default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_service  boolean := public.app_is_service_role();
  v_uid      uuid := auth.uid();
  v_provider text;
  v_key      text;
begin
  if not v_service and (v_uid is null or not public.app_is_admin()) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_event_type is null or p_event_type not in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returned_to_sender', 'note') then
    raise exception 'Unknown shipment event type "%"', coalesce(p_event_type, '') using errcode = '22023';
  end if;
  if p_occurred_at is not null and p_occurred_at > now() + interval '10 minutes' then
    raise exception 'The event time cannot be in the future' using errcode = '22023';
  end if;
  -- only the service role (courier webhooks) may name another provider; an admin's events are always 'manual'
  v_provider := case when v_service then lower(coalesce(nullif(btrim(coalesce(p_provider, '')), ''), 'manual')) else 'manual' end;
  v_key := coalesce(nullif(btrim(coalesce(p_provider_event_id, '')), ''), gen_random_uuid()::text);
  return public.app_record_shipment_event(p_shipment_id, p_event_type, p_occurred_at, p_location, p_description,
                                          v_provider, v_key, p_payload, v_uid);
end;
$$;

-- 10 -- mark_delivered ------------------------------------------------------------------------------------------------------
create or replace function public.mark_delivered(p_order_id text, p_delivered_at timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid    uuid := auth.uid();
  v_order  public.orders;
  v_status text;
  v_when   timestamptz := coalesce(p_delivered_at, now());
  v_s      record;
  v_open   integer := 0;
begin
  if v_uid is null or not public.app_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if v_when > now() + interval '10 minutes' then raise exception 'The delivery time cannot be in the future' using errcode = '22023'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  v_status := lower(btrim(coalesce(v_order.order_status, '')));
  if v_status = 'delivered' then
    return jsonb_build_object('ok', true, 'already', true, 'order_status', v_order.order_status, 'delivered_at', v_order.delivered_at);
  end if;
  if v_status <> 'shipped' then
    raise exception 'Only a shipped order can be marked delivered (this one is "%")', coalesce(v_order.order_status, '(no status)') using errcode = '22023';
  end if;

  for v_s in select s.id from public.shipments s
              where s.order_id = v_order.id and s.direction = 'outbound' and s.status not in ('delivered', 'cancelled') order by s.created_at loop
    v_open := v_open + 1;
    perform public.app_record_shipment_event(v_s.id, 'delivered', v_when, null, 'Marked as delivered', 'manual', 'delivered:' || v_s.id::text, '{}'::jsonb, v_uid);
  end loop;

  select * into v_order from public.orders where id = p_order_id;
  if lower(btrim(coalesce(v_order.order_status, ''))) <> 'delivered' then
    -- a legacy order shipped before M3 has no shipment row: deliver the order itself
    update public.orders
       set order_status = 'delivered', updated_at = now(),
           delivered_at = coalesce(delivered_at, v_when), delivered_at_source = coalesce(delivered_at_source, 'manual')
     where id = v_order.id;
    select * into v_order from public.orders where id = p_order_id;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'order_status', v_order.order_status, 'delivered_at', v_order.delivered_at, 'shipments_delivered', v_open);
end;
$$;

-- 11 -- update_shipment (fix typos) ---------------------------------------------------------------------------------------------
-- p_patch keys (all optional; a key that is present — even with null — is applied):
--   courier_code, courier_name, tracking_number, tracking_url, shipped_at, expected_delivery_date, charges, note
-- When the link was generated from the courier template and the tracking number changes, the link is regenerated.
create or replace function public.update_shipment(p_shipment_id uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid     uuid := auth.uid();
  v_order_id text;
  v_ship    public.shipments;
  v_priv    public.shipment_private;
  v_k       text;
  v_code    text;
  v_track   text;
  v_url     text;
  v_auto    boolean;
  v_name    text;
begin
  if v_uid is null or not public.app_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'p_patch must be an object' using errcode = '22023'; end if;
  for v_k in select k from jsonb_object_keys(p_patch) as k loop
    if v_k <> all (array['courier_code', 'courier_name', 'tracking_number', 'tracking_url', 'shipped_at', 'expected_delivery_date', 'charges', 'note']) then
      raise exception 'Unknown shipment field "%"', v_k using errcode = '22023';
    end if;
  end loop;
  select s.order_id into v_order_id from public.shipments s where s.id = p_shipment_id;
  if v_order_id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_order_id for update;
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if v_ship.status = 'cancelled' then raise exception 'This shipment was cancelled' using errcode = '22023'; end if;

  v_code  := v_ship.courier_code;
  v_name  := v_ship.courier_name;
  v_track := v_ship.tracking_number;
  v_url   := v_ship.tracking_url;
  v_auto  := v_ship.tracking_url is not distinct from public.app_courier_tracking_url(v_ship.courier_code, v_ship.tracking_number);

  if p_patch ? 'courier_code' then
    v_code := coalesce(nullif(btrim(coalesce(p_patch ->> 'courier_code', '')), ''), 'manual');
    if not exists (select 1 from public.couriers c where c.code = v_code) then raise exception 'Unknown courier "%"', v_code using errcode = '22023'; end if;
    if not (p_patch ? 'courier_name') then select c.name into v_name from public.couriers c where c.code = v_code; end if;
  end if;
  if p_patch ? 'courier_name'    then v_name  := nullif(btrim(coalesce(p_patch ->> 'courier_name', '')), ''); end if;
  if p_patch ? 'tracking_number' then v_track := nullif(btrim(coalesce(p_patch ->> 'tracking_number', '')), ''); end if;
  if p_patch ? 'tracking_url' then
    v_url := nullif(btrim(coalesce(p_patch ->> 'tracking_url', '')), '');
    if v_url is not null and v_url !~* '^https?://[^ ]+$' then
      raise exception 'The tracking link must start with http:// or https:// and contain no spaces' using errcode = '22023';
    end if;
  elsif v_auto or v_url is null then
    v_url := public.app_courier_tracking_url(v_code, v_track);        -- follows the tracking number / courier while it was never typed by hand
  end if;

  update public.shipments
     set courier_code = v_code, courier_name = v_name, tracking_number = v_track, tracking_url = v_url,
         shipped_at = case when p_patch ? 'shipped_at' then (p_patch ->> 'shipped_at')::timestamptz else shipped_at end,
         expected_delivery_date = case when p_patch ? 'expected_delivery_date' then (p_patch ->> 'expected_delivery_date')::date else expected_delivery_date end,
         updated_at = now()
   where id = p_shipment_id
   returning * into v_ship;

  insert into public.shipment_private (shipment_id, created_by) values (p_shipment_id, v_uid) on conflict (shipment_id) do nothing;
  if p_patch ? 'charges' then
    update public.shipment_private set charges = nullif(p_patch ->> 'charges', '')::numeric where shipment_id = p_shipment_id;
  end if;
  if p_patch ? 'note' then
    update public.shipment_private set note = nullif(btrim(coalesce(p_patch ->> 'note', '')), '') where shipment_id = p_shipment_id;
  end if;
  insert into public.shipment_events (shipment_id, provider, provider_event_id, event_type, occurred_at, description, created_by)
  values (p_shipment_id, 'manual', 'edit:' || gen_random_uuid()::text, 'note', now(), 'Shipment details updated', v_uid);
  select * into v_priv from public.shipment_private where shipment_id = p_shipment_id;
  return jsonb_build_object('ok', true, 'shipment', to_jsonb(v_ship), 'charges', v_priv.charges, 'note', v_priv.note);
end;
$$;

-- 12 -- cancel_shipment -----------------------------------------------------------------------------------------------------
create or replace function public.cancel_shipment(p_shipment_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid      uuid := auth.uid();
  v_order_id text;
  v_order    public.orders;
  v_ship     public.shipments;
  v_open     integer;
begin
  if v_uid is null or not public.app_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select s.order_id into v_order_id from public.shipments s where s.id = p_shipment_id;
  if v_order_id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  select * into v_order from public.orders where id = v_order_id for update;
  select * into v_ship  from public.shipments where id = p_shipment_id for update;
  if v_ship.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already', true, 'order_status', v_order.order_status);
  end if;
  if v_ship.status = 'delivered' then raise exception 'A delivered shipment cannot be cancelled' using errcode = '22023'; end if;

  update public.shipments set status = 'cancelled', updated_at = now() where id = p_shipment_id;
  insert into public.shipment_events (shipment_id, provider, provider_event_id, event_type, occurred_at, description, created_by)
  values (p_shipment_id, 'manual', 'cancel:' || p_shipment_id::text, 'cancelled', now(),
          coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Shipment cancelled'), v_uid);

  select count(*) into v_open from public.shipments s
   where s.order_id = v_order.id and s.direction = 'outbound' and s.status <> 'cancelled';
  if v_ship.direction = 'outbound' and v_open = 0 and lower(btrim(coalesce(v_order.order_status, ''))) = 'shipped' then
    perform set_config('app.order_status_guard', 'off', true);
    perform set_config('app.skip_order_notify', 'on', true);
    update public.orders set order_status = 'confirmed', updated_at = now() where id = v_order.id;
    perform set_config('app.order_status_guard', 'on', true);
    perform set_config('app.skip_order_notify', 'off', true);
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'order_status', (select o.order_status from public.orders o where o.id = v_order.id));
end;
$$;

-- 13 -- grants -------------------------------------------------------------------------------------------------------------------
revoke all on function public.ship_order(text, text, text, text, timestamptz, numeric, text, jsonb, text, date) from public, anon;
revoke all on function public.add_shipment_event(uuid, text, timestamptz, text, text, text, text, jsonb) from public, anon;
revoke all on function public.mark_delivered(text, timestamptz) from public, anon;
revoke all on function public.update_shipment(uuid, jsonb) from public, anon;
revoke all on function public.cancel_shipment(uuid, text) from public, anon;
grant execute on function public.ship_order(text, text, text, text, timestamptz, numeric, text, jsonb, text, date) to authenticated;     -- the admin check is inside
grant execute on function public.add_shipment_event(uuid, text, timestamptz, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.mark_delivered(text, timestamptz) to authenticated;
grant execute on function public.update_shipment(uuid, jsonb) to authenticated;
grant execute on function public.cancel_shipment(uuid, text) to authenticated;

-- 14 -- realtime (admin lists refresh when a shipment moves; skipped where the publication does not exist) ---------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['shipments', 'shipment_events'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';