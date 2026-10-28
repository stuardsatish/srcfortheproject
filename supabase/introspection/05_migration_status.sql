-- ============================================================================
-- 05_migration_status.sql - READ-ONLY. Which programme migrations are applied on THIS database?
-- ----------------------------------------------------------------------------
-- Paste it into the Supabase SQL Editor (or psql) and run it. It changes nothing.
-- One row per migration, in the order they must be applied:
--   status = APPLIED       every marker object of that migration exists
--          = PARTIAL       some exist, some are missing  -> the migration stopped half-way or was edited by hand:
--                          read `missing`, then run the migration file again (every file is safe to run twice)
--          = NOT APPLIED   none exists                   -> run the file (after a backup)
-- A marker is a table, function, trigger, column or index that only that migration creates. It proves the object is THERE,
-- not that it behaves correctly: 02_post_migration_checks.sql and 04_security_audit.sql check behaviour.
-- The row "PRE" is not a programme migration: M7 needs the notifications table of 20261008_04_notifications.sql.
-- ============================================================================
with expected(seq, migration, file, kind, obj) as (
  values
  (0,  'PRE',  '20261008_04_notifications.sql',              'table',    'notifications'),

  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'table',    'product_variants'),
  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'function', 'apply_inventory_movement'),
  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'function', 'refresh_product_variants_cache'),
  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'trigger',  'product_variants_cache'),
  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'trigger',  'guard_products_variants_write'),
  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'column',   'products.main_option_enabled'),
  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'column',   'products.return_window_days'),
  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'column',   'inventory_logs.idempotency_key'),
  (1,  'M1',   '20261014_01_variants_policy_inventory.sql',  'column',   'order_items.variant_name'),

  (2,  'M1b',  '20261014_02_save_product_rpc.sql',          'function', 'save_product'),
  (2,  'M1b',  '20261014_02_save_product_rpc.sql',          'function', 'app_json_num'),
  (2,  'M1b',  '20261014_02_save_product_rpc.sql',          'function', 'app_json_text_array'),

  (3,  'M1c',  '20261017_01_policy_defaults_guard.sql',     'function', 'app_validate_return_policy_defaults'),
  (3,  'M1c',  '20261017_01_policy_defaults_guard.sql',     'trigger',  'settings_guard_return_policy_defaults'),

  (4,  'M2',   '20261017_02_bulk_import.sql',               'table',    'import_batches'),
  (4,  'M2',   '20261017_02_bulk_import.sql',               'function', 'import_stage_batch'),
  (4,  'M2',   '20261017_02_bulk_import.sql',               'function', 'import_commit_batch'),
  (4,  'M2',   '20261017_02_bulk_import.sql',               'function', 'import_cancel_batch'),

  (5,  'M3',   '20261017_03_shipping.sql',                  'table',    'couriers'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'table',    'shipments'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'table',    'shipment_private'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'table',    'shipment_items'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'table',    'shipment_events'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'function', 'ship_order'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'function', 'add_shipment_event'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'function', 'mark_delivered'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'function', 'update_shipment'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'function', 'cancel_shipment'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'trigger',  'orders_10_status_guard'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'trigger',  'orders_20_delivered_at'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'trigger',  'shipment_items_10_cap'),
  (5,  'M3',   '20261017_03_shipping.sql',                  'column',   'orders.delivered_at'),

  (6,  'M4',   '20261017_04_return_requests.sql',           'table',    'request_reasons'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'table',    'request_status_transitions'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'table',    'return_requests'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'table',    'return_request_private'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'table',    'return_request_items'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'table',    'return_request_evidence'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'table',    'return_request_events'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'function', 'get_order_eligibility'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'function', 'create_return_request'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'function', 'cancel_return_request'),
  (6,  'M4',   '20261017_04_return_requests.sql',           'function', 'respond_to_request'),

  (7,  'M4b',  '20261017_05_return_workflow.sql',           'function', 'decide_request_items'),
  (7,  'M4b',  '20261017_05_return_workflow.sql',           'function', 'request_transition'),
  (7,  'M4b',  '20261017_05_return_workflow.sql',           'function', 'set_return_logistics'),
  (7,  'M4b',  '20261017_05_return_workflow.sql',           'function', 'customer_submit_return_shipment'),
  (7,  'M4b',  '20261017_05_return_workflow.sql',           'function', 'record_return_received'),
  (7,  'M4b',  '20261017_05_return_workflow.sql',           'function', 'record_inspection'),
  (7,  'M4b',  '20261017_05_return_workflow.sql',           'function', 'send_request_message'),
  (7,  'M4b',  '20261017_05_return_workflow.sql',           'function', 'set_request_internal_note'),
  (7,  'M4b',  '20261017_05_return_workflow.sql',           'trigger',  'shipments_return_progress'),

  (8,  'M5',   '20261017_06_refunds.sql',                   'table',    'refunds'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'table',    'refund_items'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'table',    'refund_private'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'table',    'refund_events'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'function', 'refund_calculate'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'function', 'create_refund'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'function', 'refund_mark_manual'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'function', 'refund_void'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'function', 'refund_begin_gateway'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'function', 'refund_gateway_context'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'function', 'refund_record_gateway_result'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'function', 'refund_apply_gateway_event'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'trigger',  'refunds_cap'),
  (8,  'M5',   '20261017_06_refunds.sql',                   'trigger',  'refund_items_cap'),

  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'table',    'exchange_reservations'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'table',    'replacement_fulfillments'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'table',    'replacement_fulfillment_items'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'table',    'exchange_adjustments'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'table',    'exchange_adjustment_private'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'function', 'ship_replacement'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'function', 'mark_replacement_delivered'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'function', 'settle_exchange_adjustment'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'function', 'create_exchange_refund'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'trigger',  'return_request_items_exchange_stock'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'trigger',  'return_requests_exchange_open'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'trigger',  'return_requests_exchange_cancelled'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'trigger',  'return_requests_exchange_close_guard'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'trigger',  'shipments_replacement_progress'),
  (9,  'M5b',  '20261017_07_exchange_fulfilment.sql',       'trigger',  'refunds_exchange_sync'),

  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'table',    'order_cancellations'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'table',    'order_cancellation_private'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'table',    'payment_exceptions'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'function', 'inventory_reconcile'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'function', 'inventory_gaps'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'function', 'inventory_unsellable_summary'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'function', 'create_order_refund'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'function', 'cancel_order'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'function', 'get_order_operations'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'function', 'record_payment_exception'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'function', 'resolve_payment_exception'),
  (10, 'M6',   '20261017_08_inventory_cancellation.sql',    'body',     'record_inspection|disposition'),    -- M6 replaces the M4b body of record_inspection

  (11, 'M7',   '20261018_01_notification_events.sql',       'trigger',  'notify_order_placed'),
  (11, 'M7',   '20261018_01_notification_events.sql',       'trigger',  'notify_request_received'),
  (11, 'M7',   '20261018_01_notification_events.sql',       'trigger',  'notify_shipment_added'),
  (11, 'M7',   '20261018_01_notification_events.sql',       'trigger',  'notify_shipment_tracking_added'),

  (12, 'M8',   '20261018_02_security_hardening.sql',        'function', 'trg_return_requests_rate_guard'),
  (12, 'M8',   '20261018_02_security_hardening.sql',        'trigger',  'return_requests_rate_guard'),
  (12, 'M8',   '20261018_02_security_hardening.sql',        'index',    'return_requests_user_created_idx')
),
found as (
  select e.*,
    case e.kind
      when 'table'    then to_regclass('public.' || e.obj) is not null
      when 'function' then exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = e.obj)
      when 'trigger'  then exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgname = e.obj)
      when 'index'    then exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = e.obj)
      when 'column'   then exists (select 1 from information_schema.columns c
                                    where c.table_schema = 'public' and c.table_name = split_part(e.obj, '.', 1) and c.column_name = split_part(e.obj, '.', 2))
      when 'body'     then exists (select 1 from pg_proc p
                                    where p.pronamespace = 'public'::regnamespace and p.proname = split_part(e.obj, '|', 1)
                                      and (case when p.prokind = 'f' and p.proname = split_part(e.obj, '|', 1) then pg_get_functiondef(p.oid) end) ilike '%' || split_part(e.obj, '|', 2) || '%')
      else false
    end as present
  from expected e
)
select
  migration,
  file,
  case when count(*) filter (where present) = count(*) then 'APPLIED'
       when count(*) filter (where present) = 0        then 'NOT APPLIED'
       else 'PARTIAL' end                                                     as status,
  count(*) filter (where present) || ' / ' || count(*)                        as markers_found,
  coalesce(string_agg(kind || ' ' || obj, ', ' order by kind, obj) filter (where not present), '')  as missing
from found
group by seq, migration, file
order by seq;