-- needs: m8
-- reapply: 20261018_02_security_hardening.sql
-- Phase 13 — M8: a CATALOG-DRIVEN security audit of everything the programme added, so a table or function nobody classified cannot slip in unnoticed:
--   1. every public table has RLS; the programme's tables give the app roles nothing they should not have (anon: nothing; authenticated: reads, never direct
--      writes - the two admin-written catalogues excepted); every policy of those tables names `authenticated` and is read-only (same exception);
--   2. every function is classified (customer RPC / admin RPC / service-role only / pure helper / trigger / internal) and its ACL is exactly that class;
--      every SECURITY DEFINER function pins its search_path; a function nobody classified defaults to "internal" = callable by nobody but the owner;
--   3. the admin gate really is the first thing every admin RPC does (called with NULL arguments as a customer: 42501, whatever the arguments);
--      customer and admin RPCs are closed to anon, the service-role-only ones to every app role;
--   4. the notification tables: a customer can read / delete her own rows and flip read_at - nothing else; the dispatcher claim function is service-role only;
--   5. the private evidence bucket's policies against a stand-in storage schema (anon: nothing; nobody can move an object into someone else's folder).
-- The LEGACY tables (created before this programme) keep Supabase's default grants: RLS is their protection, so only "RLS is on" is asserted for them.
-- ("reapply" = M8 is applied a SECOND time first: the idempotency test.)
begin;

-- 1. tables ---------------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  legacy text[] := array['analytics', 'cart_items', 'customer_stats', 'inventory_logs', 'notification_preferences', 'notifications', 'order_items', 'orders', 'price_alerts',
                         'product_stats', 'products', 'profiles', 'saved_items', 'settings', 'stock_alerts'];
  programme text[] := array['_backup_products_variants_20261014', 'couriers', 'exchange_adjustment_private', 'exchange_adjustments', 'exchange_reservations', 'import_batches',
                            'order_cancellation_private', 'order_cancellations', 'payment_exceptions', 'product_variants', 'refund_events', 'refund_items', 'refund_private', 'refunds',
                            'replacement_fulfillment_items', 'replacement_fulfillments', 'request_reasons', 'request_status_transitions', 'return_request_events',
                            'return_request_evidence', 'return_request_items', 'return_request_private', 'return_requests', 'shipment_events', 'shipment_items', 'shipment_private',
                            'shipments'];
  admin_written text[] := array['couriers', 'request_reasons'];      -- RLS + an admin-only write policy (checked in section 3b)
  public_read   text[] := array['product_variants'];                  -- active variants are the shop window
  r record; p record;
  v_no_rls text[] := '{}'; v_unclassified text[] := '{}'; v_anon text[] := '{}'; v_write text[] := '{}'; v_pol_role text[] := '{}'; v_pol_cmd text[] := '{}'; v_missing text[] := '{}';
  v_priv text;
begin
  for r in select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    if not r.relrowsecurity then v_no_rls := v_no_rls || r.relname; end if;
    if r.relname <> all (legacy) and r.relname <> all (programme) then v_unclassified := v_unclassified || r.relname; end if;
    if r.relname = any (programme) then
      foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        if has_table_privilege('anon', r.oid, v_priv) and not (v_priv = 'select' and r.relname = any (public_read)) then v_anon := v_anon || (r.relname || ':' || v_priv); end if;
      end loop;
      foreach v_priv in array array['truncate', 'references', 'trigger'] || case when r.relname = any (admin_written) then array[]::text[] else array['insert', 'update', 'delete'] end loop
        if has_table_privilege('authenticated', r.oid, v_priv) then v_write := v_write || (r.relname || ':' || v_priv); end if;
      end loop;
      for p in select pol.polname, pol.polcmd, pol.polroles from pg_policy pol where pol.polrelid = r.oid loop
        if p.polroles = '{0}'::oid[] or exists (select 1 from pg_roles x where x.oid = any (p.polroles) and x.rolname = 'anon') then
          if r.relname <> all (public_read) then v_pol_role := v_pol_role || (r.relname || ':' || p.polname); end if;
        elsif not exists (select 1 from pg_roles x where x.oid = any (p.polroles) and x.rolname = 'authenticated') then
          v_pol_role := v_pol_role || (r.relname || ':' || p.polname);
        end if;
        if p.polcmd <> 'r' and r.relname <> all (admin_written) then v_pol_cmd := v_pol_cmd || (r.relname || ':' || p.polname); end if;
      end loop;
    end if;
  end loop;
  select coalesce(array_agg(x), '{}') into v_missing from unnest(programme) x where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = x);

  perform t.ok(coalesce(array_length(v_no_rls, 1), 0) = 0, 'RLS is ON for every table of schema public' || coalesce(' - NOT: ' || array_to_string(v_no_rls, ', '), ''));
  perform t.ok(coalesce(array_length(v_unclassified, 1), 0) = 0, 'every table is classified (legacy or programme) - a NEW table must be reviewed and added to this list' || coalesce(' - UNCLASSIFIED: ' || array_to_string(v_unclassified, ', '), ''));
  perform t.ok(coalesce(array_length(v_missing, 1), 0) = 0, 'every table this suite expects exists' || coalesce(' - MISSING: ' || array_to_string(v_missing, ', '), ''));
  perform t.ok(coalesce(array_length(v_anon, 1), 0) = 0, 'anon has NO privilege on any programme table (product_variants may be SELECTed: active variants are public)' || coalesce(' - NOT: ' || array_to_string(v_anon, ', '), ''));
  perform t.ok(coalesce(array_length(v_write, 1), 0) = 0, 'authenticated has no INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER on any programme table (couriers and request_reasons are admin-written through RLS)' || coalesce(' - NOT: ' || array_to_string(v_write, ', '), ''));
  perform t.ok(coalesce(array_length(v_pol_role, 1), 0) = 0, 'every policy of a programme table names the authenticated role only (product_variants: public read)' || coalesce(' - NOT: ' || array_to_string(v_pol_role, ', '), ''));
  perform t.ok(coalesce(array_length(v_pol_cmd, 1), 0) = 0, 'every policy of a programme table is read-only, except the two admin-written catalogues' || coalesce(' - NOT: ' || array_to_string(v_pol_cmd, ', '), ''));
  perform t.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm')) = 0, 'there are no views / materialized views to leak rows around RLS');
end $$;

-- 2. functions -----------------------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  customer_rpc text[] := array['cancel_return_request', 'create_return_request', 'customer_submit_return_shipment', 'get_order_eligibility', 'respond_to_request'];
  admin_rpc text[] := array['add_shipment_event', 'cancel_order', 'cancel_shipment', 'create_exchange_refund', 'create_order_refund', 'create_refund', 'decide_request_items',
                            'get_order_operations', 'import_cancel_batch', 'import_commit_batch', 'import_stage_batch', 'inventory_gaps', 'inventory_reconcile',
                            'inventory_unsellable_summary', 'mark_delivered', 'mark_replacement_delivered', 'record_inspection', 'record_return_received', 'refund_calculate',
                            'refund_mark_manual', 'refund_void', 'request_transition', 'resolve_payment_exception', 'save_product', 'send_request_message',
                            'set_request_internal_note', 'set_return_logistics', 'settle_exchange_adjustment', 'ship_order', 'ship_replacement', 'update_shipment'];
  service_only text[] := array['apply_inventory_movement', 'create_order_tx', 'record_payment_exception', 'refund_apply_gateway_event', 'refund_begin_gateway',
                               'refund_gateway_context', 'refund_record_gateway_result'];
  service_and_admin text[] := array['add_shipment_event'];            -- the courier webhook path (service role) + the admin
  pure_helper text[] := array['app_courier_tracking_url', 'app_effective_price', 'app_import_check_ref', 'app_import_group_hash', 'app_import_image_ref', 'app_import_policy_defaults',
                              'app_is_admin', 'app_is_guest', 'app_is_service_role', 'app_json_num', 'app_json_text_array', 'app_new_variant_id', 'app_order_item_remaining',
                              'app_return_deadline', 'app_shipment_event_rank', 'app_try_numeric', 'app_urlencode', 'app_validate_return_policy_defaults', 'is_admin'];
  r record;
  v_bad text[] := '{}'; v_sp text[] := '{}'; v_n integer := 0; v_class text; v_anon boolean; v_auth boolean; v_svc boolean; v_ok boolean;
  v_seen_customer integer := 0; v_seen_admin integer := 0; v_seen_service integer := 0;
begin
  for r in
    select p.oid, p.proname, p.oid::regprocedure::text as sig, p.prosecdef, p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger,
           exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as pinned
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')      -- not an extension's (pgcrypto ...)
  loop
    v_n := v_n + 1;
    v_anon := has_function_privilege('anon', r.oid, 'execute');
    v_auth := has_function_privilege('authenticated', r.oid, 'execute');
    v_svc  := has_function_privilege('service_role', r.oid, 'execute');
    if r.prosecdef and not r.pinned then v_sp := v_sp || r.sig; end if;
    v_class := case when r.is_trigger then 'trigger'
                    when r.proname = any (pure_helper) then 'pure helper'
                    when r.proname = any (service_and_admin) then 'service + admin'
                    when r.proname = any (service_only) then 'service only'
                    when r.proname = any (customer_rpc) then 'customer rpc'
                    when r.proname = any (admin_rpc) then 'admin rpc'
                    else 'internal' end;
    v_ok := case v_class
              when 'trigger'         then not v_anon and not v_auth
              when 'pure helper'     then true
              when 'service + admin' then not v_anon and v_auth and v_svc
              when 'service only'    then not v_anon and not v_auth and v_svc
              when 'customer rpc'    then not v_anon and v_auth and r.prosecdef and r.pinned
              when 'admin rpc'       then not v_anon and v_auth and r.prosecdef and r.pinned
              else not v_anon and not v_auth end;                 -- internal: nobody but the owner (and, for some, the service role)
    if not v_ok then v_bad := v_bad || (r.sig || ' [' || v_class || ': anon=' || v_anon || ' auth=' || v_auth || ' svc=' || v_svc || ']'); end if;
    if v_class = 'customer rpc' then v_seen_customer := v_seen_customer + 1; end if;
    if v_class in ('admin rpc') then v_seen_admin := v_seen_admin + 1; end if;
    if v_class in ('service only', 'service + admin') then v_seen_service := v_seen_service + 1; end if;
  end loop;
  perform t.ok(v_n > 100, format('the audit looked at %s functions of schema public (extension functions excluded)', v_n));
  perform t.ok(coalesce(array_length(v_bad, 1), 0) = 0, 'every function has exactly the ACL of its class (customer / admin / service / helper / trigger / internal)' || coalesce(' - WRONG: ' || array_to_string(v_bad, '; '), ''));
  perform t.ok(coalesce(array_length(v_sp, 1), 0) = 0, 'every SECURITY DEFINER function pins its search_path' || coalesce(' - NOT: ' || array_to_string(v_sp, '; '), ''));
  perform t.eq(v_seen_customer::text, array_length(customer_rpc, 1)::text, 'all five customer RPCs exist');
  perform t.eq(v_seen_admin::text, (array_length(admin_rpc, 1) - 1)::text, 'every admin RPC exists (add_shipment_event is counted as service + admin)');
  perform t.eq(v_seen_service::text, (array_length(service_only, 1) + 1)::text, 'every service-role function exists');
  perform t.ok(not has_function_privilege('authenticated', 'public.app_queue_notification(uuid, text, text, text, jsonb)', 'execute'), 'a customer cannot push a notification to anyone: app_queue_notification is closed');
  perform t.ok(not has_function_privilege('anon', 'public.app_queue_notification(uuid, text, text, text, jsonb)', 'execute'), '... nor an anonymous visitor');
end $$;

-- 3. the gates, at run time ------------------------------------------------------------------------------------------------------------------------------------
-- (3a) every ADMIN RPC refuses a customer FIRST, whatever arguments she sends; every customer / admin RPC is closed to anon; the service-only ones to every app role
do $$
declare
  admin_rpc text[] := array['cancel_order', 'cancel_shipment', 'create_exchange_refund', 'create_order_refund', 'create_refund', 'decide_request_items',
                            'get_order_operations', 'import_cancel_batch', 'import_commit_batch', 'import_stage_batch', 'inventory_gaps', 'inventory_reconcile',
                            'inventory_unsellable_summary', 'mark_delivered', 'mark_replacement_delivered', 'record_inspection', 'record_return_received', 'refund_calculate',
                            'refund_mark_manual', 'refund_void', 'request_transition', 'resolve_payment_exception', 'save_product', 'send_request_message',
                            'set_request_internal_note', 'set_return_logistics', 'settle_exchange_adjustment', 'ship_order', 'ship_replacement', 'update_shipment'];
  customer_rpc text[] := array['cancel_return_request', 'create_return_request', 'customer_submit_return_shipment', 'get_order_eligibility', 'respond_to_request'];
  service_only text[] := array['apply_inventory_movement', 'create_order_tx', 'record_payment_exception', 'refund_apply_gateway_event', 'refund_begin_gateway',
                               'refund_gateway_context', 'refund_record_gateway_result'];
  r record; v_call text; v_n_admin integer := 0; v_n_cust integer := 0; v_n_svc integer := 0;
begin
  for r in
    select p.proname, coalesce((select string_agg('null::' || format_type(x.t, null), ', ' order by x.o) from unnest(p.proargtypes::oid[]) with ordinality as x(t, o)), '') as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname = any (admin_rpc || customer_rpc || service_only)
  loop
    v_call := format('select public.%I(%s)', r.proname, r.args);
    if r.proname = any (admin_rpc) then
      perform t.as_user(t.alice());
      perform t.fails(v_call, '42501', 'Admin%');         -- "Admin access required", raised before any argument is looked at
      v_n_admin := v_n_admin + 1;
    end if;
    if r.proname = any (admin_rpc || customer_rpc || service_only) then
      perform t.as_anon();
      perform t.fails(v_call, '42501', 'permission denied%');
    end if;
    if r.proname = any (service_only) then
      perform t.as_user(t.alice());
      perform t.fails(v_call, '42501', 'permission denied%');
      v_n_svc := v_n_svc + 1;
    end if;
    if r.proname = any (customer_rpc) then v_n_cust := v_n_cust + 1; end if;
    perform t.as_postgres();
  end loop;
  perform t.eq(v_n_admin::text, array_length(admin_rpc, 1)::text, 'all admin RPCs refused a customer with "Admin access required" (42501), then refused anon');
  perform t.eq(v_n_cust::text, array_length(customer_rpc, 1)::text, 'all customer RPCs are closed to anon');
  perform t.eq(v_n_svc::text, array_length(service_only, 1)::text, 'all service-role-only functions are closed to a customer and to anon');
end $$;

-- (3b) the two admin-written catalogues: the customer's write is refused, the admin's works
do $$
declare v_n integer;
begin
  perform t.as_user(t.alice());
  perform t.fails($q$insert into public.couriers (code, name) values ('hack', 'Hack')$q$, '42501');
  perform t.fails($q$insert into public.request_reasons (code, label, applies_to) values ('hack', 'Hack', array['return'])$q$, '42501');
  update public.couriers set name = 'Defaced' where code = 'manual';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'a customer''s UPDATE of a courier changes nothing');
  delete from public.request_reasons where code = 'damaged';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'a customer''s DELETE of a request reason deletes nothing');
  perform t.as_user(t.admin());
  insert into public.couriers (code, name) values ('audit_courier', 'Audit Courier');
  update public.request_reasons set label = label where code = 'damaged';
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '1', 'the admin can write both catalogues');
  -- what the admin's reasons editor does: an upsert by code (insert, then update), refused by the database CHECKs when the form's own rules are broken
  insert into public.request_reasons (code, label, applies_to) values ('audit_reason', 'Audit reason', array['return']) on conflict (code) do update set label = excluded.label;
  insert into public.request_reasons (code, label, applies_to) values ('audit_reason', 'Audit reason 2', array['return', 'exchange']) on conflict (code) do update set label = excluded.label, applies_to = excluded.applies_to;
  perform t.ok((select label = 'Audit reason 2' and applies_to = array['return', 'exchange'] from public.request_reasons where code = 'audit_reason'), 'the admin''s upsert inserts a reason and then updates it');
  perform t.fails($q$insert into public.request_reasons (code, label, applies_to) values ('A', 'Bad code', array['return'])$q$, '23514');
  perform t.fails($q$insert into public.request_reasons (code, label, applies_to) values ('no_label', ' ', array['return'])$q$, '23514');
  perform t.fails($q$insert into public.request_reasons (code, label, applies_to) values ('no_types', 'No types', array[]::text[])$q$, '23514');
  perform t.fails($q$insert into public.request_reasons (code, label, applies_to) values ('bad_type', 'Bad type', array['refund'])$q$, '23514');
  perform t.as_postgres();
end $$;

-- 4. the notification tables --------------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  perform t.ok(not has_table_privilege('anon', 'public.notifications', 'select'), 'anon cannot read notifications');
  perform t.ok(not has_table_privilege('authenticated', 'public.notifications', 'insert'), 'a customer cannot INSERT a notification (no forged messages)');
  perform t.ok(not has_table_privilege('authenticated', 'public.notifications', 'update') and has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update'),
               'a customer can UPDATE only the read_at column');
  perform t.ok(not has_column_privilege('authenticated', 'public.notifications', 'title', 'update') and not has_column_privilege('authenticated', 'public.notifications', 'user_id', 'update'),
               'not the title, the body or the owner');
  perform t.ok(case when to_regprocedure('public.claim_pending_notifications(integer)') is null then true
                    else not has_function_privilege('authenticated', to_regprocedure('public.claim_pending_notifications(integer)'), 'execute') end,
               'the push dispatcher''s claim function is not callable by a customer (when installed; the local database does not have it)');

  insert into public.notifications (user_id, kind, title, body) values (t.alice(), 'system', 'For Alice', 'x'), (t.bob(), 'system', 'For Bob', 'y');
  perform t.as_user(t.alice());
  perform t.eq((select count(*)::text from public.notifications), '1', 'Alice sees only her own notification');
  perform t.fails($q$insert into public.notifications (user_id, kind, title, body) values ('00000000-0000-0000-0000-0000000000a2', 'system', 'forged', 'phish')$q$, '42501');
  perform t.fails($q$update public.notifications set title = 'changed' where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, '42501');
  perform t.fails($q$update public.notifications set user_id = '00000000-0000-0000-0000-0000000000a2' where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, '42501');
  -- (marking read / deleting one's own rows needs the UPDATE / DELETE policies of migration 20261008_04, which the reconstructed local fixture lacks:
  --  suite 73 applies that migration and tests them, with the RPCs the apps call)
  perform t.as_anon();
  perform t.fails($q$select count(*) from public.notifications$q$, '42501');
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.notifications where title = 'For Bob' and read_at is null), '1', 'Bob''s notification is untouched');
end $$;

-- 5. the private evidence bucket, against a stand-in storage schema (the real one only exists on a Supabase project) --------------------------------------------------
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid, metadata jsonb, created_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') $$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated;       -- as Supabase does: ONLY the policies decide
select public.app_setup_return_evidence_storage();

do $$
declare
  v_a text := t.alice()::text || '/' || gen_random_uuid()::text || '/photo.jpg';
  v_n integer;
begin
  perform t.ok((select not public from storage.buckets where id = 'return-evidence'), 'the bucket is private');
  perform t.ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'return evidence:%' and (roles::text like '%anon%' or roles::text like '%public%')),
               'no evidence policy is open to anon / public');
  perform t.ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'return evidence:%' and cmd in ('UPDATE', 'ALL')),
               'there is no UPDATE policy: an uploaded evidence file can neither be renamed nor moved into somebody else''s folder');
  perform t.as_user(t.alice());
  insert into storage.objects (bucket_id, name, owner, metadata) values ('return-evidence', v_a, t.alice(), '{"mimetype":"image/jpeg","size":1000}');
  perform t.eq((select count(*)::text from storage.objects where bucket_id = 'return-evidence'), '1', 'the owner uploads and reads her own file');
  update storage.objects set name = t.bob()::text || '/stolen/photo.jpg' where name = v_a;
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'she cannot move her file into Bob''s folder (no UPDATE policy)');
  perform t.fails(format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('return-evidence', '%s/x/a.jpg', %L, '{}')$q$, t.bob(), t.alice()), '42501');
  perform t.as_user(t.bob());
  perform t.eq((select count(*)::text from storage.objects where bucket_id = 'return-evidence'), '0', 'Bob cannot see Alice''s evidence');
  delete from storage.objects where name = v_a;
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'nor delete it');
  perform t.as_anon();
  perform t.eq((select count(*)::text from storage.objects where bucket_id = 'return-evidence'), '0', 'an anonymous visitor sees nothing');
  perform t.fails(format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('return-evidence', '%s/x/a.jpg', null, '{}')$q$, t.alice()), '42501');
  perform t.as_user(t.admin());
  perform t.eq((select count(*)::text from storage.objects where bucket_id = 'return-evidence'), '1', 'an admin can read every customer''s evidence (signed links)');
  perform t.as_postgres();
end $$;

rollback;