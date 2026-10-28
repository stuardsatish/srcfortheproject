-- needs: m8
-- reapply: 20261018_02_rollback.sql
-- reapply: 20261018_02_rollback.sql
-- M8 rollback applied TWICE: the rate guard and its index are gone; the ACL clean-ups stay (they only took privileges away that nothing needs).
begin;

do $$
begin
  perform t.ok(not exists (select 1 from pg_trigger where tgname = 'return_requests_rate_guard' and not tgisinternal), 'the rate-guard trigger is gone');
  perform t.ok(to_regprocedure('public.trg_return_requests_rate_guard()') is null, 'and its function');
  perform t.ok(to_regclass('public.return_requests_user_created_idx') is null, 'and its index');
  perform t.ok(not has_function_privilege('authenticated', 'public.app_queue_notification(uuid, text, text, text, jsonb)', 'execute'), 'the notification queue stays closed to customers');
  perform t.ok(not has_table_privilege('authenticated', 'public.notifications', 'insert'), 'a customer still cannot insert notifications');
  perform t.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.prorettype = 'pg_catalog.trigger'::regtype and p.prokind = 'f'
                   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0,
               'trigger functions stay closed to the app roles');
  perform t.ok(exists (select 1 from pg_proc p where p.proname = 'is_admin' and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')), 'is_admin() keeps its pinned search_path');
end $$;

rollback;