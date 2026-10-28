-- ============================================================================
-- M1b — save_product(): the ONE admin write path for a product and its variants
--       (IMPLEMENTATION_PLAN Phase 1C; requires M1 = 20261014_01)
--
-- Why: the old admin forms wrote products.variants (a jsonb array), price and stock straight from
-- a possibly stale page snapshot — silently undoing sales that happened while the page was open.
-- This RPC
--   * is ADMIN-only (app_is_admin()) and runs in ONE transaction (product + all variants or nothing);
--   * validates server-side (the UI is never the only layer): required fields, number ranges,
--     return/exchange policy pairs, unique variant names, unique SKUs (triggers), "something must be
--     purchasable";
--   * treats stock edits as DELTAS against the value the admin saw (`stock_expected`), applied
--     through apply_inventory_movement() — so concurrent sales are preserved and every change is in
--     the ledger;
--   * supports optimistic concurrency on the product content (`p_expected_updated_at`);
--   * leaves variants untouched when p_variants is NULL; with an array it creates / updates / deletes
--     so the table matches the array exactly (`p_delete_missing`).
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M1). SAFE TO RE-RUN.
-- ============================================================================
begin;

-- number from a jsonb object with range/integer checks; NULL when the key is absent/blank
create or replace function public.app_json_num(j jsonb, k text, label text,
                                               p_min numeric default null, p_max numeric default null,
                                               p_int boolean default false)
returns numeric
language plpgsql immutable
as $$
declare
  raw text := j ->> k;
  v   numeric;
begin
  if raw is null or btrim(raw) = '' then return null; end if;
  begin
    v := raw::numeric;
  exception when others then
    raise exception '% must be a number', label using errcode = '22023';
  end;
  if p_int and v <> trunc(v) then
    raise exception '% must be a whole number', label using errcode = '22023';
  end if;
  if p_min is not null and v < p_min then
    raise exception '% must be at least %', label, p_min using errcode = '22023';
  end if;
  if p_max is not null and v > p_max then
    raise exception '% must be at most %', label, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

-- text[] from a jsonb array of strings (NULL when absent)
create or replace function public.app_json_text_array(j jsonb, k text, p_max_items int, p_max_len int, p_lower boolean default false)
returns text[]
language plpgsql immutable
as $$
declare
  arr jsonb := j -> k;
  out text[];
begin
  if arr is null or jsonb_typeof(arr) = 'null' then return null; end if;
  if jsonb_typeof(arr) <> 'array' then
    raise exception '% must be a list', k using errcode = '22023';
  end if;
  select coalesce(array_agg(t order by min_ord), '{}') into out
  from (
    select case when p_lower then lower(btrim(e.v)) else btrim(e.v) end as t, min(e.ord) as min_ord
    from jsonb_array_elements_text(arr) with ordinality as e(v, ord)
    where btrim(e.v) <> ''
    group by 1
  ) s;
  if coalesce(array_length(out, 1), 0) > p_max_items then
    raise exception '% allows at most % entries', k, p_max_items using errcode = '22023';
  end if;
  if exists (select 1 from unnest(out) u where char_length(u) > p_max_len) then
    raise exception 'Each entry of % must be at most % characters', k, p_max_len using errcode = '22023';
  end if;
  return out;
end;
$$;

create or replace function public.save_product(
  p_product             jsonb,
  p_variants            jsonb       default null,
  p_expected_updated_at timestamptz default null,
  p_delete_missing      boolean     default true)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  c_product_keys constant text[] := array[
    'id','title','description','short_description','category','brand','badge','sku','price','price_type',
    'discount','discount_expiry','gst_rate','hsn_code','stock','stock_expected','max_stock','image','thumbnail',
    'gallery','status','tags','track_inventory','main_option_enabled','return_enabled','return_window_days',
    'exchange_enabled','exchange_window_days','attributes','import_key'];
  c_variant_keys constant text[] := array[
    'id','name','sku','price','stock','stock_expected','track_inventory','image','gallery','attributes','status',
    'sort_order','return_enabled','return_window_days','exchange_enabled','exchange_window_days','import_key'];

  v_id        text := nullif(btrim(p_product ->> 'id'), '');
  v_created   boolean := false;
  v_p         public.products;
  v_k         text;
  v_title     text;
  v_price     numeric;
  v_stock     numeric;
  v_stock_exp numeric;
  v_delta     integer;
  v_el        record;
  v_vid       text;
  v_kept      text[] := '{}';
  v_vstock    numeric;
  v_vstock_exp numeric;
  v_vcount    integer;
  v_active    integer;
begin
  if auth.uid() is null or not public.app_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_product is null or jsonb_typeof(p_product) <> 'object' then
    raise exception 'p_product must be a JSON object' using errcode = '22023';
  end if;
  if p_variants is not null and jsonb_typeof(p_variants) <> 'array' then
    raise exception 'p_variants must be a JSON array' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_product) loop
    if v_k <> all (c_product_keys) then
      raise exception 'Unknown product field "%"', v_k using errcode = '22023';
    end if;
  end loop;

  -- ---------------------------------------------------------------- locate / create + lock
  if v_id is not null then
    select * into v_p from public.products where id = v_id for update;
  end if;

  if v_p.id is null then
    v_created := true;
    v_title := btrim(coalesce(p_product ->> 'title', ''));
    if v_title = '' then raise exception 'Title is required' using errcode = '22023'; end if;
    v_id := coalesce(v_id, 'prod_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));
    insert into public.products (id, title, price, stock) values (v_id, v_title, 0, 0);
    select * into v_p from public.products where id = v_id for update;
  -- compared at MILLISECOND precision: a JS Date round-trip (the usual client) drops the microseconds
  elsif p_expected_updated_at is not null
        and date_trunc('milliseconds', v_p.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'This product was changed by someone else since you opened it. Reload the page and re-apply your edit.'
      using errcode = '40001';
  end if;

  -- ---------------------------------------------------------------- product content
  if p_product ? 'title' and btrim(coalesce(p_product ->> 'title', '')) = '' then
    raise exception 'Title is required' using errcode = '22023';
  end if;
  if v_created and not (p_product ? 'category') then
    raise exception 'Category is required' using errcode = '22023';
  end if;
  -- return / exchange: a window is required exactly when the policy is ON (friendly message before the CHECK)
  if p_product ? 'return_enabled' and (p_product ->> 'return_enabled')::boolean
     and public.app_json_num(p_product, 'return_window_days', 'Return window (days)', 1, 365, true) is null then
    raise exception 'Return window (days) is required when returns are enabled' using errcode = '22023';
  end if;
  if p_product ? 'exchange_enabled' and (p_product ->> 'exchange_enabled')::boolean
     and public.app_json_num(p_product, 'exchange_window_days', 'Exchange window (days)', 1, 365, true) is null then
    raise exception 'Exchange window (days) is required when exchanges are enabled' using errcode = '22023';
  end if;
  if p_product ? 'category' and btrim(coalesce(p_product ->> 'category', '')) = '' then
    raise exception 'Category is required' using errcode = '22023';
  end if;
  if p_product ? 'status' and (p_product ->> 'status') not in ('active', 'draft') then
    raise exception 'Status must be active or draft' using errcode = '22023';
  end if;
  if p_product ? 'attributes' and jsonb_typeof(p_product -> 'attributes') not in ('array', 'object') then
    raise exception 'attributes must be a list' using errcode = '22023';
  end if;

  v_price := public.app_json_num(p_product, 'price', 'Price', 0, 10000000);

  update public.products set
    title             = case when p_product ? 'title'             then left(btrim(p_product ->> 'title'), 200) else title end,
    description       = case when p_product ? 'description'       then left(p_product ->> 'description', 5000) else description end,
    short_description = case when p_product ? 'short_description' then left(p_product ->> 'short_description', 300) else short_description end,
    category          = case when p_product ? 'category'          then left(btrim(p_product ->> 'category'), 100) else category end,
    brand             = case when p_product ? 'brand'             then left(btrim(p_product ->> 'brand'), 100) else brand end,
    badge             = case when p_product ? 'badge'             then nullif(left(btrim(p_product ->> 'badge'), 40), '') else badge end,
    sku               = case when p_product ? 'sku'               then nullif(left(btrim(p_product ->> 'sku'), 64), '') else sku end,
    price             = coalesce(v_price, price),
    price_type        = case when p_product ? 'price_type'        then coalesce(nullif(p_product ->> 'price_type', ''), 'inclusive') else price_type end,
    discount          = coalesce(public.app_json_num(p_product, 'discount', 'Discount %', 0, 100), discount),
    discount_expiry   = case when p_product ? 'discount_expiry'   then nullif(p_product ->> 'discount_expiry', '')::timestamptz else discount_expiry end,
    gst_rate          = coalesce(public.app_json_num(p_product, 'gst_rate', 'GST rate', 0, 100), gst_rate),
    hsn_code          = case when p_product ? 'hsn_code'          then nullif(left(btrim(p_product ->> 'hsn_code'), 16), '') else hsn_code end,
    max_stock         = case when p_product ? 'max_stock'         then public.app_json_num(p_product, 'max_stock', 'Max stock', 0, 100000000, true)::int else max_stock end,
    image             = case when p_product ? 'image'             then nullif(p_product ->> 'image', '') else image end,
    thumbnail         = case when p_product ? 'thumbnail'         then nullif(p_product ->> 'thumbnail', '') else thumbnail end,
    gallery           = coalesce(public.app_json_text_array(p_product, 'gallery', 30, 2000), gallery),
    status            = case when p_product ? 'status'            then p_product ->> 'status' else status end,
    tags              = coalesce(public.app_json_text_array(p_product, 'tags', 20, 40, true), tags),
    track_inventory   = case when p_product ? 'track_inventory'   then (p_product ->> 'track_inventory')::boolean else track_inventory end,
    main_option_enabled = case when p_product ? 'main_option_enabled' then (p_product ->> 'main_option_enabled')::boolean else main_option_enabled end,
    return_enabled       = case when p_product ? 'return_enabled'       then (p_product ->> 'return_enabled')::boolean else return_enabled end,
    return_window_days   = case when p_product ? 'return_enabled'       then (case when (p_product ->> 'return_enabled')::boolean then public.app_json_num(p_product, 'return_window_days', 'Return window (days)', 1, 365, true)::int end) else return_window_days end,
    exchange_enabled     = case when p_product ? 'exchange_enabled'     then (p_product ->> 'exchange_enabled')::boolean else exchange_enabled end,
    exchange_window_days = case when p_product ? 'exchange_enabled'     then (case when (p_product ->> 'exchange_enabled')::boolean then public.app_json_num(p_product, 'exchange_window_days', 'Exchange window (days)', 1, 365, true)::int end) else exchange_window_days end,
    attributes        = case when p_product ? 'attributes'        then p_product -> 'attributes' else attributes end,
    import_key        = case when p_product ? 'import_key'        then nullif(btrim(p_product ->> 'import_key'), '') else import_key end
  where id = v_id;

  -- ---------------------------------------------------------------- main stock (delta, not overwrite)
  v_stock := public.app_json_num(p_product, 'stock', 'Stock', 0, 100000000, true);
  if v_stock is not null then
    v_stock_exp := coalesce(public.app_json_num(p_product, 'stock_expected', 'Expected stock', 0, 100000000, true),
                            case when v_created then 0 end,
                            (select stock from public.products where id = v_id));   -- no "expected": absolute set
    v_delta := (v_stock - v_stock_exp)::int;
    if v_delta <> 0 then
      begin
        perform public.apply_inventory_movement(
          v_id, '', v_delta,
          case when v_delta > 0 then 'adjustment_in' else 'adjustment_out' end,
          null, 'admin_edit', v_id, case when v_created then 'initial stock' else 'admin edit' end,
          auth.uid(), 'admin', null, 'sellable');
      exception when others then
        if sqlerrm like 'Insufficient stock%' then
          raise exception 'Stock changed while you were editing (sales happened). Reload the page and set the stock again.' using errcode = '40001';
        end if;
        raise;
      end;
    end if;
  end if;

  -- ---------------------------------------------------------------- variants
  if p_variants is not null then
    for v_el in
      select e.elem, e.ord from jsonb_array_elements(p_variants) with ordinality as e(elem, ord) order by e.ord
    loop
      if jsonb_typeof(v_el.elem) <> 'object' then
        raise exception 'Each variant must be an object' using errcode = '22023';
      end if;
      for v_k in select jsonb_object_keys(v_el.elem) loop
        if v_k <> all (c_variant_keys) then
          raise exception 'Unknown variant field "%"', v_k using errcode = '22023';
        end if;
      end loop;
      if btrim(coalesce(v_el.elem ->> 'name', '')) = '' then
        raise exception 'Every variant needs a name (variant %)', v_el.ord using errcode = '22023';
      end if;
      if public.app_json_num(v_el.elem, 'price', 'Variant price', 0, 10000000) is null then
        raise exception 'Variant "%" needs a price', btrim(v_el.elem ->> 'name') using errcode = '22023';
      end if;
      if v_el.elem ? 'status' and (v_el.elem ->> 'status') not in ('active', 'inactive') then
        raise exception 'Variant status must be active or inactive' using errcode = '22023';
      end if;
      if v_el.elem ? 'attributes' and jsonb_typeof(v_el.elem -> 'attributes') <> 'object' then
        raise exception 'Variant attributes must be an object like {"Color":"Pink"}' using errcode = '22023';
      end if;
      -- policy overrides: NULL/absent = inherit; ON needs a window (friendly message before the CHECK)
      if coalesce((v_el.elem ->> 'return_enabled')::boolean, false)
         and public.app_json_num(v_el.elem, 'return_window_days', 'Return window (days)', 1, 365, true) is null then
        raise exception 'Variant "%": a return window (days) is required when returns are enabled', btrim(v_el.elem ->> 'name') using errcode = '22023';
      end if;
      if coalesce((v_el.elem ->> 'exchange_enabled')::boolean, false)
         and public.app_json_num(v_el.elem, 'exchange_window_days', 'Exchange window (days)', 1, 365, true) is null then
        raise exception 'Variant "%": an exchange window (days) is required when exchanges are enabled', btrim(v_el.elem ->> 'name') using errcode = '22023';
      end if;

      v_vid := nullif(btrim(v_el.elem ->> 'id'), '');
      if v_vid is not null and exists (select 1 from public.product_variants where id = v_vid and product_id <> v_id) then
        raise exception 'Variant id % belongs to another product', v_vid using errcode = '22023';
      end if;

      if v_vid is not null and exists (select 1 from public.product_variants where id = v_vid and product_id = v_id) then
        -- ---- update in place (stock is handled below, as a delta)
        update public.product_variants set
          name       = left(btrim(v_el.elem ->> 'name'), 100),
          sku        = case when v_el.elem ? 'sku'        then nullif(left(btrim(v_el.elem ->> 'sku'), 64), '') else sku end,
          price      = public.app_json_num(v_el.elem, 'price', 'Variant price', 0, 10000000),
          track_inventory = case when v_el.elem ? 'track_inventory' then (v_el.elem ->> 'track_inventory')::boolean else track_inventory end,
          image      = case when v_el.elem ? 'image'      then nullif(v_el.elem ->> 'image', '') else image end,
          gallery    = coalesce(public.app_json_text_array(v_el.elem, 'gallery', 30, 2000), gallery),
          attributes = case when v_el.elem ? 'attributes' then v_el.elem -> 'attributes' else attributes end,
          status     = case when v_el.elem ? 'status'     then v_el.elem ->> 'status' else status end,
          sort_order = coalesce(public.app_json_num(v_el.elem, 'sort_order', 'Sort order', 0, 100000, true)::int, v_el.ord::int),
          return_enabled       = case when v_el.elem ? 'return_enabled'   then (v_el.elem ->> 'return_enabled')::boolean else return_enabled end,
          return_window_days   = case when v_el.elem ? 'return_enabled'   then (case when (v_el.elem ->> 'return_enabled')::boolean then public.app_json_num(v_el.elem, 'return_window_days', 'Return window (days)', 1, 365, true)::int end) else return_window_days end,
          exchange_enabled     = case when v_el.elem ? 'exchange_enabled' then (v_el.elem ->> 'exchange_enabled')::boolean else exchange_enabled end,
          exchange_window_days = case when v_el.elem ? 'exchange_enabled' then (case when (v_el.elem ->> 'exchange_enabled')::boolean then public.app_json_num(v_el.elem, 'exchange_window_days', 'Exchange window (days)', 1, 365, true)::int end) else exchange_window_days end,
          import_key = case when v_el.elem ? 'import_key' then nullif(btrim(v_el.elem ->> 'import_key'), '') else import_key end
        where id = v_vid;
        v_vstock_exp := coalesce(public.app_json_num(v_el.elem, 'stock_expected', 'Expected variant stock', 0, 100000000, true),
                                 (select stock from public.product_variants where id = v_vid));
      else
        -- ---- new variant (client may pre-assign a "var_…" id: the admin form needs it for image paths)
        v_vid := coalesce(v_vid, public.app_new_variant_id());
        insert into public.product_variants
          (id, product_id, name, sku, price, stock, track_inventory, image, gallery, attributes, status, sort_order,
           return_enabled, return_window_days, exchange_enabled, exchange_window_days, import_key)
        values
          (v_vid, v_id, left(btrim(v_el.elem ->> 'name'), 100),
           nullif(left(btrim(v_el.elem ->> 'sku'), 64), ''),
           public.app_json_num(v_el.elem, 'price', 'Variant price', 0, 10000000), 0,
           coalesce((v_el.elem ->> 'track_inventory')::boolean, true),
           nullif(v_el.elem ->> 'image', ''),
           coalesce(public.app_json_text_array(v_el.elem, 'gallery', 30, 2000), '{}'),
           coalesce(v_el.elem -> 'attributes', '{}'::jsonb),
           coalesce(v_el.elem ->> 'status', 'active'),
           coalesce(public.app_json_num(v_el.elem, 'sort_order', 'Sort order', 0, 100000, true)::int, v_el.ord::int),
           (v_el.elem ->> 'return_enabled')::boolean,
           case when (v_el.elem ->> 'return_enabled')::boolean then public.app_json_num(v_el.elem, 'return_window_days', 'Return window (days)', 1, 365, true)::int end,
           (v_el.elem ->> 'exchange_enabled')::boolean,
           case when (v_el.elem ->> 'exchange_enabled')::boolean then public.app_json_num(v_el.elem, 'exchange_window_days', 'Exchange window (days)', 1, 365, true)::int end,
           nullif(btrim(v_el.elem ->> 'import_key'), ''));
        v_vstock_exp := 0;
      end if;
      v_kept := v_kept || v_vid;

      v_vstock := public.app_json_num(v_el.elem, 'stock', 'Variant stock', 0, 100000000, true);
      if v_vstock is not null and (v_vstock - v_vstock_exp) <> 0 then
        begin
          perform public.apply_inventory_movement(
            v_id, v_vid, (v_vstock - v_vstock_exp)::int,
            case when v_vstock > v_vstock_exp then 'adjustment_in' else 'adjustment_out' end,
            null, 'admin_edit', v_id, case when v_vstock_exp = 0 and v_created then 'initial stock' else 'admin edit' end,
            auth.uid(), 'admin', null, 'sellable');
        exception when others then
          if sqlerrm like 'Insufficient stock%' then
            raise exception 'Stock of variant "%" changed while you were editing (sales happened). Reload the page and set the stock again.',
              btrim(v_el.elem ->> 'name') using errcode = '40001';
          end if;
          raise;
        end;
      end if;
    end loop;

    if coalesce(p_delete_missing, true) then
      delete from public.product_variants where product_id = v_id and id <> all (v_kept);
    end if;

    if exists (select 1 from public.product_variants where product_id = v_id
               group by lower(btrim(name)) having count(*) > 1) then
      raise exception 'Variant names must be unique within a product' using errcode = '23505';
    end if;
  end if;

  -- ---------------------------------------------------------------- "something must be purchasable"
  select * into v_p from public.products where id = v_id;
  select count(*), count(*) filter (where status = 'active' and price > 0)
    into v_vcount, v_active from public.product_variants where product_id = v_id;
  if v_vcount = 0 then
    if v_p.price <= 0 and v_p.status = 'active' then
      raise exception 'Price must be greater than zero' using errcode = '22023';
    end if;
  else
    if v_p.main_option_enabled and v_p.price <= 0 and v_p.status = 'active' then
      raise exception 'The main product needs a price greater than zero (or turn off "sell the main product")' using errcode = '22023';
    end if;
    if not v_p.main_option_enabled and v_active = 0 and v_p.status = 'active' then
      raise exception 'Nothing on this product can be bought: the main product is off and no variant is active with a price' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'created', v_created,
    'updated_at', (select updated_at from public.products where id = v_id),
    'variant_ids', to_jsonb(v_kept));
end;
$$;

revoke all on function public.save_product(jsonb, jsonb, timestamptz, boolean) from public, anon;
grant execute on function public.save_product(jsonb, jsonb, timestamptz, boolean) to authenticated;   -- admin check is inside

commit;

notify pgrst, 'reload schema';