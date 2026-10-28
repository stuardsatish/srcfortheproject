// Dependency-free .xlsx READER for the bulk importer (browser: needs DOMParser + DecompressionStream; tested in headless Edge).
//
// It reads CELL VALUES only — never formulas, macros, links or external data:
//   * a formula cell yields its CACHED result (<v>) exactly like any other cell, nothing is evaluated;
//   * macro-enabled workbooks (xl/vbaProject.bin), legacy .xls / password-protected files (OLE2 container) and anything that
//     is not a zip of XML are REFUSED with a message the admin can act on (E080);
//   * XML containing a DOCTYPE or ENTITY declaration is refused (billion-laughs / XXE class of attacks);
//   * every limit is enforced while reading: rows, columns, cell length, shared-string count, zip entry sizes (zip.js).
//
// OUTPUT   { sheets: [{ name, state: 'visible'|'hidden'|'veryHidden', rows: [[value|null, ...], ...] }] }
//   rows[i] is Excel row i+1 (so a row index maps straight to the number the admin sees); rows[i][j] is column j (A = 0).
//   value: string | number | boolean | null.  Date-formatted numeric cells come back as 'YYYY-MM-DD' (or 'YYYY-MM-DDTHH:mm:ss').
//   Error cells (#N/A …) come back as the string '#N/A' — the validator then reports them as an invalid value.
import { ZipError, listZip, extractEntry } from './zip.js'

export class XlsxError extends Error {
  constructor(code, message) { super(message); this.name = 'XlsxError'; this.code = code }
}

export const XLSX_DEFAULT_LIMITS = Object.freeze({
  maxRows: 5000,
  maxCols: 200,
  maxCellChars: 32767,           // Excel's own limit
  maxSharedStrings: 200000,
  maxPartBytes: 25 * 1024 * 1024, // one XML part, inflated
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024, // the compressed workbook as picked by the admin
})

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const dec = new TextDecoder('utf-8')
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

function parseXml(text, what) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new XlsxError('XML_DOCTYPE', `${what} contains a DOCTYPE/ENTITY declaration, which is not allowed`)
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new XlsxError('XML_INVALID', `${what} is not valid XML`)
  return doc
}

const byLocalName = (root, name) => Array.from(root.getElementsByTagNameNS('*', name))
const attr = (el, name) => el.getAttribute(name)
const attrNS = (el, name) => el.getAttribute(`r:${name}`) ?? el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name)

/** concatenated text of every <t> under `el`, skipping phonetic runs (<rPh>) */
function richText(el) {
  let out = ''
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue
      const ln = child.localName
      if (ln === 'rPh' || ln === 'phoneticPr') continue
      if (ln === 't') out += child.textContent
      else walk(child)
    }
  }
  walk(el)
  return out
}

/** "AB12" -> { col: 27, row: 12 } (0-based col, 1-based row) */
function parseRef(ref) {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref || '')
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: Number(m[2]) }
}

function isDateFormat(code) {
  const stripped = String(code || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '')
  return /[dmyhs]/i.test(stripped) && !/^general$/i.test(stripped.trim())
}

function serialToIso(serial, date1904) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const ms = Math.round(serial * 86400000)
  const d = new Date(base + ms)
  if (Number.isNaN(d.getTime())) return null
  const iso = d.toISOString()
  return Number.isInteger(serial) ? iso.slice(0, 10) : iso.slice(0, 19)
}

async function readPart(bytes, entries, name, lim, optional = false) {
  const entry = entries.find((e) => e.name.toLowerCase() === name.toLowerCase())
  if (!entry) { if (optional) return null; throw new XlsxError('NOT_XLSX', `The file is not a valid .xlsx workbook (missing ${name})`) }
  try { return dec.decode(await extractEntry(bytes, entry, { maxEntryBytes: lim.maxPartBytes })) } catch (e) {
    if (e instanceof ZipError) throw new XlsxError('ZIP_' + e.code, `The workbook could not be read: ${e.message}`)
    throw e
  }
}

export async function readXlsx(input, limits = {}) {
  const lim = { ...XLSX_DEFAULT_LIMITS, ...limits }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length > lim.maxFileBytes) throw new XlsxError('FILE_TOO_BIG', `The workbook is larger than ${Math.round(lim.maxFileBytes / 1048576)} MB`)
  if (OLE2_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new XlsxError('OLE2', 'This is an old .xls file or a password-protected workbook. Open it in Excel and use File > Save As > Excel Workbook (.xlsx), without a password')
  }
  let entries
  try { entries = listZip(bytes, { maxEntries: 500, maxTotalBytes: lim.maxTotalBytes }) } catch (e) {
    if (e instanceof ZipError) throw new XlsxError(e.code === 'NOT_A_ZIP' ? 'NOT_XLSX' : 'ZIP_' + e.code, e.code === 'NOT_A_ZIP' ? 'This file is not an .xlsx workbook' : `The workbook could not be read: ${e.message}`)
    throw e
  }
  if (entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name))) throw new XlsxError('MACROS', 'Macro-enabled workbooks (.xlsm) are not accepted. Save the file as a plain .xlsx')
  if (entries.some((e) => /^xl\/externalLinks\//i.test(e.name))) throw new XlsxError('EXTERNAL_LINKS', 'Workbooks with links to other files are not accepted. Copy the values into a new workbook')

  const workbookXml = await readPart(bytes, entries, 'xl/workbook.xml', lim)
  const wb = parseXml(workbookXml, 'xl/workbook.xml')
  const date1904 = byLocalName(wb, 'workbookPr').some((el) => attr(el, 'date1904') === '1' || attr(el, 'date1904') === 'true')

  const relsXml = await readPart(bytes, entries, 'xl/_rels/workbook.xml.rels', lim)
  const relTargets = new Map()
  for (const rel of byLocalName(parseXml(relsXml, 'workbook relationships'), 'Relationship')) {
    let target = attr(rel, 'Target') || ''
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const parts = []
    for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg) }
    relTargets.set(attr(rel, 'Id'), parts.join('/'))
  }

  // shared strings
  const sharedXml = await readPart(bytes, entries, 'xl/sharedStrings.xml', lim, true)
  const shared = []
  if (sharedXml) {
    const sis = byLocalName(parseXml(sharedXml, 'xl/sharedStrings.xml'), 'si')
    if (sis.length > lim.maxSharedStrings) throw new XlsxError('TOO_MANY_STRINGS', 'The workbook holds too many distinct text values')
    for (const si of sis) {
      const t = richText(si)
      if (t.length > lim.maxCellChars) throw new XlsxError('CELL_TOO_LARGE', `A cell holds more than ${lim.maxCellChars} characters`)
      shared.push(t)
    }
  }

  // which cell formats are dates
  const stylesXml = await readPart(bytes, entries, 'xl/styles.xml', lim, true)
  const dateXf = []
  if (stylesXml) {
    const st = parseXml(stylesXml, 'xl/styles.xml')
    const customDate = new Map()
    for (const nf of byLocalName(st, 'numFmt')) customDate.set(Number(attr(nf, 'numFmtId')), isDateFormat(attr(nf, 'formatCode')))
    const cellXfs = byLocalName(st, 'cellXfs')[0]
    if (cellXfs) {
      for (const xf of Array.from(cellXfs.childNodes).filter((n) => n.nodeType === 1 && n.localName === 'xf')) {
        const id = Number(attr(xf, 'numFmtId') || 0)
        dateXf.push(customDate.has(id) ? customDate.get(id) : BUILTIN_DATE_IDS.has(id))
      }
    }
  }

  const sheets = []
  for (const sheetEl of byLocalName(wb, 'sheet')) {
    const name = attr(sheetEl, 'name') || ''
    const state = attr(sheetEl, 'state') || 'visible'
    const target = relTargets.get(attrNS(sheetEl, 'id'))
    if (!target || !/^xl\/worksheets\//i.test(target)) continue           // chartsheets / dialogsheets carry no cells
    const sheetXml = await readPart(bytes, entries, target, lim)
    const doc = parseXml(sheetXml, target)
    const rows = []
    let seqRow = 0
    for (const rowEl of byLocalName(doc, 'row')) {
      seqRow += 1
      const rIndex = Number(attr(rowEl, 'r')) || seqRow
      seqRow = rIndex
      if (rIndex > lim.maxRows) {
        if (Array.from(rowEl.childNodes).some((c) => c.nodeType === 1 && c.localName === 'c' && c.textContent.trim() !== '')) {
          throw new XlsxError('TOO_MANY_ROWS', `The sheet "${name}" has data beyond row ${lim.maxRows}`)
        }
        continue
      }
      let seqCol = -1
      for (const c of Array.from(rowEl.childNodes).filter((n) => n.nodeType === 1 && n.localName === 'c')) {
        const ref = parseRef(attr(c, 'r'))
        seqCol = ref ? ref.col : seqCol + 1
        if (seqCol >= lim.maxCols) {
          if (c.textContent.trim() !== '') throw new XlsxError('TOO_MANY_COLUMNS', `The sheet "${name}" has data beyond column ${lim.maxCols}`)
          continue
        }
        const t = attr(c, 't')
        const vEl = Array.from(c.childNodes).find((n) => n.nodeType === 1 && n.localName === 'v')
        const isEl = Array.from(c.childNodes).find((n) => n.nodeType === 1 && n.localName === 'is')
        let value = null
        if (t === 'inlineStr') value = isEl ? richText(isEl) : ''
        else if (vEl) {
          const raw = vEl.textContent
          if (t === 's') { const i = Number(raw); value = Number.isInteger(i) && i >= 0 && i < shared.length ? shared[i] : null }
          else if (t === 'str') value = raw
          else if (t === 'b') value = raw === '1' || raw.toLowerCase() === 'true'
          else if (t === 'e') value = raw
          else if (t === 'd') value = raw
          else {
            const num = Number(raw)
            if (raw.trim() === '' || !Number.isFinite(num)) value = raw.trim() === '' ? null : raw
            else if (dateXf[Number(attr(c, 's') || 0)]) value = serialToIso(num, date1904) ?? num
            else value = num
          }
        }
        if (typeof value === 'string' && value.length > lim.maxCellChars) throw new XlsxError('CELL_TOO_LARGE', `A cell holds more than ${lim.maxCellChars} characters`)
        if (value === null || value === '') continue
        while (rows.length < rIndex) rows.push([])
        const row = rows[rIndex - 1]
        while (row.length < seqCol) row.push(null)
        row[seqCol] = value
      }
    }
    sheets.push({ name, state, rows })
  }
  if (!sheets.length) throw new XlsxError('NO_SHEETS', 'The workbook has no worksheets')
  return { sheets }
}