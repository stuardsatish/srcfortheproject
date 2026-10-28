// node --test src/features/bulkImport/__tests__/zip.test.mjs   (npm run test:unit)
// The reader must survive hostile archives (this file is the P-13 / "hostile-file" evidence for the ZIP layer).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ZipError, crc32, listZip, extractEntry, writeZip } from '../zip.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const rejectsWith = async (promiseOrFn, codes) => {
  const list = Array.isArray(codes) ? codes : [codes]
  try { await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn) } catch (e) {
    assert.ok(e instanceof ZipError, `expected a ZipError, got ${e}`)
    assert.ok(list.includes(e.code), `expected one of ${list} but got ${e.code}: ${e.message}`)
    return
  }
  assert.fail(`expected a ZipError (${list})`)
}
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// produced by .NET System.IO.Compression (an INDEPENDENT writer: deflate entries, UTF-8 names, none of our code involved)
const DOTNET_ZIP = 'UEsDBBQAAAAIAGF2UV0iGCRWKgAAACgAAAAJAAAAaGVsbG8udHh080jNyclXqMosUNBVCCpWMDUwUEjMS1FIVCgqLUhNVSjOTM+zUnjUtBMAUEsDBBQAAAAIAGF2UV1b/o6YEQAAAOgDAAAMAAAAZGlyL2RhdGEuYmluc3RydnF1c3ccpUapUWr4UgBQSwMEFAAAAAAAYXZRXQAAAAAAAAAAAAAAAAkAAABlbXB0eS50eHRQSwMEFAAACAgAYXZRXXjVLx0OAAAADAAAABAAAABpbWFnZXMvw7xuw68udHh0K83LTM5PSVXIS8xNBQBQSwECFAAUAAAACABhdlFdIhgkVioAAAAoAAAACQAAAAAAAAAAAAAAAAAAAAAAaGVsbG8udHh0UEsBAhQAFAAAAAgAYXZRXVv+jpgRAAAA6AMAAAwAAAAAAAAAAAAAAAAAUQAAAGRpci9kYXRhLmJpblBLAQIUABQAAAAAAGF2UV0AAAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAAAIwAAABlbXB0eS50eHRQSwECFAAUAAAICABhdlFdeNUvHQ4AAAAMAAAAEAAAAAAAAAAAAAAAAACzAAAAaW1hZ2VzL8O8bsOvLnR4dFBLBQYAAAAABAAEAOYAAADvAAAAAAA='

describe('crc32', () => {
  it('matches the standard check value', () => assert.equal(crc32(enc.encode('123456789')), 0xcbf43926))
  it('empty input', () => assert.equal(crc32(new Uint8Array(0)), 0))
})

describe('reading an archive written by another tool (.NET, deflate)', () => {
  const bytes = b64(DOTNET_ZIP)
  it('lists names, sizes and methods without inflating anything', () => {
    const e = listZip(bytes)
    assert.deepEqual(e.map((x) => x.name).sort(), ['dir/data.bin', 'empty.txt', 'hello.txt', 'images/ünï.txt'])
    assert.equal(e.find((x) => x.name === 'dir/data.bin').size, 1000)
    assert.equal(e.find((x) => x.name === 'dir/data.bin').method, 8)
    assert.ok(e.every((x) => !x.unsafe && !x.dir))
  })
  it('inflates deflated entries and verifies size + CRC', async () => {
    const e = listZip(bytes)
    const hello = await extractEntry(bytes, e.find((x) => x.name === 'hello.txt'))
    assert.equal(dec.decode(hello), 'Hello zip - Rs 500 and a rupee sign: ₹')
    const data = await extractEntry(bytes, e.find((x) => x.name === 'dir/data.bin'))
    assert.equal(data.length, 1000)
    assert.deepEqual([...data.slice(0, 8)], [65, 66, 67, 68, 69, 70, 71, 65])
    assert.equal((await extractEntry(bytes, e.find((x) => x.name === 'empty.txt'))).length, 0)
    assert.equal(dec.decode(await extractEntry(bytes, e.find((x) => x.name === 'images/ünï.txt'))), 'unicode name')
  })
})

describe('writer -> reader round trip', () => {
  it('stored entries, UTF-8 names, binary data', async () => {
    const bin = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31) & 255)
    const zip = await writeZip([{ name: 'a/b.txt', data: 'héllo ₹' }, { name: 'bin.dat', data: bin }, { name: 'empty', data: new Uint8Array(0) }])
    const e = listZip(zip)
    assert.deepEqual(e.map((x) => [x.name, x.size, x.method]), [['a/b.txt', 10, 0], ['bin.dat', 4096, 0], ['empty', 0, 0]])
    assert.equal(dec.decode(await extractEntry(zip, e[0])), 'héllo ₹')
    assert.deepEqual(await extractEntry(zip, e[1]), bin)
  })
  it('deflate option shrinks compressible data and still round-trips', async () => {
    const big = enc.encode('abcdefghij'.repeat(5000))
    const zip = await writeZip([{ name: 'big.txt', data: big }], { deflate: true })
    const e = listZip(zip)
    assert.equal(e[0].method, 8); assert.ok(e[0].compressedSize < big.length / 10)
    assert.deepEqual(await extractEntry(zip, e[0]), big)
  })
  it('output is byte-identical between runs (deterministic: fixed timestamps)', async () => {
    const a = await writeZip([{ name: 'x', data: 'y' }]); const b = await writeZip([{ name: 'x', data: 'y' }])
    assert.deepEqual(a, b)
  })
})

describe('hostile archives', () => {
  it('not a zip / too small / truncated', async () => {
    await rejectsWith(() => listZip(enc.encode('hello')), 'NOT_A_ZIP')
    await rejectsWith(() => listZip(enc.encode('x'.repeat(5000))), 'NOT_A_ZIP')
    const zip = await writeZip([{ name: 'a', data: 'b' }])
    await rejectsWith(() => listZip(zip.slice(0, zip.length - 10)), ['NOT_A_ZIP', 'CORRUPT'])
  })
  it('too many entries', async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' }))
    const zip = await writeZip(files)
    await rejectsWith(() => listZip(zip, { maxEntries: 10 }), 'TOO_MANY_ENTRIES')
    assert.equal(listZip(zip, { maxEntries: 30 }).length, 30)
  })
  it('declared total size above the limit is refused BEFORE inflating anything', async () => {
    const zip = await writeZip([{ name: 'a.bin', data: new Uint8Array(3000) }, { name: 'b.bin', data: new Uint8Array(3000) }])
    await rejectsWith(() => listZip(zip, { maxTotalBytes: 5000 }), 'TOO_BIG')
  })
  it('an entry above the per-entry limit is refused', async () => {
    const zip = await writeZip([{ name: 'a.bin', data: new Uint8Array(3000) }])
    const [e] = listZip(zip)
    await rejectsWith(extractEntry(zip, e, { maxEntryBytes: 1000 }), 'ENTRY_TOO_BIG')
  })
  it('ZIP BOMB: 5 MB of zeros deflated to a few KB, but the limit is 100 KB -> refused', async () => {
    const zip = await writeZip([{ name: 'bomb.bin', data: new Uint8Array(5 * 1024 * 1024) }], { deflate: true })
    assert.ok(zip.length < 20000, 'the archive itself is tiny')
    const [e] = listZip(zip)
    await rejectsWith(extractEntry(zip, e, { maxEntryBytes: 100 * 1024 }), 'ENTRY_TOO_BIG')
  })
  it('LYING header: a declared size smaller than the real data is caught (never trusted)', async () => {
    const zip = await writeZip([{ name: 'big.txt', data: enc.encode('abcdefghij'.repeat(2000)) }], { deflate: true })
    const [e] = listZip(zip)
    await rejectsWith(extractEntry(zip, { ...e, size: 50 }), ['ENTRY_TOO_BIG', 'SIZE_MISMATCH'])
  })
  it('wrong CRC / corrupted data', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: 'hello world, hello world' }])
    const [e] = listZip(zip)
    await rejectsWith(extractEntry(zip, { ...e, crc32: e.crc32 ^ 1 }), 'CRC_MISMATCH')
    const bad = zip.slice(); bad[bad.indexOf(104)] ^= 0xff   // flip a data byte ('h')
    const [e2] = listZip(bad)
    await rejectsWith(extractEntry(bad, e2), 'CRC_MISMATCH')
  })
  it('encrypted entries and unsupported methods are refused', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: 'hello' }])
    const [e] = listZip(zip)
    await rejectsWith(extractEntry(zip, { ...e, flags: e.flags | 1 }), 'ENCRYPTED')
    await rejectsWith(extractEntry(zip, { ...e, method: 12 }), 'METHOD_UNSUPPORTED')
  })
  it('names that try to escape are flagged `unsafe` (nothing is ever written to disk)', async () => {
    const zip = await writeZip([{ name: '../evil.txt', data: 'x' }, { name: '/abs.txt', data: 'x' }, { name: 'C:\\win.txt', data: 'x' }, { name: 'ok/fine.txt', data: 'x' }, { name: 'a\\..\\b.txt', data: 'x' }])
    assert.deepEqual(listZip(zip).map((x) => x.unsafe), [true, true, true, false, true])
  })
  it('local header offset / compressed size pointing outside the file', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: 'hello' }])
    const [e] = listZip(zip)
    await rejectsWith(extractEntry(zip, { ...e, localOffset: zip.length + 100 }), 'CORRUPT')
    await rejectsWith(extractEntry(zip, { ...e, compressedSize: 99999 }), 'CORRUPT')
  })
})