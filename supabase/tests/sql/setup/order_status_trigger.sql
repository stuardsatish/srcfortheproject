-- setup for the notification suites (run by the "-- setup:" directive, committed, BEFORE any "-- reapply:" migration):
-- the LIVE database has the order-status notification trigger (migration 20261008_04_notifications.sql); the local reconstructed fixture does not
-- (suite 30 creates it itself for the same reason). Created here exactly as that migration does, so "Order delivered" / "Your order is on its way"
-- messages exist and a rollback of M7 can be shown to leave this trigger alone.
drop trigger if exists notify_order_status on public.orders;
create trigger notify_order_status
  after update of order_status on public.orders
  for each row
  when (old.order_status is distinct from new.order_status)
  execute function public.trg_notify_order_status();