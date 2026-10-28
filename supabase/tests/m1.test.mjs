// Migration M1 — behaviour tests against a REAL local PostgreSQL 17.6.
//   cd supabase/tests && npm install && npm run test:m1
//
// Every test group runs on its own database cloned from a template:
//   tmpl_seeded   = reconstructed live schema + exact live create_order_tx + legacy seed data
//   tmpl_migrated = tmpl_seeded + M1
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { sharedCluster, stopSharedCluster, migration, readSql, INTROSPECTION_DIR, asRole, tryAsRole } from './lib/pg.mjs'
import { placeOrder, item, stockOf, ALICE, BOB, ADMIN } from './lib/orders.mjs'
import { priceCartItems, applyGstToItems, collectProductIds } from '../functions/_shared/cartPricing.ts'
import { toOrderItemsJson } from '../functions/_shared/orderWriter.ts'

const M1 = '20261014_01_variants_policy_inventory.sql'
const ROLLBACK = '20261014_01_rollback.sql'

const PINK = 'var_1700000000001_0'
const WHITE = 'var_1700000000001_1'
const VIOLET = 'var_1700000000001_2'
const HOODIE_RL = 'var_1700000000002'
const HOODIE_RXL = 'var_1700000000003'
const HOODIE_BAD = 'var_1700000000004'

let cluster
const one = async (c, sql, params) => (await c.query(sql, params)).rows[0]
const rows = async (c, sql, params) => (await c.query(sql, params)).rows
const rejects = (promise, re) => assert.rejects(promise, (e) => re.test(`${e.message} ${e.code}`))

before(async () => { cluster = await sharedCluster() }, { timeout: 900000 })
after(async () => { await stopSharedCluster() })      // root-level: runs once, after ALL files in a single-process run

/* -------------------------------------------------------------------------- */
describe('P-2 — the LEGACY create_order_tx (documents the defect M1 fixes)', () => {
  let db
  before(async () => { db = await cluster.clone('tmpl_seeded') })

  it('selling a VARIANT drains the MAIN product stock and never touches the variant stock', async () => {
    const c = db.client
    assert.equal(await stockOf(c, 'prod_vmain_ok'), 10)
    await placeOrder(c, { orderId: 'legacy_t1', items: [item('prod_vmain_ok', PINK, 1, { unit: 270, discount: 10, title: 'Designer Shirt [Pink]' })] })
    assert.equal(await stockOf(c, 'prod_vmain_ok'), 9, 'legacy: main stock was decremented for a variant sale')
    const j = (await one(c, `select variants from products where id = 'prod_vmain_ok'`)).variants
    assert.equal(j.find((v) => v.id === PINK).stock, 20, 'legacy: variant stock in jsonb never changes')
    const cols = (await rows(c, `select column_name from information_schema.columns where table_name = 'order_items'`)).map((r) => r.column_name)
    assert.ok(!cols.includes('variant_id'), 'legacy order_items has no variant column')
  })
})

/* -------------------------------------------------------------------------- */
describe('M1 — applying the migration to legacy data', () => {
  let db; const notices = []
  before(async () => {
    db = await cluster.clone('tmpl_seeded')
    db.client.on('notice', (n) => notices.push(n.message))
    await db.client.query(migration(M1))
  })

  it('creates exactly the expected variant rows with their ORIGINAL ids', async () => {
    const r = await rows(db.client, `select id, product_id, name, sku, price::float8 as price, stock, status, attributes, sort_order
                                       from product_variants order by product_id, sort_order`)
    // ordered by (product_id, sort_order): prod_vmain_ok < prod_vmain_zero
    assert.deepEqual(r.map((x) => x.id), [PINK, WHITE, VIOLET, HOODIE_RL, HOODIE_RXL, HOODIE_BAD])
    const pink = r.find((x) => x.id === PINK)
    assert.deepEqual({ name: pink.name, sku: pink.sku, price: pink.price, stock: pink.stock, status: pink.status, attributes: pink.attributes },
      { name: 'Pink', sku: 'DESIGNER-SHIRT-PINK', price: 300, stock: 20, status: 'active', attributes: { Color: 'Pink' } })
    const rl = r.find((x) => x.id === HOODIE_RL)
    assert.equal(rl.price, 400, 'string "400" parsed')
    assert.equal(rl.stock, 5, 'string "5" parsed')
    assert.deepEqual(rl.attributes, { Color: 'Red', Size: 'L' }, '"Red / L" split by the product attribute names')
    const bad = r.find((x) => x.id === HOODIE_BAD)
    assert.equal(bad.price, 0); assert.equal(bad.status, 'inactive', 'unparseable price => hidden (legacy server never sold price<=0)')
    assert.ok(!r.some((x) => x.name === 'No Id Variant'), 'entry without an id is skipped, not invented')
  })

  it('reports what it did (RAISE NOTICE)', () => {
    assert.ok(notices.some((m) => /2 variant product\(s\) processed, 6 variant row\(s\) created, 1 jsonb/.test(m)), notices.join('\n'))
    assert.ok(notices.some((m) => /prod_vmain_zero.*DISABLED/.test(m)))
    assert.ok(notices.some((m) => /prod_vmain_ok.*ENABLED/.test(m)))
  })

  it('D-3: main option keeps TODAY\'s purchasability (on iff main stock > 0); singles untouched', async () => {
    const r = Object.fromEntries((await rows(db.client, `select id, main_option_enabled from products`)).map((x) => [x.id, x.main_option_enabled]))
    assert.equal(r.prod_vmain_ok, true)
    assert.equal(r.prod_vmain_zero, false)
    assert.equal(r.prod_single_a, true)
  })

  it('does not rewrite the legacy products.variants jsonb and backs it up', async () => {
    const same = await one(db.client, `select count(*)::int as n from products p join _backup_products_variants_20261014 b using (id)
                                         where p.variants = b.variants and p.has_variants = b.has_variants and p.attributes = b.attributes and p.stock = b.stock and p.price = b.price`)
    assert.equal(same.n, 6)
    assert.equal((await one(db.client, `select count(*)::int n from _backup_products_variants_20261014`)).n, 6)
  })

  it('existing price / stock / discount / title columns are untouched', async () => {
    const p = await one(db.client, `select price::float8 price, stock, discount::float8 discount, title, sku from products where id = 'prod_vmain_ok'`)
    assert.deepEqual(p, { price: 500, stock: 10, discount: 10, title: 'Designer Shirt', sku: 'DESIGNER-SHIRT' })
  })

  it('legacy products get the store policy default (return 7d / exchange 7d)', async () => {
    const p = await one(db.client, `select return_enabled, return_window_days, exchange_enabled, exchange_window_days from products where id = 'prod_single_a'`)
    assert.deepEqual(p, { return_enabled: true, return_window_days: 7, exchange_enabled: true, exchange_window_days: 7 })
    const s = await one(db.client, `select data from settings where id = 'returnPolicyDefaults'`)
    assert.equal(s.data.returnWindowDays, 7)
  })

  it('order_items: legacy rows are back-filled best-effort and flagged; money columns untouched', async () => {
    const r = Object.fromEntries((await rows(db.client, `select id, title, product_title, variant_id, variant_name, item_type, sku, unit_price::float8 unit_price, line_total::float8 line_total, mrp::float8 mrp, snapshot_source from order_items`)).map((x) => [x.id.slice(-1), x]))
    assert.deepEqual([r[1].item_type, r[1].variant_id], ['single', ''])
    assert.deepEqual([r[2].item_type, r[2].variant_id, r[2].variant_name, r[2].sku, r[2].product_title], ['variant', PINK, 'Pink', 'DESIGNER-SHIRT-PINK', 'Designer Shirt'])
    assert.equal(r[2].mrp, 300, '270 at 10% off => mrp 300')
    assert.deepEqual([r[3].item_type, r[3].variant_id], ['main', ''], 'no bracket on a variant product => main option')
    assert.deepEqual([r[4].variant_id, r[4].variant_name], [HOODIE_RL, 'Red / L'])
    assert.deepEqual([r[5].item_type, r[5].variant_id, r[5].variant_name], ['variant', '', 'Discontinued Colour'], 'unmatched bracket keeps the name, no invented id')
    assert.ok(Object.values(r).every((x) => x.snapshot_source === 'backfill'))
    assert.deepEqual([r[2].title, r[2].unit_price, r[2].line_total], ['Designer Shirt [Pink]', 270, 270], 'title/price/total never rewritten')
  })

  it('cart_items.variant_id: NULLs become empty string, NOT NULL DEFAULT \'\'', async () => {
    assert.equal((await one(db.client, `select count(*)::int n from cart_items where variant_id is null`)).n, 0)
    await db.client.query(`insert into cart_items (user_id, product_id, quantity) values ('${BOB}', 'prod_single_a', 1)`)
    assert.equal((await one(db.client, `select variant_id from cart_items where user_id = '${BOB}' and product_id = 'prod_single_a'`)).variant_id, '')
  })

  it('inventory_logs: legacy rows tagged as sales; table is append-only for API roles', async () => {
    assert.equal((await one(db.client, `select count(*)::int n from inventory_logs where movement_type = 'sale' and bucket = 'sellable'`)).n, 3)
  })

  it('policy CHECKs: positive integer days when enabled; none when disabled', async () => {
    const ins = (re, rd, ee, ed, id) => db.client.query(
      `insert into products (id, title, price, return_enabled, return_window_days, exchange_enabled, exchange_window_days) values ($1,'t',1,$2,$3,$4,$5)`, [id, re, rd, ee, ed])
    await rejects(ins(true, 0, true, 7, 'c1'), /products_return_policy_chk/)
    await rejects(ins(true, -3, true, 7, 'c2'), /products_return_policy_chk/)
    await rejects(ins(true, null, true, 7, 'c3'), /products_return_policy_chk/)
    await rejects(ins(false, 5, true, 7, 'c4'), /products_return_policy_chk/)
    await rejects(ins(true, 7, true, 366, 'c5'), /products_exchange_policy_chk/)
    await rejects(ins(true, 7, true, null, 'c8'), /products_exchange_policy_chk/)
    await rejects(ins(true, 7, false, 3, 'c9'), /products_exchange_policy_chk/)
    await ins(false, null, false, null, 'c6')          // both disabled: allowed
    await ins(true, 10, true, 365, 'c7')
  })

  it('variant policy CHECKs: NULL/NULL inherits; true needs days; false needs none; days alone are invalid', async () => {
    const upd = (set, id = 'prod_vmain_ok') => db.client.query(`update product_variants set ${set} where id = '${PINK}'`)
    await upd('return_enabled = true, return_window_days = 10')
    await upd('return_enabled = false, return_window_days = null')
    await upd('return_enabled = null, return_window_days = null')
    await rejects(upd('return_enabled = true, return_window_days = null'), /product_variants_return_policy_chk/)
    await rejects(upd('return_enabled = null, return_window_days = 5'), /product_variants_return_policy_chk/)
    await rejects(upd('return_enabled = false, return_window_days = 5'), /product_variants_return_policy_chk/)
    await rejects(upd('return_enabled = true, return_window_days = 0'), /product_variants_return_policy_chk/)
    await rejects(upd('exchange_enabled = true, exchange_window_days = null'), /product_variants_exchange_policy_chk/)
    await rejects(upd('exchange_enabled = null, exchange_window_days = 2'), /product_variants_exchange_policy_chk/)
    await upd('exchange_enabled = true, exchange_window_days = 365')
  })

  it('is idempotent: running M1 a second time changes nothing', async () => {
    const fp = async () => (await one(db.client, `
      select md5(concat_ws('#',
        (select string_agg(concat_ws('|', id, product_id, name, sku, price, stock, status, attributes::text, sort_order), ';' order by id) from product_variants),
        (select string_agg(concat_ws('|', id, main_option_enabled, stock, return_enabled, variants::text), ';' order by id) from products),
        (select string_agg(concat_ws('|', id, variant_id, item_type, snapshot_source, sku, mrp), ';' order by id) from order_items),
        (select count(*)::text from inventory_logs), (select count(*)::text from settings),
        (select count(*)::text from _backup_products_variants_20261014))) as h`)).h
    const before = await fp()
    await db.client.query(migration(M1))
    assert.equal(await fp(), before)
  })

  it('re-running M1 never overrides an admin\'s main-option choice or resurrects a deleted variant', async () => {
    await db.client.query(`update products set main_option_enabled = true where id = 'prod_vmain_zero'`)
    await db.client.query(`delete from product_variants where id = '${HOODIE_RXL}'`)
    await db.client.query(migration(M1))
    assert.equal((await one(db.client, `select main_option_enabled from products where id = 'prod_vmain_zero'`)).main_option_enabled, true)
    assert.equal((await one(db.client, `select count(*)::int n from product_variants where id = '${HOODIE_RXL}'`)).n, 0)
  })
})

/* -------------------------------------------------------------------------- */
describe('create_order_tx v2 — options, stock, snapshot, ledger', () => {
  let db, c
  before(async () => { db = await cluster.clone('tmpl_m1'); c = db.client })

  it('main option of a variant product: decrements ONLY main stock; snapshot says item_type=main with the policy', async () => {
    await c.query(`insert into cart_items (user_id, product_id, quantity, variant_id) values ('${ALICE}', 'prod_vmain_ok', 1, '')`)
    const o = await placeOrder(c, { orderId: 'o_main', items: [item('prod_vmain_ok', '', 2, { unit: 450, discount: 10, title: 'Designer Shirt' })] })
    assert.equal(o.id, 'o_main')
    assert.equal(await stockOf(c, 'prod_vmain_ok'), 8)
    assert.equal(await stockOf(c, null, PINK), 20); assert.equal(await stockOf(c, null, WHITE), 30); assert.equal(await stockOf(c, null, VIOLET), 15)
    const it1 = await one(c, `select item_type, variant_id, variant_name, product_title, sku, mrp::float8 mrp, gst_rate::float8 gst_rate, return_enabled, return_window_days, exchange_enabled, exchange_window_days, snapshot_source from order_items where order_id = 'o_main'`)
    assert.deepEqual(it1, { item_type: 'main', variant_id: '', variant_name: null, product_title: 'Designer Shirt', sku: 'DESIGNER-SHIRT', mrp: 500, gst_rate: 12, return_enabled: true, return_window_days: 7, exchange_enabled: true, exchange_window_days: 7, snapshot_source: 'order' })
    const log = await one(c, `select variant_id, change, movement_type, reason, bucket, stock_after, ref_id, actor_kind, idempotency_key from inventory_logs where order_id = 'o_main'`)
    assert.deepEqual(log, { variant_id: '', change: -2, movement_type: 'sale', reason: 'order', bucket: 'sellable', stock_after: 8, ref_id: 'o_main', actor_kind: 'user', idempotency_key: 'sale:o_main:1' })
    assert.equal((await one(c, `select count(*)::int n from cart_items where user_id = '${ALICE}'`)).n, 0, 'cart cleared as before')
    assert.equal((await one(c, `select total_quantity from product_stats where product_id = 'prod_vmain_ok'`)).total_quantity, 2)
  })

  it('variant option: decrements ONLY that variant (P-2 fixed); snapshot has variant id/name/sku/image; cache follows', async () => {
    const mainBefore = await stockOf(c, 'prod_vmain_ok')
    await placeOrder(c, { orderId: 'o_pink', items: [item('prod_vmain_ok', PINK, 3, { unit: 270, discount: 10, title: 'Designer Shirt [Pink]' })] })
    assert.equal(await stockOf(c, null, PINK), 17)
    assert.equal(await stockOf(c, 'prod_vmain_ok'), mainBefore, 'MAIN stock untouched by a variant sale')
    const it1 = await one(c, `select item_type, variant_id, variant_name, product_title, sku, image, title from order_items where order_id = 'o_pink'`)
    assert.deepEqual(it1, { item_type: 'variant', variant_id: PINK, variant_name: 'Pink', product_title: 'Designer Shirt', sku: 'DESIGNER-SHIRT-PINK', image: 'https://img.test/pink.jpg', title: 'Designer Shirt [Pink]' })
    const log = await one(c, `select variant_id, change, stock_after from inventory_logs where order_id = 'o_pink'`)
    assert.deepEqual(log, { variant_id: PINK, change: -3, stock_after: 17 })
    const cache = (await one(c, `select variants from products where id = 'prod_vmain_ok'`)).variants
    assert.equal(cache.find((v) => v.id === PINK).stock, 17, 'products.variants cache regenerated for old clients')
  })

  it('insufficient VARIANT stock -> error mapped to 409 upstream, nothing persisted (order row, stock, ledger)', async () => {
    const orders = (await one(c, `select count(*)::int n from orders`)).n
    const logs = (await one(c, `select count(*)::int n from inventory_logs`)).n
    await rejects(placeOrder(c, { orderId: 'o_fail', items: [item('prod_single_a', '', 1), item('prod_vmain_ok', VIOLET, 16)] }), /insufficient stock for product prod_vmain_ok \(variant var_1700000000001_2\)/i)
    assert.equal((await one(c, `select count(*)::int n from orders`)).n, orders)
    assert.equal((await one(c, `select count(*)::int n from inventory_logs`)).n, logs)
    assert.equal(await stockOf(c, 'prod_single_a'), 50, 'the OTHER line of the failed order was rolled back too')
    assert.equal(await stockOf(c, null, VIOLET), 15)
  })

  it('replaying the same order id is a no-op (webhook retry): one order, stock deducted once', async () => {
    const a = await placeOrder(c, { orderId: 'o_idem', items: [item('prod_single_a', '', 4)] })
    const b = await placeOrder(c, { orderId: 'o_idem', items: [item('prod_single_a', '', 4)] })
    assert.equal(a.id, b.id)
    assert.equal(await stockOf(c, 'prod_single_a'), 46)
    assert.equal((await one(c, `select count(*)::int n from order_items where order_id = 'o_idem'`)).n, 1)
  })

  it('main option disabled -> main purchase refused, variants of that product still sell', async () => {
    await rejects(placeOrder(c, { orderId: 'o_nomain', items: [item('prod_vmain_zero', '', 1)] }), /main product option no longer available/i)
    await placeOrder(c, { orderId: 'o_hood', items: [item('prod_vmain_zero', HOODIE_RL, 2, { unit: 400 })] })
    assert.equal(await stockOf(c, null, HOODIE_RL), 3)
    assert.equal(await stockOf(c, 'prod_vmain_zero'), 0)
  })

  it('inactive / unknown / foreign variant ids are rejected (tampered or stale carts)', async () => {
    await rejects(placeOrder(c, { orderId: 'o_inactive', items: [item('prod_vmain_zero', HOODIE_BAD, 1)] }), /variant no longer available/i)
    await rejects(placeOrder(c, { orderId: 'o_unknown', items: [item('prod_vmain_ok', 'var_nope', 1)] }), /variant no longer available/i)
    await rejects(placeOrder(c, { orderId: 'o_foreign', items: [item('prod_vmain_ok', HOODIE_RL, 1)] }), /variant no longer available/i)
    await rejects(placeOrder(c, { orderId: 'o_single_v', items: [item('prod_single_a', PINK, 1)] }), /variant no longer available/i)
    await rejects(placeOrder(c, { orderId: 'o_noprod', items: [item('prod_missing', '', 1)] }), /product not found/i)
    await rejects(placeOrder(c, { orderId: 'o_qty0', items: [item('prod_single_a', '', 0)] }), /invalid quantity/i)
  })

  it('same option twice in one order consumes stock twice (idempotency key includes the line index)', async () => {
    const before = await stockOf(c, 'prod_single_a')
    await placeOrder(c, { orderId: 'o_dup_line', items: [item('prod_single_a', '', 1), item('prod_single_a', '', 2)] })
    assert.equal(await stockOf(c, 'prod_single_a'), before - 3)
  })

  it('mixed cart (single + main + two variants) in one order', async () => {
    const m = await stockOf(c, 'prod_vmain_ok'); const w = await stockOf(c, null, WHITE); const s = await stockOf(c, 'prod_single_a')
    await placeOrder(c, { orderId: 'o_mixed', items: [
      item('prod_vmain_ok', WHITE, 2, { unit: 180, discount: 10 }), item('prod_single_a', '', 1), item('prod_vmain_ok', '', 1, { unit: 450 }), item('prod_vmain_ok', VIOLET, 1, { unit: 315 })] })
    assert.deepEqual([await stockOf(c, 'prod_vmain_ok'), await stockOf(c, null, WHITE), await stockOf(c, 'prod_single_a'), await stockOf(c, null, VIOLET)], [m - 1, w - 2, s - 1, 14])
    const types = (await rows(c, `select item_type from order_items where order_id = 'o_mixed' order by item_type`)).map((x) => x.item_type)
    assert.deepEqual(types, ['main', 'single', 'variant', 'variant'])
  })

  it('track_inventory = false: no check, no decrement, no ledger row — order still succeeds', async () => {
    await c.query(`insert into products (id, title, price, stock, track_inventory, sku) values ('prod_untracked', 'Service', 10, 0, false, 'SVC-1')`)
    const logs = (await one(c, `select count(*)::int n from inventory_logs`)).n
    await placeOrder(c, { orderId: 'o_untracked', items: [item('prod_untracked', '', 5)] })
    assert.equal(await stockOf(c, 'prod_untracked'), 0)
    assert.equal((await one(c, `select count(*)::int n from inventory_logs`)).n, logs)
  })

  it('variant policy override wins; unset fields inherit the product\'s; effective policy is snapshotted', async () => {
    await c.query(`update product_variants set return_enabled = false, return_window_days = null where id = '${WHITE}'`)
    await placeOrder(c, { orderId: 'o_policy', items: [item('prod_vmain_ok', WHITE, 1, { unit: 180 })] })
    const p = await one(c, `select return_enabled, return_window_days, exchange_enabled, exchange_window_days from order_items where order_id = 'o_policy'`)
    assert.deepEqual(p, { return_enabled: false, return_window_days: null, exchange_enabled: true, exchange_window_days: 7 })
    // later edits must not change the snapshot of an existing order
    await c.query(`update products set return_window_days = 30 where id = 'prod_vmain_ok'`)
    await c.query(`update product_variants set return_enabled = true, return_window_days = 14 where id = '${WHITE}'`)
    assert.deepEqual(await one(c, `select return_enabled, return_window_days from order_items where order_id = 'o_policy'`), { return_enabled: false, return_window_days: null })
  })

  it('works with a LEGACY Edge payload (no mrp / gst_rate / hsn_code keys): snapshot filled from the DB', async () => {
    await placeOrder(c, { orderId: 'o_legacy_payload', items: [item('prod_single_a', '', 1, { unit: 450, discount: 10 })] })
    const r = await one(c, `select mrp::float8 mrp, gst_rate::float8 gst_rate, hsn_code, sku from order_items where order_id = 'o_legacy_payload'`)
    assert.deepEqual(r, { mrp: 500, gst_rate: 5, hsn_code: null, sku: 'SHIRT-001' })
  })

  it('runs under the service role (what the Edge Functions use)', async () => {
    const o = await asRole(c, { role: 'service_role', commit: true }, (cl) => placeOrder(cl, { orderId: 'o_svc', items: [item('prod_single_a', '', 1)] }))
    assert.equal(o.id, 'o_svc')
  })
})

/* -------------------------------------------------------------------------- */
describe('products.variants cache + guard, compat insert, SKU rule', () => {
  let db, c
  before(async () => { db = await cluster.clone('tmpl_m1'); c = db.client })

  it('changing a variant row regenerates the legacy-shaped cache (active variants only)', async () => {
    await c.query(`update product_variants set stock = 99, price = 210 where id = '${WHITE}'`)
    await c.query(`update product_variants set status = 'inactive' where id = '${VIOLET}'`)
    const v = (await one(c, `select variants, has_variants from products where id = 'prod_vmain_ok'`))
    assert.deepEqual(v.variants.map((x) => x.id), [PINK, WHITE])
    assert.deepEqual(Object.keys(v.variants[0]).sort(), ['exchange_enabled', 'exchange_window_days', 'id', 'image', 'name', 'price', 'return_enabled', 'return_window_days', 'sku', 'stock', 'track_inventory'])
    assert.deepEqual([v.variants[0].track_inventory, v.variants[0].return_enabled], [true, null], 'untracked flag and NULL (= inherit) policy overrides are in the cache')
    assert.equal(Number(v.variants.find((x) => x.id === WHITE).price), 210)
    assert.equal(v.variants.find((x) => x.id === WHITE).stock, 99)
    assert.equal(v.has_variants, true)
  })

  it('GUARD: a direct edit of products.variants that changes it is rejected loudly; an unchanged re-save passes', async () => {
    await rejects(c.query(`update products set variants = '[]'::jsonb where id = 'prod_vmain_ok'`), /maintained from product_variants/)
    await rejects(c.query(`update products set has_variants = true where id = 'prod_single_a'`), /maintained from product_variants/)
    await c.query(`update products set variants = variants, has_variants = has_variants where id = 'prod_vmain_ok'`)   // old form re-saving identical data
    await c.query(`update products set stock = 5, price = 510, title = 'Designer Shirt v2' where id = 'prod_vmain_ok'`)     // ordinary edits unaffected
  })

  it('an OLD admin form INSERTing a variant product (jsonb only) still yields a normalised product', async () => {
    await c.query(`insert into products (id, title, price, stock, has_variants, variants, attributes)
                   values ('prod_old_form', 'Old Form Tee', 100, 5, true,
                           '[{"id":"var_old_1","name":"S","price":90,"stock":3,"sku":"OLD-S"},{"id":"var_old_2","name":"M","price":95,"stock":4,"sku":"OLD-M"}]',
                           '[{"name":"Size","options":["S","M"]}]')`)
    const r = await rows(c, `select id, name, price::float8 price, stock, attributes from product_variants where product_id = 'prod_old_form' order by sort_order`)
    assert.deepEqual(r.map((x) => [x.id, x.name, x.price, x.stock, x.attributes]), [['var_old_1', 'S', 90, 3, { Size: 'S' }], ['var_old_2', 'M', 95, 4, { Size: 'M' }]])
  })

  it('SKU uniqueness is enforced when a SKU is inserted/changed (case-insensitive, product + variant), legacy duplicates tolerated', async () => {
    await rejects(c.query(`insert into product_variants (id, product_id, name, price, sku) values ('var_x1', 'prod_single_a', 'X', 10, 'shirt-001')`), /already used by product/)
    await rejects(c.query(`insert into product_variants (id, product_id, name, price, sku) values ('var_x2', 'prod_single_a', 'X', 10, 'designer-shirt-pink')`), /already used by variant/)
    await rejects(c.query(`insert into product_variants (id, product_id, name, price, sku) values ('var_x3', 'prod_single_a', 'X', 10, 'DESIGNER-SHIRT')`), /already used by product prod_vmain_ok/)
    await rejects(c.query(`update products set sku = 'DESIGNER-SHIRT-WHITE' where id = 'prod_zero_stock'`), /already used by variant/)
    await c.query(`update products set title = 'edited' where id = 'prod_dup_sku'`)             // legacy duplicate (SHIRT-001 x2) is tolerated…
    await rejects(c.query(`update products set sku = 'SHIRT-001 ' where id = 'prod_zero_stock'`), /already used/)   // …but cannot be (re)introduced
    await c.query(`insert into product_variants (id, product_id, name, price, sku) values ('var_ok', 'prod_single_a', 'Fresh', 10, 'FRESH-1')`)
    assert.equal((await one(c, `select has_variants from products where id = 'prod_single_a'`)).has_variants, true, 'adding the first variant flips has_variants through the cache')
  })

  it('ID conventions (cart splits on "_var_"): new ids that would break it are refused; existing rows are never blocked', async () => {
    await rejects(c.query(`insert into products (id, title, price) values ('prod_x_var_y', 't', 1)`), /must not contain "_var_"/)
    await rejects(c.query(`insert into product_variants (id, product_id, name, price) values ('nopfx', 'prod_single_a', 'N', 1)`), /must start with "var_"/)
    await rejects(c.query(`insert into product_variants (id, product_id, name, price) values ('var_bad id', 'prod_single_a', 'N', 1)`), /must start with "var_"/)
    await c.query(`insert into product_variants (id, product_id, name, price, sku) values ('var_ok-1_a', 'prod_zero_stock', 'Fine', 1, 'IDOK')`)
    // a legacy row that already violates the convention must still be updatable (insert-only guard, not a CHECK)
    await c.query(`set session_replication_role = replica; insert into products (id, title, price, stock) values ('prod_a_var_b', 'legacy', 1, 5); set session_replication_role = origin;`)
    await c.query(`update products set stock = stock - 1 where id = 'prod_a_var_b'`)
    assert.equal(await stockOf(c, 'prod_a_var_b'), 4)
  })

  it('stock alerts: variant restock notifies only that variant\'s subscribers; main restock leaves variant alerts alone', async () => {
    await c.query(`insert into stock_alerts (product_id, user_id, variant_id) values ('prod_vmain_ok', '${ALICE}', ''), ('prod_vmain_ok', '${BOB}', '${PINK}')`)
    await c.query(`update product_variants set stock = 0 where id = '${PINK}'`)
    await c.query(`update product_variants set stock = 4 where id = '${PINK}'`)
    const n1 = await rows(c, `select user_id, body from notifications order by created_at`)
    assert.equal(n1.length, 1); assert.equal(n1[0].user_id, BOB); assert.match(n1[0].body, /Pink/)
    await c.query(`update products set stock = 0 where id = 'prod_vmain_ok'`)
    await c.query(`update products set stock = 3 where id = 'prod_vmain_ok'`)
    const n2 = await rows(c, `select user_id from notifications order by created_at`)
    assert.deepEqual(n2.map((x) => x.user_id), [BOB, ALICE])
  })
})

/* -------------------------------------------------------------------------- */
describe('RLS and grants', () => {
  let db, c
  before(async () => { db = await cluster.clone('tmpl_m1'); c = db.client })

  it('customers and anon see ACTIVE variants only; admin sees all', async () => {
    const ids = async (opts) => asRole(c, opts, async (cl) => (await rows(cl, `select id from product_variants where product_id = 'prod_vmain_zero' order by id`)).map((x) => x.id))
    assert.deepEqual(await ids({ role: 'anon' }), [HOODIE_RL, HOODIE_RXL])
    assert.deepEqual(await ids({ role: 'authenticated', uid: ALICE }), [HOODIE_RL, HOODIE_RXL])
    assert.deepEqual(await ids({ role: 'authenticated', uid: ADMIN }), [HOODIE_RL, HOODIE_RXL, HOODIE_BAD])
  })

  it('nobody but RPCs can write product_variants — not even an admin session', async () => {
    for (const uid of [ALICE, ADMIN]) {
      const o = { role: 'authenticated', uid }
      assert.equal((await tryAsRole(c, o, (cl) => cl.query(`insert into product_variants (id, product_id, name, price) values ('var_h', 'prod_single_a', 'H', 1)`))).ok, false)
      assert.equal((await tryAsRole(c, o, (cl) => cl.query(`update product_variants set price = 1 where id = '${PINK}'`))).ok, false)
      assert.equal((await tryAsRole(c, o, (cl) => cl.query(`delete from product_variants where id = '${PINK}'`))).ok, false)
    }
    assert.equal((await tryAsRole(c, { role: 'anon' }, (cl) => cl.query(`update product_variants set price = 1`))).ok, false)
  })

  it('ledger: admin can read, customers cannot; nobody can write via the API roles', async () => {
    await placeOrder(c, { orderId: 'o_rls', items: [item('prod_single_a', '', 1)] })
    const sel = (uid) => asRole(c, { role: 'authenticated', uid }, async (cl) => (await rows(cl, `select count(*)::int n from inventory_logs`))[0].n)
    assert.ok((await sel(ADMIN)) >= 1); assert.equal(await sel(ALICE), 0)
    assert.equal((await tryAsRole(c, { role: 'authenticated', uid: ADMIN }, (cl) => cl.query(`insert into inventory_logs (product_id, change) values ('prod_single_a', 5)`))).ok, false)
    assert.equal((await tryAsRole(c, { role: 'authenticated', uid: ADMIN }, (cl) => cl.query(`update inventory_logs set change = 0`))).ok, false)
  })

  it('apply_inventory_movement and create_order_tx are NOT callable by anon / authenticated (ACL preserved by CREATE OR REPLACE)', async () => {
    for (const o of [{ role: 'anon' }, { role: 'authenticated', uid: ADMIN }]) {
      const r1 = await tryAsRole(c, o, (cl) => cl.query(`select public.apply_inventory_movement('prod_single_a', '', 5, 'adjustment_in')`))
      assert.equal(r1.ok, false); assert.match(r1.error.message, /permission denied for function/)
      const r2 = await tryAsRole(c, o, (cl) => cl.query(`select public.create_order_tx('x', null, '[]'::jsonb, 'placed','paid','x','x','x','x','x','{}'::jsonb,0,0,0,0,0,null,0,0)`))
      assert.equal(r2.ok, false); assert.match(r2.error.message, /permission denied for function/)
    }
    const ok = await tryAsRole(c, { role: 'service_role' }, (cl) => cl.query(`select public.apply_inventory_movement('prod_single_a', '', 5, 'adjustment_in', null, null, null, 'test', null, 'admin', 'k_rls_1')`))
    assert.equal(ok.ok, true)
  })

  it('the backup table is not reachable through the API', async () => {
    for (const o of [{ role: 'anon' }, { role: 'authenticated', uid: ADMIN }]) {
      assert.equal((await tryAsRole(c, o, (cl) => cl.query(`select * from _backup_products_variants_20261014`))).ok, false)
    }
  })
})

/* -------------------------------------------------------------------------- */
describe('apply_inventory_movement — idempotency and concurrency (real parallel connections)', () => {
  let db, c
  before(async () => {
    db = await cluster.clone('tmpl_m1'); c = db.client
    await c.query(`insert into products (id, title, price, stock, sku) values ('prod_race', 'Race', 10, 1, 'RACE-1'), ('prod_p1', 'P1', 10, 1000, 'P1'), ('prod_p2', 'P2', 10, 1000, 'P2')`)
    await c.query(`insert into product_variants (id, product_id, name, price, stock, sku) values ('var_race_v', 'prod_race', 'V', 10, 5, 'RACE-V')`)
  })

  it('last unit raced by 2 connections: exactly one order wins, stock ends at 0, one ledger row', async () => {
    const [a, b] = await Promise.all([db.connect(), db.connect()])
    const res = await Promise.allSettled([
      placeOrder(a, { orderId: 'race_a', items: [item('prod_race', '', 1)] }),
      placeOrder(b, { orderId: 'race_b', items: [item('prod_race', '', 1)] })])
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1)
    const rej = res.find((r) => r.status === 'rejected')
    assert.match(rej.reason.message, /insufficient stock/i)
    assert.equal(await stockOf(c, 'prod_race'), 0)
    assert.equal((await one(c, `select count(*)::int n from inventory_logs where product_id = 'prod_race'`)).n, 1)
    assert.equal((await one(c, `select count(*)::int n from orders where id like 'race_%'`)).n, 1, 'loser left no order row')
  })

  it('variant stock 5 raced by 8 connections: exactly 5 succeed, never negative', async () => {
    const conns = await Promise.all(Array.from({ length: 8 }, () => db.connect()))
    const res = await Promise.allSettled(conns.map((cl, i) => placeOrder(cl, { orderId: `vr_${i}`, userId: null, items: [item('prod_race', 'var_race_v', 1)] })))
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 5)
    assert.ok(res.filter((r) => r.status === 'rejected').every((r) => /insufficient stock/i.test(r.reason.message)))
    assert.equal(await stockOf(c, null, 'var_race_v'), 0)
  })

  it('opposite item order in concurrent carts never deadlocks (items are locked in a fixed order)', async () => {
    const conns = await Promise.all(Array.from({ length: 10 }, () => db.connect()))
    const jobs = []
    for (let round = 0; round < 3; round++) conns.forEach((cl, i) => jobs.push(placeOrder(cl, {
      orderId: `dl_${round}_${i}`, userId: null,
      items: i % 2 ? [item('prod_p1', '', 1), item('prod_p2', '', 1)] : [item('prod_p2', '', 1), item('prod_p1', '', 1)] })))
    const res = await Promise.allSettled(jobs)
    const failed = res.filter((r) => r.status === 'rejected')
    assert.equal(failed.length, 0, failed.map((f) => f.reason.message).join('; '))
    assert.equal(await stockOf(c, 'prod_p1'), 1000 - 30); assert.equal(await stockOf(c, 'prod_p2'), 1000 - 30)
  })

  it('the same idempotency key raced 6x applies the movement once', async () => {
    const conns = await Promise.all(Array.from({ length: 6 }, () => db.connect()))
    const res = await Promise.allSettled(conns.map((cl) => cl.query(`select public.apply_inventory_movement('prod_p1', '', -7, 'adjustment_out', null, null, null, 'race', null, 'admin', 'key-once')`)))
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 6, 'replays succeed (no-op) instead of erroring')
    assert.equal(await stockOf(c, 'prod_p1'), 1000 - 30 - 7)
    assert.equal((await one(c, `select count(*)::int n from inventory_logs where idempotency_key = 'key-once'`)).n, 1)
  })

  it('unsellable bucket is ledger-only: sellable stock is not touched', async () => {
    const before = await stockOf(c, 'prod_p2')
    await c.query(`select public.apply_inventory_movement('prod_p2', '', 2, 'return_unsellable', null, 'return', 'r1', 'damaged', null, 'admin', 'k-unsell', 'unsellable')`)
    assert.equal(await stockOf(c, 'prod_p2'), before)
    assert.equal((await one(c, `select change, bucket from inventory_logs where idempotency_key = 'k-unsell'`)).bucket, 'unsellable')
  })

  it('movement guards: zero delta, bad bucket/type, unknown product or variant are rejected', async () => {
    await rejects(c.query(`select public.apply_inventory_movement('prod_p1', '', 0, 'adjustment_in')`), /non-zero/)
    await rejects(c.query(`select public.apply_inventory_movement('prod_p1', '', 1, 'adjustment_in', null,null,null,null,null,'system',null,'weird')`), /Invalid inventory bucket/)
    await rejects(c.query(`select public.apply_inventory_movement('prod_p1', '', 1, 'made_up')`), /inventory_logs_movement_chk/)
    await rejects(c.query(`select public.apply_inventory_movement('prod_nope', '', 1, 'adjustment_in')`), /Product not found/)
    await rejects(c.query(`select public.apply_inventory_movement('prod_p1', 'var_nope', 1, 'adjustment_in')`), /Variant not found/)
  })
})

/* -------------------------------------------------------------------------- */
describe('Edge pricing -> create_order_tx contract (JS and SQL agree)', () => {
  let db, c
  before(async () => { db = await cluster.clone('tmpl_m1'); c = db.client })

  // what loadPricingCatalog() hands to priceCartItems(): numbers, not Postgres numeric strings
  const load = async (ids) => {
    const prow = (await rows(c, `select * from products where id = any($1)`, [ids])).map((p) => ({
      ...p, price: Number(p.price), stock: Number(p.stock), discount: Number(p.discount), gst_rate: Number(p.gst_rate) }))
    const vrow = (await rows(c, `select id, product_id, name, sku, price, stock, track_inventory, status from product_variants where product_id = any($1)`, [ids]))
      .map((v) => ({ ...v, price: Number(v.price), stock: Number(v.stock) }))
    const variantsByProduct = new Map()
    for (const v of vrow) variantsByProduct.set(v.product_id, [...(variantsByProduct.get(v.product_id) || []), v])
    return { productsById: new Map(prow.map((p) => [p.id, p])), variantsByProduct }
  }

  it('a mixed cart priced by the Edge code is stored with a matching snapshot and moves the right counters', async () => {
    const cart = [
      { productId: 'prod_single_a', variantId: '', quantity: 1 },
      { productId: 'prod_vmain_ok', variantId: '', quantity: 1 },
      { productId: 'prod_vmain_ok', variantId: PINK, quantity: 2 },
      { productId: 'prod_vmain_ok', variantId: VIOLET, quantity: 1 },
    ]
    const { productsById, variantsByProduct } = await load(collectProductIds(cart))
    const priced = priceCartItems(cart, productsById, variantsByProduct)
    assert.ok(priced.ok, priced.error)
    const payload = toOrderItemsJson(applyGstToItems(priced.lineItems, false))
    const before = { single: await stockOf(c, 'prod_single_a'), main: await stockOf(c, 'prod_vmain_ok'), pink: await stockOf(c, null, PINK), violet: await stockOf(c, null, VIOLET) }

    await placeOrder(c, { orderId: 'contract_1', items: payload })

    const stored = await rows(c, `select item_type, variant_id, variant_name, sku, quantity, unit_price::float8 unit_price, mrp::float8 mrp, discount::float8 discount,
                                         gst_rate::float8 gst_rate, line_total::float8 line_total, title
                                    from order_items where order_id = 'contract_1' order by item_type, variant_id`)
    const byKey = (t, v) => stored.find((s) => s.item_type === t && s.variant_id === v)
    // the JS side priced these; the DB must have recorded exactly them
    for (const l of priced.lineItems) {
      const s = byKey(l.itemType, l.variantId ?? '')
      assert.ok(s, `no stored row for ${l.itemType}/${l.variantId}`)
      assert.deepEqual([s.quantity, s.unit_price, s.mrp, s.discount, s.sku ?? null, s.title], [l.quantity, l.finalPrice, l.originalPrice, l.discount, l.sku ?? null, l.title])
    }
    assert.equal(byKey('variant', PINK).variant_name, 'Pink')
    assert.equal(byKey('main', '').gst_rate, 12)
    // and exactly the chosen options' counters moved
    assert.deepEqual(
      { single: await stockOf(c, 'prod_single_a'), main: await stockOf(c, 'prod_vmain_ok'), pink: await stockOf(c, null, PINK), violet: await stockOf(c, null, VIOLET), white: await stockOf(c, null, WHITE) },
      { single: before.single - 1, main: before.main - 1, pink: before.pink - 2, violet: before.violet - 1, white: 30 })
  })

  it('what JS prices as unavailable, the RPC also refuses (defence in depth, same verdict)', async () => {
    await c.query(`update product_variants set status = 'inactive' where id = '${WHITE}'`)
    await c.query(`update products set main_option_enabled = false where id = 'prod_vmain_zero'`)
    const { productsById, variantsByProduct } = await load(['prod_vmain_ok', 'prod_vmain_zero'])
    for (const [pid, vid] of [['prod_vmain_ok', WHITE], ['prod_vmain_zero', '']]) {
      const r = priceCartItems([{ productId: pid, variantId: vid, quantity: 1 }], productsById, variantsByProduct)
      assert.equal(r.ok, false, `JS should refuse ${pid}/${vid}`)
      // bypass JS entirely (a tampered / stale client): the RPC must still say no
      await rejects(placeOrder(c, { orderId: `contract_x_${vid || 'main'}`, items: [item(pid, vid, 1)] }), /no longer available/i)
    }
  })
})

/* -------------------------------------------------------------------------- */
describe('introspection reports (the scripts you run on the live database)', () => {
  const sql = (f) => readSql(INTROSPECTION_DIR, f)

  it('01_preflight_report.sql (before M1) reports the awkward legacy data the seed contains', async () => {
    const db = await cluster.clone('tmpl_seeded')
    const p = JSON.parse((await one(db.client, sql('01_preflight_report.sql'))).preflight)
    assert.equal(p.m1_already_applied, false)
    assert.deepEqual([p.products.total, p.products.with_has_variants_true, p.products.drafts], [6, 2, 1])
    assert.equal(p.variant_entries.total, 7)
    assert.equal(p.variant_entries.missing_id_or_name_will_be_skipped, 1)
    assert.equal(p.variant_entries.unparseable_price_will_become_0_and_inactive, 1)
    assert.equal(p.variant_entries.price_stored_as_json_string, 2)
    assert.equal(p.variant_entries.stock_stored_as_json_string, 1)
    assert.equal(p.duplicate_skus.among_products.length, 1)
    assert.deepEqual(p.duplicate_skus.among_products[0].products, ['prod_dup_sku', 'prod_single_a'])
    assert.deepEqual(p.main_option_review.map((x) => [x.product_id, x.main_option_will_be]), [['prod_vmain_ok', 'ENABLED'], ['prod_vmain_zero', 'DISABLED']])
    assert.equal(p.cart_items.null_variant_id_will_become_empty_string, 1)
    assert.deepEqual([p.order_items.rows, p.order_items.title_has_bracket_suffix, p.order_items.bracket_matches_a_current_variant, p.order_items.bracket_on_variant_product_but_no_match], [6, 3, 2, 1])
    assert.equal(p.order_items.unmatched_examples[0].title, 'Hoodie [Discontinued Colour]')
    assert.equal(p.orders.guest_or_pos_orders_without_user, 1)
    assert.equal(p.p2_exposure.legacy_variant_units_sold, 3)
  })

  it('01_preflight_report.sql also runs after M1 and notices it', async () => {
    const db = await cluster.clone('tmpl_m1')
    assert.equal(JSON.parse((await one(db.client, sql('01_preflight_report.sql'))).preflight).m1_already_applied, true)
  })

  it('02_post_migration_checks.sql: every check is OK on a freshly migrated database', async () => {
    const db = await cluster.clone('tmpl_m1')
    const r = await rows(db.client, sql('02_post_migration_checks.sql'))
    const bad = r.filter((x) => !x.ok)
    assert.deepEqual(bad, [], 'failing checks: ' + JSON.stringify(bad))
    assert.ok(r.length >= 20)
    assert.match(r.find((x) => x.check_name.startsWith('info: variant products')).detail, /variant products=2, main option disabled=1/)
  })

  it('02_post_migration_checks.sql: DOES fail when something is wrong (not a rubber stamp)', async () => {
    const db = await cluster.clone('tmpl_m1')
    await db.client.query(`delete from product_variants where id = '${PINK}'`)
    await db.client.query(`grant insert on inventory_logs to authenticated`)
    await db.client.query(`drop trigger guard_products_variants_write on products`)
    const failing = (await rows(db.client, sql('02_post_migration_checks.sql'))).filter((x) => !x.ok).map((x) => x.check_name)
    assert.ok(failing.some((n) => /every valid legacy variant entry has a row/.test(n)))
    assert.ok(failing.some((n) => /cannot write inventory_logs/.test(n)))
    assert.ok(failing.some((n) => /guard \/ cache/.test(n)))
  })

  it('03_variant_stock_reconciliation.sql quantifies the P-2 drift per product and variant (and changes nothing)', async () => {
    const db = await cluster.clone('tmpl_m1')
    const before = (await one(db.client, `select md5(string_agg(stock::text, ',' order by id)) h from (select id, stock from products union all select id, stock from product_variants) s`)).h
    const rec = JSON.parse((await one(db.client, sql('03_variant_stock_reconciliation.sql'))).reconciliation)
    const ok = rec.find((x) => x.product_id === 'prod_vmain_ok')
    assert.equal(ok['legacy_units_sold_as_variants (drained main stock)'], 1)
    assert.equal(ok.main_stock_if_those_units_had_not_drained_it, 11)
    assert.deepEqual(ok.variants.find((v) => v.variant_id === PINK), { variant_id: PINK, name: 'Pink', status: 'active', stock_now: 20, legacy_units_sold: 1, stock_if_those_units_had_been_deducted: 19 })
    const hz = rec.find((x) => x.product_id === 'prod_vmain_zero')
    assert.equal(hz['legacy_units_sold_as_variants (drained main stock)'], 2, 'includes the unmatched "[Discontinued Colour]" line')
    assert.equal(hz.variants.find((v) => v.variant_id === HOODIE_RL).stock_if_those_units_had_been_deducted, 4)
    const after = (await one(db.client, `select md5(string_agg(stock::text, ',' order by id)) h from (select id, stock from products union all select id, stock from product_variants) s`)).h
    assert.equal(after, before, 'report is read-only')
  })
})

/* -------------------------------------------------------------------------- */
describe('rollback', () => {
  let db, c
  before(async () => { db = await cluster.clone('tmpl_m1'); c = db.client })

  it('restores the legacy order behaviour, removes the triggers, keeps data, and is re-runnable', async () => {
    await placeOrder(c, { orderId: 'rb_new', items: [item('prod_vmain_ok', PINK, 2, { unit: 270, discount: 10 })] })
    assert.equal(await stockOf(c, null, PINK), 18)
    await c.query(migration(ROLLBACK)); await c.query(migration(ROLLBACK))
    const trg = (await rows(c, `select tgname from pg_trigger where not tgisinternal and tgname in ('guard_products_variants_write','product_variants_cache','products_sku_unique','products_explode_on_insert','notify_variant_stock')`)).length
    assert.equal(trg, 0)
    // legacy behaviour is back: variant sale drains MAIN stock
    const main = await stockOf(c, 'prod_vmain_ok')
    await placeOrder(c, { orderId: 'rb_legacy', items: [item('prod_vmain_ok', PINK, 1, { unit: 270 })] })
    assert.equal(await stockOf(c, 'prod_vmain_ok'), main - 1)
    assert.equal(await stockOf(c, null, PINK), 18)
    // nothing was dropped
    assert.equal((await one(c, `select count(*)::int n from product_variants`)).n, 6)
    assert.equal((await one(c, `select count(*)::int n from order_items where order_id = 'rb_new' and variant_id = '${PINK}'`)).n, 1)
    // the legacy function is the exact captured text
    const def = (await one(c, `select pg_get_functiondef('public.create_order_tx(text,uuid,jsonb,text,text,text,text,text,text,text,jsonb,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,text,text)'::regprocedure) as d`)).d
    assert.match(def, /update public\.products\s+set stock = stock - \(v_item->>'quantity'\)::int/)
    assert.doesNotMatch(def, /apply_inventory_movement/)
  })
})