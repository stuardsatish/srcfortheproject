// Builds the OFFICIAL import template, the demo workbook and the sample report as .xlsx — with the dependency-free writer, so the same
// code produces the downloadable files (admin page: "Download template", with the store's real categories), the static files
// in public/templates/ (scripts/build-import-template.mjs, tools/browser-test/Build-ImportTemplates.ps1) and the tests.
// Pure, no DOM.  Spec: BULK_UPLOAD_TEMPLATE_GUIDE.md.
import { COLUMNS, SHEET_NAME } from './columns.js'
import { buildXlsx, colLetter } from './xlsxWriter.js'
import { DEMO_ROWS } from './demoData.js'

export const TEMPLATE_VERSION = '2026-10-17'
export const LAST_DATA_ROW = 1002     // dropdowns / number rules are applied to rows 3..1002 (the importer accepts up to 1000 product rows)

const INSTRUCTIONS = [
  ['PRODUCT IMPORT — how to fill the "Products" sheet', 'title'],
  [`Template version ${TEMPLATE_VERSION}. Keep every column and its header text; you may leave optional columns empty. Do not rename or delete the sheets "Products" and "Lists".`],
  [''],
  ['THREE KINDS OF ROW (column "Product Type")', 'bold'],
  ['SINGLE — an ordinary product. Parent Import ID stays empty. It has its own price, SKU, stock and images.'],
  ['PARENT — a main product that has variants. It has ITS OWN price, SKU, stock and images (the price is NOT calculated from the variants; the main product can be bought by itself unless "Sell Main Product" = NO).'],
  ['VARIANT — one purchasable option of a PARENT. Put the parent\'s Import ID in "Parent Import ID". It has its own price, SKU, stock and (optionally) image. Rows may appear in any order.'],
  [''],
  ['IMPORT ID', 'bold'],
  ['A short stable name that never changes, for example SHIRT-002 / SHIRT-002-PINK. Letters, digits and . _ - only (max 64). Import IDs identify rows — never Excel row numbers. Importing the same file again does not create duplicates: unchanged products are skipped, changed content under an existing Import ID is refused (nothing is overwritten).'],
  [''],
  ['IMAGES', 'bold'],
  ['1. Put the pictures in a folder (sub-folders are fine) and compress it into ONE .zip file. 2. In "Main Image Filename" write the EXACT file name (SHIRT-002.jpg). 3. For several pictures use the "Additional Image Filenames" column: a.jpg|b.jpg (up to 8). 4. A full https:// address is also accepted and is stored as it is.'],
  ['Accepted: JPG, JPEG, PNG, WEBP, GIF — up to 5 MB each; the zip may hold up to 500 images (150 MB). Files are matched by NAME only, never by row order.'],
  [''],
  ['LISTS AND SEPARATORS', 'bold'],
  ['Where a cell holds several values, separate them with the | character: Tags  cotton|casual ;  Variant Attributes  Color=Pink|Size=M ;  Attribute Names  Color|Size.'],
  [''],
  ['RETURN / EXCHANGE POLICY', 'bold'],
  ['"Return Enabled" YES + "Return Window Days" (1–365), or NO with the days empty. The same for Exchange. On a SINGLE / PARENT row, empty = the store default (Admin > Optimization). On a VARIANT row, empty = inherit the parent.'],
  [''],
  ['OTHER RULES', 'bold'],
  ['Price: GST-inclusive ₹, up to 2 decimals. Discount applies to the whole product (leave it empty on VARIANT rows) and needs a Discount Expiry date. Stock: a whole number, or set Track Inventory = NO for unlimited. SKU must be unique in the file AND in the store.'],
  ['A row whose Import ID starts with # is ignored (that is how the grey example row works) — use it to keep notes or switch a row off.'],
  ['Nothing is imported until the whole file is valid. The importer shows every problem with its row number, column and a code (E0xx = must fix, W0xx = warning), then a preview, then asks you to confirm.'],
]

const LISTS = {
  types: ['SINGLE', 'PARENT', 'VARIANT'],
  yesNo: ['YES', 'NO'],
  status: ['ACTIVE', 'DRAFT', 'INACTIVE'],
}

function exampleRow() {
  const o = {
    importId: '# EXAMPLE — this grey row is ignored', type: 'SINGLE', name: 'Classic Shirt', sku: 'SHIRT-001', brand: 'Acme Wear', category: 'Shirts', tags: 'cotton|casual',
    shortDescription: 'Soft cotton shirt', description: 'Longer text', price: 500, gstRate: 5, hsn: '6205', stock: 50, trackInventory: 'YES', status: 'ACTIVE',
    mainImage: 'SHIRT-001.jpg', galleryImages: 'SHIRT-001-b.jpg', returnEnabled: 'YES', returnDays: 7, exchangeEnabled: 'YES', exchangeDays: 5, notes: 'Delete or keep: ignored',
  }
  return COLUMNS.map((c) => (o[c.key] === undefined ? null : { v: o[c.key], s: 'example' }))
}

const cellFor = (col, value) => {
  if (value === undefined || value === null || value === '') return null
  if (col.key === 'discountExpiry') return { date: String(value) }
  if (col.style === 'text') return { v: String(value), s: 'text' }
  return value
}

function validations(categoriesCount) {
  const range = (key) => { const i = COLUMNS.findIndex((c) => c.key === key); const L = colLetter(i); return `${L}3:${L}${LAST_DATA_ROW}` }
  const list = (key, ref, title) => ({ sqref: range(key), type: 'list', formula1: ref, errorTitle: title, error: 'Pick a value from the list.' })
  const out = [
    list('type', 'Lists!$A$2:$A$4', 'Product Type'),
    list('trackInventory', 'Lists!$B$2:$B$3', 'Track Inventory'),
    list('sellMain', 'Lists!$B$2:$B$3', 'Sell Main Product'),
    list('returnEnabled', 'Lists!$B$2:$B$3', 'Return Enabled'),
    list('exchangeEnabled', 'Lists!$B$2:$B$3', 'Exchange Enabled'),
    list('status', 'Lists!$C$2:$C$4', 'Status'),
    { sqref: range('returnDays'), type: 'whole', operator: 'between', formula1: '1', formula2: '365', errorTitle: 'Return Window Days', error: 'A whole number of days between 1 and 365 (empty when Return Enabled is NO).' },
    { sqref: range('exchangeDays'), type: 'whole', operator: 'between', formula1: '1', formula2: '365', errorTitle: 'Exchange Window Days', error: 'A whole number of days between 1 and 365 (empty when Exchange Enabled is NO).' },
    { sqref: range('stock'), type: 'whole', operator: 'greaterThanOrEqual', formula1: '0', errorTitle: 'Stock Quantity', error: 'A whole number, 0 or more.' },
    { sqref: range('sortOrder'), type: 'whole', operator: 'greaterThanOrEqual', formula1: '0', errorTitle: 'Sort Order', error: 'A whole number, 0 or more.' },
    { sqref: range('price'), type: 'decimal', operator: 'greaterThan', formula1: '0', errorTitle: 'Price', error: 'A number above 0.' },
    { sqref: range('gstRate'), type: 'decimal', operator: 'between', formula1: '0', formula2: '100', errorTitle: 'GST Rate %', error: 'A number between 0 and 100.' },
    { sqref: range('discount'), type: 'decimal', operator: 'between', formula1: '0', formula2: '100', errorTitle: 'Discount %', error: 'A number between 0 and 100 (leave empty on VARIANT rows).' },
  ]
  if (categoriesCount > 0) out.push({ ...list('category', `Lists!$D$2:$D$${categoriesCount + 1}`, 'Category'), errorStyle: 'warning', error: 'This category does not exist yet. Keep it to create a new category.' })
  return out
}

function sheets({ rows, categories = [] }) {
  const header = COLUMNS.map((c) => ({ v: c.header, s: c.required ? 'headerRequired' : 'headerOptional' }))
  const cats = categories.filter(Boolean).slice(0, 200)
  const listRows = [['Product Type', 'Yes / No', 'Status', 'Existing categories']]
  const n = Math.max(LISTS.types.length, LISTS.yesNo.length, LISTS.status.length, cats.length)
  for (let i = 0; i < n; i++) listRows.push([LISTS.types[i] ?? null, LISTS.yesNo[i] ?? null, LISTS.status[i] ?? null, cats[i] ?? null])
  return [
    {
      name: SHEET_NAME,
      rows: [header, ...rows],
      columns: COLUMNS.map((c) => ({ width: c.width, style: c.style })),
      freezeRows: 1,
      validations: validations(cats.length),
    },
    { name: 'Instructions', columns: [{ width: 140, style: 'wrap' }], rows: INSTRUCTIONS.map(([text, kind]) => [kind === 'title' || kind === 'bold' ? { v: text, s: 'bold' } : text || null]) },
    { name: 'Lists', state: 'hidden', rows: listRows },
  ]
}

/** The empty official template (header row, one grey example row, dropdowns, instructions). `categories`: the store's existing categories (optional). */
export function buildTemplateWorkbook({ categories = [] } = {}) {
  return buildXlsx({ sheets: sheets({ rows: [exampleRow()], categories }) })
}

/** The populated demo workbook (same sheets, DEMO_ROWS filled in, the example row removed). */
export function buildDemoWorkbook({ rows = DEMO_ROWS, categories = [] } = {}) {
  const body = rows.map((r) => COLUMNS.map((c) => cellFor(c, r[c.key])))
  return buildXlsx({ sheets: sheets({ rows: body, categories: categories.length ? categories : [...new Set(rows.map((r) => r.category).filter(Boolean))].sort() }) })
}

/** Rows of the demo as the importer would read them (headers + cell values): used by tests and by the sample report. */
export function demoCells2d(rows = DEMO_ROWS) {
  return [COLUMNS.map((c) => c.header), ...rows.map((r) => COLUMNS.map((c) => (r[c.key] === undefined ? null : r[c.key])))]
}