// node --test src/features/bulkImport/__tests__/imageArchive.test.mjs   (npm run test:unit)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeZip } from '../zip.js'
import { sniffImageType, mimeForType, readImageArchive, readLooseImages, IMAGE_LIMITS } from '../imageArchive.js'

// the smallest valid-looking headers of each format (only the magic bytes matter here)
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50])
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>')
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0])

describe('sniffImageType', () => {
  it('recognises the four accepted formats by their magic bytes', () => {
    assert.deepEqual([JPEG, PNG, GIF, WEBP].map(sniffImageType), ['jpeg', 'png', 'gif', 'webp'])
    assert.deepEqual([mimeForType('jpeg'), mimeForType('webp'), mimeForType(null)], ['image/jpeg', 'image/webp', 'application/octet-stream'])
  })
  it('SVG, HTML, executables, truncated and empty data are not images', () => {
    for (const b of [HTML, EXE, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), Uint8Array.from([0xff, 0xd8]), new Uint8Array(0), Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])]) assert.equal(sniffImageType(b), null)
  })
})

describe('readImageArchive', () => {
  it('indexes by BASE name, ignores folders and OS junk, inflates and keeps the bytes of good images', async () => {
    const zip = await writeZip([
      { name: 'images/SHIRT-001.jpg', data: JPEG }, { name: 'images/sub/SHIRT-002.PNG', data: PNG }, { name: 'a.gif', data: GIF }, { name: 'w.webp', data: WEBP },
      { name: '__MACOSX/images/._SHIRT-001.jpg', data: 'junk' }, { name: '.DS_Store', data: 'x' }, { name: 'images/Thumbs.db', data: 'x' }, { name: 'images/', data: new Uint8Array(0) },
    ])
    const r = await readImageArchive(zip)
    assert.equal(r.fatal, null)
    assert.deepEqual(r.files.map((f) => [f.name, f.problem]), [['SHIRT-001.jpg', null], ['SHIRT-002.PNG', null], ['a.gif', null], ['w.webp', null]])
    assert.deepEqual([...r.bytes.keys()].sort(), ['a.gif', 'shirt-001.jpg', 'shirt-002.png', 'w.webp'])
    assert.deepEqual(r.bytes.get('shirt-001.jpg'), JPEG)
  })
  it('flags: wrong content for the extension (E054), unsupported type (E051), oversize (E052), unsafe path (E055)', async () => {
    const big = new Uint8Array(2000); big.set(JPEG)
    const zip = await writeZip([
      { name: 'fake.jpg', data: HTML }, { name: 'renamed.png', data: JPEG }, { name: 'logo.svg', data: '<svg/>' }, { name: 'doc.pdf', data: 'x' },
      { name: 'huge.jpg', data: big }, { name: '../evil.jpg', data: JPEG }, { name: 'ok.jpg', data: JPEG },
    ])
    const r = await readImageArchive(zip, { maxImageBytes: 1000 })
    const by = Object.fromEntries(r.files.map((f) => [f.name, f.problem]))
    assert.deepEqual(by, { 'fake.jpg': 'content', 'renamed.png': 'content', 'logo.svg': 'type', 'doc.pdf': 'type', 'huge.jpg': 'size', 'evil.jpg': 'unsafe', 'ok.jpg': null })
    assert.deepEqual([...r.bytes.keys()], ['ok.jpg'], 'only images that passed are kept for upload')
  })
  it('duplicate base names are both listed (the validator reports E053 ambiguity)', async () => {
    const r = await readImageArchive(await writeZip([{ name: 'a/S1.jpg', data: JPEG }, { name: 'b/S1.jpg', data: JPEG }]))
    assert.equal(r.files.filter((f) => f.name === 'S1.jpg').length, 2)
  })
  it('not a zip, and too many files, are fatal with a readable message', async () => {
    assert.equal((await readImageArchive(new TextEncoder().encode('not a zip at all, sorry'))).fatal.code, 'NOT_A_ZIP')
    const zip = await writeZip(Array.from({ length: 12 }, (_, i) => ({ name: `i${i}.jpg`, data: JPEG })))
    assert.equal((await readImageArchive(zip, { maxFiles: 10 })).fatal.code, 'TOO_MANY_FILES')
  })
  it('a corrupted entry (CRC) becomes a content problem instead of crashing the import', async () => {
    const zip = await writeZip([{ name: 'a.jpg', data: JPEG }])
    const bad = zip.slice(); bad[40] ^= 0xff   // inside the entry data
    assert.equal((await readImageArchive(bad)).files[0].problem, 'content')
  })
  it('the documented limits', () => assert.deepEqual(IMAGE_LIMITS, { maxFiles: 500, maxImageBytes: 5 * 1024 * 1024, maxArchiveBytes: 150 * 1024 * 1024 }))
})

describe('readLooseImages (multi-file picker fallback)', () => {
  const file = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  it('same rules as the archive', async () => {
    const r = await readLooseImages([file('a.jpg', JPEG), file('b.png', JPEG), file('c.svg', new Uint8Array(4)), file('.DS_Store', new Uint8Array(1))])
    assert.deepEqual(r.files.map((f) => [f.name, f.problem]), [['a.jpg', null], ['b.png', 'content'], ['c.svg', 'type']])
    assert.deepEqual([...r.bytes.keys()], ['a.jpg'])
  })
  it('too big in total is fatal', async () => {
    assert.equal((await readLooseImages([file('a.jpg', JPEG), file('b.jpg', JPEG)], { maxArchiveBytes: 20 })).fatal.code, 'TOO_BIG')
  })
})