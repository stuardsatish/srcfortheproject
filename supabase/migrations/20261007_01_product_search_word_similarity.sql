-- ============================================================================
-- Roadmap task 2.2 (follow-up) — fix typo tolerance on multi-word titles.
--
-- WHY THIS EXISTS
-- Migration 20261006_01 matched typos with `similarity()` / the `%` operator,
-- which compares the query against the WHOLE target string. That works for a
-- short target ("furnitre" vs the category "furniture" scores well) but fails
-- on a long one, because every extra word dilutes the score:
--
--     'mascra' vs 'Essence Mascara Lash Princess'   -> ~0.17, below the 0.3
--                                                      similarity_threshold
--
-- so searching "mascra" returned nothing, even though "Mascara" is right
-- there in the title. Verified against the live data before writing this.
--
-- THE FIX
-- `word_similarity(query, target)` (and its operator `<%`) scores the query
-- against the best-matching *continuous word extent* inside the target rather
-- than the whole string, so a long title no longer penalises the match. Both
-- are indexable by the gin_trgm_ops indexes migration 01 already created, so
-- no new index is needed.
--
-- Only `search_products` is replaced. The extension and the three indexes from
-- migration 01 are untouched, and this is `create or replace`, so re-running is
-- safe.
--
-- `status` is still deliberately NOT filtered, for the reason given in
-- migration 01: neither catalog screen filters it, so filtering here alone
-- would make search hide products the catalog still lists.
-- ============================================================================

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
  with needle as (select btrim(coalesce(q, '')) as t)
  select p.*
  from public.products p, needle n
  where length(n.t) >= 2
    and (
      -- substring: "bed" -> "Annibale Colombo Bed"
         p.title    ilike '%' || n.t || '%'
      or p.brand    ilike '%' || n.t || '%'
      or p.category ilike '%' || n.t || '%'
      -- whole-string similarity: good for short targets ("furnitre")
      or p.title    %  n.t
      or p.brand    %  n.t
      or p.category %  n.t
      -- per-word similarity: good for long targets ("mascra" -> "Essence
      -- Mascara Lash Princess"), which the line above cannot reach
      or n.t <% p.title
      or n.t <% p.brand
      or n.t <% p.category
    )
  order by
    greatest(
      similarity(coalesce(p.title, ''),    n.t),
      similarity(coalesce(p.brand, ''),    n.t),
      similarity(coalesce(p.category, ''), n.t),
      word_similarity(n.t, coalesce(p.title, '')),
      word_similarity(n.t, coalesce(p.brand, '')),
      word_similarity(n.t, coalesce(p.category, ''))
    ) desc,
    coalesce(p.review_count, 0) desc,
    p.title asc
  limit least(coalesce(limit_count, 20), 50);
$$;

grant execute on function public.search_products(text, int) to anon, authenticated;