-- needs: m3
-- reapply: 20261017_03_rollback.sql
-- reapply: 20261017_03_rollback.sql
-- M3 rollback: applied TWICE before this script (a rollback must be safe to re-run), then the state is checked.
-- The second script (32_shipping_roll_forward.test.sql) proves that the migration can be applied again after a rollback.
begin;

do $$
begin
  perform t.ok(to_regclass('public.shipments') is null and to_regclass('public.shipment_items') is null
               and to_regclass('public.shipment_events') is null and to_regclass('public.shipment_private') is null
               and to_regclass('public.couriers') is null, 'every shipping table is gone');
  perform t.ok(to_regprocedure('public.ship_order(text,text,text,text,timestamptz,numeric,text,jsonb,text,date)') is null
               and to_regprocedure('public.add_shipment_event(uuid,text,timestamptz,text,text,text,text,jsonb)') is null
               and to_regprocedure('public.mark_delivered(text,timestamptz)') is null
               and to_regprocedure('public.update_shipment(uuid,jsonb)') is null
               and to_regprocedure('public.cancel_shipment(uuid,text)') is null
               and to_regprocedure('public.app_record_shipment_event(uuid,text,timestamptz,text,text,text,text,jsonb,uuid)') is null, 'every RPC is gone');
  perform t.ok(to_regprocedure('public.app_urlencode(text)') is null and to_regprocedure('public.app_courier_tracking_url(text,text)') is null
               and to_regprocedure('public.app_is_service_role()') is null and to_regprocedure('public.app_order_item_remaining(uuid)') is null
               and to_regprocedure('public.app_shipment_event_rank(text)') is null, 'every helper is gone');
  perform t.ok(not exists (select 1 from pg_trigger where tgname in ('orders_10_status_guard', 'orders_20_delivered_at') and not tgisinternal), 'both order triggers are gone');

  -- kept on purpose
  perform t.ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'delivered_at'), 'orders.delivered_at is kept');
  perform t.ok((select count(*) from public.orders where delivered_at is not null) >= 2, 'with its back-filled values');

  -- the notification function is back to the original (no skip flag)
  perform t.ok(position('app.skip_order_notify' in pg_get_functiondef('public.trg_notify_order_status()'::regprocedure)) = 0, 'the order notification function is restored');
  perform t.ok(position('Your order is on its way' in pg_get_functiondef('public.trg_notify_order_status()'::regprocedure)) > 0, 'and still sends the shipped message');

  -- the guard is gone: the legacy free-form updates work again
  insert into public.orders (id, order_status) values ('rb_1', 'placed');
  update public.orders set order_status = 'delivered' where id = 'rb_1';
  perform t.eq((select order_status from public.orders where id = 'rb_1'), 'delivered', 'without the guard any status change is accepted again (legacy behaviour)');
  perform t.ok((select count(*) from public.orders) >= 4, 'no order was touched by the rollback');
end $$;

rollback;