-- ============================================================================
-- _helpers.sql — prelude for every  tests/sql/*.test.sql  (run FIRST, in the same session, on a database cloned
-- from the template named by the test's  "-- needs: <key>"  line; the clone is thrown away afterwards).
--
-- The SAME .sql files are executed by two runners, so the assertions are written once:
--   * Node machine : supabase/tests/sql-suites.test.mjs      (part of  node run-all.mjs)
--   * no Node      : tools/pg-local/Invoke-SqlSuites.ps1      (real PostgreSQL 17.6 via libpq)
-- A test PASSES when its script runs to the end without an error. `raise notice 'ok ...'` lines are informational.
--
-- Conventions for a test script
--   * first line   -- needs: m1c          (template key from MIGRATION_CHAIN in tests/lib/pg.mjs; default = the last one)
--   * wrap the body in  begin; ... rollback;  and use DO blocks for the assertions
--   * impersonate a Supabase caller:  perform t.as_user('<uuid>');  ...  perform t.as_postgres();
--     (sets request.jwt.claims + SET LOCAL ROLE, exactly what PostgREST does)
-- ============================================================================
create schema if not exists t;
grant usage on schema t to public;

-- seeded identities of fixtures/legacy_seed.sql
create or replace function t.alice() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
create or replace function t.bob()   returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000a2'::uuid $$;
create or replace function t.admin() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000ad'::uuid $$;

create or replace function t.ok(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'ASSERTION FAILED: %', p_label;
  end if;
  raise notice 'ok   %', p_label;
end $$;

create or replace function t.eq(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % — expected [%] but got [%]', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok   %', p_label;
end $$;

-- the statement MUST raise; optionally with this SQLSTATE and/or a message matching this LIKE pattern
create or replace function t.fails(p_sql text, p_sqlstate text default null, p_like text default null) returns void
language plpgsql as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if p_sqlstate is not null and v_state is distinct from p_sqlstate then
      raise exception 'ASSERTION FAILED: expected SQLSTATE % but got % (%) for: %', p_sqlstate, v_state, v_msg, p_sql;
    end if;
    if p_like is not null and v_msg not like p_like then
      raise exception 'ASSERTION FAILED: expected a message like [%] but got [%] for: %', p_like, v_msg, p_sql;
    end if;
    raise notice 'ok   refused (% — %)', v_state, left(v_msg, 90);
    return;
  end;
  raise exception 'ASSERTION FAILED: the statement was expected to fail but succeeded: %', p_sql;
end $$;

-- become a Supabase caller for the rest of the transaction
create or replace function t.as_user(p_uid uuid, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;

create or replace function t.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create or replace function t.as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;

create or replace function t.as_postgres() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;