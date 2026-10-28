-- needs: m1c
-- reapply: 20261017_01_policy_defaults_guard.sql
-- Phase 2 — settings.returnPolicyDefaults is validated by the DATABASE (M1c), not only by the admin page.
-- ("reapply" = the runner applies that migration a SECOND time before this script: the idempotency test.)
begin;

-- 1. the pure validator, table-driven ------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('valid: both ON 7 / 7',          '{"returnEnabled":true,"returnWindowDays":7,"exchangeEnabled":true,"exchangeWindowDays":7}', null),
      ('valid: exchange OFF, null days', '{"returnEnabled":true,"returnWindowDays":10,"exchangeEnabled":false,"exchangeWindowDays":null}', null),
      ('valid: exchange OFF, days key absent', '{"returnEnabled":true,"returnWindowDays":10,"exchangeEnabled":false}', null),
      ('valid: both windows at the limits', '{"returnWindowDays":1,"exchangeWindowDays":365}', null),
      ('valid: category lists', '{"returnWindowDays":7,"exchangeWindowDays":7,"noReturnCategories":["Fresh sweets"],"noExchangeCategories":[]}', null),
      ('valid: unknown keys are ignored (forward compatible)', '{"returnWindowDays":7,"exchangeWindowDays":7,"somethingNew":1}', null),
      ('enabled but no days',           '{"returnEnabled":true,"exchangeEnabled":true,"exchangeWindowDays":7}', 'returnWindowDays must be a whole number'),
      ('absent flags mean ON, so days are required', '{}', 'returnWindowDays must be a whole number'),
      ('zero days',                     '{"returnWindowDays":0,"exchangeWindowDays":7}', 'returnWindowDays must be a whole number'),
      ('negative days',                 '{"returnWindowDays":-3,"exchangeWindowDays":7}', 'returnWindowDays must be a whole number'),
      ('366 days',                      '{"returnWindowDays":7,"exchangeWindowDays":366}', 'exchangeWindowDays must be a whole number'),
      ('fractional days',               '{"returnWindowDays":7.5,"exchangeWindowDays":7}', 'returnWindowDays must be a whole number'),
      ('days as a string',              '{"returnWindowDays":"7","exchangeWindowDays":7}', 'returnWindowDays must be a whole number'),
      ('disabled but days present',     '{"returnEnabled":false,"returnWindowDays":7,"exchangeWindowDays":7}', 'must be empty while'),
      ('flag is not a boolean',         '{"returnEnabled":"yes","returnWindowDays":7,"exchangeWindowDays":7}', 'must be true or false'),
      ('categories not an array',       '{"returnWindowDays":7,"exchangeWindowDays":7,"noReturnCategories":"Sweets"}', 'must be a list of category names'),
      ('category entry not a string',   '{"returnWindowDays":7,"exchangeWindowDays":7,"noReturnCategories":[1]}', 'non-empty category names'),
      ('blank category entry',          '{"returnWindowDays":7,"exchangeWindowDays":7,"noExchangeCategories":["  "]}', 'non-empty category names'),
      ('not an object',                 '[1,2]', 'must be a JSON object')
    ) as v(label, doc, expect_like)
  loop
    if r.expect_like is null then
      perform t.eq(public.app_validate_return_policy_defaults(r.doc::jsonb), null, 'validator accepts: ' || r.label);
    else
      perform t.ok(public.app_validate_return_policy_defaults(r.doc::jsonb) like '%' || r.expect_like || '%', 'validator rejects: ' || r.label);
    end if;
  end loop;
  perform t.ok(public.app_validate_return_policy_defaults(null) is not null, 'validator rejects NULL');
end $$;

-- 2. the seeded row from M1 is valid, and the trigger is in place -----------------------------------------------------
do $$
begin
  perform t.ok((select count(*) from public.settings where id = 'returnPolicyDefaults') = 1, 'M1 seeded the returnPolicyDefaults row');
  perform t.eq(public.app_validate_return_policy_defaults((select data from public.settings where id = 'returnPolicyDefaults')), null, 'the seeded row is valid');
  perform t.ok(exists (select 1 from pg_trigger where tgname = 'settings_guard_return_policy_defaults' and tgrelid = 'public.settings'::regclass and not tgisinternal), 'guard trigger exists');
end $$;

-- 3. the trigger: an ADMIN can save a valid row, never an invalid one (UPDATE and the upsert the web page uses) ---------------
do $$
declare
  v_days text;
begin
  perform t.as_user(t.admin());

  update public.settings set data = '{"returnEnabled":true,"returnWindowDays":10,"exchangeEnabled":false,"exchangeWindowDays":null,"noReturnCategories":["Fresh sweets"]}'
   where id = 'returnPolicyDefaults';
  select data ->> 'returnWindowDays' into v_days from public.settings where id = 'returnPolicyDefaults';
  perform t.eq(v_days, '10', 'admin saved a valid row');

  perform t.fails($q$update public.settings set data = '{"returnEnabled":true,"returnWindowDays":0,"exchangeWindowDays":7}' where id = 'returnPolicyDefaults'$q$,
                  '22023', 'Invalid return policy defaults:%');
  perform t.fails($q$update public.settings set data = '{"returnEnabled":false,"returnWindowDays":5,"exchangeWindowDays":7}' where id = 'returnPolicyDefaults'$q$, '22023');
  -- PostgREST's upsert = INSERT .. ON CONFLICT DO UPDATE: the proposed row is checked on both paths
  perform t.fails($q$insert into public.settings (id, data) values ('returnPolicyDefaults', '{"returnWindowDays":999,"exchangeWindowDays":7}')
                      on conflict (id) do update set data = excluded.data$q$, '22023');
  select data ->> 'returnWindowDays' into v_days from public.settings where id = 'returnPolicyDefaults';
  perform t.eq(v_days, '10', 'a rejected write leaves the stored row untouched');

  -- other settings rows are not affected by the guard
  insert into public.settings (id, data) values ('someOtherSetting', '{"anything":[1,2,3]}') on conflict (id) do update set data = excluded.data;
  perform t.ok(exists (select 1 from public.settings where id = 'someOtherSetting'), 'other settings rows accept any JSON');
  perform t.as_postgres();
end $$;

-- 4. non-admins still cannot write settings at all (RLS) — the guard does not weaken it -----------------------------------
do $$
declare
  v_rows integer;
begin
  perform t.as_user(t.alice());
  update public.settings set data = '{"returnWindowDays":3,"exchangeWindowDays":3}' where id = 'returnPolicyDefaults';
  get diagnostics v_rows = row_count;
  perform t.eq(v_rows::text, '0', 'a customer update touches 0 rows (RLS)');
  perform t.as_anon();
  perform t.ok((select count(*) from public.settings where id = 'returnPolicyDefaults') = 1, 'anyone can READ the defaults (the storefront shows them)');
  perform t.as_postgres();
end $$;

-- 5. the migration is re-runnable (idempotent): it was applied twice before this script started ------------------------------------
do $$
begin
  perform t.ok((select count(*) from pg_trigger where tgname = 'settings_guard_return_policy_defaults' and not tgisinternal) = 1, 'exactly one guard trigger');
end $$;

rollback;