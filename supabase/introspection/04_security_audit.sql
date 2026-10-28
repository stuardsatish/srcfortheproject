-- ============================================================================
-- 04_security_audit.sql — READ-ONLY security audit of the LIVE database (IMPLEMENTATION_PLAN Phase 13, gate "G-security").
--
-- WHAT IT IS: the local test suites (supabase/tests/sql/80_security_audit.test.sql and 81_security_matrix.test.sql) prove the security model on a database
-- RECONSTRUCTED from the 2026-10-13 inventory. They cannot see what your real project really looks like (grants, policies and functions created by hand, by
-- older migrations, by the Supabase dashboard). This script looks at the real thing and lists every finding as ONE table: severity, area, object, detail.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste the WHOLE file -> Run. It changes NOTHING: the only thing it creates is a TEMPORARY function that
-- disappears when the session ends. It never prints a secret: where it detects a literal secret it names the object, not the value.
-- Send me (or the next Claude) the result table; paste it in this form, one finding per line:   severity | area | object | detail
--
-- HOW TO READ IT:
--   CRITICAL  fix before anything else (a literal secret in the database, a hole that lets a visitor write)
--   HIGH      a real exposure - fix, or explain why it is intended
--   MEDIUM    review by hand (the script cannot understand every policy expression)
--   INFO      a fact worth knowing (nothing to fix); an INFO line is NOT a clean bill of health for the other lines
-- ============================================================================

create or replace function pg_temp.security_audit()
returns table (severity text, area text, object text, detail text)
language plpgsql
as $fn$
declare
  r record;
  -- functions that are SAFE for the app roles to execute: pure helpers and the RLS helpers the policies call
  safe_helpers text[] := array['app_is_admin', 'is_admin', 'app_is_guest', 'app_is_service_role', 'app_effective_price', 'app_json_num', 'app_json_text_array', 'app_new_variant_id',
                               'app_courier_tracking_url', 'app_import_check_ref', 'app_import_group_hash', 'app_import_image_ref', 'app_import_policy_defaults',
                               'app_order_item_remaining', 'app_return_deadline', 'app_shipment_event_rank', 'app_try_numeric', 'app_urlencode', 'app_validate_return_policy_defaults',
                               'app_has_purchased', 'app_user_blocked', 'app_feature_enabled'];
  -- everything the apps are MEANT to call as RPC (customer + admin): SECURITY DEFINER, with their own checks inside
  intended_rpc text[] := array['add_shipment_event', 'cancel_order', 'cancel_return_request', 'cancel_shipment', 'create_exchange_refund', 'create_order_refund', 'create_refund',
                               'create_return_request', 'customer_submit_return_shipment', 'decide_request_items', 'get_order_eligibility', 'get_order_operations', 'import_cancel_batch',
                               'import_commit_batch', 'import_stage_batch', 'inventory_gaps', 'inventory_reconcile', 'inventory_unsellable_summary', 'mark_delivered',
                               'mark_replacement_delivered', 'record_inspection', 'record_return_received', 'refund_calculate', 'refund_mark_manual', 'refund_void', 'request_transition',
                               'resolve_payment_exception', 'respond_to_request', 'save_product', 'send_request_message', 'set_request_internal_note', 'set_return_logistics',
                               'settle_exchange_adjustment', 'ship_order', 'ship_replacement', 'update_shipment',
                               -- the older (2026-10-08) customer RPCs
                               'register_device_token', 'unregister_device_token', 'set_price_alert', 'mark_notifications_read'];
  v_list text;
begin
  -- 1 -- tables ------------------------------------------------------------------------------------------------------------------------------------------
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1 loop
    severity := 'HIGH'; area := 'table'; object := r.relname; detail := 'Row Level Security is OFF: anyone with the (public) anon key can read and write this table'; return next;
  end loop;

  select string_agg(c.relname, ', ' order by c.relname) into v_list from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
     and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete') or has_table_privilege('anon', c.oid, 'truncate'));
  if v_list is not null then
    severity := 'INFO'; area := 'table'; object := 'anon write privileges'; detail := 'Supabase grants INSERT/UPDATE/DELETE/TRUNCATE to anon on these tables by default; ONLY their RLS policies protect them: ' || v_list; return next;
  end if;

  for r in
    select c.relname, p.polname, case p.polcmd when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd,
           regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), '\s+', ' ', 'g') as qual,
           regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), '\s+', ' ', 'g') as chk
      from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and p.polcmd in ('a', 'w', 'd', '*')
       and (p.polroles = '{0}'::oid[] or exists (select 1 from pg_roles x where x.oid = any (p.polroles) and x.rolname = 'anon'))
     order by 1, 2
  loop
    severity := case when r.qual in ('true', '-') and r.chk in ('true', '-') then 'CRITICAL'
                     when r.chk ~* 'is null' then 'HIGH'                       -- "... OR user_id IS NULL": a visitor can create rows that belong to nobody
                     when r.qual not like '%auth.uid()%' and r.qual not like '%is_admin%' and r.chk not like '%auth.uid()%' and r.chk not like '%is_admin%' then 'HIGH'
                     else 'MEDIUM' end;
    area := 'policy'; object := r.relname || ' / ' || r.polname;
    detail := r.cmd || ' policy that applies to anon (or everyone). USING: ' || left(r.qual, 160) || ' | CHECK: ' || left(r.chk, 160)
              || case when r.chk ~* 'is null' then ' - rows with NO OWNER can be created by anyone, even without an account (for stock_alerts this is the known issue K-11: guests may subscribe; it lets a script fill the table)'
                      when severity = 'MEDIUM' then ' - it mentions auth.uid() / is_admin(): confirm that a visitor without an account really cannot satisfy it' else '' end;
    return next;
  end loop;

  -- 2 -- functions ----------------------------------------------------------------------------------------------------------------------------------------
  for r in
    select p.oid::regprocedure::text as sig, p.proname, p.prosecdef,
           exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as pinned,
           has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'pg_catalog.trigger'::regtype
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by 1
  loop
    if r.prosecdef and r.anon_x and r.proname <> all (safe_helpers) then
      severity := 'HIGH'; area := 'function'; object := r.sig;
      detail := 'SECURITY DEFINER function executable by ANON (a visitor without an account). Intended only if it checks auth.uid() itself.' || case when r.proname = any (intended_rpc) then ' (it is one of the app''s RPCs: confirm anon was meant to reach it)' else '' end; return next;
    elsif r.prosecdef and r.auth_x and r.proname <> all (safe_helpers) and r.proname <> all (intended_rpc) then
      severity := 'HIGH'; area := 'function'; object := r.sig;
      detail := 'SECURITY DEFINER function executable by every signed-in customer and not in the list of the app''s RPCs: if it is an internal helper (it pushes notifications, moves stock, creates orders...), revoke EXECUTE from authenticated'; return next;
    end if;
    if r.prosecdef and not r.pinned then
      severity := 'MEDIUM'; area := 'function'; object := r.sig; detail := 'SECURITY DEFINER without a pinned search_path (ALTER FUNCTION ... SET search_path = public, pg_catalog; check first that its body only uses schema-qualified names)'; return next;
    end if;
  end loop;

  -- 3 -- secrets inside the database ------------------------------------------------------------------------------------------------------------------------
  for r in
    select t.tgname, t.tgrelid::regclass::text as tbl
      from pg_trigger t where not t.tgisinternal
       and pg_get_triggerdef(t.oid) ~* '(secret|token|authorization|apikey|api_key|bearer)[^,)}]{0,60}[:=]\s*["'']?[A-Za-z0-9._-]{16,}'
  loop
    severity := 'CRITICAL'; area := 'secret'; object := 'trigger ' || r.tgname || ' on ' || r.tbl;
    detail := 'the trigger definition contains a LITERAL secret / token (value not shown). Rotate it, then keep the new value out of the definition (Vault / an Edge Function secret).'; return next;
  end loop;
  for r in
    select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public') and p.prokind = 'f' and p.prosrc ~ 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk_live_[A-Za-z0-9]{10,}|rzp_live_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}'
  loop
    severity := 'CRITICAL'; area := 'secret'; object := 'function ' || r.sig; detail := 'the function body contains a literal JWT / key (value not shown)'; return next;
  end loop;
  if to_regclass('cron.job') is not null then
    for r in execute 'select jobid, coalesce(jobname, ''(unnamed)'') as jobname from cron.job where command ~* ''(secret|token|authorization|bearer)[^,)}]{0,60}[:=]\s*["'''']?[A-Za-z0-9._-]{16,}''' loop
      severity := 'CRITICAL'; area := 'secret'; object := 'pg_cron job ' || r.jobid || ' ' || r.jobname; detail := 'the scheduled command contains a LITERAL secret (value not shown)'; return next;
    end loop;
  end if;
  if exists (select 1 from pg_trigger t where t.tgname = 'notifications_dispatch' and not t.tgisinternal) then
    severity := 'INFO'; area := 'secret'; object := 'trigger notifications_dispatch';
    detail := 'exists (the push dispatcher webhook). Known issue P-12: its shared secret was pasted into a chat once - rotate it (docs: FINAL_REPORT.md, "Rotating the dispatch secret"). If a CRITICAL "literal secret" row names this trigger, that is why.'; return next;
  end if;

  -- 4 -- privilege escalation guards ---------------------------------------------------------------------------------------------------------------------------
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal and t.tgname ilike '%role%') then
    severity := 'HIGH'; area := 'profiles'; object := 'profiles'; detail := 'no trigger guarding role / status changes was found (guard_profile_role_change): confirm that a customer cannot UPDATE her own role to admin'; return next;
  else
    severity := 'INFO'; area := 'profiles'; object := 'profiles'; detail := 'a role-change guard trigger exists'; return next;
  end if;
end;
$fn$;

-- the Supabase-only parts (Storage, Realtime) live in a second temporary function so a plain PostgreSQL database can run the first part too
create or replace function pg_temp.security_audit_supabase()
returns table (severity text, area text, object text, detail text)
language plpgsql
as $fn$
declare r record;
begin
  if to_regclass('storage.buckets') is not null then
    for r in execute 'select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id' loop
      severity := case when r.id = 'return-evidence' and r.public then 'HIGH' else 'INFO' end; area := 'storage'; object := 'bucket ' || r.id;
      detail := case when r.public then 'PUBLIC: every file is readable by anyone who knows its URL' else 'private (signed links only)' end
                || '; size limit ' || coalesce(r.file_size_limit::text, 'none') || '; types ' || coalesce(array_to_string(r.allowed_mime_types, ','), 'any')
                || case when r.id = 'return-evidence' and r.public then ' - THE RETURN EVIDENCE BUCKET MUST BE PRIVATE' else '' end;
      return next;
    end loop;
    for r in execute $q$select policyname, cmd, roles::text as roles, regexp_replace(coalesce(qual, '-'), '\s+', ' ', 'g') as qual, regexp_replace(coalesce(with_check, '-'), '\s+', ' ', 'g') as chk
                          from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
                           and (roles::text like '%anon%' or roles::text like '%public%') order by policyname$q$ loop
      severity := 'HIGH'; area := 'storage'; object := 'policy ' || r.policyname;
      detail := r.cmd || ' on storage.objects for ' || r.roles || ' (anonymous visitors may write files). USING: ' || left(r.qual, 140) || ' | CHECK: ' || left(r.chk, 140); return next;
    end loop;
    for r in execute $q$select policyname, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'UPDATE' and coalesce(qual, '') like '%return-evidence%'$q$ loop
      severity := 'MEDIUM'; area := 'storage'; object := 'policy ' || r.policyname; detail := 'an UPDATE policy on the evidence bucket lets an owner move / rename evidence files - M4 deliberately has none'; return next;
    end loop;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for r in select pt.tablename from pg_publication_tables pt where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public'
              and (pt.tablename ~ '_private$' or pt.tablename in ('refund_events', 'payment_exceptions', 'exchange_reservations', 'inventory_logs', 'import_batches', 'profiles', 'settings')) order by 1 loop
      severity := 'HIGH'; area := 'realtime'; object := r.tablename; detail := 'a staff-only / sensitive table is in the supabase_realtime publication: remove it (ALTER PUBLICATION supabase_realtime DROP TABLE public.' || r.tablename || ')'; return next;
    end loop;
    severity := 'INFO'; area := 'realtime'; object := 'publication tables';
    select 'in the realtime publication: ' || coalesce(string_agg(tablename, ', ' order by tablename), '(none)') into detail from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
    return next;
  end if;
end;
$fn$;

select * from (
  select 0 as ord, a.* from pg_temp.security_audit() a
  union all
  select 1 as ord, b.* from pg_temp.security_audit_supabase() b
  union all
  select 2, 'INFO', 'summary', 'admins', (select count(*)::text || ' profile(s) have role = admin' from public.profiles where role = 'admin')
  union all
  select 2, 'INFO', 'summary', 'tables', (select count(*)::text || ' tables in schema public, ' || count(*) filter (where relrowsecurity)::text || ' with RLS' from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p'))
) s
order by case severity when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end, ord, area, object;