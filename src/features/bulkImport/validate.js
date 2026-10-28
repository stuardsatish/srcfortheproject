// Bulk-import VALIDATION + PLAN builder. Pure (no I/O, no DOM) -> unit-tested: __tests__/validate.test.mjs.
// Spec: BULK_UPLOAD_TEMPLATE_GUIDE.md (§3 columns, §4 rules, §5 error catalogue). The SERVER validates again at stage time
// (migration 20261017_02 import_stage_batch dry-runs the real save_product); this module exists so the admin sees every problem,
// row by row, BEFORE any network write, and gets a preview of exactly what would be created.
//
// INPUT   cells2d    rows of cells as xlsxReader returns them (rows[i] = Excel row i+1) — or a CSV parsed to the same shape
//         imageFiles array of { name, path?, size, problem?: 'type'|'size'|'content'|'unsafe' } | null when no images were supplied
// OUTPUT  { ok, fatal, issues[], counts, rows[], groups[], imageRefs[], unusedImages[], summary }
//   issue  { severity: 'error'|'warning'|'info', code, row, column, importId, message }   (row 0 = the file itself)
//   group  { import_key, row, kind: 'single'|'parent', product, images: { main, gallery }, variants: [ { import_key, row, …, images } ] }
//          — the exact documents import_stage_batch receives. Image values are file names or https URLs, never paths.
import { COLUMNS, mapHeaders, recognisedHeaderCount } from './columns.js'
import {
  cleanLine, cleanText, parseNumber, parseInteger, parseYesNo, parseDate, splitList, parseAttributePairs, keyOf,
  isValidImportId, isValidImageFileName, IMAGE_EXTENSIONS, extensionOf, isUrl,
} from './normalize.js'

export const LIMITS = Object.freeze({
  maxDataRows: 1000, maxImageBytes: 5 * 1024 * 1024, maxGallery: 8, maxTags: 20, maxTagLength: 40,
  maxAttributeNames: 3, maxAttributeValue: 40, maxName: 200, maxVariantName: 100, maxSku: 64, maxCategory: 100, maxBrand: 100,
  maxShort: 300, maxDescription: 5000, maxHsn: 16, maxPrice: 10000000, maxStock: 100000000,
})

const TYPES = ['SINGLE', 'PARENT', 'VARIANT']
const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]))
const headerOf = (key) => COLUMN_BY_KEY.get(key)?.header || key

/** Levenshtein distance, capped (for "did you mean SHIRT-002?"). */
function distance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}
const closest = (candidates, target) => {
  let best = null
  let bestD = 3
  for (const c of candidates) { const d = distance(keyOf(c), keyOf(target)); if (d < bestD) { bestD = d; best = c } }
  return best
}

/** Excel row -> is it a data row? Blank rows and rows whose Import ID starts with '#' (the template's example row) are skipped. */
const isCommentId = (v) => cleanLine(v).startsWith('#')

export function validateImport({ cells2d, imageFiles = null, today = new Date() } = {}) {
  const issues = []
  const add = (severity, code, row, column, importId, message) => issues.push({ severity, code, row, column, importId: importId || '', message })
  const err = (code, row, column, importId, message) => add('error', code, row, column, importId, message)
  const warn = (code, row, column, importId, message) => add('warning', code, row, column, importId, message)
  const info = (code, row, column, importId, message) => add('info', code, row, column, importId, message)
  const finish = (extra) => finalise({ issues, ...extra })

  const rowsIn = Array.isArray(cells2d) ? cells2d : []

  // ── 1. header row ───────────────────────────────────────────────────────────────────────────────────────────────
  let headerIdx = -1
  for (let i = 0; i < Math.min(rowsIn.length, 30); i++) {
    if (recognisedHeaderCount(rowsIn[i] || []) >= 3) { headerIdx = i; break }
  }
  if (headerIdx < 0) {
    err('E090', 0, '', '', 'No header row found. Use the official template (the first row must contain headers such as "Import ID", "Product Type", "Product Name", "SKU", "Price").')
    return finish({ fatal: true })
  }
  const headers = mapHeaders(rowsIn[headerIdx] || [])
  for (const h of headers.missing) err('E090', headerIdx + 1, h, '', `The column "${h}" is missing from the sheet. Download the official template and keep every column.`)
  for (const d of headers.duplicate) err('E090', headerIdx + 1, d.header, '', `The column "${d.header}" appears more than once.`)
  for (const u of headers.unknown) warn('W006', headerIdx + 1, u.header, '', `The column "${u.header}" is not part of the template and is ignored.`)
  if (headers.legacy) info('I001', headerIdx + 1, '', '', 'Old CSV layout detected: every row is imported as a SINGLE product; the Import ID is taken from the SKU (or the row number).')
  if (headers.missing.length || headers.duplicate.length) return finish({ fatal: true })
  const col = headers.map
  const legacy = headers.legacy

  // ── 2. data rows ────────────────────────────────────────────────────────────────────────────────────────────────
  const data = []
  for (let i = headerIdx + 1; i < rowsIn.length; i++) {
    const cells = rowsIn[i] || []
    const isEmpty = !cells.some((c) => cleanLine(c) !== '')
    if (isEmpty) continue
    if (col.has('importId') && isCommentId(cells[col.get('importId')])) continue
    data.push({ row: i + 1, cells })
  }
  if (data.length === 0) {
    err('E090', 0, '', '', 'The sheet has no product rows below the header.')
    return finish({ fatal: true })
  }
  if (data.length > LIMITS.maxDataRows) {
    err('E080', 0, '', '', `The sheet has ${data.length} product rows; the limit is ${LIMITS.maxDataRows}. Split the file.`)
    return finish({ fatal: true })
  }

  // ── 3. images supplied? ────────────────────────────────────────────────────────────────────────────────────────
  const imageIndex = new Map()    // lower-case base name -> { name, size, problem, count }
  for (const f of imageFiles || []) {
    const base = String(f.name).replace(/\\/g, '/').split('/').pop()
    const k = keyOf(base)
    const cur = imageIndex.get(k)
    if (cur) cur.count += 1
    else imageIndex.set(k, { name: base, size: f.size, problem: f.problem || null, count: 1, used: false })
  }
  const imageRefs = new Map()     // lower-case ref -> { ref, kind, usedBy: [{ importKey, role }] }
  const refImage = (value, row, column, importId, role) => {
    const text = cleanLine(value)
    if (!text) return ''
    if (isUrl(text)) {
      if (!/^https:\/\//i.test(text)) warn('W007', row, column, importId, 'This image URL uses http:// — use https:// so browsers do not block it.')
      if (text.length > 2000) { err('E055', row, column, importId, 'The image URL is longer than 2000 characters.'); return '' }
      const k = `url:${text}`
      if (!imageRefs.has(k)) imageRefs.set(k, { ref: text, kind: 'url', usedBy: [] })
      imageRefs.get(k).usedBy.push({ importKey: importId, role })
      return text
    }
    if (!isValidImageFileName(text)) { err('E055', row, column, importId, `"${text}" is not a plain image file name (letters, digits, space . _ - ( ) only, no folders).`); return '' }
    const ext = extensionOf(text)
    if (!IMAGE_EXTENSIONS.includes(ext)) { err('E051', row, column, importId, `"${text}" is not a supported image type (${IMAGE_EXTENSIONS.join(', ')}).`); return '' }
    const k = `file:${keyOf(text)}`
    if (!imageRefs.has(k)) imageRefs.set(k, { ref: text, kind: 'file', usedBy: [] })
    imageRefs.get(k).usedBy.push({ importKey: importId, role })
    const hit = imageIndex.get(keyOf(text))
    if (imageFiles === null) { err('E050', row, column, importId, `"${text}" needs the images ZIP, but no ZIP / image files were selected.`); return text }
    if (!hit) { err('E050', row, column, importId, `Image "${text}" was not found in the ZIP.`); return text }
    hit.used = true
    if (hit.count > 1) err('E053', row, column, importId, `More than one file called "${hit.name}" is in the ZIP (different folders) — it is ambiguous. Keep one.`)
    else if (hit.problem === 'size') err('E052', row, column, importId, `Image "${hit.name}" is larger than ${LIMITS.maxImageBytes / 1048576} MB.`)
    else if (hit.problem === 'type') err('E051', row, column, importId, `"${hit.name}" is not a supported image.`)
    else if (hit.problem === 'content') err('E054', row, column, importId, `"${hit.name}" is not really ${extensionOf(hit.name).toUpperCase()}: its content does not match its extension.`)
    else if (hit.problem === 'unsafe') err('E055', row, column, importId, `"${hit.name}" has an unsafe path in the ZIP.`)
    return text
  }

  // ── 4. parse every row ──────────────────────────────────────────────────────────────────────────────────────────
  const get = (cells, key) => (col.has(key) ? cells[col.get(key)] : undefined)
  const recs = []
  const seenIds = new Map()     // lower id -> row
  const seenSkus = new Map()    // lower sku -> row

  for (const { row, cells } of data) {
    const rec = { row, errorsBefore: issues.filter((x) => x.severity === 'error').length }
    const cell = (k) => cleanLine(get(cells, k))

    // type
    let type = legacy ? 'SINGLE' : cell('type').toUpperCase()
    // import id
    let importId = cell('importId')
    if (legacy && !importId) {
      const sku = cell('sku')
      importId = (sku || `ROW-${row}`).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64)
    }
    rec.importId = importId
    const E = (code, k, message) => err(code, row, headerOf(k), importId, message)
    const W = (code, k, message) => warn(code, row, headerOf(k), importId, message)

    if (!importId) E('E001', 'importId', 'Import ID is missing.')
    else if (!isValidImportId(importId)) E('E003', 'importId', `Import ID "${importId}" is invalid: use letters, digits and . _ - only (max 64 characters, never "_var_").`)
    else {
      const k = keyOf(importId)
      if (seenIds.has(k)) E('E002', 'importId', `Import ID "${importId}" is already used on row ${seenIds.get(k)}.`)
      else seenIds.set(k, row)
    }

    if (!TYPES.includes(type)) {
      E('E010', 'type', type ? `Product Type "${cell('type')}" is not valid — use SINGLE, PARENT or VARIANT.` : 'Product Type is missing — use SINGLE, PARENT or VARIANT.')
      type = ''
    }
    rec.type = type

    // SKU
    const sku = cell('sku')
    rec.sku = sku
    if (!sku) { if (!legacy) E('E022', 'sku', 'SKU is missing.') }
    else if (sku.length > LIMITS.maxSku) E('E025', 'sku', `SKU is longer than ${LIMITS.maxSku} characters.`)
    else {
      const k = keyOf(sku)
      if (seenSkus.has(k)) E('E023', 'sku', `SKU "${sku}" is already used on row ${seenSkus.get(k)} of this file.`)
      else seenSkus.set(k, row)
    }

    // inventory
    const trackP = parseYesNo(get(cells, 'trackInventory'))
    if (!trackP.ok) E('E100', 'trackInventory', `Track Inventory "${cell('trackInventory')}" is not valid — use YES or NO.`)
    rec.track = trackP.ok && trackP.value !== null ? trackP.value : true
    const stockRaw = get(cells, 'stock')
    const stockP = parseInteger(stockRaw)
    if (!stockP.ok || (stockP.value !== null && (stockP.value < 0 || stockP.value > LIMITS.maxStock))) {
      E('E031', 'stock', `Stock Quantity "${cell('stock')}" must be a whole number, 0 or more.`)
    } else if (stockP.value === null && rec.track && !legacy) {
      E('E031', 'stock', 'Stock Quantity is required while Track Inventory is YES (use 0 for none, or set Track Inventory to NO).')
    } else rec.stock = stockP.value === null ? 0 : stockP.value

    // status
    const statusText = cell('status').toUpperCase()
    const allowed = type === 'VARIANT' ? ['ACTIVE', 'INACTIVE'] : ['ACTIVE', 'DRAFT']
    if (statusText && !allowed.includes(statusText)) E('E100', 'status', `Status "${cell('status')}" is not valid for a ${type || 'row'} — use ${allowed.join(' or ')}.`)
    rec.status = (statusText && allowed.includes(statusText) ? statusText : 'ACTIVE').toLowerCase()
    if (type !== 'VARIANT' && rec.status === 'draft') W('W005', 'status', 'DRAFT products are currently still visible to customers (known issue P-8) — keep this in mind before importing.')

    // price
    const priceP = parseNumber(get(cells, 'price'))
    const sellMainP = parseYesNo(get(cells, 'sellMain'))
    if (type === 'PARENT' && !sellMainP.ok) E('E100', 'sellMain', `Sell Main Product "${cell('sellMain')}" is not valid — use YES or NO.`)
    rec.sellMain = type === 'PARENT' ? (sellMainP.ok && sellMainP.value !== null ? sellMainP.value : true) : true
    const priceOptional = type === 'PARENT' && !rec.sellMain
    if (!priceP.ok || (priceP.value !== null && (priceP.value < 0 || priceP.value > LIMITS.maxPrice || Math.round(priceP.value * 100) / 100 !== priceP.value))) {
      E('E030', 'price', `Price "${cell('price')}" is not valid — a number with at most 2 decimals (for example 499 or 499.50).`)
    } else if (priceP.value === null || priceP.value === 0) {
      if (!priceOptional) E('E030', 'price', priceP.value === 0 ? 'Price must be greater than 0.' : 'Price is missing.')
      else rec.price = 0
    } else rec.price = priceP.value

    // return / exchange policy
    for (const side of ['return', 'exchange']) {
      const flagKey = `${side}Enabled`
      const daysKey = `${side}Days`
      const flag = parseYesNo(get(cells, flagKey))
      const daysP = parseInteger(get(cells, daysKey))
      if (!flag.ok) { E('E100', flagKey, `${headerOf(flagKey)} "${cell(flagKey)}" is not valid — use YES, NO or leave it blank.`); continue }
      if (!daysP.ok || (daysP.value !== null && (daysP.value < 1 || daysP.value > 365))) { E('E040', daysKey, `${headerOf(daysKey)} "${cell(daysKey)}" must be a whole number of days between 1 and 365.`); continue }
      if (flag.value === true && daysP.value === null) E('E040', daysKey, `${headerOf(daysKey)} is required when ${headerOf(flagKey)} is YES.`)
      else if (flag.value === false && daysP.value !== null) E('E040', daysKey, `${headerOf(daysKey)} must be blank when ${headerOf(flagKey)} is NO.`)
      else if (flag.value === null && daysP.value !== null) E('E040', flagKey, `${headerOf(flagKey)} is blank but ${headerOf(daysKey)} has a value — set it to YES or clear the days.`)
      else if (flag.value !== null) rec[side] = { enabled: flag.value, days: flag.value ? daysP.value : null }
    }

    // images
    rec.mainImage = refImage(get(cells, 'mainImage'), row, headerOf('mainImage'), importId, 'main')
    const gallery = splitList(get(cells, 'galleryImages'))
    if (gallery.length > LIMITS.maxGallery) E('E026', 'galleryImages', `At most ${LIMITS.maxGallery} additional images are allowed (found ${gallery.length}).`)
    rec.gallery = gallery.slice(0, LIMITS.maxGallery).map((g) => refImage(g, row, headerOf('galleryImages'), importId, 'gallery')).filter(Boolean)
    if (type !== 'VARIANT' && !cell('mainImage') && !legacy) E('E050', 'mainImage', 'Main Image Filename is required for SINGLE and PARENT rows.')

    if (type === 'VARIANT') {
      rec.parentId = cell('parentId')
      rec.variantName = cell('variantName')
      rec.productName = cell('name')
      if (!rec.parentId) E('E011', 'parentId', 'A VARIANT row needs the Import ID of its PARENT row in "Parent Import ID".')
      if (!rec.variantName) E('E016', 'variantName', 'Variant Name is missing.')
      else if (rec.variantName.length > LIMITS.maxVariantName) E('E026', 'variantName', `Variant Name is longer than ${LIMITS.maxVariantName} characters.`)
      if (cell('discount') !== '' || cell('discountExpiry') !== '') E('E034', 'discount', 'Discount is set at product level and applies to all variants — leave Discount (and its expiry) blank on VARIANT rows.')
      const so = parseInteger(get(cells, 'sortOrder'))
      if (!so.ok || (so.value !== null && (so.value < 0 || so.value > 100000))) E('E100', 'sortOrder', `Sort Order "${cell('sortOrder')}" must be a whole number, 0 or more.`)
      else rec.sortOrder = so.value
      // attributes: 'variantAttributes' (template) — the legacy single "attributes" column is read for parity
      const attrText = col.has('variantAttributes') ? get(cells, 'variantAttributes') : ''
      const pairs = parseAttributePairs(attrText)
      if (!pairs.ok) E('E060', 'variantAttributes', `Variant Attributes must look like Color=Pink|Size=M — "${pairs.bad}" is not valid.`)
      else rec.pairs = pairs.value
      for (const [k, v] of rec.pairs || []) {
        if (k.length > LIMITS.maxAttributeValue || v.length > LIMITS.maxAttributeValue) E('E060', 'variantAttributes', `Attribute names and values may be at most ${LIMITS.maxAttributeValue} characters ("${k}=${v}").`)
      }
    } else if (type === 'SINGLE' || type === 'PARENT') {
      if (cell('parentId')) E('E015', 'parentId', `A ${type} row must not have a Parent Import ID.`)
      rec.name = cleanLine(get(cells, 'name'))
      if (!rec.name) E('E020', 'name', 'Product Name is missing.')
      else if (rec.name.length > LIMITS.maxName) E('E026', 'name', `Product Name is longer than ${LIMITS.maxName} characters.`)
      rec.category = cell('category')
      if (!rec.category) E('E021', 'category', 'Category is missing.')
      else if (rec.category.length > LIMITS.maxCategory) E('E026', 'category', `Category is longer than ${LIMITS.maxCategory} characters.`)
      rec.brand = cell('brand')
      if (rec.brand.length > LIMITS.maxBrand) E('E026', 'brand', `Brand is longer than ${LIMITS.maxBrand} characters.`)
      rec.shortDescription = cleanText(get(cells, 'shortDescription'))
      if (rec.shortDescription.length > LIMITS.maxShort) E('E026', 'shortDescription', `Short Description is longer than ${LIMITS.maxShort} characters.`)
      rec.description = cleanText(get(cells, 'description'))
      if (rec.description.length > LIMITS.maxDescription) E('E026', 'description', `Description is longer than ${LIMITS.maxDescription} characters.`)
      rec.hsn = cell('hsn')
      if (rec.hsn.length > LIMITS.maxHsn) E('E026', 'hsn', `HSN Code is longer than ${LIMITS.maxHsn} characters.`)

      const gst = parseNumber(get(cells, 'gstRate'))
      if (!gst.ok || (gst.value !== null && (gst.value < 0 || gst.value > 100))) E('E032', 'gstRate', `GST Rate "${cell('gstRate')}" must be a number between 0 and 100.`)
      else rec.gstRate = gst.value ?? 0

      // tags
      const rawTags = splitList(get(cells, 'tags'))
      const tags = []
      for (const t of rawTags.map((x) => x.toLowerCase())) if (!tags.includes(t)) tags.push(t)
      if (tags.length < rawTags.length) W('W003', 'tags', 'Duplicate tags were merged (tags are lower-cased).')
      if (tags.length > LIMITS.maxTags) E('E026', 'tags', `At most ${LIMITS.maxTags} tags are allowed (found ${tags.length}).`)
      if (tags.some((t) => t.length > LIMITS.maxTagLength)) E('E026', 'tags', `Each tag may be at most ${LIMITS.maxTagLength} characters.`)
      rec.tags = tags

      // discount
      const disc = parseNumber(get(cells, 'discount'))
      const exp = parseDate(get(cells, 'discountExpiry'))
      if (!disc.ok || (disc.value !== null && (disc.value < 0 || disc.value > 100))) E('E033', 'discount', `Discount "${cell('discount')}" must be a number between 0 and 100.`)
      else if (!exp.ok) E('E033', 'discountExpiry', `Discount Expiry "${cell('discountExpiry')}" is not a date — use YYYY-MM-DD.`)
      else if ((disc.value || 0) > 0) {
        if (!exp.value) E('E033', 'discountExpiry', 'Discount Expiry is required when Discount is above 0.')
        else if (exp.value < today.toISOString().slice(0, 10)) E('E033', 'discountExpiry', `Discount Expiry ${exp.value} is in the past.`)
        else { rec.discount = disc.value; rec.discountExpiry = exp.value }
      } else if (exp.value) W('W008', 'discountExpiry', 'Discount Expiry is ignored because there is no discount.')

      if (type === 'PARENT') {
        const names = splitList(get(cells, 'attributeNames'))
        if (names.length > LIMITS.maxAttributeNames) E('E060', 'attributeNames', `At most ${LIMITS.maxAttributeNames} attribute names are allowed.`)
        if (names.some((n) => n.length > LIMITS.maxAttributeValue)) E('E060', 'attributeNames', `Attribute names may be at most ${LIMITS.maxAttributeValue} characters.`)
        if (new Set(names.map(keyOf)).size < names.length) E('E060', 'attributeNames', 'Attribute names must be unique.')
        rec.attributeNames = names.slice(0, LIMITS.maxAttributeNames)
      }
    }
    rec.hasError = issues.filter((x) => x.severity === 'error').length > rec.errorsBefore
    recs.push(rec)
  }

  // ── 5. relations ─────────────────────────────────────────────────────────────────────────────────────────────────
  const parents = new Map()      // lower id -> rec (PARENT rows)
  for (const r of recs) if (r.type === 'PARENT' && r.importId) parents.set(keyOf(r.importId), r)
  const variantsOf = new Map()   // lower parent id -> [rec]
  for (const r of recs) {
    if (r.type !== 'VARIANT' || !r.parentId) continue
    const pk = keyOf(r.parentId)
    const parent = parents.get(pk)
    if (!parent) {
      const any = recs.find((x) => keyOf(x.importId) === pk)
      if (any) err('E013', r.row, headerOf('parentId'), r.importId, `Parent Import ID "${r.parentId}" is a ${any.type || 'row'} (row ${any.row}), not a PARENT.`)
      else {
        const hint = closest([...parents.values()].map((p) => p.importId), r.parentId)
        err('E012', r.row, headerOf('parentId'), r.importId, `Parent Import ID "${r.parentId}" does not match any PARENT row in this file${hint ? ` (did you mean ${hint}?)` : ''}.`)
      }
      r.hasError = true
      continue
    }
    if (!variantsOf.has(pk)) variantsOf.set(pk, [])
    variantsOf.get(pk).push(r)
    if (r.productName && keyOf(r.productName) !== keyOf(parent.name)) {
      warn('W002', r.row, headerOf('name'), r.importId, `Product Name "${r.productName}" differs from the parent's name — it is ignored.`)
    }
  }

  const groups = []
  for (const r of recs) {
    if (r.type === 'SINGLE') groups.push(groupOf(r, []))
    if (r.type === 'PARENT') {
      const kids = variantsOf.get(keyOf(r.importId)) || []
      if (kids.length === 0) { err('E014', r.row, headerOf('type'), r.importId, 'A PARENT needs at least one VARIANT row that points to it.'); r.hasError = true }
      resolveAttributes(r, kids)
      if (!r.sellMain && kids.length > 0 && kids.every((k) => k.status === 'inactive')) {
        warn('W004', r.row, headerOf('sellMain'), r.importId, 'The main product is not sold and every variant is INACTIVE — nothing on this product can be bought.')
      }
      groups.push(groupOf(r, kids))
    }
  }

  function resolveAttributes(parent, kids) {
    // names: declared on the parent, else the union of the variants' keys, else the single attribute "Option"
    let names = parent.attributeNames || []
    if (names.length === 0) {
      for (const k of kids) for (const [key] of k.pairs || []) if (!names.some((n) => keyOf(n) === keyOf(key))) names.push(key)
      names = names.slice(0, LIMITS.maxAttributeNames)
    }
    if (names.length === 0) names = ['Option']
    parent.resolvedNames = names
    const combos = new Map()
    const nameSeen = new Map()
    for (const k of kids) {
      const attrs = []
      const pairs = k.pairs || []
      for (const [key, value] of pairs) {
        const canon = names.find((n) => keyOf(n) === keyOf(key))
        if (!canon) { err('E060', k.row, headerOf('variantAttributes'), k.importId, `Attribute "${key}" is not declared by the parent (${names.join(', ')}).`); k.hasError = true; continue }
        if (attrs.some(([a]) => a === canon)) { err('E060', k.row, headerOf('variantAttributes'), k.importId, `Attribute "${canon}" is given twice.`); k.hasError = true; continue }
        attrs.push([canon, value])
      }
      if (attrs.length === 0 && k.variantName) {
        if (names.length === 1) attrs.push([names[0], k.variantName])
        else { err('E060', k.row, headerOf('variantAttributes'), k.importId, `The parent declares several attributes (${names.join(', ')}), so this variant needs Variant Attributes such as ${names.map((n) => `${n}=…`).join('|')}.`); k.hasError = true }
      }
      k.attributes = attrs
      // uniqueness inside the parent
      const nk = keyOf(k.variantName)
      if (nk) {
        if (nameSeen.has(nk)) { err('E062', k.row, headerOf('variantName'), k.importId, `Variant Name "${k.variantName}" is already used on row ${nameSeen.get(nk)} of this parent.`); k.hasError = true }
        else nameSeen.set(nk, k.row)
      }
      if (attrs.length) {
        const ck = names.map((n) => keyOf((attrs.find(([a]) => a === n) || [, ''])[1])).join('|')
        if (combos.has(ck)) { err('E061', k.row, headerOf('variantAttributes'), k.importId, `The attribute combination (${attrs.map(([a, v]) => `${a}=${v}`).join(', ')}) is already used on row ${combos.get(ck)}.`); k.hasError = true }
        else combos.set(ck, k.row)
      }
    }
  }

  function groupOf(r, kids) {
    const isParent = r.type === 'PARENT'
    const product = {
      title: r.name, category: r.category, brand: r.brand, sku: r.sku, price: r.price ?? 0,
      gst_rate: r.gstRate ?? 0, hsn_code: r.hsn, short_description: r.shortDescription, description: r.description,
      status: r.status, tags: r.tags, track_inventory: r.track, main_option_enabled: isParent ? r.sellMain : true,
      attributes: [],
    }
    if (r.track) product.stock = r.stock ?? 0
    if (r.discount) { product.discount = r.discount; product.discount_expiry = `${r.discountExpiry}T23:59:59+05:30` }
    if (r.return) { product.return_enabled = r.return.enabled; product.return_window_days = r.return.days }
    if (r.exchange) { product.exchange_enabled = r.exchange.enabled; product.exchange_window_days = r.exchange.days }
    const variants = kids.map((k, i) => {
      const v = {
        import_key: k.importId, row: k.row, name: k.variantName, sku: k.sku, price: k.price ?? 0, track_inventory: k.track,
        status: k.status, sort_order: k.sortOrder ?? i + 1, attributes: Object.fromEntries((k.attributes || []).map(([a, b]) => [a, b])),
        images: { main: k.mainImage || '', gallery: k.gallery },
      }
      if (k.track) v.stock = k.stock ?? 0
      if (k.return) { v.return_enabled = k.return.enabled; v.return_window_days = k.return.days }
      if (k.exchange) { v.exchange_enabled = k.exchange.enabled; v.exchange_window_days = k.exchange.days }
      return v
    })
    if (isParent) {
      const names = r.resolvedNames || []
      product.attributes = names.map((n) => ({ name: n, options: [...new Set(kids.map((k) => (k.attributes || []).find(([a]) => a === n)?.[1]).filter(Boolean))] }))
    }
    return { import_key: r.importId, row: r.row, kind: isParent ? 'parent' : 'single', product, images: { main: r.mainImage || '', gallery: r.gallery }, variants, hasErrors: r.hasError || kids.some((k) => k.hasError) }
  }

  // ── 6. unreferenced images ─────────────────────────────────────────────────────────────────────────────────────
  const unusedImages = []
  for (const hit of imageIndex.values()) if (!hit.used) { unusedImages.push(hit.name); warn('W001', 0, '', '', `Image "${hit.name}" in the ZIP is not referenced by any row and is ignored.`) }

  return finish({
    fatal: false, recs, groups, unusedImages,
    imageRefs: [...imageRefs.values()],
    ruleSet: { legacy },
  })
}

function finalise({ issues, fatal = false, recs = [], groups = [], unusedImages = [], imageRefs = [], ruleSet = {} }) {
  const order = { error: 0, warning: 1, info: 2 }
  issues.sort((a, b) => a.row - b.row || order[a.severity] - order[b.severity] || a.code.localeCompare(b.code))
  const errors = issues.filter((i) => i.severity === 'error')
  const counts = { errors: errors.length, warnings: issues.filter((i) => i.severity === 'warning').length, infos: issues.filter((i) => i.severity === 'info').length }
  const byRow = new Map()
  for (const i of issues) { if (!byRow.has(i.row)) byRow.set(i.row, []); byRow.get(i.row).push(i) }
  const rows = recs.map((r) => ({
    row: r.row, importId: r.importId, type: r.type, name: r.type === 'VARIANT' ? r.variantName : r.name, sku: r.sku, price: r.price, stock: r.stock,
    status: (byRow.get(r.row) || []).some((i) => i.severity === 'error') ? 'error' : (byRow.get(r.row) || []).some((i) => i.severity === 'warning') ? 'warning' : 'ok',
    issueCodes: (byRow.get(r.row) || []).map((i) => i.code),
  }))
  const products = groups.length
  const variants = groups.reduce((s, g) => s + g.variants.length, 0)
  return {
    ok: !fatal && errors.length === 0 && products > 0,
    fatal, issues, counts, rows, groups, imageRefs, unusedImages,
    summary: {
      rows: recs.length, products, variants,
      singles: groups.filter((g) => g.kind === 'single').length, parents: groups.filter((g) => g.kind === 'parent').length,
      images: imageRefs.filter((r) => r.kind === 'file').length, imageUrls: imageRefs.filter((r) => r.kind === 'url').length,
      legacy: !!ruleSet.legacy,
    },
  }
}

/** "Row 7 · Parent Import ID · SHIRT-002-PINK · E012 · message" */
export function describeIssue(i) {
  return [i.row ? `Row ${i.row}` : 'File', i.column, i.importId, i.code, i.message].filter(Boolean).join(' · ')
}