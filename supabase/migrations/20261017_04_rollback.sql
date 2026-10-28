-- ============================================================================
-- M4 ROLLBACK — removes the return / exchange request tables, RPCs and helpers.
-- !! ALL REQUESTS, THEIR ITEMS, EVENTS AND EVIDENCE ROWS ARE DELETED. Export first:
--      select * from public.return_requests;  select * from public.return_request_items;  ...
-- RUN 20261017_05_rollback.sql (M4b) FIRST: it removes the shipments.request_id column that points at return_requests.
-- The PRIVATE storage bucket `return-evidence` and the photos in it are NOT touched (delete them in the dashboard if you want them
-- gone); only the access policies on storage.objects that this migration created are dropped.
-- SAFE TO RE-RUN.
-- ============================================================================
begin;

drop function if exists public.respond_to_request(uuid, text, jsonb);
drop function if exists public.cancel_return_request(uuid, text);
drop function if exists public.create_return_request(uuid, text, text, jsonb, text, text, text, jsonb, boolean);
drop function if exists public.get_order_eligibility(text);
drop function if exists public.app_apply_request_transition(uuid, text, text, uuid, text, text, boolean);
drop function if exists public.app_notify_request_customer(uuid, text, text);
drop function if exists public.app_notify_admins(text, text, jsonb);
drop function if exists public.app_next_request_no(text);
drop function if exists public.app_item_eligibility(uuid, text, timestamptz);
drop function if exists public.app_item_policy(uuid);
drop function if exists public.app_return_deadline(timestamptz, integer);
drop function if exists public.app_store_return_defaults();

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "return evidence: upload own"  on storage.objects;
    drop policy if exists "return evidence: read own"    on storage.objects;
    drop policy if exists "return evidence: read admin"  on storage.objects;
    drop policy if exists "return evidence: delete own unsubmitted" on storage.objects;
    drop policy if exists "return evidence: admin delete" on storage.objects;
  end if;
end $$;
drop function if exists public.app_setup_return_evidence_storage();

drop table if exists public.return_request_events;
drop table if exists public.return_request_evidence;
drop table if exists public.return_request_items;
drop table if exists public.return_request_private;
drop table if exists public.return_requests;
drop table if exists public.request_status_transitions;
drop table if exists public.request_reasons;
drop sequence if exists public.return_request_no_seq;
drop sequence if exists public.exchange_request_no_seq;

commit;

notify pgrst, 'reload schema';