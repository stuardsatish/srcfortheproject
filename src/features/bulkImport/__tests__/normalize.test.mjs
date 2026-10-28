// node --test src/features/bulkImport/__tests__/normalize.test.mjs   (npm run test:unit)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanLine, cleanText, isBlank, parseNumber, parseInteger, parseYesNo, parseDate, splitList, parseAttributePairs, keyOf,
  isValidImportId, isValidImageFileName, extensionOf, baseNameOf, isUrl, escapeForSpreadsheet,
} from '../normalize.js'

const NBSP = ' '
const ZW = ''

describe('cleanLine / cleanText (rule 6: NBSP and zero-width characters are removed)', () => {
  it('trims, turns NBSP into a space, drops zero-width characters, collapses runs', () => {
    assert.equal(cleanLine(`  Classic${NBSP}${NBSP}Shirt${ZW}  `), 'Classic Shirt')
    assert.equal(cleanLine('a\tb\nc'), 'a b c')
    assert.equal(cleanLine(null), ''); assert.equal(cleanLine(undefined), ''); assert.equal(cleanLine(0), '0'); assert.equal(cleanLine(12.5), '12.5')
  })
  it('cleanText keeps paragraphs', () => {
    assert.equal(cleanText(`Line one${NBSP}\r\n\r\n\r\n\r\nLine  two \n x`), 'Line one\n\nLine two\nx')
  })
  it('isBlank', () => { assert.equal(isBlank(`${NBSP}${ZW} `), true); assert.equal(isBlank('0'), false) })
})

describe('parseNumber', () => {
  const ok = (v, expected) => assert.deepEqual(parseNumber(v), { ok: true, value: expected }, `input ${JSON.stringify(v)}`)
  const bad = (v) => assert.deepEqual(parseNumber(v), { ok: false }, `input ${JSON.stringify(v)}`)
  it('accepts the shapes the guide promises', () => {
    ok(500, 500); ok('500', 500); ok('500.00', 500); ok('₹500', 500); ok('₹ 1,500', 1500); ok('Rs. 150,000', 150000)
    ok('1,500.50', 1500.5); ok('-3', -3); ok('.5', 0.5); ok(`${NBSP}12${NBSP}`, 12); ok('INR 99', 99)
  })
  it('blank is "no value", not 0', () => { ok('', null); ok(null, null); ok(undefined, null); ok('  ', null) })
  it('rejects text, junk and ambiguous separators (the old importer silently turned "abc" into 0)', () => {
    for (const v of ['abc', '12abc', '1.2.3', '1,5', '12,34', '#N/A', 'NaN', '1e5', '--5', true, NaN, Infinity]) bad(v)
  })
})

describe('parseInteger', () => {
  it('whole numbers only', () => {
    assert.deepEqual(parseInteger(5), { ok: true, value: 5 }); assert.deepEqual(parseInteger('5'), { ok: true, value: 5 }); assert.deepEqual(parseInteger('5.0'), { ok: true, value: 5 })
    assert.deepEqual(parseInteger(5.5), { ok: false }); assert.deepEqual(parseInteger('5.5'), { ok: false }); assert.deepEqual(parseInteger(''), { ok: true, value: null }); assert.deepEqual(parseInteger('x'), { ok: false })
  })
})

describe('parseYesNo', () => {
  it('YES / NO spellings, blank = null, anything else invalid', () => {
    for (const v of ['YES', 'yes', ' Y ', 'true', 'TRUE', '1', true, 'on']) assert.deepEqual(parseYesNo(v), { ok: true, value: true }, String(v))
    for (const v of ['NO', 'no', 'N', 'false', '0', false, 'off']) assert.deepEqual(parseYesNo(v), { ok: true, value: false }, String(v))
    for (const v of ['', null, undefined, '   ']) assert.deepEqual(parseYesNo(v), { ok: true, value: null })
    for (const v of ['maybe', 'yess', '2', 'sí']) assert.deepEqual(parseYesNo(v), { ok: false }, v)
  })
})

describe('parseDate', () => {
  it('ISO, Excel-reader ISO, Indian DD/MM/YYYY and DD-MM-YYYY', () => {
    assert.deepEqual(parseDate('2026-12-31'), { ok: true, value: '2026-12-31' })
    assert.deepEqual(parseDate('2026-12-31T00:00:00'), { ok: true, value: '2026-12-31' })
    assert.deepEqual(parseDate('31/12/2026'), { ok: true, value: '2026-12-31' })
    assert.deepEqual(parseDate('1-2-2027'), { ok: true, value: '2027-02-01' })
    assert.deepEqual(parseDate(''), { ok: true, value: null })
  })
  it('impossible dates are rejected, not rolled over', () => {
    for (const v of ['2026-02-30', '31/04/2026', '2026-13-01', 'tomorrow', '12/31/2026', '2026-1-5']) assert.deepEqual(parseDate(v), { ok: false }, v)
    assert.deepEqual(parseDate('2024-02-29'), { ok: true, value: '2024-02-29' })
    assert.deepEqual(parseDate('2026-02-29'), { ok: false })
  })
})

describe('lists and attribute pairs', () => {
  it('| is the only separator', () => {
    assert.deepEqual(splitList('a| b ||c|'), ['a', 'b', 'c']); assert.deepEqual(splitList('red,blue'), ['red,blue']); assert.deepEqual(splitList(''), [])
  })
  it('Color=Pink|Size=M', () => {
    assert.deepEqual(parseAttributePairs('Color=Pink|Size=M'), { ok: true, value: [['Color', 'Pink'], ['Size', 'M']] })
    assert.deepEqual(parseAttributePairs(''), { ok: true, value: [] })
    assert.deepEqual(parseAttributePairs('Color = Pink = dark'), { ok: true, value: [['Color', 'Pink = dark']] })
    for (const v of ['Color', 'Color=', '=Pink', 'Color=Pink|Size']) assert.equal(parseAttributePairs(v).ok, false, v)
  })
  it('prototype-pollution style keys stay ordinary pairs (nothing is assigned onto an object)', () => {
    const r = parseAttributePairs('__proto__=x|constructor=y')
    assert.deepEqual(r, { ok: true, value: [['__proto__', 'x'], ['constructor', 'y']] })
    assert.equal({}.x, undefined)
  })
})

describe('identifiers and file names', () => {
  it('Import ID: A-Z a-z 0-9 . _ - , max 64, never "_var_" (the cart splits on it)', () => {
    for (const v of ['SHIRT-001', 'a.b_c-d', 'X'.repeat(64), '2A']) assert.equal(isValidImportId(v), true, v)
    for (const v of ['', 'has space', 'a/b', 'X'.repeat(65), 'shirt_var_1', 'SHIRT_VAR_X', 'é', 'a,b']) assert.equal(isValidImportId(v), false, v)
  })
  it('image file names: plain names only', () => {
    for (const v of ['SHIRT-001.jpg', 'my photo (1).png', 'a_b-c.webp']) assert.equal(isValidImageFileName(v), true, v)
    for (const v of ['../x.jpg', 'dir/x.jpg', 'dir\\x.jpg', '.hidden.jpg', 'a..b.jpg', '', 'x'.repeat(101) + '.jpg', 'ünï.jpg', 'a;b.jpg']) assert.equal(isValidImageFileName(v), false, v)
  })
  it('extension / base name / url helpers', () => {
    assert.equal(extensionOf('A.JPG'), 'jpg'); assert.equal(extensionOf('noext'), ''); assert.equal(baseNameOf('images\\sub/A.jpg'), 'A.jpg')
    assert.equal(isUrl('https://x.test/a.jpg'), true); assert.equal(isUrl('HTTP://x'), true); assert.equal(isUrl('ftp://x'), false); assert.equal(isUrl('a.jpg'), false)
    assert.equal(keyOf('  SHIRT-001 '), 'shirt-001')
  })
})

describe('report injection guard (CSV / formula injection)', () => {
  it('prefixes values that a spreadsheet would run as a formula', () => {
    for (const v of ['=1+1', '+SUM(A1)', '-2+3', '@HYPERLINK("x")', '\tcmd', '\rcmd']) assert.equal(escapeForSpreadsheet(v), `'${v}`, v)
    for (const v of ['Classic shirt', '500', '', 'a=b', null]) assert.equal(escapeForSpreadsheet(v), v === null ? '' : v)
  })
})