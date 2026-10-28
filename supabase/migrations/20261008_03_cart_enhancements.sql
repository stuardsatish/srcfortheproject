-- ============================================================================
-- Roadmap tasks 5.1/5.2 (Save for later), 5.3 (coupon listing),
-- 5.10/5.11 (gift wrap + message) — shared by the web AND mobile apps.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.
-- Additive only: two new tables' worth of structure, one new column on
-- `promo_codes`, two new columns on `orders` (both with defaults), one function.
-- ============================================================================


-- 1 -- SAVE FOR LATER (5.1 / 5.2) --------------------------------------------
-- A separate table from cart_items, on purpose: if saved items lived in
-- cart_items behind a flag, any older app build that does not know about the
-- flag would show them in the cart and let them be bought. Same columns the
-- apps already write to cart_items, so moving an item between the two is a
-- straight copy.
create table if not exists public.saved_items (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  product_id       text        not null,
  variant_id       text        not null default '',
  variant_name     text,
  selected_variant jsonb,
  quantity         integer     not null default 1 check (quantity between 1 and 999),
  title            text,
  image            text,
  category         text,
  price            numeric,
  discount         numeric,
  discount_expiry  timestamptz,
  saved_at         timestamptz not null default now(),
  unique (user_id, product_id, variant_id)
);

create index if not exists saved_items_user_idx on public.saved_items (user_id, saved_at desc);

alter table public.saved_items enable row level security;

drop policy if exists "saved items: own" on public.saved_items;
create policy "saved items: own" on public.saved_items
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.saved_items from anon;


-- 2 -- COUPON LISTING (5.3) ---------------------------------------------------
-- `promo_codes` has no client-readable policy (admin only) and must stay that
-- way: anyone able to SELECT it could read every code. This function is the
-- narrow window instead: it returns ONLY code / type / value / expiry for codes
-- that are listed and not expired - never usage counters or anything else.
--
-- `is_listed` lets the store hide a private code (influencer / one-to-one
-- codes). It defaults to TRUE, so every existing un-expired code will appear in
-- the cart's coupon list after this runs. To keep specific codes private:
--     update public.promo_codes set is_listed = false where code in ('SECRET10');
alter table public.promo_codes
  add column if not exists is_listed boolean not null default true;

create or replace function public.list_available_coupons()
returns table (code text, type text, value numeric, expiry_date timestamptz)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select p.code, p.type, p.value, p.expiry_date
  from public.promo_codes p
  where p.is_listed
    and (p.expiry_date is null or p.expiry_date > now())
    and p.value > 0
  order by p.expiry_date asc nulls last, p.code asc
  limit 50;
$$;

revoke all on function public.list_available_coupons() from public, anon;
grant execute on function public.list_available_coupons() to authenticated;


-- 3 -- GIFT WRAP + MESSAGE (5.10 / 5.11) --------------------------------------
-- Stored on the order so whoever packs it can see it. The checkout Edge
-- Functions write these after the order is created (see the changes to
-- payment-create-order / payment-cod-create / _shared/finalizeOrder.ts).
alter table public.orders
  add column if not exists gift_wrap    boolean not null default false,
  add column if not exists gift_message text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_gift_message_len' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_gift_message_len check (gift_message is null or char_length(gift_message) <= 300);
  end if;
end $$;

notify pgrst, 'reload schema';