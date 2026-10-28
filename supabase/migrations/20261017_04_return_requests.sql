-- ============================================================================
-- M4 — Return / exchange REQUESTS: tables, eligibility, state machine, customer RPCs, private evidence bucket
--      (IMPLEMENTATION_PLAN Phase 6; the admin workflow + return logistics are M4b = 20261017_05_return_workflow.sql;
--       requires M3 for orders.delivered_at)
--
-- THE MODEL (all linked, never collapsed — an order, a shipment, a request and a refund are separate rows):
--   return_requests        one request = ONE type ('return' | 'exchange') for ONE order; its status runs the state machine below
--   return_request_items   the order lines + quantities involved; each line has its OWN decision / inspection state
--   return_request_evidence  photos in the PRIVATE bucket `return-evidence` (<uid>/<request id>/<file>)
--   return_request_events  the audit trail (who, when, from -> to, note); customers see the non-internal ones
--   return_request_private admin-only: internal note, who decided
--   request_reasons        configurable reason categories (+ whether a photo / description is required, seller fault)
--   request_status_transitions  the allowed moves per request type and actor (data, not code)
--
-- ELIGIBILITY (get_order_eligibility / app_item_eligibility — the ONLY place the rules live; web and RN only ask):
--   an order line may be returned / exchanged when the order is delivered (delivered_at present), the policy of THAT option allows it
--   (purchase-time snapshot -> current variant -> current product -> store default), the window is open, units remain and the line
--   has no request in progress. DEADLINE (documented, tested at the boundary): delivered_at's calendar DATE in Asia/Kolkata + N days,
--   valid through 23:59:59.999 IST of that day. Reason codes: NOT_DELIVERED, NO_DELIVERY_DATE, POLICY_DISABLED, WINDOW_EXPIRED,
--   NO_REMAINING_QTY, ACTIVE_REQUEST.
--
-- WRITES: customers never write these tables; create_return_request / cancel_return_request / respond_to_request do. The client
-- generates the request id (uuid) FIRST, uploads the photos to <uid>/<request id>/..., then calls the RPC with the same id, which makes
-- the call idempotent (a retry returns the existing request) and lets the server check that every photo really is in storage.
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M1..M3). SAFE TO RE-RUN. Rollback: 20261017_04_rollback.sql.
-- ROLL-OUT ORDER: SQL first (M4, then M4b), then the website, then the RN app.
-- ============================================================================
begin;

-- 1 -- reasons (configurable) -----------------------------------------------------------------------------------------------
create table if not exists public.request_reasons (
  code                 text        primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  label                text        not null check (btrim(label) <> '' and char_length(label) <= 80),
  applies_to           text[]      not null default array['return', 'exchange']
                                   check (cardinality(applies_to) > 0 and applies_to <@ array['return', 'exchange']),
  seller_fault         boolean     not null default false,      -- drives the refund rules (return shipping / outbound shipping refund)
  requires_evidence    boolean     not null default false,      -- at least one photo
  requires_description boolean     not null default false,
  active               boolean     not null default true,
  sort_order           integer     not null default 100,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
insert into public.request_reasons (code, label, seller_fault, requires_evidence, requires_description, sort_order) values
  ('damaged',          'Damaged product',          true,  true,  false, 10),
  ('wrong_product',    'Wrong product received',   true,  true,  false, 20),
  ('missing_item',     'Missing item',             true,  false, true,  30),
  ('defective',        'Defective product',        true,  true,  false, 40),
  ('incorrect_size',   'Incorrect size',           false, false, false, 50),
  ('incorrect_color',  'Incorrect color',          false, false, false, 60),
  ('not_as_described', 'Product not as described', true,  true,  true,  70),
  ('other',            'Other',                    false, false, true,  90)
on conflict (code) do nothing;

alter table public.request_reasons enable row level security;
revoke all on public.request_reasons from anon, authenticated;
grant select, insert, update, delete on public.request_reasons to authenticated;       -- writes limited to admins by the policy below
drop policy if exists request_reasons_read on public.request_reasons;
create policy request_reasons_read on public.request_reasons for select to authenticated using (active or public.app_is_admin());
drop policy if exists request_reasons_admin_write on public.request_reasons;
create policy request_reasons_admin_write on public.request_reasons for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

-- 2 -- the state machine as DATA ----------------------------------------------------------------------------------------------
-- actor: 'customer' (the owner), 'admin' (an administrator through the RPCs), 'system' (a DB function reacting to something else:
--        a refund completing, a replacement shipping ...). The status values are shared; the transitions differ per type.
create table if not exists public.request_status_transitions (
  request_type text not null check (request_type in ('return', 'exchange')),
  from_status  text not null,
  to_status    text not null,
  actor        text not null check (actor in ('customer', 'admin', 'system')),
  primary key (request_type, from_status, to_status, actor)
);
-- return
insert into public.request_status_transitions (request_type, from_status, to_status, actor) values
  ('return', 'pending_review',           'needs_info',               'admin'),
  ('return', 'pending_review',           'approved',                 'admin'),
  ('return', 'pending_review',           'rejected',                 'admin'),
  ('return', 'pending_review',           'cancelled',                'customer'),
  ('return', 'pending_review',           'cancelled',                'admin'),
  ('return', 'needs_info',               'pending_review',           'customer'),
  ('return', 'needs_info',               'pending_review',           'admin'),
  ('return', 'needs_info',               'rejected',                 'admin'),
  ('return', 'needs_info',               'cancelled',                'customer'),
  ('return', 'needs_info',               'cancelled',                'admin'),
  ('return', 'approved',                 'awaiting_return_shipment', 'admin'),
  ('return', 'approved',                 'cancelled',                'customer'),
  ('return', 'approved',                 'cancelled',                'admin'),
  ('return', 'awaiting_return_shipment', 'return_in_transit',        'admin'),
  ('return', 'awaiting_return_shipment', 'return_in_transit',        'customer'),
  ('return', 'awaiting_return_shipment', 'return_in_transit',        'system'),
  ('return', 'awaiting_return_shipment', 'return_received',          'admin'),
  ('return', 'awaiting_return_shipment', 'cancelled',                'customer'),
  ('return', 'awaiting_return_shipment', 'cancelled',                'admin'),
  ('return', 'return_in_transit',        'return_received',          'admin'),
  ('return', 'return_in_transit',        'cancelled',                'admin'),
  ('return', 'return_received',          'inspection_pending',       'admin'),
  ('return', 'return_received',          'inspection_pending',       'system'),
  ('return', 'inspection_pending',       'inspection_passed',        'system'),
  ('return', 'inspection_pending',       'inspection_failed',        'system'),
  ('return', 'inspection_passed',        'refund_pending',           'admin'),
  ('return', 'inspection_passed',        'refund_pending',           'system'),
  ('return', 'inspection_failed',        'closed',                   'admin'),
  ('return', 'refund_pending',           'refunded',                 'system'),
  ('return', 'refunded',                 'closed',                   'admin'),
  ('return', 'refunded',                 'closed',                   'system')
on conflict do nothing;
-- exchange: the same road up to the inspection, then the replacement is sent (the replacement steps are driven by Phase 10 / M5)
insert into public.request_status_transitions (request_type, from_status, to_status, actor)
select 'exchange', from_status, to_status, actor from public.request_status_transitions
 where request_type = 'return' and to_status not in ('refund_pending', 'refunded') and from_status not in ('inspection_passed', 'refund_pending', 'refunded')
on conflict do nothing;
insert into public.request_status_transitions (request_type, from_status, to_status, actor) values
  ('exchange', 'inspection_passed',     'replacement_pending',   'admin'),
  ('exchange', 'inspection_passed',     'replacement_pending',   'system'),
  ('exchange', 'replacement_pending',   'replacement_shipped',   'system'),
  ('exchange', 'replacement_pending',   'cancelled',             'admin'),
  ('exchange', 'replacement_shipped',   'replacement_delivered', 'system'),
  ('exchange', 'replacement_delivered', 'closed',                'admin'),
  ('exchange', 'replacement_delivered', 'closed',                'system')
on conflict do nothing;

alter table public.request_status_transitions enable row level security;
revoke all on public.request_status_transitions from anon, authenticated;
grant select on public.request_status_transitions to authenticated;
drop policy if exists request_status_transitions_read on public.request_status_transitions;
create policy request_status_transitions_read on public.request_status_transitions for select to authenticated using (true);

-- 3 -- the request tables -------------------------------------------------------------------------------------------------------
create sequence if not exists public.return_request_no_seq;
create sequence if not exists public.exchange_request_no_seq;

create table if not exists public.return_requests (
  id                  uuid        primary key,                      -- generated by the client (idempotency key + photo folder)
  request_no          text        not null unique,                  -- RET-2026-000123 / EXC-2026-000045
  order_id            text        not null references public.orders (id) on delete restrict,
  user_id             uuid        references public.profiles (id) on delete set null,     -- the customer (NULL: guest / POS order handled by an admin)
  type                text        not null check (type in ('return', 'exchange')),
  status              text        not null default 'pending_review'
                                  check (status in ('pending_review', 'needs_info', 'approved', 'rejected', 'awaiting_return_shipment', 'return_in_transit',
                                                    'return_received', 'inspection_pending', 'inspection_passed', 'inspection_failed', 'refund_pending',
                                                    'refunded', 'replacement_pending', 'replacement_shipped', 'replacement_delivered', 'closed', 'cancelled')),
  reason_code         text        not null references public.request_reasons (code),
  description         text        check (description is null or char_length(description) <= 2000),
  contact_phone       text        check (contact_phone is null or char_length(contact_phone) <= 30),
  delivered_at        timestamptz,                                  -- snapshot of orders.delivered_at at submission
  customer_note       text        check (customer_note is null or char_length(customer_note) <= 1000),   -- the latest message the customer sees
  -- return logistics (Phase 8, written by the M4b RPCs): how the parcel comes back and what the customer is told
  return_method       text        check (return_method is null or return_method in ('courier_pickup', 'customer_arranged', 'manual')),
  return_instructions text        check (return_instructions is null or char_length(return_instructions) <= 2000),
  decided_at          timestamptz,
  received_at         timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists return_requests_order_idx  on public.return_requests (order_id);
create index if not exists return_requests_user_idx   on public.return_requests (user_id, created_at desc);
create index if not exists return_requests_status_idx on public.return_requests (type, status, created_at desc);

-- admin-only side of the request (a customer must never read staff notes or who decided)
create table if not exists public.return_request_private (
  request_id    uuid  primary key references public.return_requests (id) on delete cascade,
  internal_note text  check (internal_note is null or char_length(internal_note) <= 2000),
  decided_by    uuid  references public.profiles (id) on delete set null,
  meta          jsonb not null default '{}'::jsonb
);

create table if not exists public.return_request_items (
  id                     uuid        primary key default gen_random_uuid(),
  request_id             uuid        not null references public.return_requests (id) on delete cascade,
  order_item_id          uuid        not null references public.order_items (id) on delete restrict,
  quantity               integer     not null check (quantity > 0),
  reason_code            text        references public.request_reasons (code),        -- NULL = the request's reason
  item_condition         text        check (item_condition is null or item_condition in ('unopened', 'opened', 'used', 'damaged')),
  -- per-line decision / inspection: approving or rejecting one line never touches another
  item_status            text        not null default 'pending'
                                     check (item_status in ('pending', 'approved', 'rejected', 'cancelled', 'received', 'passed', 'failed', 'resolved')),
  decision_note          text        check (decision_note is null or char_length(decision_note) <= 1000),     -- customer-visible (rejection reason)
  inspection_note        text        check (inspection_note is null or char_length(inspection_note) <= 1000), -- customer-visible
  unit_price             numeric     not null,                                         -- the purchase snapshot (never today's catalogue price)
  policy_window_days     integer,
  policy_deadline        timestamptz,
  -- exchange: what the customer wants instead (1:1 quantity; the stock is reserved only when the admin approves, Phase 10)
  replacement_product_id text,
  replacement_variant_id text,
  replacement_qty        integer     check (replacement_qty is null or replacement_qty > 0),
  price_difference       numeric,                                                      -- ESTIMATE at request time (replacement - purchased); recorded, never auto-charged
  decided_at             timestamptz,
  inspected_at           timestamptz,
  created_at             timestamptz not null default now(),
  constraint return_request_items_unique_line unique (request_id, order_item_id)
);
create index if not exists return_request_items_request_idx on public.return_request_items (request_id);
create index if not exists return_request_items_line_idx    on public.return_request_items (order_item_id);
-- ONE request in progress per order line (a rejected / cancelled / finished one does not block the next)
create unique index if not exists return_request_items_one_active_uq on public.return_request_items (order_item_id)
  where item_status in ('pending', 'approved', 'received', 'passed');

create table if not exists public.return_request_evidence (
  id           uuid        primary key default gen_random_uuid(),
  request_id   uuid        not null references public.return_requests (id) on delete cascade,
  storage_path text        not null unique check (char_length(storage_path) <= 300),
  mime         text        not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes   integer     not null check (size_bytes between 1 and 5242880),
  uploaded_by  uuid        references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists return_request_evidence_request_idx on public.return_request_evidence (request_id);

create table if not exists public.return_request_events (
  id          uuid        primary key default gen_random_uuid(),
  request_id  uuid        not null references public.return_requests (id) on delete cascade,
  item_id     uuid        references public.return_request_items (id) on delete set null,
  from_status text,
  to_status   text,
  actor_id    uuid        references public.profiles (id) on delete set null,
  actor_role  text        not null check (actor_role in ('customer', 'admin', 'system')),
  note        text        check (note is null or char_length(note) <= 2000),
  internal    boolean     not null default false,               -- true: staff only
  created_at  timestamptz not null default now()
);
create index if not exists return_request_events_request_idx on public.return_request_events (request_id, created_at);

drop trigger if exists return_requests_touch on public.return_requests;
create trigger return_requests_touch before update on public.return_requests
  for each row execute function public.app_touch_updated_at();

-- 4 -- RLS: customers read their own, admins everything, nobody writes directly ---------------------------------------------------
alter table public.return_requests         enable row level security;
alter table public.return_request_private  enable row level security;
alter table public.return_request_items    enable row level security;
alter table public.return_request_evidence enable row level security;
alter table public.return_request_events   enable row level security;
revoke all on public.return_requests, public.return_request_private, public.return_request_items,
              public.return_request_evidence, public.return_request_events from anon, authenticated;
grant select on public.return_requests, public.return_request_private, public.return_request_items,
                public.return_request_evidence, public.return_request_events to authenticated;

drop policy if exists return_requests_select on public.return_requests;
create policy return_requests_select on public.return_requests for select to authenticated
  using (public.app_is_admin() or user_id = auth.uid());
drop policy if exists return_request_private_select on public.return_request_private;
create policy return_request_private_select on public.return_request_private for select to authenticated using (public.app_is_admin());
drop policy if exists return_request_items_select on public.return_request_items;
create policy return_request_items_select on public.return_request_items for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.return_requests r where r.id = return_request_items.request_id and r.user_id = auth.uid()));
drop policy if exists return_request_evidence_select on public.return_request_evidence;
create policy return_request_evidence_select on public.return_request_evidence for select to authenticated
  using (public.app_is_admin() or exists (select 1 from public.return_requests r where r.id = return_request_evidence.request_id and r.user_id = auth.uid()));
drop policy if exists return_request_events_select on public.return_request_events;
create policy return_request_events_select on public.return_request_events for select to authenticated
  using (public.app_is_admin() or (not internal and exists (select 1 from public.return_requests r where r.id = return_request_events.request_id and r.user_id = auth.uid())));

-- 5 -- policy, deadline and eligibility ------------------------------------------------------------------------------------------------
-- store defaults (settings.returnPolicyDefaults) with the same fallbacks the admin card uses
create or replace function public.app_store_return_defaults()
returns jsonb
language sql stable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'returnEnabled',      coalesce((s.data ->> 'returnEnabled')::boolean, true),
    'returnWindowDays',   coalesce(nullif(s.data ->> 'returnWindowDays', '')::integer, 7),
    'exchangeEnabled',    coalesce((s.data ->> 'exchangeEnabled')::boolean, true),
    'exchangeWindowDays', coalesce(nullif(s.data ->> 'exchangeWindowDays', '')::integer, 7))
  from (select 1) x left join public.settings s on s.id = 'returnPolicyDefaults'
$$;

-- the deadline rule, in ONE place: end of the Nth calendar day (Asia/Kolkata) after the delivery date
create or replace function public.app_return_deadline(p_delivered_at timestamptz, p_days integer)
returns timestamptz
language sql immutable
as $$
  select case when p_delivered_at is null or p_days is null then null
              else ((((p_delivered_at at time zone 'Asia/Kolkata')::date + p_days + 1)::timestamp) at time zone 'Asia/Kolkata') - interval '1 millisecond' end
$$;

-- effective policy of ONE order line: the purchase-time snapshot, else the current variant, else the current product, else the store default
create or replace function public.app_item_policy(p_order_item_id uuid)
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  oi public.order_items;
  v  public.product_variants;
  p  public.products;
  d  jsonb := public.app_store_return_defaults();
  r_en boolean; r_days integer; r_src text;
  e_en boolean; e_days integer; e_src text;
begin
  select * into oi from public.order_items where id = p_order_item_id;
  if not found then return null; end if;
  select * into p from public.products where id = oi.product_id;
  if coalesce(oi.variant_id, '') <> '' then select * into v from public.product_variants where id = oi.variant_id and product_id = oi.product_id; end if;

  if oi.return_enabled is not null then r_en := oi.return_enabled; r_days := oi.return_window_days; r_src := 'snapshot';
  elsif v.id is not null and v.return_enabled is not null then r_en := v.return_enabled; r_days := v.return_window_days; r_src := 'variant';
  elsif p.id is not null then r_en := p.return_enabled; r_days := p.return_window_days; r_src := 'product';
  else r_en := (d ->> 'returnEnabled')::boolean; r_days := (d ->> 'returnWindowDays')::integer; r_src := 'store'; end if;

  if oi.exchange_enabled is not null then e_en := oi.exchange_enabled; e_days := oi.exchange_window_days; e_src := 'snapshot';
  elsif v.id is not null and v.exchange_enabled is not null then e_en := v.exchange_enabled; e_days := v.exchange_window_days; e_src := 'variant';
  elsif p.id is not null then e_en := p.exchange_enabled; e_days := p.exchange_window_days; e_src := 'product';
  else e_en := (d ->> 'exchangeEnabled')::boolean; e_days := (d ->> 'exchangeWindowDays')::integer; e_src := 'store'; end if;

  return jsonb_build_object('returnEnabled', coalesce(r_en, true), 'returnWindowDays', case when coalesce(r_en, true) then coalesce(r_days, (d ->> 'returnWindowDays')::integer) end, 'returnSource', r_src,
                            'exchangeEnabled', coalesce(e_en, true), 'exchangeWindowDays', case when coalesce(e_en, true) then coalesce(e_days, (d ->> 'exchangeWindowDays')::integer) end, 'exchangeSource', e_src);
end;
$$;

-- one line, one type: { eligible, reasons[], window_days, deadline, remaining_qty, active_request_id, policy_source }
create or replace function public.app_item_eligibility(p_order_item_id uuid, p_type text, p_now timestamptz default now())
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  oi     public.order_items;
  o      public.orders;
  pol    jsonb;
  v_en   boolean;
  v_days integer;
  v_src  text;
  v_dl   timestamptz;
  v_used integer;
  v_rem  integer;
  v_act  uuid;
  v_reasons text[] := '{}';
begin
  select * into oi from public.order_items where id = p_order_item_id;
  if not found then return null; end if;
  select * into o from public.orders where id = oi.order_id;
  pol := public.app_item_policy(p_order_item_id);
  if p_type = 'exchange' then
    v_en := (pol ->> 'exchangeEnabled')::boolean; v_days := (pol ->> 'exchangeWindowDays')::integer; v_src := pol ->> 'exchangeSource';
  else
    v_en := (pol ->> 'returnEnabled')::boolean;   v_days := (pol ->> 'returnWindowDays')::integer;   v_src := pol ->> 'returnSource';
  end if;

  if lower(btrim(coalesce(o.order_status, ''))) <> 'delivered' then v_reasons := array_append(v_reasons, 'NOT_DELIVERED'); end if;
  if lower(btrim(coalesce(o.order_status, ''))) = 'delivered' and o.delivered_at is null then v_reasons := array_append(v_reasons, 'NO_DELIVERY_DATE'); end if;
  if not coalesce(v_en, false) then v_reasons := array_append(v_reasons, 'POLICY_DISABLED'); end if;
  if o.delivered_at is not null and v_days is not null then
    v_dl := public.app_return_deadline(o.delivered_at, v_days);
    if p_now > v_dl then v_reasons := array_append(v_reasons, 'WINDOW_EXPIRED'); end if;
  end if;

  -- units still available to ask for: not counting lines rejected / cancelled (they go back to the pool)
  select coalesce(sum(i.quantity), 0)::integer into v_used from public.return_request_items i
   where i.order_item_id = p_order_item_id and i.item_status not in ('rejected', 'cancelled');
  v_rem := greatest(oi.quantity - v_used, 0);
  if v_rem <= 0 then v_reasons := array_append(v_reasons, 'NO_REMAINING_QTY'); end if;
  select i.request_id into v_act from public.return_request_items i
   where i.order_item_id = p_order_item_id and i.item_status in ('pending', 'approved', 'received', 'passed') limit 1;
  if v_act is not null then v_reasons := array_append(v_reasons, 'ACTIVE_REQUEST'); end if;

  return jsonb_build_object('eligible', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons), 'window_days', v_days, 'deadline', v_dl,
                            'remaining_qty', v_rem, 'active_request_id', v_act, 'policy_source', v_src);
end;
$$;

-- the whole order for the screens: one call tells web and RN what to show (the UI never re-implements a rule)
create or replace function public.get_order_eligibility(p_order_id text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid   uuid := auth.uid();
  o       public.orders;
  v_items jsonb;
begin
  if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order_id;
  -- a stranger gets the same answer as for a missing order (no probing of other customers' orders)
  if not found or not (public.app_is_admin() or o.user_id = v_uid) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_item_id', oi.id, 'product_id', oi.product_id, 'variant_id', coalesce(oi.variant_id, ''),
           'title', coalesce(oi.product_title, oi.title), 'variant_name', oi.variant_name, 'image', oi.image,
           'quantity', oi.quantity, 'unit_price', oi.unit_price,
           'return', public.app_item_eligibility(oi.id, 'return'), 'exchange', public.app_item_eligibility(oi.id, 'exchange')
         ) order by oi.id), '[]'::jsonb) into v_items
    from public.order_items oi where oi.order_id = o.id;
  return jsonb_build_object('order_id', o.id, 'order_status', o.order_status, 'delivered_at', o.delivered_at, 'timezone', 'Asia/Kolkata', 'items', v_items);
end;
$$;

-- 6 -- state machine engine + notifications (internal helpers: no API grants) ---------------------------------------------------------------
create or replace function public.app_next_request_no(p_type text)
returns text
language sql volatile
as $$
  select case when p_type = 'exchange'
              then 'EXC-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.exchange_request_no_seq')::text, 6, '0')
              else 'RET-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.return_request_no_seq')::text, 6, '0') end
$$;

create or replace function public.app_notify_admins(p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'admin' loop
    begin
      perform public.app_queue_notification(r.id, 'system', p_title, p_body, p_data);
    exception when others then
      raise warning 'admin notification skipped: %', sqlerrm;
    end;
  end loop;
end;
$$;

create or replace function public.app_notify_request_customer(p_request_id uuid, p_title text, p_body text)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare r public.return_requests;
begin
  select * into r from public.return_requests where id = p_request_id;
  if not found or r.user_id is null then return; end if;
  begin
    perform public.app_queue_notification(r.user_id, 'order_update', p_title, p_body,
      jsonb_build_object('type', r.type, 'requestId', r.id, 'requestNo', r.request_no, 'orderId', r.order_id, 'status', r.status));
  exception when others then
    raise warning 'request notification skipped: %', sqlerrm;
  end;
end;
$$;

-- ONE function moves a request: checks the transition table for the actor, stamps the timestamps, writes the audit event, tells the customer.
create or replace function public.app_apply_request_transition(
  p_request_id uuid, p_to text, p_actor_role text, p_actor_id uuid,
  p_note text default null, p_customer_note text default null, p_notify boolean default true)
returns public.return_requests
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  r        public.return_requests;
  v_from   text;
  v_ok     boolean;
  v_title  text;
  v_body   text;
  v_label  text;
begin
  select * into r from public.return_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  v_from := r.status;
  if v_from in ('rejected', 'closed', 'cancelled') then
    raise exception 'This request is % and can no longer change', replace(v_from, '_', ' ') using errcode = '22023';
  end if;
  select exists (select 1 from public.request_status_transitions t
                  where t.request_type = r.type and t.from_status = v_from and t.to_status = p_to
                    and (t.actor = p_actor_role or (p_actor_role = 'system' and t.actor = 'admin'))) into v_ok;
  if not v_ok then
    raise exception 'A % request cannot go from "%" to "%" (%)', r.type, replace(v_from, '_', ' '), replace(p_to, '_', ' '), p_actor_role using errcode = '22023';
  end if;

  update public.return_requests
     set status = p_to,
         customer_note = coalesce(nullif(btrim(coalesce(p_customer_note, '')), ''), customer_note),
         decided_at = case when p_to in ('approved', 'rejected') and decided_at is null then now() else decided_at end,
         closed_at  = case when p_to in ('closed', 'cancelled', 'rejected') and closed_at is null then now() else closed_at end,
         updated_at = now()
   where id = p_request_id
   returning * into r;
  insert into public.return_request_events (request_id, from_status, to_status, actor_id, actor_role, note, internal)
  values (p_request_id, v_from, p_to, p_actor_id, p_actor_role, nullif(btrim(coalesce(p_customer_note, p_note, '')), ''), false);

  if p_notify and r.user_id is not null and not (p_actor_role = 'customer') then
    v_label := case when r.type = 'exchange' then 'exchange' else 'return' end;
    v_title := case p_to
      when 'approved'                 then initcap(v_label) || ' approved'
      when 'rejected'                 then 'Your ' || v_label || ' request was not approved'
      when 'needs_info'               then 'We need more information'
      when 'awaiting_return_shipment' then 'Return instructions are ready'
      when 'return_received'          then 'We received your parcel'
      when 'inspection_passed'        then 'Your return passed our check'
      when 'inspection_failed'        then 'Your return could not be accepted'
      when 'refund_pending'           then 'Your refund is being prepared'
      when 'refunded'                 then 'Your refund is complete'
      when 'replacement_pending'      then 'Your replacement is being prepared'
      when 'replacement_shipped'      then 'Your replacement is on its way'
      when 'replacement_delivered'    then 'Your replacement was delivered'
      when 'cancelled'                then 'Your ' || v_label || ' request was cancelled'
      else null end;
    if v_title is not null then
      v_body := r.request_no || ' · ' || coalesce(nullif(btrim(coalesce(p_customer_note, '')), ''), 'Open the order to see the details.');
      perform public.app_notify_request_customer(p_request_id, v_title, v_body);
    end if;
  end if;
  return r;
end;
$$;

-- 7 -- create_return_request ------------------------------------------------------------------------------------------------------------------
create or replace function public.create_return_request(
  p_request_id     uuid,
  p_order_id       text,
  p_type           text,
  p_items          jsonb,                       -- [{ order_item_id, quantity, reason_code?, condition?, replacement_variant_id?, replacement_product_id? }]
  p_reason_code    text,
  p_description    text    default null,
  p_contact_phone  text    default null,
  p_evidence       jsonb   default '[]'::jsonb, -- [{ path, mime?, size? }]  (path = <uid>/<request id>/<file>, already uploaded)
  p_admin_override boolean default false)       -- ADMIN ONLY, on behalf of a customer: waives WINDOW_EXPIRED / POLICY_DISABLED (logged)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid     uuid := auth.uid();
  v_admin   boolean;
  v_exist   public.return_requests;
  o         public.orders;
  v_reason  public.request_reasons;
  v_item    jsonb;
  v_ireason public.request_reasons;
  oi        public.order_items;
  v_iid     uuid;
  v_qty     integer;
  v_el      jsonb;
  v_codes   text[];
  v_pol     jsonb;
  v_seen    uuid[] := '{}';
  v_need_ev boolean;
  v_ev      jsonb;
  v_path    text;
  v_mime    text;
  v_size    bigint;
  v_n_ev    integer := 0;
  v_md      jsonb;
  v_rep_p   text;
  v_rep_v   text;
  v_rep_price numeric;
  v_status  text;
  v_cond    text;
  v_phone   text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_desc    text := nullif(btrim(coalesce(p_description, '')), '');
  v_req     public.return_requests;
  v_item_id uuid;
  v_count   integer := 0;
  v_have_storage boolean := to_regclass('storage.objects') is not null;
begin
  if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  v_admin := public.app_is_admin();
  if p_admin_override and not v_admin then raise exception 'Only an administrator can waive the return rules' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'A request id is required' using errcode = '22023'; end if;
  if p_type is null or p_type not in ('return', 'exchange') then raise exception 'The request type must be return or exchange' using errcode = '22023'; end if;

  -- a retry of the same request (double click, lost response) returns it instead of creating a second one
  select * into v_exist from public.return_requests where id = p_request_id;
  if found then
    if not (v_admin or v_exist.user_id = v_uid) then raise exception 'Request not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('ok', true, 'created', false, 'request_id', v_exist.id, 'request_no', v_exist.request_no, 'status', v_exist.status);
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found or not (v_admin or o.user_id = v_uid) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if lower(btrim(coalesce(o.order_status, ''))) <> 'delivered' then raise exception 'Only a delivered order can be returned or exchanged' using errcode = '22023'; end if;
  if o.delivered_at is null then raise exception 'This order has no recorded delivery date; contact support' using errcode = '22023'; end if;

  select * into v_reason from public.request_reasons where code = p_reason_code;
  if not found or (not v_reason.active and not v_admin) then raise exception 'Choose a reason from the list' using errcode = '22023'; end if;
  if not (p_type = any (v_reason.applies_to)) then raise exception 'The reason "%" does not apply to a %', v_reason.label, p_type using errcode = '22023'; end if;
  if v_desc is not null and char_length(v_desc) > 2000 then raise exception 'The description is too long (2000 characters at most)' using errcode = '22023'; end if;
  if v_phone is not null and v_phone !~ '^[0-9+()\- ]{6,30}$' then raise exception 'Enter a valid contact phone number' using errcode = '22023'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Select at least one item' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'At most 50 items per request' using errcode = '54000'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' then raise exception 'Evidence must be a list of uploaded files' using errcode = '22023'; end if;
  if jsonb_array_length(p_evidence) > 6 then raise exception 'At most 6 photos per request' using errcode = '54000'; end if;

  -- 1) every line: belongs to the order, eligible, quantity within what is left
  v_need_ev := coalesce(v_reason.requires_evidence, false);
  if v_reason.requires_description and v_desc is null then raise exception 'Please describe the problem (required for "%")', v_reason.label using errcode = '22023'; end if;
  for v_item in select e.value from jsonb_array_elements(p_items) as e loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Each item must be an object' using errcode = '22023'; end if;
    begin
      v_iid := (v_item ->> 'order_item_id')::uuid;
      v_qty := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'Each item needs a valid order_item_id and a whole-number quantity' using errcode = '22023';
    end;
    if v_qty is null or v_qty < 1 then raise exception 'The quantity of an item must be at least 1' using errcode = '22023'; end if;
    if v_iid = any (v_seen) then raise exception 'An item appears twice in the request' using errcode = '22023'; end if;
    v_seen := v_seen || v_iid;
    select * into oi from public.order_items where id = v_iid and order_id = o.id;
    if not found then raise exception 'Item % does not belong to order %', v_iid, o.id using errcode = '22023'; end if;
    v_el := public.app_item_eligibility(v_iid, p_type);
    select coalesce(array_agg(x), '{}') into v_codes from jsonb_array_elements_text(v_el -> 'reasons') as x;
    if p_admin_override then v_codes := array_remove(array_remove(v_codes, 'WINDOW_EXPIRED'), 'POLICY_DISABLED'); end if;
    if cardinality(v_codes) > 0 then
      raise exception 'Item "%" cannot be %: %', coalesce(oi.product_title, oi.title), case when p_type = 'exchange' then 'exchanged' else 'returned' end, array_to_string(v_codes, ', ') using errcode = '22023', detail = array_to_string(v_codes, ',');
    end if;
    if v_qty > (v_el ->> 'remaining_qty')::integer then
      raise exception 'Only % unit(s) of "%" can still be %', (v_el ->> 'remaining_qty')::integer, coalesce(oi.product_title, oi.title), case when p_type = 'exchange' then 'exchanged' else 'returned' end using errcode = '22023', detail = 'QTY_EXCEEDS_REMAINING';
    end if;
    if nullif(v_item ->> 'reason_code', '') is not null then
      select * into v_ireason from public.request_reasons where code = v_item ->> 'reason_code';
      if not found or not (p_type = any (v_ireason.applies_to)) then raise exception 'Unknown reason "%" for an item', v_item ->> 'reason_code' using errcode = '22023'; end if;
      v_need_ev := v_need_ev or v_ireason.requires_evidence;
    end if;
    if nullif(v_item ->> 'condition', '') is not null and (v_item ->> 'condition') not in ('unopened', 'opened', 'used', 'damaged') then
      raise exception 'Unknown item condition "%"', v_item ->> 'condition' using errcode = '22023';
    end if;
  end loop;

  -- 2) evidence: private bucket, own folder for THIS request, type and size checked
  for v_ev in select e.value from jsonb_array_elements(p_evidence) as e loop
    v_path := v_ev ->> 'path';
    if v_path is null or v_path !~ ('^' || v_uid::text || '/' || p_request_id::text || '/[A-Za-z0-9._-]{1,120}$') then
      raise exception 'A photo is not in your folder for this request (expected %/%/<file>)', v_uid, p_request_id using errcode = '22023';
    end if;
    v_mime := v_ev ->> 'mime'; v_size := nullif(v_ev ->> 'size', '')::bigint;
    if v_have_storage then
      select o2.metadata into v_md from storage.objects o2 where o2.bucket_id = 'return-evidence' and o2.name = v_path;
      if not found then raise exception 'The photo "%" was not uploaded', v_path using errcode = '22023'; end if;
      v_mime := coalesce(v_md ->> 'mimetype', v_mime); v_size := coalesce(nullif(v_md ->> 'size', '')::bigint, v_size);
    end if;
    if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Photos must be JPEG, PNG or WebP' using errcode = '22023'; end if;
    if v_size is null or v_size < 1 or v_size > 5242880 then raise exception 'Each photo must be 5 MB or smaller' using errcode = '22023'; end if;
    v_n_ev := v_n_ev + 1;
  end loop;
  if v_need_ev and v_n_ev = 0 then raise exception 'Please add at least one photo (required for this reason)' using errcode = '22023', detail = 'EVIDENCE_REQUIRED'; end if;

  -- 3) the request
  insert into public.return_requests (id, request_no, order_id, user_id, type, status, reason_code, description, contact_phone, delivered_at)
  values (p_request_id, public.app_next_request_no(p_type), o.id, o.user_id, p_type, 'pending_review', p_reason_code, v_desc, v_phone, o.delivered_at)
  returning * into v_req;
  insert into public.return_request_private (request_id) values (v_req.id);

  for v_item in select e.value from jsonb_array_elements(p_items) as e loop
    v_iid := (v_item ->> 'order_item_id')::uuid; v_qty := (v_item ->> 'quantity')::integer;
    select * into oi from public.order_items where id = v_iid;
    v_pol := public.app_item_policy(v_iid);
    v_el := public.app_item_eligibility(v_iid, p_type);
    v_rep_p := null; v_rep_v := null; v_rep_price := null;
    if p_type = 'exchange' then
      -- the replacement: the same product (another variant, or the same one again for a defective unit). Another product = a separate decision (Q-5).
      v_rep_p := coalesce(nullif(v_item ->> 'replacement_product_id', ''), oi.product_id);
      if v_rep_p <> oi.product_id then raise exception 'An exchange must be for the same product (another size / colour or the same item again)' using errcode = '22023'; end if;
      v_rep_v := coalesce(v_item ->> 'replacement_variant_id', coalesce(oi.variant_id, ''));
      if v_rep_v = '' then
        select case when p.has_variants then (case when p.main_option_enabled then public.app_effective_price(p.price, p.discount, p.discount_expiry) end)
                    else public.app_effective_price(p.price, p.discount, p.discount_expiry) end into v_rep_price
          from public.products p where p.id = v_rep_p and p.status = 'active';
        if not found or v_rep_price is null then raise exception 'The replacement option is not available' using errcode = '22023'; end if;
      else
        select pv.price into v_rep_price from public.product_variants pv where pv.id = v_rep_v and pv.product_id = v_rep_p and pv.status = 'active';
        if not found then raise exception 'The chosen replacement variant is not available' using errcode = '22023'; end if;
      end if;
    end if;
    insert into public.return_request_items
      (request_id, order_item_id, quantity, reason_code, item_condition, unit_price, policy_window_days, policy_deadline,
       replacement_product_id, replacement_variant_id, replacement_qty, price_difference)
    values
      (v_req.id, v_iid, v_qty, nullif(v_item ->> 'reason_code', ''), nullif(v_item ->> 'condition', ''), oi.unit_price,
       (v_el ->> 'window_days')::integer, nullif(v_el ->> 'deadline', '')::timestamptz,
       v_rep_p, v_rep_v, case when p_type = 'exchange' then v_qty end,
       case when p_type = 'exchange' then round((v_rep_price - oi.unit_price) * v_qty, 2) end)
    returning id into v_item_id;
    v_count := v_count + 1;
  end loop;

  for v_ev in select e.value from jsonb_array_elements(p_evidence) as e loop
    v_path := v_ev ->> 'path'; v_mime := v_ev ->> 'mime'; v_size := nullif(v_ev ->> 'size', '')::bigint;
    if v_have_storage then
      select o2.metadata into v_md from storage.objects o2 where o2.bucket_id = 'return-evidence' and o2.name = v_path;
      v_mime := coalesce(v_md ->> 'mimetype', v_mime); v_size := coalesce(nullif(v_md ->> 'size', '')::bigint, v_size);
    end if;
    insert into public.return_request_evidence (request_id, storage_path, mime, size_bytes, uploaded_by) values (v_req.id, v_path, v_mime, v_size::integer, v_uid);
  end loop;

  insert into public.return_request_events (request_id, to_status, actor_id, actor_role, note)
  values (v_req.id, 'pending_review', v_uid, case when v_admin and o.user_id is distinct from v_uid then 'admin' else 'customer' end, v_desc);
  if p_admin_override then
    insert into public.return_request_events (request_id, actor_id, actor_role, note, internal)
    values (v_req.id, v_uid, 'admin', 'Created by an administrator with the return rules waived (window / policy)', true);
  end if;

  perform public.app_notify_admins('New ' || p_type || ' request',
    v_req.request_no || ' · order #' || upper(right(o.id, 8)) || ' · ' || v_count || ' item(s) · ' || v_reason.label,
    jsonb_build_object('type', 'admin_request', 'requestId', v_req.id, 'requestNo', v_req.request_no, 'orderId', o.id));

  return jsonb_build_object('ok', true, 'created', true, 'request_id', v_req.id, 'request_no', v_req.request_no, 'status', v_req.status, 'items', v_count);
end;
$$;

-- 8 -- cancel / reply ----------------------------------------------------------------------------------------------------------------------------
create or replace function public.cancel_return_request(p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  r       public.return_requests;
  v_role  text;
begin
  if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  v_admin := public.app_is_admin();
  select * into r from public.return_requests where id = p_request_id;
  if not found or not (v_admin or r.user_id = v_uid) then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true, 'status', r.status); end if;
  v_role := case when r.user_id = v_uid then 'customer' else 'admin' end;
  r := public.app_apply_request_transition(p_request_id, 'cancelled', v_role, v_uid, p_note, case when v_role = 'admin' then p_note end, v_role = 'admin');
  -- the lines go back to the pool of units that can be asked for again
  update public.return_request_items set item_status = 'cancelled' where request_id = p_request_id and item_status in ('pending', 'approved');
  if v_role = 'customer' then
    perform public.app_notify_admins('Request cancelled', r.request_no || ' was cancelled by the customer',
      jsonb_build_object('type', 'admin_request', 'requestId', r.id, 'requestNo', r.request_no, 'orderId', r.order_id));
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'status', r.status);
end;
$$;

-- the customer answers a "we need more information" message (text and / or more photos); the request goes back to review
create or replace function public.respond_to_request(p_request_id uuid, p_message text, p_evidence jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid  uuid := auth.uid();
  r      public.return_requests;
  v_msg  text := nullif(btrim(coalesce(p_message, '')), '');
  v_ev   jsonb;
  v_path text;
  v_mime text;
  v_size bigint;
  v_md   jsonb;
  v_have_storage boolean := to_regclass('storage.objects') is not null;
begin
  if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into r from public.return_requests where id = p_request_id;
  if not found or r.user_id is distinct from v_uid then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'needs_info' then raise exception 'This request is not waiting for your answer' using errcode = '22023'; end if;
  if v_msg is null and (p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0) then
    raise exception 'Write a message or add a photo' using errcode = '22023';
  end if;
  if v_msg is not null and char_length(v_msg) > 1000 then raise exception 'The message is too long (1000 characters at most)' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array' or (select count(*) from public.return_request_evidence e where e.request_id = p_request_id) + jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) > 6 then
    raise exception 'At most 6 photos per request' using errcode = '54000';
  end if;
  for v_ev in select e.value from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) as e loop
    v_path := v_ev ->> 'path';
    if v_path is null or v_path !~ ('^' || v_uid::text || '/' || p_request_id::text || '/[A-Za-z0-9._-]{1,120}$') then
      raise exception 'A photo is not in your folder for this request' using errcode = '22023';
    end if;
    v_mime := v_ev ->> 'mime'; v_size := nullif(v_ev ->> 'size', '')::bigint;
    if v_have_storage then
      select o2.metadata into v_md from storage.objects o2 where o2.bucket_id = 'return-evidence' and o2.name = v_path;
      if not found then raise exception 'The photo "%" was not uploaded', v_path using errcode = '22023'; end if;
      v_mime := coalesce(v_md ->> 'mimetype', v_mime); v_size := coalesce(nullif(v_md ->> 'size', '')::bigint, v_size);
    end if;
    if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Photos must be JPEG, PNG or WebP' using errcode = '22023'; end if;
    if v_size is null or v_size < 1 or v_size > 5242880 then raise exception 'Each photo must be 5 MB or smaller' using errcode = '22023'; end if;
    insert into public.return_request_evidence (request_id, storage_path, mime, size_bytes, uploaded_by) values (p_request_id, v_path, v_mime, v_size::integer, v_uid)
    on conflict (storage_path) do nothing;
  end loop;
  r := public.app_apply_request_transition(p_request_id, 'pending_review', 'customer', v_uid, v_msg, null, false);     -- the event carries the message
  perform public.app_notify_admins('Customer replied', r.request_no || ' is waiting for review again',
    jsonb_build_object('type', 'admin_request', 'requestId', r.id, 'requestNo', r.request_no, 'orderId', r.order_id));
  return jsonb_build_object('ok', true, 'status', r.status);
end;
$$;

-- 9 -- the private evidence bucket (skipped where Supabase Storage does not exist, e.g. the local test database) -------------------------------------
create or replace function public.app_setup_return_evidence_storage()
returns void
language plpgsql
as $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('return-evidence', 'return-evidence', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  drop policy if exists "return evidence: upload own"  on storage.objects;
  drop policy if exists "return evidence: read own"    on storage.objects;
  drop policy if exists "return evidence: read admin"  on storage.objects;
  drop policy if exists "return evidence: delete own unsubmitted" on storage.objects;
  drop policy if exists "return evidence: admin delete" on storage.objects;
  -- uploads go to <auth.uid()>/<request id>/<file>
  create policy "return evidence: upload own" on storage.objects for insert to authenticated
    with check (bucket_id = 'return-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy "return evidence: read own" on storage.objects for select to authenticated
    using (bucket_id = 'return-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy "return evidence: read admin" on storage.objects for select to authenticated
    using (bucket_id = 'return-evidence' and public.app_is_admin());
  -- a customer can clean up an upload that never made it into a request, but never remove evidence of a submitted one
  create policy "return evidence: delete own unsubmitted" on storage.objects for delete to authenticated
    using (bucket_id = 'return-evidence' and (storage.foldername(name))[1] = auth.uid()::text
           and not exists (select 1 from public.return_request_evidence e where e.storage_path = name));
  create policy "return evidence: admin delete" on storage.objects for delete to authenticated
    using (bucket_id = 'return-evidence' and public.app_is_admin());
end;
$$;
select public.app_setup_return_evidence_storage();

-- 10 -- grants ---------------------------------------------------------------------------------------------------------------------------------------
-- Supabase hands EXECUTE on new functions to anon / authenticated by default: the helpers are revoked from them explicitly
revoke all on function public.app_store_return_defaults()                                  from public, anon, authenticated;
revoke all on function public.app_item_policy(uuid)                                        from public, anon, authenticated;
revoke all on function public.app_item_eligibility(uuid, text, timestamptz)                from public, anon, authenticated;
revoke all on function public.app_setup_return_evidence_storage()                          from public, anon, authenticated;
revoke all on function public.get_order_eligibility(text)                                   from public, anon;
revoke all on function public.create_return_request(uuid, text, text, jsonb, text, text, text, jsonb, boolean) from public, anon;
revoke all on function public.cancel_return_request(uuid, text)                            from public, anon;
revoke all on function public.respond_to_request(uuid, text, jsonb)                        from public, anon;
revoke all on function public.app_apply_request_transition(uuid, text, text, uuid, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.app_notify_admins(text, text, jsonb)                         from public, anon, authenticated, service_role;
revoke all on function public.app_notify_request_customer(uuid, text, text)                from public, anon, authenticated, service_role;
revoke all on function public.app_next_request_no(text)                                    from public, anon, authenticated, service_role;
grant execute on function public.get_order_eligibility(text)                               to authenticated;
grant execute on function public.create_return_request(uuid, text, text, jsonb, text, text, text, jsonb, boolean) to authenticated;
grant execute on function public.cancel_return_request(uuid, text)                         to authenticated;
grant execute on function public.respond_to_request(uuid, text, jsonb)                     to authenticated;
-- the building blocks stay callable only through those RPCs (and by the owner / admin tools): no direct API access to the raw policy functions
grant execute on function public.app_item_eligibility(uuid, text, timestamptz)             to service_role;

-- 11 -- realtime (the admin list refreshes when a request arrives) ------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['return_requests'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';