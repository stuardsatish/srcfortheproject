// The import REPORT (BULK_UPLOAD_TEMPLATE_GUIDE §7): on screen, downloadable as .xlsx and .json (and .csv).
// Pure (no DOM) -> unit-tested: __tests__/report.test.mjs.
//   Header block: file name + SHA-256, started / finished (IST), counts, batch id, operator.
//   Rows:         Row · Import ID · Type · Result (created | unchanged | error | skipped) · Product ID · Variant ID · Images saved · Messages
// Every user-supplied string that is echoed into the spreadsheet / CSV goes through escapeForSpreadsheet() (CSV / formula injection).
import { escapeForSpreadsheet } from './normalize.js'
import { buildXlsx } from './xlsxWriter.js'

export const REPORT_COLUMNS = ['Row', 'Import ID', 'Type', 'Result', 'Product ID', 'Variant ID', 'Images saved', 'Messages']

/** 2026-10-17T10:15:00Z -> "2026-10-17 15:45:00 IST" (the store's timezone, whatever the admin's computer is set to) */
export function formatIst(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000)
  return `${ist.toISOString().slice(0, 19).replace('T', ' ')} IST`
}

/**
 * validation: result of validateImport();  stage: the import_stage_batch document (or null);  commit: the import_commit_batch document (or null)
 * Result of a row: created / unchanged (from the server), error (any problem on the row, or the server's), skipped (valid, but the file
 * as a whole was not imported — one error anywhere means nothing is imported).
 */
export function buildReport({ fileName = '', fileHash = '', operator = '', startedAt = new Date(), finishedAt = new Date(), validation, stage = null, commit = null, imagesByKey = new Map() }) {
  const issuesByRow = new Map()
  for (const i of validation?.issues || []) {
    if (!issuesByRow.has(i.row)) issuesByRow.set(i.row, [])
    issuesByRow.get(i.row).push(i)
  }
  const serverErrorsByKey = new Map()
  for (const e of stage?.errors || []) {
    const k = String(e.import_key || '').toLowerCase()
    if (!serverErrorsByKey.has(k)) serverErrorsByKey.set(k, [])
    serverErrorsByKey.get(k).push(e)
  }
  const stageByKey = new Map((stage?.groups || []).map((g) => [String(g.import_key).toLowerCase(), g]))
  const created = new Map()                      // lower import key -> { productId, variantId }
  for (const r of commit?.report || []) {
    created.set(String(r.import_key).toLowerCase(), { productId: r.product_id, variantId: '' })
    for (const v of r.variants || []) created.set(String(v.import_key).toLowerCase(), { productId: r.product_id, variantId: v.id })
  }
  // variant row -> parent group, to say "unchanged" for the variants of an unchanged product
  const parentOf = new Map()
  for (const g of validation?.groups || []) for (const v of g.variants) parentOf.set(String(v.import_key).toLowerCase(), String(g.import_key).toLowerCase())

  const committed = !!commit?.ok
  const rows = (validation?.rows || []).map((r) => {
    const key = String(r.importId).toLowerCase()
    const own = issuesByRow.get(r.row) || []
    const errors = own.filter((i) => i.severity === 'error')
    const messages = own.filter((i) => i.severity !== 'info').map((i) => `${i.code}: ${i.message}`)
    const groupKey = parentOf.get(key) || key
    const serverErrs = serverErrorsByKey.get(groupKey) || serverErrorsByKey.get(key) || []
    for (const e of serverErrs) messages.push(`${e.code}: ${e.message}`)
    let result = 'skipped'
    let ids = { productId: '', variantId: '' }
    if (errors.length || serverErrs.length) result = 'error'
    else if (committed && created.has(key)) { result = 'created'; ids = created.get(key) }
    else if (stageByKey.get(groupKey)?.status === 'unchanged') { result = 'unchanged'; ids = { productId: stageByKey.get(groupKey).product_id || '', variantId: '' } }
    else if (committed) result = 'skipped'
    return [r.row, r.importId, r.type, result, ids.productId, ids.variantId, imagesByKey.get(key) ?? '', messages.join(' | ')]
  })

  const count = (result) => rows.filter((r) => r[3] === result).length
  const header = [
    ['File', fileName],
    ['SHA-256', fileHash],
    ['Started', formatIst(startedAt)],
    ['Finished', formatIst(finishedAt)],
    ['Operator', operator],
    ['Batch', commit?.batch_id || stage?.batch_id || ''],
    ['Rows read', validation?.summary?.rows ?? rows.length],
    ['Products', validation?.summary?.products ?? 0],
    ['Variants', validation?.summary?.variants ?? 0],
    ['Images', validation?.summary?.images ?? 0],
    ['Created', count('created')],
    ['Unchanged', count('unchanged')],
    ['Errors', (validation?.counts?.errors || 0) + (stage?.errors?.length || 0)],
    ['Warnings', validation?.counts?.warnings || 0],
    ['Outcome', committed ? (commit.already ? 'Imported earlier (nothing repeated)' : 'Imported') : stage?.status === 'unchanged' ? 'Nothing to import (all unchanged)' : 'NOT imported'],
  ]
  return { header, columns: REPORT_COLUMNS, rows, counts: { created: count('created'), unchanged: count('unchanged'), error: count('error'), skipped: count('skipped') } }
}

const safe = (v) => (typeof v === 'string' ? escapeForSpreadsheet(v) : v)

export function reportToCsv(report) {
  const q = (v) => { const s = String(safe(v) ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = [
    ...report.header.map(([k, v]) => [k, v].map(q).join(',')),
    '',
    report.columns.map(q).join(','),
    ...report.rows.map((r) => r.map(q).join(',')),
  ]
  return `﻿${lines.join('\r\n')}\r\n`           // BOM: Excel opens UTF-8 (₹, accents) correctly
}

export const reportToJson = (report) => JSON.stringify({ header: Object.fromEntries(report.header), counts: report.counts, rows: report.rows.map((r) => Object.fromEntries(report.columns.map((c, i) => [c, r[i]]))) }, null, 2)

export async function reportToXlsx(report, issues = []) {
  const clean = (row) => row.map((v) => (typeof v === 'string' ? safe(v) : v))
  const sheets = [{
    name: 'Report',
    columns: [{ width: 10 }, { width: 24 }, { width: 10 }, { width: 12 }, { width: 24 }, { width: 22 }, { width: 12 }, { width: 80 }],
    rows: [
      ...report.header.map(([k, v]) => [{ v: k, s: 'bold' }, typeof v === 'string' ? safe(v) : v]),
      [],
      report.columns.map((c) => ({ v: c, s: 'headerRequired' })),
      ...report.rows.map(clean),
    ],
    freezeRows: report.header.length + 2,
  }]
  if (issues.length) {
    sheets.push({
      name: 'Messages',
      columns: [{ width: 10 }, { width: 8 }, { width: 8 }, { width: 28 }, { width: 24 }, { width: 100 }],
      rows: [['Severity', 'Code', 'Row', 'Column', 'Import ID', 'Message'].map((c) => ({ v: c, s: 'headerRequired' })), ...issues.map((i) => clean([i.severity, i.code, i.row || '', i.column || '', i.importId || '', i.message]))],
      freezeRows: 1,
    })
  }
  return buildXlsx({ sheets })
}