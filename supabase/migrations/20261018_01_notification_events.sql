-- ============================================================================
-- M7 — NOTIFICATION EVENTS that the earlier migrations did not raise (IMPLEMENTATION_PLAN Phase 14; requires M6, i.e. everything before it)
--
-- Phase 14 lists the customer-facing events. M3 - M6 already raise most of them through the one queue (`app_queue_notification`, kind
-- `order_update`, `data.type` says what happened): order confirmed / shipped / delivered / cancelled, out for delivery, delivery failed, parcel returned,
-- request approved / rejected / needs info / return received / inspection result / replacement shipped / replacement delivered / cancelled, refund being
-- prepared / completed / failed, and for the ADMINS a new / cancelled / answered request, a failed refund, a payment that could not become an order.
-- Four events were missing; this migration adds them as TRIGGERS (no existing function is replaced):
--   1. ORDER PLACED          the customer's own checkout (source 'online': Razorpay and COD) - "Order placed". Nothing for orders an admin creates on a
--                            customer's behalf (WhatsApp / POS billing / bulk import: an import of 500 old orders must not send 500 pushes).
--   2. REQUEST RECEIVED      a return / exchange request was submitted -> the CUSTOMER is told it arrived (the admins were already told by M4).
--                            When an admin opens the request on the customer's behalf the wording says so.
--   3. TRACKING ADDED        a parcel that had no tracking number gets one later (the admin typed it after shipping) -> "Tracking number added".
--   4. ANOTHER PARCEL        a second parcel of an order that is already shipped (partial shipments) -> "Another parcel is on its way". The FIRST parcel is
--                            announced by ship_order ("Your order is on its way", with the courier and the tracking number), so it is skipped here.
-- Every trigger body is wrapped: a failure to WRITE a notification only raises a WARNING - it never blocks the order, the request or the shipment.
-- One row per event: the triggers fire only on the INSERT / the first tracking number, and a replay of the same RPC (same request id, same courier +
-- tracking number, same idempotency key) does not insert again, so a retry cannot send a second message. Notifications stay MESSAGES about a state, never
-- the state itself: the database tables remain the source of truth (spec phase 14).
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M6). SAFE TO RE-RUN. Rollback: 20261018_01_rollback.sql (drops the four triggers and their functions).
-- ROLL-OUT ORDER: SQL first, then the website, then the RN app. No Edge Function changes.
-- ============================================================================
begin;

-- 1 -- order placed -----------------------------------------------------------------------------------------------------------------------------------
create or replace function public.trg_notify_order_placed()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    perform public.app_queue_notification(
      new.user_id, 'order_update', 'Order placed',
      'Thank you! We have received your order #' || upper(right(new.id::text, 8)) || '.',
      jsonb_build_object('type', 'order', 'orderId', new.id::text, 'status', lower(new.order_status)));
  exception when others then
    raise warning 'trg_notify_order_placed skipped: %', sqlerrm;   -- never block the order
  end;
  return new;
end;
$$;

drop trigger if exists notify_order_placed on public.orders;
create trigger notify_order_placed
  after insert on public.orders
  for each row
  when (new.user_id is not null and new.source = 'online' and lower(coalesce(new.order_status, '')) in ('placed', 'confirmed'))
  execute function public.trg_notify_order_placed();

-- 2 -- request received ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.trg_notify_request_received()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_label text := case when new.type = 'exchange' then 'exchange' else 'return' end;
begin
  begin
    if new.user_id is null then return new; end if;
    if public.app_is_admin() then
      perform public.app_notify_request_customer(new.id, initcap(v_label) || ' request opened for you',
        new.request_no || ' · our team opened this request on your behalf. Open it to see the details.');
    else
      perform public.app_notify_request_customer(new.id, 'We received your ' || v_label || ' request',
        new.request_no || ' · we will review it and get back to you.');
    end if;
  exception when others then
    raise warning 'trg_notify_request_received skipped: %', sqlerrm;   -- never block the request
  end;
  return new;
end;
$$;

drop trigger if exists notify_request_received on public.return_requests;
create trigger notify_request_received
  after insert on public.return_requests
  for each row
  execute function public.trg_notify_request_received();

-- 3 + 4 -- tracking added later / another parcel -------------------------------------------------------------------------------------------------------
create or replace function public.trg_notify_shipment_tracking()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  o       public.orders;
  v_ref   text;
  v_title text;
  v_body  text;
begin
  begin
    if new.direction <> 'outbound' then return new; end if;           -- return / replacement parcels are told through their request
    select * into o from public.orders where id = new.order_id;
    if not found or o.user_id is null then return new; end if;
    v_ref := upper(right(o.id::text, 8));

    if tg_op = 'INSERT' then
      -- the FIRST parcel moves the order to shipped and ship_order announces it; only a parcel added to an order that is ALREADY shipped is new to the customer
      if lower(coalesce(o.order_status, '')) <> 'shipped' then return new; end if;
      v_title := 'Another parcel is on its way';
      v_body  := 'A parcel of order #' || v_ref || ' has been shipped'
                 || case when nullif(btrim(coalesce(new.courier_name, '')), '') is not null then ' with ' || new.courier_name else '' end
                 || case when nullif(btrim(coalesce(new.tracking_number, '')), '') is not null then '. Tracking number: ' || new.tracking_number else '' end || '.';
    else
      -- only the FIRST time a number appears (a correction of a typo is not news), and only when there is a number now
      if nullif(btrim(coalesce(old.tracking_number, '')), '') is not null or nullif(btrim(coalesce(new.tracking_number, '')), '') is null then return new; end if;
      v_title := 'Tracking number added';
      v_body  := 'Order #' || v_ref || ' now has a tracking number'
                 || case when nullif(btrim(coalesce(new.courier_name, '')), '') is not null then ' (' || new.courier_name || ')' else '' end
                 || ': ' || new.tracking_number || '.';
    end if;

    perform public.app_queue_notification(
      o.user_id, 'order_update', v_title, v_body,
      jsonb_build_object('type', 'order', 'orderId', o.id, 'status', lower(coalesce(o.order_status, '')), 'shipmentId', new.id,
                         'courier', new.courier_name, 'trackingNumber', new.tracking_number, 'trackingUrl', new.tracking_url));
  exception when others then
    raise warning 'trg_notify_shipment_tracking skipped: %', sqlerrm;   -- never block the shipment
  end;
  return new;
end;
$$;

drop trigger if exists notify_shipment_added on public.shipments;
create trigger notify_shipment_added
  after insert on public.shipments
  for each row
  when (new.direction = 'outbound')
  execute function public.trg_notify_shipment_tracking();

drop trigger if exists notify_shipment_tracking_added on public.shipments;
create trigger notify_shipment_tracking_added
  after update of tracking_number on public.shipments
  for each row
  when (old.tracking_number is distinct from new.tracking_number and new.direction = 'outbound')
  execute function public.trg_notify_shipment_tracking();

-- 5 -- grants: trigger functions are not callable by anybody through the API ------------------------------------------------------------------------------
revoke all on function public.trg_notify_order_placed()      from public, anon, authenticated, service_role;
revoke all on function public.trg_notify_request_received()  from public, anon, authenticated, service_role;
revoke all on function public.trg_notify_shipment_tracking() from public, anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';