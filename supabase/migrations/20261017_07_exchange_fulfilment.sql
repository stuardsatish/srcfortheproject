-- ============================================================================
-- M5b — EXCHANGE PROCESSING and REPLACEMENT FULFILMENT (IMPLEMENTATION_PLAN Phase 10; requires M3 shipments, M4 / M4b requests, M5 refunds)
--
-- An exchange is not a status change: the customer sends item A back and receives item B. This migration makes that traceable and safe:
--
--   exchange_reservations        the replacement STOCK held for each approved exchange line (ledger movements exchange_reserve / exchange_release,
--                                idempotent: a retry never deducts twice). Admin only.
--   replacement_fulfillments     ONE per exchange request, created when the request reaches `replacement_pending`; links the request, the original
--   replacement_fulfillment_items   order and the replacement SHIPMENT (shipments.direction = 'replacement'). Items = what is sent (the replacement
--                                option, its price) and which ORIGINAL order line it replaces. The original order / order_items are never touched
--                                (D-12: an exchange creates NO new orders row).
--   exchange_adjustments         the price difference, RECORDED never silently charged or refunded: none | balance_due (replacement dearer) |
--                                refund_due (replacement cheaper). It is settled explicitly: collected / waived by an admin, or refunded through the
--                                M5 refund machinery (refunds.kind = 'exchange_difference'). exchange_adjustment_private keeps references / notes.
--
-- WHEN STOCK MOVES (DATABASE_CHANGE_PLAN 6.3):
--   * a request / a line pending           -> nothing happens to stock.
--   * the admin APPROVES an exchange line   -> the replacement is checked (still active, in stock) and RESERVED (stock - qty, movement exchange_reserve,
--                                              key exres:<line id>). Out of stock = the approval is refused as a whole, nothing is half-reserved.
--   * line cancelled / rejected / FAILED the inspection, or the exchange cancelled -> RELEASED (stock + qty, exchange_release, key exrel:<line id>).
--   * the replacement ships                 -> the reservation becomes `fulfilled` (the stock already left; nothing moves twice).
--   * the shipment is cancelled before delivery -> the reservation is `reserved` again and the exchange goes back to `replacement_pending`.
--   The RETURNED item is never restocked here (it follows the inspection rule of Phase 11, independently).
--
-- THE PRICE DIFFERENCE: per line = (the replacement's price when it was RESERVED - the ORIGINAL order line's unit price) x quantity; the exchange's
-- adjustment is the net of its lines. balance_due must be collected (or waived) BEFORE the replacement ships; a refund_due is paid through
-- create_exchange_refund (razorpay or manual, same safeguards as M5) or waived. The exchange closes automatically once the replacement is DELIVERED
-- and the difference is settled; an admin cannot close it while a difference is open.
--
-- EXCHANGE TYPES (explicit): the SAME product in another variant, the same option again (a damaged / defective unit). Another product is NOT an
-- exchange (Q-5: refund the return and let the customer order the other product).
--
-- RPCs (all admin-only, one transaction each, ORDER row locked first):
--   ship_replacement(...)              creates the replacement shipment (courier, tracking, charges), marks the reservations fulfilled,
--                                      replacement_pending -> replacement_shipped
--   mark_replacement_delivered(...)    records the delivery on the shipment; the shipment trigger moves the request to replacement_delivered
--   settle_exchange_adjustment(...)    collected (with the payment reference) / waived (with a reason)
--   create_exchange_refund(...)        a refunds row of kind 'exchange_difference'; it is then sent / recorded with the M5 refund RPCs
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M5). SAFE TO RE-RUN. Rollback: 20261017_07_rollback.sql (run it BEFORE 20261017_06_rollback.sql).
-- ROLL-OUT ORDER: SQL first, then the website, then the RN app.
-- ============================================================================
begin;

-- 1 -- state machine + refund index ------------------------------------------------------------------------------------------------------------
-- a replacement shipment that is cancelled before it arrived puts the exchange back to "replacement pending"
insert into public.request_status_transitions (request_type, from_status, to_status, actor) values
  ('exchange', 'replacement_shipped', 'replacement_pending', 'system')
on conflict do nothing;

-- at most ONE price-difference refund in progress / done per exchange (a failed one does not count: the retry is a new refund)
create unique index if not exists refunds_one_active_exchange_difference on public.refunds (request_id)
  where request_id is not null and kind = 'exchange_difference' and status in ('pending', 'succeeded');

-- 2 -- tables -------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.exchange_reservations (
  request_item_id uuid          primary key references public.return_request_items (id) on delete cascade,
  request_id      uuid          not null references public.return_requests (id) on delete cascade,
  product_id      text          not null,
  variant_id      text          not null default '',
  quantity        integer       not null check (quantity > 0),
  unit_price      numeric(12,2) not null check (unit_price >= 0),      -- the replacement's price when it was reserved
  stock_moved     boolean       not null default true,                  -- false: the option does not track inventory (nothing was deducted)
  status          text          not null default 'reserved' check (status in ('reserved', 'released', 'fulfilled')),
  release_reason  text          check (release_reason is null or char_length(release_reason) <= 300),
  reserved_at     timestamptz   not null default now(),
  released_at     timestamptz,
  fulfilled_at    timestamptz,
  updated_at      timestamptz   not null default now()
);
create index if not exists exchange_reservations_request_idx on public.exchange_reservations (request_id, status);

create table if not exists public.replacement_fulfillments (
  id           uuid        primary key default gen_random_uuid(),
  request_id   uuid        not null unique references public.return_requests (id) on delete cascade,     -- ONE per exchange request
  order_id     text        not null references public.orders (id) on delete restrict,                    -- the ORIGINAL order
  status       text        not null default 'pending' check (status in ('pending', 'shipped', 'delivered', 'cancelled')),
  shipment_id  uuid        references public.shipments (id) on delete set null,                           -- shipments.direction = 'replacement'
  shipped_at   timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists replacement_fulfillments_order_idx on public.replacement_fulfillments (order_id);

create table if not exists public.replacement_fulfillment_items (
  id                     uuid          primary key default gen_random_uuid(),
  fulfillment_id         uuid          not null references public.replacement_fulfillments (id) on delete cascade,
  request_item_id        uuid          not null unique references public.return_request_items (id) on delete cascade,
  order_item_id          uuid          not null references public.order_items (id) on delete restrict,   -- the ORIGINAL line this replaces
  product_id             text          not null,
  variant_id             text          not null default '',
  title                  text,                                  -- snapshot of what is sent (the customer and the packer read these)
  variant_name           text,
  sku                    text,
  image                  text,
  quantity               integer       not null check (quantity > 0),
  original_unit_price    numeric(12,2) not null,                -- the purchase snapshot of the returned line
  replacement_unit_price numeric(12,2) not null,                -- the replacement's price when it was reserved
  price_difference       numeric(12,2) not null                 -- (replacement - original) x quantity ; positive = the customer owes
);
create index if not exists replacement_fulfillment_items_fulfillment_idx on public.replacement_fulfillment_items (fulfillment_id);

create table if not exists public.exchange_adjustments (
  request_id uuid          primary key references public.return_requests (id) on delete cascade,
  kind       text          not null check (kind in ('none', 'balance_due', 'refund_due')),
  amount     numeric(12,2) not null default 0 check (amount >= 0),             -- always positive: what is owed, either way
  status     text          not null default 'open' check (status in ('open', 'collected', 'refunded', 'waived', 'not_needed')),
  refund_id  uuid          references public.refunds (id) on delete set null,  -- the (latest) price-difference refund
  settled_at timestamptz,
  created_at timestamptz   not null default now(),
  updated_at timestamptz   not null default now(),
  constraint exchange_adjustments_none_chk check ((kind = 'none') = (status = 'not_needed') and (kind <> 'none' or amount = 0)),
  constraint exchange_adjustments_amount_chk check (kind = 'none' or amount > 0),
  constraint exchange_adjustments_status_kind_chk check (not (kind = 'balance_due' and status = 'refunded') and not (kind = 'refund_due' and status = 'collected'))
);

create table if not exists public.exchange_adjustment_private (
  request_id    uuid primary key references public.exchange_adjustments (request_id) on delete cascade,
  reference     text check (reference is null or char_length(reference) <= 200),       -- how / when the customer paid
  internal_note text check (internal_note is null or char_length(internal_note) <= 1000),
  settled_by    uuid references public.profiles (id) on delete set null
);

drop trigger if exists replacement_fulfillments_touch on public.replacement_fulfillments;
create trigger replacement_fulfillments_touch before update on public.replacement_fulfillments
  for each row execute function public.app_touch_updated_at();
drop trigger if exists exchange_adjustments_touch on public.exchange_adjustments;
create trigger exchange_adjustments_touch before update on public.exchange_adjustments
  for each row execute function public.app_touch_updated_at();
drop trigger if exists exchange_reservations_touch on public.exchange_reservations;
create trigger exchange_reservations_touch before update on public.exchange_reservations
  for each row execute function public.app_touch_updated_at();

-- 3 -- RLS: customers read the replacement + the price difference of THEIR exchange, admins everything, nobody writes directly ----------------------
alter table public.exchange_reservations         enable row level security;
alter table public.replacement_fulfillments      enable row level security;
alter table public.replacement_fulfillment_items enable row level security;
alter table public.exchange_adjustments          enable row level security;
alter table public.exchange_adjustment_private   enable row level security;
revoke all on public.exchange_reservations, public.replacement_fulfillments, public.replacement_fulfillment_items,
              public.exchange_adjustments, public.exchange_adjustment_private from anon, authenticated;
grant select on public.exchange_reservations, public.replacement_fulfillments, public.replacement_fulfillment_items,
                public.exchange_adjustments, public.exchange_adjustment_private to authenticated;

drop policy if exists exchange_reservations_select on public.exchange_reservations;
create policy exchange_reservations_select on public.exchange_reservations for select to authenticated using (public.app_is_admin());
drop policy if exists replacement_fulfillments_select on public.replacement_fulfillments;
create policy replacement_fulfillments_select on public.replacement_fulfillments for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.return_requests r where r.id = replacement_fulfillments.request_id and r.user_id = auth.uid()));
drop policy if exists replacement_fulfillment_items_select on public.replacement_fulfillment_items;
create policy replacement_fulfillment_items_select on public.replacement_fulfillment_items for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.replacement_fulfillments f join public.return_requests r on r.id = f.request_id
                                           where f.id = replacement_fulfillment_items.fulfillment_id and r.user_id = auth.uid()));
drop policy if exists exchange_adjustments_select on public.exchange_adjustments;
create policy exchange_adjustments_select on public.exchange_adjustments for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.return_requests r where r.id = exchange_adjustments.request_id and r.user_id = auth.uid()));
drop policy if exists exchange_adjustment_private_select on public.exchange_adjustment_private;
create policy exchange_adjustment_private_select on public.exchange_adjustment_private for select to authenticated using (public.app_is_admin());

-- 4 -- stock: reserve / release (internal helpers: no API grants) ---------------------------------------------------------------------------------
-- the price the replacement option sells for NOW; NULL = it cannot be sold (missing / inactive / main option switched off). Same rule as create_return_request.
create or replace function public.app_replacement_unit_price(p_product_id text, p_variant_id text)
returns numeric
language sql stable
set search_path = public, pg_catalog
as $$
  select case
           when coalesce(p_variant_id, '') <> '' then
             (select pv.price from public.product_variants pv where pv.id = p_variant_id and pv.product_id = p_product_id and pv.status = 'active')
           else
             (select case when p.has_variants then (case when p.main_option_enabled then public.app_effective_price(p.price, p.discount, p.discount_expiry) end)
                          else public.app_effective_price(p.price, p.discount, p.discount_expiry) end
                from public.products p where p.id = p_product_id and p.status = 'active')
         end
$$;

-- the ledger idempotency key of the next movement of this kind for a line: exres:<line> / exrel:<line> the first time, exres:<line>:1, :2 ... when the line
-- is reserved / released AGAIN later (only after a rollback + roll-forward of this migration: the reservation rows are gone but the ledger is history)
create or replace function public.app_exchange_ledger_key(p_movement_type text, p_item_id uuid)
returns text
language sql stable
set search_path = public, pg_catalog
as $$
  select case when p_movement_type = 'exchange_reserve' then 'exres:' else 'exrel:' end || p_item_id::text || case when c.n = 0 then '' else ':' || c.n::text end
    from (select count(*) as n from public.inventory_logs l where l.ref_id = p_item_id::text and l.movement_type = p_movement_type) c
$$;

-- hold the replacement stock of ONE approved exchange line. Idempotent: a line is reserved once (the reservation row is the primary key), and when the
-- LEDGER already shows its stock as held (reservations minus releases) a lost reservation row is rebuilt WITHOUT deducting again.
create or replace function public.app_exchange_reserve_item(p_item_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  it      public.return_request_items;
  rq      public.return_requests;
  v_var   text;
  v_price numeric;
  v_after integer;
  v_held  integer;
  v_label text;
begin
  select * into it from public.return_request_items where id = p_item_id;
  if not found then return; end if;
  select * into rq from public.return_requests where id = it.request_id;
  if rq.type is distinct from 'exchange' then return; end if;
  if exists (select 1 from public.exchange_reservations x where x.request_item_id = p_item_id) then return; end if;   -- already reserved (or given back): never twice

  if it.replacement_product_id is null or coalesce(it.replacement_qty, 0) < 1 then
    raise exception 'This exchange line has no replacement chosen' using errcode = '22023';
  end if;
  v_var := coalesce(it.replacement_variant_id, '');
  select coalesce(p.title, p.id) || coalesce(' [' || nullif((select pv.name from public.product_variants pv where pv.id = v_var and pv.product_id = p.id), '') || ']', '')
    into v_label from public.products p where p.id = it.replacement_product_id;
  v_label := coalesce(v_label, it.replacement_product_id);
  v_price := public.app_replacement_unit_price(it.replacement_product_id, v_var);
  if v_price is null then
    raise exception 'The replacement "%" is no longer available', v_label using errcode = '22023', detail = 'REPLACEMENT_UNAVAILABLE';
  end if;

  select coalesce(-sum(l.change), 0)::integer into v_held from public.inventory_logs l
   where l.ref_id = it.id::text and l.movement_type in ('exchange_reserve', 'exchange_release') and l.bucket = 'sellable';
  if v_held >= it.replacement_qty then
    v_after := 0;                                            -- the ledger says this line already holds its stock: do not take it a second time
  else
    begin
      v_after := public.apply_inventory_movement(
        it.replacement_product_id, v_var, -it.replacement_qty, 'exchange_reserve', rq.order_id, 'return_request_item', it.id::text,
        'Replacement reserved for ' || rq.request_no, auth.uid(), case when auth.uid() is null then 'system' else 'admin' end,
        public.app_exchange_ledger_key('exchange_reserve', it.id));
    exception when others then
      if sqlerrm like 'Insufficient stock%' then
        raise exception 'Not enough stock for the replacement "%" (% needed)', v_label, it.replacement_qty using errcode = '22023', detail = 'REPLACEMENT_OUT_OF_STOCK';
      end if;
      raise;
    end;
  end if;

  insert into public.exchange_reservations (request_item_id, request_id, product_id, variant_id, quantity, unit_price, stock_moved, status)
  values (it.id, it.request_id, it.replacement_product_id, v_var, it.replacement_qty, v_price, v_after is not null, 'reserved');
end;
$$;

-- give the stock of ONE line back (only while it is still `reserved`; idempotent)
create or replace function public.app_exchange_release_item(p_item_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  x  public.exchange_reservations;
  rq public.return_requests;
begin
  select * into x from public.exchange_reservations where request_item_id = p_item_id for update;
  if not found or x.status <> 'reserved' then return; end if;
  if x.stock_moved then
    select * into rq from public.return_requests where id = x.request_id;
    begin
      perform public.apply_inventory_movement(
        x.product_id, x.variant_id, x.quantity, 'exchange_release', rq.order_id, 'return_request_item', p_item_id::text,
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Replacement released'), auth.uid(), case when auth.uid() is null then 'system' else 'admin' end,
        public.app_exchange_ledger_key('exchange_release', p_item_id));
    exception when sqlstate 'P0002' then
      null;       -- the product / variant was deleted meanwhile: there is no counter left to give the stock back to
    end;
  end if;
  update public.exchange_reservations
     set status = 'released', released_at = now(), release_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300), updated_at = now()
   where request_item_id = p_item_id;
end;
$$;

-- 5 -- opening the replacement: fulfilment record + price difference -----------------------------------------------------------------------------------
create or replace function public.app_exchange_open_fulfilment(p_request_id uuid, p_notify boolean default true)
returns uuid
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  r        public.return_requests;
  f        public.replacement_fulfillments;
  x        public.exchange_reservations;
  rec      record;
  v_n      integer := 0;
  v_total  numeric := 0;
  v_diff   numeric;
  v_kind   text;
  v_amt    numeric;
  v_what   text;
  v_title  text;
  v_body   text;
begin
  select * into r from public.return_requests where id = p_request_id;
  if not found or r.type <> 'exchange' then return null; end if;
  select * into f from public.replacement_fulfillments where request_id = p_request_id;
  if found then return f.id; end if;                                                 -- already opened (a retry, or the shipment was cancelled and the exchange is back here)

  insert into public.replacement_fulfillments (request_id, order_id, status) values (r.id, r.order_id, 'pending') returning * into f;
  for rec in
    select i.id as item_id, i.order_item_id, i.unit_price as original_price, i.replacement_product_id, coalesce(i.replacement_variant_id, '') as variant_id,
           coalesce(i.replacement_qty, i.quantity) as qty,
           p.title as p_title, p.sku as p_sku, coalesce(p.thumbnail, p.image) as p_image,
           pv.name as v_name, pv.sku as v_sku, pv.image as v_image
      from public.return_request_items i
      left join public.products p on p.id = i.replacement_product_id
      left join public.product_variants pv on pv.id = coalesce(i.replacement_variant_id, '') and pv.product_id = i.replacement_product_id
     where i.request_id = r.id and i.item_status = 'passed'
     order by i.created_at, i.id
  loop
    select * into x from public.exchange_reservations where request_item_id = rec.item_id;
    if not found then                                                                -- a line approved before the reservations existed: hold the stock now (or refuse)
      perform public.app_exchange_reserve_item(rec.item_id);
      select * into x from public.exchange_reservations where request_item_id = rec.item_id;
    end if;
    if x.status <> 'reserved' then
      raise exception 'The stock of a replacement is no longer reserved (%)', x.status using errcode = '22023';
    end if;
    v_diff := round((x.unit_price - rec.original_price) * rec.qty, 2);
    v_total := v_total + v_diff;
    insert into public.replacement_fulfillment_items
      (fulfillment_id, request_item_id, order_item_id, product_id, variant_id, title, variant_name, sku, image, quantity,
       original_unit_price, replacement_unit_price, price_difference)
    values
      (f.id, rec.item_id, rec.order_item_id, rec.replacement_product_id, rec.variant_id, rec.p_title, rec.v_name,
       case when rec.variant_id <> '' then rec.v_sku else rec.p_sku end, coalesce(case when rec.variant_id <> '' then rec.v_image end, rec.p_image), rec.qty,
       rec.original_price, x.unit_price, v_diff);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'No item of this exchange passed the inspection, so there is nothing to send' using errcode = '22023'; end if;

  v_kind := case when v_total > 0 then 'balance_due' when v_total < 0 then 'refund_due' else 'none' end;
  v_amt  := abs(v_total);
  insert into public.exchange_adjustments (request_id, kind, amount, status)
  values (r.id, v_kind, v_amt, case when v_kind = 'none' then 'not_needed' else 'open' end);
  insert into public.exchange_adjustment_private (request_id) values (r.id);

  v_what := case v_kind
              when 'balance_due' then format('The replacement costs ₹%s more than the item you return. The difference is payable before we send it.', v_amt)
              when 'refund_due'  then format('The replacement costs ₹%s less than the item you return. We will refund the difference.', v_amt)
              else 'The replacement costs the same as the item you return.' end;
  insert into public.return_request_events (request_id, actor_role, note) values (r.id, 'system', 'Replacement prepared. ' || v_what);
  if p_notify and v_kind <> 'none' then
    v_title := case when v_kind = 'balance_due' then 'Price difference on your exchange' else 'Your exchange costs less' end;
    v_body  := r.request_no || ' · ' || v_what;
    perform public.app_notify_request_customer(r.id, v_title, v_body);
  end if;
  return f.id;
end;
$$;

-- an exchange completes by itself once the replacement is DELIVERED and no price difference is waiting to be settled
create or replace function public.app_exchange_try_close(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare r public.return_requests;
begin
  select * into r from public.return_requests where id = p_request_id for update;
  if not found or r.type <> 'exchange' or r.status <> 'replacement_delivered' then return; end if;
  if exists (select 1 from public.exchange_adjustments a where a.request_id = r.id and a.status = 'open') then return; end if;
  perform public.app_apply_request_transition(r.id, 'closed', 'system', null, null, 'Your exchange is complete.', true);
end;
$$;

-- 6 -- triggers -------------------------------------------------------------------------------------------------------------------------------------
-- 6a. a line is approved -> reserve; cancelled / rejected / failed the inspection -> release (every code path that changes a line passes here)
create or replace function public.trg_exchange_item_reservation()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if new.item_status = 'approved' and old.item_status = 'pending' then
    perform public.app_exchange_reserve_item(new.id);
  elsif new.item_status in ('rejected', 'cancelled', 'failed') and old.item_status in ('pending', 'approved', 'received') then
    perform public.app_exchange_release_item(new.id,
      case new.item_status when 'failed' then 'The returned item did not pass the inspection' when 'cancelled' then 'The exchange line was cancelled' else 'The exchange line was rejected' end);
  end if;
  return new;
end;
$$;
drop trigger if exists return_request_items_exchange_stock on public.return_request_items;
create trigger return_request_items_exchange_stock after update of item_status on public.return_request_items
  for each row when (old.item_status is distinct from new.item_status)
  execute function public.trg_exchange_item_reservation();

-- 6b. the exchange reaches `replacement_pending` -> the fulfilment record + the price difference exist from that moment
create or replace function public.trg_exchange_replacement_pending()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.app_exchange_open_fulfilment(new.id, true);
  return new;
end;
$$;
drop trigger if exists return_requests_exchange_open on public.return_requests;
create trigger return_requests_exchange_open after update of status on public.return_requests
  for each row when (new.type = 'exchange' and new.status = 'replacement_pending' and old.status is distinct from new.status)
  execute function public.trg_exchange_replacement_pending();

-- 6c. the exchange is cancelled -> every reservation still held is given back; an open difference no longer applies
create or replace function public.trg_exchange_cancelled()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  x record;
  a public.exchange_adjustments;
  v_note text;
begin
  for x in select e.request_item_id from public.exchange_reservations e where e.request_id = new.id and e.status = 'reserved' loop
    perform public.app_exchange_release_item(x.request_item_id, 'The exchange was cancelled');
  end loop;
  update public.replacement_fulfillments set status = 'cancelled', cancelled_at = now(), updated_at = now() where request_id = new.id and status = 'pending';

  select * into a from public.exchange_adjustments where request_id = new.id for update;
  if found and a.status = 'open' and not exists (select 1 from public.refunds f where f.id = a.refund_id and f.status = 'pending') then
    update public.exchange_adjustments set status = 'waived', settled_at = now(), updated_at = now() where request_id = new.id;
  end if;

  -- cancelled AFTER the returned items were accepted: no replacement, and nothing paid back yet - staff must settle the money
  if old.status = 'replacement_pending' then
    update public.return_request_items set item_status = 'resolved' where request_id = new.id and item_status = 'passed';
    v_note := 'The exchange was cancelled after the returned item(s) were accepted: the customer has no replacement and has not been refunded for them. Settle it (a refund of the returned items) outside the exchange flow.';
    if a.status = 'collected' then v_note := v_note || format(' A price difference of ₹%s was collected and must be paid back too.', a.amount); end if;
    insert into public.return_request_events (request_id, actor_role, note, internal) values (new.id, 'system', v_note, true);
    perform public.app_notify_admins('Exchange cancelled after inspection', new.request_no || ' · the returned item(s) were accepted, so the customer must be refunded',
      jsonb_build_object('type', 'admin_request', 'requestId', new.id, 'requestNo', new.request_no, 'orderId', new.order_id));
  end if;
  return new;
end;
$$;
drop trigger if exists return_requests_exchange_cancelled on public.return_requests;
create trigger return_requests_exchange_cancelled after update of status on public.return_requests
  for each row when (new.type = 'exchange' and new.status = 'cancelled' and old.status is distinct from new.status)
  execute function public.trg_exchange_cancelled();

-- 6d. an exchange cannot be closed by hand while its price difference is open (the automatic close checks the same)
create or replace function public.trg_exchange_close_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if exists (select 1 from public.exchange_adjustments a where a.request_id = new.id and a.status = 'open') then
    raise exception 'Settle the price difference of this exchange before closing it' using errcode = '22023', detail = 'DIFFERENCE_OPEN';
  end if;
  return new;
end;
$$;
drop trigger if exists return_requests_exchange_close_guard on public.return_requests;
create trigger return_requests_exchange_close_guard before update of status on public.return_requests
  for each row when (new.type = 'exchange' and new.status = 'closed' and old.status is distinct from new.status)
  execute function public.trg_exchange_close_guard();

-- 6e. the REPLACEMENT shipment moves (courier event, webhook, "mark delivered", cancelled): the exchange follows
create or replace function public.trg_replacement_shipment_progress()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  r public.return_requests;
  f public.replacement_fulfillments;
begin
  if new.direction <> 'replacement' or new.request_id is null then return new; end if;
  select * into r from public.return_requests where id = new.request_id;
  if not found or r.type <> 'exchange' then return new; end if;
  select * into f from public.replacement_fulfillments where request_id = r.id for update;

  if new.status = 'delivered' then
    if found and f.status = 'shipped' then
      update public.replacement_fulfillments set status = 'delivered', delivered_at = coalesce(new.delivered_at, now()), updated_at = now() where id = f.id;
    end if;
    if r.status = 'replacement_shipped' then
      perform public.app_apply_request_transition(r.id, 'replacement_delivered', 'system', null, null, 'Your replacement was delivered.', true);
      update public.return_request_items set item_status = 'resolved' where request_id = r.id and item_status = 'passed';
      perform public.app_exchange_try_close(r.id);
    end if;
  elsif new.status = 'cancelled' then
    if found and f.status = 'shipped' and f.shipment_id is not distinct from new.id then
      update public.replacement_fulfillments set status = 'pending', shipment_id = null, shipped_at = null, updated_at = now() where id = f.id;
      update public.exchange_reservations set status = 'reserved', fulfilled_at = null, updated_at = now()
       where status = 'fulfilled' and request_item_id in (select fi.request_item_id from public.replacement_fulfillment_items fi where fi.fulfillment_id = f.id);
      if r.status = 'replacement_shipped' then
        perform public.app_apply_request_transition(r.id, 'replacement_pending', 'system', null, 'The replacement shipment was cancelled',
          'The shipment of your replacement was cancelled. We are preparing it again.', true);
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists shipments_replacement_progress on public.shipments;
create trigger shipments_replacement_progress after update of status on public.shipments
  for each row when (new.direction = 'replacement' and old.status is distinct from new.status)
  execute function public.trg_replacement_shipment_progress();

-- 6f. the price-difference refund finishes -> the adjustment follows (a failed refund leaves it open: the next try is a new refund)
create or replace function public.trg_exchange_refund_sync()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare a public.exchange_adjustments;
begin
  select * into a from public.exchange_adjustments where request_id = new.request_id for update;
  if not found or a.refund_id is distinct from new.id then return new; end if;
  if new.status = 'succeeded' then
    update public.exchange_adjustments set status = 'refunded', settled_at = coalesce(new.completed_at, now()), updated_at = now()
     where request_id = new.request_id and status = 'open';
    insert into public.return_request_events (request_id, actor_role, note) values (new.request_id, 'system', format('The price difference of ₹%s was refunded.', new.amount));
    perform public.app_exchange_try_close(new.request_id);
  end if;
  return new;
end;
$$;
drop trigger if exists refunds_exchange_sync on public.refunds;
create trigger refunds_exchange_sync after update of status on public.refunds
  for each row when (new.kind = 'exchange_difference' and new.request_id is not null and old.status is distinct from new.status)
  execute function public.trg_exchange_refund_sync();

-- 7 -- ship_replacement -----------------------------------------------------------------------------------------------------------------------------------
create or replace function public.ship_replacement(
  p_request_id             uuid,
  p_courier_code           text        default 'manual',
  p_courier_name           text        default null,
  p_tracking_number        text        default null,
  p_tracking_url           text        default null,
  p_shipped_at             timestamptz default null,
  p_charges                numeric     default null,
  p_note                   text        default null,
  p_expected_delivery_date date        default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid    uuid := auth.uid();
  r        public.return_requests;
  f        public.replacement_fulfillments;
  a        public.exchange_adjustments;
  v_code   text := coalesce(nullif(btrim(coalesce(p_courier_code, '')), ''), 'manual');
  v_track  text := nullif(btrim(coalesce(p_tracking_number, '')), '');
  v_url    text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  v_cour   public.couriers;
  v_name   text;
  v_ship   public.shipments;
  v_dup    public.shipments;
  v_when   timestamptz := coalesce(p_shipped_at, now());
  v_missing integer;
begin
  r := public.app_lock_request_for_admin(p_request_id);                          -- admin check + ORDER lock + request lock
  if r.type <> 'exchange' then raise exception 'Only an exchange has a replacement to ship' using errcode = '22023'; end if;

  -- a retry of the same call (double click, lost response): the same courier + tracking number is the same parcel
  if r.status = 'replacement_shipped' then
    if v_track is not null then
      select * into v_dup from public.shipments s
       where s.request_id = r.id and s.direction = 'replacement' and s.status <> 'cancelled' and s.courier_code = v_code and s.tracking_number = v_track limit 1;
      if found then return jsonb_build_object('ok', true, 'created', false, 'shipment_id', v_dup.id, 'status', r.status); end if;
    end if;
    raise exception 'The replacement was already shipped' using errcode = '22023';
  end if;
  if r.status <> 'replacement_pending' then
    raise exception 'The replacement can be shipped while it is being prepared (this exchange is "%")', replace(r.status, '_', ' ') using errcode = '22023';
  end if;
  select * into f from public.replacement_fulfillments where request_id = r.id for update;
  if not found then raise exception 'This exchange has no replacement record yet' using errcode = '22023'; end if;
  select * into a from public.exchange_adjustments where request_id = r.id;
  if found and a.kind = 'balance_due' and a.status = 'open' then
    raise exception 'The customer owes a price difference of ₹% - collect it (or waive it) before the replacement ships', a.amount using errcode = '22023', detail = 'DIFFERENCE_OPEN';
  end if;
  select count(*) into v_missing from public.replacement_fulfillment_items fi
   where fi.fulfillment_id = f.id and not exists (select 1 from public.exchange_reservations x where x.request_item_id = fi.request_item_id and x.status = 'reserved');
  if v_missing > 0 then raise exception 'The stock of % replacement item(s) is not reserved', v_missing using errcode = '22023'; end if;

  select * into v_cour from public.couriers where code = v_code;
  if not found then raise exception 'Unknown courier "%"', v_code using errcode = '22023'; end if;
  if not v_cour.active then raise exception 'The courier "%" is switched off', v_cour.name using errcode = '22023'; end if;
  if v_url is not null and v_url !~* '^https?://[^ ]+$' then raise exception 'The tracking link must start with http:// or https:// and contain no spaces' using errcode = '22023'; end if;
  if p_charges is not null and p_charges < 0 then raise exception 'Shipping charges cannot be negative' using errcode = '22023'; end if;
  if v_when > now() + interval '1 day' then raise exception 'The shipping date cannot be in the future' using errcode = '22023'; end if;
  v_name := coalesce(nullif(btrim(coalesce(p_courier_name, '')), ''), v_cour.name);

  insert into public.shipments (order_id, direction, request_id, courier_code, courier_name, tracking_number, tracking_url, shipped_at, expected_delivery_date, status, last_event_at)
  values (r.order_id, 'replacement', r.id, v_code, v_name, v_track, coalesce(v_url, public.app_courier_tracking_url(v_code, v_track)), v_when, p_expected_delivery_date, 'created', v_when)
  returning * into v_ship;
  insert into public.shipment_private (shipment_id, charges, note, created_by) values (v_ship.id, p_charges, nullif(btrim(coalesce(p_note, '')), ''), v_uid);
  insert into public.shipment_items (shipment_id, order_item_id, quantity)
  select v_ship.id, fi.order_item_id, fi.quantity from public.replacement_fulfillment_items fi where fi.fulfillment_id = f.id;
  insert into public.shipment_events (shipment_id, provider, provider_event_id, event_type, occurred_at, description, created_by)
  values (v_ship.id, 'manual', 'created:' || v_ship.id::text, 'created', v_when, 'Replacement shipment created', v_uid);

  update public.replacement_fulfillments set status = 'shipped', shipment_id = v_ship.id, shipped_at = v_when, updated_at = now() where id = f.id;
  update public.exchange_reservations set status = 'fulfilled', fulfilled_at = now(), updated_at = now()
   where status = 'reserved' and request_item_id in (select fi.request_item_id from public.replacement_fulfillment_items fi where fi.fulfillment_id = f.id);

  r := public.app_apply_request_transition(r.id, 'replacement_shipped', 'system', v_uid, nullif(btrim(coalesce(p_note, '')), ''),
         'Sent with ' || v_name || coalesce(' · tracking ' || v_track, ''), true);
  return jsonb_build_object('ok', true, 'created', true, 'shipment_id', v_ship.id, 'status', r.status);
end;
$$;

-- 8 -- mark_replacement_delivered ----------------------------------------------------------------------------------------------------------------------------
create or replace function public.mark_replacement_delivered(p_request_id uuid, p_delivered_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid  uuid := auth.uid();
  r      public.return_requests;
  v_ship public.shipments;
  v_when timestamptz := coalesce(p_delivered_at, now());
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if r.type <> 'exchange' then raise exception 'Only an exchange has a replacement to deliver' using errcode = '22023'; end if;
  if r.status in ('replacement_delivered', 'closed') then return jsonb_build_object('ok', true, 'already', true, 'status', r.status); end if;
  if r.status <> 'replacement_shipped' then
    raise exception 'The replacement can be marked delivered once it was shipped (this exchange is "%")', replace(r.status, '_', ' ') using errcode = '22023';
  end if;
  if v_when > now() + interval '10 minutes' then raise exception 'The delivery time cannot be in the future' using errcode = '22023'; end if;
  select * into v_ship from public.shipments s where s.request_id = r.id and s.direction = 'replacement' and s.status <> 'cancelled' order by s.created_at desc limit 1;
  if not found then raise exception 'There is no replacement shipment to mark as delivered' using errcode = '22023'; end if;
  -- the event moves the shipment to `delivered`; the shipment trigger then moves the exchange (and closes it when nothing is left to settle)
  perform public.app_record_shipment_event(v_ship.id, 'delivered', v_when, null, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Marked as delivered'),
                                           'manual', 'delivered:' || v_ship.id::text, '{}'::jsonb, v_uid);
  select * into r from public.return_requests where id = r.id;
  return jsonb_build_object('ok', true, 'already', false, 'status', r.status);
end;
$$;

-- 9 -- settle_exchange_adjustment (collected / waived) --------------------------------------------------------------------------------------------------------
create or replace function public.settle_exchange_adjustment(p_request_id uuid, p_resolution text, p_reference text default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid  uuid := auth.uid();
  r      public.return_requests;
  a      public.exchange_adjustments;
  v_ref  text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if r.type <> 'exchange' then raise exception 'Only an exchange has a price difference' using errcode = '22023'; end if;
  select * into a from public.exchange_adjustments where request_id = r.id for update;
  if not found then raise exception 'This exchange has no price difference yet (it is worked out when the replacement is prepared)' using errcode = '22023'; end if;
  if p_resolution is null or p_resolution not in ('collected', 'waived') then raise exception 'The resolution must be collected or waived' using errcode = '22023'; end if;
  if a.kind = 'none' then raise exception 'This exchange has no price difference' using errcode = '22023'; end if;
  if a.status = p_resolution then return jsonb_build_object('ok', true, 'already', true, 'status', a.status); end if;
  if a.status <> 'open' then raise exception 'The price difference is already %', a.status using errcode = '22023'; end if;
  if v_ref is not null and char_length(v_ref) > 200 then raise exception 'The reference is too long (200 characters at most)' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'The note is too long (1000 characters at most)' using errcode = '22023'; end if;
  if p_resolution = 'collected' then
    if a.kind <> 'balance_due' then raise exception 'Only an amount the customer owes can be collected; a refund is paid with create_exchange_refund' using errcode = '22023'; end if;
    if v_ref is null then raise exception 'Enter the payment reference (how and when the customer paid)' using errcode = '22023'; end if;
  else
    if v_note is null then raise exception 'Say why the price difference is waived' using errcode = '22023'; end if;
    if exists (select 1 from public.refunds f where f.request_id = r.id and f.kind = 'exchange_difference' and f.status in ('pending', 'succeeded')) then
      raise exception 'A refund of the difference is already in progress or done' using errcode = '22023';
    end if;
  end if;

  update public.exchange_adjustments set status = p_resolution, settled_at = now(), updated_at = now() where request_id = r.id;
  insert into public.exchange_adjustment_private (request_id, reference, internal_note, settled_by) values (r.id, v_ref, v_note, v_uid)
  on conflict (request_id) do update set reference = coalesce(excluded.reference, public.exchange_adjustment_private.reference),
                                         internal_note = coalesce(excluded.internal_note, public.exchange_adjustment_private.internal_note), settled_by = excluded.settled_by;
  insert into public.return_request_events (request_id, actor_id, actor_role, note)
  values (r.id, v_uid, 'admin', case when p_resolution = 'collected' then format('The price difference of ₹%s was received. Thank you.', a.amount)
                                      else format('The price difference of ₹%s was waived.', a.amount) end);
  if v_note is not null then
    insert into public.return_request_events (request_id, actor_id, actor_role, note, internal) values (r.id, v_uid, 'admin', 'Price difference ' || p_resolution || ': ' || v_note, true);
  end if;
  perform public.app_exchange_try_close(r.id);
  return jsonb_build_object('ok', true, 'already', false, 'status', p_resolution);
end;
$$;

-- 10 -- create_exchange_refund (the replacement is cheaper: pay the difference back) --------------------------------------------------------------------------------
create or replace function public.create_exchange_refund(p_request_id uuid, p_idempotency_key text, p_method text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  r     public.return_requests;
  o     public.orders;
  a     public.exchange_adjustments;
  f     public.refunds;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if v_key is null or char_length(v_key) not between 8 and 100 then raise exception 'An idempotency key of 8 to 100 characters is required' using errcode = '22023'; end if;
  select * into f from public.refunds where idempotency_key = v_key;
  if found then                                                       -- a retry (double click, lost response) returns the same refund
    if f.request_id is distinct from p_request_id or f.kind <> 'exchange_difference' then raise exception 'This idempotency key belongs to another refund' using errcode = '22023'; end if;
    return jsonb_build_object('ok', true, 'created', false, 'refund_id', f.id, 'refund_no', f.refund_no, 'status', f.status, 'amount', f.amount, 'method', f.method);
  end if;
  if r.type <> 'exchange' then raise exception 'Only an exchange has a price difference to refund' using errcode = '22023'; end if;
  select * into a from public.exchange_adjustments where request_id = r.id for update;
  if not found or a.kind <> 'refund_due' then raise exception 'This exchange has no price difference to refund' using errcode = '22023', detail = 'NO_REFUND_DUE'; end if;
  if a.status <> 'open' then raise exception 'The price difference is already %', a.status using errcode = '22023'; end if;
  if p_method is null or p_method not in ('razorpay', 'manual') then raise exception 'The refund method must be razorpay or manual' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is not null and char_length(btrim(p_note)) > 1000 then raise exception 'The note is too long (1000 characters at most)' using errcode = '22023'; end if;
  select * into o from public.orders where id = r.order_id;
  if lower(btrim(coalesce(o.payment_status, ''))) <> 'paid' then
    raise exception 'This order is not marked as paid, so there is nothing to refund - waive the difference instead' using errcode = '22023', detail = 'NOT_PAID';
  end if;
  if p_method = 'razorpay' and (coalesce(o.razorpay_payment_id, '') = '' or lower(coalesce(o.payment_method, '')) <> 'razorpay') then
    raise exception 'This order was not paid through Razorpay, so it cannot be refunded through the gateway - choose a manual refund' using errcode = '22023', detail = 'NOT_RAZORPAY';
  end if;
  if exists (select 1 from public.refunds x where x.request_id = r.id and x.kind = 'exchange_difference' and x.status in ('pending', 'succeeded')) then
    raise exception 'A refund of this difference is already in progress or done' using errcode = '22023', detail = 'REFUND_EXISTS';
  end if;

  insert into public.refunds (refund_no, order_id, request_id, kind, amount, items_amount, shipping_amount, adjustment_amount, method, status, gateway_state, idempotency_key)
  values (public.app_next_refund_no(), o.id, r.id, 'exchange_difference', a.amount, a.amount, 0, 0, p_method, 'pending', case when p_method = 'razorpay' then 'not_sent' end, v_key)
  returning * into f;
  insert into public.refund_private (refund_id, internal_note, initiated_by) values (f.id, nullif(btrim(coalesce(p_note, '')), ''), v_uid);
  insert into public.refund_events (refund_id, event_type, to_status, actor_id, actor_role, note)
  values (f.id, 'created', 'pending', v_uid, 'admin', format('%s refund of the exchange price difference, %s %s', p_method, f.amount, f.currency));
  update public.exchange_adjustments set refund_id = f.id, updated_at = now() where request_id = r.id;
  insert into public.return_request_events (request_id, actor_id, actor_role, note)
  values (r.id, v_uid, 'admin', format('A refund of ₹%s for the price difference is being prepared.', f.amount));
  return jsonb_build_object('ok', true, 'created', true, 'refund_id', f.id, 'refund_no', f.refund_no, 'status', f.status, 'amount', f.amount, 'method', f.method);
end;
$$;

-- 11 -- grants ------------------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function public.app_replacement_unit_price(text, text)                              from public, anon, authenticated, service_role;
revoke all on function public.app_exchange_ledger_key(text, uuid)                                 from public, anon, authenticated, service_role;
revoke all on function public.app_exchange_reserve_item(uuid)                                     from public, anon, authenticated, service_role;
revoke all on function public.app_exchange_release_item(uuid, text)                               from public, anon, authenticated, service_role;
revoke all on function public.app_exchange_open_fulfilment(uuid, boolean)                         from public, anon, authenticated, service_role;
revoke all on function public.app_exchange_try_close(uuid)                                        from public, anon, authenticated, service_role;
revoke all on function public.trg_exchange_item_reservation()                                     from public, anon, authenticated, service_role;
revoke all on function public.trg_exchange_replacement_pending()                                  from public, anon, authenticated, service_role;
revoke all on function public.trg_exchange_cancelled()                                            from public, anon, authenticated, service_role;
revoke all on function public.trg_exchange_close_guard()                                          from public, anon, authenticated, service_role;
revoke all on function public.trg_replacement_shipment_progress()                                 from public, anon, authenticated, service_role;
revoke all on function public.trg_exchange_refund_sync()                                          from public, anon, authenticated, service_role;
revoke all on function public.ship_replacement(uuid, text, text, text, text, timestamptz, numeric, text, date) from public, anon;
revoke all on function public.mark_replacement_delivered(uuid, timestamptz, text)                 from public, anon;
revoke all on function public.settle_exchange_adjustment(uuid, text, text, text)                  from public, anon;
revoke all on function public.create_exchange_refund(uuid, text, text, text)                      from public, anon;
grant execute on function public.ship_replacement(uuid, text, text, text, text, timestamptz, numeric, text, date) to authenticated;      -- the admin check is inside
grant execute on function public.mark_replacement_delivered(uuid, timestamptz, text)              to authenticated;
grant execute on function public.settle_exchange_adjustment(uuid, text, text, text)               to authenticated;
grant execute on function public.create_exchange_refund(uuid, text, text, text)                   to authenticated;

-- 12 -- lines approved BEFORE this migration (nothing was reserved for them) ----------------------------------------------------------------------------------------
-- Best effort: a line whose replacement is out of stock stays without a reservation (a warning is printed); it is reserved - or the move refused with a clear
-- message - when the exchange reaches `replacement_pending`. Customers are not notified by this back-fill. Exchanges whose replacement already shipped
-- (or finished / were cancelled) are left alone: their stock left the shop, a second reservation would deduct it twice.
do $$
declare r record;
begin
  for r in select i.id from public.return_request_items i join public.return_requests q on q.id = i.request_id
            where q.type = 'exchange' and i.item_status in ('approved', 'received', 'passed')
              and q.status in ('approved', 'awaiting_return_shipment', 'return_in_transit', 'return_received', 'inspection_pending', 'inspection_passed', 'replacement_pending')
              and not exists (select 1 from public.exchange_reservations x where x.request_item_id = i.id) loop
    begin
      perform public.app_exchange_reserve_item(r.id);
    exception when others then
      raise warning 'exchange line % has no reservation: %', r.id, sqlerrm;
    end;
  end loop;
  for r in select q.id from public.return_requests q
            where q.type = 'exchange' and q.status = 'replacement_pending' and not exists (select 1 from public.replacement_fulfillments f where f.request_id = q.id) loop
    begin
      perform public.app_exchange_open_fulfilment(r.id, false);
    exception when others then
      raise warning 'exchange % has no replacement record: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';