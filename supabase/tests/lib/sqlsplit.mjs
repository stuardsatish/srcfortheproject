// Splits a SQL script into its top-level statements the way psql does (a ';' ends a statement unless it sits inside a
// '...' string, an E'...' string, a "..." identifier, a -- comment, a /* */ comment (nestable) or a $tag$ ... $tag$ body).
//
// Why it exists: a migration is written to be pasted into the Supabase SQL Editor, and an editor is free to run the pasted
// text statement by statement (autocommit, maybe on a different session each time) instead of as ONE transaction like psql.
// M1 once failed there with  42P01 relation "_m1_exploded" does not exist  because a TEMP TABLE ... ON COMMIT DROP created by one
// statement was read by the next ones. statement_modes.test.mjs uses this splitter to prove that no migration depends on that.

/** Removes comments so a statement can be tested for "is there anything left?" / "is it BEGIN / COMMIT?". */
export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim()

/** Transaction-control statements (ignored when every statement must stand alone in autocommit). */
export const isTransactionControl = (stmt) => /^(begin|commit|end|rollback|abort|start\s+transaction)\b/i.test(stripComments(stmt))

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-�]/

export function splitSql(sql) {
  const out = []
  const n = sql.length
  let cur = ''
  let i = 0
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (ch === '-' && next === '-') {                              // -- line comment
      const j = sql.indexOf('\n', i)
      const end = j === -1 ? n : j
      cur += sql.slice(i, end)
      i = end
      continue
    }
    if (ch === '/' && next === '*') {                              // /* block comment */ (nestable)
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2 }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2 }
        else j++
      }
      cur += sql.slice(i, j)
      i = j
      continue
    }
    if (ch === "'") {                                              // '...' and E'...'
      const prev = cur.slice(-1)
      const before = cur.slice(-2, -1)
      const escapeString = (prev === 'e' || prev === 'E') && !(before && IDENT_CHAR.test(before))
      let j = i + 1
      while (j < n) {
        if (escapeString && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue } break }
        j++
      }
      cur += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '"') {                                              // "quoted identifier"
      let j = i + 1
      while (j < n) {
        if (sql[j] === '"') { if (sql[j + 1] === '"') { j += 2; continue } break }
        j++
      }
      cur += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '$') {                                              // $$ ... $$ and $tag$ ... $tag$
      const m = /^\$([A-Za-z_\u0080-�][A-Za-z0-9_\u0080-�]*)?\$/.exec(sql.slice(i, i + 80))
      const prev = cur.slice(-1)
      if (m && !(prev && IDENT_CHAR.test(prev))) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        if (close === -1) { cur += sql.slice(i); i = n; continue } // unterminated: the rest belongs to this statement
        cur += sql.slice(i, close + tag.length)
        i = close + tag.length
        continue
      }
    }
    if (ch === ';') {
      if (stripComments(cur)) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  if (stripComments(cur)) out.push(cur.trim())
  return out
}