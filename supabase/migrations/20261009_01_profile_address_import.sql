-- ============================================================================
-- Follow-up to 20261008_02_address_book.sql (roadmap 4.1)
--
-- That migration imported every EXISTING customer's profile address once. A
-- customer who signs up AFTER it (signup can still collect an address and writes
-- it straight to `profiles.address`) would otherwise have a delivery address on
-- their profile but an empty address book.
--
-- This trigger closes that gap: whenever a profile gets an address and its owner
-- has no saved addresses yet, the profile address becomes their first ("Home",
-- default) saved address. It never touches customers who already have saved
-- addresses, so it is also a no-op for the writes the address book's own trigger
-- makes to `profiles.address`.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.
-- Requires 20261008_02_address_book.sql to have been run first.
-- ============================================================================

create or replace function public.profiles_import_address()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    if jsonb_typeof(new.address) = 'object'
       and btrim(coalesce(new.address ->> 'street', '')) <> ''
       and not exists (select 1 from public.addresses a where a.user_id = new.id) then
      insert into public.addresses (user_id, label, full_name, phone, line1, city, state, pincode, is_default)
      values (
        new.id,
        'Home',
        left(coalesce(new.name, ''), 100),
        left(coalesce(new.phone, ''), 20),
        left(btrim(new.address ->> 'street'), 200),
        left(coalesce(new.address ->> 'city', ''), 80),
        left(coalesce(new.address ->> 'state', ''), 80),
        left(coalesce(new.address ->> 'pincode', ''), 10),
        true);
    end if;
  exception when others then
    -- never let an address-book problem block a signup or a profile update
    raise warning 'profiles_import_address skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists profiles_import_address on public.profiles;
create trigger profiles_import_address
  after insert or update of address on public.profiles
  for each row
  when (new.address is not null)
  execute function public.profiles_import_address();

notify pgrst, 'reload schema';