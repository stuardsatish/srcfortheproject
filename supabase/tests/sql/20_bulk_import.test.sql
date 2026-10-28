-- needs: m2
-- reapply: 20261017_02_bulk_import.sql
-- Phase 3 / M2 — bulk import: stage (authoritative dry run) -> upload -> atomic commit, idempotent, create-only, admin-only.
-- ("reapply" = the migration is applied a SECOND time before this script runs: the idempotency test.)
begin;

-- Supabase's storage.objects is not part of the fixture: a minimal stand-in so the commit can verify uploads
create schema if not exists storage;
create table storage.objects (bucket_id text not null, name text not null, primary key (bucket_id, name));
grant all on storage.objects to public;
grant usage on schema storage to public;
create table t.state (k text primary key, v jsonb);
grant all on t.state to public;

-- the plan of the "guide's example": a SINGLE and a PARENT with two variants (own prices), images by file name
create function t.plan1() returns jsonb language sql immutable as $j$
select $p$[
 {"import_key":"IMP-S1","row":3,"kind":"single",
  "product":{"title":"Imported Mug","category":"Mugs","brand":"Acme","sku":"IMP-S1","price":250,"stock":12,"gst_rate":12,"hsn_code":"6912",
             "short_description":"s","description":"d","status":"active","tags":["ceramic","gift"],"track_inventory":true,"main_option_enabled":true,
             "attributes":[],"return_enabled":true,"return_window_days":10,"exchange_enabled":false,"exchange_window_days":null},
  "variants":[],"images":{"main":"IMP-S1.jpg","gallery":["IMP-S1-b.jpg"]}},
 {"import_key":"IMP-P1","row":4,"kind":"parent",
  "product":{"title":"Imported Shirt","category":"Shirts","sku":"IMP-P1","price":500,"stock":10,"gst_rate":5,"hsn_code":"","short_description":"","description":"",
             "status":"active","tags":[],"track_inventory":true,"main_option_enabled":true,"attributes":[{"name":"Option","options":["Pink","White"]}]},
  "variants":[
    {"import_key":"IMP-P1-PINK","row":5,"name":"Pink","sku":"IMP-P1-PINK","price":300,"stock":20,"track_inventory":true,"status":"active","sort_order":1,
     "attributes":{"Option":"Pink"},"images":{"main":"IMP-P1-PINK.jpg","gallery":[]}},
    {"import_key":"IMP-P1-WHITE","row":6,"name":"White","sku":"IMP-P1-WHITE","price":200,"stock":30,"track_inventory":true,"status":"active","sort_order":2,
     "attributes":{"Option":"White"},"return_enabled":false,"exchange_enabled":true,"exchange_window_days":3,"images":{"main":"","gallery":[]}}],
  "images":{"main":"IMP-P1.jpg","gallery":[]}}
]$p$::jsonb
$j$;
-- a one-product plan with a URL image (no storage needed)
create function t.plan_url(p_key text, p_sku text, p_category text default 'Misc', p_price numeric default 99) returns jsonb language sql immutable as $j$
select jsonb_build_array(jsonb_build_object(
  'import_key', p_key, 'row', 2, 'kind', 'single',
  'product', jsonb_build_object('title', 'Plan ' || p_key, 'category', p_category, 'sku', p_sku, 'price', p_price, 'stock', 5, 'status', 'active',
                                'track_inventory', true, 'main_option_enabled', true, 'attributes', '[]'::jsonb, 'tags', '[]'::jsonb),
  'variants', '[]'::jsonb, 'images', jsonb_build_object('main', 'https://cdn.test/' || p_key || '.jpg', 'gallery', '[]'::jsonb)))
$j$;
create function t.urls_for(p_paths jsonb) returns jsonb language sql immutable as $j$
select coalesce(jsonb_object_agg(p, 'https://cdn.test/' || p), '{}'::jsonb) from jsonb_array_elements_text(p_paths) as p
$j$;

-- 1. who may call it ---------------------------------------------------------------------------------------------------
do $$
begin
  perform t.as_user(t.alice());
  perform t.fails($q$select public.import_stage_batch(repeat('a', 64), 'x.xlsx', '[]')$q$, '42501', 'Admin access required');
  perform t.fails($q$select public.import_commit_batch(gen_random_uuid(), '{}')$q$, '42501');
  perform t.fails($q$select public.import_cancel_batch(gen_random_uuid())$q$, '42501');
  perform t.as_anon();
  perform t.fails($q$select public.import_stage_batch(repeat('a', 64), 'x.xlsx', '[]')$q$, '42501');
  perform t.as_user(t.alice());
  perform t.ok((select count(*) from public.import_batches) = 0, 'a customer sees no import batches (RLS)');
  perform t.as_postgres();
end $$;

-- 2. argument validation -------------------------------------------------------------------------------------------------
do $$
begin
  perform t.as_user(t.admin());
  perform t.fails($q$select public.import_stage_batch('nothex', 'x', '[{}]')$q$, '22023', '%SHA-256%');
  perform t.fails($q$select public.import_stage_batch(repeat('a', 64), 'x', '{}')$q$, '22023', '%no products%');
  perform t.fails($q$select public.import_stage_batch(repeat('a', 64), 'x', '[]')$q$, '22023', '%no products%');
  perform t.fails(format($q$select public.import_stage_batch(repeat('a', 64), 'x', %L::jsonb)$q$, (select jsonb_agg('{}'::jsonb) from generate_series(1, 1001))), '54000');
  perform t.as_postgres();
end $$;

-- 3. STAGE: a valid plan is validated by the real save_product (dry run) and NOTHING is written ------------------------------
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.admin());
  v := public.import_stage_batch(repeat('a', 64), 'plan1.xlsx', t.plan1());
  insert into t.state values ('stage1', v);
  perform t.eq(v ->> 'ok', 'true', 'stage accepts a valid plan');
  perform t.eq(v ->> 'already', 'false', 'first time = a new batch');
  perform t.eq((select count(*)::text from jsonb_array_elements(v -> 'groups') g where g ->> 'status' = 'new'), '2', 'both products are "new"');
  perform t.eq(v #>> '{summary,products}', '2', 'summary: 2 products');
  perform t.eq(v #>> '{summary,variants}', '2', 'summary: 2 variants');
  perform t.eq(jsonb_array_length(v -> 'image_paths')::text, '4', 'four files to upload (main + gallery of the mug, main of the shirt, the Pink image)');
  perform t.ok((select bool_and(p ~ '^prod_[0-9a-f]{14}/(thumbnail|gallery|variants/var_[0-9a-f]{12})/[A-Za-z0-9._ -]+$') from jsonb_array_elements_text(v -> 'image_paths') p), 'paths are <product>/<folder>/<file name>');
  perform t.ok(exists (select 1 from jsonb_array_elements_text(v -> 'image_paths') p where p ~ '/thumbnail/IMP-S1\.jpg$'), 'main image of the mug -> thumbnail folder');
  perform t.ok(exists (select 1 from jsonb_array_elements_text(v -> 'image_paths') p where p ~ '/gallery/IMP-S1-b\.jpg$'), 'additional image -> gallery folder');
  perform t.ok(exists (select 1 from jsonb_array_elements_text(v -> 'image_paths') p where p ~ '/variants/var_[0-9a-f]{12}/IMP-P1-PINK\.jpg$'), 'variant image -> its own folder');
  -- the dry run was rolled back
  perform t.eq((select count(*)::text from public.products where import_key like 'IMP-%'), '0', 'no product was created by staging');
  perform t.eq((select count(*)::text from public.product_variants where import_key like 'IMP-%'), '0', 'no variant was created by staging');
  perform t.eq((select count(*)::text from public.inventory_logs where reason = 'initial stock'), '0', 'no ledger row was written by staging');
  perform t.eq((select count(*)::text from public.import_batches), '1', 'exactly one staged batch');
  perform t.eq((select status from public.import_batches), 'staged', 'status staged');
  perform t.as_postgres();
end $$;

-- 4. IDEMPOTENT: the same file again returns the same batch -------------------------------------------------------------------
do $$
declare
  v1 jsonb := (select v from t.state where k = 'stage1');
  v2 jsonb;
begin
  perform t.as_user(t.admin());
  v2 := public.import_stage_batch(repeat('a', 64), 'plan1-again.xlsx', t.plan1());
  perform t.eq(v2 ->> 'already', 'true', 'second stage of the same file is flagged already');
  perform t.eq(v2 ->> 'batch_id', v1 ->> 'batch_id', 'same batch id');
  perform t.eq(v2 ->> 'image_paths', v1 ->> 'image_paths', 'same upload paths (retries overwrite their own files)');
  perform t.eq((select count(*)::text from public.import_batches), '1', 'still one batch');
  perform t.as_postgres();
end $$;

-- 5. everything save_product enforces is enforced here too (dry run), and nothing is stored on error ---------------------------
do $$
declare
  v jsonb;
  bad jsonb;
begin
  perform t.as_user(t.admin());
  -- SKU already used by a product of the store (fixture: SHIRT-001)
  v := public.import_stage_batch(repeat('b', 64), 'x', t.plan_url('IMP-C1', 'SHIRT-001'));
  perform t.eq(v ->> 'ok', 'false', 'SKU clash with an existing product is refused');
  perform t.eq(v #>> '{errors,0,code}', 'E024', 'error code E024');
  perform t.ok(v #>> '{errors,0,message}' ilike '%SKU%', 'the message names the SKU');
  perform t.eq(v #>> '{errors,0,import_key}', 'IMP-C1', 'the error names the import key');
  -- price rule of save_product
  v := public.import_stage_batch(repeat('c', 64), 'x', t.plan_url('IMP-C2', 'IMP-C2', 'Misc', 0));
  perform t.eq(v ->> 'ok', 'false', 'price 0 is refused by the real save_product');
  -- two products with the same import key / same SKU inside the plan
  v := public.import_stage_batch(repeat('d', 64), 'x', t.plan_url('IMP-D1', 'IMP-D1') || t.plan_url('imp-d1', 'IMP-D2'));
  perform t.ok(v #>> '{errors,0,code}' = 'E002', 'duplicate import key (case-insensitive) in one plan');
  v := public.import_stage_batch(repeat('e', 64), 'x', t.plan_url('IMP-E1', 'DUP-SKU') || t.plan_url('IMP-E2', 'dup-sku'));
  perform t.ok(v #>> '{errors,0,code}' = 'E024', 'the second product with the same SKU is caught because the dry run keeps the first');
  -- a hostile file name / unknown field
  bad := t.plan_url('IMP-F1', 'IMP-F1');
  bad := jsonb_set(bad, '{0,images,main}', '"../../etc/passwd.jpg"');
  v := public.import_stage_batch(repeat('f', 64), 'x', bad);
  perform t.eq(v #>> '{errors,0,code}', 'E200', 'a path in an image name is refused');
  bad := jsonb_set(t.plan_url('IMP-G1', 'IMP-G1'), '{0,product,is_admin}', 'true');
  v := public.import_stage_batch(repeat('9', 64), 'x', bad);
  perform t.ok(v #>> '{errors,0,message}' ilike '%Unknown product field%', 'unknown product fields are refused by save_product');
  bad := jsonb_set(t.plan_url('IMP-H1', 'IMP-H1'), '{0,mystery}', '1');
  v := public.import_stage_batch(repeat('8', 64), 'x', bad);
  perform t.eq(v #>> '{errors,0,code}', 'E200', 'unknown plan fields are refused');
  perform t.eq((select count(*)::text from public.import_batches), '1', 'no batch was created by any of the failures');
  perform t.eq((select count(*)::text from public.products where import_key like 'IMP-%'), '0', 'nothing was created');
  perform t.as_postgres();
end $$;

-- 6. COMMIT: the images must be uploaded first ---------------------------------------------------------------------------------
do $$
declare
  st jsonb := (select v from t.state where k = 'stage1');
  v jsonb;
begin
  perform t.as_user(t.admin());
  v := public.import_commit_batch((st ->> 'batch_id')::uuid, t.urls_for(st -> 'image_paths'));
  perform t.eq(v ->> 'ok', 'false', 'commit before the upload is refused');
  perform t.eq(v ->> 'code', 'IMAGES_MISSING', 'IMAGES_MISSING');
  perform t.eq(v ->> 'count', '4', 'all four are reported missing');
  perform t.eq((select status from public.import_batches), 'staged', 'the batch stays staged for a retry');
  perform t.eq((select count(*)::text from public.products where import_key like 'IMP-%'), '0', 'nothing was created');
  perform t.as_postgres();
  -- "upload" them
  insert into storage.objects (bucket_id, name) select 'products', p from jsonb_array_elements_text(st -> 'image_paths') p;
  perform t.as_user(t.admin());
  v := public.import_commit_batch((st ->> 'batch_id')::uuid, '{}');
  perform t.eq(v ->> 'code', 'URLS_MISSING', 'the public URLs are required too');
  perform t.as_postgres();
end $$;

-- 7. COMMIT: atomic, correct data ---------------------------------------------------------------------------------------------------
do $$
declare
  st jsonb := (select v from t.state where k = 'stage1');
  v jsonb;
  pid_s text; pid_p text;
begin
  perform t.as_user(t.admin());
  v := public.import_commit_batch((st ->> 'batch_id')::uuid, t.urls_for(st -> 'image_paths'));
  insert into t.state values ('commit1', v);
  perform t.eq(v ->> 'ok', 'true', 'commit succeeds');
  perform t.eq(v #>> '{summary,created_products}', '2', '2 products created');
  perform t.eq(v #>> '{summary,created_variants}', '2', '2 variants created');
  perform t.eq(v #>> '{report,1,import_key}', 'IMP-P1', 'the report lists the parent');
  perform t.eq(v #>> '{report,1,variants,0,import_key}', 'IMP-P1-PINK', 'the report maps each variant import key …');
  perform t.ok((v #>> '{report,1,variants,0,id}') ~ '^var_[0-9a-f]{12}$', '… to its NEW variant id');
  perform t.eq(v #>> '{report,1,variants,1,row}', '6', '… and keeps the Excel row number');
  perform t.eq((select status from public.import_batches), 'committed', 'batch committed');

  select id into pid_s from public.products where import_key = 'IMP-S1';
  select id into pid_p from public.products where import_key = 'IMP-P1';
  perform t.ok(pid_s is not null and pid_p is not null, 'both products exist under their import keys');
  perform t.eq((select price::text from public.products where id = pid_p), '500', 'the PARENT keeps its own price');
  perform t.eq((select string_agg(price::text || ':' || stock::text, ',' order by sort_order) from public.product_variants where product_id = pid_p), '300.00:20,200.00:30', 'variants keep their OWN prices and stocks');
  perform t.eq((select stock::text from public.products where id = pid_s), '12', 'opening stock of the single product');
  perform t.eq((select count(*)::text from public.inventory_logs where product_id = pid_p and reason = 'initial stock'), '3', 'opening stock is in the ledger: main + 2 variants');
  perform t.eq((select count(*)::text from public.inventory_logs where product_id = pid_s and reason = 'initial stock'), '1', 'ledger row for the mug');
  perform t.eq((select has_variants::text from public.products where id = pid_p), 'true', 'the variants cache is maintained');
  perform t.eq((select main_option_enabled::text from public.products where id = pid_p), 'true', 'the main product stays purchasable');
  perform t.ok((select thumbnail like 'https://cdn.test/' || pid_s || '/thumbnail/IMP-S1.jpg' from public.products where id = pid_s), 'thumbnail = the uploaded main image URL');
  perform t.ok((select image = thumbnail from public.products where id = pid_s), 'legacy image column carries the same URL');
  perform t.eq((select gallery[1] from public.products where id = pid_s), 'https://cdn.test/' || pid_s || '/gallery/IMP-S1-b.jpg', 'gallery URL');
  perform t.ok((select image like 'https://cdn.test/' || pid_p || '/variants/var_%/IMP-P1-PINK.jpg' from public.product_variants where product_id = pid_p and name = 'Pink'), 'variant image URL');
  perform t.eq((select coalesce(image, '<null>') from public.product_variants where product_id = pid_p and name = 'White'), '<null>', 'a variant without an image has none (storefront falls back to the parent)');
  perform t.eq((select tags::text from public.products where id = pid_s), '{ceramic,gift}', 'tags');
  perform t.ok((select import_hash is not null from public.products where id = pid_s), 'the content hash is stored (idempotency)');
  perform t.ok((select bool_and(import_hash is not null and import_key like 'IMP-P1-%') from public.product_variants where product_id = pid_p), 'variants carry import key + hash');
  -- policies: row-specified for the mug; blank on the parent = store defaults (7 / 7); Pink inherits (NULL), White overrides
  perform t.eq((select return_enabled::text || '/' || return_window_days::text || '/' || exchange_enabled::text || '/' || coalesce(exchange_window_days::text, 'null') from public.products where id = pid_s), 'true/10/false/null', 'mug: its own policy');
  perform t.eq((select return_enabled::text || '/' || return_window_days::text || '/' || exchange_enabled::text || '/' || exchange_window_days::text from public.products where id = pid_p), 'true/7/true/7', 'parent: blank policy = store defaults');
  perform t.eq((select coalesce(return_enabled::text, 'inherit') from public.product_variants where product_id = pid_p and name = 'Pink'), 'inherit', 'Pink inherits the product policy');
  perform t.eq((select return_enabled::text || '/' || coalesce(return_window_days::text, 'null') || '/' || exchange_enabled::text || '/' || exchange_window_days::text from public.product_variants where product_id = pid_p and name = 'White'), 'false/null/true/3', 'White overrides');
  perform t.as_postgres();
end $$;

-- 8. a second commit / second stage never duplicates -------------------------------------------------------------------------
do $$
declare
  st jsonb := (select v from t.state where k = 'stage1');
  v jsonb;
begin
  perform t.as_user(t.admin());
  v := public.import_commit_batch((st ->> 'batch_id')::uuid, t.urls_for(st -> 'image_paths'));
  perform t.eq(v ->> 'already', 'true', 'committing twice returns the stored result');
  perform t.eq((select count(*)::text from public.products where import_key like 'IMP-%'), '2', 'no duplicate products');
  v := public.import_stage_batch(repeat('a', 64), 'plan1.xlsx', t.plan1());
  perform t.eq(v ->> 'status', 'committed', 're-uploading the same file reports the committed batch');
  perform t.eq(v ->> 'already', 'true', '… as already done');
  -- a "different file" with identical content: nothing is new, nothing is touched
  v := public.import_stage_batch(repeat('1', 64), 'copy.xlsx', t.plan1());
  perform t.eq(v ->> 'ok', 'true', 'identical content under a new file hash is fine');
  perform t.eq(v ->> 'status', 'unchanged', 'all products are unchanged');
  perform t.eq((select count(*)::text from jsonb_array_elements(v -> 'groups') g where g ->> 'status' = 'unchanged'), '2', 'both reported unchanged (I070)');
  perform t.eq((select count(*)::text from public.import_batches), '1', 'no new batch for an all-unchanged file');
  -- the same import key with DIFFERENT content is never overwritten
  v := public.import_stage_batch(repeat('2', 64), 'edited.xlsx', jsonb_set(t.plan1(), '{0,product,price}', '999'));
  perform t.eq(v ->> 'ok', 'false', 'changed content under an existing import key is refused');
  perform t.eq(v #>> '{errors,0,code}', 'E070', 'E070');
  perform t.ok(v #>> '{errors,0,message}' ilike '%never overwrites%', 'the message explains create-only');
  perform t.eq((select price::text from public.products where import_key = 'IMP-S1'), '250', 'the existing price was NOT touched');
  perform t.as_postgres();
end $$;

-- 9. row numbers do not matter for the content hash ------------------------------------------------------------------------------
do $$
declare
  a jsonb := t.plan1() -> 0;
begin
  perform t.eq(public.app_import_group_hash(a), public.app_import_group_hash(jsonb_set(a, '{row}', '99')), 'moving a row does not change the hash');
  perform t.ok(public.app_import_group_hash(a) <> public.app_import_group_hash(jsonb_set(a, '{product,price}', '251')), 'a price edit does');
  perform t.ok(public.app_import_group_hash(t.plan1() -> 1) <> public.app_import_group_hash(jsonb_set(t.plan1() -> 1, '{variants,0,price}', '301')), 'a variant price edit does');
  perform t.eq(public.app_import_group_hash(t.plan1() -> 1), public.app_import_group_hash(jsonb_set(t.plan1() -> 1, '{variants,0,row}', '77')), 'a variant row number does not');
end $$;

-- 10. store policy defaults + the "no returns" categories (Q-1) are applied to NEW products with a blank policy -------------------
do $$
declare
  v jsonb;
  pid text;
begin
  perform t.as_user(t.admin());
  update public.settings set data = '{"returnEnabled":true,"returnWindowDays":14,"exchangeEnabled":true,"exchangeWindowDays":5,"noReturnCategories":["fresh sweets"]}' where id = 'returnPolicyDefaults';
  v := public.import_stage_batch(repeat('3', 64), 'sweets.xlsx', t.plan_url('IMP-SW1', 'IMP-SW1', 'Fresh Sweets') || t.plan_url('IMP-SW2', 'IMP-SW2', 'Shirts'));
  perform t.eq(v ->> 'ok', 'true', 'stage ok');
  v := public.import_commit_batch((v ->> 'batch_id')::uuid, '{}');
  perform t.eq(v ->> 'ok', 'true', 'URL-only images need no upload; commit ok');
  perform t.eq((select return_enabled::text || '/' || coalesce(return_window_days::text, 'null') || '/' || exchange_enabled::text || '/' || exchange_window_days::text from public.products where import_key = 'IMP-SW1'), 'false/null/true/5', 'a listed category starts with returns OFF (case-insensitive match), exchange default 5 days');
  perform t.eq((select return_enabled::text || '/' || return_window_days::text || '/' || exchange_window_days::text from public.products where import_key = 'IMP-SW2'), 'true/14/5', 'other categories get the store default windows');
  perform t.as_postgres();
end $$;

-- 11. CANCEL ------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v jsonb;
  b uuid;
begin
  perform t.as_user(t.admin());
  v := public.import_stage_batch(repeat('4', 64), 'cancel.xlsx', t.plan_url('IMP-X1', 'IMP-X1'));
  b := (v ->> 'batch_id')::uuid;
  v := public.import_cancel_batch(b);
  perform t.eq(v ->> 'status', 'cancelled', 'cancel works on a staged batch');
  perform t.ok(v ? 'image_paths', 'and returns the paths the browser must delete');
  perform t.eq(public.import_cancel_batch(b) ->> 'status', 'cancelled', 'cancelling twice is harmless');
  perform t.fails(format($q$select public.import_commit_batch(%L, '{}')$q$, b), '22023', '%cancelled%');
  v := public.import_stage_batch(repeat('4', 64), 'cancel.xlsx', t.plan_url('IMP-X1', 'IMP-X1'));
  perform t.ok((v ->> 'batch_id')::uuid <> b, 'after a cancel the same file can be staged again (new batch)');
  perform t.fails(format($q$select public.import_cancel_batch(%L)$q$, (select id from public.import_batches where status = 'committed' limit 1)), '22023', '%already committed%');
  perform t.fails($q$select public.import_cancel_batch(gen_random_uuid())$q$, 'P0002');
  perform t.fails($q$select public.import_commit_batch(gen_random_uuid(), '{}')$q$, 'P0002');
  perform t.as_postgres();
end $$;

-- 12. ATOMIC: a failure at commit time leaves NOTHING behind and the batch can be retried -----------------------------------------------
do $$
declare
  v jsonb;
  b uuid;
begin
  perform t.as_user(t.admin());
  v := public.import_stage_batch(repeat('5', 64), 'race.xlsx', t.plan_url('IMP-R1', 'IMP-R1') || t.plan_url('IMP-R2', 'IMP-R2'));
  b := (v ->> 'batch_id')::uuid;
  perform t.as_postgres();
  -- somebody else takes the SKU of the second product between stage and commit
  insert into public.products (id, title, price, stock, sku, category) values ('prod_racer', 'Racer', 10, 1, 'IMP-R2', 'x');
  perform t.as_user(t.admin());
  v := public.import_commit_batch(b, '{}');
  perform t.eq(v ->> 'ok', 'false', 'the commit fails');
  perform t.eq(v ->> 'code', 'COMMIT_FAILED', 'COMMIT_FAILED');
  perform t.eq((select count(*)::text from public.products where import_key in ('IMP-R1', 'IMP-R2')), '0', 'ATOMIC: the first product was rolled back too');
  perform t.eq((select status from public.import_batches where id = b), 'staged', 'the batch stays staged');
  perform t.ok((select last_error from public.import_batches where id = b) ilike '%sku%', 'the reason is recorded on the batch');
  perform t.as_postgres();
  delete from public.products where id = 'prod_racer';
  perform t.as_user(t.admin());
  v := public.import_commit_batch(b, '{}');
  perform t.eq(v ->> 'ok', 'true', 'after the cause is removed the SAME batch commits');
  perform t.eq((select count(*)::text from public.products where import_key in ('IMP-R1', 'IMP-R2')), '2', 'both products exist now');
  perform t.eq((select count(*)::text from public.inventory_logs where product_id in (select id from public.products where import_key in ('IMP-R1', 'IMP-R2')) and reason = 'initial stock'), '2', 'exactly one opening-stock ledger row each (no double write from the failed attempt)');
  perform t.as_postgres();
end $$;

-- 14. SCALE: ~100 products (half of them parents with 3 variants) stage + commit in one go ----------------------------------------------------
do $$
declare
  v jsonb; plan jsonb; secs numeric;
  t0 timestamptz := clock_timestamp();
begin
  perform t.as_user(t.admin());
  select jsonb_agg(
    case when n % 2 = 0 then t.plan_url('SCALE-' || n, 'SCALE-' || n, 'Bulk', 10 + n) -> 0
    else jsonb_build_object('import_key', 'SCALE-' || n, 'row', n + 1, 'kind', 'parent',
      'product', jsonb_build_object('title', 'Parent ' || n, 'category', 'Bulk', 'sku', 'SCALE-' || n, 'price', 100, 'stock', 5, 'status', 'active',
                                    'track_inventory', true, 'main_option_enabled', true, 'attributes', '[]'::jsonb, 'tags', '[]'::jsonb),
      'variants', (select jsonb_agg(jsonb_build_object('import_key', 'SCALE-' || n || '-' || x, 'row', n + 2, 'name', x, 'sku', 'SCALE-' || n || '-' || x,
                     'price', 90, 'stock', 3, 'track_inventory', true, 'status', 'active', 'sort_order', 1, 'attributes', jsonb_build_object('Option', x),
                     'images', jsonb_build_object('main', '', 'gallery', '[]'::jsonb))) from unnest(array['A', 'B', 'C']) as x),
      'images', jsonb_build_object('main', 'https://cdn.test/x.jpg', 'gallery', '[]'::jsonb)) end)
    into plan from generate_series(1, 100) n;
  v := public.import_stage_batch(repeat('6', 64), 'scale.xlsx', plan);
  perform t.eq(v ->> 'ok', 'true', 'stage of 100 products');
  v := public.import_commit_batch((v ->> 'batch_id')::uuid, '{}');
  perform t.eq(v ->> 'ok', 'true', 'commit of 100 products');
  secs := extract(epoch from clock_timestamp() - t0);
  raise notice 'ok   timing: 100 products (50 singles + 50 parents x 3 variants) staged + committed in % s', round(secs, 2);
  perform t.ok(secs < 90, 'the whole import finishes in a sensible time');
  perform t.eq((select count(*)::text from public.products where import_key like 'SCALE-%'), '100', '100 products created');
  perform t.eq((select count(*)::text from public.product_variants where import_key like 'SCALE-%'), '150', '150 variants created');
  perform t.as_postgres();
end $$;

-- 13. RLS ------------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform t.as_user(t.admin());
  perform t.ok((select count(*) from public.import_batches) >= 3, 'an admin can read the batches');
  perform t.as_user(t.bob());
  perform t.eq((select count(*)::text from public.import_batches), '0', 'a customer reads none');
  perform t.fails($q$insert into public.import_batches (file_hash, payload) values (repeat('7', 64), '{}')$q$, '42501');
  perform t.fails($q$update public.import_batches set status = 'cancelled'$q$, '42501');
  perform t.fails($q$delete from public.import_batches$q$, '42501');
  perform t.as_postgres();
end $$;

rollback;