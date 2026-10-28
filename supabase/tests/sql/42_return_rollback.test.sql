-- needs: m4b
-- reapply: 20261017_05_rollback.sql
-- reapply: 20261017_05_rollback.sql
-- reapply: 20261017_04_rollback.sql
-- reapply: 20261017_04_rollback.sql
-- M4b rollback, then M4 rollback, each applied TWICE (a rollback must be safe to re-run); the state is checked afterwards.
-- 43_return_roll_forward.test.sql proves the migrations can be applied again after that.
begin;

do $$
begin
  perform t.ok(to_regclass('public.return_requests') is null and to_regclass('public.return_request_items') is null and to_regclass('public.return_request_evidence') is null
               and to_regclass('public.return_request_events') is null and to_regclass('public.return_request_private') is null
               and to_regclass('public.request_status_transitions') is null and to_regclass('public.request_reasons') is null, 'every request table is gone');
  perform t.ok(to_regclass('public.return_request_no_seq') is null and to_regclass('public.exchange_request_no_seq') is null, 'and both number sequences');
  perform t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname in ('create_return_request', 'cancel_return_request', 'respond_to_request', 'get_order_eligibility',
                              'decide_request_items', 'request_transition', 'set_return_logistics', 'customer_submit_return_shipment', 'record_return_received', 'record_inspection',
                              'send_request_message', 'set_request_internal_note', 'app_apply_request_transition', 'app_item_eligibility', 'app_item_policy', 'app_return_deadline',
                              'app_store_return_defaults', 'app_notify_admins', 'app_notify_request_customer', 'app_next_request_no', 'app_after_inspection', 'app_lock_request_for_admin',
                              'app_setup_return_evidence_storage', 'trg_return_shipment_progress')), 'every function of M4 / M4b is gone');
  perform t.ok(not exists (select 1 from pg_trigger where tgname = 'shipments_return_progress' and not tgisinternal), 'the return-shipment trigger is gone');
  perform t.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipments' and column_name in ('request_id', 'pickup_reference')), 'the extra shipment columns are gone');
  -- M3 is untouched
  perform t.ok(to_regclass('public.shipments') is not null and to_regprocedure('public.ship_order(text,text,text,text,timestamptz,numeric,text,jsonb,text,date)') is not null, 'shipping (M3) is intact');
  perform t.ok(to_regprocedure('public.app_record_shipment_event(uuid,text,timestamptz,text,text,text,text,jsonb,uuid)') is not null, 'including the event recorder');
  -- outbound shipments can be written again (the request-id check constraint went with the column)
  insert into public.orders (id, user_id, order_status) values ('rb_o1', t.alice(), 'confirmed');
  insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total) values ('77777777-0000-0000-0000-000000000001', 'rb_o1', 'prod_single_a', 'Shirt', 1, 500, 500);
  perform t.as_user(t.admin());
  perform public.ship_order('rb_o1', 'manual', 'RB-1');
  perform t.ok(exists (select 1 from public.shipments where order_id = 'rb_o1' and direction = 'outbound'), 'ship_order still works after the rollback');
  perform t.as_postgres();
end $$;

rollback;