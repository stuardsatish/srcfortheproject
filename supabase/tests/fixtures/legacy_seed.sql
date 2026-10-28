-- ============================================================================
-- legacy_seed.sql — TEST DATA imitating the shapes found in the live database.
-- Deliberately includes the awkward cases the audit found so the migration is
-- proven on them, not only on tidy data.
-- ============================================================================

-- users: two customers + one admin ------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'bob@example.test'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.test');
insert into public.profiles (id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Alice', 'alice@example.test', 'user'),
  ('00000000-0000-0000-0000-0000000000a2', 'Bob',   'bob@example.test',   'user'),
  ('00000000-0000-0000-0000-0000000000ad', 'Admin', 'admin@example.test', 'admin');

-- products ------------------------------------------------------------------------
-- S1: plain single product
insert into public.products (id, title, category, brand, price, stock, sku, gst_rate, thumbnail, status, has_variants, variants, attributes)
values ('prod_single_a', 'Classic Cotton Shirt', 'shirts', 'Acme', 500, 50, 'SHIRT-001', 5, 'https://img.test/shirt-001.jpg', 'active', false, '[]', '{}');

-- V1: tidy variant product — main has its OWN price/stock, variants have theirs. Discount 10 % (future expiry)
insert into public.products (id, title, category, price, stock, sku, gst_rate, discount, discount_expiry, thumbnail, status, has_variants, variants, attributes)
values ('prod_vmain_ok', 'Designer Shirt', 'shirts', 500, 10, 'DESIGNER-SHIRT', 12, 10, now() + interval '30 days',
        'https://img.test/designer.jpg', 'active', true,
        '[{"id":"var_1700000000001_0","name":"Pink","price":300,"stock":20,"sku":"DESIGNER-SHIRT-PINK","image":"https://img.test/pink.jpg"},
          {"id":"var_1700000000001_1","name":"White","price":200,"stock":30,"sku":"DESIGNER-SHIRT-WHITE","image":""},
          {"id":"var_1700000000001_2","name":"Violet","price":350,"stock":15,"sku":"DESIGNER-SHIRT-VIOLET","image":""}]',
        '[{"name":"Color","options":["Pink","White","Violet"]}]');

-- V2: messy legacy variant product — main stock 0 (=> main option must be switched OFF by the migration),
--     string numerics, an entry without id, a non-numeric price, two attributes (name "Red / L")
insert into public.products (id, title, category, price, stock, sku, thumbnail, status, has_variants, variants, attributes)
values ('prod_vmain_zero', 'Hoodie', 'hoodies', 999, 0, 'HOODIE', 'https://img.test/hoodie.jpg', 'active', true,
        '[{"id":"var_1700000000002","name":"Red / L","price":"400","stock":"5","sku":"HOODIE-R-L","image":""},
          {"id":"var_1700000000003","name":"Red / XL","price":450,"stock":0,"sku":"HOODIE-R-XL"},
          {"name":"No Id Variant","price":100,"stock":1},
          {"id":"var_1700000000004","name":"Broken Price","price":"abc","stock":2,"sku":"HOODIE-BAD"}]',
        '[{"name":"Color","options":["Red"]},{"name":"Size","options":["L","XL"]}]');

-- D1: legacy DUPLICATE SKU of S1 (the live app never enforced uniqueness)
insert into public.products (id, title, category, price, stock, sku, status)
values ('prod_dup_sku', 'Classic Cotton Shirt (copy)', 'shirts', 450, 4, 'SHIRT-001', 'active');

-- Z1: single product with zero stock; Dr: draft product
insert into public.products (id, title, category, price, stock, sku, status) values
  ('prod_zero_stock', 'Sold Out Mug', 'mugs', 150, 0, 'MUG-1', 'active'),
  ('prod_draft',      'Unreleased Item', 'misc', 99, 5, 'DRAFT-1', 'draft');

-- orders (legacy shape: NO variant columns; the variant lives in the title) -------------
insert into public.orders (id, user_id, order_status, payment_status, payment_method, source, customer_name, subtotal, shipping, total, promo_discount, created_at, updated_at)
values
  ('order_legacy_1', '00000000-0000-0000-0000-0000000000a1', 'delivered', 'paid',    'Razorpay', 'online', 'Alice', 1450, 0,  1400, 50, now() - interval '20 days', now() - interval '15 days'),
  ('cod_legacy_2',   '00000000-0000-0000-0000-0000000000a2', 'shipped',   'pending', 'COD',      'online', 'Bob',    400,  49, 449,  0,  now() - interval '3 days',  now() - interval '1 day'),
  ('bill_legacy_3',  null,                                   'delivered', 'paid',    'Cash',     'billing','Walk-in', 500, 0,  500,  0,  now() - interval '40 days', now() - interval '40 days');

insert into public.order_items (id, order_id, product_id, title, quantity, unit_price, discount, cgst, sgst, igst, line_total) values
  ('11111111-1111-1111-1111-000000000001', 'order_legacy_1', 'prod_single_a',     'Classic Cotton Shirt',        2, 500, 0,  11.9, 11.9, 0, 1000),
  ('11111111-1111-1111-1111-000000000002', 'order_legacy_1', 'prod_vmain_ok',  'Designer Shirt [Pink]',       1, 270, 10, 14.5, 14.5, 0, 270),
  ('11111111-1111-1111-1111-000000000003', 'order_legacy_1', 'prod_vmain_ok',  'Designer Shirt',              1, 450, 10, 24.1, 24.1, 0, 450),
  ('11111111-1111-1111-1111-000000000004', 'cod_legacy_2',   'prod_vmain_zero','Hoodie [Red / L]',            1, 400, 0,  0, 0, 0, 400),
  ('11111111-1111-1111-1111-000000000005', 'cod_legacy_2',   'prod_vmain_zero','Hoodie [Discontinued Colour]',1, 400, 0,  0, 0, 0, 400),
  ('11111111-1111-1111-1111-000000000006', 'bill_legacy_3',  'prod_single_a',     'Classic Cotton Shirt',        1, 500, 0,  11.9, 11.9, 0, 500);

-- carts: one NULL variant_id row (live column is nullable), one '' row, one variant row ---
insert into public.cart_items (user_id, product_id, quantity, title, price, variant_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'prod_single_a',    1, 'Classic Cotton Shirt', 500, null),
  ('00000000-0000-0000-0000-0000000000a2', 'prod_zero_stock',  1, 'Sold Out Mug',        150, '');
insert into public.cart_items (user_id, product_id, quantity, title, price, variant_id, variant_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'prod_vmain_ok', 2, 'Designer Shirt', 300, 'var_1700000000001_0', 'Pink');

-- ledger rows the live app already wrote ------------------------------------------------
insert into public.inventory_logs (product_id, change, reason, order_id) values
  ('prod_single_a',    -2, 'order', 'order_legacy_1'),
  ('prod_vmain_ok', -1, 'order', 'order_legacy_1'),
  ('prod_vmain_ok', -1, 'order', 'order_legacy_1');

-- settings --------------------------------------------------------------------------------
insert into public.settings (id, data) values ('shippingSettings', '{"freeShippingThreshold":500,"shippingCost":49}');