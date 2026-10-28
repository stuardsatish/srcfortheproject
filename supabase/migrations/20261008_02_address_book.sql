-- ============================================================================
-- Roadmap task 4.1 — Address book (shared by the web AND mobile apps)
--
-- A customer can keep several labelled delivery addresses (Home, Work, ...),
-- mark one as the default, and pick one at checkout.
--
-- HOW IT PLUGS INTO CHECKOUT WITHOUT TOUCHING ANY EDGE FUNCTION
-- The payment / COD Edge Functions and the invoice code all read the delivery
-- address from `profiles.address` (shape: { street, city, state, pincode }).
-- So the DEFAULT address is mirrored into `profiles.address` by a trigger, in
-- exactly that shape (plus a few extra keys that nothing existing reads).
-- "Selecting an address at checkout" therefore just means "make it the default":
-- the order is shipped to what the customer picked, and every existing function
-- keeps working unchanged. Nothing needs redeploying for this feature.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.
-- Existing customers' current `profiles.address` is imported as their first
-- address ("Home", default) the first time this runs.
-- ============================================================================

-- 0 -- sanity: the trigger below writes JSON into profiles.address ------------
do $$
declare v_type text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'address';
  if v_type is distinct from 'jsonb' then
    raise exception
      'profiles.address is % (expected jsonb). Stop here and tell the developer before continuing.',
      coalesce(v_type, 'missing');
  end if;
end $$;

-- 1 -- table -------------------------------------------------------------------
create table if not exists public.addresses (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  label       text        not null default 'Home' check (char_length(btrim(label)) between 1 and 30),
  full_name   text        not null default '' check (char_length(full_name) <= 100),
  phone       text        not null default '' check (char_length(phone) <= 20),
  line1       text        not null check (char_length(btrim(line1)) between 1 and 200),
  line2       text        not null default '' check (char_length(line2) <= 200),
  landmark    text        not null default '' check (char_length(landmark) <= 100),
  city        text        not null default '' check (char_length(city) <= 80),
  state       text        not null default '' check (char_length(state) <= 80),
  pincode     text        not null default '' check (char_length(pincode) <= 10),
  country     text        not null default 'India' check (char_length(country) <= 60),
  is_default  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists addresses_user_idx on public.addresses (user_id, created_at desc);
-- at most ONE default per customer, enforced by the database itself
create unique index if not exists addresses_one_default_per_user
  on public.addresses (user_id) where is_default;

-- 2 -- row level security: a customer only ever sees / edits their own ----------
alter table public.addresses enable row level security;

drop policy if exists "addresses: select own" on public.addresses;
drop policy if exists "addresses: insert own" on public.addresses;
drop policy if exists "addresses: update own" on public.addresses;
drop policy if exists "addresses: delete own" on public.addresses;

create policy "addresses: select own" on public.addresses
  for select to authenticated using (user_id = auth.uid());
create policy "addresses: insert own" on public.addresses
  for insert to authenticated with check (user_id = auth.uid());
create policy "addresses: update own" on public.addresses
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "addresses: delete own" on public.addresses
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.addresses from anon;

-- 3 -- triggers ------------------------------------------------------------------

-- 3a. BEFORE insert/update: limit of 10, first address becomes default, only one
--     default at a time, updated_at maintained.
create or replace function public.addresses_before_write()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.label      := btrim(new.label);
  new.line1      := btrim(new.line1);
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if (select count(*) from public.addresses a where a.user_id = new.user_id) >= 10 then
      raise exception 'You can save up to 10 addresses. Delete one to add another.' using errcode = '54000';
    end if;
    -- the very first address is always the default
    if not exists (select 1 from public.addresses a where a.user_id = new.user_id) then
      new.is_default := true;
    end if;
  end if;

  if new.is_default then
    update public.addresses a
       set is_default = false
     where a.user_id = new.user_id and a.id <> new.id and a.is_default;
  end if;
  return new;
end;
$$;

drop trigger if exists addresses_before_write on public.addresses;
create trigger addresses_before_write
  before insert or update on public.addresses
  for each row execute function public.addresses_before_write();

-- 3b. Mirror the default address into profiles.address (the legacy shape that
--     checkout + invoices read), WITHOUT disturbing the keys already there.
create or replace function public.addresses_sync_profile()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.addresses;
begin
  if tg_op = 'DELETE' then
    -- the default was removed: promote the most recently added remaining address
    if old.is_default then
      update public.addresses
         set is_default = true
       where id = (select a.id from public.addresses a
                    where a.user_id = old.user_id
                    order by a.created_at desc limit 1);
    end if;
    return old;
  end if;

  v_row := new;
  if v_row.is_default then
    update public.profiles p
       set address = coalesce(case when jsonb_typeof(p.address) = 'object' then p.address end, '{}'::jsonb)
                     || jsonb_build_object(
                          'street',     btrim(v_row.line1 || case when v_row.line2 <> '' then ', ' || v_row.line2 else '' end),
                          'city',       v_row.city,
                          'state',      v_row.state,
                          'pincode',    v_row.pincode,
                          'landmark',   v_row.landmark,
                          'country',    v_row.country,
                          'label',      v_row.label,
                          'fullName',   v_row.full_name,
                          'phone',      v_row.phone,
                          'addressId',  v_row.id)
     where p.id = v_row.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists addresses_sync_profile on public.addresses;
create trigger addresses_sync_profile
  after insert or update or delete on public.addresses
  for each row execute function public.addresses_sync_profile();

-- 4 -- one-time import of each customer's existing profile address ---------------
-- Only customers with NO saved addresses yet, and only when the old profile
-- address actually has a street. Re-running this does nothing new.
insert into public.addresses (user_id, label, full_name, phone, line1, city, state, pincode, is_default)
select p.id,
       'Home',
       coalesce(p.name, ''),
       coalesce(p.phone, ''),
       left(btrim(p.address ->> 'street'), 200),
       left(coalesce(p.address ->> 'city', ''), 80),
       left(coalesce(p.address ->> 'state', ''), 80),
       left(coalesce(p.address ->> 'pincode', ''), 10),
       true
from public.profiles p
where jsonb_typeof(p.address) = 'object'
  and btrim(coalesce(p.address ->> 'street', '')) <> ''
  and exists (select 1 from auth.users u where u.id = p.id)
  and not exists (select 1 from public.addresses a where a.user_id = p.id);

notify pgrst, 'reload schema';