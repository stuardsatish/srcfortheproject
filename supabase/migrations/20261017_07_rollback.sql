-- ============================================================================
-- M5b ROLLBACK — removes the exchange stock reservations, replacement fulfilment records, price-difference records, their triggers and RPCs (Phase 10).
-- Stock that is still RESERVED for an exchange is given back first (movement exchange_release); stock of replacements that already SHIPPED stays deducted
-- (the goods left the shop).
-- !! EXCHANGE FULFILMENT RECORDS ARE DELETED (replacement_fulfillments + items, exchange_adjustments + private notes, exchange_reservations) and the
--    REPLACEMENT SHIPMENTS (shipments.direction = 'replacement') with their items / events / private rows. Export them first if you need them:
--      select * from public.replacement_fulfillments;  select * from public.exchange_adjustments;  select * from public.shipments where direction = 'replacement';
-- Refunds of kind 'exchange_difference' belong to M5 and stay (they are money records). Exchange requests keep their status; after re-applying
-- 20261017_07_exchange_fulfilment.sql the ones waiting in `replacement_pending` get their fulfilment record back.
-- Run this BEFORE 20261017_06_rollback.sql. SAFE TO RE-RUN.
-- ============================================================================
begin;

-- 1 -- give the held stock back --------------------------------------------------------------------------------------------------------------------------
do $$
declare x record;
begin
  if to_regclass('public.exchange_reservations') is not null then
    for x in select e.request_item_id, e.product_id, e.variant_id, e.quantity, q.order_id
               from public.exchange_reservations e join public.return_requests q on q.id = e.request_id
              where e.status = 'reserved' and e.stock_moved loop
      begin
        perform public.apply_inventory_movement(x.product_id, x.variant_id, x.quantity, 'exchange_release', x.order_id, 'return_request_item', x.request_item_id::text,
                                                'Replacement released (exchange fulfilment rolled back)', null, 'system', public.app_exchange_ledger_key('exchange_release', x.request_item_id));
      exception when sqlstate 'P0002' then
        null;       -- the product / variant no longer exists
      end;
    end loop;
  end if;
end $$;

-- 2 -- triggers, then their functions --------------------------------------------------------------------------------------------------------------------
drop trigger if exists refunds_exchange_sync on public.refunds;
drop trigger if exists shipments_replacement_progress on public.shipments;
drop trigger if exists return_requests_exchange_close_guard on public.return_requests;
drop trigger if exists return_requests_exchange_cancelled on public.return_requests;
drop trigger if exists return_requests_exchange_open on public.return_requests;
drop trigger if exists return_request_items_exchange_stock on public.return_request_items;
drop function if exists public.trg_exchange_refund_sync();
drop function if exists public.trg_replacement_shipment_progress();
drop function if exists public.trg_exchange_close_guard();
drop function if exists public.trg_exchange_cancelled();
drop function if exists public.trg_exchange_replacement_pending();
drop function if exists public.trg_exchange_item_reservation();

-- 3 -- RPCs and helpers ------------------------------------------------------------------------------------------------------------------------------------
drop function if exists public.create_exchange_refund(uuid, text, text, text);
drop function if exists public.settle_exchange_adjustment(uuid, text, text, text);
drop function if exists public.mark_replacement_delivered(uuid, timestamptz, text);
drop function if exists public.ship_replacement(uuid, text, text, text, text, timestamptz, numeric, text, date);
drop function if exists public.app_exchange_try_close(uuid);
drop function if exists public.app_exchange_open_fulfilment(uuid, boolean);
drop function if exists public.app_exchange_release_item(uuid, text);
drop function if exists public.app_exchange_reserve_item(uuid);
drop function if exists public.app_exchange_ledger_key(text, uuid);
drop function if exists public.app_replacement_unit_price(text, text);

-- 4 -- data -------------------------------------------------------------------------------------------------------------------------------------------------
delete from public.shipments where direction = 'replacement';
drop table if exists public.exchange_adjustment_private;
drop table if exists public.exchange_adjustments;
drop table if exists public.replacement_fulfillment_items;
drop table if exists public.replacement_fulfillments;
drop table if exists public.exchange_reservations;
drop index if exists public.refunds_one_active_exchange_difference;
delete from public.request_status_transitions where request_type = 'exchange' and from_status = 'replacement_shipped' and to_status = 'replacement_pending' and actor = 'system';

commit;

notify pgrst, 'reload schema';