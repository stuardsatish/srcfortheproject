-- ============================================================================
-- M4b — Admin return / exchange WORKFLOW and RETURN LOGISTICS
--       (IMPLEMENTATION_PLAN Phases 7 and 8; requires M3 (shipments) and M4 (request tables, state machine engine))
--
-- WHAT THE ADMIN CAN DO (all RPCs: admin-only, one transaction each, the ORDER row is locked first, then the request, then shipments):
--   decide_request_items(...)          approve / reject EACH line on its own (a rejection must carry a customer-visible reason);
--                                      when no line is left pending the request becomes `approved` (at least one line approved) or `rejected`
--   request_transition(...)            the generic move allowed by request_status_transitions (needs_info, pending_review, in transit,
--                                      inspection, refund pending, closed, cancelled ...). Steps that need data have their own RPC below.
--   set_return_logistics(...)          Phase 8: HOW the parcel comes back (courier pickup / customer arranged / manual), the instructions the
--                                      customer sees, optional return courier + tracking number / link + pickup reference + charges;
--                                      moves approved -> awaiting_return_shipment. The return parcel is a `shipments` row with direction 'return'.
--   record_return_received(...)        the parcel is physically here (timestamp, note) -> return_received -> inspection_pending
--   record_inspection(...)             per line: passed / failed (a failure needs a customer-visible reason); the request becomes
--                                      inspection_passed (any line passed) or inspection_failed (none)
--   send_request_message / set_request_internal_note   customer-visible message / staff-only note
-- AND THE CUSTOMER:
--   customer_submit_return_shipment(...)   for "customer arranged": courier + tracking number of the parcel they sent -> return_in_transit
--
-- Nothing here refunds, restocks or ships a replacement: those are Phases 9-11 (M5 / M6). The hooks they will use are in place
-- (`app_after_inspection`, the `refund_pending` / `replacement_pending` transitions).
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M4). SAFE TO RE-RUN. Rollback: 20261017_05_rollback.sql (run it BEFORE 20261017_04_rollback.sql).
-- ============================================================================
begin;

-- 1 -- return shipments live in `shipments` (direction = 'return'), tied to their request ------------------------------------------------
alter table public.shipments add column if not exists request_id       uuid references public.return_requests (id) on delete set null;
alter table public.shipments add column if not exists pickup_reference text;
alter table public.shipments drop constraint if exists shipments_pickup_reference_chk;
alter table public.shipments add constraint shipments_pickup_reference_chk check (pickup_reference is null or char_length(pickup_reference) <= 80);
alter table public.shipments drop constraint if exists shipments_request_chk;
alter table public.shipments add constraint shipments_request_chk check ((direction = 'outbound') = (request_id is null));
create index if not exists shipments_request_idx on public.shipments (request_id) where request_id is not null;

-- once the courier reports the return parcel moving, the request follows (the admin can still move it by hand)
create or replace function public.trg_return_shipment_progress()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare r public.return_requests;
begin
  if new.direction = 'return' and new.request_id is not null and new.status in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') then
    select * into r from public.return_requests where id = new.request_id;
    if found and r.status = 'awaiting_return_shipment' then
      perform public.app_apply_request_transition(r.id, 'return_in_transit', 'system', null, 'The courier has the return parcel', null, false);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists shipments_return_progress on public.shipments;
create trigger shipments_return_progress after update of status on public.shipments
  for each row when (old.status is distinct from new.status)
  execute function public.trg_return_shipment_progress();

-- an admin may decide straight from "needs info" (the customer answered outside the app, or the answer is no longer needed)
insert into public.request_status_transitions (request_type, from_status, to_status, actor) values
  ('return',   'needs_info', 'approved', 'admin'),
  ('exchange', 'needs_info', 'approved', 'admin')
on conflict do nothing;

-- 2 -- hook for Phase 11 (restock on a passed inspection, the unsellable bucket on a failed one): a no-op until M6 replaces it ---------------
create or replace function public.app_after_inspection(p_item_id uuid, p_result text)
returns void
language plpgsql
as $$
begin
  null;
end;
$$;

-- small shared helper: admin check + order lock + request load (ORDER first, then REQUEST)
create or replace function public.app_lock_request_for_admin(p_request_id uuid)
returns public.return_requests
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_oid text;
  r     public.return_requests;
begin
  if auth.uid() is null or not public.app_is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  select rr.order_id into v_oid from public.return_requests rr where rr.id = p_request_id;
  if v_oid is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_oid for update;
  select * into r from public.return_requests where id = p_request_id for update;
  return r;
end;
$$;

-- 3 -- decide_request_items -----------------------------------------------------------------------------------------------------------------------
create or replace function public.decide_request_items(
  p_request_id    uuid,
  p_decisions     jsonb,                    -- [{ item_id, decision: 'approve' | 'reject', note }]  (note = what the customer is told; required for reject)
  p_internal_note text default null,
  p_customer_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid    uuid := auth.uid();
  r        public.return_requests;
  d        jsonb;
  v_iid    uuid;
  v_dec    text;
  v_note   text;
  it       public.return_request_items;
  v_seen   uuid[] := '{}';
  v_left   integer;
  v_appr   integer;
  v_rej    integer;
  v_lines  text := '';
  v_title  text;
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if r.status not in ('pending_review', 'needs_info') then raise exception 'Only a request that is pending review can be decided (this one is "%")', replace(r.status, '_', ' ') using errcode = '22023'; end if;
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then raise exception 'Choose approve or reject for at least one item' using errcode = '22023'; end if;

  for d in select e.value from jsonb_array_elements(p_decisions) as e loop
    begin
      v_iid := (d ->> 'item_id')::uuid;
    exception when others then
      raise exception 'Each decision needs a valid item_id' using errcode = '22023';
    end;
    v_dec := d ->> 'decision';
    v_note := nullif(btrim(coalesce(d ->> 'note', '')), '');
    if v_dec is null or v_dec not in ('approve', 'reject') then raise exception 'The decision must be approve or reject' using errcode = '22023'; end if;
    if v_iid = any (v_seen) then raise exception 'An item appears twice in the decisions' using errcode = '22023'; end if;
    v_seen := v_seen || v_iid;
    select * into it from public.return_request_items where id = v_iid and request_id = p_request_id for update;
    if not found then raise exception 'Item % is not part of this request', v_iid using errcode = '22023'; end if;
    if it.item_status <> 'pending' then raise exception 'This item was already decided (%)', it.item_status using errcode = '22023'; end if;
    if v_dec = 'reject' and v_note is null then raise exception 'Give the customer a reason for rejecting the item' using errcode = '22023'; end if;
    if v_note is not null and char_length(v_note) > 1000 then raise exception 'The note is too long (1000 characters at most)' using errcode = '22023'; end if;
    update public.return_request_items
       set item_status = case when v_dec = 'approve' then 'approved' else 'rejected' end, decision_note = v_note, decided_at = now()
     where id = v_iid;
    insert into public.return_request_events (request_id, item_id, actor_id, actor_role, note)
    values (p_request_id, v_iid, v_uid, 'admin', case when v_dec = 'approve' then 'Item approved' else 'Item rejected' end || coalesce(': ' || v_note, ''));
  end loop;

  if nullif(btrim(coalesce(p_internal_note, '')), '') is not null then
    insert into public.return_request_events (request_id, actor_id, actor_role, note, internal) values (p_request_id, v_uid, 'admin', btrim(p_internal_note), true);
    update public.return_request_private set internal_note = btrim(p_internal_note), decided_by = v_uid where request_id = p_request_id;
  else
    update public.return_request_private set decided_by = v_uid where request_id = p_request_id;
  end if;

  select count(*) filter (where item_status = 'pending'), count(*) filter (where item_status = 'approved'), count(*) filter (where item_status = 'rejected')
    into v_left, v_appr, v_rej from public.return_request_items where request_id = p_request_id;
  if v_left = 0 then
    select string_agg(coalesce(oi.product_title, oi.title) || coalesce(' (' || oi.variant_name || ')', '') || ': ' || coalesce(i.decision_note, 'not accepted'), '; ' order by i.created_at)
      into v_lines
      from public.return_request_items i join public.order_items oi on oi.id = i.order_item_id
     where i.request_id = p_request_id and i.item_status = 'rejected';
    v_title := coalesce(nullif(btrim(coalesce(p_customer_note, '')), ''),
                        case when v_rej = 0 then 'Approved.'
                             when v_appr = 0 then 'We could not approve this request. ' || coalesce(v_lines, '')
                             else 'Approved: ' || v_appr || ' item(s). Not approved: ' || coalesce(v_lines, '') end);
    r := public.app_apply_request_transition(p_request_id, case when v_appr > 0 then 'approved' else 'rejected' end, 'admin', v_uid, null, v_title, true);
  else
    select * into r from public.return_requests where id = p_request_id;
  end if;
  return jsonb_build_object('ok', true, 'status', r.status, 'approved', v_appr, 'rejected', v_rej, 'pending', v_left);
end;
$$;

-- 4 -- request_transition (the generic admin move) -------------------------------------------------------------------------------------------------
create or replace function public.request_transition(p_request_id uuid, p_to_status text, p_note text default null, p_customer_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  r      public.return_requests;
  v_note text := nullif(btrim(coalesce(p_customer_note, '')), '');
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if p_to_status in ('approved', 'rejected') then raise exception 'Approve or reject the items with decide_request_items' using errcode = '22023'; end if;
  if p_to_status = 'return_received' then raise exception 'Use record_return_received to record the parcel arriving' using errcode = '22023'; end if;
  if p_to_status in ('inspection_passed', 'inspection_failed') then raise exception 'Use record_inspection to record the result per item' using errcode = '22023'; end if;
  if p_to_status = 'awaiting_return_shipment' then raise exception 'Use set_return_logistics to choose how the parcel comes back' using errcode = '22023'; end if;
  if p_to_status in ('refunded', 'replacement_shipped', 'replacement_delivered') then raise exception 'This step is completed by the refund / replacement itself, not by hand' using errcode = '22023'; end if;
  if p_to_status = 'needs_info' and v_note is null then raise exception 'Tell the customer what information you need' using errcode = '22023'; end if;
  -- p_note is STAFF-ONLY (an internal event below); only p_customer_note reaches the customer
  r := public.app_apply_request_transition(p_request_id, p_to_status, 'admin', auth.uid(), null, v_note, true);
  if p_to_status = 'cancelled' then
    update public.return_request_items set item_status = 'cancelled' where request_id = p_request_id and item_status in ('pending', 'approved');
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    insert into public.return_request_events (request_id, actor_id, actor_role, note, internal) values (p_request_id, auth.uid(), 'admin', btrim(p_note), true);
  end if;
  return jsonb_build_object('ok', true, 'status', r.status);
end;
$$;

-- 5 -- return logistics (Phase 8) ---------------------------------------------------------------------------------------------------------------------
create or replace function public.set_return_logistics(
  p_request_id       uuid,
  p_method           text,                         -- courier_pickup | customer_arranged | manual
  p_instructions     text        default null,     -- what the customer is told (address to send to, pickup window ...); required unless a pickup is booked
  p_courier_code     text        default null,
  p_courier_name     text        default null,
  p_tracking_number  text        default null,
  p_tracking_url     text        default null,
  p_pickup_reference text        default null,
  p_shipped_at       timestamptz default null,
  p_charges          numeric     default null,
  p_note             text        default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid    uuid := auth.uid();
  r        public.return_requests;
  v_instr  text := nullif(btrim(coalesce(p_instructions, '')), '');
  v_code   text := nullif(btrim(coalesce(p_courier_code, '')), '');
  v_track  text := nullif(btrim(coalesce(p_tracking_number, '')), '');
  v_url    text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  v_pick   text := nullif(btrim(coalesce(p_pickup_reference, '')), '');
  v_name   text := nullif(btrim(coalesce(p_courier_name, '')), '');
  v_cour   public.couriers;
  v_ship   public.shipments;
  v_first  boolean;
  v_make   boolean;
  v_when   timestamptz := coalesce(p_shipped_at, now());
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if r.status not in ('approved', 'awaiting_return_shipment') then
    raise exception 'The return method can be set for an approved request (this one is "%")', replace(r.status, '_', ' ') using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('courier_pickup', 'customer_arranged', 'manual') then raise exception 'The method must be courier_pickup, customer_arranged or manual' using errcode = '22023'; end if;
  if v_instr is null and p_method <> 'courier_pickup' then raise exception 'Write the return instructions the customer will see' using errcode = '22023'; end if;
  if v_instr is not null and char_length(v_instr) > 2000 then raise exception 'The instructions are too long (2000 characters at most)' using errcode = '22023'; end if;
  if v_url is not null and v_url !~* '^https?://[^ ]+$' then raise exception 'The tracking link must start with http:// or https:// and contain no spaces' using errcode = '22023'; end if;
  if p_charges is not null and p_charges < 0 then raise exception 'Shipping charges cannot be negative' using errcode = '22023'; end if;
  if v_when > now() + interval '1 day' then raise exception 'The shipping date cannot be in the future' using errcode = '22023'; end if;
  v_instr := coalesce(v_instr, 'A courier will contact you to collect the parcel. Please keep the item(s) packed and ready.');
  v_first := r.status = 'approved';

  update public.return_requests set return_method = p_method, return_instructions = v_instr, updated_at = now() where id = p_request_id;

  -- the return parcel (one per request): only when there is something to record about it
  v_make := v_code is not null or v_track is not null or v_pick is not null or v_name is not null;
  if v_make then
    select * into v_cour from public.couriers where code = coalesce(v_code, 'manual');
    if not found then raise exception 'Unknown courier "%"', coalesce(v_code, 'manual') using errcode = '22023'; end if;
    select * into v_ship from public.shipments s where s.request_id = p_request_id and s.direction = 'return' and s.status <> 'cancelled' order by s.created_at limit 1 for update;
    if found then
      update public.shipments
         set courier_code = v_cour.code, courier_name = coalesce(v_name, v_cour.name), tracking_number = v_track,
             tracking_url = coalesce(v_url, public.app_courier_tracking_url(v_cour.code, v_track)), pickup_reference = v_pick,
             shipped_at = coalesce(p_shipped_at, shipped_at), updated_at = now()
       where id = v_ship.id returning * into v_ship;
    else
      insert into public.shipments (order_id, direction, request_id, courier_code, courier_name, tracking_number, tracking_url, pickup_reference, shipped_at, status, last_event_at)
      values (r.order_id, 'return', p_request_id, v_cour.code, coalesce(v_name, v_cour.name), v_track,
              coalesce(v_url, public.app_courier_tracking_url(v_cour.code, v_track)), v_pick, v_when, 'created', v_when)
      returning * into v_ship;
      insert into public.shipment_items (shipment_id, order_item_id, quantity)
      select v_ship.id, i.order_item_id, i.quantity from public.return_request_items i where i.request_id = p_request_id and i.item_status = 'approved';
      insert into public.shipment_events (shipment_id, provider, provider_event_id, event_type, occurred_at, description, created_by)
      values (v_ship.id, 'manual', 'created:' || v_ship.id::text, 'created', v_when, 'Return shipment recorded', v_uid);
    end if;
    insert into public.shipment_private (shipment_id, charges, note, created_by) values (v_ship.id, p_charges, nullif(btrim(coalesce(p_note, '')), ''), v_uid)
    on conflict (shipment_id) do update set charges = coalesce(excluded.charges, public.shipment_private.charges), note = coalesce(excluded.note, public.shipment_private.note);
  end if;

  if v_first then
    r := public.app_apply_request_transition(p_request_id, 'awaiting_return_shipment', 'admin', v_uid, null, v_instr, true);
  else
    insert into public.return_request_events (request_id, actor_id, actor_role, note) values (p_request_id, v_uid, 'admin', 'Return details updated: ' || v_instr);
    update public.return_requests set customer_note = v_instr where id = p_request_id returning * into r;
    perform public.app_notify_request_customer(p_request_id, 'Return instructions updated', r.request_no || ' · ' || v_instr);
  end if;
  return jsonb_build_object('ok', true, 'status', r.status, 'method', p_method, 'shipment_id', v_ship.id);
end;
$$;

-- the customer tells us what they sent ("customer arranged")
create or replace function public.customer_submit_return_shipment(
  p_request_id      uuid,
  p_courier_name    text,
  p_tracking_number text        default null,
  p_tracking_url    text        default null,
  p_shipped_at      timestamptz default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid   uuid := auth.uid();
  r       public.return_requests;
  v_oid   text;
  v_name  text := nullif(btrim(coalesce(p_courier_name, '')), '');
  v_track text := nullif(btrim(coalesce(p_tracking_number, '')), '');
  v_url   text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  v_when  timestamptz := coalesce(p_shipped_at, now());
  v_ship  public.shipments;
begin
  if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select rr.order_id into v_oid from public.return_requests rr where rr.id = p_request_id and rr.user_id = v_uid;
  if v_oid is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_oid for update;
  select * into r from public.return_requests where id = p_request_id for update;
  if r.status <> 'awaiting_return_shipment' or r.return_method is distinct from 'customer_arranged' then
    raise exception 'You can add the shipping details once we have approved your request and asked you to send it yourself' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) > 80 then raise exception 'Enter the courier or post service you used (80 characters at most)' using errcode = '22023'; end if;
  if v_track is not null and char_length(v_track) > 80 then raise exception 'The tracking number is too long (80 characters at most)' using errcode = '22023'; end if;
  if v_url is not null and v_url !~* '^https?://[^ ]+$' then raise exception 'The tracking link must start with http:// or https://' using errcode = '22023'; end if;
  if v_when > now() + interval '1 day' then raise exception 'The shipping date cannot be in the future' using errcode = '22023'; end if;
  select * into v_ship from public.shipments s where s.request_id = p_request_id and s.direction = 'return' and s.status <> 'cancelled' order by s.created_at limit 1 for update;
  if found then
    update public.shipments set courier_name = v_name, tracking_number = v_track, tracking_url = v_url, shipped_at = v_when, updated_at = now() where id = v_ship.id returning * into v_ship;
  else
    insert into public.shipments (order_id, direction, request_id, courier_code, courier_name, tracking_number, tracking_url, shipped_at, status, last_event_at)
    values (r.order_id, 'return', p_request_id, 'manual', v_name, v_track, v_url, v_when, 'created', v_when) returning * into v_ship;
    insert into public.shipment_private (shipment_id, created_by) values (v_ship.id, v_uid);
    insert into public.shipment_items (shipment_id, order_item_id, quantity)
    select v_ship.id, i.order_item_id, i.quantity from public.return_request_items i where i.request_id = p_request_id and i.item_status = 'approved';
    insert into public.shipment_events (shipment_id, provider, provider_event_id, event_type, occurred_at, description, created_by)
    values (v_ship.id, 'manual', 'created:' || v_ship.id::text, 'created', v_when, 'Sent by the customer', v_uid);
  end if;
  r := public.app_apply_request_transition(p_request_id, 'return_in_transit', 'customer', v_uid, 'Sent with ' || v_name || coalesce(' · ' || v_track, ''), null, false);
  perform public.app_notify_admins('Return sent by the customer', r.request_no || ' · ' || v_name || coalesce(' · ' || v_track, ''),
    jsonb_build_object('type', 'admin_request', 'requestId', r.id, 'requestNo', r.request_no, 'orderId', r.order_id));
  return jsonb_build_object('ok', true, 'status', r.status, 'shipment_id', v_ship.id);
end;
$$;

-- 6 -- received + inspection ------------------------------------------------------------------------------------------------------------------------------
create or replace function public.record_return_received(p_request_id uuid, p_received_at timestamptz default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid  uuid := auth.uid();
  r      public.return_requests;
  v_when timestamptz := coalesce(p_received_at, now());
  v_s    record;
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if r.status not in ('awaiting_return_shipment', 'return_in_transit') then
    raise exception 'The return can be marked received once it is awaited or in transit (this one is "%")', replace(r.status, '_', ' ') using errcode = '22023';
  end if;
  if v_when > now() + interval '10 minutes' then raise exception 'The received time cannot be in the future' using errcode = '22023'; end if;
  update public.return_requests set received_at = v_when where id = p_request_id;
  update public.return_request_items set item_status = 'received' where request_id = p_request_id and item_status = 'approved';
  -- the courier's own record (if any) is closed too: the parcel has arrived
  for v_s in select s.id from public.shipments s where s.request_id = p_request_id and s.direction = 'return' and s.status not in ('delivered', 'cancelled') loop
    perform public.app_record_shipment_event(v_s.id, 'delivered', v_when, null, 'Received by the seller', 'manual', 'received:' || v_s.id::text, '{}'::jsonb, v_uid);
  end loop;
  r := public.app_apply_request_transition(p_request_id, 'return_received', 'admin', v_uid, p_note, nullif(btrim(coalesce(p_note, '')), ''), true);
  r := public.app_apply_request_transition(p_request_id, 'inspection_pending', 'admin', v_uid, null, null, false);
  return jsonb_build_object('ok', true, 'status', r.status, 'received_at', v_when);
end;
$$;

create or replace function public.record_inspection(p_request_id uuid, p_results jsonb, p_internal_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid  uuid := auth.uid();
  r      public.return_requests;
  d      jsonb;
  v_iid  uuid;
  v_res  text;
  v_note text;
  it     public.return_request_items;
  v_seen uuid[] := '{}';
  v_wait integer;
  v_pass integer;
  v_fail integer;
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if r.status <> 'inspection_pending' then raise exception 'Only a request that is waiting for inspection can be inspected (this one is "%")', replace(r.status, '_', ' ') using errcode = '22023'; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then raise exception 'Record a result for at least one item' using errcode = '22023'; end if;
  for d in select e.value from jsonb_array_elements(p_results) as e loop
    begin
      v_iid := (d ->> 'item_id')::uuid;
    exception when others then
      raise exception 'Each result needs a valid item_id' using errcode = '22023';
    end;
    v_res := d ->> 'result';
    v_note := nullif(btrim(coalesce(d ->> 'note', '')), '');
    if v_res is null or v_res not in ('passed', 'failed') then raise exception 'The result must be passed or failed' using errcode = '22023'; end if;
    if v_iid = any (v_seen) then raise exception 'An item appears twice in the results' using errcode = '22023'; end if;
    v_seen := v_seen || v_iid;
    select * into it from public.return_request_items where id = v_iid and request_id = p_request_id for update;
    if not found then raise exception 'Item % is not part of this request', v_iid using errcode = '22023'; end if;
    if it.item_status <> 'received' then raise exception 'This item cannot be inspected (it is "%")', it.item_status using errcode = '22023'; end if;
    if v_res = 'failed' and v_note is null then raise exception 'Tell the customer why the item failed the inspection' using errcode = '22023'; end if;
    update public.return_request_items set item_status = v_res, inspection_note = v_note, inspected_at = now() where id = v_iid;
    insert into public.return_request_events (request_id, item_id, actor_id, actor_role, note)
    values (p_request_id, v_iid, v_uid, 'admin', 'Inspection ' || v_res || coalesce(': ' || v_note, ''));
    perform public.app_after_inspection(v_iid, v_res);
  end loop;
  if nullif(btrim(coalesce(p_internal_note, '')), '') is not null then
    insert into public.return_request_events (request_id, actor_id, actor_role, note, internal) values (p_request_id, v_uid, 'admin', btrim(p_internal_note), true);
  end if;
  select count(*) filter (where item_status = 'received'), count(*) filter (where item_status = 'passed'), count(*) filter (where item_status = 'failed')
    into v_wait, v_pass, v_fail from public.return_request_items where request_id = p_request_id;
  if v_wait = 0 then
    r := public.app_apply_request_transition(p_request_id, case when v_pass > 0 then 'inspection_passed' else 'inspection_failed' end, 'system', v_uid, null,
           case when v_pass > 0 and v_fail > 0 then v_pass || ' item(s) accepted, ' || v_fail || ' not accepted.'
                when v_pass > 0 then 'All returned items were accepted.' else 'The returned items could not be accepted.' end, true);
  else
    select * into r from public.return_requests where id = p_request_id;
  end if;
  return jsonb_build_object('ok', true, 'status', r.status, 'passed', v_pass, 'failed', v_fail, 'waiting', v_wait);
end;
$$;

-- 7 -- messages and notes ------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.send_request_message(p_request_id uuid, p_message text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  r     public.return_requests;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if v_msg is null or char_length(v_msg) > 1000 then raise exception 'Write a message of 1 to 1000 characters' using errcode = '22023'; end if;
  update public.return_requests set customer_note = v_msg where id = p_request_id returning * into r;
  insert into public.return_request_events (request_id, actor_id, actor_role, note) values (p_request_id, auth.uid(), 'admin', v_msg);
  perform public.app_notify_request_customer(p_request_id, 'A message about your ' || r.type || ' request', r.request_no || ' · ' || v_msg);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_request_internal_note(p_request_id uuid, p_note text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  r      public.return_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'The note is too long (2000 characters at most)' using errcode = '22023'; end if;
  insert into public.return_request_private (request_id, internal_note) values (p_request_id, v_note)
  on conflict (request_id) do update set internal_note = excluded.internal_note;
  insert into public.return_request_events (request_id, actor_id, actor_role, note, internal) values (p_request_id, auth.uid(), 'admin', coalesce(v_note, '(note cleared)'), true);
  return jsonb_build_object('ok', true);
end;
$$;

-- 8 -- grants ------------------------------------------------------------------------------------------------------------------------------------------------------
revoke all on function public.app_lock_request_for_admin(uuid)                                        from public, anon, authenticated, service_role;
revoke all on function public.app_after_inspection(uuid, text)                                        from public, anon, authenticated, service_role;
revoke all on function public.trg_return_shipment_progress()                                          from public, anon, authenticated, service_role;
revoke all on function public.decide_request_items(uuid, jsonb, text, text)                           from public, anon;
revoke all on function public.request_transition(uuid, text, text, text)                              from public, anon;
revoke all on function public.set_return_logistics(uuid, text, text, text, text, text, text, text, timestamptz, numeric, text) from public, anon;
revoke all on function public.customer_submit_return_shipment(uuid, text, text, text, timestamptz)    from public, anon;
revoke all on function public.record_return_received(uuid, timestamptz, text)                        from public, anon;
revoke all on function public.record_inspection(uuid, jsonb, text)                                    from public, anon;
revoke all on function public.send_request_message(uuid, text)                                        from public, anon;
revoke all on function public.set_request_internal_note(uuid, text)                                   from public, anon;
grant execute on function public.decide_request_items(uuid, jsonb, text, text)                        to authenticated;      -- the admin check is inside
grant execute on function public.request_transition(uuid, text, text, text)                           to authenticated;
grant execute on function public.set_return_logistics(uuid, text, text, text, text, text, text, text, timestamptz, numeric, text) to authenticated;
grant execute on function public.customer_submit_return_shipment(uuid, text, text, text, timestamptz) to authenticated;     -- owner check inside
grant execute on function public.record_return_received(uuid, timestamptz, text)                      to authenticated;
grant execute on function public.record_inspection(uuid, jsonb, text)                                 to authenticated;
grant execute on function public.send_request_message(uuid, text)                                     to authenticated;
grant execute on function public.set_request_internal_note(uuid, text)                                to authenticated;

commit;

notify pgrst, 'reload schema';