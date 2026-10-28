-- ============================================================================
-- 01_preflight_report.sql — READ-ONLY. Run BEFORE migration M1.
-- ----------------------------------------------------------------------------
-- Tells you (and me) exactly what M1 will meet in the live data: how many variant
-- products exist, which legacy jsonb entries are malformed, duplicate SKUs/ids,
-- NULL cart variant ids, and which products will have their MAIN option switched
-- off. It issues SELECTs only and returns ONE jsonb cell named `preflight`.
-- Works on the pre-M1 schema (does not reference any M1 object).
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run -> copy the JSON cell.
-- ============================================================================
with
prod as (
  select id, title, sku, stock, has_variants, price, status,
         case when jsonb_typeof(variants) = 'array' then variants else '[]'::jsonb end as vj
  from public.products
),
entries as (                       -- every element of every products.variants array
  select p.id as product_id, p.title as product_title, e.elem, e.ord
  from prod p, jsonb_array_elements(p.vj) with ordinality as e(elem, ord)
),
entry_check as (
  select product_id, product_title, ord,
         elem ->> 'id'   as vid,
         elem ->> 'name' as vname,
         elem ->> 'sku'  as vsku,
         (nullif(btrim(elem ->> 'id'), '')   is null) as missing_id,
         (nullif(btrim(elem ->> 'name'), '') is null) as missing_name,
         (regexp_replace(coalesce(elem ->> 'price', ''), '[^0-9.\-]', '', 'g') !~ '^-?[0-9]+(\.[0-9]+)?$') as bad_price,
         (regexp_replace(coalesce(elem ->> 'stock', ''), '[^0-9.\-]', '', 'g') !~ '^-?[0-9]+(\.[0-9]+)?$') as bad_stock,
         (jsonb_typeof(elem -> 'price') = 'string') as price_is_string,
         (jsonb_typeof(elem -> 'stock') = 'string') as stock_is_string
  from entries
),
dup_variant_ids as (
  select vid, count(*) n, array_agg(product_id order by product_id) products
  from entry_check where not missing_id group by vid having count(*) > 1
),
dup_product_skus as (
  select lower(btrim(sku)) sku, count(*) n, array_agg(id order by id) products
  from prod where nullif(btrim(sku), '') is not null group by 1 having count(*) > 1
),
sku_all as (                       -- product SKUs + variant SKUs together
  select lower(btrim(sku)) sku, 'product:' || id as owner from prod where nullif(btrim(sku), '') is not null
  union all
  select lower(btrim(vsku)), 'variant:' || vid from entry_check where nullif(btrim(vsku), '') is not null and not missing_id
),
dup_any_skus as (
  select sku, count(*) n, array_agg(owner order by owner) owners from sku_all group by sku having count(*) > 1
),
bracket_items as (
  select oi.id, oi.order_id, oi.product_id, oi.title,
         substring(oi.title from '\[([^\]]+)\]\s*$') as vname
  from public.order_items oi
),
bracket_match as (
  select b.*, p.has_variants,
         exists (select 1 from entries e
                 where e.product_id = b.product_id
                   and lower(btrim(e.elem ->> 'name')) = lower(btrim(b.vname))) as matches_variant
  from bracket_items b left join prod p on p.id = b.product_id
  where b.vname is not null
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'm1_already_applied', to_regclass('public.product_variants') is not null,

  'products', jsonb_build_object(
    'total', (select count(*) from prod),
    'with_has_variants_true', (select count(*) from prod where has_variants),
    'has_variants_true_but_empty_array', (select count(*) from prod where has_variants and jsonb_array_length(vj) = 0),
    'has_variants_false_but_nonempty_array', (select count(*) from prod where not has_variants and jsonb_array_length(vj) > 0),
    'drafts', (select count(*) from prod where status = 'draft')),

  'variant_entries', jsonb_build_object(
    'total', (select count(*) from entry_check),
    'missing_id_or_name_will_be_skipped', (select count(*) from entry_check where missing_id or missing_name),
    'unparseable_price_will_become_0_and_inactive', (select count(*) from entry_check where bad_price and not missing_id and not missing_name),
    'unparseable_stock_will_become_0', (select count(*) from entry_check where bad_stock and not missing_id and not missing_name),
    'price_stored_as_json_string', (select count(*) from entry_check where price_is_string),
    'stock_stored_as_json_string', (select count(*) from entry_check where stock_is_string),
    'duplicate_ids_across_products', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from dup_variant_ids d)),

  'duplicate_skus', jsonb_build_object(
    'among_products', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from dup_product_skus d),
    'across_products_and_variants', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from dup_any_skus d),
    'note', 'legacy duplicates are tolerated by M1; they cannot be re-introduced once a SKU is edited'),

  'main_option_review', (   -- what M1 will set main_option_enabled to (on iff main stock > 0)
    select coalesce(jsonb_agg(jsonb_build_object(
             'product_id', id, 'title', title, 'main_price', price, 'main_stock', stock,
             'variants_in_json', jsonb_array_length(vj),
             'main_option_will_be', case when stock > 0 then 'ENABLED' else 'DISABLED' end) order by id), '[]')
    from prod where has_variants and jsonb_array_length(vj) > 0),

  'cart_items', jsonb_build_object(
    'rows', (select count(*) from public.cart_items),
    'null_variant_id_will_become_empty_string', (select count(*) from public.cart_items where variant_id is null)),

  'order_items', jsonb_build_object(
    'rows', (select count(*) from public.order_items),
    'title_has_bracket_suffix', (select count(*) from bracket_match),
    'bracket_matches_a_current_variant', (select count(*) from bracket_match where matches_variant),
    'bracket_on_variant_product_but_no_match', (select count(*) from bracket_match where not matches_variant and coalesce(has_variants, false)),
    'bracket_on_non_variant_product_kept_as_single', (select count(*) from bracket_match where not matches_variant and not coalesce(has_variants, false)),
    'unmatched_examples', (select coalesce(jsonb_agg(jsonb_build_object('order_id', order_id, 'title', title, 'product_id', product_id)), '[]')
                           from (select * from bracket_match where not matches_variant order by order_id limit 15) x)),

  'inventory_logs', jsonb_build_object('rows', (select count(*) from public.inventory_logs),
                                       'reasons', (select coalesce(jsonb_object_agg(reason, n), '{}') from (select reason, count(*) n from public.inventory_logs group by reason) r)),

  'orders', jsonb_build_object(
    'rows', (select count(*) from public.orders),
    'by_status', (select coalesce(jsonb_object_agg(order_status, n), '{}') from (select order_status, count(*) n from public.orders group by order_status) s),
    'guest_or_pos_orders_without_user', (select count(*) from public.orders where user_id is null)),

  'p2_exposure', jsonb_build_object(   -- legacy variant lines: main stock was drained, variant stock never reduced
    'legacy_variant_units_sold', (select coalesce(sum(quantity), 0) from public.order_items oi
                                  join bracket_match b on b.id = oi.id where b.matches_variant or coalesce(b.has_variants, false))
  )
)) as preflight;