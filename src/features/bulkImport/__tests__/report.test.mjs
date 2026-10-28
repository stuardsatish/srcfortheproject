// node --test src/features/bulkImport/__tests__/report.test.mjs   (npm run test:unit)  — the xlsx part needs DOMParser (browser harness)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatIst, buildReport, reportToCsv, reportToJson, reportToXlsx, REPORT_COLUMNS } from '../report.js'
import { readXlsx } from '../xlsxReader.js'
import { validateImport } from '../validate.js'
import { demoCells2d } from '../templateBuilder.js'
import { demoImageFiles } from '../demoData.js'

const browserOnly = typeof DOMParser === 'undefined' ? describe.skip : describe
const TODAY = new Date('2026-10-17T00:00:00Z')
const validation = () => validateImport({ cells2d: demoCells2d(), imageFiles: demoImageFiles().map((name) => ({ name, size: 1 })), today: TODAY })
const stage = (extra = {}) => ({ ok: true, batch_id: 'b-1', status: 'staged', groups: [], ...extra })
const commit = (report) => ({ ok: true, batch_id: 'b-1', status: 'committed', report })
const sample = (v) => v.groups.map((g, gi) => ({
  import_key: g.import_key, row: g.row, result: 'created', product_id: `prod_${gi}`,
  variants: g.variants.map((x, vi) => ({ id: `var_${gi}_${vi}`, import_key: x.import_key, row: x.row })),
}))

describe('formatIst', () => {
  it('shows the store timezone regardless of the admin computer', () => {
    assert.equal(formatIst(new Date('2026-10-17T10:15:00Z')), '2026-10-17 15:45:00 IST')
    assert.equal(formatIst('2026-12-31T20:00:00Z'), '2027-01-01 01:30:00 IST')
    assert.equal(formatIst('garbage'), '')
  })
})

describe('buildReport', () => {
  it('after a successful import: every row is "created" with its product id (variants also their variant id)', () => {
    const v = validation()
    const rep = buildReport({ fileName: 'products.xlsx', fileHash: 'a'.repeat(64), operator: 'admin@shop.test', validation: v, stage: stage(), commit: commit(sample(v)),
      startedAt: new Date('2026-10-17T10:00:00Z'), finishedAt: new Date('2026-10-17T10:00:30Z') })
    assert.deepEqual(rep.counts, { created: 12, unchanged: 0, error: 0, skipped: 0 })
    const pink = rep.rows.find((r) => r[1] === 'SHIRT-002-PINK')
    assert.deepEqual(pink.slice(0, 6), [4, 'SHIRT-002-PINK', 'VARIANT', 'created', 'prod_1', 'var_1_0'])
    assert.equal(rep.rows.find((r) => r[1] === 'SHIRT-002')[5], '', 'a parent / single has no variant id')
    const h = Object.fromEntries(rep.header)
    assert.deepEqual([h.File, h.Operator, h.Outcome, h.Created, h.Errors, h.Started, h.Finished], ['products.xlsx', 'admin@shop.test', 'Imported', 12, 0, '2026-10-17 15:30:00 IST', '2026-10-17 15:30:30 IST'])
    assert.equal(rep.columns, REPORT_COLUMNS)
  })
  it('a sheet with errors: the bad rows say "error" (with the code and message), the good rows are "skipped" because nothing was imported', () => {
    const cells = demoCells2d(); cells[cells.findIndex((r) => r[0] === 'SHIRT-002-WHITE')][5] = null    // SHIRT-002-WHITE: SKU (column 6) missing
    const v = validateImport({ cells2d: cells, imageFiles: demoImageFiles().map((name) => ({ name, size: 1 })), today: TODAY })
    const rep = buildReport({ validation: v })
    const bad = rep.rows.find((r) => r[1] === 'SHIRT-002-WHITE')
    assert.equal(bad[3], 'error'); assert.match(bad[7], /E022: SKU is missing/)
    assert.equal(rep.rows.find((r) => r[1] === 'SHIRT-001')[3], 'skipped')
    assert.equal(Object.fromEntries(rep.header).Outcome, 'NOT imported')
    assert.equal(rep.counts.error, 1)
  })
  it('server-side refusals are attributed to the product (and its variants)', () => {
    const v = validation()
    const rep = buildReport({ validation: v, stage: { ok: false, errors: [{ code: 'E024', row: 2, import_key: 'SHIRT-002', message: 'SKU taken' }], groups: [] } })
    for (const key of ['SHIRT-002', 'SHIRT-002-PINK', 'SHIRT-002-WHITE', 'SHIRT-002-VIOLET']) assert.equal(rep.rows.find((r) => r[1] === key)[3], 'error', key)
    assert.match(rep.rows.find((r) => r[1] === 'SHIRT-002')[7], /E024: SKU taken/)
    assert.equal(rep.rows.find((r) => r[1] === 'SHOE-001')[3], 'skipped')
  })
  it('a re-import: unchanged products (and their variants) are reported "unchanged" with the existing product id', () => {
    const v = validation()
    const groups = v.groups.map((g, i) => ({ import_key: g.import_key, row: g.row, status: 'unchanged', product_id: `prod_${i}` }))
    const rep = buildReport({ validation: v, stage: { ok: true, status: 'unchanged', groups } })
    assert.equal(rep.counts.unchanged, 12)
    assert.equal(rep.rows.find((r) => r[1] === 'SHIRT-002-PINK')[4], 'prod_1')
    assert.equal(Object.fromEntries(rep.header).Outcome, 'Nothing to import (all unchanged)')
  })
  it('an import that was already committed says so (nothing repeated)', () => {
    const v = validation()
    const rep = buildReport({ validation: v, stage: stage({ already: true, status: 'committed' }), commit: { ...commit(sample(v)), already: true } })
    assert.equal(Object.fromEntries(rep.header).Outcome, 'Imported earlier (nothing repeated)')
  })
})

describe('exports', () => {
  const rep = () => {
    const cells = demoCells2d(); cells[1][3] = '=HYPERLINK("http://evil.test","click")'; cells[2][3] = '@cmd'
    const v = validateImport({ cells2d: cells, imageFiles: demoImageFiles().map((name) => ({ name, size: 1 })), today: TODAY })
    return buildReport({ fileName: '=evil.xlsx', operator: '+op', validation: v, stage: stage(), commit: commit(sample(v)) })
  }
  it('CSV: BOM, quoting, and formula injection is neutralised (header block AND rows)', () => {
    const csv = reportToCsv(rep())
    assert.ok(csv.startsWith('﻿'))
    assert.match(csv, /^﻿File,'=evil\.xlsx\r\n/); assert.match(csv, /Operator,'\+op/)
    assert.ok(!/(^|,)=HYPERLINK/m.test(csv))
    const withComma = reportToCsv({ header: [['A', 'x,y "quoted"']], columns: ['c'], rows: [['line\nbreak']] })
    assert.match(withComma, /A,"x,y ""quoted"""/); assert.match(withComma, /"line\nbreak"/)
  })
  it('JSON: header + row objects keyed by column', () => {
    const j = JSON.parse(reportToJson(rep()))
    assert.equal(j.header.Outcome, 'Imported'); assert.equal(j.rows.length, 12); assert.deepEqual(Object.keys(j.rows[0]), REPORT_COLUMNS)
  })
  browserOnly('xlsx', () => {
    it('Report + Messages sheets, header block on top, text cells are never formulas', async () => {
      const r = rep()
      const v = validation()
      const bytes = await reportToXlsx(r, v.issues)
      const wb = await readXlsx(bytes)
      assert.deepEqual(wb.sheets.map((s) => s.name), ['Report', 'Messages'])
      const rows = wb.sheets[0].rows
      assert.deepEqual(rows[0], ['File', "'=evil.xlsx"])
      const headerAt = rows.findIndex((x) => x[0] === 'Row')
      assert.deepEqual(rows[headerAt], REPORT_COLUMNS)
      assert.equal(rows.length - headerAt - 1, 12)
      assert.deepEqual(wb.sheets[1].rows[0], ['Severity', 'Code', 'Row', 'Column', 'Import ID', 'Message'])
    })
  })
})