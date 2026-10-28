// Dependency-free .xlsx WRITER (Office Open XML SpreadsheetML) for the bulk importer's deliverables:
//   the official import template (dropdowns, frozen header), the demo workbook, and the import report.
// Pure ES module (no DOM) so the same code runs in the admin page ("Download template" / "Download report") and under Node
// (scripts/build-import-template.mjs) or headless Edge (tools/browser-test/Build-ImportTemplates.ps1).
//
// What it emits (the minimum Excel / LibreOffice / Google Sheets all open): [Content_Types], _rels, xl/workbook, xl/_rels,
// xl/styles (a fixed set of named styles), xl/sharedStrings, one xl/worksheets/sheetN.xml per sheet. Cell values are ALWAYS data:
// strings are shared-string cells, never formulas — so text such as "=cmd|' /C calc'!A0" opens as plain text (the report writer
// additionally prefixes dangerous leading characters, see escapeForSpreadsheet in report.js).
//
// SHEET INPUT
//   { name, state?: 'visible'|'hidden', rows: [[cell...]], columns?: [{ width?, style? }], freezeRows?: number,
//     validations?: [{ sqref, type?: 'list'|'whole'|'decimal', operator?, formula1, formula2?, errorTitle?, error?, promptTitle?, prompt?, allowBlank? }] }
//   cell: string | number | boolean | null | { v, s: styleName } | { date: 'YYYY-MM-DD', s? }
//   styles: default | headerRequired | headerOptional | example | text | date | wrap | bold
import { writeZip } from './zip.js'

const STYLE_IDS = { default: 0, headerRequired: 1, headerOptional: 2, example: 3, text: 4, date: 5, wrap: 6, bold: 7 }

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// characters that are illegal in XML 1.0 are dropped; the rest of the five XML specials are escaped
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F��]/g
export const xmlEscape = (s) => String(s).replace(ILLEGAL_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** 0 -> A, 25 -> Z, 26 -> AA … */
export function colLetter(index) {
  let n = index
  let s = ''
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

/** 'YYYY-MM-DD' -> Excel serial number (1900 date system). */
export function dateToSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${iso}`)
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000)
}

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="11"/><color rgb="FF808080"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF5B7FA6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function validationXml(v) {
  const type = v.type || 'list'
  const attrs = [`type="${type}"`]
  if (v.operator) attrs.push(`operator="${v.operator}"`)
  if (v.allowBlank !== false) attrs.push('allowBlank="1"')
  // errorStyle 'warning' lets the user type a value outside the list after a confirmation (used for Category: new ones are allowed)
  if (v.errorStyle) attrs.push(`errorStyle="${v.errorStyle}"`)
  attrs.push('showErrorMessage="1"')
  if (v.prompt) attrs.push('showInputMessage="1"')
  if (v.errorTitle) attrs.push(`errorTitle="${xmlEscape(v.errorTitle).slice(0, 32)}"`)
  if (v.error) attrs.push(`error="${xmlEscape(v.error).slice(0, 255)}"`)
  if (v.promptTitle) attrs.push(`promptTitle="${xmlEscape(v.promptTitle).slice(0, 32)}"`)
  if (v.prompt) attrs.push(`prompt="${xmlEscape(v.prompt).slice(0, 255)}"`)
  attrs.push(`sqref="${xmlEscape(v.sqref)}"`)
  return `<dataValidation ${attrs.join(' ')}><formula1>${xmlEscape(v.formula1)}</formula1>${v.formula2 != null ? `<formula2>${xmlEscape(v.formula2)}</formula2>` : ''}</dataValidation>`
}

/** Builds the .xlsx bytes. Deterministic: the same input gives byte-identical output. */
export async function buildXlsx({ sheets }) {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error('buildXlsx needs at least one sheet')
  const shared = []
  const sharedIndex = new Map()
  const sstId = (text) => {
    const t = String(text)
    let i = sharedIndex.get(t)
    if (i === undefined) { i = shared.length; shared.push(t); sharedIndex.set(t, i) }
    return i
  }
  const names = new Set()

  const sheetXml = sheets.map((sheet, sIdx) => {
    const name = String(sheet.name || '')
    if (!name || name.length > 31 || /[\\/?*[\]:]/.test(name) || names.has(name.toLowerCase())) throw new Error(`invalid or duplicate sheet name: "${name}"`)
    names.add(name.toLowerCase())
    const rows = sheet.rows || []
    let maxCol = 0
    const rowXml = rows.map((cells, r) => {
      const cellXml = []
      cells.forEach((cell, c) => {
        if (cell === null || cell === undefined || cell === '') return
        const ref = `${colLetter(c)}${r + 1}`
        let v = cell
        let style = null
        if (typeof cell === 'object' && cell !== null) {
          if (cell.date) { v = dateToSerial(cell.date); style = cell.s || 'date' } else { v = cell.v; style = cell.s || null }
        }
        if (v === null || v === undefined || v === '') {
          if (style) { cellXml.push(`<c r="${ref}" s="${STYLE_IDS[style]}"/>`); maxCol = Math.max(maxCol, c + 1) }
          return
        }
        const s = style ? ` s="${STYLE_IDS[style]}"` : ''
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) throw new Error(`non-finite number at ${name}!${ref}`)
          cellXml.push(`<c r="${ref}"${s}><v>${v}</v></c>`)
        } else if (typeof v === 'boolean') {
          cellXml.push(`<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`)
        } else {
          const text = String(v)
          if (text.length > 32767) throw new Error(`cell text longer than 32767 characters at ${name}!${ref}`)
          cellXml.push(`<c r="${ref}"${s} t="s"><v>${sstId(text)}</v></c>`)
        }
        maxCol = Math.max(maxCol, c + 1)
      })
      return cellXml.length ? `<row r="${r + 1}">${cellXml.join('')}</row>` : ''
    }).join('')

    const cols = (sheet.columns || []).map((col, i) => {
      if (!col) return ''
      const attrs = [`min="${i + 1}"`, `max="${i + 1}"`, `width="${col.width || 12}"`, 'customWidth="1"']
      if (col.style) attrs.push(`style="${STYLE_IDS[col.style]}"`)
      return `<col ${attrs.join(' ')}/>`
    }).join('')

    const freeze = sheet.freezeRows > 0
      ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.freezeRows + 1}" sqref="A${sheet.freezeRows + 1}"/>`
      : ''
    const dim = `A1:${colLetter(Math.max(0, maxCol - 1))}${Math.max(1, rows.length)}`
    const validations = (sheet.validations || []).length
      ? `<dataValidations count="${sheet.validations.length}">${sheet.validations.map(validationXml).join('')}</dataValidations>`
      : ''
    return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><dimension ref="${dim}"/>` +
      `<sheetViews><sheetView workbookViewId="0"${sIdx === 0 ? ' tabSelected="1"' : ''}>${freeze}</sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowXml}</sheetData>${validations}` +
      `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
  })

  const sstXml = `${XML_HEAD}<sst xmlns="${NS_MAIN}" count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((t) => `<si><t xml:space="preserve">${xmlEscape(t)}</t></si>`).join('') + '</sst>'

  const workbookXml = `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}"${s.state === 'hidden' ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'

  const n = sheets.length
  const workbookRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${n + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`

  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'

  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`

  // [Content_Types].xml first, as Office writes it
  return writeZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: STYLES_XML },
    { name: 'xl/sharedStrings.xml', data: sstXml },
    ...sheetXml.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
  ], { deflate: true })
}