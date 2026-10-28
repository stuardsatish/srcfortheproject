// Migration M1b — save_product(): the admin write path for products + variants.
//   cd supabase/tests && npm test            (boots Postgres once for all files)
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { sharedCluster, stopSharedCluster, asRole, tryAsRole, migration } from './lib/pg.mjs'
import { placeOrder, item, stockOf, ALICE, ADMIN } from './lib/orders.mjs'

let cluster
const rows = async (c, sql, params) => (await c.query(sql, params)).rows
const one = async (c, sql, params) => (await rows(c, sql, params))[0]
const rejects = (p, re) => assert.rejects(p, (e) => re.test(`${e.message} ${e.code}`))
before(async () => { cluster = await sharedCluster() }, { timeout: 900000 })
after(async () => { await stopSharedCluster() })

/** save_product(...) as the admin (what the admin web page does through PostgREST). */
const save = (c, product, variants = null, { expected = null, deleteMissing = true, uid = ADMIN, role = 'authenticated' } = {}) =>
  asRole(c, { role, uid, commit: true }, async (cl) => (await one(cl,
    `select public.save_product($1::jsonb, $2::jsonb, $3::timestamptz, $4::boolean) as r`,
    [JSON.stringify(product), variants === null ? null : JSON.stringify(variants), expected, deleteMissing])).r)

describe('save_product — create', () => {
  let db, c
  before(async () => { db = await cluster.clone('tmpl_m1b'); c = db.client })

  it('creates a SINGLE product (own price, stock, SKU, policy, tags) and logs the opening stock', async () => {
    const r = await save(c, { title: 'Classic Cotton Shirt', category: 'shirts', price: 500, stock: 50, sku: 'NEW-SHIRT-001', status: 'active',
      gst_rate: 5, tags: ['Cotton', 'cotton ', 'Summer'], return_enabled: true, return_window_days: 7, exchange_enabled: false })
    assert.equal(r.created, true); assert.match(r.id, /^prod_[0-9a-f]{14}$/)
    const p = await one(c, `select * from products where id = $1`, [r.id])
    assert.deepEqual([p.title, Number(p.price), p.stock, p.sku, p.has_variants, p.main_option_enabled, p.tags], ['Classic Cotton Shirt', 500, 50, 'NEW-SHIRT-001', false, true, ['cotton', 'summer']])
    assert.deepEqual([p.return_enabled, p.return_window_days, p.exchange_enabled, p.exchange_window_days], [true, 7, false, null])
    const led = await one(c, `select change, movement_type, reason, actor_kind, stock_after, actor_id from inventory_logs where product_id = $1`, [r.id])
    assert.deepEqual([led.change, led.movement_type, led.reason, led.actor_kind, led.stock_after, led.actor_id], [50, 'adjustment_in', 'initial stock', 'admin', 50, ADMIN])
  })

  it('creates a product WITH VARIANTS: main has its own price/stock; variants have theirs (never summed)', async () => {
    const r = await save(c, { title: 'Designer Shirt', category: 'shirts', price: 500, stock: 10, sku: 'NEW-DESIGNER-SHIRT',
      attributes: [{ name: 'Color', options: ['Pink', 'White', 'Violet'] }], return_enabled: true, return_window_days: 7, exchange_enabled: true, exchange_window_days: 5 },
      [{ name: 'Pink', sku: 'NEW-DS-PINK', price: 300, stock: 20, attributes: { Color: 'Pink' } },
       { name: 'White', sku: 'NEW-DS-WHITE', price: 200, stock: 30, return_enabled: false, exchange_enabled: true, exchange_window_days: 3 },
       { name: 'Violet', sku: 'NEW-DS-VIOLET', price: 350, stock: 15 }])
    assert.equal(r.variant_ids.length, 3)
    const p = await one(c, `select price::float8 price, stock, has_variants, main_option_enabled from products where id = $1`, [r.id])
    assert.deepEqual(p, { price: 500, stock: 10, has_variants: true, main_option_enabled: true })
    const v = await rows(c, `select name, price::float8 price, stock, sku, return_enabled, return_window_days, exchange_enabled, exchange_window_days, sort_order, attributes
                               from product_variants where product_id = $1 order by sort_order`, [r.id])
    assert.deepEqual(v.map((x) => [x.name, x.price, x.stock, x.sort_order]), [['Pink', 300, 20, 1], ['White', 200, 30, 2], ['Violet', 350, 15, 3]])
    assert.deepEqual([v[0].return_enabled, v[0].return_window_days, v[0].exchange_enabled], [null, null, null], 'unset policy = inherit the product')
    assert.deepEqual([v[1].return_enabled, v[1].return_window_days, v[1].exchange_enabled, v[1].exchange_window_days], [false, null, true, 3], 'variant overrides are independent')
    assert.deepEqual(v[0].attributes, { Color: 'Pink' })
    assert.equal((await one(c, `select count(*)::int n from inventory_logs where product_id = $1 and variant_id <> ''`, [r.id])).n, 3, 'opening stock of each variant is in the ledger')
    // the legacy cache that old clients read is current
    const cache = (await one(c, `select variants from products where id = $1`, [r.id])).variants
    assert.deepEqual(cache.map((x) => [x.name, Number(x.price), x.stock]), [['Pink', 300, 20], ['White', 200, 30], ['Violet', 350, 15]])
  })

  it('a client may pre-assign the variant ids (the admin form needs them for image paths)', async () => {
    const r = await save(c, { title: 'Pre-id Tee', category: 'tees', price: 100, stock: 1 }, [{ id: 'var_form_made_1', name: 'S', price: 90, stock: 2 }])
    assert.deepEqual(r.variant_ids, ['var_form_made_1'])
  })
})

describe('save_product — validation (server-side, the UI is never the only layer)', () => {
  let db, c
  before(async () => { db = await cluster.clone('tmpl_m1b'); c = db.client })
  const good = (o = {}) => ({ title: 'T', category: 'c', price: 10, stock: 1, ...o })

  it('required fields and ranges', async () => {
    await rejects(save(c, { category: 'c', price: 10 }), /Title is required/)
    await rejects(save(c, { title: 'T', price: 10 }), /Category is required/)
    await rejects(save(c, good({ title: '   ' })), /Title is required/)
    await rejects(save(c, good({ price: 'abc' })), /Price must be a number/)
    await rejects(save(c, good({ price: -1 })), /Price must be at least 0/)
    await rejects(save(c, good({ price: 0 })), /Price must be greater than zero/)
    await rejects(save(c, good({ discount: 150 })), /Discount % must be at most 100/)
    await rejects(save(c, good({ gst_rate: -2 })), /GST rate must be at least 0/)
    await rejects(save(c, good({ stock: 1.5 })), /Stock must be a whole number/)
    await rejects(save(c, good({ stock: -3 })), /Stock must be at least 0/)
    await rejects(save(c, good({ status: 'deleted' })), /Status must be active or draft/)
    await rejects(save(c, good({ nonsense: 1 })), /Unknown product field "nonsense"/)
    await rejects(save(c, good({ tags: 'not-a-list' })), /tags must be a list/)
    await rejects(save(c, good({ tags: Array.from({ length: 21 }, (_, i) => 't' + i) })), /at most 20/)
    assert.equal((await one(c, `select count(*)::int n from products where title = 'T'`)).n, 0, 'nothing partially created')
  })

  it('return / exchange policy: window required when ON, positive integer, none when OFF', async () => {
    await rejects(save(c, good({ return_enabled: true })), /Return window \(days\) is required/)
    await rejects(save(c, good({ return_enabled: true, return_window_days: 0 })), /Return window \(days\) must be at least 1/)
    await rejects(save(c, good({ return_enabled: true, return_window_days: -7 })), /must be at least 1/)
    await rejects(save(c, good({ return_enabled: true, return_window_days: 7.5 })), /must be a whole number/)
    await rejects(save(c, good({ return_enabled: true, return_window_days: 400 })), /must be at most 365/)
    await rejects(save(c, good({ exchange_enabled: true })), /Exchange window \(days\) is required/)
    const r = await save(c, good({ title: 'Off', return_enabled: false, return_window_days: 9, exchange_enabled: false }))
    const p = await one(c, `select return_enabled, return_window_days, exchange_enabled, exchange_window_days from products where id = $1`, [r.id])
    assert.deepEqual(p, { return_enabled: false, return_window_days: null, exchange_enabled: false, exchange_window_days: null }, 'disabled policy stores no window')
  })

  it('variant validation: name, price, status, attributes, duplicate names, policy', async () => {
    const withV = (v) => save(c, good({ title: 'V' }), [v])
    await rejects(withV({ price: 5 }), /Every variant needs a name/)
    await rejects(withV({ name: 'A' }), /needs a price/)
    await rejects(withV({ name: 'A', price: 'x' }), /Variant price must be a number/)
    await rejects(withV({ name: 'A', price: 5, status: 'gone' }), /Variant status must be active or inactive/)
    await rejects(withV({ name: 'A', price: 5, attributes: ['x'] }), /Variant attributes must be an object/)
    await rejects(withV({ name: 'A', price: 5, return_enabled: true }), /return window \(days\) is required/)
    await rejects(withV({ name: 'A', price: 5, bogus: 1 }), /Unknown variant field "bogus"/)
    await rejects(save(c, good({ title: 'V' }), [{ name: 'Pink', price: 5 }, { name: ' pink ', price: 6 }]), /Variant names must be unique/)
    assert.equal((await one(c, `select count(*)::int n from products where title = 'V'`)).n, 0, 'one bad variant rolls the whole save back')
  })

  it('something must be purchasable', async () => {
    await rejects(save(c, good({ title: 'Nope', main_option_enabled: false }), [{ name: 'A', price: 5, status: 'inactive' }]), /Nothing on this product can be bought/)
    await rejects(save(c, good({ title: 'Nope2', price: 0 }), [{ name: 'A', price: 5 }]), /main product needs a price/)
    await save(c, good({ title: 'Ok', price: 0, main_option_enabled: false }), [{ name: 'A', price: 5 }])           // main off, variant on -> fine
    await save(c, good({ title: 'Draft', price: 0, status: 'draft' }))                                            // drafts may be incomplete
  })

  it('SKU uniqueness (case-insensitive, across products and variants) is enforced through the RPC', async () => {
    await save(c, good({ title: 'S1', sku: 'SKU-A' }), [{ name: 'V', price: 5, sku: 'SKU-V' }])
    await rejects(save(c, good({ title: 'S2', sku: 'sku-a' })), /already used by product/)
    await rejects(save(c, good({ title: 'S3', sku: 'SKU-V' })), /already used by variant/)
    await rejects(save(c, good({ title: 'S4' }), [{ name: 'X', price: 5, sku: 'sku-a' }]), /already used by product/)
  })

  it('access control: only a signed-in ADMIN may call it', async () => {
    for (const o of [{ role: 'anon', uid: null }, { role: 'authenticated', uid: ALICE }]) {
      const r = await tryAsRole(c, o, (cl) => cl.query(`select public.save_product('{"title":"x","category":"c","price":1}'::jsonb)`))
      assert.equal(r.ok, false, JSON.stringify(o))
      assert.match(r.error.message, /Admin access required|permission denied/)
    }
    assert.equal((await one(c, `select count(*)::int n from products where title = 'x'`)).n, 0)
  })
})

describe('M1b migration hygiene', () => {
  it('is idempotent, and its rollback removes exactly the RPC (data and M1 untouched) and is re-runnable', async () => {
    const db = await cluster.clone('tmpl_m1b'); const c = db.client
    const r = await save(c, { title: 'Keep me', category: 'c', price: 10, stock: 3 }, [{ name: 'V', price: 5, stock: 1 }])
    await c.query(migration('20261014_02_save_product_rpc.sql'))                     // run again
    await c.query(migration('20261014_02_save_product_rpc.sql'))
    const fn = async () => (await one(c, `select count(*)::int n from pg_proc where proname in ('save_product','app_json_num','app_json_text_array') and pronamespace = 'public'::regnamespace`)).n
    assert.equal(await fn(), 3)
    await c.query(migration('20261014_02_rollback.sql')); await c.query(migration('20261014_02_rollback.sql'))
    assert.equal(await fn(), 0)
    assert.equal((await one(c, `select count(*)::int n from product_variants where product_id = $1`, [r.id])).n, 1, 'data kept')
    assert.equal((await one(c, `select count(*)::int n from pg_proc where proname = 'apply_inventory_movement'`)).n, 1, 'M1 untouched')
    await c.query(migration('20261014_02_save_product_rpc.sql'))                     // and it can be re-applied
    assert.equal(await fn(), 3)
  })
})

describe('save_product — history survives edits and deletes', () => {
  it('editing or deleting a variant AFTER an order never changes that order\'s item (snapshot)', async () => {
    const db = await cluster.clone('tmpl_m1b'); const c = db.client
    const r = await save(c, { title: 'Snap Shirt', category: 'c', price: 500, stock: 5, sku: 'SNAP-1' },
      [{ name: 'Pink', price: 300, stock: 5, sku: 'SNAP-PINK', image: 'https://img.test/pink.jpg' }])
    const vid = r.variant_ids[0]
    await placeOrder(c, { orderId: 'snap_order', items: [item(r.id, vid, 2, { unit: 300, title: 'Snap Shirt [Pink]' })] })
    const frozen = async () => one(c, `select variant_id, variant_name, product_title, sku, image, unit_price::float8 unit_price, item_type from order_items where order_id = 'snap_order'`)
    const before = await frozen()
    assert.deepEqual([before.variant_name, before.sku, before.image, before.unit_price, before.item_type], ['Pink', 'SNAP-PINK', 'https://img.test/pink.jpg', 300, 'variant'])
    // rename + re-price + re-SKU + new image
    await save(c, { id: r.id, title: 'Renamed' }, [{ id: vid, name: 'Rose', price: 999, sku: 'SNAP-ROSE', image: 'https://img.test/rose.jpg' }])
    assert.deepEqual(await frozen(), before, 'edit does not rewrite history')
    // delete the variant entirely (and the whole product)
    await save(c, { id: r.id }, [])
    assert.deepEqual(await frozen(), before, 'variant delete does not rewrite history')
    await c.query(`delete from products where id = $1`, [r.id])
    assert.deepEqual(await frozen(), before, 'product delete does not rewrite history (order_items has no FK to products)')
  })
})

describe('save_product — editing, concurrency, stock deltas', () => {
  let db, c, id, vids
  before(async () => {
    db = await cluster.clone('tmpl_m1b'); c = db.client
    const r = await save(c, { title: 'Designer Shirt', category: 'shirts', price: 500, stock: 10, sku: 'DS' },
      [{ name: 'Pink', price: 300, stock: 20, sku: 'DS-P' }, { name: 'White', price: 200, stock: 30, sku: 'DS-W' }])
    id = r.id; vids = r.variant_ids
  })

  it('THE motivating bug: a stale admin page can no longer overwrite stock sold in the meantime', async () => {
    // admin A opens the edit page: sees main 10, Pink 20
    const seen = await one(c, `select updated_at from products where id = $1`, [id])
    // meanwhile customers buy 3 Pink and 2 of the main product
    await placeOrder(c, { orderId: 'concurrent_1', items: [item(id, vids[0], 3, { unit: 300 }), item(id, '', 2, { unit: 500 })] })
    assert.deepEqual([await stockOf(c, id), await stockOf(c, null, vids[0])], [8, 17])
    // admin A saves a price/title change plus "stock: 25 for Pink" (they intended +5) using the values they SAW
    await save(c, { id, title: 'Designer Shirt (new)', stock: 12, stock_expected: 10 },
      [{ id: vids[0], name: 'Pink', price: 310, stock: 25, stock_expected: 20 }, { id: vids[1], name: 'White', price: 200 }],
      { expected: seen.updated_at })
    assert.equal(await stockOf(c, id), 10, 'main: 8 (after the sale) + 2 intended  — not overwritten with 12')
    assert.equal(await stockOf(c, null, vids[0]), 22, 'Pink: 17 (after the sale) + 5 intended — not overwritten with 25')
    const ledger = await rows(c, `select variant_id, change, movement_type, actor_kind from inventory_logs where movement_type like 'adjustment%' and reason = 'admin edit' order by created_at`)
    assert.deepEqual(ledger.map((l) => [l.variant_id, l.change, l.movement_type, l.actor_kind]), [['', 2, 'adjustment_in', 'admin'], [vids[0], 5, 'adjustment_in', 'admin']])
    assert.equal((await one(c, `select price::float8 p from product_variants where id = $1`, [vids[0]])).p, 310)
  })

  it('an edit that needs MORE stock removed than exists says so (stock changed), instead of going negative', async () => {
    await rejects(save(c, { id, stock: 0, stock_expected: 100 }), /Stock changed while you were editing/)
    await rejects(save(c, { id }, [{ id: vids[1], name: 'White', price: 200, stock: 0, stock_expected: 500 }, { id: vids[0], name: 'Pink', price: 310 }]), /Stock of variant "White" changed/)
    assert.equal(await stockOf(c, id), 10)
  })

  it('optimistic concurrency on content: a second admin with an old page is told to reload', async () => {
    const mine = await one(c, `select updated_at from products where id = $1`, [id])
    await save(c, { id, brand: 'Acme' }, null, { expected: mine.updated_at })               // first admin wins
    await rejects(save(c, { id, brand: 'Other' }, null, { expected: mine.updated_at }), /changed by someone else/)
    assert.equal((await one(c, `select brand from products where id = $1`, [id])).brand, 'Acme')
  })

  it('stock changes by SALES do not invalidate an admin\'s open page (they are not content)', async () => {
    const seen = await one(c, `select updated_at from products where id = $1`, [id])
    await placeOrder(c, { orderId: 'concurrent_2', items: [item(id, '', 1, { unit: 500 })] })
    await save(c, { id, brand: 'Acme2' }, null, { expected: seen.updated_at })              // still accepted
  })

  it('p_variants = NULL leaves variants alone; an array makes the table match it exactly (delete missing)', async () => {
    await save(c, { id, badge: 'New' })
    assert.equal((await one(c, `select count(*)::int n from product_variants where product_id = $1`, [id])).n, 2)
    await save(c, { id }, [{ id: vids[0], name: 'Pink', price: 310 }, { name: 'Green', price: 250, stock: 4, sku: 'DS-G' }])
    const v = await rows(c, `select name from product_variants where product_id = $1 order by sort_order`, [id])
    assert.deepEqual(v.map((x) => x.name), ['Pink', 'Green'], 'White removed, Green added, Pink kept')
    // keep-missing mode adds without deleting
    await save(c, { id }, [{ name: 'Blue', price: 260, sku: 'DS-B' }], { deleteMissing: false })
    assert.deepEqual((await rows(c, `select name from product_variants where product_id = $1 order by sort_order, name`, [id])).map((x) => x.name).sort(), ['Blue', 'Green', 'Pink'])
  })

  it('removing every variant turns the product back into a single product', async () => {
    await save(c, { id }, [])
    const p = await one(c, `select has_variants, variants from products where id = $1`, [id])
    assert.deepEqual([p.has_variants, p.variants], [false, []])
  })

  it('a variant id of ANOTHER product is refused', async () => {
    const other = await save(c, { title: 'Other', category: 'c', price: 5 }, [{ name: 'Z', price: 5 }])
    await rejects(save(c, { id }, [{ id: other.variant_ids[0], name: 'Hijack', price: 5 }]), /belongs to another product/)
  })

  it('untracked inventory: stock is not required and not decremented by sales', async () => {
    const r = await save(c, { title: 'Service', category: 'svc', price: 99, track_inventory: false, stock: 0 })
    await placeOrder(c, { orderId: 'svc_1', items: [item(r.id, '', 5, { unit: 99 })] })
    assert.equal(await stockOf(c, r.id), 0)
  })

  it('the old direct-write path is closed for variants: editing products.variants as admin is refused by the guard', async () => {
    const r = await save(c, { title: 'Guarded', category: 'c', price: 10, stock: 1 }, [{ name: 'A', price: 5, stock: 2 }])   // a product that HAS variants
    await rejects(asRole(c, { role: 'authenticated', uid: ADMIN, commit: true }, (cl) => cl.query(`update products set variants = '[]'::jsonb where id = $1`, [r.id])), /maintained from product_variants/)
    assert.equal((await rows(c, `select 1 from product_variants where product_id = $1`, [r.id])).length, 1, 'variants untouched')
  })
})