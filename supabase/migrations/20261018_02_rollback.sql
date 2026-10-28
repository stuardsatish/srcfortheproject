-- ============================================================================
-- M8 ROLLBACK — removes the rate guard on new return / exchange requests (20261018_02_security_hardening.sql, Phase 13) and its index.
-- The ACL clean-ups of M8 (notification ACL re-asserted, is_admin() search_path, trigger functions without EXECUTE for the app roles) are NOT undone on
-- purpose: they only take privileges away that nothing needs, and putting them back would re-open what they closed. Data is never touched.
-- SAFE TO RE-RUN. Independent of every other rollback.
-- ============================================================================
begin;

drop trigger if exists return_requests_rate_guard on public.return_requests;
drop function if exists public.trg_return_requests_rate_guard();
drop index if exists public.return_requests_user_created_idx;

commit;

notify pgrst, 'reload schema';