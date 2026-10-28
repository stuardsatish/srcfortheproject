-- ============================================================================
-- M1 — Single / main / variant product model, per-option return & exchange
--      policy, inventory ledger, order-item purchase snapshot.
--      (IMPLEMENTATION_PLAN Phase 1A + 2-DB-part, DATABASE_CHANGE_PLAN §4)
--
-- WHAT IT DOES
--   1. Backs up products(variants, attributes, price, stock) into
--      public._backup_products_variants_20261014.
--   2. products: + main_option_enabled, track_inventory, tags, import_key,
--      return/exchange policy, updated_at.
--   3. NEW product_variants (normalised, source of truth). Legacy jsonb variants
--      are copied in WITH THEIR ORIGINAL IDS, so existing carts, saved items and
--      order titles keep resolving. products.variants becomes a read-only,
--      trigger-maintained cache (old app builds keep working); a guard trigger
--      rejects direct edits of it so a stale admin tab can never overwrite stock.
--   4. inventory_logs becomes the stock ledger; all stock changes go through
--      apply_inventory_movement() (atomic, idempotent, no oversell).
--   5. order_items: purchase-time snapshot columns (variant, SKU, GST, image,
--      return/exchange policy ...). Legacy rows are best-effort backfilled and
--      marked snapshot_source='backfill'.
--   6. create_order_tx REPLACED (same 21-argument signature, same return type):
--      honours variants, decrements the RIGHT stock counter (legacy version
--      drained the MAIN product for variant sales and never touched variant
--      stock), writes the snapshot and the ledger. Old Edge Functions keep
--      working; the new optional p_items keys are: mrp, gst_rate, hsn_code.
--   7. cart_items.variant_id NOT NULL DEFAULT '' ; stock_alerts.variant_id.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste -> Run. SAFE TO RE-RUN: every step
--   is guarded and the data backfills only touch rows that were not processed.
--   Take a dashboard backup first. Rollback: 20261014_01_rollback.sql.
--
-- ROLL-OUT ORDER: this SQL first, then Edge Functions, then web, then RN.
-- ============================================================================

begin;

-- 0 -- helpers --------------------------------------------------------------------
create or replace function public.app_is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Lenient numeric parsing for legacy jsonb values ("400", "₹1,500", "abc" -> NULL).
create or replace function public.app_try_numeric(p text)
returns numeric
language plpgsql immutable
as $$
begin
  if p is null then return null; end if;
  return nullif(regexp_replace(p, '[^0-9.\-]', '', 'g'), '')::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.app_new_variant_id()
returns text
language sql volatile
as $$ select 'var_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12); $$;

-- updated_at that ignores counters changed by the order flow (stock, ratings, the
-- variants cache) so it only moves on real content edits (admin-form concurrency token).
create or replace function public.app_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - array['stock','variants','has_variants','rating','review_count','updated_at'])
     is distinct from
     (to_jsonb(old) - array['stock','variants','has_variants','rating','review_count','updated_at']) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;


-- 1 -- backup of the legacy variant data ---------------------------------------------
create table if not exists public._backup_products_variants_20261014 as
  select id, has_variants, variants, attributes, price, stock, now() as backed_up_at
  from public.products;
alter table public._backup_products_variants_20261014 enable row level security;      -- no policies = no API access
revoke all on public._backup_products_variants_20261014 from anon, authenticated;


-- 2 -- products: new columns ------------------------------------------------------------
alter table public.products
  add column if not exists main_option_enabled  boolean     not null default true,
  add column if not exists track_inventory      boolean     not null default true,
  add column if not exists tags                 text[]      not null default '{}',
  add column if not exists import_key           text,
  add column if not exists return_enabled       boolean     not null default true,
  add column if not exists return_window_days   integer              default 7,
  add column if not exists exchange_enabled     boolean     not null default true,
  add column if not exists exchange_window_days integer              default 7,
  add column if not exists updated_at           timestamptz not null default now();

-- NOTE: a CHECK passes when its expression is NULL, so "enabled with no days" would slip through
-- a bare  (enabled AND days BETWEEN 1 AND 365) OR (NOT enabled AND days IS NULL).  coalesce(.., false)
-- + an explicit "days IS NOT NULL" make it strict (covered by m1.test.mjs).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_return_policy_chk' and conrelid = 'public.products'::regclass) then
    alter table public.products add constraint products_return_policy_chk check (coalesce(
      (return_enabled and return_window_days is not null and return_window_days between 1 and 365)
      or (not return_enabled and return_window_days is null), false));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_exchange_policy_chk' and conrelid = 'public.products'::regclass) then
    alter table public.products add constraint products_exchange_policy_chk check (coalesce(
      (exchange_enabled and exchange_window_days is not null and exchange_window_days between 1 and 365)
      or (not exchange_enabled and exchange_window_days is null), false));
  end if;
end $$;

create unique index if not exists products_import_key_uq on public.products (lower(import_key)) where import_key is not null;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at before update on public.products
  for each row execute function public.app_touch_updated_at();


-- 3 -- product_variants -----------------------------------------------------------------
create table if not exists public.product_variants (
  id                   text        primary key,
  product_id           text        not null references public.products (id) on delete cascade,
  name                 text        not null check (btrim(name) <> ''),
  sku                  text,
  price                numeric(12,2) not null check (price >= 0),
  stock                integer     not null default 0 check (stock >= 0),
  track_inventory      boolean     not null default true,
  image                text,
  gallery              text[]      not null default '{}',
  attributes           jsonb       not null default '{}'::jsonb,
  status               text        not null default 'active' check (status in ('active', 'inactive')),
  sort_order           integer     not null default 0,
  -- NULL pair = inherit the product's policy
  return_enabled       boolean,
  return_window_days   integer,
  exchange_enabled     boolean,
  exchange_window_days integer,
  import_key           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- strict (NULL-safe): NULL/NULL = inherit; true needs 1..365 days; false needs no days
  constraint product_variants_return_policy_chk check (coalesce(
    (return_enabled is null and return_window_days is null)
    or (return_enabled and return_window_days is not null and return_window_days between 1 and 365)
    or (not return_enabled and return_window_days is null), false)),
  constraint product_variants_exchange_policy_chk check (coalesce(
    (exchange_enabled is null and exchange_window_days is null)
    or (exchange_enabled and exchange_window_days is not null and exchange_window_days between 1 and 365)
    or (not exchange_enabled and exchange_window_days is null), false))
);
create index if not exists product_variants_product_idx on public.product_variants (product_id, sort_order);
create index if not exists product_variants_sku_idx     on public.product_variants (lower(sku));
create unique index if not exists product_variants_import_key_uq on public.product_variants (lower(import_key)) where import_key is not null;

alter table public.product_variants enable row level security;
revoke all on public.product_variants from anon, authenticated;
grant select on public.product_variants to anon, authenticated;         -- writes: RPCs only
drop policy if exists "variants: read active or admin" on public.product_variants;
create policy "variants: read active or admin" on public.product_variants
  for select using (status = 'active' or public.app_is_admin());

drop trigger if exists product_variants_touch_updated_at on public.product_variants;
create trigger product_variants_touch_updated_at before update on public.product_variants
  for each row execute function public.app_touch_updated_at();


-- 4 -- legacy jsonb -> rows (function used by the backfill AND by the compat trigger) --------
create or replace function public.explode_product_variants_json(p_product_id text, out inserted integer, out skipped integer)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v        record;
  v_names  text[];
  v_parts  text[];
  v_attrs  jsonb;
  v_price  numeric;
  i        integer;
begin
  inserted := 0; skipped := 0;

  -- attribute names, e.g. {Color,Size}; products.attributes is [] in the new shape but {} in some legacy rows
  select coalesce(array_agg(a.elem ->> 'name' order by a.ord), '{}')
    into v_names
  from public.products p,
       jsonb_array_elements(case when jsonb_typeof(p.attributes) = 'array' then p.attributes else '[]'::jsonb end)
         with ordinality as a(elem, ord)
  where p.id = p_product_id;

  for v in
    select e.elem, e.ord
    from public.products p,
         jsonb_array_elements(case when jsonb_typeof(p.variants) = 'array' then p.variants else '[]'::jsonb end)
           with ordinality as e(elem, ord)
    where p.id = p_product_id
    order by e.ord
  loop
    if nullif(btrim(v.elem ->> 'id'), '') is null or nullif(btrim(v.elem ->> 'name'), '') is null then
      skipped := skipped + 1;
      continue;
    end if;

    -- "Red / L" + attribute names {Color,Size}  =>  {"Color":"Red","Size":"L"}
    v_parts := regexp_split_to_array(btrim(v.elem ->> 'name'), '\s*/\s*');
    v_attrs := '{}'::jsonb;
    if coalesce(array_length(v_names, 1), 0) > 0 and array_length(v_names, 1) = array_length(v_parts, 1) then
      for i in 1 .. array_length(v_parts, 1) loop
        v_attrs := v_attrs || jsonb_build_object(v_names[i], v_parts[i]);
      end loop;
    end if;

    v_price := greatest(coalesce(public.app_try_numeric(v.elem ->> 'price'), 0), 0);

    insert into public.product_variants
      (id, product_id, name, sku, price, stock, image, attributes, sort_order, status)
    values
      (btrim(v.elem ->> 'id'), p_product_id, btrim(v.elem ->> 'name'),
       nullif(btrim(v.elem ->> 'sku'), ''),
       v_price,
       greatest(coalesce(public.app_try_numeric(v.elem ->> 'stock'), 0), 0)::integer,
       nullif(btrim(v.elem ->> 'image'), ''),
       v_attrs, v.ord::integer,
       -- the legacy server refused to sell price <= 0, so such an entry was never purchasable: keep it hidden
       case when v_price > 0 then 'active' else 'inactive' end)
    on conflict (id) do nothing;

    if found then inserted := inserted + 1; else skipped := skipped + 1; end if;
  end loop;
end;
$$;
revoke all on function public.explode_product_variants_json(text) from public, anon, authenticated;


-- 5 -- backfill: variants, main option, policy defaults (first run only per product) ------------
-- ONE statement on purpose, carrying nothing from one statement to the next. An earlier version kept the processed product ids
-- in a TEMP TABLE ... ON COMMIT DROP that the following statements read; pasted into the Supabase SQL Editor it failed with
-- ERROR 42P01 relation "_m1_exploded" does not exist (the table did not survive between statements there).
do $$
declare
  p record;
  r record;
  v_ids      text[] := '{}';                      -- the legacy variant products processed by THIS run
  v_products int := 0; v_ins int := 0; v_skip int := 0;
begin
  for p in
    select pr.id from public.products pr
    where pr.has_variants
      and jsonb_typeof(pr.variants) = 'array' and jsonb_array_length(pr.variants) > 0
      and not exists (select 1 from public.product_variants v where v.product_id = pr.id)   -- never resurrects deleted variants
    order by pr.id
  loop
    select * into r from public.explode_product_variants_json(p.id);
    v_ids := v_ids || p.id;
    v_products := v_products + 1; v_ins := v_ins + r.inserted; v_skip := v_skip + r.skipped;
  end loop;
  raise notice 'M1 backfill: % variant product(s) processed, % variant row(s) created, % jsonb entr(y/ies) skipped (invalid or duplicate id)', v_products, v_ins, v_skip;

  -- D-3: keep TODAY's purchasability of the main product on legacy variant products (on iff it has stock)
  update public.products pp
     set main_option_enabled = (pp.stock > 0)
   where pp.id = any (v_ids);

  for r in select pp.id, pp.title, pp.stock, pp.main_option_enabled
           from public.products pp where pp.id = any (v_ids) order by pp.id loop
    raise notice 'M1 review: legacy variant product % ("%") -> main product option %  (main stock %)',
      r.id, r.title, case when r.main_option_enabled then 'ENABLED' else 'DISABLED' end, r.stock;
  end loop;
end $$;


-- 6 -- sku uniqueness on write; variants cache; guard; compat insert -----------------------------
create or replace function public.app_assert_sku_free()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_sku      text := nullif(btrim(new.sku), '');
  v_conflict text;
begin
  if v_sku is null then return new; end if;
  -- legacy duplicates are tolerated until the SKU is actually changed
  if tg_op = 'UPDATE' and lower(btrim(coalesce(old.sku, ''))) = lower(v_sku) then return new; end if;

  if tg_table_name = 'products' then
    select 'product ' || p.id into v_conflict from public.products p
      where lower(btrim(p.sku)) = lower(v_sku) and p.id <> new.id limit 1;
    if v_conflict is null then
      select 'variant ' || v.id into v_conflict from public.product_variants v
        where lower(btrim(v.sku)) = lower(v_sku) limit 1;
    end if;
  else
    select 'product ' || p.id into v_conflict from public.products p
      where lower(btrim(p.sku)) = lower(v_sku) limit 1;
    if v_conflict is null then
      select 'variant ' || v.id into v_conflict from public.product_variants v
        where lower(btrim(v.sku)) = lower(v_sku) and v.id <> new.id limit 1;
    end if;
  end if;

  if v_conflict is not null then
    raise exception 'SKU "%" is already used by %', v_sku, v_conflict using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists products_sku_unique on public.products;
create trigger products_sku_unique before insert or update of sku on public.products
  for each row execute function public.app_assert_sku_free();
drop trigger if exists product_variants_sku_unique on public.product_variants;
create trigger product_variants_sku_unique before insert or update of sku on public.product_variants
  for each row execute function public.app_assert_sku_free();

-- ID CONVENTIONS the cart / server code relies on (cart compound id = "<productId>_<variantId>", split on
-- "_var_"): a product id must not contain "_var_", a variant id must start with "var_". Enforced on INSERT
-- only — never as a CHECK — so no existing row can ever be blocked from updating (e.g. a stock decrement).
create or replace function public.app_assert_id_conventions()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'products' then
    if position('_var_' in new.id) > 0 then
      raise exception 'Product id "%" must not contain "_var_" (reserved for cart compound ids)', new.id using errcode = '23514';
    end if;
  else
    if new.id !~ '^var_[A-Za-z0-9_\-]+$' then
      raise exception 'Variant id "%" must start with "var_" and use only letters, digits, "_" or "-"', new.id using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists products_id_conventions on public.products;
create trigger products_id_conventions before insert on public.products
  for each row execute function public.app_assert_id_conventions();
drop trigger if exists product_variants_id_conventions on public.product_variants;
create trigger product_variants_id_conventions before insert on public.product_variants
  for each row execute function public.app_assert_id_conventions();

-- the cache old clients read: [{id,name,price,stock,sku,image}] of ACTIVE variants
create or replace function public.refresh_product_variants_cache(p_product_id text)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  perform set_config('app.variant_cache_sync', 'on', true);
  update public.products p
     set variants = coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', v.id, 'name', v.name, 'price', v.price, 'stock', v.stock,
                    'sku', coalesce(v.sku, ''), 'image', coalesce(v.image, ''),
                    -- extra keys (old clients ignore unknown keys): the storefront needs them to honour
                    -- "track inventory" and to show the per-variant return/exchange override (NULL = inherit)
                    'track_inventory', v.track_inventory,
                    'return_enabled', v.return_enabled, 'return_window_days', v.return_window_days,
                    'exchange_enabled', v.exchange_enabled, 'exchange_window_days', v.exchange_window_days)
                  order by v.sort_order, v.created_at, v.id)
           from public.product_variants v
           where v.product_id = p.id and v.status = 'active'), '[]'::jsonb),
         has_variants = exists (select 1 from public.product_variants v where v.product_id = p.id)
   where p.id = p_product_id;
  perform set_config('app.variant_cache_sync', 'off', true);
end;
$$;
revoke all on function public.refresh_product_variants_cache(text) from public, anon, authenticated;

create or replace function public.trg_product_variants_cache()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_product_variants_cache(old.product_id);
    return old;
  end if;
  perform public.refresh_product_variants_cache(new.product_id);
  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    perform public.refresh_product_variants_cache(old.product_id);
  end if;
  return new;
end;
$$;
drop trigger if exists product_variants_cache on public.product_variants;
create trigger product_variants_cache after insert or update or delete on public.product_variants
  for each row execute function public.trg_product_variants_cache();

-- fail LOUDLY when something other than the cache writer changes products.variants
create or replace function public.guard_products_variants_write()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.variant_cache_sync', true), 'off') = 'on' then
    return new;
  end if;
  if new.variants is distinct from old.variants or new.has_variants is distinct from old.has_variants then
    raise exception 'products.variants is maintained from product_variants; edit variants with save_product() (stale admin page? reload it)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_products_variants_write on public.products;
create trigger guard_products_variants_write before update of variants, has_variants on public.products
  for each row execute function public.guard_products_variants_write();

-- an OLD admin form that still INSERTs a variant product as jsonb gets a correct normalised product
create or replace function public.trg_products_explode_on_insert()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare r record;
begin
  if new.has_variants
     and jsonb_typeof(new.variants) = 'array' and jsonb_array_length(new.variants) > 0
     and coalesce(current_setting('app.variant_cache_sync', true), 'off') <> 'on'
     and not exists (select 1 from public.product_variants v where v.product_id = new.id) then
    select * into r from public.explode_product_variants_json(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists products_explode_on_insert on public.products;
create trigger products_explode_on_insert after insert on public.products
  for each row execute function public.trg_products_explode_on_insert();


-- 7 -- inventory ledger ----------------------------------------------------------------------------
alter table public.inventory_logs
  add column if not exists variant_id      text    not null default '',
  add column if not exists movement_type   text,
  add column if not exists bucket          text    not null default 'sellable',
  add column if not exists ref_type        text,
  add column if not exists ref_id          text,
  add column if not exists actor_id        uuid,
  add column if not exists actor_kind      text,
  add column if not exists idempotency_key text,
  add column if not exists stock_after     integer,
  add column if not exists note            text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_logs_bucket_chk' and conrelid = 'public.inventory_logs'::regclass) then
    alter table public.inventory_logs add constraint inventory_logs_bucket_chk check (bucket in ('sellable', 'unsellable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_logs_movement_chk' and conrelid = 'public.inventory_logs'::regclass) then
    alter table public.inventory_logs add constraint inventory_logs_movement_chk check (movement_type is null or movement_type in
      ('sale','cancel_restock','return_restock','return_unsellable','exchange_reserve','exchange_release',
       'adjustment_in','adjustment_out','import_initial'));
  end if;
end $$;

create unique index if not exists inventory_logs_idem_uq on public.inventory_logs (idempotency_key) where idempotency_key is not null;
create index if not exists inventory_logs_item_idx on public.inventory_logs (product_id, variant_id, created_at desc);
create index if not exists inventory_logs_order_idx on public.inventory_logs (order_id) where order_id is not null;

update public.inventory_logs set movement_type = 'sale' where movement_type is null and reason = 'order';

-- the ledger is append-only for API roles; writes happen inside SECURITY DEFINER functions
revoke insert, update, delete, truncate on public.inventory_logs from anon, authenticated;

create or replace function public.apply_inventory_movement(
  p_product_id      text,
  p_variant_id      text,
  p_delta           integer,
  p_movement_type   text,
  p_order_id        text    default null,
  p_ref_type        text    default null,
  p_ref_id          text    default null,
  p_reason          text    default null,
  p_actor_id        uuid    default null,
  p_actor_kind      text    default 'system',
  p_idempotency_key text    default null,
  p_bucket          text    default 'sellable')
returns integer
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_variant  text := coalesce(p_variant_id, '');
  v_tracked  boolean;
  v_after    integer;
  v_prev     integer;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'Inventory delta must be a non-zero integer' using errcode = '22023';
  end if;
  if p_bucket not in ('sellable', 'unsellable') then
    raise exception 'Invalid inventory bucket %', p_bucket using errcode = '22023';
  end if;

  -- LOCK ORDER (always): product row, then variant row. The variants-cache trigger also
  -- updates the product row, so taking it first removes any product<->variant deadlock.
  select p.track_inventory into v_tracked from public.products p where p.id = p_product_id for update;
  if not found then
    raise exception 'Product not found: %', p_product_id using errcode = 'P0002';
  end if;
  if v_variant <> '' then
    select v.track_inventory into v_tracked
      from public.product_variants v where v.id = v_variant and v.product_id = p_product_id for update;
    if not found then
      raise exception 'Variant not found: % (product %)', v_variant, p_product_id using errcode = 'P0002';
    end if;
  end if;

  -- idempotent replay (serialised by the product row lock above)
  if p_idempotency_key is not null then
    select l.stock_after into v_prev from public.inventory_logs l where l.idempotency_key = p_idempotency_key;
    if found then return v_prev; end if;
  end if;

  if p_bucket = 'sellable' then
    if not v_tracked then
      return null;                                   -- untracked option: no counter, no check, no ledger
    end if;
    if v_variant = '' then
      update public.products set stock = stock + p_delta
       where id = p_product_id and stock + p_delta >= 0 returning stock into v_after;
    else
      update public.product_variants set stock = stock + p_delta
       where id = v_variant and stock + p_delta >= 0 returning stock into v_after;
    end if;
    if v_after is null then
      raise exception 'Insufficient stock for product % (variant %)', p_product_id, coalesce(nullif(v_variant, ''), 'main');
    end if;
  else
    -- unsellable bucket is bookkeeping only; remember the sellable level for reference
    if v_variant = '' then
      select stock into v_after from public.products where id = p_product_id;
    else
      select stock into v_after from public.product_variants where id = v_variant;
    end if;
  end if;

  insert into public.inventory_logs
    (product_id, variant_id, change, reason, order_id, movement_type, bucket,
     ref_type, ref_id, actor_id, actor_kind, idempotency_key, stock_after)
  values
    (p_product_id, v_variant, p_delta,
     coalesce(p_reason, case when p_movement_type = 'sale' then 'order' else p_movement_type end),
     p_order_id, p_movement_type, p_bucket, p_ref_type, p_ref_id, p_actor_id,
     coalesce(p_actor_kind, 'system'), p_idempotency_key, v_after);

  return v_after;
end;
$$;
revoke all on function public.apply_inventory_movement(text, text, integer, text, text, text, text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_inventory_movement(text, text, integer, text, text, text, text, text, uuid, text, text, text)
  to service_role;


-- 8 -- order_items purchase snapshot -----------------------------------------------------------------
alter table public.order_items
  add column if not exists variant_id          text    not null default '',
  add column if not exists variant_name        text,
  add column if not exists product_title       text,
  add column if not exists sku                 text,
  add column if not exists item_type           text,
  add column if not exists mrp                 numeric,
  add column if not exists gst_rate            numeric,
  add column if not exists hsn_code            text,
  add column if not exists image               text,
  add column if not exists return_enabled      boolean,
  add column if not exists return_window_days  integer,
  add column if not exists exchange_enabled    boolean,
  add column if not exists exchange_window_days integer,
  add column if not exists snapshot_source     text    not null default 'order';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_item_type_chk' and conrelid = 'public.order_items'::regclass) then
    alter table public.order_items add constraint order_items_item_type_chk check (item_type is null or item_type in ('single','main','variant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_items_snapshot_source_chk' and conrelid = 'public.order_items'::regclass) then
    alter table public.order_items add constraint order_items_snapshot_source_chk check (snapshot_source in ('order','backfill'));
  end if;
  -- a real (non-backfilled) variant line always names its variant, and only variant lines do
  if not exists (select 1 from pg_constraint where conname = 'order_items_variant_consistency_chk' and conrelid = 'public.order_items'::regclass) then
    alter table public.order_items add constraint order_items_variant_consistency_chk check (
      snapshot_source = 'backfill' or item_type is null or ((item_type = 'variant') = (variant_id <> '')));
  end if;
end $$;
create index if not exists order_items_product_variant_idx on public.order_items (product_id, variant_id);

-- legacy rows: the variant only lives in the title suffix "Title [Variant]".
-- A trailing [...] counts as a variant ONLY if it matches one of the product's variants, or the
-- product is a variant product (a single product titled "Pen [Limited Edition]" stays a single).
with parsed as (
  select oi.id, oi.product_id,
         substring(oi.title from '\[([^\]]+)\]\s*$')                    as vname_raw,
         btrim(regexp_replace(oi.title, '\s*\[[^\]]+\]\s*$', ''))       as base_title
  from public.order_items oi
  where oi.item_type is null
), resolved as (
  select x.*, p.has_variants as p_has_variants, p.sku as p_sku, p.thumbnail as p_thumb, p.image as p_image,
         v.id as v_id, v.name as v_name, v.sku as v_sku, v.image as v_image,
         (v.id is not null or (x.vname_raw is not null and coalesce(p.has_variants, false))) as is_variant
  from parsed x
  left join public.products p         on p.id = x.product_id
  left join public.product_variants v on v.product_id = x.product_id
                                     and x.vname_raw is not null
                                     and lower(v.name) = lower(btrim(x.vname_raw))
)
update public.order_items oi
   set product_title   = case when r.is_variant then coalesce(nullif(r.base_title, ''), oi.title) else oi.title end,
       variant_name    = case when r.is_variant then coalesce(r.v_name, btrim(r.vname_raw)) end,
       variant_id      = coalesce(r.v_id, ''),
       item_type       = case when r.is_variant then 'variant'
                              when coalesce(r.p_has_variants, false) then 'main'
                              else 'single' end,
       sku             = case when r.v_id is not null then r.v_sku
                              when r.is_variant then null
                              else r.p_sku end,
       mrp             = case when oi.discount > 0 and oi.discount < 100
                              then round(oi.unit_price * 100 / (100 - oi.discount), 2)
                              else oi.unit_price end,
       image           = coalesce(r.v_image, r.p_thumb, r.p_image),
       snapshot_source = 'backfill'
  from resolved r
 where oi.id = r.id;


-- 9 -- create_order_tx v2 ------------------------------------------------------------------------------
-- Same signature / return type / ACL as the live function (CREATE OR REPLACE keeps the grants).
create or replace function public.create_order_tx(
  p_order_id text, p_user_id uuid, p_items jsonb, p_order_status text, p_payment_status text,
  p_payment_method text, p_source text, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_address jsonb, p_subtotal numeric, p_shipping numeric, p_cgst numeric,
  p_sgst numeric, p_igst numeric, p_promo_code text, p_promo_discount numeric, p_total numeric,
  p_razorpay_order_id text default null::text, p_razorpay_payment_id text default null::text)
returns orders
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_item     record;
  v_order    public.orders;
  v_p        public.products;
  v_v        public.product_variants;
  v_qty      integer;
  v_type     text;
  v_ret_en   boolean; v_ret_days integer; v_exc_en boolean; v_exc_days integer;
  v_today    text := to_char(now(), 'YYYY-MM-DD');
  v_month    text := to_char(now(), 'YYYY-MM');
  v_year     text := to_char(now(), 'YYYY');
begin
  -- Idempotency (unchanged): a Razorpay webhook retry or a dropped /verify response
  -- just gets the order that already exists.
  select * into v_order from public.orders where id = p_order_id;
  if found then
    return v_order;
  end if;

  insert into public.orders (
    id, user_id, order_status, payment_status, payment_method, source,
    customer_name, customer_email, customer_phone, address,
    subtotal, shipping, cgst, sgst, igst, promo_code, promo_discount, total,
    razorpay_order_id, razorpay_payment_id
  ) values (
    p_order_id, p_user_id, p_order_status, p_payment_status, p_payment_method, p_source,
    p_customer_name, p_customer_email, p_customer_phone, p_address,
    p_subtotal, p_shipping, p_cgst, p_sgst, p_igst, p_promo_code, p_promo_discount, p_total,
    p_razorpay_order_id, p_razorpay_payment_id
  )
  returning * into v_order;

  -- Items are processed in a fixed (product, variant) order so two concurrent orders can
  -- never lock the same rows in opposite order (no deadlock between carts).
  for v_item in
    select e.value                                               as j,
           e.ordinality                                          as ord,
           e.value ->> 'product_id'                              as product_id,
           coalesce(nullif(btrim(e.value ->> 'variant_id'), ''), '') as variant_id
    from jsonb_array_elements(p_items) with ordinality as e(value, ordinality)
    order by e.value ->> 'product_id',
             coalesce(nullif(btrim(e.value ->> 'variant_id'), ''), ''),
             e.ordinality
  loop
    v_qty := (v_item.j ->> 'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity for product %', v_item.product_id using errcode = '22023';
    end if;

    select * into v_p from public.products where id = v_item.product_id for update;
    if not found then
      raise exception 'Product not found: %', v_item.product_id using errcode = 'P0002';
    end if;

    v_v := null;
    if v_item.variant_id <> '' then
      select * into v_v from public.product_variants
       where id = v_item.variant_id and product_id = v_item.product_id for update;
      if not found or v_v.status <> 'active' then
        raise exception 'Variant no longer available: % (product %)', v_item.variant_id, v_item.product_id;
      end if;
      v_type := 'variant';
    else
      if v_p.has_variants and not v_p.main_option_enabled then
        raise exception 'Main product option no longer available for product %', v_p.id;
      end if;
      v_type := case when v_p.has_variants then 'main' else 'single' end;
    end if;

    -- effective return/exchange policy: variant override, else product (snapshotted below)
    if v_v.id is not null and v_v.return_enabled is not null then
      v_ret_en := v_v.return_enabled;  v_ret_days := v_v.return_window_days;
    else
      v_ret_en := v_p.return_enabled;  v_ret_days := v_p.return_window_days;
    end if;
    if v_v.id is not null and v_v.exchange_enabled is not null then
      v_exc_en := v_v.exchange_enabled; v_exc_days := v_v.exchange_window_days;
    else
      v_exc_en := v_p.exchange_enabled; v_exc_days := v_p.exchange_window_days;
    end if;

    insert into public.order_items (
      order_id, product_id, variant_id, variant_name, product_title, title, sku, item_type,
      quantity, unit_price, mrp, discount, gst_rate, hsn_code, cgst, sgst, igst, line_total,
      image, return_enabled, return_window_days, exchange_enabled, exchange_window_days, snapshot_source
    ) values (
      p_order_id, v_item.product_id, v_item.variant_id,
      case when v_v.id is not null then v_v.name end,
      v_p.title,
      v_item.j ->> 'title',
      nullif(btrim(case when v_v.id is not null then v_v.sku else v_p.sku end), ''),
      v_type,
      v_qty,
      (v_item.j ->> 'unit_price')::numeric,
      coalesce((v_item.j ->> 'mrp')::numeric,
               case when coalesce((v_item.j ->> 'discount')::numeric, 0) between 0.0001 and 99.9999
                    then round((v_item.j ->> 'unit_price')::numeric * 100 / (100 - (v_item.j ->> 'discount')::numeric), 2)
                    else (v_item.j ->> 'unit_price')::numeric end),
      coalesce((v_item.j ->> 'discount')::numeric, 0),
      coalesce((v_item.j ->> 'gst_rate')::numeric, v_p.gst_rate),
      coalesce(nullif(v_item.j ->> 'hsn_code', ''), v_p.hsn_code),
      coalesce((v_item.j ->> 'cgst')::numeric, 0),
      coalesce((v_item.j ->> 'sgst')::numeric, 0),
      coalesce((v_item.j ->> 'igst')::numeric, 0),
      (v_item.j ->> 'line_total')::numeric,
      coalesce(case when v_v.id is not null then v_v.image end, v_p.thumbnail, v_p.image),
      v_ret_en, v_ret_days, v_exc_en, v_exc_days, 'order'
    );

    -- stock: the option's OWN counter (main/single -> products.stock, variant -> product_variants.stock),
    -- atomic + idempotent + logged; raises 'Insufficient stock for product ...' (-> HTTP 409 upstream)
    perform public.apply_inventory_movement(
      v_item.product_id, v_item.variant_id, -v_qty, 'sale',
      p_order_id, 'order', p_order_id, 'order', p_user_id,
      case when p_user_id is null then 'system' else 'user' end,
      'sale:' || p_order_id || ':' || v_item.ord, 'sellable');

    insert into public.product_stats (product_id, total_orders, total_revenue, total_quantity, last_sold_at)
    values (v_item.product_id, 1, (v_item.j ->> 'line_total')::numeric, v_qty, now())
    on conflict (product_id) do update set
      total_orders   = public.product_stats.total_orders + 1,
      total_revenue  = public.product_stats.total_revenue + excluded.total_revenue,
      total_quantity = public.product_stats.total_quantity + excluded.total_quantity,
      last_sold_at   = now();
  end loop;

  -- everything below is byte-for-byte the live behaviour
  if p_user_id is not null then
    insert into public.customer_stats (user_id, total_orders, total_spent, avg_order_value, last_order_date)
    values (p_user_id, 1, p_total, p_total, now())
    on conflict (user_id) do update set
      total_orders    = public.customer_stats.total_orders + 1,
      total_spent     = public.customer_stats.total_spent + p_total,
      avg_order_value = (public.customer_stats.total_spent + p_total) / (public.customer_stats.total_orders + 1),
      last_order_date = now();

    update public.profiles
       set total_orders = total_orders + 1,
           total_spent  = total_spent + p_total
     where id = p_user_id;

    delete from public.cart_items where user_id = p_user_id;
  end if;

  insert into public.analytics (period_type, period_key, revenue, orders, customers)
  values ('daily', v_today, p_total, 1, 1)
  on conflict (period_type, period_key) do update set
    revenue = public.analytics.revenue + p_total, orders = public.analytics.orders + 1;

  insert into public.analytics (period_type, period_key, revenue, orders, customers)
  values ('monthly', v_month, p_total, 1, 1)
  on conflict (period_type, period_key) do update set
    revenue = public.analytics.revenue + p_total, orders = public.analytics.orders + 1;

  insert into public.analytics (period_type, period_key, revenue, orders, customers)
  values ('yearly', v_year, p_total, 1, 1)
  on conflict (period_type, period_key) do update set
    revenue = public.analytics.revenue + p_total, orders = public.analytics.orders + 1;

  return v_order;
end;
$function$;


-- 10 -- cart + stock alerts --------------------------------------------------------------------------------
update public.cart_items set variant_id = '' where variant_id is null;
alter table public.cart_items alter column variant_id set default '';
alter table public.cart_items alter column variant_id set not null;

-- stock_alerts had no variant_id although the product page upserts one (so "Notify me" errored)
alter table public.stock_alerts add column if not exists variant_id text not null default '';
do $$
begin
  create unique index if not exists stock_alerts_user_product_variant_uq
    on public.stock_alerts (user_id, product_id, variant_id);
exception when unique_violation then
  raise warning 'stock_alerts_user_product_variant_uq not created: duplicate (user_id, product_id) rows exist';
end $$;

-- the live back-in-stock trigger notified (and deleted) EVERY alert of a product when the
-- MAIN stock came back; with variant alerts that would wrongly consume variant subscriptions.
create or replace function public.trg_notify_product_changes()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_old_price numeric := public.app_effective_price(old.price, old.discount, old.discount_expiry);
  v_new_price numeric := public.app_effective_price(new.price, new.discount, new.discount_expiry);
  r record;
begin
  begin
    -- back in stock (main option only): one-shot, so the alert rows are consumed
    if coalesce(old.stock, 0) <= 0 and coalesce(new.stock, 0) > 0 then
      for r in select sa.user_id from public.stock_alerts sa
                where sa.product_id = new.id and sa.variant_id = '' and sa.user_id is not null loop
        perform public.app_queue_notification(
          r.user_id, 'back_in_stock', 'Back in stock',
          coalesce(new.title, 'An item you wanted') || ' is available again.',
          jsonb_build_object('type', 'product', 'productId', new.id));
      end loop;
      delete from public.stock_alerts where product_id = new.id and variant_id = '';
    end if;

    -- price drop: one-shot as well
    if v_new_price < v_old_price and to_regclass('public.price_alerts') is not null then
      for r in
        select pa.id, pa.user_id
        from public.price_alerts pa
        where pa.product_id = new.id
          and v_new_price < pa.price_when_set
          and (pa.target_price is null or v_new_price <= pa.target_price)
      loop
        perform public.app_queue_notification(
          r.user_id, 'price_drop', 'Price drop',
          coalesce(new.title, 'An item you are watching') || ' is now ' || to_char(v_new_price, 'FM999999990.00') || '.',
          jsonb_build_object('type', 'product', 'productId', new.id, 'price', v_new_price));
        delete from public.price_alerts where id = r.id;
      end loop;
    end if;
  exception when others then
    raise warning 'trg_notify_product_changes skipped: %', sqlerrm;     -- never block a stock/price update
  end;
  return new;
end;
$$;

create or replace function public.trg_notify_variant_stock()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_title text;
begin
  begin
    if coalesce(old.stock, 0) <= 0 and coalesce(new.stock, 0) > 0 and new.status = 'active' then
      select p.title into v_title from public.products p where p.id = new.product_id;
      for r in select sa.user_id from public.stock_alerts sa
                where sa.product_id = new.product_id and sa.variant_id = new.id and sa.user_id is not null loop
        perform public.app_queue_notification(
          r.user_id, 'back_in_stock', 'Back in stock',
          coalesce(v_title, 'An item you wanted') || ' (' || new.name || ') is available again.',
          jsonb_build_object('type', 'product', 'productId', new.product_id, 'variantId', new.id));
      end loop;
      delete from public.stock_alerts where product_id = new.product_id and variant_id = new.id;
    end if;
  exception when others then
    raise warning 'trg_notify_variant_stock skipped: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists notify_variant_stock on public.product_variants;
create trigger notify_variant_stock after update of stock on public.product_variants
  for each row when (old.stock is distinct from new.stock)
  execute function public.trg_notify_variant_stock();


-- 11 -- store-wide policy defaults (admin-editable in Optimization; never overwritten) ----------------
insert into public.settings (id, data)
values ('returnPolicyDefaults',
        '{"returnEnabled": true, "returnWindowDays": 7, "exchangeEnabled": true, "exchangeWindowDays": 7}'::jsonb)
on conflict (id) do nothing;

commit;

notify pgrst, 'reload schema';