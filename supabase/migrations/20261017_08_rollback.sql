-- ============================================================================
-- M6 ROLLBACK — removes the order-cancellation record, the order-level refund RPCs, the stock reports and the stock effect of an inspection (Phases 11-12).
-- Restores M4b's record_inspection() and its no-op hook app_after_inspection(): after this, recording an inspection no longer touches stock.
-- !! WHAT IS LOST: payment_exceptions (the list of captured payments that could not become an order - export it and refund / resolve every OPEN one first!),
--    order_cancellations / order_cancellation_private (who cancelled an order and why), return_request_items.disposition / stock_effect
--    (what happened to a returned line's stock - the LEDGER rows stay), refunds.reason (the customer-readable reason of an order refund) and the
--    inventory_logs.seq order column. Orders stay `cancelled`, restocked stock stays restocked, refunds of kind 'order' (money) stay. Export first:
--      select * from public.order_cancellations;  select id, disposition, stock_effect from public.return_request_items where stock_effect is not null;
-- Run this BEFORE 20261017_07_rollback.sql (M5b). SAFE TO RE-RUN.
-- ============================================================================
begin;

drop function if exists public.resolve_payment_exception(uuid, text, text, text);
drop function if exists public.record_payment_exception(text, text, uuid, numeric, text, jsonb);
drop table if exists public.payment_exceptions;
drop function if exists public.get_order_operations(text);
drop function if exists public.cancel_order(text, text, text, text, text);
drop function if exists public.create_order_refund(text, numeric, text, text, text, uuid, text);
drop function if exists public.app_create_order_refund(text, uuid, numeric, text, text, text, text, uuid);
drop function if exists public.inventory_unsellable_summary();
drop function if exists public.inventory_gaps(integer);
drop function if exists public.inventory_reconcile(boolean);

drop table if exists public.order_cancellation_private;
drop table if exists public.order_cancellations;

-- M4b's versions, verbatim: the hook is a no-op again and record_inspection knows no `disposition`
create or replace function public.app_after_inspection(p_item_id uuid, p_result text)
returns void
language plpgsql
as $$
begin
  null;
end;
$$;

create or replace function public.record_inspection(p_request_id uuid, p_results jsonb, p_internal_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid  uuid := auth.uid();
  r      public.return_requests;
  d      jsonb;
  v_iid  uuid;
  v_res  text;
  v_note text;
  it     public.return_request_items;
  v_seen uuid[] := '{}';
  v_wait integer;
  v_pass integer;
  v_fail integer;
begin
  r := public.app_lock_request_for_admin(p_request_id);
  if r.status <> 'inspection_pending' then raise exception 'Only a request that is waiting for inspection can be inspected (this one is "%")', replace(r.status, '_', ' ') using errcode = '22023'; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then raise exception 'Record a result for at least one item' using errcode = '22023'; end if;
  for d in select e.value from jsonb_array_elements(p_results) as e loop
    begin
      v_iid := (d ->> 'item_id')::uuid;
    exception when others then
      raise exception 'Each result needs a valid item_id' using errcode = '22023';
    end;
    v_res := d ->> 'result';
    v_note := nullif(btrim(coalesce(d ->> 'note', '')), '');
    if v_res is null or v_res not in ('passed', 'failed') then raise exception 'The result must be passed or failed' using errcode = '22023'; end if;
    if v_iid = any (v_seen) then raise exception 'An item appears twice in the results' using errcode = '22023'; end if;
    v_seen := v_seen || v_iid;
    select * into it from public.return_request_items where id = v_iid and request_id = p_request_id for update;
    if not found then raise exception 'Item % is not part of this request', v_iid using errcode = '22023'; end if;
    if it.item_status <> 'received' then raise exception 'This item cannot be inspected (it is "%")', it.item_status using errcode = '22023'; end if;
    if v_res = 'failed' and v_note is null then raise exception 'Tell the customer why the item failed the inspection' using errcode = '22023'; end if;
    update public.return_request_items set item_status = v_res, inspection_note = v_note, inspected_at = now() where id = v_iid;
    insert into public.return_request_events (request_id, item_id, actor_id, actor_role, note)
    values (p_request_id, v_iid, v_uid, 'admin', 'Inspection ' || v_res || coalesce(': ' || v_note, ''));
    perform public.app_after_inspection(v_iid, v_res);
  end loop;
  if nullif(btrim(coalesce(p_internal_note, '')), '') is not null then
    insert into public.return_request_events (request_id, actor_id, actor_role, note, internal) values (p_request_id, v_uid, 'admin', btrim(p_internal_note), true);
  end if;
  select count(*) filter (where item_status = 'received'), count(*) filter (where item_status = 'passed'), count(*) filter (where item_status = 'failed')
    into v_wait, v_pass, v_fail from public.return_request_items where request_id = p_request_id;
  if v_wait = 0 then
    r := public.app_apply_request_transition(p_request_id, case when v_pass > 0 then 'inspection_passed' else 'inspection_failed' end, 'system', v_uid, null,
           case when v_pass > 0 and v_fail > 0 then v_pass || ' item(s) accepted, ' || v_fail || ' not accepted.'
                when v_pass > 0 then 'All returned items were accepted.' else 'The returned items could not be accepted.' end, true);
  else
    select * into r from public.return_requests where id = p_request_id;
  end if;
  return jsonb_build_object('ok', true, 'status', r.status, 'passed', v_pass, 'failed', v_fail, 'waiting', v_wait);
end;
$$;
revoke all on function public.app_after_inspection(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_inspection(uuid, jsonb, text) from public, anon;
grant execute on function public.record_inspection(uuid, jsonb, text) to authenticated;

alter table public.return_request_items drop constraint if exists return_request_items_disposition_chk;
alter table public.return_request_items drop constraint if exists return_request_items_stock_effect_chk;
alter table public.return_request_items drop column if exists disposition;
alter table public.return_request_items drop column if exists stock_effect;
alter table public.refunds drop constraint if exists refunds_reason_chk;
alter table public.refunds drop column if exists reason;
drop index if exists public.inventory_logs_seq_idx;
alter table public.inventory_logs drop column if exists seq;

commit;

notify pgrst, 'reload schema';