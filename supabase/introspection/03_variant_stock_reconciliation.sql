-- ============================================================================
-- 03_variant_stock_reconciliation.sql — READ-ONLY. Run AFTER migration M1.
-- ----------------------------------------------------------------------------
-- Defect P-2: before M1 every sale of a VARIANT decremented the MAIN product's
-- stock and never reduced the variant's own stock. So for legacy variant products:
--   * main stock is probably TOO LOW by the units of variant lines sold before M1
--   * each variant's stock is probably TOO HIGH by that variant's units sold before M1
-- This report shows both, per product / variant, so an admin can correct the numbers
-- consciously (Admin -> Edit product). NOTHING is changed automatically — whether the
-- stored counts were already corrected by hand is only known to you.
--
-- Units are counted from order_items rows with snapshot_source = 'backfill'
-- (= orders placed before M1; variant identified from the "[Variant]" title suffix).
-- ============================================================================
with legacy_lines as (
  select oi.product_id, oi.variant_id, oi.variant_name, oi.item_type, oi.quantity
  from public.order_items oi
  where oi.snapshot_source = 'backfill'
),
per_variant as (
  select p.id as product_id, p.title, v.id as variant_id, v.name as variant_name, v.status,
         v.stock as variant_stock_now,
         coalesce((select sum(l.quantity) from legacy_lines l where l.product_id = p.id and l.variant_id = v.id), 0) as legacy_units_sold
  from public.products p join public.product_variants v on v.product_id = p.id
),
per_product as (
  select p.id as product_id, p.title, p.stock as main_stock_now, p.main_option_enabled,
         coalesce((select sum(l.quantity) from legacy_lines l where l.product_id = p.id and l.item_type = 'variant'), 0) as legacy_variant_units,
         coalesce((select sum(l.quantity) from legacy_lines l where l.product_id = p.id and l.item_type in ('main','single')), 0) as legacy_main_units
  from public.products p
  where exists (select 1 from public.product_variants v where v.product_id = p.id)
)
select jsonb_pretty(coalesce(jsonb_agg(jsonb_build_object(
  'product_id', pp.product_id,
  'title', pp.title,
  'main_stock_now', pp.main_stock_now,
  'main_option_enabled', pp.main_option_enabled,
  'legacy_units_sold_as_variants (drained main stock)', pp.legacy_variant_units,
  'main_stock_if_those_units_had_not_drained_it', pp.main_stock_now + pp.legacy_variant_units,
  'variants', (select coalesce(jsonb_agg(jsonb_build_object(
                  'variant_id', pv.variant_id, 'name', pv.variant_name, 'status', pv.status,
                  'stock_now', pv.variant_stock_now,
                  'legacy_units_sold', pv.legacy_units_sold,
                  'stock_if_those_units_had_been_deducted', greatest(pv.variant_stock_now - pv.legacy_units_sold, 0)
                ) order by pv.variant_name), '[]'::jsonb)
               from per_variant pv where pv.product_id = pp.product_id)
) order by pp.product_id), '[]'::jsonb)) as reconciliation
from per_product pp;