-- ============================================================================
-- M1b ROLLBACK — removes save_product() and its two helpers.
-- Nothing else is touched (no tables, no data). After this the admin pages built for
-- M1b cannot save products; the OLD admin pages do not use these functions at all
-- (and, once M1 is applied, they are limited by its guard trigger — see M1 rollback).
-- SAFE TO RE-RUN.
-- ============================================================================
begin;
drop function if exists public.save_product(jsonb, jsonb, timestamptz, boolean);
drop function if exists public.app_json_text_array(jsonb, text, integer, integer, boolean);
drop function if exists public.app_json_num(jsonb, text, text, numeric, numeric, boolean);
commit;
notify pgrst, 'reload schema';