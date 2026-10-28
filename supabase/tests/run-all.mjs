// Runs every *.test.mjs in ONE node process so the local PostgreSQL boots once (~110 s on Windows)
// instead of once per file.   cd supabase/tests && npm test
//   npm test                       all files
//   node run-all.mjs m1 pricing    only files whose name contains one of the words
//
// It simply launches Node's own runner in single-process mode; the shared cluster is stopped by the root-level
// `after(stopSharedCluster)` hook that every DB test file registers (lib/pg.mjs), so the process ends by itself.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const filters = process.argv.slice(2)
const files = fs.readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs') && (!filters.length || filters.some((w) => f.includes(w))))
  .sort()

if (!files.length) { console.error('no test files match', filters); process.exit(2) }
const r = spawnSync(process.execPath,
  ['--test', '--test-isolation=none', '--test-concurrency=1', '--test-timeout=1200000', ...files],
  { cwd: here, stdio: 'inherit' })
process.exit(r.status ?? 1)