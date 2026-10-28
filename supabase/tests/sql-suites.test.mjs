// Runs every  tests/sql/*.test.sql  against a clone of a migrated template database (real PostgreSQL 17.6).
//   cd supabase/tests && node run-all.mjs sql-suites         (or as part of the full  npm test)
//
// The assertions live in plain .sql files so that ONE copy serves two runners: this file, and
// tools/pg-local/Invoke-SqlSuites.ps1 (used on a machine without Node.js). Directives in a test's header comments:
//   -- needs: <key>        template to clone: tmpl_<key>, key from MIGRATION_CHAIN in lib/pg.mjs (default: the LAST one)
//   -- reapply: <file>     apply this migration file a second time first (idempotency test)  — may be repeated
//   -- setup: <file>       run this SQL file (under tests/sql/, e.g. setup/exchange_in_flight.sql) FIRST — after _helpers.sql, before any
//                          -- reapply: — to build a state that a rollback / re-apply then acts on  — may be repeated
// A test passes when its script runs to the end without an error (see sql/_helpers.sql for the t.* assertions).
import { describe, it, before, after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharedCluster, stopSharedCluster, migration, MIGRATION_CHAIN } from './lib/pg.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, 'sql')
const helpers = fs.readFileSync(path.join(dir, '_helpers.sql'), 'utf8')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.sql')).sort()

let cluster
before(async () => { cluster = await sharedCluster() }, { timeout: 900000 })
after(async () => { await stopSharedCluster() })      // root-level: runs once, after ALL files in a single-process run

describe('SQL suites (tests/sql/*.test.sql)', () => {
  for (const file of files) {
    it(file, { timeout: 300000 }, async () => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      const needs = /^--\s*needs:\s*(\S+)/m.exec(sql)?.[1] || MIGRATION_CHAIN[MIGRATION_CHAIN.length - 1].key
      const reapply = [...sql.matchAll(/^--\s*reapply:\s*(\S+)/gm)].map((m) => m[1])
      const setup = [...sql.matchAll(/^--\s*setup:\s*(\S+)/gm)].map((m) => m[1])
      const db = await cluster.clone(`tmpl_${needs}`)
      try {
        if (setup.length) {
          await db.client.query(helpers)
          for (const s of setup) await db.client.query(fs.readFileSync(path.join(dir, s), 'utf8'))
        }
        for (const m of reapply) await db.client.query(migration(m))
        await db.client.query(helpers)
        await db.client.query(sql)
      } finally {
        await cluster.close(db.client)
      }
    })
  }
})