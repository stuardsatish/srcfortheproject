// A migration is pasted into the Supabase SQL Editor, and an editor is free to run the pasted text STATEMENT BY STATEMENT
// (each in autocommit, possibly on a different session) instead of as one transaction like psql does.
// That is exactly how M1 broke on the first real run:  42P01 relation "_m1_exploded" does not exist  (a TEMP TABLE ... ON COMMIT DROP
// created by one statement and read by the next ones).
//
// This file applies the WHOLE migration chain M1 ... M8 three ways and proves they end in the same database:
//   single        the script as ONE multi-statement query (what psql / this harness has always done; the reference = tmpl_m8)
//   same-session  every top-level statement as its own query on ONE connection, BEGIN / COMMIT dropped (autocommit)
//   new-session   every top-level statement on a BRAND-NEW connection (no session state can survive: temp tables, SET, prepared plans ...)
// Any migration that carries state from one statement to the next fails the autocommit modes; a migration that behaves differently
// without its surrounding transaction ends in a different catalogue / different data and fails the comparison.
//
//   cd supabase/tests && node run-all.mjs statement_modes
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { sharedCluster, stopSharedCluster, migration, MIGRATION_CHAIN } from './lib/pg.mjs'
import { splitSql, isTransactionControl, stripComments } from './lib/sqlsplit.mjs'

after(async () => { await stopSharedCluster() })

describe('splitSql (the statement splitter the modes below rely on)', () => {
  it('splits at top-level semicolons only', () => {
    const sql = `select 1; select ';' as s; -- a; comment\n select "a;b" from t; /* x; /* nested; */ y; */ select 2`
    assert.deepEqual(splitSql(sql), ['select 1', "select ';' as s", '-- a; comment\n select "a;b" from t', '/* x; /* nested; */ y; */ select 2'])
  })
  it('keeps dollar-quoted bodies whole (function bodies, DO blocks, custom tags)', () => {
    const sql = `create function f() returns int language plpgsql as $$ begin perform 1; return 2; end; $$;
                 do $fn$ begin raise notice 'a;b'; end $fn$;
                 select $q$ it's; ok $q$;`
    const parts = splitSql(sql)
    assert.equal(parts.length, 3)
    assert.match(parts[0], /return 2; end; \$\$$/)
    assert.match(parts[1], /^do \$fn\$ begin raise notice 'a;b'; end \$fn\$$/)
    assert.match(parts[2], /\$q\$ it's; ok \$q\$$/)
  })
  it('understands escaped quotes, E-strings, empty tails and comment-only tails', () => {
    assert.deepEqual(splitSql(`select 'it''s;'; select E'a\\';b'; -- the end\n`), [`select 'it''s;'`, `select E'a\\';b'`])
    assert.deepEqual(splitSql('  ;; select 1 ;  ;'), ['select 1'])
  })
  it('recognises transaction control, comments in front included', () => {
    for (const s of ['begin', 'BEGIN', '-- x\ncommit', 'end', 'rollback', 'start transaction']) assert.equal(isTransactionControl(s), true, s)
    for (const s of ['select 1', 'do $$ begin end $$', 'create table beginning (a int)', 'alter table t add column endx int']) assert.equal(isTransactionControl(s), false, s)
    assert.equal(stripComments('/* a */ -- b\n'), '')
  })
  it('every migration of the chain splits into stable, non-empty statements (re-splitting the pieces changes nothing)', () => {
    for (const m of MIGRATION_CHAIN) {
      const parts = splitSql(migration(m.file))
      assert.ok(parts.length > 3, `${m.file}: ${parts.length} statements`)
      for (const p of parts) assert.ok(stripComments(p).length > 0, `${m.file}: an empty statement`)
      assert.deepEqual(splitSql(parts.map((p) => `${p};`).join('\n')), parts, `${m.file}: splitting is not stable`)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
let cluster
before(async () => { cluster = await sharedCluster() }, { timeout: 900000 })

/** Applies the whole chain to a fresh clone of the legacy-seeded template. */
async function applyChain(mode) {
  const db = await cluster.clone('tmpl_seeded')
  for (const m of MIGRATION_CHAIN) {
    const sql = migration(m.file)
    let n = 0
    for (const stmt of splitSql(sql)) {
      if (isTransactionControl(stmt)) continue
      n++
      let c = db.client
      try {
        if (mode === 'new-session') c = await db.connect()
        await c.query(stmt)
      } catch (e) {
        e.message = `[${mode}] ${m.file}, statement #${n}: ${e.message}\n---- statement ----\n${stmt.slice(0, 400)}`
        throw e
      } finally {
        if (mode === 'new-session') await cluster.close(c)
      }
    }
  }
  return db
}

/** A comparable picture of the database: catalogue + the data the migrations touch (no timestamps, no generated ids). */
async function fingerprint(client) {
  const q = async (sql) => (await client.query(sql)).rows
  const sections = {
    columns: await q(`select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') as dflt, coalesce(is_identity, '') as ident
                        from information_schema.columns where table_schema = 'public' order by 1, 2`),
    constraints: await q(`select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
                            from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`),
    indexes: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`),
    triggers: await q(`select tgrelid::regclass::text as tbl, tgname, tgenabled, pg_get_triggerdef(oid) as def
                         from pg_trigger where not tgisinternal order by 1, 2`),
    functions: await q(`select p.proname, pg_get_function_identity_arguments(p.oid) as args, md5(pg_get_functiondef(p.oid)) as def_md5, p.prosecdef, p.proacl::text as acl
                          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') order by 1, 2`),
    tables: await q(`select relname, relrowsecurity, relacl::text as acl from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'S') order by 1`),
    policies: await q(`select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`),
    products: await q(`select id, has_variants, main_option_enabled, track_inventory, stock, return_enabled, return_window_days, variants::text as variants from public.products order by id`),
    variants: await q(`select id, product_id, name, sku, price, stock, status, sort_order, attributes::text as attrs from public.product_variants order by id`),
    order_items: await q(`select count(*)::int as n, md5(coalesce(string_agg(concat_ws('|', order_id, product_id, variant_id, coalesce(variant_name, ''), coalesce(item_type, ''),
                                 coalesce(sku, ''), coalesce(mrp::text, ''), snapshot_source), ';' order by order_id, product_id, variant_id, title), '')) as md5 from public.order_items`),
    ledger: await q(`select coalesce(movement_type, '-') as movement_type, bucket, count(*)::int as n, sum(change)::int as qty from public.inventory_logs group by 1, 2 order by 1, 2`),
    settings: await q(`select id, data::text as data from public.settings order by id`),
    cart_null_variants: await q(`select count(*)::int as n from public.cart_items where variant_id is null`),
    backup_rows: await q(`select count(*)::int as n from public._backup_products_variants_20261014`),
  }
  return sections
}

describe('the whole migration chain, applied statement by statement', () => {
  let reference
  before(async () => {
    const db = await cluster.clone('tmpl_m8')              // built by the harness from the same files, as one script each
    reference = await fingerprint(db.client)
    await cluster.close(db.client)
  }, { timeout: 300000 })

  for (const mode of ['same-session', 'new-session']) {
    it(`${mode}: applies without a single error and ends in the same database as the one-script run`, { timeout: 900000 }, async () => {
      const db = await applyChain(mode)
      const got = await fingerprint(db.client)
      await cluster.close(db.client)
      for (const section of Object.keys(reference)) assert.deepEqual(got[section], reference[section], `[${mode}] ${section} differs from the one-script run`)
    })
  }

  it('the legacy variant products were exploded (M1 step 5) and their main option follows the stock (D-3), in every mode', async () => {
    assert.ok(reference.variants.length > 0, 'the legacy seed has variant products, so product_variants must not be empty')
    const legacy = reference.products.filter((p) => p.has_variants)
    assert.ok(legacy.length > 0)
    for (const p of legacy) {
      const hadVariants = reference.variants.some((v) => v.product_id === p.id)
      if (hadVariants && !p.main_option_enabled) assert.ok(p.stock <= 0, `${p.id}: main option off only when its stock is 0`)
    }
  })
})