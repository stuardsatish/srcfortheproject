-- ============================================================================
-- M1c ROLLBACK — removes the validation of settings.returnPolicyDefaults.
-- Nothing else is touched: the settings row and every product keep their data; the admin page keeps working
-- (it validates on its own). SAFE TO RE-RUN.
-- ============================================================================
begin;
drop trigger if exists settings_guard_return_policy_defaults on public.settings;
drop function if exists public.guard_return_policy_defaults();
drop function if exists public.app_validate_return_policy_defaults(jsonb);
commit;
notify pgrst, 'reload schema';