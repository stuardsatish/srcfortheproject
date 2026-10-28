// BROWSER-ONLY tests: the reader needs DOMParser (the admin page is a browser). Under `node --test` (npm run test:unit) the suites that need it are
// SKIPPED automatically — they are executed in headless Edge by  tools/browser-test/Run-EdgeTests.ps1  (HANDOFF section A) and can be run in
// a browser harness / Vitest+jsdom on any machine. They must NOT be counted as passed on a Node run.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeZip, listZip, extractEntry } from '../zip.js'
import { buildXlsx, colLetter, dateToSerial, xmlEscape } from '../xlsxWriter.js'
import { readXlsx, XlsxError } from '../xlsxReader.js'

const browserOnly = typeof DOMParser === 'undefined' ? describe.skip : describe
const enc = new TextEncoder()
const dec = new TextDecoder()
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const rejects = async (fn, code) => {
  try { await fn() } catch (e) { assert.ok(e instanceof XlsxError, `expected XlsxError, got ${e}`); assert.equal(e.code, code, e.message); return e }
  assert.fail(`expected XlsxError ${code}`)
}

/** A workbook assembled from hand-written XML — what OTHER producers (Excel, LibreOffice, openpyxl …) write, not our writer. */
async function handMade({ sheet, shared, styles, workbookPr = '', extraSheets = '', extraFiles = [], sheetTarget = 'worksheets/sheet1.xml' }) {
  const files = [
    { name: '[Content_Types].xml', data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>` },
    { name: '_rels/.rels', data: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${HEAD}<workbook ${NS}>${workbookPr}<sheets><sheet name="Data" sheetId="1" r:id="rId1"/>${extraSheets}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="${sheetTarget}"/><Relationship Id="rId9" Type="x/chartsheet" Target="chartsheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: `${HEAD}<worksheet ${NS}><sheetData>${sheet}</sheetData></worksheet>` },
  ]
  if (shared) files.push({ name: 'xl/sharedStrings.xml', data: `${HEAD}<sst ${NS}>${shared}</sst>` })
  if (styles) files.push({ name: 'xl/styles.xml', data: `${HEAD}<styleSheet ${NS}>${styles}</styleSheet>` })
  return writeZip([...files, ...extraFiles])
}

describe('writer helpers', () => {
  it('column letters', () => { assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map(colLetter), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']) })
  it('date serials (1900 system)', () => { assert.equal(dateToSerial('2023-03-15'), 45000); assert.equal(dateToSerial('1900-03-01'), 61); assert.throws(() => dateToSerial('15/03/2023')) })
  it('xml escaping drops illegal control characters', () => assert.equal(xmlEscape('a<b>&"\'\u0001\u000B'), 'a&lt;b&gt;&amp;&quot;&apos;'))
})

browserOnly('writer -> reader round trip', () => {
  it('every value type, unicode, gaps, hidden sheet, row numbers preserved', async () => {
    const long = 'x'.repeat(5000)
    const bytes = await buildXlsx({ sheets: [
      { name: 'Products', rows: [['Import ID', 'Price', 'Active', 'Note'], ['SHIRT-001', 500, true, 'Classic ₹ shirt '], [], ['SHIRT-002', 1234.56, false, '=cmd|\' /C calc\'!A0'], [null, null, null, 'multi\nline'], ['LONG', -0.5, null, long]], freezeRows: 1 },
      { name: 'Lists', state: 'hidden', rows: [['YES'], ['NO']] },
    ] })
    const wb = await readXlsx(bytes)
    assert.deepEqual(wb.sheets.map((s) => [s.name, s.state]), [['Products', 'visible'], ['Lists', 'hidden']])
    const rows = wb.sheets[0].rows
    assert.deepEqual(rows[0], ['Import ID', 'Price', 'Active', 'Note'])
    assert.deepEqual(rows[1], ['SHIRT-001', 500, true, 'Classic ₹ shirt '])
    assert.deepEqual(rows[2], [], 'an empty row keeps its row number')
    assert.deepEqual(rows[3], ['SHIRT-002', 1234.56, false, "=cmd|' /C calc'!A0"], 'formula-looking text stays TEXT')
    assert.deepEqual(rows[4], [null, null, null, 'multi\nline'])
    assert.deepEqual([rows[5][0], rows[5][1], rows[5][3].length], ['LONG', -0.5, 5000])
    assert.deepEqual(wb.sheets[1].rows, [['YES'], ['NO']])
  })
  it('dates written as { date } read back as ISO strings', async () => {
    const bytes = await buildXlsx({ sheets: [{ name: 'S', rows: [[{ date: '2026-12-31' }, { date: '2024-02-29' }]] }] })
    assert.deepEqual((await readXlsx(bytes)).sheets[0].rows[0], ['2026-12-31', '2024-02-29'])
  })
  it('data validations and frozen header are really in the sheet XML', async () => {
    const bytes = await buildXlsx({ sheets: [{ name: 'Products', rows: [['A', 'B']], freezeRows: 1, columns: [{ width: 20, style: 'text' }, { width: 10 }],
      validations: [{ sqref: 'B2:B100', type: 'list', formula1: 'Lists!$A$2:$A$4', error: 'Pick a value' }, { sqref: 'A2:A100', type: 'whole', operator: 'between', formula1: '1', formula2: '365' }] },
    { name: 'Lists', state: 'hidden', rows: [['x']] }] })
    const e = listZip(bytes)
    const xml = dec.decode(await extractEntry(bytes, e.find((x) => x.name === 'xl/worksheets/sheet1.xml')))
    assert.match(xml, /<dataValidations count="2">/)
    assert.match(xml, /<dataValidation type="list" allowBlank="1" showErrorMessage="1" error="Pick a value" sqref="B2:B100"><formula1>Lists!\$A\$2:\$A\$4<\/formula1>/)
    assert.match(xml, /type="whole" operator="between"/)
    assert.match(xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/)
    assert.match(xml, /<col min="1" max="1" width="20" customWidth="1" style="4"\/>/)
    const wbXml = dec.decode(await extractEntry(bytes, e.find((x) => x.name === 'xl/workbook.xml')))
    assert.match(wbXml, /<sheet name="Lists" sheetId="2" state="hidden"/)
  })
  it('refuses bad sheet names and non-finite numbers', async () => {
    await assert.rejects(buildXlsx({ sheets: [{ name: 'a/b', rows: [] }] }), /invalid or duplicate sheet name/)
    await assert.rejects(buildXlsx({ sheets: [{ name: 'A', rows: [] }, { name: 'a', rows: [] }] }), /invalid or duplicate sheet name/)
    await assert.rejects(buildXlsx({ sheets: [{ name: 'A', rows: [[NaN]] }] }), /non-finite/)
  })
})

browserOnly('reading workbooks written by other producers', () => {
  it('shared strings: rich-text runs are joined, phonetic runs are dropped; inline strings; formula results; booleans; errors', async () => {
    const bytes = await handMade({
      shared: '<si><t>Plain</t></si><si><r><t>Rich </t></r><r><rPr><b/></rPr><t>text</t></r></si><si><t xml:space="preserve"> padded </t><rPh sb="0" eb="1"><t>PHONETIC</t></rPh></si>',
      sheet: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>inline</t></is></c>' +
             '<c r="E1" t="str"><f>A1&amp;"x"</f><v>Plainx</v></c><c r="F1" t="b"><v>1</v></c><c r="G1" t="b"><v>0</v></c><c r="H1" t="e"><v>#N/A</v></c><c r="I1"><v>42</v></c><c r="J1"><v>1.5E-3</v></c></row>',
    })
    const [row] = (await readXlsx(bytes)).sheets[0].rows
    assert.deepEqual(row, ['Plain', 'Rich text', ' padded ', 'inline', 'Plainx', true, false, '#N/A', 42, 0.0015])
  })
  it('sparse cells honour the r="C5" address; rows may skip numbers; cells without r are sequential', async () => {
    const bytes = await handMade({ sheet: '<row r="2"><c r="C2"><v>7</v></c></row><row r="5"><c><v>1</v></c><c><v>2</v></c></row>' })
    const rows = (await readXlsx(bytes)).sheets[0].rows
    assert.equal(rows.length, 5)
    assert.deepEqual(rows[0], []); assert.deepEqual(rows[1], [null, null, 7]); assert.deepEqual(rows[4], [1, 2])
  })
  it('dates: built-in id 14, a custom yyyy-mm-dd format, times, and the 1904 system; plain numbers stay numbers', async () => {
    const styles = '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="0.00&quot;m&quot;"/></numFmts>' +
                   '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>'
    const sheet = '<row r="1"><c r="A1" s="1"><v>45000</v></c><c r="B1" s="2"><v>45000</v></c><c r="C1" s="1"><v>45000.5</v></c><c r="D1" s="0"><v>45000</v></c><c r="E1" s="3"><v>45000</v></c></row>'
    const [row] = (await readXlsx(await handMade({ sheet, styles }))).sheets[0].rows
    assert.deepEqual(row, ['2023-03-15', '2023-03-15', '2023-03-15T12:00:00', 45000, 45000], 'a "0.00m" format is NOT a date')
    const [row1904] = (await readXlsx(await handMade({ sheet: '<row r="1"><c r="A1" s="1"><v>43538</v></c></row>', styles, workbookPr: '<workbookPr date1904="1"/>' }))).sheets[0].rows
    assert.deepEqual(row1904, ['2023-03-15'])
  })
  it('cached formula results are returned and the formula is never evaluated', async () => {
    const bytes = await handMade({ sheet: '<row r="1"><c r="A1"><f>HYPERLINK("http://evil.test","x")</f><v>cached</v></c><c r="B1" t="str"><f>cmd|\' /C calc\'!A0</f><v>safe</v></c></row>' })
    assert.deepEqual((await readXlsx(bytes)).sheets[0].rows[0], ['cached', 'safe'])
  })
  it('chart sheets and absolute relationship targets are handled', async () => {
    const bytes = await handMade({ sheet: '<row r="1"><c r="A1"><v>1</v></c></row>', sheetTarget: '/xl/worksheets/sheet1.xml', extraSheets: '<sheet name="Chart" sheetId="2" r:id="rId9"/>' })
    const wb = await readXlsx(bytes)
    assert.deepEqual(wb.sheets.map((s) => s.name), ['Data'])
  })
  it('an out-of-range shared-string index does not crash (empty cell)', async () => {
    const bytes = await handMade({ shared: '<si><t>only</t></si>', sheet: '<row r="1"><c r="A1" t="s"><v>5</v></c><c r="B1" t="s"><v>0</v></c></row>' })
    assert.deepEqual((await readXlsx(bytes)).sheets[0].rows[0], [null, 'only'])
  })
})

browserOnly('hostile workbooks', () => {
  it('not a zip / random bytes / empty', async () => {
    await rejects(() => readXlsx(enc.encode('this is a csv,not an xlsx\n1,2')), 'NOT_XLSX')
    await rejects(() => readXlsx(new Uint8Array(0)), 'NOT_XLSX')
  })
  it('legacy .xls / password-protected workbooks (OLE2 container) get an actionable message', async () => {
    const ole = new Uint8Array(600); ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const e = await rejects(() => readXlsx(ole), 'OLE2')
    assert.match(e.message, /Save As.*\.xlsx/)
  })
  it('a zip that is not a workbook', async () => {
    await rejects(async () => readXlsx(await writeZip([{ name: 'readme.txt', data: 'hi' }])), 'NOT_XLSX')
  })
  it('macro-enabled and linked workbooks are refused', async () => {
    await rejects(async () => readXlsx(await handMade({ sheet: '', extraFiles: [{ name: 'xl/vbaProject.bin', data: 'x' }] })), 'MACROS')
    await rejects(async () => readXlsx(await handMade({ sheet: '', extraFiles: [{ name: 'xl/externalLinks/externalLink1.xml', data: '<x/>' }] })), 'EXTERNAL_LINKS')
  })
  it('DOCTYPE / ENTITY declarations (billion laughs, XXE) are refused before parsing', async () => {
    const bomb = '<!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>'
    const bytes = await writeZip([
      { name: '[Content_Types].xml', data: '<x/>' },
      { name: 'xl/workbook.xml', data: `${bomb}<workbook ${NS}><sheets/></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships/>' },
    ])
    await rejects(() => readXlsx(bytes), 'XML_DOCTYPE')
  })
  it('malformed XML', async () => {
    await rejects(async () => readXlsx(await handMade({ sheet: '<row r="1"><c r="A1"><v>1</v></row>' })), 'XML_INVALID')
  })
  it('limits: rows, columns, cell length, file size — and trailing EMPTY rows/cols do not trip them', async () => {
    const big = await handMade({ sheet: '<row r="1"><c r="A1"><v>1</v></c></row><row r="50"><c r="A50"><v>2</v></c></row>' })
    await rejects(() => readXlsx(big, { maxRows: 10 }), 'TOO_MANY_ROWS')
    const wide = await handMade({ sheet: '<row r="1"><c r="A1"><v>1</v></c><c r="AA1"><v>2</v></c></row>' })
    await rejects(() => readXlsx(wide, { maxCols: 5 }), 'TOO_MANY_COLUMNS')
    const emptyTail = await handMade({ sheet: '<row r="1"><c r="A1"><v>1</v></c></row><row r="50"><c r="A50"/></row>' })
    assert.equal((await readXlsx(emptyTail, { maxRows: 10 })).sheets[0].rows.length, 1)
    const text = await handMade({ sheet: `<row r="1"><c r="A1" t="inlineStr"><is><t>${'z'.repeat(200)}</t></is></c></row>` })
    await rejects(() => readXlsx(text, { maxCellChars: 100 }), 'CELL_TOO_LARGE')
    await rejects(() => readXlsx(big, { maxFileBytes: 100 }), 'FILE_TOO_BIG')
  })
  it('a sheet XML that inflates beyond the part limit (zip bomb) is refused', async () => {
    const huge = '<row r="1"><c r="A1" t="inlineStr"><is><t>' + 'a'.repeat(2_000_000) + '</t></is></c></row>'
    const bytes = await writeZip([
      { name: '[Content_Types].xml', data: '<x/>' },
      { name: 'xl/workbook.xml', data: `${HEAD}<workbook ${NS}><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>` },
      { name: 'xl/worksheets/sheet1.xml', data: `${HEAD}<worksheet ${NS}><sheetData>${huge}</sheetData></worksheet>` },
    ], { deflate: true })
    assert.ok(bytes.length < 50000, 'compressed it is small')
    await rejects(() => readXlsx(bytes, { maxPartBytes: 100000 }), 'ZIP_ENTRY_TOO_BIG')
  })
})