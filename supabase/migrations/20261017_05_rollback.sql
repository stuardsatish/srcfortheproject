-- ============================================================================
-- M4b ROLLBACK — removes the admin return workflow RPCs, the return-shipment trigger and the extra shipment columns.
-- !! RETURN SHIPMENTS (shipments.direction = 'return') ARE DELETED with their items / events / private rows: they only make sense with
--    their request. Export them first if you need them.
-- The request tables themselves stay (they belong to M4: run 20261017_04_rollback.sql afterwards to remove those too).
-- SAFE TO RE-RUN.
-- ============================================================================
begin;

drop trigger if exists shipments_return_progress on public.shipments;
drop function if exists public.trg_return_shipment_progress();
drop function if exists public.set_request_internal_note(uuid, text);
drop function if exists public.send_request_message(uuid, text);
drop function if exists public.record_inspection(uuid, jsonb, text);
drop function if exists public.record_return_received(uuid, timestamptz, text);
drop function if exists public.customer_submit_return_shipment(uuid, text, text, text, timestamptz);
drop function if exists public.set_return_logistics(uuid, text, text, text, text, text, text, text, timestamptz, numeric, text);
drop function if exists public.request_transition(uuid, text, text, text);
drop function if exists public.decide_request_items(uuid, jsonb, text, text);
drop function if exists public.app_after_inspection(uuid, text);
drop function if exists public.app_lock_request_for_admin(uuid);

delete from public.shipments where direction = 'return';
alter table public.shipments drop constraint if exists shipments_request_chk;
alter table public.shipments drop constraint if exists shipments_pickup_reference_chk;
drop index if exists public.shipments_request_idx;
alter table public.shipments drop column if exists request_id;
alter table public.shipments drop column if exists pickup_reference;

delete from public.request_status_transitions where from_status = 'needs_info' and to_status = 'approved' and actor = 'admin';

commit;

notify pgrst, 'reload schema';