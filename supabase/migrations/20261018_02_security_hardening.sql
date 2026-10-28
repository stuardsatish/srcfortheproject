-- ============================================================================
-- M8 — SECURITY HARDENING (IMPLEMENTATION_PLAN Phase 13; requires M7, i.e. everything before it). Additive and idempotent: no table is rewritten, no
-- data is touched, no function BODY is replaced.
--
-- What the Phase 13 audit (supabase/tests/sql/80_security_audit.test.sql + introspection/04_security_audit.sql) found, and what this migration does about it:
--   1. NOTIFICATION ACL RE-ASSERTED. Migration 20261008_04 revoked EXECUTE on app_queue_notification() from the app roles (anyone able to call it could push
--      any text to any customer's phone) and narrowed the notification tables so a customer can only flip `read_at`. The local test database predates that
--      migration and had neither, and a hand-applied project could have missed it, so the same statements are repeated here. ON A PROJECT THAT HAS THEM
--      THIS CHANGES NOTHING (a revoke of a privilege that is not there is silent).
--   2. is_admin() (the legacy helper the oldest RLS policies call) is SECURITY DEFINER without a pinned search_path: pinned now (its body only uses
--      schema-qualified names, so nothing can change meaning). Every function written by this programme already pins it.
--   3. TRIGGER FUNCTIONS are not callable through the API. A function that returns `trigger` cannot be invoked as an RPC anyway, but some of them still
--      carried the default EXECUTE grant to anon / authenticated; it is revoked so the ACL listing is clean and a future audit has no noise. A trigger
--      keeps firing: EXECUTE is checked when the trigger is CREATED, not when it fires.
--   4. A RATE GUARD ON NEW RETURN / EXCHANGE REQUESTS. A customer can create, cancel and re-create requests without limit, and every creation notifies every
--      admin (and now the customer). A BEFORE INSERT trigger refuses a customer's 21st request inside one rolling hour (SQLSTATE 54000, a plain message).
--      Only the customer's OWN submissions count: an admin opening a request on someone's behalf, and the service role, are exempt. The limit is a constant of
--      the function (20 / hour) - far above any real use (one request per order line, and every line has at most one request in progress).
--
-- NOT changed on purpose (documented in FINAL_REPORT.md / the security section of DATABASE_CHANGE_PLAN.md): the legacy `stock_alerts` INSERT policy that lets a
-- visitor without an account subscribe (user_id NULL), the Supabase default table grants of the legacy tables (RLS is their protection), the CORS allow-list
-- wildcard for *.vercel.app in the Edge Functions (a deployment decision), the dispatch secret (owner action: rotate, then move to Vault - see the runbook).
--
-- HOW TO RUN: SQL Editor -> paste -> Run (after M7). SAFE TO RE-RUN. Rollback: 20261018_02_rollback.sql (removes only the rate guard; the ACL clean-ups
-- are not undone - they only take privileges away that nothing needs).
-- ROLL-OUT ORDER: SQL first. No website / app / Edge Function change is needed for it.
-- ============================================================================
begin;

-- Sections 1 - 3 only take privileges away or pin a setting. Each statement runs in its own sub-block: an object this role does not OWN (it would raise
-- insufficient_privilege) is skipped with a WARNING instead of aborting the whole migration - the live audit script then still lists it.

-- 1 -- notification ACL re-asserted (the exact statements of 20261008_04) -----------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.app_queue_notification(uuid, text, text, text, jsonb)') is not null then
    begin
      revoke all on function public.app_queue_notification(uuid, text, text, text, jsonb) from public, anon, authenticated;
      grant execute on function public.app_queue_notification(uuid, text, text, text, jsonb) to service_role;
    exception when insufficient_privilege then
      raise warning 'M8: could not change the ACL of app_queue_notification (not the owner): %', sqlerrm;
    end;
  end if;
  begin
    if to_regclass('public.notifications') is not null then
      revoke insert, update on public.notifications from anon, authenticated;
      grant update (read_at) on public.notifications to authenticated;          -- a customer may only mark a message read
      revoke all on public.notifications from anon;
    end if;
    if to_regclass('public.device_tokens') is not null then
      revoke insert, update on public.device_tokens from anon, authenticated;   -- registration goes through register_device_token()
      revoke all on public.device_tokens from anon;
    end if;
    if to_regclass('public.price_alerts') is not null then
      revoke insert, update on public.price_alerts from anon, authenticated;    -- via set_price_alert()
      revoke all on public.price_alerts from anon;
    end if;
    if to_regclass('public.notification_preferences') is not null then
      revoke all on public.notification_preferences from anon;
    end if;
  exception when insufficient_privilege then
    raise warning 'M8: could not change the privileges of a notification table (not the owner): %', sqlerrm;
  end;
end $$;

-- 2 -- the legacy admin helper gets a pinned search_path --------------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.is_admin()') is not null then
    alter function public.is_admin() set search_path = public, pg_catalog;
  end if;
exception when insufficient_privilege then
  raise warning 'M8: could not pin the search_path of is_admin() (not the owner): %', sqlerrm;
end $$;

-- 3 -- trigger functions: no EXECUTE for the app roles ------------------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'pg_catalog.trigger'::regtype and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')      -- not owned by an extension
  loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    exception when insufficient_privilege then
      raise warning 'M8: could not revoke EXECUTE on % (not the owner)', f.sig;
    end;
  end loop;
end $$;

-- 4 -- rate guard on new return / exchange requests ----------------------------------------------------------------------------------------------------------
create or replace function public.trg_return_requests_rate_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit  constant integer := 20;                 -- requests per customer per rolling hour
  v_recent integer;
begin
  -- only a customer's OWN submission is limited: an admin opening a request on her behalf (auth.uid() = the admin) and the service role / owner are not
  if new.user_id is null or auth.uid() is distinct from new.user_id then return new; end if;
  select count(*) into v_recent from public.return_requests q where q.user_id = new.user_id and q.created_at > now() - interval '1 hour';
  if v_recent >= v_limit then
    raise exception 'You have sent too many requests in the last hour. Please wait a little before sending another one.' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists return_requests_rate_guard on public.return_requests;
create trigger return_requests_rate_guard
  before insert on public.return_requests
  for each row
  execute function public.trg_return_requests_rate_guard();

create index if not exists return_requests_user_created_idx on public.return_requests (user_id, created_at);

revoke all on function public.trg_return_requests_rate_guard() from public, anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';