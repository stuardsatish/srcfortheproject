-- needs: m8
-- reapply: 20261018_02_rollback.sql
-- reapply: 20261018_02_security_hardening.sql
-- M8 rolled back and applied again: the rate guard is back, exactly once.
begin;

do $$
begin
  perform t.eq((select count(*)::text from pg_trigger where tgname = 'return_requests_rate_guard' and not tgisinternal), '1', 'one rate-guard trigger after the roll-forward');
  perform t.ok(to_regclass('public.return_requests_user_created_idx') is not null, 'and its index');
  perform t.ok(not has_function_privilege('authenticated', 'public.trg_return_requests_rate_guard()', 'execute'), 'the guard function is closed to the API');
  perform t.ok(not has_function_privilege('authenticated', 'public.app_queue_notification(uuid, text, text, text, jsonb)', 'execute'), 'the notification queue is closed');
end $$;

rollback;