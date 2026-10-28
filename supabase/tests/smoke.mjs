// Quick boot check for the local Postgres harness:  node smoke.mjs
import { startCluster } from './lib/pg.mjs'

const t0 = Date.now()
const c = await startCluster()
try {
  const v = await c.admin.query('select version() as v, current_setting($1) as sv', ['server_version'])
  console.log('booted in', Date.now() - t0, 'ms ->', v.rows[0].sv)
  console.log(v.rows[0].v)
  const ext = await c.admin.query(`select name from pg_available_extensions where name in ('pgcrypto','pg_trgm','uuid-ossp') order by 1`)
  console.log('available contrib extensions:', ext.rows.map((r) => r.name).join(', ') || '(none)')
} finally {
  await c.stop()
}
console.log('stopped cleanly')