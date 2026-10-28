// Local Postgres harness for the migration tests.
//
// Boots ONE throw-away PostgreSQL 17 (embedded-postgres; same major.minor as the
// live server, 17.6) and gives every test group its own database cloned from a
// template (CREATE DATABASE ... TEMPLATE), so groups are isolated and fast.
// The databases imitate the parts of Supabase our SQL depends on (roles anon /
// authenticated / service_role, auth.uid() / jwt(), auth.users).
//
// Nothing here ever connects to the real Supabase project.
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = path.resolve(here, '../../migrations')
export const FIXTURES_DIR = path.resolve(here, '../fixtures')
export const INTROSPECTION_DIR = path.resolve(here, '../../introspection')

// The seven migrations written before this programme (20261006 ... 20261009) are full of NON-BREAKING SPACES (P-7: they were pasted through a chat window);
// PostgreSQL's parser rejects that character ("syntax error at or near ' '"), so SQL read for a test run has every one replaced by a plain space
// (String.fromCharCode, not a typed escape: the file-writing tools turn those into the literal character). New migrations contain none.
const NBSP = String.fromCharCode(0xa0)
export const readSql = (...parts) => fs.readFileSync(path.join(...parts), 'utf8').split(NBSP).join(' ')
export const migration = (name) => readSql(MIGRATIONS_DIR, name)

let nextPort = 54300 + Math.floor(Math.random() * 400)
let dbCounter = 0

/** Boots a cluster in a temp dir. */
export async function startCluster() {
  const port = nextPort++
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecom-pg-'))
  const server = new EmbeddedPostgres({
    databaseDir, user: 'postgres', password: 'postgres', port, persistent: false,
    // Supabase databases are UTF8; the Windows default would be WIN1252 and reject e.g. the rupee sign
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'max_connections=500', '-c', 'fsync=off', '-c', 'synchronous_commit=off'],   // test-only speedups
    onLog: () => {}, onError: () => {},
  })
  await server.initialise()
  await server.start()

  const base = { host: '127.0.0.1', port, user: 'postgres', password: 'postgres' }
  const open = new Set()
  const connect = async (database) => {
    const c = new pg.Client({ ...base, database })
    await c.connect()
    open.add(c)
    return c
  }
  const close = async (c) => { open.delete(c); try { await c.end() } catch { /* closed */ } }
  const maint = await connect('postgres')

  /** CREATE DATABASE name [TEMPLATE tmpl]; returns the name. */
  const createDb = async (name, template) => {
    await maint.query(`create database ${name}${template ? ` template ${template}` : ''}`)
    return name
  }
  /** Fresh isolated database cloned from `template`; returns { name, client, connect, drop }. */
  const clone = async (template) => {
    const name = `t${++dbCounter}_${Math.random().toString(36).slice(2, 7)}`
    await createDb(name, template)
    const client = await connect(name)
    return {
      name, client,
      connect: () => connect(name),          // extra independent connections (concurrency tests)
    }
  }
  const stop = async () => {
    for (const c of [...open]) await close(c)
    await server.stop()
    try { fs.rmSync(databaseDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  return { port, connect, close, createDb, clone, stop }
}

/** Template 1: the reconstructed live schema + the exact live create_order_tx + legacy seed data. */
export async function buildSeededTemplate(cluster, name = 'tmpl_seeded') {
  await cluster.createDb(name)
  const c = await cluster.connect(name)
  await c.query(readSql(FIXTURES_DIR, 'base_schema.sql'))
  await c.query(readSql(INTROSPECTION_DIR, 'live_create_order_tx.sql'))
  // The live RPC is service-role only (orderWriter.ts: "REVOKEd from anon/authenticated")
  await c.query(`revoke all on function public.create_order_tx(text,uuid,jsonb,text,text,text,text,text,text,text,jsonb,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,text,text) from public, anon, authenticated;
                 grant execute on function public.create_order_tx(text,uuid,jsonb,text,text,text,text,text,text,text,jsonb,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,text,text) to service_role;`)
  await c.query(readSql(FIXTURES_DIR, 'legacy_seed.sql'))
  await cluster.close(c)
  return name
}

/** Template 2: template 1 + migration M1 applied once. */
export async function buildMigratedTemplate(cluster, from = 'tmpl_seeded', name = 'tmpl_migrated') {
  const db = await cluster.clone(from)
  await db.client.query(migration('20261014_01_variants_policy_inventory.sql'))
  await cluster.close(db.client)
  await cluster.createDb(name, db.name)     // db.name has no open connections now
  return name
}

/**
 * Migration chain used to build templates. Each entry becomes a template database
 * `tmpl_<key>` = previous template + that migration. Add new migrations at the END.
 */
// tools/pg-local/PgLocal.ps1 READS this list (regex over the lines below), so keep one entry per line in exactly this shape.
export const MIGRATION_CHAIN = [
  { key: 'm1', file: '20261014_01_variants_policy_inventory.sql' },
  { key: 'm1b', file: '20261014_02_save_product_rpc.sql' },
  { key: 'm1c', file: '20261017_01_policy_defaults_guard.sql' },
  { key: 'm2', file: '20261017_02_bulk_import.sql' },
  { key: 'm3', file: '20261017_03_shipping.sql' },
  { key: 'm4', file: '20261017_04_return_requests.sql' },
  { key: 'm4b', file: '20261017_05_return_workflow.sql' },
  { key: 'm5', file: '20261017_06_refunds.sql' },
  { key: 'm5b', file: '20261017_07_exchange_fulfilment.sql' },
  { key: 'm6', file: '20261017_08_inventory_cancellation.sql' },
  { key: 'm7', file: '20261018_01_notification_events.sql' },
  { key: 'm8', file: '20261018_02_security_hardening.sql' },
]

/** Boots the cluster ONCE per process (tests run in one process via run-all.mjs) and builds all templates. */
export function sharedCluster() {
  if (!globalThis.__ecomCluster) {
    globalThis.__ecomCluster = (async () => {
      const cluster = await startCluster()
      await buildSeededTemplate(cluster)
      let prev = 'tmpl_seeded'
      for (const m of MIGRATION_CHAIN) {
        if (!fs.existsSync(path.join(MIGRATIONS_DIR, m.file))) continue
        const db = await cluster.clone(prev)
        await db.client.query(migration(m.file))
        await cluster.close(db.client)
        await cluster.createDb(`tmpl_${m.key}`, db.name)
        prev = `tmpl_${m.key}`
      }
      return cluster
    })()
  }
  return globalThis.__ecomCluster
}
export async function stopSharedCluster() {
  if (globalThis.__ecomCluster) { const c = await globalThis.__ecomCluster; globalThis.__ecomCluster = null; await c.stop() }
}

/**
 * Runs fn(client) as a Supabase-style caller in a transaction (rolled back unless commit).
 * role = 'anon' | 'authenticated' | 'service_role'; uid is exposed through
 * request.jwt.claims -> auth.uid(), exactly the way PostgREST does.
 */
export async function asRole(client, { role, uid = null, commit = false }, fn) {
  await client.query('begin')
  try {
    await client.query(`set local role ${role}`)
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role })])
    const out = await fn(client)
    await client.query(commit ? 'commit' : 'rollback')
    return out
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  }
}

/** Like asRole but resolves to {ok,value|error} so "must be denied" assertions are easy. */
export async function tryAsRole(client, opts, fn) {
  try { return { ok: true, value: await asRole(client, opts, fn) } }
  catch (error) { return { ok: false, error } }
}