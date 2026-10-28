-- ============================================================================
-- M2 — Bulk product import: staged, validated, atomic, idempotent
--      (IMPLEMENTATION_PLAN Phase 3, BULK_UPLOAD_TEMPLATE_GUIDE §6; requires M1 + M1b)
--
-- FLOW (the browser parses the Excel + ZIP and validates first; the DATABASE is the second, authoritative layer)
--   1. import_stage_batch(file_hash, file_name, groups)
--        admin-only. Re-checks the plan, assigns the product / variant ids and the FINAL storage paths of every image, then
--        DRY-RUNS the real save_product() for every new product and rolls all of it back — so every rule save_product and
--        its triggers enforce (SKU uniqueness against the whole store, price/stock ranges, policy pairs, import_key
--        uniqueness …) is applied without being re-implemented here. Any problem => { ok:false, errors:[…] } and NOTHING is stored.
--        Valid => one `import_batches` row in status 'staged' (idempotent: the same file hash from the same admin returns
--        the existing batch) and the list of storage paths the browser must upload.
--   2. (browser) uploads the images to exactly those paths, upsert:true  — retries only overwrite their own files.
--   3. import_commit_batch(batch_id, urls)
--        admin-only, ONE transaction: checks every image really exists in storage.objects, then calls save_product() for each
--        new product group; either every product + variant + opening-stock ledger row is created, or none. A second call
--        returns the stored report. A failure is recorded on the batch (last_error) and leaves it 'staged' for a retry.
--   4. import_cancel_batch(batch_id) — marks a staged batch cancelled and returns its storage paths for the browser to delete.
--
-- CREATE-ONLY. A product whose import key already exists is `unchanged` when the file content hash is identical (this is what
-- makes a retry / re-upload safe) and an ERROR (E070) when it differs — nothing is ever overwritten.
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M1 / M1b / M1c). SAFE TO RE-RUN. Rollback: 20261017_02_rollback.sql.
-- ROLL-OUT ORDER: SQL first, then the website (the admin page calls these RPCs).
-- ============================================================================
begin;

-- 1 -- content hashes on what was imported (idempotency) --------------------------------------------------------------
alter table public.products         add column if not exists import_hash text;
alter table public.product_variants add column if not exists import_hash text;

-- 2 -- the staging table ------------------------------------------------------------------------------------------------
create table if not exists public.import_batches (
  id           uuid        primary key default gen_random_uuid(),
  file_hash    text        not null check (file_hash ~ '^[0-9a-f]{64}$'),
  file_name    text,
  mode         text        not null default 'create_only' check (mode in ('create_only')),
  status       text        not null default 'staged' check (status in ('staged', 'committed', 'cancelled')),
  created_by   uuid        references public.profiles (id) on delete set null,
  committed_by uuid        references public.profiles (id) on delete set null,
  summary      jsonb       not null default '{}'::jsonb,
  payload      jsonb       not null,
  image_paths  text[]      not null default '{}',
  report       jsonb,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  committed_at timestamptz
);
-- one live batch per (admin, file): a retry / double click / re-upload finds the existing one
create unique index if not exists import_batches_hash_uq on public.import_batches (created_by, file_hash) where status in ('staged', 'committed');
create index if not exists import_batches_status_idx on public.import_batches (status, created_at);

alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;
drop policy if exists import_batches_admin_select on public.import_batches;
create policy import_batches_admin_select on public.import_batches for select to authenticated using (public.app_is_admin());

-- 3 -- helpers ----------------------------------------------------------------------------------------------------------
-- hash of ONE import group, ignoring row numbers (moving a row in Excel must not look like an edit)
create or replace function public.app_import_group_hash(g jsonb)
returns text
language sql immutable
as $$
  select md5((
    (g - 'row' - 'variants')
    || jsonb_build_object('variants', coalesce(
         (select jsonb_agg(v - 'row' order by ord) from jsonb_array_elements(coalesce(g -> 'variants', '[]'::jsonb)) with ordinality as t(v, ord)),
         '[]'::jsonb))
  )::text)
$$;

-- an image reference from the file: an http(s) URL is kept, a file name becomes <product id>/<folder>/<file name>
create or replace function public.app_import_image_ref(p_ref text, p_pid text, p_folder text)
returns text
language sql immutable
as $$
  select case when p_ref is null or btrim(p_ref) = '' then null
              when p_ref ~* '^https?://' then btrim(p_ref)
              else p_pid || '/' || p_folder || '/' || btrim(p_ref) end
$$;

-- what a NEW product starts with when its row leaves a policy side blank: settings.returnPolicyDefaults, minus the categories
-- the store listed as "no returns" / "no exchanges" (Q-1). Falls back to ON / 7 days like the seed row of M1.
create or replace function public.app_import_policy_defaults(p_category text)
returns jsonb
language plpgsql stable
set search_path = public, pg_catalog
as $$
declare
  d       jsonb;
  v_ret   boolean;
  v_exc   boolean;
  v_rdays int;
  v_edays int;
begin
  select s.data into d from public.settings s where s.id = 'returnPolicyDefaults';
  d := coalesce(d, '{}'::jsonb);
  v_ret := case when jsonb_typeof(d -> 'returnEnabled') = 'boolean' then (d ->> 'returnEnabled')::boolean else true end;
  v_exc := case when jsonb_typeof(d -> 'exchangeEnabled') = 'boolean' then (d ->> 'exchangeEnabled')::boolean else true end;
  if jsonb_typeof(d -> 'noReturnCategories') = 'array' and exists (
       select 1 from jsonb_array_elements_text(d -> 'noReturnCategories') c where lower(btrim(c)) = lower(btrim(coalesce(p_category, '')))) then
    v_ret := false;
  end if;
  if jsonb_typeof(d -> 'noExchangeCategories') = 'array' and exists (
       select 1 from jsonb_array_elements_text(d -> 'noExchangeCategories') c where lower(btrim(c)) = lower(btrim(coalesce(p_category, '')))) then
    v_exc := false;
  end if;
  v_rdays := case when jsonb_typeof(d -> 'returnWindowDays') = 'number' then (d ->> 'returnWindowDays')::numeric::int else 7 end;
  v_edays := case when jsonb_typeof(d -> 'exchangeWindowDays') = 'number' then (d ->> 'exchangeWindowDays')::numeric::int else 7 end;
  return jsonb_build_object(
    'return_enabled', v_ret,   'return_window_days',   case when v_ret then v_rdays end,
    'exchange_enabled', v_exc, 'exchange_window_days', case when v_exc then v_edays end);
end;
$$;

-- structural check of an image reference coming from the browser (never trust the client's file names)
create or replace function public.app_import_check_ref(p_ref text, p_label text)
returns void
language plpgsql immutable
as $$
begin
  if p_ref is null or btrim(p_ref) = '' then return; end if;
  if p_ref ~* '^https?://' then
    if char_length(p_ref) > 2000 then raise exception '% is longer than 2000 characters', p_label using errcode = '22023'; end if;
    return;
  end if;
  if p_ref !~ '^[A-Za-z0-9][A-Za-z0-9._ ()-]{0,99}$' or p_ref ~ '\.\.' then
    raise exception '% "%" is not a plain image file name', p_label, p_ref using errcode = '22023';
  end if;
end;
$$;

-- 4 -- STAGE ------------------------------------------------------------------------------------------------------------
create or replace function public.import_stage_batch(p_file_hash text, p_file_name text, p_groups jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  c_group_keys constant text[] := array['import_key', 'row', 'kind', 'product', 'variants', 'images', 'hasErrors'];
  c_variant_keys constant text[] := array['import_key', 'row', 'name', 'sku', 'price', 'stock', 'track_inventory', 'status', 'sort_order',
                                          'attributes', 'return_enabled', 'return_window_days', 'exchange_enabled', 'exchange_window_days', 'images'];
  v_uid       uuid := auth.uid();
  v_batch     public.import_batches;
  v_g         record;
  v_v         record;
  v_k         text;
  v_key       text;
  v_row       int;
  v_hash      text;
  v_existing  public.products;
  v_pid       text;
  v_vid       text;
  v_product   jsonb;
  v_variants  jsonb;
  v_vjson     jsonb;
  v_defaults  jsonb;
  v_images    jsonb;
  v_main      text;
  v_gallery   jsonb;
  v_vimages   jsonb;
  v_errors    jsonb := '[]'::jsonb;
  v_results   jsonb := '[]'::jsonb;
  v_new       jsonb := '[]'::jsonb;
  v_paths     text[] := '{}';
  v_seen      text[] := '{}';
  v_bad       boolean;
  v_n_new     int := 0;
  v_n_unch    int := 0;
  v_n_var     int := 0;
  v_ref       text;
  v_vmeta     jsonb;
begin
  if v_uid is null or not public.app_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'file hash must be a SHA-256 hex string' using errcode = '22023';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception 'The import has no products' using errcode = '22023';
  end if;
  if jsonb_array_length(p_groups) > 1000 then
    raise exception 'An import may hold at most 1000 products (found %)', jsonb_array_length(p_groups) using errcode = '54000';
  end if;

  -- idempotency: the same file from the same admin returns the live batch
  select * into v_batch from public.import_batches where created_by = v_uid and file_hash = p_file_hash and status in ('staged', 'committed');
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'batch_id', v_batch.id, 'status', v_batch.status,
                              'image_paths', to_jsonb(v_batch.image_paths), 'summary', v_batch.summary, 'report', v_batch.report);
  end if;

  -- everything between here and the sentinel is a DRY RUN: it is rolled back, only the local variables survive
  begin
    for v_g in select e.elem, e.ord from jsonb_array_elements(p_groups) with ordinality as e(elem, ord) order by e.ord loop
      v_bad := false;
      v_row := case when (v_g.elem ->> 'row') ~ '^\d{1,9}$' then (v_g.elem ->> 'row')::int else 0 end;
      v_key := btrim(coalesce(v_g.elem ->> 'import_key', ''));

      -- ---- structure -------------------------------------------------------------------------------------------------
      if jsonb_typeof(v_g.elem) <> 'object' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E200', 'row', 0, 'import_key', '', 'message', format('Item %s of the plan is not an object', v_g.ord)));
        continue;
      end if;
      for v_k in select jsonb_object_keys(v_g.elem) loop
        if v_k <> all (c_group_keys) then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E200', 'row', v_row, 'import_key', v_key, 'message', format('Unknown field "%s" in the plan', v_k)));
          v_bad := true;
        end if;
      end loop;
      if v_key !~ '^[A-Za-z0-9._-]{1,64}$' or v_key ~* '_var_' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E003', 'row', v_row, 'import_key', v_key, 'message', format('Import ID "%s" is invalid', v_key)));
        continue;
      end if;
      if lower(v_key) = any (v_seen) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E002', 'row', v_row, 'import_key', v_key, 'message', format('Import ID "%s" appears more than once', v_key)));
        continue;
      end if;
      v_seen := v_seen || lower(v_key);
      if v_bad or jsonb_typeof(v_g.elem -> 'product') <> 'object' or jsonb_typeof(coalesce(v_g.elem -> 'variants', '[]'::jsonb)) <> 'array' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E200', 'row', v_row, 'import_key', v_key, 'message', 'Malformed product in the plan'));
        continue;
      end if;
      if jsonb_array_length(coalesce(v_g.elem -> 'variants', '[]'::jsonb)) > 200 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E200', 'row', v_row, 'import_key', v_key, 'message', 'A product may have at most 200 variants in one import'));
        continue;
      end if;

      -- ---- image references ----------------------------------------------------------------------------------------
      v_images := coalesce(v_g.elem -> 'images', '{}'::jsonb);
      begin
        perform public.app_import_check_ref(v_images ->> 'main', 'Main image');
        if jsonb_typeof(coalesce(v_images -> 'gallery', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(v_images -> 'gallery', '[]'::jsonb)) > 8 then
          raise exception 'Additional images must be a list of at most 8 file names' using errcode = '22023';
        end if;
        for v_ref in select jsonb_array_elements_text(coalesce(v_images -> 'gallery', '[]'::jsonb)) loop
          perform public.app_import_check_ref(v_ref, 'Additional image');
        end loop;
        for v_v in select e.elem from jsonb_array_elements(coalesce(v_g.elem -> 'variants', '[]'::jsonb)) as e(elem) loop
          if jsonb_typeof(v_v.elem) <> 'object' then raise exception 'Each variant must be an object' using errcode = '22023'; end if;
          for v_k in select jsonb_object_keys(v_v.elem) loop
            if v_k <> all (c_variant_keys) then raise exception 'Unknown variant field "%"', v_k using errcode = '22023'; end if;
          end loop;
          if coalesce(v_v.elem ->> 'import_key', '') !~ '^[A-Za-z0-9._-]{1,64}$' or (v_v.elem ->> 'import_key') ~* '_var_' then
            raise exception 'Variant Import ID "%" is invalid', coalesce(v_v.elem ->> 'import_key', '') using errcode = '22023';
          end if;
          -- group keys and variant keys share one namespace (a variant may not reuse its parent's or another product's key)
          if lower(v_v.elem ->> 'import_key') = any (v_seen) then
            raise exception 'Import ID "%" appears more than once', v_v.elem ->> 'import_key' using errcode = '22023';
          end if;
          v_seen := v_seen || lower(v_v.elem ->> 'import_key');
          perform public.app_import_check_ref(v_v.elem -> 'images' ->> 'main', 'Variant image');
          for v_ref in select jsonb_array_elements_text(coalesce(v_v.elem -> 'images' -> 'gallery', '[]'::jsonb)) loop
            perform public.app_import_check_ref(v_ref, 'Variant additional image');
          end loop;
        end loop;
      exception when others then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E200', 'row', v_row, 'import_key', v_key, 'message', sqlerrm));
        continue;
      end;

      -- ---- already imported? (create-only) ---------------------------------------------------------------------------
      v_hash := public.app_import_group_hash(v_g.elem);
      select * into v_existing from public.products where lower(import_key) = lower(v_key);
      if found then
        if v_existing.import_hash is not distinct from v_hash then
          v_results := v_results || jsonb_build_array(jsonb_build_object('import_key', v_key, 'row', v_row, 'status', 'unchanged', 'product_id', v_existing.id));
          v_n_unch := v_n_unch + 1;
        else
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E070', 'row', v_row, 'import_key', v_key,
            'message', format('"%s" already exists (product %s) with different content. The importer never overwrites — change the Import ID, or edit the product in the admin.', v_key, v_existing.id)));
        end if;
        continue;
      end if;
      if exists (select 1 from public.product_variants pv where lower(pv.import_key) in
                  (select lower(e.elem ->> 'import_key') from jsonb_array_elements(coalesce(v_g.elem -> 'variants', '[]'::jsonb)) as e(elem))) then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code', 'E070', 'row', v_row, 'import_key', v_key,
          'message', 'One of this product''s variant Import IDs is already used by another product.'));
        continue;
      end if;

      -- ---- ids, final paths, policy defaults -----------------------------------------------------------------------
      v_pid := 'prod_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
      v_product := (v_g.elem -> 'product') || jsonb_build_object('id', v_pid, 'import_key', v_key);
      v_defaults := public.app_import_policy_defaults(v_product ->> 'category');
      if not (v_product ? 'return_enabled') then
        v_product := v_product || jsonb_build_object('return_enabled', v_defaults -> 'return_enabled', 'return_window_days', v_defaults -> 'return_window_days');
      end if;
      if not (v_product ? 'exchange_enabled') then
        v_product := v_product || jsonb_build_object('exchange_enabled', v_defaults -> 'exchange_enabled', 'exchange_window_days', v_defaults -> 'exchange_window_days');
      end if;

      v_main := public.app_import_image_ref(v_images ->> 'main', v_pid, 'thumbnail');
      v_gallery := coalesce((select jsonb_agg(public.app_import_image_ref(g, v_pid, 'gallery') order by o)
                              from jsonb_array_elements_text(coalesce(v_images -> 'gallery', '[]'::jsonb)) with ordinality as t(g, o)), '[]'::jsonb);
      if v_main !~* '^https?://' then v_paths := v_paths || v_main; end if;
      for v_ref in select jsonb_array_elements_text(v_gallery) loop
        if v_ref !~* '^https?://' then v_paths := v_paths || v_ref; end if;
      end loop;

      v_variants := '[]'::jsonb;
      v_vimages := '{}'::jsonb;
      v_vmeta := '[]'::jsonb;
      for v_v in select e.elem, e.ord from jsonb_array_elements(coalesce(v_g.elem -> 'variants', '[]'::jsonb)) with ordinality as e(elem, ord) order by e.ord loop
        v_vid := public.app_new_variant_id();
        v_vjson := (v_v.elem - 'row' - 'images') || jsonb_build_object('id', v_vid);
        v_variants := v_variants || jsonb_build_array(v_vjson);
        v_vmeta := v_vmeta || jsonb_build_array(jsonb_build_object('id', v_vid, 'import_key', v_v.elem ->> 'import_key',
          'row', case when (v_v.elem ->> 'row') ~ '^\d{1,9}$' then (v_v.elem ->> 'row')::int else 0 end));
        v_main := public.app_import_image_ref(v_v.elem -> 'images' ->> 'main', v_pid || '/variants', v_vid);
        v_vimages := v_vimages || jsonb_build_object(v_vid, jsonb_build_object(
          'main', v_main,
          'gallery', coalesce((select jsonb_agg(public.app_import_image_ref(g, v_pid || '/variants', v_vid) order by o)
                                from jsonb_array_elements_text(coalesce(v_v.elem -> 'images' -> 'gallery', '[]'::jsonb)) with ordinality as t(g, o)), '[]'::jsonb)));
        if v_main is not null and v_main !~* '^https?://' then v_paths := v_paths || v_main; end if;
        for v_ref in select jsonb_array_elements_text(v_vimages -> v_vid -> 'gallery') loop
          if v_ref !~* '^https?://' then v_paths := v_paths || v_ref; end if;
        end loop;
        v_n_var := v_n_var + 1;
      end loop;
      v_main := public.app_import_image_ref(v_images ->> 'main', v_pid, 'thumbnail');

      -- ---- the DRY RUN: the real write path, rolled back below ------------------------------------------------------
      begin
        perform public.save_product(v_product, v_variants, null, true);
      exception when others then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', case when sqlerrm ilike '%sku%' then 'E024' when sqlstate = '23505' then 'E070' else 'E201' end,
          'row', v_row, 'import_key', v_key, 'message', sqlerrm, 'sqlstate', sqlstate));
        continue;
      end;

      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'import_key', v_key, 'row', v_row, 'hash', v_hash, 'product_id', v_pid, 'product', v_product, 'variants', v_variants,
        'images', jsonb_build_object('main', v_main, 'gallery', v_gallery), 'variant_images', v_vimages, 'variant_meta', v_vmeta));
      v_results := v_results || jsonb_build_array(jsonb_build_object('import_key', v_key, 'row', v_row, 'status', 'new', 'product_id', v_pid,
                                                                      'variants', jsonb_array_length(v_variants)));
      v_n_new := v_n_new + 1;
    end loop;

    raise exception 'import dry run finished' using errcode = 'P0099';     -- undoes every write above
  exception when sqlstate 'P0099' then
    null;
  end;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors, 'groups', v_results);
  end if;
  if v_n_new = 0 then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'message', 'Everything in this file has already been imported unchanged — nothing to do.',
                              'groups', v_results, 'summary', jsonb_build_object('products', 0, 'unchanged', v_n_unch));
  end if;

  begin
    insert into public.import_batches (file_hash, file_name, created_by, summary, payload, image_paths)
    values (p_file_hash, left(p_file_name, 255), v_uid,
            jsonb_build_object('products', v_n_new, 'variants', v_n_var, 'unchanged', v_n_unch, 'images', coalesce(array_length(v_paths, 1), 0)),
            jsonb_build_object('groups', v_new), (select coalesce(array_agg(distinct p order by p), '{}') from unnest(v_paths) as p))
    returning * into v_batch;
  exception when unique_violation then
    -- a concurrent request staged the same file first: that batch is the answer
    select * into v_batch from public.import_batches where created_by = v_uid and file_hash = p_file_hash and status in ('staged', 'committed');
    return jsonb_build_object('ok', true, 'already', true, 'batch_id', v_batch.id, 'status', v_batch.status,
                              'image_paths', to_jsonb(v_batch.image_paths), 'summary', v_batch.summary, 'report', v_batch.report);
  end;

  return jsonb_build_object('ok', true, 'already', false, 'batch_id', v_batch.id, 'status', 'staged', 'groups', v_results,
                            'image_paths', to_jsonb(v_batch.image_paths), 'summary', v_batch.summary);
end;
$$;

-- 5 -- COMMIT -----------------------------------------------------------------------------------------------------------
create or replace function public.import_commit_batch(p_batch_id uuid, p_urls jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid     uuid := auth.uid();
  v_batch   public.import_batches;
  v_g       jsonb;
  v_path    text;
  v_missing text[] := '{}';
  v_nourl   text[] := '{}';
  v_product jsonb;
  v_variants jsonb;
  v_vjson   jsonb;
  v_vimg    jsonb;
  v_gallery jsonb;
  v_main    text;
  v_report  jsonb := '[]'::jsonb;
  v_made_p  int := 0;
  v_made_v  int := 0;
  v_res     jsonb;
  v_url_of  text;
  v_have_storage boolean := to_regclass('storage.objects') is not null;
begin
  if v_uid is null or not public.app_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_urls is null or jsonb_typeof(p_urls) <> 'object' then
    raise exception 'p_urls must be an object { storagePath: publicUrl }' using errcode = '22023';
  end if;

  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then raise exception 'Import batch not found' using errcode = 'P0002'; end if;
  if v_batch.status = 'committed' then
    return jsonb_build_object('ok', true, 'already', true, 'status', 'committed', 'batch_id', v_batch.id, 'summary', v_batch.summary, 'report', v_batch.report);
  end if;
  if v_batch.status = 'cancelled' then
    raise exception 'This import was cancelled' using errcode = '22023';
  end if;

  -- every image must really be in storage, and the browser must have told us its public URL
  foreach v_path in array v_batch.image_paths loop
    if v_have_storage and not exists (select 1 from storage.objects o where o.bucket_id = 'products' and o.name = v_path) then
      v_missing := v_missing || v_path;
    end if;
    if jsonb_typeof(p_urls -> v_path) is distinct from 'string' or (p_urls ->> v_path) !~* '^https?://' then
      v_nourl := v_nourl || v_path;
    end if;
  end loop;
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'code', 'IMAGES_MISSING', 'missing', to_jsonb(v_missing[1:30]), 'count', cardinality(v_missing),
      'message', format('%s image(s) have not been uploaded yet. Upload them again and retry.', cardinality(v_missing)));
  end if;
  if cardinality(v_nourl) > 0 then
    return jsonb_build_object('ok', false, 'code', 'URLS_MISSING', 'missing', to_jsonb(v_nourl[1:30]), 'count', cardinality(v_nourl),
      'message', 'The public URL of some images was not supplied.');
  end if;

  begin
    for v_g in select e.elem from jsonb_array_elements(v_batch.payload -> 'groups') as e(elem) loop
      -- final product document: image paths -> public URLs
      v_main := v_g -> 'images' ->> 'main';
      v_url_of := case when v_main is null then null when v_main ~* '^https?://' then v_main else p_urls ->> v_main end;
      v_gallery := coalesce((select jsonb_agg(case when x ~* '^https?://' then x else p_urls ->> x end order by o)
                               from jsonb_array_elements_text(v_g -> 'images' -> 'gallery') with ordinality as t(x, o)), '[]'::jsonb);
      v_product := (v_g -> 'product') || jsonb_build_object('thumbnail', v_url_of, 'image', v_url_of, 'gallery', v_gallery);

      v_variants := '[]'::jsonb;
      for v_vjson in select e.elem from jsonb_array_elements(v_g -> 'variants') as e(elem) loop
        v_vimg := v_g -> 'variant_images' -> (v_vjson ->> 'id');
        v_main := v_vimg ->> 'main';
        v_variants := v_variants || jsonb_build_array(v_vjson || jsonb_build_object(
          'image', case when v_main is null then null when v_main ~* '^https?://' then v_main else p_urls ->> v_main end,
          'gallery', coalesce((select jsonb_agg(case when x ~* '^https?://' then x else p_urls ->> x end order by o)
                                from jsonb_array_elements_text(v_vimg -> 'gallery') with ordinality as t(x, o)), '[]'::jsonb)));
      end loop;

      v_res := public.save_product(v_product, v_variants, null, true);
      if not coalesce((v_res ->> 'created')::boolean, false) then
        raise exception 'Product % was expected to be new but already exists', v_g ->> 'import_key' using errcode = '23505';
      end if;
      update public.products set import_hash = v_g ->> 'hash' where id = v_g ->> 'product_id';
      update public.product_variants set import_hash = v_g ->> 'hash' where product_id = v_g ->> 'product_id';
      v_made_p := v_made_p + 1;
      v_made_v := v_made_v + jsonb_array_length(v_variants);
      v_report := v_report || jsonb_build_array(jsonb_build_object('import_key', v_g ->> 'import_key', 'row', (v_g ->> 'row')::int, 'result', 'created',
                                                                    'product_id', v_g ->> 'product_id', 'variants', coalesce(v_g -> 'variant_meta', '[]'::jsonb)));
    end loop;
  exception when others then
    -- nothing of this batch survives (the block is rolled back); the batch stays staged so the admin can fix the cause and retry
    update public.import_batches set last_error = left(sqlerrm, 1000), updated_at = now() where id = p_batch_id;
    return jsonb_build_object('ok', false, 'code', 'COMMIT_FAILED', 'message', sqlerrm, 'sqlstate', sqlstate);
  end;

  update public.import_batches
     set status = 'committed', committed_at = now(), committed_by = v_uid, updated_at = now(), last_error = null,
         report = v_report, summary = v_batch.summary || jsonb_build_object('created_products', v_made_p, 'created_variants', v_made_v)
   where id = p_batch_id;
  return jsonb_build_object('ok', true, 'already', false, 'status', 'committed', 'batch_id', p_batch_id,
                            'summary', jsonb_build_object('created_products', v_made_p, 'created_variants', v_made_v), 'report', v_report);
end;
$$;

-- 6 -- CANCEL -----------------------------------------------------------------------------------------------------------
create or replace function public.import_cancel_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_batch public.import_batches;
begin
  if auth.uid() is null or not public.app_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then raise exception 'Import batch not found' using errcode = 'P0002'; end if;
  if v_batch.status = 'committed' then
    raise exception 'This import is already committed and cannot be cancelled' using errcode = '22023';
  end if;
  if v_batch.status = 'staged' then
    update public.import_batches set status = 'cancelled', updated_at = now() where id = p_batch_id;
  end if;
  -- the browser removes these objects from the `products` bucket (storage is not transactional, so cleanup is explicit)
  return jsonb_build_object('ok', true, 'status', 'cancelled', 'image_paths', to_jsonb(v_batch.image_paths));
end;
$$;

-- 7 -- grants -------------------------------------------------------------------------------------------------------------
revoke all on function public.import_stage_batch(text, text, jsonb) from public, anon;
revoke all on function public.import_commit_batch(uuid, jsonb) from public, anon;
revoke all on function public.import_cancel_batch(uuid) from public, anon;
grant execute on function public.import_stage_batch(text, text, jsonb) to authenticated;     -- the admin check is inside
grant execute on function public.import_commit_batch(uuid, jsonb) to authenticated;
grant execute on function public.import_cancel_batch(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';