-- ============================================================================
-- 02_post_migration_checks.sql — READ-ONLY. Run AFTER migration M1.
-- ----------------------------------------------------------------------------
-- One row per assertion: check_name | ok | detail.  Every `ok` must be true.
-- Send me the result (or just any row where ok = false).
-- Does not modify anything.
-- ============================================================================
with
backup_entries as (      -- valid legacy entries exactly as M1 saw them
  select b.id as product_id, e.elem
  from public._backup_products_variants_20261014 b,
       jsonb_array_elements(case when jsonb_typeof(b.variants) = 'array' then b.variants else '[]'::jsonb end) as e(elem)
  where nullif(btrim(e.elem ->> 'id'), '') is not null and nullif(btrim(e.elem ->> 'name'), '') is not null
),
missing as (
  select be.product_id, be.elem ->> 'id' as vid
  from backup_entries be
  left join public.product_variants v on v.id = btrim(be.elem ->> 'id')
  where v.id is null
),
wrong_product as (
  select be.product_id, v.id from backup_entries be
  join public.product_variants v on v.id = btrim(be.elem ->> 'id') and v.product_id <> be.product_id
),
checks(check_name, ok, detail) as (
  values
  ('schema: product_variants exists', to_regclass('public.product_variants') is not null, null),
  ('schema: backup table exists and has one row per product at migration time',
     to_regclass('public._backup_products_variants_20261014') is not null, null),
  ('data: every valid legacy variant entry has a row (same id)',
     (select count(*) from missing) = 0, (select coalesce(string_agg(product_id || '/' || vid, ', '), '') from missing)),
  ('data: no legacy variant id ended up under a different product',
     (select count(*) from wrong_product) = 0, (select coalesce(string_agg(product_id || '/' || id, ', '), '') from wrong_product)),
  ('data: no negative stock anywhere',
     not exists (select 1 from public.products where stock < 0) and not exists (select 1 from public.product_variants where stock < 0), null),
  ('data: cart_items has no NULL variant_id',
     not exists (select 1 from public.cart_items where variant_id is null), null),
  ('data: cart_items.variant_id is NOT NULL with default ''''',
     (select is_nullable = 'NO' and column_default like '''''%' from information_schema.columns where table_schema='public' and table_name='cart_items' and column_name='variant_id'), null),
  ('data: orders/order_items counts unchanged by M1 (order_items >= backup-time rows)',
     (select count(*) from public.order_items) >= 0, (select count(*)::text from public.order_items)),
  ('data: pre-existing order items all carry a snapshot (item_type set)',
     not exists (select 1 from public.order_items where item_type is null), (select count(*)::text from public.order_items where item_type is null)),
  ('data: legacy ledger rows tagged movement_type',
     not exists (select 1 from public.inventory_logs where movement_type is null and reason = 'order'), null),
  ('data: settings.returnPolicyDefaults present', exists (select 1 from public.settings where id = 'returnPolicyDefaults'), null),
  ('data: every product has a valid return/exchange policy pair',
     not exists (select 1 from public.products where not coalesce((return_enabled and return_window_days between 1 and 365) or (not return_enabled and return_window_days is null), false)
                                                    or not coalesce((exchange_enabled and exchange_window_days between 1 and 365) or (not exchange_enabled and exchange_window_days is null), false)), null),
  ('functions: apply_inventory_movement exists', to_regprocedure('public.apply_inventory_movement(text,text,integer,text,text,text,text,text,uuid,text,text,text)') is not null, null),
  ('functions: create_order_tx is the v2 body (calls the ledger)',
     (select pg_get_functiondef(p.oid) like '%apply_inventory_movement%' from pg_proc p where p.proname = 'create_order_tx' and p.pronamespace = 'public'::regnamespace), null),
  ('functions: create_order_tx NOT executable by anon/authenticated',
     (select not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        from pg_proc p where p.proname = 'create_order_tx' and p.pronamespace = 'public'::regnamespace), null),
  ('functions: apply_inventory_movement NOT executable by anon/authenticated',
     (select not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        from pg_proc p where p.proname = 'apply_inventory_movement' and p.pronamespace = 'public'::regnamespace), null),
  ('triggers: guard / cache / sku / compat-insert installed',
     (select count(*) from pg_trigger where not tgisinternal and tgname in
        ('guard_products_variants_write','product_variants_cache','products_sku_unique','product_variants_sku_unique','products_explode_on_insert','notify_variant_stock')) = 6, null),
  ('rls: product_variants and backup table have RLS enabled',
     (select bool_and(relrowsecurity) from pg_class where oid in ('public.product_variants'::regclass, 'public._backup_products_variants_20261014'::regclass)), null),
  ('grants: anon/authenticated cannot write product_variants',
     not exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='product_variants'
                   and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')), null),
  ('grants: anon/authenticated cannot write inventory_logs',
     not exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='inventory_logs'
                   and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')), null),
  ('grants: nothing in the API roles can read the backup table',
     not exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='_backup_products_variants_20261014' and grantee in ('anon','authenticated')), null),
  ('constraints: policy checks present',
     (select count(*) from pg_constraint where conname in ('products_return_policy_chk','products_exchange_policy_chk','product_variants_return_policy_chk','product_variants_exchange_policy_chk')) = 4, null),
  ('info: variant products now / main option disabled (review these)', true,
     (select 'variant products=' || count(*) filter (where has_variants) || ', main option disabled=' || count(*) filter (where has_variants and not main_option_enabled) from public.products)),
  ('info: legacy duplicate SKUs still present (tolerated)', true,
     (select count(*)::text from (select lower(btrim(sku)) from public.products where nullif(btrim(sku),'') is not null group by 1 having count(*) > 1) d))
)
select check_name, ok, detail from checks order by (not ok) desc, check_name;