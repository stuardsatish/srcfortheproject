-- ============================================================================
-- M1c — server-side validation of the STORE-WIDE return / exchange policy defaults
--       (IMPLEMENTATION_PLAN Phase 2; companion of M1, which seeded the settings row)
--
-- WHY
--   settings.returnPolicyDefaults is written straight from the admin page (PostgREST, RLS: admin only), so until now
--   the page was the ONLY layer checking it. Product rows are protected by CHECK constraints ("enabled => 1..365
--   days, disabled => no days"); this gives the defaults the same protection in the database.
--
-- ROW SHAPE (all keys optional; unknown keys are ignored so later phases can add some without a migration)
--   returnEnabled        boolean            default true
--   returnWindowDays     integer 1..365     required when returnEnabled, must be absent / null when not
--   exchangeEnabled      boolean            default true
--   exchangeWindowDays   integer 1..365     required when exchangeEnabled, must be absent / null when not
--   noReturnCategories   array of text      categories whose NEW products start with returns OFF   (Q-1)
--   noExchangeCategories array of text      categories whose NEW products start with exchanges OFF (Q-1)
--   The defaults only pre-fill the product form and the bulk import; they never rewrite existing products and
--   an order keeps the policy snapshotted when it was placed.
--
-- WHAT IT ADDS
--   app_validate_return_policy_defaults(jsonb) -> text   NULL = valid, otherwise the reason (pure, reusable)
--   trigger settings_guard_return_policy_defaults        BEFORE INSERT OR UPDATE on public.settings, only for
--                                                        id = 'returnPolicyDefaults'; raises 22023 on invalid data
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste -> Run. SAFE TO RE-RUN. Rollback: 20261017_01_rollback.sql.
--   ROLL-OUT ORDER: SQL first (nothing else depends on it; the admin page works with or without it).
-- ============================================================================

begin;

create or replace function public.app_validate_return_policy_defaults(p_data jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_side     text;
  v_flag     jsonb;
  v_days     jsonb;
  v_enabled  boolean;
  v_list     jsonb;
  v_key      text;
  v_elem     jsonb;
  v_n        numeric;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return 'returnPolicyDefaults must be a JSON object';
  end if;

  foreach v_side in array array['return', 'exchange'] loop
    v_flag := p_data -> (v_side || 'Enabled');
    v_days := p_data -> (v_side || 'WindowDays');

    -- absent or JSON null => default ON
    if v_flag is null or jsonb_typeof(v_flag) = 'null' then
      v_enabled := true;
    elsif jsonb_typeof(v_flag) = 'boolean' then
      v_enabled := (v_flag #>> '{}')::boolean;
    else
      return v_side || 'Enabled must be true or false';
    end if;

    if v_enabled then
      if v_days is null or jsonb_typeof(v_days) <> 'number' then
        return v_side || 'WindowDays must be a whole number of days between 1 and 365 while ' || v_side || 's are enabled';
      end if;
      v_n := (v_days #>> '{}')::numeric;
      if v_n <> trunc(v_n) or v_n < 1 or v_n > 365 then
        return v_side || 'WindowDays must be a whole number of days between 1 and 365';
      end if;
    elsif v_days is not null and jsonb_typeof(v_days) <> 'null' then
      return v_side || 'WindowDays must be empty while ' || v_side || 's are disabled';
    end if;
  end loop;

  foreach v_key in array array['noReturnCategories', 'noExchangeCategories'] loop
    v_list := p_data -> v_key;
    if v_list is null or jsonb_typeof(v_list) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v_list) <> 'array' then
      return v_key || ' must be a list of category names';
    end if;
    if jsonb_array_length(v_list) > 200 then
      return v_key || ' may hold at most 200 categories';
    end if;
    for v_elem in select value from jsonb_array_elements(v_list) loop
      if jsonb_typeof(v_elem) <> 'string' or btrim(v_elem #>> '{}') = '' or char_length(v_elem #>> '{}') > 100 then
        return v_key || ' must contain non-empty category names of at most 100 characters';
      end if;
    end loop;
  end loop;

  return null;
end;
$$;

create or replace function public.guard_return_policy_defaults()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_problem text;
begin
  v_problem := public.app_validate_return_policy_defaults(new.data);
  if v_problem is not null then
    raise exception 'Invalid return policy defaults: %', v_problem using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists settings_guard_return_policy_defaults on public.settings;
create trigger settings_guard_return_policy_defaults
  before insert or update on public.settings
  for each row
  when (new.id = 'returnPolicyDefaults')
  execute function public.guard_return_policy_defaults();

-- An already-stored row that would be rejected today is reported, never changed: an admin fixes it in Optimization.
do $$
declare
  v_problem text;
begin
  select public.app_validate_return_policy_defaults(s.data) into v_problem
  from public.settings s where s.id = 'returnPolicyDefaults';
  if v_problem is not null then
    raise warning 'settings.returnPolicyDefaults is invalid (%): open Optimization > Return & exchange defaults and save it again', v_problem;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';