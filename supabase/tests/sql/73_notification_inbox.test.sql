-- needs: m8
-- reapply: 20261008_04_notifications.sql
-- reapply: 20261017_03_shipping.sql
-- reapply: 20261018_02_security_hardening.sql
-- Phase 14 — the notification SYSTEM the apps talk to (migration 20261008_04), exercised as the apps use it: the inbox columns (kind / read_at), mark_notifications_read,
-- register_device_token / unregister_device_token (the calls the RN app used to get wrong - known issue K-7 / P-11), the dispatcher's claim function, preferences.
-- The reconstructed local fixture predates that migration, so the runner applies it first (then M3 again, because the old migration redefines
-- trg_notify_order_status(), then M8) - the state this leaves is the state of the live project.
begin;

do $$
declare
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid();
  v_n integer; v_cols text;
begin
  insert into public.notifications (id, user_id, kind, title, body, data, read_at) values
    (a1, t.alice(), 'order_update', 'A1', 'one', '{"type":"order","orderId":"o1"}', null),
    (a2, t.alice(), 'order_update', 'A2', 'two', '{"type":"refund","requestId":"r1"}', null),
    (a3, t.alice(), 'back_in_stock', 'A3', 'three', '{"type":"product","productId":"p1"}', now()),
    (b1, t.bob(),   'order_update', 'B1', 'bob',  '{"type":"order","orderId":"o9"}', null);

  -- the inbox read, exactly as the apps do it
  perform t.as_user(t.alice());
  perform t.eq((select count(*)::text from (select id, kind, title, body, data, created_at, read_at from public.notifications order by created_at desc limit 50) s), '3', 'the inbox query of the apps (kind, read_at ...) returns Alice''s three messages');
  perform t.fails($q$select id, type, is_read from public.notifications$q$, '42703');                 -- the columns the first version of the RN app asked for do not exist

  -- mark_notifications_read: only her own rows, by id or all
  perform t.eq(public.mark_notifications_read(array[a1])::text, '1', 'marking one of her messages read counts 1');
  perform t.eq(public.mark_notifications_read(array[b1])::text, '0', 'she cannot mark Bob''s message (0 changed)');
  perform t.eq(public.mark_notifications_read('{}'::uuid[])::text, '0', 'an empty list changes nothing');
  perform t.eq(public.mark_notifications_read(null)::text, '1', 'no ids = every unread one of hers (1 was left)');
  perform t.eq(public.mark_notifications_read(null)::text, '0', 'and it is idempotent');
  perform t.as_postgres();
  perform t.ok((select read_at is not null from public.notifications where id = a1) and (select read_at is not null from public.notifications where id = a2), 'both of hers are read now');
  perform t.ok((select read_at is null from public.notifications where id = b1), 'Bob''s is untouched');
  perform t.as_anon();
  perform t.fails($q$select public.mark_notifications_read(null)$q$, '42501');

  -- direct access: read_at is the only column she may write; she may delete her own; nothing of Bob's is visible or touchable
  perform t.as_user(t.alice());
  perform t.fails($q$update public.notifications set title = 'x' where title = 'A1'$q$, '42501');
  perform t.fails($q$insert into public.notifications (user_id, kind, title, body) values ('00000000-0000-0000-0000-0000000000a2', 'system', 'forged', 'phish')$q$, '42501');
  update public.notifications set read_at = null where id = a1;
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '1', 'she can flip read_at of her own message back');
  update public.notifications set read_at = now() where id = b1;
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'but not Bob''s');
  delete from public.notifications where id = b1;
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'nor delete it');
  delete from public.notifications where id = a3;
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '1', 'she can delete her own message');
  perform t.as_postgres();
end $$;

-- 2. device tokens: through the RPCs only; a token follows whoever signs in last ---------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  perform t.as_user(t.alice());
  perform public.register_device_token('ExponentPushToken[aaaaaaaaaaaaaaaa]', 'ios', 'iPhone', '1.0.0');
  perform public.register_device_token('ExponentPushToken[aaaaaaaaaaaaaaaa]', 'ios', 'iPhone', '1.0.1');       -- every app launch: an upsert, not a duplicate
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.device_tokens where token = 'ExponentPushToken[aaaaaaaaaaaaaaaa]'), '1', 'registering the same token twice leaves ONE row');
  perform t.ok((select user_id = t.alice() and enabled and app_version = '1.0.1' and platform = 'ios' from public.device_tokens where token = 'ExponentPushToken[aaaaaaaaaaaaaaaa]'), 'owned by Alice, enabled, the newest version');
  perform t.ok(exists (select 1 from public.notification_preferences where user_id = t.alice()), 'registering also creates her preferences row');

  perform t.as_user(t.bob());
  perform public.register_device_token('ExponentPushToken[aaaaaaaaaaaaaaaa]', 'ios', 'iPhone', '1.0.1');       -- Bob signs in on the same phone
  perform t.as_postgres();
  perform t.ok((select user_id = t.bob() and count(*) over () = 1 from public.device_tokens where token = 'ExponentPushToken[aaaaaaaaaaaaaaaa]'), 'the token MOVED to Bob (one row, Bob''s)');

  perform t.as_user(t.alice());
  perform public.unregister_device_token('ExponentPushToken[aaaaaaaaaaaaaaaa]');                                -- Alice's late sign-out must not remove Bob's registration
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.device_tokens where token = 'ExponentPushToken[aaaaaaaaaaaaaaaa]'), '1', 'unregister only removes the CALLER''s own token');
  perform t.as_user(t.bob());
  perform public.unregister_device_token('ExponentPushToken[aaaaaaaaaaaaaaaa]');
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.device_tokens where token = 'ExponentPushToken[aaaaaaaaaaaaaaaa]'), '0', 'the owner unregisters it (sign-out BEFORE the session ends)');

  perform t.as_user(t.alice());
  perform t.fails($q$select public.register_device_token('short', 'ios')$q$, '22023');
  perform t.fails($q$select public.register_device_token('ExponentPushToken[bbbbbbbbbbbbbbbb]', 'blackberry')$q$, '22023');
  perform t.fails($q$select public.register_device_token(null, 'ios')$q$, '22023');
  perform t.fails($q$insert into public.device_tokens (user_id, token, platform) values ('00000000-0000-0000-0000-0000000000a1', 'ExponentPushToken[cccccccccccccccc]', 'ios')$q$, '42501');     -- the old direct upsert of the app
  perform t.fails($q$update public.device_tokens set enabled = false$q$, '42501');                                                                                                                  -- the old direct "disable"
  perform t.as_anon();
  perform t.fails($q$select public.register_device_token('ExponentPushToken[dddddddddddddddd]', 'ios')$q$, '42501');
  perform t.fails($q$select public.unregister_device_token('ExponentPushToken[dddddddddddddddd]')$q$, '42501');
  perform t.as_postgres();
end $$;

-- 3. the dispatcher's queue: service role only, atomic, bounded ------------------------------------------------------------------------------------------------
do $$
declare
  v_ids uuid[]; v_claimed integer; v_again integer; v_old uuid; v_max uuid;
begin
  delete from public.notifications;
  insert into public.notifications (user_id, kind, title, body, push_status) select t.alice(), 'system', 'Q' || g, 'body', 'pending' from generate_series(1, 5) g;
  insert into public.notifications (user_id, kind, title, body, push_status) values (t.alice(), 'system', 'skipped one', 'x', 'skipped');

  perform t.as_user(t.alice());
  perform t.fails($q$select * from public.claim_pending_notifications(10)$q$, '42501');
  perform t.as_anon();
  perform t.fails($q$select * from public.claim_pending_notifications(10)$q$, '42501');

  perform t.as_service();
  select count(*) into v_claimed from public.claim_pending_notifications(2);
  perform t.eq(v_claimed::text, '2', 'a claim hands out at most the limit');
  select count(*) into v_again from public.claim_pending_notifications(10);
  perform t.eq(v_again::text, '3', 'the next claim gets the rest and never the same rows twice');
  select count(*) into v_again from public.claim_pending_notifications(10);
  perform t.eq(v_again::text, '0', 'nothing is left: a "skipped" notification is never claimed');
  perform t.as_postgres();
  perform t.eq((select count(*)::text from public.notifications where push_status = 'sending' and push_attempts = 1), '5', 'claimed rows are "sending" with one attempt');

  -- a dispatcher that crashed: a row stuck in 'sending' for over 10 minutes is handed out again; a row that already used 5 attempts is not
  select id into v_old from public.notifications where title = 'Q1';
  select id into v_max from public.notifications where title = 'Q2';
  update public.notifications set claimed_at = now() - interval '11 minutes' where id = v_old;
  update public.notifications set claimed_at = now() - interval '11 minutes', push_attempts = 5 where id = v_max;
  perform t.as_service();
  select count(*) into v_claimed from public.claim_pending_notifications(10);
  perform t.as_postgres();
  perform t.eq(v_claimed::text, '1', 'a stale claim is re-claimed once, a row with 5 attempts is left alone');
  perform t.eq((select push_attempts::text from public.notifications where id = v_old), '2', 'the re-claimed row counts its second attempt');
end $$;

-- 4. preferences: own row only ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  perform t.as_user(t.alice());
  insert into public.notification_preferences (user_id, order_updates, promotions) values (t.alice(), false, true)
    on conflict (user_id) do update set order_updates = excluded.order_updates, promotions = excluded.promotions;
  perform t.ok((select not order_updates and promotions from public.notification_preferences where user_id = t.alice()), 'she can save her own switches (the upsert the app does)');
  perform t.fails($q$insert into public.notification_preferences (user_id) values ('00000000-0000-0000-0000-0000000000a2')$q$, '42501');
  update public.notification_preferences set order_updates = true where user_id = t.bob();
  get diagnostics v_n = row_count;
  perform t.eq(v_n::text, '0', 'she cannot change Bob''s switches');
  perform t.eq((select count(*)::text from public.notification_preferences), '1', 'and sees only her own row');
  perform t.as_anon();
  perform t.fails($q$select * from public.notification_preferences$q$, '42501');
  perform t.as_postgres();
end $$;

rollback;