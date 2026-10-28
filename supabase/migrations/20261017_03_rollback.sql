-- ============================================================================
-- M3 ROLLBACK — removes the shipping RPCs, guards, helpers and the five shipping tables.
-- !! ALL SHIPMENT DATA IS DELETED (shipments, items, events, private notes/charges, the courier catalogue). Export first:
--      select * from public.shipments;  select * from public.shipment_events;  ...
-- KEPT on purpose: orders.delivered_at / orders.delivered_at_source (+ the CHECK and the index). They are nullable and harmless;
--      without the trigger they are simply no longer maintained. Drop them only if you also want to forget the delivery dates:
--      alter table public.orders drop column delivered_at, drop column delivered_at_source;
-- The generic "order status changed" notification function is put back exactly as 20261008_04 defined it.
-- SAFE TO RE-RUN.
-- ============================================================================
begin;

drop function if exists public.cancel_shipment(uuid, text);
drop function if exists public.update_shipment(uuid, jsonb);
drop function if exists public.mark_delivered(text, timestamptz);
drop function if exists public.add_shipment_event(uuid, text, timestamptz, text, text, text, text, jsonb);
drop function if exists public.ship_order(text, text, text, text, timestamptz, numeric, text, jsonb, text, date);
drop function if exists public.app_record_shipment_event(uuid, text, timestamptz, text, text, text, text, jsonb, uuid);

drop trigger if exists orders_20_delivered_at on public.orders;
drop trigger if exists orders_10_status_guard on public.orders;
drop function if exists public.trg_orders_delivered_at();
drop function if exists public.trg_orders_status_guard();

drop table if exists public.shipment_events;
drop table if exists public.shipment_items;
drop table if exists public.shipment_private;
drop table if exists public.shipments;
drop table if exists public.couriers;

drop function if exists public.trg_shipment_items_cap();
drop function if exists public.app_order_item_remaining(uuid);
drop function if exists public.app_shipment_event_rank(text);
drop function if exists public.app_courier_tracking_url(text, text);
drop function if exists public.app_urlencode(text);
drop function if exists public.app_is_service_role();

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

commit;

notify pgrst, 'reload schema';