// The columns of the official import template, their accepted aliases (so the legacy CSV importer's headers keep working) and
// header mapping. Pure. Spec: BULK_UPLOAD_TEMPLATE_GUIDE.md §3.
//
// `required` = the column must EXIST in the sheet (a missing header is error E090). Whether a CELL is required depends on the row
// type and is the validator's job. `legacyDefault` = value assumed when a legacy CSV has no such column.

export const SHEET_NAME = 'Products'

/** key, header, width (chars), style, required, applies, hint (used by the template's header notes and the Instructions sheet) */
export const COLUMNS = Object.freeze([
  { key: 'importId', header: 'Import ID', width: 20, required: true, style: 'text', applies: 'all', hint: 'Unique stable id, e.g. SHIRT-002. Letters, digits, . _ - only (max 64).' },
  { key: 'type', header: 'Product Type', width: 14, required: true, applies: 'all', hint: 'SINGLE, PARENT (main product that has variants) or VARIANT.' },
  { key: 'parentId', header: 'Parent Import ID', width: 20, required: false, style: 'text', applies: 'VARIANT', hint: 'VARIANT rows: the Import ID of their PARENT row. Blank otherwise.' },
  { key: 'name', header: 'Product Name', width: 30, required: true, applies: 'SINGLE, PARENT', hint: 'Shown to customers. Max 200 characters.' },
  { key: 'variantName', header: 'Variant Name', width: 18, required: false, applies: 'VARIANT', hint: 'e.g. Pink. Unique within the parent. Max 100.' },
  { key: 'sku', header: 'SKU', width: 20, required: true, style: 'text', applies: 'all', hint: 'Unique across the file AND the store (products + variants).' },
  { key: 'brand', header: 'Brand', width: 16, required: false, applies: 'SINGLE, PARENT', hint: '' },
  { key: 'category', header: 'Category', width: 18, required: true, applies: 'SINGLE, PARENT', hint: 'Pick an existing category or type a new one.' },
  { key: 'tags', header: 'Tags', width: 22, required: false, applies: 'SINGLE, PARENT', hint: 'a|b|c — up to 20 tags.' },
  { key: 'shortDescription', header: 'Short Description', width: 30, required: false, applies: 'SINGLE, PARENT', hint: 'Max 300 characters.' },
  { key: 'description', header: 'Description', width: 40, required: false, applies: 'SINGLE, PARENT', hint: 'Max 5000 characters.' },
  { key: 'price', header: 'Price', width: 10, required: true, applies: 'all', hint: 'GST-inclusive selling price in ₹. A PARENT has its OWN price, independent of its variants.' },
  { key: 'gstRate', header: 'GST Rate %', width: 10, required: false, applies: 'SINGLE, PARENT', hint: '0–100. Variants use the parent’s rate.' },
  { key: 'hsn', header: 'HSN Code', width: 12, required: false, style: 'text', applies: 'SINGLE, PARENT', hint: 'Max 16 characters.' },
  { key: 'discount', header: 'Discount %', width: 10, required: false, applies: 'SINGLE, PARENT', hint: '0–100. Applies to the product and all its variants — leave blank on VARIANT rows.' },
  { key: 'discountExpiry', header: 'Discount Expiry', width: 14, required: false, style: 'date', applies: 'SINGLE, PARENT', hint: 'Required when Discount > 0. Last day of the discount (YYYY-MM-DD).' },
  { key: 'stock', header: 'Stock Quantity', width: 10, required: true, applies: 'all', hint: 'Whole number ≥ 0. May be blank only when Track Inventory = NO.' },
  { key: 'trackInventory', header: 'Track Inventory', width: 12, required: false, applies: 'all', hint: 'YES (default) or NO = unlimited stock.' },
  { key: 'status', header: 'Status', width: 12, required: false, applies: 'all', hint: 'SINGLE/PARENT: ACTIVE (default) or DRAFT. VARIANT: ACTIVE (default) or INACTIVE.' },
  { key: 'sellMain', header: 'Sell Main Product', width: 12, required: false, applies: 'PARENT', hint: 'YES (default) or NO — may the main product itself be bought?' },
  { key: 'attributeNames', header: 'Attribute Names', width: 18, required: false, applies: 'PARENT', hint: 'e.g. Color|Size (max 3). Blank = taken from the variants.' },
  { key: 'variantAttributes', header: 'Variant Attributes', width: 24, required: false, applies: 'VARIANT', hint: 'e.g. Color=Pink|Size=M' },
  { key: 'sortOrder', header: 'Sort Order', width: 10, required: false, applies: 'VARIANT', hint: 'Whole number; default = row order.' },
  { key: 'mainImage', header: 'Main Image Filename', width: 26, required: true, applies: 'all', hint: 'Exact file name in the images ZIP (SHIRT-002.jpg) or a full https:// URL.' },
  { key: 'galleryImages', header: 'Additional Image Filenames', width: 30, required: false, applies: 'all', hint: 'a.jpg|b.jpg — up to 8.' },
  { key: 'returnEnabled', header: 'Return Enabled', width: 12, required: false, applies: 'all', hint: 'YES / NO / blank (store default; VARIANT rows inherit the parent).' },
  { key: 'returnDays', header: 'Return Window Days', width: 12, required: false, applies: 'all', hint: '1–365. Required when Return Enabled = YES; blank when NO.' },
  { key: 'exchangeEnabled', header: 'Exchange Enabled', width: 12, required: false, applies: 'all', hint: 'YES / NO / blank.' },
  { key: 'exchangeDays', header: 'Exchange Window Days', width: 12, required: false, applies: 'all', hint: '1–365. Required when Exchange Enabled = YES; blank when NO.' },
  { key: 'notes', header: 'Notes', width: 24, required: false, applies: 'all', hint: 'Ignored by the importer.' },
])

/** Header text -> comparison key: lower-case letters and digits only ("GST Rate %" -> "gstrate"). */
export const headerKey = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// extra spellings per column. The LEGACY CSV importer's headers (constants/productImportHeaders.js: title, category, price, stock,
// brand, sku, gstRate, hsnCode, shortDescription, description, image + aliases name, SKU, gst, hsn, thumbnail) are all here.
const ALIASES = {
  importId: ['id', 'key', 'importkey', 'importid'],
  type: ['type', 'producttype', 'rowtype'],
  parentId: ['parent', 'parentid', 'parentimportid', 'parentkey'],
  name: ['name', 'title', 'productname', 'producttitle'],
  variantName: ['variant', 'variantname', 'variantlabel'],
  sku: ['sku', 'itemcode'],
  brand: ['brand'],
  category: ['category', 'cat'],
  tags: ['tags', 'tag'],
  shortDescription: ['shortdescription', 'shortdesc'],
  description: ['description', 'desc'],
  price: ['price', 'sellingprice'],
  gstRate: ['gstrate', 'gst', 'gstpercent'],
  hsn: ['hsncode', 'hsn'],
  discount: ['discount', 'discountpercent'],
  discountExpiry: ['discountexpiry', 'discountexpires', 'discountenddate'],
  stock: ['stockquantity', 'stock', 'qty', 'quantity'],
  trackInventory: ['trackinventory', 'trackstock'],
  status: ['status', 'productstatus'],
  sellMain: ['sellmainproduct', 'sellmain'],
  attributeNames: ['attributenames', 'attributes'],
  variantAttributes: ['variantattributes'],
  sortOrder: ['sortorder'],
  mainImage: ['mainimagefilename', 'mainimage', 'image', 'thumbnail', 'imagefilename'],
  galleryImages: ['additionalimagefilenames', 'additionalimages', 'gallery', 'galleryimages'],
  returnEnabled: ['returnenabled'],
  returnDays: ['returnwindowdays', 'returndays', 'returnwindow'],
  exchangeEnabled: ['exchangeenabled'],
  exchangeDays: ['exchangewindowdays', 'exchangedays', 'exchangewindow'],
  notes: ['notes', 'note', 'remarks'],
}

const KEY_BY_HEADER = new Map()
for (const col of COLUMNS) {
  KEY_BY_HEADER.set(headerKey(col.header), col.key)
  for (const a of ALIASES[col.key] || []) if (!KEY_BY_HEADER.has(a)) KEY_BY_HEADER.set(a, col.key)
}
// `attributes` (legacy name) is ambiguous: on a PARENT it means the attribute NAMES, on a VARIANT the pairs.
// It maps to attributeNames; the validator also reads it for variant rows when variantAttributes is absent (legacy parity).

/**
 * Maps a header row to column indexes.
 * Returns { map: Map(key -> index), unknown: [{ index, header }], missing: [header...], legacy: boolean, headerRow }.
 * `legacy` = a plain CSV in the OLD importer's shape (no Import ID / Product Type columns): rows are treated as SINGLE products.
 */
export function mapHeaders(headerCells) {
  const map = new Map()
  const unknown = []
  const duplicate = []
  headerCells.forEach((cell, index) => {
    const text = String(cell ?? '').trim()
    if (!text) return
    const key = KEY_BY_HEADER.get(headerKey(text))
    if (!key) { unknown.push({ index, header: text }); return }
    if (map.has(key)) { duplicate.push({ index, header: text }); return }
    map.set(key, index)
  })
  const legacy = !map.has('importId') && !map.has('type')
  const missing = []
  for (const col of COLUMNS) {
    if (map.has(col.key)) continue
    // the old importer only ever required title / category / price (SKU, stock and the image were optional there)
    const needed = legacy ? ['name', 'category', 'price'].includes(col.key) : col.required
    if (needed) missing.push(col.header)
  }
  return { map, unknown, duplicate, missing, legacy }
}

/** How many recognised headers a row has (used to find the header row: the first row with at least 3). */
export function recognisedHeaderCount(cells) {
  let n = 0
  const seen = new Set()
  for (const c of cells) {
    const key = KEY_BY_HEADER.get(headerKey(c))
    if (key && !seen.has(key)) { seen.add(key); n += 1 }
  }
  return n
}