-- ============================================================================
-- M5 — REFUNDS (IMPLEMENTATION_PLAN Phase 9; requires M4 + M4b for the return requests)
--
-- A return request and a refund are NOT the same thing: a request may be rejected, and an approved item must first be received and
-- inspected. This migration adds the controlled money step that follows `inspection_passed`:
--
--   refunds           one row per refund: amount (+ how it splits into items / shipping / adjustment), method, status, gateway reference
--   refund_items      which order lines and how many units it refunds (the basis of the "never refund a unit twice" arithmetic)
--   refund_private    admin only: internal note, who initiated, raw gateway answer, how many times the gateway was called
--   refund_events     admin only: audit trail + webhook idempotency (UNIQUE provider + provider_event_id)
--
-- HOW AN AMOUNT IS CALCULATED (app_refund_compute — the ONE place; documented in DATABASE_CHANGE_PLAN.md section 4g):
--   * Prices are GST-inclusive; nothing is added for tax. The credit-note split of CGST / SGST / IGST is the order line's own stored taxes.
--   * What the customer PAID for goods = orders.total - orders.shipping. That amount is allocated to the order lines in proportion to their
--     line_total (so the promo discount and the whole-rupee rounding of the total are shared out automatically); the last line takes the
--     remainder so the lines add up to it exactly.
--   * Refunding q units of a line = cumulative share of the line (allocated x units refunded so far / units ordered), minus what earlier
--     refunds of that line already paid. The cumulative difference makes refunds of 1 + 2 units equal one refund of 3 units, to the paisa.
--   * The outbound shipping charge is refunded ONLY when this refund completes the return of EVERY unit of the order AND the request's
--     reason is the seller's fault AND shipping was not refunded before (Q-3). Return shipping is never deducted for seller-fault reasons.
--   * An admin may add an adjustment (+ goodwill / - deduction) with a written reason; the total must stay > 0 and within what is left.
--   * The sum of all refunds that are pending or succeeded can never exceed orders.total (a trigger enforces it, not only the UI).
--   * The price comes from the PURCHASE snapshot (order_items), never from today's catalogue.
--
-- METHODS: 'razorpay' (the Edge Function refund-create calls the Razorpay Refund API for the SAME payment; needs credentials) or 'manual'
-- (an authorised admin pays it out by bank / UPI / cash and records the reference). A refund is `succeeded` ONLY when the gateway says
-- processed (webhook / status check) or an admin records the manual reference — never because someone clicked a button.
--
-- IDEMPOTENCY: create_refund takes a client-chosen key (same key = same refund), at most ONE pending/succeeded refund exists per return
-- request (partial unique index), the gateway call is guarded by refunds.gateway_state (never sent twice), webhook events are deduplicated.
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M4b). SAFE TO RE-RUN. Rollback: 20261017_06_rollback.sql.
-- ROLL-OUT ORDER: SQL first, then the Edge Functions (refund-create + payment-webhook), then the website, then the RN app.
-- ============================================================================
begin;

-- 1 -- tables -----------------------------------------------------------------------------------------------------------------------
create sequence if not exists public.refund_no_seq;

create table if not exists public.refunds (
  id                 uuid          primary key default gen_random_uuid(),
  refund_no          text          not null unique,                                  -- RFD-2026-000123
  order_id           text          not null references public.orders (id) on delete restrict,
  request_id         uuid          references public.return_requests (id) on delete set null,   -- the return it settles (NULL: an order-level refund)
  kind               text          not null default 'return' check (kind in ('return', 'exchange_difference', 'order')),
  amount             numeric(12,2) not null check (amount > 0),
  currency           text          not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  items_amount       numeric(12,2) not null default 0 check (items_amount >= 0),
  shipping_amount    numeric(12,2) not null default 0 check (shipping_amount >= 0),
  adjustment_amount  numeric(12,2) not null default 0,
  adjustment_note    text          check (adjustment_note is null or char_length(adjustment_note) <= 300),     -- customer-visible
  method             text          not null check (method in ('razorpay', 'manual')),
  status             text          not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  -- razorpay only: where the API call stands. not_sent -> submitting (call in flight) -> submitted (gateway has it) | unknown (no answer: CHECK, do not resend)
  gateway_state      text          check (gateway_state is null or gateway_state in ('not_sent', 'submitting', 'submitted', 'unknown')),
  gateway_refund_id  text          check (gateway_refund_id is null or char_length(gateway_refund_id) <= 80),
  gateway_status     text,                                                           -- what the gateway last reported: created | pending | processed | failed
  reference          text          check (reference is null or char_length(reference) <= 200),                 -- manual: bank / UPI reference; razorpay: rfnd_...
  failure_reason     text          check (failure_reason is null or char_length(failure_reason) <= 300),       -- customer-safe wording
  idempotency_key    text          not null unique check (char_length(idempotency_key) between 8 and 100),
  initiated_at       timestamptz   not null default now(),
  completed_at       timestamptz,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),
  constraint refunds_amount_parts_chk check (amount = items_amount + shipping_amount + adjustment_amount),
  constraint refunds_gateway_only_razorpay_chk check (method = 'razorpay' or (gateway_state is null and gateway_refund_id is null)),
  constraint refunds_completed_chk check (status <> 'succeeded' or completed_at is not null)
);
create index if not exists refunds_order_idx   on public.refunds (order_id, created_at desc);
create index if not exists refunds_request_idx on public.refunds (request_id) where request_id is not null;
create index if not exists refunds_status_idx  on public.refunds (status, created_at desc);
create unique index if not exists refunds_gateway_refund_uq on public.refunds (gateway_refund_id) where gateway_refund_id is not null;
-- at most ONE refund in progress / done per return request (a failed one does not count: the retry is a new refund)
create unique index if not exists refunds_one_active_per_request on public.refunds (request_id)
  where request_id is not null and kind = 'return' and status in ('pending', 'succeeded');

create table if not exists public.refund_items (
  id              uuid          primary key default gen_random_uuid(),
  refund_id       uuid          not null references public.refunds (id) on delete cascade,
  order_item_id   uuid          not null references public.order_items (id) on delete restrict,
  request_item_id uuid          references public.return_request_items (id) on delete set null,
  quantity        integer       not null check (quantity > 0),
  amount          numeric(12,2) not null check (amount >= 0),
  constraint refund_items_unique_line unique (refund_id, order_item_id)
);
create index if not exists refund_items_line_idx on public.refund_items (order_item_id);

create table if not exists public.refund_private (
  refund_id     uuid  primary key references public.refunds (id) on delete cascade,
  internal_note text  check (internal_note is null or char_length(internal_note) <= 1000),
  initiated_by  uuid  references public.profiles (id) on delete set null,
  attempts      integer not null default 0,                                         -- how many times the gateway was called
  gateway_error text,                                                               -- the raw answer of the last failed call (never shown to customers)
  gateway_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.refund_events (
  id                uuid        primary key default gen_random_uuid(),
  refund_id         uuid        references public.refunds (id) on delete cascade,     -- NULL: a gateway event for a refund we do not know (e.g. made in the Razorpay dashboard)
  event_type        text        not null,
  from_status       text,
  to_status         text,
  provider          text,
  provider_event_id text,
  actor_id          uuid        references public.profiles (id) on delete set null,
  actor_role        text        not null check (actor_role in ('admin', 'system', 'gateway')),
  note              text        check (note is null or char_length(note) <= 2000),
  payload           jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists refund_events_refund_idx on public.refund_events (refund_id, created_at);
create unique index if not exists refund_events_provider_uq on public.refund_events (provider, provider_event_id) where provider_event_id is not null;

drop trigger if exists refunds_touch on public.refunds;
create trigger refunds_touch before update on public.refunds
  for each row execute function public.app_touch_updated_at();

-- 2 -- the guards the UI can never replace ----------------------------------------------------------------------------------------------
-- (create_refund takes the ORDER row lock first, so two refunds of one order are serialised and this check is race-free)
create or replace function public.trg_refunds_cap()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_total numeric;
  v_other numeric;
begin
  if new.status = 'failed' then return new; end if;                 -- a failed refund moved no money and no longer counts
  select o.total into v_total from public.orders o where o.id = new.order_id;
  select coalesce(sum(r.amount), 0) into v_other from public.refunds r
   where r.order_id = new.order_id and r.status in ('pending', 'succeeded') and r.id <> new.id;
  if v_other + new.amount > coalesce(v_total, 0) + 0.005 then
    raise exception 'Refunds of order % would add up to % but the customer paid %', new.order_id, v_other + new.amount, coalesce(v_total, 0)
      using errcode = '23514', detail = 'EXCEEDS_PAID';
  end if;
  return new;
end;
$$;
drop trigger if exists refunds_cap on public.refunds;
create trigger refunds_cap before insert or update of amount, status on public.refunds
  for each row execute function public.trg_refunds_cap();

create or replace function public.trg_refund_items_cap()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_ordered integer;
  v_done    integer;
begin
  select oi.quantity into v_ordered from public.order_items oi where oi.id = new.order_item_id;
  select coalesce(sum(ri.quantity), 0) into v_done from public.refund_items ri join public.refunds r on r.id = ri.refund_id
   where ri.order_item_id = new.order_item_id and r.status in ('pending', 'succeeded');
  if v_done > coalesce(v_ordered, 0) then
    raise exception 'More units of an order line would be refunded (%) than were ordered (%)', v_done, coalesce(v_ordered, 0) using errcode = '23514', detail = 'EXCEEDS_QUANTITY';
  end if;
  return new;
end;
$$;
drop trigger if exists refund_items_cap on public.refund_items;
create trigger refund_items_cap after insert on public.refund_items
  for each row execute function public.trg_refund_items_cap();

-- 3 -- RLS: customers read their own refunds, admins everything, nobody writes directly --------------------------------------------------
alter table public.refunds        enable row level security;
alter table public.refund_items   enable row level security;
alter table public.refund_private enable row level security;
alter table public.refund_events  enable row level security;
revoke all on public.refunds, public.refund_items, public.refund_private, public.refund_events from anon, authenticated;
grant select on public.refunds, public.refund_items, public.refund_private, public.refund_events to authenticated;

drop policy if exists refunds_select on public.refunds;
create policy refunds_select on public.refunds for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid()));
drop policy if exists refund_items_select on public.refund_items;
create policy refund_items_select on public.refund_items for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.refunds f join public.orders o on o.id = f.order_id where f.id = refund_items.refund_id and o.user_id = auth.uid()));
drop policy if exists refund_private_select on public.refund_private;
create policy refund_private_select on public.refund_private for select to authenticated using (public.app_is_admin());
drop policy if exists refund_events_select on public.refund_events;
create policy refund_events_select on public.refund_events for select to authenticated using (public.app_is_admin());

-- 4 -- helpers (no API grants) ---------------------------------------------------------------------------------------------------------------
create or replace function public.app_next_refund_no()
returns text
language sql volatile
as $$
  select 'RFD-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.refund_no_seq')::text, 6, '0')
$$;

-- one customer notification for a refund (kind order_update, data.type = 'refund'); a failure to queue it never blocks the money step
create or replace function public.app_notify_refund(p_refund_id uuid, p_title text, p_body text)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  f public.refunds;
  o public.orders;
begin
  select * into f from public.refunds where id = p_refund_id;
  if not found then return; end if;
  select * into o from public.orders where id = f.order_id;
  if o.user_id is null then return; end if;
  begin
    perform public.app_queue_notification(o.user_id, 'order_update', p_title, p_body,
      jsonb_build_object('type', 'refund', 'refundId', f.id, 'refundNo', f.refund_no, 'requestId', f.request_id, 'orderId', f.order_id, 'status', f.status));
  exception when others then
    raise warning 'refund notification skipped: %', sqlerrm;
  end;
end;
$$;

-- 5 -- the calculation --------------------------------------------------------------------------------------------------------------------------
-- Read-only; callers lock the order first when they are going to WRITE a refund from the result.
-- Returns { request_id, order_id, currency, paid_total, refunded_so_far, refundable_remaining, paid_for_goods, shipping_charge,
--           seller_fault, shipping_eligible, shipping_reason, lines[], items_amount, shipping_amount, adjustment_amount, amount }
create or replace function public.app_refund_compute(p_request_id uuid, p_include_shipping boolean default null, p_adjustment numeric default 0)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  r           public.return_requests;
  o           public.orders;
  rec         record;
  v_paid_goods numeric;
  v_refunded  numeric;
  v_remaining numeric;
  v_items     numeric := 0;
  v_lines     jsonb := '[]'::jsonb;
  v_units_total integer := 0;
  v_units_after integer := 0;
  v_picked    integer := 0;
  v_cum       integer;
  v_amt       numeric;
  v_prev_ship numeric;
  v_fault     boolean;
  v_ship_ok   boolean;
  v_ship_why  text;
  v_ship      numeric := 0;
  v_adj       numeric := round(coalesce(p_adjustment, 0), 2);
  v_amount    numeric;
begin
  select * into r from public.return_requests where id = p_request_id;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.type <> 'return' then
    raise exception 'A refund is calculated for a return request (an exchange settles a price difference separately)' using errcode = '22023';
  end if;
  if r.status not in ('inspection_passed', 'refund_pending') then
    raise exception 'A refund can be prepared once the returned items passed inspection (this request is "%")', replace(r.status, '_', ' ') using errcode = '22023';
  end if;
  if exists (select 1 from public.refunds f where f.request_id = r.id and f.kind = 'return' and f.status in ('pending', 'succeeded')) then
    raise exception 'A refund is already in progress or completed for this request' using errcode = '22023', detail = 'REFUND_EXISTS';
  end if;
  select * into o from public.orders where id = r.order_id;
  if lower(btrim(coalesce(o.payment_status, ''))) <> 'paid' then
    raise exception 'This order is not marked as paid, so there is nothing to refund' using errcode = '22023', detail = 'NOT_PAID';
  end if;

  v_paid_goods := greatest(0, coalesce(o.total, 0) - least(coalesce(o.shipping, 0), coalesce(o.total, 0)));
  select coalesce(sum(f.amount), 0) into v_refunded from public.refunds f where f.order_id = o.id and f.status in ('pending', 'succeeded');
  v_remaining := coalesce(o.total, 0) - v_refunded;
  select coalesce(sum(f.shipping_amount), 0) into v_prev_ship from public.refunds f where f.order_id = o.id and f.status in ('pending', 'succeeded');

  for rec in
    with li as (
      select oi.id, oi.quantity, oi.line_total, coalesce(oi.product_title, oi.title) as title, oi.variant_name,
             row_number() over (order by oi.id) as rn, count(*) over () as cnt, sum(oi.line_total) over () as sum_lt
        from public.order_items oi where oi.order_id = o.id
    ), a0 as (
      select li.*, case when li.sum_lt > 0 then round(v_paid_goods * li.line_total / li.sum_lt, 2) else 0 end as share from li
    ), alloc as (
      select a0.*, case when a0.rn = a0.cnt
                        then greatest(0, v_paid_goods - coalesce(sum(a0.share) over (order by a0.rn rows between unbounded preceding and 1 preceding), 0))
                        else a0.share end as paid_share
        from a0
    )
    select alloc.id as order_item_id, alloc.title, alloc.variant_name, alloc.quantity, alloc.paid_share,
           coalesce((select sum(ri.quantity) from public.refund_items ri join public.refunds f on f.id = ri.refund_id
                      where ri.order_item_id = alloc.id and f.status in ('pending', 'succeeded')), 0)::integer as prev_q,
           coalesce((select sum(ri.amount) from public.refund_items ri join public.refunds f on f.id = ri.refund_id
                      where ri.order_item_id = alloc.id and f.status in ('pending', 'succeeded')), 0) as prev_amt,
           i.id as request_item_id, coalesce(i.quantity, 0) as q
      from alloc
      left join public.return_request_items i on i.request_id = r.id and i.order_item_id = alloc.id and i.item_status = 'passed'
     order by alloc.rn
  loop
    v_units_total := v_units_total + rec.quantity;
    v_cum := rec.prev_q + rec.q;
    v_units_after := v_units_after + v_cum;
    if rec.q > 0 then
      if v_cum > rec.quantity then
        raise exception 'Item "%" has already been refunded (% of % units)', rec.title, rec.prev_q, rec.quantity using errcode = '22023', detail = 'EXCEEDS_QUANTITY';
      end if;
      v_amt := greatest(0, round(rec.paid_share * v_cum / rec.quantity, 2) - rec.prev_amt);
      v_items := v_items + v_amt;
      v_picked := v_picked + 1;
      v_lines := v_lines || jsonb_build_object('order_item_id', rec.order_item_id, 'request_item_id', rec.request_item_id, 'title', rec.title,
                   'variant_name', rec.variant_name, 'quantity', rec.q, 'ordered', rec.quantity, 'already_refunded_units', rec.prev_q,
                   'paid_share', rec.paid_share, 'amount', v_amt);
    end if;
  end loop;
  if v_picked = 0 then
    raise exception 'Nothing to refund: no item of this request passed the inspection' using errcode = '22023', detail = 'NOTHING_TO_REFUND';
  end if;

  select coalesce(rr.seller_fault, false) into v_fault from public.request_reasons rr where rr.code = r.reason_code;
  v_fault := coalesce(v_fault, false);
  v_ship_ok := coalesce(o.shipping, 0) > 0 and v_units_after = v_units_total and v_fault and v_prev_ship = 0;
  v_ship_why := case
    when coalesce(o.shipping, 0) <= 0       then 'The order had no shipping charge'
    when v_units_after <> v_units_total     then 'The shipping charge is refunded only when every item of the order is returned'
    when not v_fault                        then 'The shipping charge is refunded only when the return is the seller''s fault (damaged, wrong, missing, defective, not as described)'
    when v_prev_ship > 0                    then 'The shipping charge was already refunded'
    else 'Every item of the order is returned for a seller-fault reason' end;
  if p_include_shipping is true and not v_ship_ok then
    raise exception 'The shipping charge cannot be refunded here: %', v_ship_why using errcode = '22023', detail = 'SHIPPING_NOT_ELIGIBLE';
  end if;
  if v_ship_ok and coalesce(p_include_shipping, true) then v_ship := least(coalesce(o.shipping, 0), coalesce(o.total, 0)); end if;

  v_amount := v_items + v_ship + v_adj;
  if v_amount <= 0 then raise exception 'The refund amount must be greater than zero' using errcode = '22023', detail = 'AMOUNT_NOT_POSITIVE'; end if;
  if v_amount > v_remaining + 0.005 then
    raise exception 'The refund (%) is more than what can still be refunded for this order (%)', v_amount, greatest(v_remaining, 0) using errcode = '22023', detail = 'EXCEEDS_PAID';
  end if;

  return jsonb_build_object(
    'request_id', r.id, 'order_id', o.id, 'currency', 'INR',
    'paid_total', o.total, 'refunded_so_far', v_refunded, 'refundable_remaining', v_remaining,
    'paid_for_goods', v_paid_goods, 'shipping_charge', coalesce(o.shipping, 0),
    'seller_fault', v_fault, 'shipping_eligible', v_ship_ok, 'shipping_reason', v_ship_why,
    'lines', v_lines, 'items_amount', v_items, 'shipping_amount', v_ship, 'adjustment_amount', v_adj, 'amount', v_amount,
    'razorpay_possible', coalesce(o.razorpay_payment_id, '') <> '' and lower(coalesce(o.payment_method, '')) = 'razorpay',
    'payment_method', o.payment_method);
end;
$$;

-- what the admin screen shows before anything is created
create or replace function public.refund_calculate(p_request_id uuid, p_include_shipping boolean default null, p_adjustment numeric default 0)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null or not public.app_is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  return public.app_refund_compute(p_request_id, p_include_shipping, p_adjustment);
end;
$$;

-- 6 -- create ------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.create_refund(
  p_request_id      uuid,
  p_idempotency_key text,
  p_method          text,                          -- 'razorpay' | 'manual'
  p_include_shipping boolean default null,         -- NULL = refund the shipping charge when it is eligible
  p_adjustment      numeric default 0,             -- + goodwill / - deduction; needs a written reason
  p_adjustment_note text    default null,
  p_note            text    default null)          -- staff only
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid   uuid := auth.uid();
  r       public.return_requests;
  o       public.orders;
  f       public.refunds;
  v_key   text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_adj   numeric := round(coalesce(p_adjustment, 0), 2);
  v_anote text := nullif(btrim(coalesce(p_adjustment_note, '')), '');
  v_calc  jsonb;
  l       jsonb;
begin
  r := public.app_lock_request_for_admin(p_request_id);              -- admin check + ORDER lock + request lock
  if v_key is null or char_length(v_key) not between 8 and 100 then raise exception 'An idempotency key of 8 to 100 characters is required' using errcode = '22023'; end if;
  select * into f from public.refunds where idempotency_key = v_key;
  if found then                                                       -- a retry (double click, lost response) returns the same refund
    if f.request_id is distinct from p_request_id then raise exception 'This idempotency key belongs to another refund' using errcode = '22023'; end if;
    return jsonb_build_object('ok', true, 'created', false, 'refund_id', f.id, 'refund_no', f.refund_no, 'status', f.status, 'amount', f.amount, 'method', f.method);
  end if;
  if p_method is null or p_method not in ('razorpay', 'manual') then raise exception 'The refund method must be razorpay or manual' using errcode = '22023'; end if;
  select * into o from public.orders where id = r.order_id;
  if p_method = 'razorpay' and (coalesce(o.razorpay_payment_id, '') = '' or lower(coalesce(o.payment_method, '')) <> 'razorpay') then
    raise exception 'This order was not paid through Razorpay, so it cannot be refunded through the gateway - choose a manual refund' using errcode = '22023', detail = 'NOT_RAZORPAY';
  end if;
  if v_adj <> 0 and v_anote is null then raise exception 'Explain the adjustment (the customer can read it)' using errcode = '22023'; end if;
  if v_adj = 0 then v_anote := null; end if;
  if v_anote is not null and char_length(v_anote) > 300 then raise exception 'The adjustment note is too long (300 characters at most)' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is not null and char_length(btrim(p_note)) > 1000 then raise exception 'The note is too long (1000 characters at most)' using errcode = '22023'; end if;

  v_calc := public.app_refund_compute(p_request_id, p_include_shipping, v_adj);

  insert into public.refunds (refund_no, order_id, request_id, kind, amount, items_amount, shipping_amount, adjustment_amount, adjustment_note,
                              method, status, gateway_state, idempotency_key)
  values (public.app_next_refund_no(), o.id, r.id, 'return', (v_calc ->> 'amount')::numeric, (v_calc ->> 'items_amount')::numeric,
          (v_calc ->> 'shipping_amount')::numeric, v_adj, v_anote, p_method, 'pending', case when p_method = 'razorpay' then 'not_sent' end, v_key)
  returning * into f;
  insert into public.refund_private (refund_id, internal_note, initiated_by) values (f.id, nullif(btrim(coalesce(p_note, '')), ''), v_uid);
  for l in select e.value from jsonb_array_elements(v_calc -> 'lines') as e loop
    insert into public.refund_items (refund_id, order_item_id, request_item_id, quantity, amount)
    values (f.id, (l ->> 'order_item_id')::uuid, (l ->> 'request_item_id')::uuid, (l ->> 'quantity')::integer, (l ->> 'amount')::numeric);
  end loop;
  insert into public.refund_events (refund_id, event_type, to_status, actor_id, actor_role, note)
  values (f.id, 'created', 'pending', v_uid, 'admin', format('%s refund of %s %s', p_method, f.amount, f.currency));

  if r.status = 'inspection_passed' then
    -- the staff note stays in refund_private; only the customer-facing sentence travels with the transition
    r := public.app_apply_request_transition(r.id, 'refund_pending', 'admin', v_uid, null, format('A refund of ₹%s is being prepared.', f.amount), true);
  end if;
  return jsonb_build_object('ok', true, 'created', true, 'refund_id', f.id, 'refund_no', f.refund_no, 'status', f.status, 'amount', f.amount, 'method', f.method,
                            'request_status', r.status, 'calculation', v_calc);
end;
$$;

-- 7 -- finishing a refund (internal: ONE place moves a refund to succeeded / failed) ---------------------------------------------------------
create or replace function public.app_refund_finish(
  p_refund_id uuid, p_outcome text, p_actor_role text, p_actor uuid,
  p_reason text default null, p_reference text default null, p_completed_at timestamptz default null, p_event text default null)
returns public.refunds
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  f public.refunds;
  r public.return_requests;
  v_ev  text;
  v_old text;
  v_moved boolean := false;
begin
  select * into f from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  if f.status = p_outcome then return f; end if;                       -- repeating a finished step changes nothing
  if f.status = 'succeeded' then return f; end if;                     -- money already moved: never take that back
  v_old := f.status;

  if p_outcome = 'succeeded' then
    v_ev := coalesce(p_event, 'marked_succeeded');
    update public.refunds
       set status = 'succeeded', completed_at = coalesce(p_completed_at, now()), failure_reason = null,
           reference = coalesce(nullif(btrim(coalesce(p_reference, '')), ''), reference), updated_at = now()
     where id = f.id returning * into f;
    insert into public.refund_events (refund_id, event_type, from_status, to_status, actor_id, actor_role, note)
    values (f.id, v_ev, v_old, 'succeeded', p_actor, p_actor_role, nullif(btrim(coalesce(p_reference, '')), ''));
    update public.return_request_items set item_status = 'resolved'
     where item_status = 'passed' and id in (select ri.request_item_id from public.refund_items ri where ri.refund_id = f.id and ri.request_item_id is not null);
    if f.request_id is not null and f.kind = 'return' then
      select * into r from public.return_requests where id = f.request_id for update;
      if found and r.status = 'refund_pending' then
        perform public.app_apply_request_transition(r.id, 'refunded', 'system', p_actor, null, format('Your refund of ₹%s was completed.', f.amount), true);
        v_moved := true;                                                -- the transition already told the customer
      end if;
    end if;
    -- an order-level refund or an exchange price difference has no "refund pending" step to move: it tells the customer itself
    if not v_moved then
      perform public.app_notify_refund(f.id, 'Your refund is complete', format('%s · ₹%s was refunded.', f.refund_no, f.amount));
    end if;
  else
    v_ev := coalesce(p_event, 'marked_failed');
    update public.refunds
       set status = 'failed', failure_reason = left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'The refund could not be completed'), 300), updated_at = now()
     where id = f.id returning * into f;
    insert into public.refund_events (refund_id, event_type, from_status, to_status, actor_id, actor_role, note)
    values (f.id, v_ev, v_old, 'failed', p_actor, p_actor_role, f.failure_reason);
    perform public.app_notify_refund(f.id, 'Refund failed - please contact support', format('%s · the refund of ₹%s could not be completed. Please contact us.', f.refund_no, f.amount));
    perform public.app_notify_admins('Refund failed', format('%s · %s', f.refund_no, f.failure_reason),
              jsonb_build_object('type', 'admin_refund', 'refundId', f.id, 'refundNo', f.refund_no, 'orderId', f.order_id, 'requestId', f.request_id));
  end if;
  return f;
end;
$$;

-- 8 -- manual refunds + voiding ----------------------------------------------------------------------------------------------------------------------
create or replace function public.refund_mark_manual(
  p_refund_id uuid, p_outcome text, p_reference text default null, p_note text default null, p_completed_at timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_oid text;
  f     public.refunds;
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_why text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null or not public.app_is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  select x.order_id into v_oid from public.refunds x where x.id = p_refund_id;
  if v_oid is null then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_oid for update;                      -- ORDER first, like every money path
  select * into f from public.refunds where id = p_refund_id for update;
  if f.method <> 'manual' then raise exception 'Only a manual refund is confirmed by hand; a gateway refund follows the gateway (use "Check status")' using errcode = '22023'; end if;
  if p_outcome is null or p_outcome not in ('succeeded', 'failed') then raise exception 'The outcome must be succeeded or failed' using errcode = '22023'; end if;
  if f.status = p_outcome then return jsonb_build_object('ok', true, 'already', true, 'status', f.status, 'refund_id', f.id); end if;
  if f.status <> 'pending' then raise exception 'This refund is already % and cannot be changed', f.status using errcode = '22023'; end if;
  if p_outcome = 'succeeded' then
    if v_ref is null then raise exception 'Enter the payment reference (bank / UPI transaction id, or a note of how it was paid)' using errcode = '22023'; end if;
    if char_length(v_ref) > 200 then raise exception 'The reference is too long (200 characters at most)' using errcode = '22023'; end if;
    if p_completed_at is not null and p_completed_at > now() + interval '10 minutes' then raise exception 'The payment time cannot be in the future' using errcode = '22023'; end if;
    f := public.app_refund_finish(f.id, 'succeeded', 'admin', v_uid, null, v_ref, p_completed_at, 'marked_succeeded');
  else
    if v_why is null then raise exception 'Say why the refund failed (the customer can read it)' using errcode = '22023'; end if;
    f := public.app_refund_finish(f.id, 'failed', 'admin', v_uid, v_why, null, null, 'marked_failed');
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'status', f.status, 'refund_id', f.id);
end;
$$;

-- cancels a refund that has not paid anything out yet (manual, or a gateway refund that was never sent)
create or replace function public.refund_void(p_refund_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_oid text;
  f     public.refunds;
  v_why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not public.app_is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  select x.order_id into v_oid from public.refunds x where x.id = p_refund_id;
  if v_oid is null then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_oid for update;
  select * into f from public.refunds where id = p_refund_id for update;
  if f.status = 'failed' then return jsonb_build_object('ok', true, 'already', true, 'status', f.status, 'refund_id', f.id); end if;
  if f.status <> 'pending' then raise exception 'A refund that has been paid out cannot be cancelled' using errcode = '22023'; end if;
  if f.method = 'razorpay' and f.gateway_state is distinct from 'not_sent' then
    raise exception 'This refund was already sent to the gateway: use "Check status" to find out what happened to it' using errcode = '22023', detail = 'ALREADY_SENT';
  end if;
  if v_why is null then raise exception 'Say why the refund is cancelled' using errcode = '22023'; end if;
  f := public.app_refund_finish(f.id, 'failed', 'admin', v_uid, 'Cancelled: ' || v_why, null, null, 'voided');
  return jsonb_build_object('ok', true, 'already', false, 'status', f.status, 'refund_id', f.id);
end;
$$;

-- 9 -- the gateway path (service role only: the Edge Function refund-create and the payment webhook) ----------------------------------------------
-- begin: claim the right to call the gateway. Returns what to send; a second claim for the same refund is refused (never sent twice).
create or replace function public.refund_begin_gateway(p_refund_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_oid text;
  f     public.refunds;
  o     public.orders;
  rq    public.return_requests;
begin
  select x.order_id into v_oid from public.refunds x where x.id = p_refund_id;
  if v_oid is null then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_oid for update;
  select * into f from public.refunds where id = p_refund_id for update;
  if f.method <> 'razorpay' then return jsonb_build_object('proceed', false, 'reason', 'WRONG_METHOD'); end if;
  if f.status <> 'pending' then return jsonb_build_object('proceed', false, 'reason', 'NOT_PENDING', 'status', f.status); end if;
  if f.gateway_state is distinct from 'not_sent' then return jsonb_build_object('proceed', false, 'reason', 'ALREADY_SENT', 'gateway_state', f.gateway_state); end if;
  select * into o from public.orders where id = f.order_id;
  if coalesce(o.razorpay_payment_id, '') = '' then return jsonb_build_object('proceed', false, 'reason', 'NO_PAYMENT_ID'); end if;
  if f.request_id is not null then select * into rq from public.return_requests where id = f.request_id; end if;
  update public.refunds set gateway_state = 'submitting', updated_at = now() where id = f.id;
  insert into public.refund_private (refund_id, attempts) values (f.id, 1)
    on conflict (refund_id) do update set attempts = public.refund_private.attempts + 1;
  insert into public.refund_events (refund_id, event_type, actor_role, note) values (f.id, 'gateway_sending', 'system', 'The refund is being sent to Razorpay');
  return jsonb_build_object('proceed', true, 'refund_id', f.id, 'refund_no', f.refund_no, 'amount_paise', round(f.amount * 100)::bigint, 'currency', f.currency,
                            'razorpay_payment_id', o.razorpay_payment_id, 'receipt', f.refund_no,
                            'notes', jsonb_strip_nulls(jsonb_build_object('refund_id', f.id, 'refund_no', f.refund_no, 'order_id', f.order_id, 'request_no', rq.request_no)));
end;
$$;

-- the gateway context for a status check (no state change)
create or replace function public.refund_gateway_context(p_refund_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  f public.refunds;
  o public.orders;
begin
  select * into f from public.refunds where id = p_refund_id;
  if not found then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  select * into o from public.orders where id = f.order_id;
  return jsonb_build_object('refund_id', f.id, 'refund_no', f.refund_no, 'method', f.method, 'status', f.status, 'gateway_state', f.gateway_state,
                            'gateway_refund_id', f.gateway_refund_id, 'razorpay_payment_id', o.razorpay_payment_id, 'amount_paise', round(f.amount * 100)::bigint,
                            'state_age_seconds', round(extract(epoch from (now() - f.updated_at)))::integer);   -- how long the gateway state has been what it is (status checks)
end;
$$;

-- record what the gateway answered to the API call (or, for 'unknown', that it did not answer)
create or replace function public.refund_record_gateway_result(
  p_refund_id uuid, p_outcome text, p_gateway_refund_id text default null, p_gateway_status text default null,
  p_error text default null, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_oid text;
  f     public.refunds;
  v_st  text := lower(nullif(btrim(coalesce(p_gateway_status, '')), ''));
  v_err text := nullif(btrim(coalesce(p_error, '')), '');
begin
  if p_outcome is null or p_outcome not in ('accepted', 'rejected', 'unknown') then raise exception 'The outcome must be accepted, rejected or unknown' using errcode = '22023'; end if;
  select x.order_id into v_oid from public.refunds x where x.id = p_refund_id;
  if v_oid is null then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_oid for update;
  select * into f from public.refunds where id = p_refund_id for update;
  if f.method <> 'razorpay' then raise exception 'Only a gateway refund has a gateway result' using errcode = '22023'; end if;

  if p_outcome = 'accepted' then
    if p_gateway_refund_id is null then raise exception 'The gateway refund id is required' using errcode = '22023'; end if;
    update public.refunds
       set gateway_refund_id = coalesce(gateway_refund_id, p_gateway_refund_id), gateway_status = coalesce(v_st, gateway_status), gateway_state = 'submitted',
           reference = coalesce(reference, p_gateway_refund_id), updated_at = now()
     where id = f.id and status in ('pending', 'failed');
    update public.refund_private set gateway_payload = coalesce(p_payload, '{}'::jsonb), gateway_error = null where refund_id = f.id;
    insert into public.refund_events (refund_id, event_type, actor_role, note, payload) values (f.id, 'gateway_accepted', 'system', coalesce(v_st, 'accepted'), p_payload);
    if v_st = 'processed' then
      f := public.app_refund_finish(f.id, 'succeeded', 'system', null, null, p_gateway_refund_id, now(), 'gateway_processed');
    elsif v_st = 'failed' then
      -- the gateway's own wording goes to the staff (refund_private); the customer reads a plain sentence
      update public.refund_private set gateway_error = v_err where refund_id = f.id;
      f := public.app_refund_finish(f.id, 'failed', 'system', null, 'The payment gateway could not complete this refund', null, null, 'gateway_failed');
    end if;
  elsif p_outcome = 'rejected' then
    if f.status = 'pending' then
      update public.refunds set gateway_state = 'not_sent', updated_at = now() where id = f.id;
      update public.refund_private set gateway_error = v_err, gateway_payload = coalesce(p_payload, '{}'::jsonb) where refund_id = f.id;
      f := public.app_refund_finish(f.id, 'failed', 'system', null, 'The payment gateway could not process this refund', null, null, 'gateway_rejected');
    end if;
  else
    update public.refunds set gateway_state = 'unknown', updated_at = now() where id = f.id and status = 'pending';
    update public.refund_private set gateway_error = v_err where refund_id = f.id;
    insert into public.refund_events (refund_id, event_type, actor_role, note, payload) values (f.id, 'gateway_unknown', 'system', v_err, p_payload);
    perform public.app_notify_admins('Refund needs a status check', format('%s · the gateway did not confirm the refund of ₹%s', f.refund_no, f.amount),
              jsonb_build_object('type', 'admin_refund', 'refundId', f.id, 'refundNo', f.refund_no, 'orderId', f.order_id, 'requestId', f.request_id));
  end if;
  select * into f from public.refunds where id = f.id;
  return jsonb_build_object('ok', true, 'status', f.status, 'gateway_state', f.gateway_state, 'refund_id', f.id);
end;
$$;

-- a webhook event (refund.created / refund.processed / refund.failed): idempotent per (provider, event id)
create or replace function public.refund_apply_gateway_event(
  p_event_id text, p_gateway_refund_id text, p_status text, p_error text default null,
  p_notes jsonb default '{}'::jsonb, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  f      public.refunds;
  v_st   text := lower(nullif(btrim(coalesce(p_status, '')), ''));
  v_evt  uuid;
  v_note text := p_notes ->> 'refund_id';
begin
  if nullif(btrim(coalesce(p_event_id, '')), '') is null then raise exception 'An event id is required' using errcode = '22023'; end if;
  -- find OUR refund: by the gateway id, else by the id we put in the notes when we sent it (the answer to our API call may have been lost)
  select * into f from public.refunds where gateway_refund_id = p_gateway_refund_id and p_gateway_refund_id is not null;
  if not found and v_note ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into f from public.refunds where id = v_note::uuid and method = 'razorpay';
  end if;
  insert into public.refund_events (refund_id, event_type, provider, provider_event_id, actor_role, note, payload)
  values (f.id, 'gateway_event', 'razorpay', p_event_id, 'gateway', v_st, p_payload)
  on conflict (provider, provider_event_id) where provider_event_id is not null do nothing
  returning id into v_evt;
  if v_evt is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;       -- the same event again: nothing to do
  if f.id is null then return jsonb_build_object('ok', true, 'matched', false); end if;         -- a refund made outside this app (e.g. in the Razorpay dashboard)

  perform 1 from public.orders where id = f.order_id for update;
  select * into f from public.refunds where id = f.id for update;
  update public.refunds
     set gateway_refund_id = coalesce(gateway_refund_id, p_gateway_refund_id), gateway_status = coalesce(v_st, gateway_status),
         gateway_state = case when gateway_state in ('not_sent', 'submitting', 'unknown') then 'submitted' else gateway_state end,
         reference = coalesce(reference, p_gateway_refund_id), updated_at = now()
   where id = f.id;
  if v_st in ('processed', 'succeeded') then
    f := public.app_refund_finish(f.id, 'succeeded', 'system', null, null, p_gateway_refund_id, now(), 'gateway_processed');
  elsif v_st = 'failed' then
    update public.refund_private set gateway_error = nullif(btrim(coalesce(p_error, '')), '') where refund_id = f.id;
    f := public.app_refund_finish(f.id, 'failed', 'system', null, 'The payment gateway could not complete this refund', null, null, 'gateway_failed');
  else
    select * into f from public.refunds where id = f.id;
  end if;
  return jsonb_build_object('ok', true, 'matched', true, 'refund_id', f.id, 'status', f.status);
end;
$$;

-- 10 -- grants ------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function public.app_next_refund_no()                                                              from public, anon, authenticated, service_role;
revoke all on function public.app_notify_refund(uuid, text, text)                                               from public, anon, authenticated, service_role;
revoke all on function public.app_refund_compute(uuid, boolean, numeric)                                        from public, anon, authenticated, service_role;
revoke all on function public.app_refund_finish(uuid, text, text, uuid, text, text, timestamptz, text)          from public, anon, authenticated, service_role;
revoke all on function public.trg_refunds_cap()                                                                  from public, anon, authenticated, service_role;
revoke all on function public.trg_refund_items_cap()                                                             from public, anon, authenticated, service_role;
revoke all on function public.refund_calculate(uuid, boolean, numeric)                                          from public, anon;
revoke all on function public.create_refund(uuid, text, text, boolean, numeric, text, text)                     from public, anon;
revoke all on function public.refund_mark_manual(uuid, text, text, text, timestamptz)                           from public, anon;
revoke all on function public.refund_void(uuid, text)                                                           from public, anon;
revoke all on function public.refund_begin_gateway(uuid)                                                        from public, anon, authenticated;
revoke all on function public.refund_gateway_context(uuid)                                                      from public, anon, authenticated;
revoke all on function public.refund_record_gateway_result(uuid, text, text, text, text, jsonb)                 from public, anon, authenticated;
revoke all on function public.refund_apply_gateway_event(text, text, text, text, jsonb, jsonb)                  from public, anon, authenticated;
grant execute on function public.refund_calculate(uuid, boolean, numeric)                                       to authenticated;      -- the admin check is inside
grant execute on function public.create_refund(uuid, text, text, boolean, numeric, text, text)                  to authenticated;
grant execute on function public.refund_mark_manual(uuid, text, text, text, timestamptz)                        to authenticated;
grant execute on function public.refund_void(uuid, text)                                                        to authenticated;
grant execute on function public.refund_begin_gateway(uuid)                                                     to service_role;
grant execute on function public.refund_gateway_context(uuid)                                                   to service_role;
grant execute on function public.refund_record_gateway_result(uuid, text, text, text, text, jsonb)              to service_role;
grant execute on function public.refund_apply_gateway_event(text, text, text, text, jsonb, jsonb)               to service_role;

commit;

notify pgrst, 'reload schema';