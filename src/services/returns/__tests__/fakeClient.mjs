// Shared by the returns service tests: a chainable + awaitable stand-in for a supabase client (rpc, from(...), storage) that records every call in log.

/** chainable + awaitable stand-in for a supabase query builder */
function builder(result, log, table) {
  const b = {}
  for (const m of ['select', 'order', 'eq', 'in', 'limit', 'single', 'upsert']) b[m] = (...args) => { log.push([table, m, ...args]); return b }
  b.then = (res, rej) => Promise.resolve(result).then(res, rej)
  return b
}
export function fakeClient({ tables = {}, rpcs = {}, storage = {} } = {}) {
  const log = []
  const bucket = {
    upload: async (path, body, opts) => { log.push(['upload', path, opts]); return storage.uploadError?.(path) ? { error: storage.uploadError(path) } : { error: null } },
    remove: async (paths) => { log.push(['remove', paths]); return { error: null } },
    createSignedUrls: async (paths, exp) => { log.push(['sign', paths, exp]); return storage.signed || { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null } },
  }
  return {
    log,
    from: (t) => builder(tables[t] ?? { data: [], error: null }, log, t),
    rpc: async (name, args) => { log.push(['rpc', name, args]); const r = rpcs[name]; return typeof r === 'function' ? r(args) : (r ?? { data: null, error: null }) },
    storage: { from: (b) => { log.push(['bucket', b]); return bucket } },
  }
}
export const photo = (name, o = {}) => ({ name, type: 'image/jpeg', size: 1000, body: new Uint8Array(4), ...o })