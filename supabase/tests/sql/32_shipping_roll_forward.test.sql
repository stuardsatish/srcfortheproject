-- needs: m3
-- reapply: 20261017_03_rollback.sql
-- reapply: 20261017_03_shipping.sql
-- Rollback followed by the migration again (a failed roll-out can be retried): the schema works and a shipment can be created.
begin;

do $$
declare
  v_r jsonb;
begin
  perform t.ok(to_regclass('public.shipments') is not null and to_regclass('public.couriers') is not null, 'tables are back');
  perform t.ok((select count(*) from public.couriers) >= 5, 'the courier catalogue is seeded again');
  perform t.ok((select count(*) from public.orders where delivered_at is not null) >= 2, 'delivered_at values survived the rollback / roll-forward');

  insert into public.orders (id, user_id, order_status, payment_status) values ('rf_1', t.alice(), 'confirmed', 'paid');
  insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, line_total)
  values ('33333333-0000-0000-0000-000000000001', 'rf_1', 'p1', 'Item', 1, 100, 100);
  perform t.as_user(t.admin());
  v_r := public.ship_order('rf_1', 'manual', 'RF-1');
  perform t.ok((v_r ->> 'created')::boolean, 'ship_order works after the roll-forward');
  v_r := public.mark_delivered('rf_1');
  perform t.eq(v_r ->> 'order_status', 'delivered', 'and so does mark_delivered');
  perform t.fails($q$update public.orders set order_status = 'shipped' where id = 'rf_1'$q$, '23514');
end $$;

rollback;