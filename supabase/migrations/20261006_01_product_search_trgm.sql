-- ============================================================================
-- Roadmap task 2.2 — typo-tolerant product search (Postgres pg_trgm)
--
-- Shared Supabase project (hexosjsftzdqmwqbeahy): this affects BOTH the web
-- app and the mobile app. It is additive only — one extension, three indexes,
-- and one new read-only function. No existing table, column, policy or row is
-- modified, so nothing that works today changes behaviour.
--
-- Safe to re-run: every statement is guarded (`if not exists` /
-- `create or replace`).
--
-- NOTE ON `status`: this function deliberately does NOT filter on
-- `products.status`. Neither catalog screen filters it today
-- (ProductsPage.jsx does a bare `select("*")`, as does the mobile catalog), so
-- adding the filter here would make search hide products that the catalog
-- still lists — a worse inconsistency than carrying the existing behaviour
-- forward. If you later decide inactive products should be hidden, it should
-- be changed in the catalog queries and here together, not here alone.
-- ============================================================================

-- 1 ── trigram matching support -----------------------------------------------
create extension if not exists pg_trgm;

-- 2 ── indexes ----------------------------------------------------------------
-- GIN trigram indexes, one per searchable text column. Separate indexes (not
-- one over a concatenated expression) so the planner can use whichever column
-- the query actually discriminates on, and so each stays usable for the plain
-- ILIKE substring path as well as the similarity path.
create index if not exists products_title_trgm_idx
  on public.products using gin (title gin_trgm_ops);

create index if not exists products_brand_trgm_idx
  on public.products using gin (brand gin_trgm_ops);

create index if not exists products_category_trgm_idx
  on public.products using gin (category gin_trgm_ops);

-- 3 ── search function --------------------------------------------------------
-- Returns whole product rows (`setof public.products`) so the client can feed
-- the result straight into its existing `mapProductRow`/`mapProductRows`
-- mappers with no new shape to maintain.
--
-- `security invoker` (the default, stated explicitly for clarity): the caller's
-- own RLS policies on `products` still apply, so this function grants no read
-- access that a plain `select` wouldn't already allow.
--
-- Matching is a union of two strategies, which is what makes it tolerant of
-- both partial words and typos:
--   * ILIKE '%q%'  — substring, so "bed" finds "Annibale Colombo Bed".
--   * `%` operator — trigram similarity above pg_trgm.similarity_threshold
--                    (0.3 by default), so "furnitre" still finds "furniture".
-- Ranking is by best similarity across the three columns, then by review_count
-- as a popularity tie-break.
create or replace function public.search_products(
  q text,
  limit_count int default 20
)
returns setof public.products
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select p.*
  from public.products p
  where length(btrim(coalesce(q, ''))) >= 2
    and (
         p.title    ilike '%' || btrim(q) || '%'
      or p.brand    ilike '%' || btrim(q) || '%'
      or p.category ilike '%' || btrim(q) || '%'
      or p.title    %      btrim(q)
      or p.brand    %      btrim(q)
      or p.category %      btrim(q)
    )
  order by
    greatest(
      similarity(coalesce(p.title, ''),    btrim(q)),
      similarity(coalesce(p.brand, ''),    btrim(q)),
      similarity(coalesce(p.category, ''), btrim(q))
    ) desc,
    coalesce(p.review_count, 0) desc,
    p.title asc
  limit least(coalesce(limit_count, 20), 50);
$$;

-- Same audiences that can already read `products`.
grant execute on function public.search_products(text, int) to anon, authenticated;