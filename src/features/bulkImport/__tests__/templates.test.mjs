// node --test src/features/bulkImport/__tests__/templates.test.mjs   (npm run test:unit)  — needs DOMParser: runs in a browser harness
// (skipped under plain Node). The official template and the demo are built by the same code the admin page uses.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listZip, extractEntry } from '../zip.js'
import { readXlsx } from '../xlsxReader.js'
import { buildTemplateWorkbook, buildDemoWorkbook, demoCells2d, LAST_DATA_ROW } from '../templateBuilder.js'
import { DEMO_ROWS, demoImageFiles } from '../demoData.js'
import { COLUMNS, mapHeaders } from '../columns.js'
import { validateImport } from '../validate.js'

const browserOnly = typeof DOMParser === 'undefined' ? describe.skip : describe
const dec = new TextDecoder()
const TODAY = new Date('2026-10-17T00:00:00Z')
const xml = async (bytes, name) => dec.decode(await extractEntry(bytes, listZip(bytes).find((e) => e.name === name)))

browserOnly('the official template', () => {
  it('has the Products / Instructions / Lists sheets (Lists hidden) and every column of the guide, in order', async () => {
    const wb = await readXlsx(await buildTemplateWorkbook())
    assert.deepEqual(wb.sheets.map((s) => [s.name, s.state]), [['Products', 'visible'], ['Instructions', 'visible'], ['Lists', 'hidden']])
    assert.deepEqual(wb.sheets[0].rows[0], COLUMNS.map((c) => c.header))
    assert.equal(COLUMNS.length, 30)
    const m = mapHeaders(wb.sheets[0].rows[0])
    assert.deepEqual([m.missing, m.unknown, m.duplicate, m.legacy], [[], [], [], false], 'every header is recognised by the importer')
  })
  it('row 2 is a grey EXAMPLE row that the importer ignores; an untouched template is rejected as "no product rows"', async () => {
    const rows = (await readXlsx(await buildTemplateWorkbook())).sheets[0].rows
    assert.match(String(rows[1][0]), /^#/)
    const r = validateImport({ cells2d: rows, imageFiles: [], today: TODAY })
    assert.equal(r.ok, false); assert.ok(r.issues.some((i) => i.code === 'E090' && /no product rows/.test(i.message)))
  })
  it('dropdowns and number rules are in the sheet XML and point at the hidden Lists sheet', async () => {
    const bytes = await buildTemplateWorkbook({ categories: ['Shirts', 'Footwear', 'Gifts'] })
    const sheet = await xml(bytes, 'xl/worksheets/sheet1.xml')
    const typeCol = String.fromCharCode(65 + COLUMNS.findIndex((c) => c.key === 'type'))
    assert.match(sheet, new RegExp(`type="list"[^>]*sqref="${typeCol}3:${typeCol}${LAST_DATA_ROW}"><formula1>Lists!\\$A\\$2:\\$A\\$4</formula1>`))
    assert.match(sheet, /type="whole" operator="between"[^>]*><formula1>1<\/formula1><formula2>365<\/formula2>/)
    assert.match(sheet, /type="decimal" operator="greaterThan"[^>]*><formula1>0<\/formula1>/)
    assert.match(sheet, /errorStyle="warning"[^>]*sqref="H3:H1002"><formula1>Lists!\$D\$2:\$D\$4<\/formula1>/, 'categories: pick from the list or type a new one')
    assert.match(sheet, /<pane ySplit="1"/); assert.match(await xml(bytes, 'xl/workbook.xml'), /name="Lists" sheetId="3" state="hidden"/)
    const lists = (await readXlsx(bytes)).sheets[2].rows
    assert.deepEqual(lists.slice(0, 4).map((r) => r.slice(0, 3)), [['Product Type', 'Yes / No', 'Status'], ['SINGLE', 'YES', 'ACTIVE'], ['PARENT', 'NO', 'DRAFT'], ['VARIANT', null, 'INACTIVE']])
    assert.deepEqual(lists.slice(1).map((r) => r[3]), ['Shirts', 'Footwear', 'Gifts'])
  })
  it('without categories there is no category dropdown (free text)', async () => {
    assert.doesNotMatch(await xml(await buildTemplateWorkbook(), 'xl/worksheets/sheet1.xml'), /Lists!\$D\$2/)
  })
  it('the Instructions sheet explains the three row kinds, images, separators, policy and the # rule', async () => {
    const text = (await readXlsx(await buildTemplateWorkbook())).sheets[1].rows.map((r) => r[0] || '').join('\n')
    for (const needle of ['SINGLE', 'PARENT', 'VARIANT', 'ITS OWN price', '.zip', '|', 'Return Window Days', 'starts with #', 'Import IDs identify rows']) assert.ok(text.includes(needle), needle)
  })
})

browserOnly('the demo workbook', () => {
  it('passes the REAL validator with zero errors, with exactly the images it references', async () => {
    const wb = await readXlsx(await buildDemoWorkbook())
    const images = demoImageFiles().map((name) => ({ name, size: 40000 }))
    const r = validateImport({ cells2d: wb.sheets[0].rows, imageFiles: images, today: TODAY })
    assert.equal(r.ok, true, JSON.stringify(r.issues.filter((i) => i.severity === 'error')))
    assert.deepEqual(r.summary, { rows: 12, products: 6, variants: 6, singles: 4, parents: 2, images: 13, imageUrls: 0, legacy: false })
    assert.deepEqual(r.issues.filter((i) => i.severity !== 'info').map((i) => i.code), ['W005'], 'only the deliberate DRAFT warning')
  })
  it('shows what the brief asks for: the PARENT has its own price, each variant a different one, mixed policies', async () => {
    const r = validateImport({ cells2d: (await readXlsx(await buildDemoWorkbook())).sheets[0].rows, imageFiles: demoImageFiles().map((name) => ({ name, size: 1 })), today: TODAY })
    const shirt = r.groups.find((g) => g.import_key === 'SHIRT-002')
    assert.equal(shirt.product.price, 500)
    assert.deepEqual(shirt.variants.map((v) => [v.name, v.price]), [['Pink', 300], ['White', 200], ['Violet', 350]])
    const policies = r.groups.map((g) => [g.import_key, g.product.return_enabled, g.product.return_window_days, g.product.exchange_enabled, g.product.exchange_window_days])
    assert.deepEqual(policies.find((p) => p[0] === 'SHIRT-001'), ['SHIRT-001', true, 7, true, 5])
    assert.deepEqual(policies.find((p) => p[0] === 'SHOE-001'), ['SHOE-001', true, 10, true, 7])
    assert.deepEqual(policies.find((p) => p[0] === 'CUSTOM-001'), ['CUSTOM-001', false, null, false, null])
    const white = shirt.variants[1]
    assert.deepEqual([white.return_enabled, white.exchange_window_days], [false, 3])
    const hoodie = r.groups.find((g) => g.import_key === 'HOODIE-001')
    assert.equal(hoodie.product.main_option_enabled, false)
    assert.deepEqual(hoodie.product.attributes, [{ name: 'Color', options: ['Red', 'Blue'] }, { name: 'Size', options: ['M', 'L'] }])
    assert.equal(r.groups.find((g) => g.import_key === 'SHOE-001').product.discount_expiry, '2030-12-31T23:59:59+05:30')
    assert.equal(r.groups.find((g) => g.import_key === 'GIFT-001').product.track_inventory, false)
  })
  it('writer -> reader keeps every cell of the demo (dates come back ISO, numbers stay numbers)', async () => {
    const read = (await readXlsx(await buildDemoWorkbook())).sheets[0].rows
    const want = demoCells2d()
    assert.equal(read.length, want.length)
    want.forEach((row, i) => row.forEach((v, j) => assert.deepEqual(read[i][j] ?? null, v === undefined ? null : v, `cell ${i + 1},${j + 1}`)))
  })
  it('the image list is derived from the rows (cannot drift) and has no duplicates', () => {
    const files = demoImageFiles()
    assert.equal(files.length, 13); assert.equal(new Set(files.map((f) => f.toLowerCase())).size, 13)
    assert.ok(files.includes('SHOE-001-side.jpg') && files.includes('HOODIE-001-RED.jpg'))
    assert.ok(DEMO_ROWS.every((r) => !r.importId.startsWith('#')))
  })
})

browserOnly('scale (D17): the largest allowed file', () => {
  it('a 1000-row workbook is built, read and validated in a few seconds (the page stays responsive)', async () => {
    const { buildXlsx } = await import('../xlsxWriter.js')
    const headers = COLUMNS.map((c) => c.header)
    const rows = Array.from({ length: 1000 }, (_, i) => COLUMNS.map((c) => ({
      importId: `P-${i}`, type: 'SINGLE', name: `Product number ${i}`, sku: `SKU-${i}`, category: 'Bulk', price: 10 + (i % 90), stock: i % 40,
      mainImage: `img-${i % 50}.jpg`, tags: 'a|b|c', description: 'x'.repeat(200),
    })[c.key] ?? null))
    const bytes = await buildXlsx({ sheets: [{ name: 'Products', rows: [headers, ...rows] }] })
    const t0 = performance.now()
    const wb = await readXlsx(bytes)
    const t1 = performance.now()
    const images = Array.from({ length: 50 }, (_, i) => ({ name: `img-${i}.jpg`, size: 1000 }))
    const r = validateImport({ cells2d: wb.sheets[0].rows, imageFiles: images, today: TODAY })
    const t2 = performance.now()
    assert.equal(r.ok, true, JSON.stringify(r.issues.slice(0, 3)))
    assert.equal(r.summary.products, 1000)
    console.log(`1000 rows: workbook ${Math.round(bytes.length / 1024)} KB, read ${Math.round(t1 - t0)} ms, validate ${Math.round(t2 - t1)} ms`)
    assert.ok(t2 - t0 < 8000, `read + validate took ${Math.round(t2 - t0)} ms`)
  })
})