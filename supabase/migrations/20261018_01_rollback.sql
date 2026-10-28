-- ============================================================================
-- M7 ROLLBACK — removes the four notification triggers of 20261018_01_notification_events.sql and their functions (Phase 14).
-- Notifications that were already written stay (they are the customers' inbox history). No other object is touched: orders, requests and shipments keep
-- working exactly as before, they simply stop raising "Order placed", "We received your request", "Tracking number added" and "Another parcel is on its way".
-- SAFE TO RE-RUN. Independent of M5b / M6's rollbacks (it needs nothing they remove).
-- ============================================================================
begin;

drop trigger if exists notify_order_placed on public.orders;
drop trigger if exists notify_request_received on public.return_requests;
drop trigger if exists notify_shipment_added on public.shipments;
drop trigger if exists notify_shipment_tracking_added on public.shipments;

drop function if exists public.trg_notify_order_placed();
drop function if exists public.trg_notify_request_received();
drop function if exists public.trg_notify_shipment_tracking();

commit;

notify pgrst, 'reload schema';