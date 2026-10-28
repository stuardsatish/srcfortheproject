-- ============================================================================
-- M5 ROLLBACK — removes the refund tables, RPCs and guards (Phase 9).
-- !! EVERY REFUND RECORD IS DELETED (refunds, their lines, events and private notes). If ANY refund has SUCCEEDED the money has already left
--    the business: do NOT roll back - export first and keep the records:
--      select * from public.refunds;  select * from public.refund_items;  select * from public.refund_events;
-- Return requests that are waiting in "refund pending" / that were closed as "refunded" keep their status (the request tables belong to M4);
-- after re-applying 20261017_06_refunds.sql the pending ones can get a refund again.
-- SAFE TO RE-RUN.
-- ============================================================================
begin;

drop function if exists public.refund_apply_gateway_event(text, text, text, text, jsonb, jsonb);
drop function if exists public.refund_record_gateway_result(uuid, text, text, text, text, jsonb);
drop function if exists public.refund_gateway_context(uuid);
drop function if exists public.refund_begin_gateway(uuid);
drop function if exists public.refund_void(uuid, text);
drop function if exists public.refund_mark_manual(uuid, text, text, text, timestamptz);
drop function if exists public.app_refund_finish(uuid, text, text, uuid, text, text, timestamptz, text);
drop function if exists public.create_refund(uuid, text, text, boolean, numeric, text, text);
drop function if exists public.refund_calculate(uuid, boolean, numeric);
drop function if exists public.app_refund_compute(uuid, boolean, numeric);
drop function if exists public.app_notify_refund(uuid, text, text);
drop function if exists public.app_next_refund_no();

-- dropping a table drops its triggers; the trigger functions go afterwards
drop table if exists public.refund_events;
drop table if exists public.refund_private;
drop table if exists public.refund_items;
drop table if exists public.refunds;
drop function if exists public.trg_refund_items_cap();
drop function if exists public.trg_refunds_cap();
drop sequence if exists public.refund_no_seq;

commit;

notify pgrst, 'reload schema';