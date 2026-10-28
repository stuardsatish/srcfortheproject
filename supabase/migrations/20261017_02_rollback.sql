-- ============================================================================
-- M2 ROLLBACK — removes the bulk-import RPCs, helpers and the staging table.
-- PRODUCTS AND VARIANTS THAT WERE ALREADY IMPORTED ARE NOT TOUCHED (they are ordinary products). The two `import_hash` columns
-- are kept (harmless, nullable); drop them separately only if you also want to forget what was imported:
--     alter table public.products drop column import_hash; alter table public.product_variants drop column import_hash;
-- Staged-but-never-committed batches are discarded with the table. Uploaded image files stay in the `products` bucket
-- under <product id>/...; delete them from the dashboard if a batch was never committed.
-- SAFE TO RE-RUN.
-- ============================================================================
begin;
drop function if exists public.import_cancel_batch(uuid);
drop function if exists public.import_commit_batch(uuid, jsonb);
drop function if exists public.import_stage_batch(text, text, jsonb);
drop function if exists public.app_import_check_ref(text, text);
drop function if exists public.app_import_policy_defaults(text);
drop function if exists public.app_import_image_ref(text, text, text);
drop function if exists public.app_import_group_hash(jsonb);
drop table if exists public.import_batches;
commit;
notify pgrst, 'reload schema';