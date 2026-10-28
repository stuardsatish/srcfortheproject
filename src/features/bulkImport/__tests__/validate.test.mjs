// node --test src/features/bulkImport/__tests__/validate.test.mjs   (npm run test:unit)
// Table-driven: every code of BULK_UPLOAD_TEMPLATE_GUIDE §5 is provoked by a mutated copy of the guide's example sheet.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COLUMNS, mapHeaders, headerKey } from '../columns.js'
import { validateImport, describeIssue, LIMITS } from '../validate.js'

const TODAY = new Date('2026-10-17T00:00:00Z')
const HEADERS = COLUMNS.map((c) => c.header)
const KEYS = COLUMNS.map((c) => c.key)
/** { importId: 'X', ... } -> a sheet row in template column order */
const row = (o) => KEYS.map((k) => (o[k] === undefined ? null : o[k]))
const sheet = (...rows) => [HEADERS, ...rows.map(row)]
/** S(cells, rowIndex, 'columnKey', value): set a cell BY COLUMN KEY (never by position). rowIndex 0 = header, 1 = first product row */
const S = (c, r, k, v) => { const i = KEYS.indexOf(k); assert.ok(i >= 0, `unknown column key ${k}`); c[r][i] = v }
const img = (name, o = {}) => ({ name, size: 1000, ...o })
const IMAGES = ['S1.jpg', 'P1.jpg', 'P1-PINK.jpg', 'P1-WHITE.jpg', 'P1-VIOLET.jpg', 'extra1.jpg', 'extra2.png'].map((n) => img(n))

// the guide's example: one SINGLE, one PARENT with three variants of different prices, policies mixed
const single = (o = {}) => ({ importId: 'S1', type: 'SINGLE', name: 'Classic Shirt', sku: 'SHIRT-001', category: 'Shirts', price: 500, stock: 50, mainImage: 'S1.jpg', returnEnabled: 'YES', returnDays: 7, exchangeEnabled: 'YES', exchangeDays: 5, ...o })
const parent = (o = {}) => ({ importId: 'P1', type: 'PARENT', name: 'Designer Shirt', sku: 'SHIRT-002', category: 'Shirts', price: 500, stock: 10, mainImage: 'P1.jpg', ...o })
const variant = (n, price, stock, o = {}) => ({ importId: `P1-${n.toUpperCase()}`, type: 'VARIANT', parentId: 'P1', variantName: n, sku: `SHIRT-002-${n.toUpperCase()}`, price, stock, mainImage: `P1-${n.toUpperCase()}.jpg`, ...o })
// rows of valid(): 1 SINGLE S1, 2 PARENT P1, 3 Pink, 4 White, 5 Violet
const valid = () => sheet(single(), parent(), variant('Pink', 300, 20), variant('White', 200, 30, { returnEnabled: 'NO', exchangeEnabled: 'YES', exchangeDays: 3 }), variant('Violet', 350, 15))
const copy = () => valid().map((r) => r.slice())
const run = (cells2d, imageFiles = IMAGES) => validateImport({ cells2d, imageFiles, today: TODAY })
const codes = (r, severity = 'error') => r.issues.filter((i) => i.severity === severity).map((i) => i.code)
const one = (r, code) => { const f = r.issues.filter((i) => i.code === code); assert.ok(f.length >= 1, `expected ${code}, got [${r.issues.map((i) => i.code)}]`); return f[0] }

describe('the guide\'s example sheet', () => {
  it('is valid and yields a SINGLE and a PARENT with 3 variants — the parent price is NOT derived from its variants', () => {
    const r = run(valid())
    assert.equal(r.ok, true, JSON.stringify(r.issues))
    assert.deepEqual(r.summary, { rows: 5, products: 2, variants: 3, singles: 1, parents: 1, images: 5, imageUrls: 0, legacy: false })
    const p = r.groups.find((g) => g.import_key === 'P1')
    assert.equal(p.kind, 'parent'); assert.equal(p.product.price, 500); assert.equal(p.product.stock, 10)
    assert.deepEqual(p.variants.map((v) => [v.name, v.price, v.stock, v.sku]), [['Pink', 300, 20, 'SHIRT-002-PINK'], ['White', 200, 30, 'SHIRT-002-WHITE'], ['Violet', 350, 15, 'SHIRT-002-VIOLET']])
    assert.deepEqual(p.variants.map((v) => v.sort_order), [1, 2, 3])
  })
  it('policies: the single keeps its own, Pink INHERITS (no keys), White overrides', () => {
    const r = run(valid())
    const s = r.groups.find((g) => g.import_key === 'S1').product
    assert.deepEqual([s.return_enabled, s.return_window_days, s.exchange_enabled, s.exchange_window_days], [true, 7, true, 5])
    const [pink, white] = r.groups.find((g) => g.import_key === 'P1').variants
    assert.equal('return_enabled' in pink, false); assert.equal('exchange_enabled' in pink, false)
    assert.deepEqual([white.return_enabled, white.return_window_days, white.exchange_enabled, white.exchange_window_days], [false, null, true, 3])
  })
  it('the parent lists the variant attribute: no names given -> the single attribute "Option" = the variant name', () => {
    const p = run(valid()).groups.find((g) => g.import_key === 'P1')
    assert.deepEqual(p.product.attributes, [{ name: 'Option', options: ['Pink', 'White', 'Violet'] }])
    assert.deepEqual(p.variants[0].attributes, { Option: 'Pink' })
  })
  it('images are referenced by exact file name; unused files are only a warning (W001)', () => {
    const r = run(valid())
    assert.deepEqual(codes(r, 'warning').sort(), ['W001', 'W001'])
    assert.deepEqual(r.unusedImages.sort(), ['extra1.jpg', 'extra2.png'])
    assert.equal(r.groups[0].images.main, 'S1.jpg')
  })
  it('rows in ANY order link by Parent Import ID (a variant before its parent is fine)', () => {
    const [h, s, p, a, b, c] = valid()
    const r = run([h, c, a, s, b, p])
    assert.equal(r.ok, true, JSON.stringify(r.issues))
    assert.equal(r.groups.find((g) => g.import_key === 'P1').variants.length, 3)
    assert.deepEqual(r.groups.find((g) => g.import_key === 'P1').variants.map((v) => v.name), ['Violet', 'Pink', 'White'], 'order within the parent follows the sheet')
  })
  it('the example row (# …), blank rows and the Notes column do not matter', () => {
    const cells = valid()
    cells.splice(1, 0, row({ importId: '# EXAMPLE — ignored', type: 'SINGLE' }), [], [null, null])
    const r = run(cells)
    assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.equal(r.summary.rows, 5)
    assert.equal(r.rows[0].row, 5, 'row numbers are the REAL Excel rows (header 1, example 2, two blanks 3-4)')
  })
})

describe('what the plan carries (the documents import_stage_batch receives)', () => {
  it('single product payload', () => {
    const r = run(sheet(single({ brand: 'Acme', tags: 'Cotton| Summer |cotton', gstRate: 12, hsn: '6105', shortDescription: ' short ', description: 'Long\r\ntext', discount: 10, discountExpiry: '2026-12-31' })))
    assert.equal(r.ok, true, JSON.stringify(r.issues))
    const p = r.groups[0].product
    assert.deepEqual({ title: p.title, category: p.category, brand: p.brand, sku: p.sku, price: p.price, stock: p.stock, gst: p.gst_rate, hsn: p.hsn_code, status: p.status },
      { title: 'Classic Shirt', category: 'Shirts', brand: 'Acme', sku: 'SHIRT-001', price: 500, stock: 50, gst: 12, hsn: '6105', status: 'active' })
    assert.deepEqual(p.tags, ['cotton', 'summer'])
    assert.equal(p.short_description, 'short'); assert.equal(p.description, 'Long\ntext')
    assert.deepEqual([p.discount, p.discount_expiry], [10, '2026-12-31T23:59:59+05:30'], 'end of that day in IST')
    assert.deepEqual([p.track_inventory, p.main_option_enabled, p.attributes], [true, true, []])
    assert.ok(codes(r, 'warning').includes('W003'), 'the duplicate tag was merged and reported')
  })
  it('no fake variant is ever created for a SINGLE', () => assert.deepEqual(run(sheet(single())).groups[0].variants, []))
  it('Track Inventory = NO: stock is not required and not sent', () => {
    const r = run(sheet(single({ trackInventory: 'NO', stock: null })))
    assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.equal('stock' in r.groups[0].product, false); assert.equal(r.groups[0].product.track_inventory, false)
  })
  it('Sell Main Product = NO: the parent may have no price/stock and is flagged not sold', () => {
    const r = run(sheet(parent({ sellMain: 'NO', price: null, stock: null, trackInventory: 'NO' }), variant('Pink', 300, 20)))
    assert.equal(r.ok, true, JSON.stringify(r.issues))
    assert.deepEqual([r.groups[0].product.main_option_enabled, r.groups[0].product.price], [false, 0])
  })
  it('a parent whose main option is not sold and whose variants are all INACTIVE gets W004', () => {
    const r = run(sheet(parent({ sellMain: 'NO', price: null, trackInventory: 'NO' }), variant('Pink', 300, 20, { status: 'INACTIVE' })))
    assert.ok(codes(r, 'warning').includes('W004'), JSON.stringify(r.issues))
  })
  it('declared attribute names + pairs build the parent attribute list and the variant maps', () => {
    const r = run(sheet(parent({ attributeNames: 'Color|Size' }), variant('Pink-M', 300, 5, { variantAttributes: 'Color=Pink|Size=M', mainImage: null }), variant('Pink-L', 310, 5, { variantAttributes: 'size=L|COLOR=Pink', mainImage: null })))
    assert.equal(r.ok, true, JSON.stringify(r.issues))
    const g = r.groups[0]
    assert.deepEqual(g.product.attributes, [{ name: 'Color', options: ['Pink'] }, { name: 'Size', options: ['M', 'L'] }])
    assert.deepEqual(g.variants[1].attributes, { Color: 'Pink', Size: 'L' }, 'keys are matched case-insensitively and take the declared spelling')
  })
  it('attribute names derived from the variants when the parent declares none', () => {
    const r = run(sheet(parent(), variant('Red-L', 1, 1, { variantAttributes: 'Color=Red|Size=L', mainImage: null }), variant('Blue-L', 1, 1, { variantAttributes: 'Color=Blue|Size=L', mainImage: null })))
    assert.equal(r.ok, true, JSON.stringify(r.issues))
    assert.deepEqual(r.groups[0].product.attributes.map((a) => a.name), ['Color', 'Size'])
  })
})

describe('legacy CSV layout (the old importer\'s headers keep working)', () => {
  const legacy = [
    ['title', 'category', 'price', 'stock', 'brand', 'sku', 'gstRate', 'hsnCode', 'shortDescription', 'description', 'image'],
    ['Almond Cake', 'cakes', '₹450', 12, 'Sweet Co', 'CAKE-1', 5, '1905', 'Tasty', 'Very tasty', 'https://img.test/cake.jpg'],
    ['No Sku Item', 'misc', 99],
  ]
  it('every row becomes a SINGLE product; the Import ID comes from the SKU or the row number', () => {
    const r = run(legacy, null)
    assert.equal(r.ok, true, JSON.stringify(r.issues))
    assert.deepEqual(r.groups.map((g) => [g.import_key, g.kind]), [['CAKE-1', 'single'], ['ROW-3', 'single']])
    assert.equal(r.groups[0].images.main, 'https://img.test/cake.jpg'); assert.equal(r.groups[0].product.price, 450)
    assert.ok(r.issues.some((i) => i.code === 'I001'))
    assert.equal(r.groups[1].product.stock, 0)
  })
  it('only title / category / price are required there', () => {
    const r = run([['title', 'price', 'sku'], ['x', 5, 'A']], null)
    assert.ok(r.issues.some((i) => i.code === 'E090' && i.column === 'Category'), JSON.stringify(r.issues))
  })
})

describe('error catalogue — one case per code (each mutates the valid sheet and expects that code)', () => {
  const cases = [
    // [label, mutate(cells), expected code, expected column]
    ['E001 Import ID missing', (c) => S(c, 1, 'importId', null), 'E001', 'Import ID'],
    ['E002 duplicate Import ID (case-insensitive)', (c) => S(c, 2, 'importId', 's1'), 'E002', 'Import ID'],
    ['E003 Import ID with a space', (c) => S(c, 1, 'importId', 'S 1'), 'E003', 'Import ID'],
    ['E003 Import ID containing _var_', (c) => S(c, 1, 'importId', 'S_var_1'), 'E003', 'Import ID'],
    ['E010 bad Product Type', (c) => S(c, 1, 'type', 'COMBO'), 'E010', 'Product Type'],
    ['E010 missing Product Type', (c) => S(c, 1, 'type', null), 'E010', 'Product Type'],
    ['E011 VARIANT without parent id', (c) => S(c, 3, 'parentId', null), 'E011', 'Parent Import ID'],
    ['E012 unknown parent', (c) => S(c, 3, 'parentId', 'P-1'), 'E012', 'Parent Import ID'],
    ['E013 parent is a SINGLE', (c) => S(c, 3, 'parentId', 'S1'), 'E013', 'Parent Import ID'],
    ['E014 PARENT without variants', (c) => { c.splice(3, 3) }, 'E014', 'Product Type'],
    ['E015 SINGLE with a parent id', (c) => S(c, 1, 'parentId', 'P1'), 'E015', 'Parent Import ID'],
    ['E016 variant without a name', (c) => S(c, 3, 'variantName', null), 'E016', 'Variant Name'],
    ['E020 product name missing', (c) => S(c, 1, 'name', null), 'E020', 'Product Name'],
    ['E021 category missing', (c) => S(c, 1, 'category', null), 'E021', 'Category'],
    ['E022 SKU missing', (c) => S(c, 1, 'sku', null), 'E022', 'SKU'],
    ['E023 duplicate SKU in the file (case-insensitive)', (c) => S(c, 3, 'sku', 'shirt-001'), 'E023', 'SKU'],
    ['E025 SKU too long', (c) => S(c, 1, 'sku', 'S'.repeat(65)), 'E025', 'SKU'],
    ['E026 description too long', (c) => S(c, 1, 'description', 'x'.repeat(5001)), 'E026', 'Description'],
    ['E026 too many tags', (c) => S(c, 1, 'tags', Array.from({ length: 21 }, (_, i) => `t${i}`).join('|')), 'E026', 'Tags'],
    ['E026 too many gallery images', (c) => S(c, 1, 'galleryImages', Array.from({ length: 9 }, (_, i) => `g${i}.jpg`).join('|')), 'E026', 'Additional Image Filenames'],
    ['E030 price is text', (c) => S(c, 1, 'price', 'abc'), 'E030', 'Price'],
    ['E030 price zero', (c) => S(c, 1, 'price', 0), 'E030', 'Price'],
    ['E030 price negative', (c) => S(c, 1, 'price', -5), 'E030', 'Price'],
    ['E030 price with 3 decimals', (c) => S(c, 1, 'price', 499.999), 'E030', 'Price'],
    ['E030 price missing', (c) => S(c, 1, 'price', null), 'E030', 'Price'],
    ['E031 stock negative', (c) => S(c, 1, 'stock', -1), 'E031', 'Stock Quantity'],
    ['E031 stock fractional', (c) => S(c, 1, 'stock', 2.5), 'E031', 'Stock Quantity'],
    ['E031 stock missing while tracked', (c) => S(c, 1, 'stock', null), 'E031', 'Stock Quantity'],
    ['E032 GST above 100', (c) => S(c, 1, 'gstRate', 120), 'E032', 'GST Rate %'],
    ['E033 discount above 100', (c) => { S(c, 1, 'discount', 150); S(c, 1, 'discountExpiry', '2026-12-31') }, 'E033', 'Discount %'],
    ['E033 discount without expiry', (c) => S(c, 1, 'discount', 10), 'E033', 'Discount Expiry'],
    ['E033 expiry in the past', (c) => { S(c, 1, 'discount', 10); S(c, 1, 'discountExpiry', '2026-10-01') }, 'E033', 'Discount Expiry'],
    ['E033 expiry is not a date', (c) => { S(c, 1, 'discount', 10); S(c, 1, 'discountExpiry', 'soon') }, 'E033', 'Discount Expiry'],
    ['E034 discount on a VARIANT row', (c) => S(c, 3, 'discount', 5), 'E034', 'Discount %'],
    ['E040 Return YES without days', (c) => { S(c, 1, 'returnEnabled', 'YES'); S(c, 1, 'returnDays', null) }, 'E040', 'Return Window Days'],
    ['E040 Return NO with days', (c) => { S(c, 1, 'returnEnabled', 'NO'); S(c, 1, 'returnDays', 7) }, 'E040', 'Return Window Days'],
    ['E040 days without the flag', (c) => { S(c, 1, 'returnEnabled', null); S(c, 1, 'returnDays', 7) }, 'E040', 'Return Enabled'],
    ['E040 return days 0', (c) => S(c, 1, 'returnDays', 0), 'E040', 'Return Window Days'],
    ['E040 exchange days 366', (c) => S(c, 1, 'exchangeDays', 366), 'E040', 'Exchange Window Days'],
    ['E040 exchange days fractional', (c) => S(c, 1, 'exchangeDays', 2.5), 'E040', 'Exchange Window Days'],
    ['E040 exchange YES without days', (c) => { S(c, 1, 'exchangeEnabled', 'YES'); S(c, 1, 'exchangeDays', null) }, 'E040', 'Exchange Window Days'],
    ['E050 main image missing from the ZIP', (c) => S(c, 1, 'mainImage', 'nope.jpg'), 'E050', 'Main Image Filename'],
    ['E050 main image required for a SINGLE', (c) => S(c, 1, 'mainImage', null), 'E050', 'Main Image Filename'],
    ['E051 unsupported image type', (c) => S(c, 1, 'mainImage', 'S1.svg'), 'E051', 'Main Image Filename'],
    ['E055 image given as a path', (c) => S(c, 1, 'mainImage', 'images/S1.jpg'), 'E055', 'Main Image Filename'],
    ['E060 variant attribute not declared by the parent', (c) => { S(c, 2, 'attributeNames', 'Color'); S(c, 3, 'variantAttributes', 'Size=M') }, 'E060', 'Variant Attributes'],
    ['E060 malformed Variant Attributes', (c) => S(c, 3, 'variantAttributes', 'Color'), 'E060', 'Variant Attributes'],
    ['E060 more than 3 attribute names', (c) => S(c, 2, 'attributeNames', 'A|B|C|D'), 'E060', 'Attribute Names'],
    ['E060 several declared attributes but a variant gives none', (c) => S(c, 2, 'attributeNames', 'Color|Size'), 'E060', 'Variant Attributes'],
    ['E061 duplicate attribute combination', (c) => { S(c, 2, 'attributeNames', 'Color'); S(c, 3, 'variantAttributes', 'Color=Pink'); S(c, 4, 'variantAttributes', 'color=PINK') }, 'E061', 'Variant Attributes'],
    ['E062 duplicate Variant Name within a parent', (c) => S(c, 4, 'variantName', 'pink'), 'E062', 'Variant Name'],
    ['E100 Track Inventory is not YES/NO', (c) => S(c, 1, 'trackInventory', 'maybe'), 'E100', 'Track Inventory'],
    ['E100 status not allowed for the type', (c) => S(c, 3, 'status', 'DRAFT'), 'E100', 'Status'],
    ['E100 Return Enabled is not YES/NO', (c) => S(c, 1, 'returnEnabled', 'ok'), 'E100', 'Return Enabled'],
  ]
  for (const [label, mutate, code, column] of cases) {
    it(label, () => {
      const cells = copy()
      mutate(cells)
      const r = run(cells)
      assert.equal(r.ok, false, `${label}: the sheet must be rejected`)
      assert.ok(codes(r).includes(code), `${label}: expected ${code}, got [${codes(r)}]`)
      if (column) assert.equal(one(r, code).column, column, `${label}: column`)
    })
  }

  it('E012 suggests the closest PARENT', () => {
    const cells = copy(); S(cells, 3, 'parentId', 'P-1')
    assert.match(one(run(cells), 'E012').message, /did you mean P1\?/)
  })
  it('a rejected row never blocks the diagnosis of the others (all problems are listed, none silently skipped)', () => {
    const cells = copy(); S(cells, 1, 'price', 'abc'); S(cells, 3, 'stock', -1); S(cells, 4, 'sku', null)
    assert.deepEqual(codes(run(cells)).sort(), ['E022', 'E030', 'E031'])
  })
})

describe('image checks', () => {
  const withImages = (files) => run(valid(), files)
  it('E050 when no images were supplied at all (only file names, no ZIP)', () => {
    const r = run(valid(), null)
    assert.ok(codes(r).every((c) => c === 'E050')); assert.equal(codes(r).length, 5)
  })
  it('names match exactly but case-insensitively, and only on the BASE name (folders in the ZIP are ignored)', () => {
    const files = IMAGES.map((f) => ({ ...f, name: `images/${f.name.toUpperCase()}` }))
    assert.equal(withImages(files).ok, true)
  })
  it('E053 the same base name twice in different folders is ambiguous', () => {
    const files = [...IMAGES.filter((f) => f.name !== 'S1.jpg'), img('a/S1.jpg'), img('b/S1.jpg')]
    assert.ok(codes(withImages(files)).includes('E053'))
  })
  it('E052 oversize, E051 wrong type, E054 content that is not the claimed image, E055 unsafe zip path', () => {
    for (const [problem, code] of [['size', 'E052'], ['type', 'E051'], ['content', 'E054'], ['unsafe', 'E055']]) {
      const files = IMAGES.map((f) => (f.name === 'S1.jpg' ? { ...f, problem } : f))
      assert.ok(codes(withImages(files)).includes(code), `${problem} -> ${code}`)
    }
  })
  it('https URLs are accepted as-is (legacy behaviour) and are not looked up in the ZIP; http gets a warning', () => {
    const cells = copy(); S(cells, 1, 'mainImage', 'https://cdn.test/s1.jpg'); S(cells, 2, 'mainImage', 'http://cdn.test/p1.jpg')
    const r = run(cells)
    assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.ok(codes(r, 'warning').includes('W007'))
    assert.deepEqual([r.summary.images, r.summary.imageUrls], [3, 2])
  })
  it('gallery images are checked too and carried into the plan', () => {
    const cells = copy(); S(cells, 1, 'galleryImages', 'extra1.jpg|extra2.png')
    const r = run(cells)
    assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.deepEqual(r.groups[0].images.gallery, ['extra1.jpg', 'extra2.png'])
    S(cells, 1, 'galleryImages', 'extra1.jpg|ghost.jpg')
    assert.ok(codes(run(cells)).includes('E050'))
  })
  it('a VARIANT without an image is fine (it falls back to the parent image in the storefront)', () => {
    const cells = copy(); S(cells, 3, 'mainImage', null)
    assert.equal(run(cells).ok, true)
  })
})

describe('warnings', () => {
  it('W002 variant row repeats a DIFFERENT product name', () => {
    const cells = copy(); S(cells, 3, 'name', 'Something else')
    assert.ok(codes(run(cells), 'warning').includes('W002'))
  })
  it('W005 DRAFT status (drafts are publicly visible today — P-8)', () => {
    const cells = copy(); S(cells, 1, 'status', 'DRAFT')
    assert.ok(codes(run(cells), 'warning').includes('W005'))
  })
  it('W006 unknown column is ignored, W008 expiry without discount', () => {
    const cells = copy(); cells[0].push('Mystery'); cells[1].push('x'); S(cells, 1, 'discountExpiry', '2026-12-31')
    const r = run(cells)
    assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.ok(codes(r, 'warning').includes('W006')); assert.ok(codes(r, 'warning').includes('W008'))
  })
})

describe('file-level problems (nothing else is attempted)', () => {
  it('E090 missing required column', () => {
    const cells = valid().map((r) => r.filter((_, i) => KEYS[i] !== 'sku'))
    const r = run(cells)
    assert.equal(r.fatal, true); assert.ok(r.issues.some((i) => i.code === 'E090' && i.column === 'SKU'))
  })
  it('E090 no header row / no data rows / duplicate header', () => {
    assert.ok(run([['hello', 'world'], [1, 2]]).issues.some((i) => i.code === 'E090'))
    assert.ok(run([HEADERS]).issues.some((i) => i.code === 'E090' && /no product rows/.test(i.message)))
    const dup = copy(); dup[0].push('SKU'); dup[1].push('X')
    assert.ok(run(dup).issues.some((i) => i.code === 'E090' && /more than once/.test(i.message)))
    assert.equal(run(undefined).fatal, true)
  })
  it('the header row may be below a title row (first row with >= 3 template headers)', () => {
    const cells = [['Product import — fill in below'], ...valid()]
    const r = run(cells)
    assert.equal(r.ok, true, JSON.stringify(r.issues)); assert.equal(r.rows[0].row, 3)
  })
  it('E080 too many rows', () => {
    const rows = Array.from({ length: LIMITS.maxDataRows + 1 }, (_, i) => single({ importId: `S${i}`, sku: `SKU-${i}` }))
    assert.ok(run(sheet(...rows), null).issues.some((i) => i.code === 'E080'))
  })
})

describe('headers', () => {
  it('aliases: GST Rate % / gst / gstRate all map to one column; legacy "attributes" -> Attribute Names', () => {
    for (const h of ['GST Rate %', 'gst', 'gstRate', 'GSTRATE']) assert.equal(mapHeaders([h, 'x']).map.get('gstRate'), 0, h)
    assert.equal(mapHeaders(['Attributes']).map.get('attributeNames'), 0)
    assert.equal(headerKey('Parent Import ID'), 'parentimportid')
  })
  it('describeIssue renders "Row 7 · Parent Import ID · SHIRT-002-PINK · E012 · …"', () => {
    const cells = copy(); S(cells, 3, 'parentId', 'P-1')
    assert.match(describeIssue(one(run(cells), 'E012')), /^Row 4 · Parent Import ID · P1-PINK · E012 · Parent Import ID "P-1" does not match/)
  })
})