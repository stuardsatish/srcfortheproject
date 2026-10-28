-- ============================================================================
-- 00_schema_inventory.sql  —  READ-ONLY schema inventory
-- ----------------------------------------------------------------------------
-- Why this exists: the repo has no base schema (the early tables were created
-- by hand in the dashboard; only supabase/migrations/2026100* exist), so RLS
-- policies, RPC bodies (create_order_tx, rate_limit_check, ...), triggers and
-- storage policies can only be verified against the LIVE database.
--
-- How to use: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It issues SELECTs only (no DDL, no DML) and returns ONE row with ONE jsonb
-- column named `inventory`. Click the cell, copy the JSON, and save it as
-- supabase/introspection/live_schema_inventory.json (or paste it in chat).
--
-- Safe to run on production: catalog reads only, no table data is returned
-- (row counts are planner estimates from pg_stat_user_tables).
-- ============================================================================
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'server_version', current_setting('server_version'),

  'extensions', (
    select coalesce(jsonb_agg(extname order by extname), '[]'::jsonb) from pg_extension
  ),

  'tables', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',        c.relname,
      'kind',         c.relkind,
      'rls_enabled',  c.relrowsecurity,
      'rls_forced',   c.relforcerowsecurity,
      'approx_rows',  (select s.n_live_tup from pg_stat_user_tables s where s.relid = c.oid),
      'columns', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name',     a.attname,
          'type',     format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull,
          'default',  pg_get_expr(d.adbin, d.adrelid),
          'generated', nullif(a.attgenerated::text, '')
        ) order by a.attnum), '[]'::jsonb)
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      )
    ) order by c.relname), '[]'::jsonb)
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm')
  ),

  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', conrelid::regclass::text,
      'name',  conname,
      'type',  contype,           -- p=PK f=FK u=UNIQUE c=CHECK x=EXCLUDE
      'def',   pg_get_constraintdef(oid)
    ) order by conrelid::regclass::text, conname), '[]'::jsonb)
    from pg_constraint
    where connamespace = 'public'::regnamespace
  ),

  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', indexname, 'def', indexdef
    ) order by tablename, indexname), '[]'::jsonb)
    from pg_indexes
    where schemaname = 'public'
  ),

  -- RLS policies for public.* AND storage.objects (bucket access rules)
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'table', tablename, 'name', policyname,
      'permissive', permissive, 'roles', roles, 'cmd', cmd,
      'using', qual, 'with_check', with_check
    ) order by schemaname, tablename, policyname), '[]'::jsonb)
    from pg_policies
    where schemaname in ('public', 'storage')
  ),

  -- Full function bodies: create_order_tx, rate_limit_check, handle_new_user, ...
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name',             p.proname,
      'args',             pg_get_function_identity_arguments(p.oid),
      'returns',          pg_get_function_result(p.oid),
      'security_definer', p.prosecdef,
      'language',         l.lanname,
      'volatility',       p.provolatile,
      'definition',       pg_get_functiondef(p.oid)
    ) order by p.proname), '[]'::jsonb)
    from pg_proc p
    join pg_language l on l.oid = p.prolang
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
  ),

  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',  c.relname,
      'name',   t.tgname,
      'enabled', t.tgenabled,
      'definition', pg_get_triggerdef(t.oid)
    ) order by c.relname, t.tgname), '[]'::jsonb)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace
      and not t.tgisinternal
  ),

  'storage_buckets', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'public', public,
      'file_size_limit', file_size_limit,
      'allowed_mime_types', allowed_mime_types
    ) order by id), '[]'::jsonb)
    from storage.buckets
  ),

  -- Table-level grants to the API roles (shows anything granted too broadly)
  'grants', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'grantee', grantee, 'privilege', privilege_type
    ) order by table_name, grantee, privilege_type), '[]'::jsonb)
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
  ),

  -- Distinct values of the status columns we are about to extend. Aggregates
  -- only; no customer rows. Remove this block if you prefer zero data reads.
  'status_values', jsonb_build_object(
    'orders.order_status',   (select coalesce(jsonb_agg(distinct order_status),   '[]'::jsonb) from public.orders),
    'orders.payment_status',(select coalesce(jsonb_agg(distinct payment_status), '[]'::jsonb) from public.orders),
    'orders.source',        (select coalesce(jsonb_agg(distinct source),         '[]'::jsonb) from public.orders),
    'orders.payment_method',(select coalesce(jsonb_agg(distinct payment_method), '[]'::jsonb) from public.orders),
    'products.status',      (select coalesce(jsonb_agg(distinct status),         '[]'::jsonb) from public.products)
  )
)) as inventory;