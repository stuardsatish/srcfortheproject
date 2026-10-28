-- ============================================================================
-- Roadmap tasks 3.1 / 3.2 / 3.3 — Reviews++ (shared by the web AND mobile apps)
--
--   3.1  Review photos      -> reviews.photos column + `review-photos` storage bucket
--   3.2  Helpful voting     -> review_votes table + vote_on_review / review_vote_summary
--   3.3  Product Q&A        -> product_questions / product_answers + RPCs
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste this whole
-- file -> Run. It is additive and safe to re-run (everything is guarded with
-- `if not exists` / `create or replace` / drop-then-create for policies).
-- No existing table, column, policy or row is modified except for ONE new
-- nullable-with-default column on `reviews`.
--
-- WHY RPCs INSTEAD OF AN EDGE FUNCTION (roadmap 3.3 said "Edge Function"):
-- every write below is authorised by `auth.uid()` inside a SECURITY DEFINER
-- function, so the database enforces the rules itself and nothing extra has to
-- be deployed. An Edge Function would add a deploy step, CORS configuration
-- and a second place for the rules to live, for no extra security.
--
-- DEFENSIVE CHOICES (the live schema differs a little from the deployment
-- guide, so this file avoids assumptions):
--   * reviews.id / products.id / orders.id are TEXT in the live project, so
--     every id used here is text.
--   * Optional columns are never referenced directly.
-- ============================================================================


-- 0 -- tiny helpers ----------------------------------------------------------
-- Named `app_*` so they cannot collide with anything already in the project.
-- Identical copies exist at the top of the other 2026-10-08 migrations so each
-- file runs on its own.

create or replace function public.app_is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Anonymous (guest-checkout) sessions carry `is_anonymous: true` in the JWT.
create or replace function public.app_is_guest()
returns boolean
language sql stable
set search_path = public, pg_catalog
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- "Vishala Vijayan" -> "Vishala V."  (privacy: never expose a full surname)
create or replace function public.app_display_name(p_user_id uuid)
returns text
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select case
    when n.name is null or btrim(n.name) = '' then 'Customer'
    when position(' ' in btrim(n.name)) = 0 then btrim(n.name)
    else split_part(btrim(n.name), ' ', 1) || ' '
         || upper(left(regexp_replace(btrim(n.name), '^.*\s', ''), 1)) || '.'
  end
  from (select (select p.name from public.profiles p where p.id = p_user_id) as name) n;
$$;

-- Admin kill switch, same contract as isFeatureKilled() in the Edge Functions:
-- settings.id = 'security', data.allDisabled === true or data.<feature>Enabled === false.
create or replace function public.app_feature_enabled(p_feature text)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select not coalesce(
    (select coalesce((s.data ->> 'allDisabled')::boolean, false)
            or coalesce((s.data ->> (p_feature || 'Enabled'))::boolean, true) = false
     from public.settings s where s.id = 'security'),
    false);
$$;

-- Blocked / suspended accounts (same rule as isUserBlocked()).
create or replace function public.app_user_blocked(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select p.status in ('blocked', 'suspended') from public.profiles p where p.id = p_user_id),
    false);
$$;

revoke all on function public.app_is_admin()              from public;
revoke all on function public.app_is_guest()              from public;
revoke all on function public.app_display_name(uuid)      from public;
revoke all on function public.app_feature_enabled(text)   from public;
revoke all on function public.app_user_blocked(uuid)      from public, anon;
grant execute on function public.app_is_admin()            to anon, authenticated;
grant execute on function public.app_is_guest()            to anon, authenticated;
grant execute on function public.app_display_name(uuid)    to anon, authenticated;
grant execute on function public.app_feature_enabled(text) to anon, authenticated;
grant execute on function public.app_user_blocked(uuid)    to authenticated;


-- 1 -- 3.1 REVIEW PHOTOS -----------------------------------------------------
-- `photos` holds storage OBJECT PATHS inside the `review-photos` bucket
-- (e.g. '<user-uuid>/<orderId>_<productId>/1700000000_0.jpg'), not full URLs:
-- paths cannot point at an arbitrary third-party host, and the client builds
-- the public URL itself.
alter table public.reviews
  add column if not exists photos text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_photos_max_4' and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_photos_max_4 check (cardinality(photos) <= 4);
  end if;
end $$;

-- Public bucket (review photos are shown to every shopper), 3 MB per file,
-- raster images only. Re-running just refreshes those settings.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 3145728,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read; a signed-in user may write/remove ONLY inside their own
-- `<uid>/` folder.
drop policy if exists "review photos are public"        on storage.objects;
drop policy if exists "review photos: upload own"       on storage.objects;
drop policy if exists "review photos: update own"       on storage.objects;
drop policy if exists "review photos: delete own"       on storage.objects;

create policy "review photos are public"
  on storage.objects for select
  using (bucket_id = 'review-photos');

create policy "review photos: upload own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'review-photos'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "review photos: update own"
  on storage.objects for update to authenticated
  using (bucket_id = 'review-photos'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "review photos: delete own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos'
         and (storage.foldername(name))[1] = auth.uid()::text);

-- Attach (or replace) the photos on the caller's OWN review. The
-- `reviews-create` Edge Function is untouched: the app submits the review
-- through it exactly as before, then calls this to attach photos.
create or replace function public.set_review_photos(p_review_id text, p_photos text[])
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid   uuid := auth.uid();
  v_path  text;
  v_list  text[] := coalesce(p_photos, '{}');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if cardinality(v_list) > 4 then
    raise exception 'You can attach up to 4 photos' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reviews r where r.id = p_review_id and r.user_id = v_uid) then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;

  foreach v_path in array v_list loop
    -- must live in the caller's own folder and must not climb out of it
    if v_path is null
       or left(v_path, length(v_uid::text) + 1) <> v_uid::text || '/'
       or position('..' in v_path) > 0
       or length(v_path) > 300 then
      raise exception 'Invalid photo path' using errcode = '22023';
    end if;
  end loop;

  update public.reviews set photos = v_list
  where id = p_review_id and user_id = v_uid;
end;
$$;

revoke all on function public.set_review_photos(text, text[]) from public, anon;
grant execute on function public.set_review_photos(text, text[]) to authenticated;


-- 2 -- 3.2 HELPFUL / UNHELPFUL VOTES ----------------------------------------
create table if not exists public.review_votes (
  review_id  text        not null references public.reviews (id) on delete cascade,
  user_id    uuid        not null references auth.users (id)     on delete cascade,
  vote       smallint    not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create index if not exists review_votes_user_idx on public.review_votes (user_id);

alter table public.review_votes enable row level security;

-- A user may read only their own votes. Totals come from review_vote_summary(),
-- and every write goes through vote_on_review(), so there is no write policy.
drop policy if exists "review votes: read own" on public.review_votes;
create policy "review votes: read own"
  on public.review_votes for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.review_votes from anon, authenticated;

-- Per-review totals (+ the caller's own vote) for every review of one product.
create or replace function public.review_vote_summary(p_product_id text)
returns table (review_id text, helpful_count integer, unhelpful_count integer, my_vote smallint)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select r.id,
         (count(*) filter (where v.vote = 1))::integer,
         (count(*) filter (where v.vote = -1))::integer,
         coalesce(max(v.vote) filter (where v.user_id = auth.uid()), 0)::smallint
  from public.reviews r
  left join public.review_votes v on v.review_id = r.id
  where r.product_id = p_product_id
  group by r.id;
$$;

-- Cast, change or clear (p_vote = 0) the caller's vote on a review.
create or replace function public.vote_on_review(p_review_id text, p_vote smallint)
returns table (helpful_count integer, unhelpful_count integer, my_vote smallint)
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null or public.app_is_guest() then
    raise exception 'Please sign in to vote' using errcode = '28000';
  end if;
  if p_vote is null or p_vote not in (-1, 0, 1) then
    raise exception 'Invalid vote' using errcode = '22023';
  end if;

  select r.user_id into v_owner from public.reviews r where r.id = p_review_id;
  if not found then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;
  if v_owner = v_uid then
    raise exception 'You cannot vote on your own review' using errcode = '42501';
  end if;

  if p_vote = 0 then
    delete from public.review_votes where review_id = p_review_id and user_id = v_uid;
  else
    insert into public.review_votes (review_id, user_id, vote)
    values (p_review_id, v_uid, p_vote)
    on conflict (review_id, user_id) do update set vote = excluded.vote, created_at = now();
  end if;

  return query
    select (count(*) filter (where v.vote = 1))::integer,
           (count(*) filter (where v.vote = -1))::integer,
           coalesce(max(v.vote) filter (where v.user_id = v_uid), 0)::smallint
    from public.review_votes v
    where v.review_id = p_review_id;
end;
$$;

revoke all on function public.review_vote_summary(text)        from public;
revoke all on function public.vote_on_review(text, smallint)   from public, anon;
grant execute on function public.review_vote_summary(text)      to anon, authenticated;
grant execute on function public.vote_on_review(text, smallint) to authenticated;


-- 3 -- 3.3 PRODUCT Q&A -------------------------------------------------------
create table if not exists public.product_questions (
  id         uuid        primary key default gen_random_uuid(),
  product_id text        not null references public.products (id) on delete cascade,
  user_id    uuid        not null references auth.users (id)      on delete cascade,
  question   text        not null check (char_length(btrim(question)) between 5 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.product_answers (
  id          uuid        primary key default gen_random_uuid(),
  question_id uuid        not null references public.product_questions (id) on delete cascade,
  user_id     uuid        not null references auth.users (id)               on delete cascade,
  answer      text        not null check (char_length(btrim(answer)) between 2 and 1000),
  is_staff    boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists product_questions_product_idx on public.product_questions (product_id, created_at desc);
create index if not exists product_questions_user_idx    on public.product_questions (user_id, created_at desc);
create index if not exists product_answers_question_idx  on public.product_answers (question_id, created_at);

alter table public.product_questions enable row level security;
alter table public.product_answers   enable row level security;

drop policy if exists "questions: public read"      on public.product_questions;
drop policy if exists "questions: delete own/admin" on public.product_questions;
drop policy if exists "answers: public read"        on public.product_answers;
drop policy if exists "answers: delete own/admin"   on public.product_answers;

create policy "questions: public read"
  on public.product_questions for select using (true);
create policy "questions: delete own/admin"
  on public.product_questions for delete to authenticated
  using (user_id = auth.uid() or public.app_is_admin());

create policy "answers: public read"
  on public.product_answers for select using (true);
create policy "answers: delete own/admin"
  on public.product_answers for delete to authenticated
  using (user_id = auth.uid() or public.app_is_admin());

-- Writes only through the RPCs below (they enforce who may ask / answer and
-- how often). Moderation deletes are covered by the policies above.
revoke insert, update on public.product_questions from anon, authenticated;
revoke insert, update on public.product_answers   from anon, authenticated;

-- Has the caller bought this product? (any order of theirs containing it)
create or replace function public.app_has_purchased(p_product_id text)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = p_product_id and o.user_id = auth.uid()
  );
$$;
revoke all on function public.app_has_purchased(text) from public, anon;
grant execute on function public.app_has_purchased(text) to authenticated;

-- What the current visitor may do on this product's Q&A (drives the UI).
--   can_ask    : any signed-in, non-guest, non-blocked user
--   can_answer : the store's admins, plus customers who bought this product
create or replace function public.product_qa_permissions(p_product_id text)
returns jsonb
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'can_ask',
      auth.uid() is not null
      and not public.app_is_guest()
      and not public.app_user_blocked(auth.uid())
      and public.app_feature_enabled('reviews'),
    'can_answer',
      auth.uid() is not null
      and not public.app_is_guest()
      and not public.app_user_blocked(auth.uid())
      and public.app_feature_enabled('reviews')
      and (public.app_is_admin() or public.app_has_purchased(p_product_id)),
    'is_staff', public.app_is_admin()
  );
$$;

-- Questions (newest first) with their answers nested, as one jsonb array.
create or replace function public.list_product_qa(p_product_id text, p_limit integer default 30)
returns jsonb
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(s.q order by s.created_at desc), '[]'::jsonb)
  from (
    select q.created_at,
           jsonb_build_object(
             'id',         q.id,
             'question',   q.question,
             'created_at', q.created_at,
             'asker',      public.app_display_name(q.user_id),
             'is_mine',    coalesce(q.user_id = auth.uid(), false),
             'answers',    coalesce((
               select jsonb_agg(
                        jsonb_build_object(
                          'id',         a.id,
                          'answer',     a.answer,
                          'created_at', a.created_at,
                          'answerer',   case when a.is_staff then 'Store' else public.app_display_name(a.user_id) end,
                          'is_staff',   a.is_staff,
                          'is_mine',    coalesce(a.user_id = auth.uid(), false))
                        order by a.is_staff desc, a.created_at asc)
               from public.product_answers a where a.question_id = q.id), '[]'::jsonb)
           ) as q
    from public.product_questions q
    where q.product_id = p_product_id
    order by q.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) s;
$$;

create or replace function public.ask_product_question(p_product_id text, p_question text)
returns uuid
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := btrim(coalesce(p_question, ''));
  v_id  uuid;
begin
  if v_uid is null or public.app_is_guest() then
    raise exception 'Please sign in to ask a question' using errcode = '28000';
  end if;
  if not public.app_feature_enabled('reviews') then
    raise exception 'Questions are temporarily disabled' using errcode = '55000';
  end if;
  if public.app_user_blocked(v_uid) then
    raise exception 'Your account cannot post questions' using errcode = '42501';
  end if;
  if char_length(v_q) < 5 then
    raise exception 'Please write a little more (at least 5 characters)' using errcode = '22023';
  end if;
  if char_length(v_q) > 500 then
    raise exception 'Keep the question under 500 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  -- flood guard: 5 questions per hour, 20 per day, per user
  if (select count(*) from public.product_questions
        where user_id = v_uid and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.product_questions
        where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You are asking too fast. Please try again later.' using errcode = '54000';
  end if;

  insert into public.product_questions (product_id, user_id, question)
  values (p_product_id, v_uid, v_q)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.answer_product_question(p_question_id uuid, p_answer text)
returns uuid
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid     uuid := auth.uid();
  v_a       text := btrim(coalesce(p_answer, ''));
  v_product text;
  v_staff   boolean := public.app_is_admin();
  v_id      uuid;
begin
  if v_uid is null or public.app_is_guest() then
    raise exception 'Please sign in to answer' using errcode = '28000';
  end if;
  if not public.app_feature_enabled('reviews') then
    raise exception 'Answers are temporarily disabled' using errcode = '55000';
  end if;
  if public.app_user_blocked(v_uid) then
    raise exception 'Your account cannot post answers' using errcode = '42501';
  end if;
  if char_length(v_a) < 2 then
    raise exception 'Please write an answer' using errcode = '22023';
  end if;
  if char_length(v_a) > 1000 then
    raise exception 'Keep the answer under 1000 characters' using errcode = '22023';
  end if;

  select q.product_id into v_product from public.product_questions q where q.id = p_question_id;
  if not found then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  if not v_staff and not public.app_has_purchased(v_product) then
    raise exception 'Only customers who bought this product can answer' using errcode = '42501';
  end if;
  if (select count(*) from public.product_answers
        where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You are answering too fast. Please try again later.' using errcode = '54000';
  end if;

  insert into public.product_answers (question_id, user_id, answer, is_staff)
  values (p_question_id, v_uid, v_a, v_staff)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.product_qa_permissions(text)              from public;
revoke all on function public.list_product_qa(text, integer)            from public;
revoke all on function public.ask_product_question(text, text)          from public, anon;
revoke all on function public.answer_product_question(uuid, text)       from public, anon;
grant execute on function public.product_qa_permissions(text)           to anon, authenticated;
grant execute on function public.list_product_qa(text, integer)         to anon, authenticated;
grant execute on function public.ask_product_question(text, text)       to authenticated;
grant execute on function public.answer_product_question(uuid, text)    to authenticated;

-- Make PostgREST pick up the new tables/functions immediately.
notify pgrst, 'reload schema';