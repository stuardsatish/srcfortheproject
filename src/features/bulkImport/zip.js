// Minimal, DEPENDENCY-FREE ZIP reader / writer for the bulk importer (Excel workbook = a zip of XML; the product images arrive as a zip).
//
// WHY no library: the importer must parse files an admin picks from disk. `xlsx@0.18.5` (already in the project, export only) has known
// parsing CVEs (P-13), and every extra parser is more attack surface. A workbook / image archive needs only ~150 lines of ZIP, so we
// own them, test them against hostile files (src/features/bulkImport/__tests__/zip.test.mjs) and keep the surface small.
//
// READER — central-directory based. Supports method 0 (stored) and 8 (deflate, through the platform's DecompressionStream('deflate-raw')).
//   Defences:  entry-count limit · declared AND actual size limits (inflation is aborted the moment it exceeds the limit, so a
//   "zip bomb" cannot allocate gigabytes) · actual size must equal the declared size · CRC-32 is verified · encrypted entries,
//   ZIP64 and unknown methods are refused · names are normalised and flagged `unsafe` when they try to escape (../, absolute, NUL).
//   Nothing is ever written to a file system by this module, so path traversal could not do harm anyway; the flag exists so the
//   validator can report it.
// WRITER — stored entries only (deterministic, no compression API needed, so it also runs under Node for the template builder);
//   optional `deflate` uses CompressionStream when the platform has it.
//
// Pure ES module: no DOM, no npm imports. Works in the browser and in Node >= 18.

export class ZipError extends Error {
  constructor(code, message) { super(message); this.name = 'ZipError'; this.code = code }
}

export const ZIP_DEFAULT_LIMITS = Object.freeze({
  maxEntries: 2000,                   // entries in the archive
  maxEntryBytes: 25 * 1024 * 1024,    // one inflated entry (callers pass 5 MB for images, 25 MB for workbook parts)
  maxTotalBytes: 150 * 1024 * 1024,   // sum of declared sizes in the archive
})

const SIG_EOCD = 0x06054b50
const SIG_CEN = 0x02014b50
const SIG_LOC = 0x04034b50

const toBytes = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf))

// ── CRC-32 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let CRC_TABLE = null
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** "a\\b/../c.png" -> { name: "c.png"... } is NOT done here: we keep the path, normalise separators and flag escapes. */
function normaliseName(raw) {
  const name = raw.replace(/\\/g, '/')
  const unsafe = name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || name.includes('\0')
  return { name, unsafe }
}

function decodeName(bytes, utf8Flag) {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (utf8Flag || !text.includes('�')) return text
  return new TextDecoder('windows-1252').decode(bytes)      // Windows Explorer zips without the UTF-8 flag
}

/**
 * Lists the entries of a zip WITHOUT inflating anything.
 * Returns [{ name, unsafe, dir, method, flags, crc32, compressedSize, size, localOffset }].
 */
export function listZip(input, limits = {}) {
  const lim = { ...ZIP_DEFAULT_LIMITS, ...limits }
  const bytes = toBytes(input)
  if (bytes.length < 22) throw new ZipError('NOT_A_ZIP', 'The file is too small to be a zip archive')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // end-of-central-directory record: the last 22 + (comment up to 65535) bytes
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new ZipError('NOT_A_ZIP', 'Not a zip archive (no central directory found)')
  const total = dv.getUint16(eocd + 10, true)
  const cdSize = dv.getUint32(eocd + 12, true)
  const cdOffset = dv.getUint32(eocd + 16, true)
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64_UNSUPPORTED', 'ZIP64 archives are not supported')
  if (total > lim.maxEntries) throw new ZipError('TOO_MANY_ENTRIES', `The archive has ${total} entries; the limit is ${lim.maxEntries}`)
  if (cdOffset + cdSize > bytes.length) throw new ZipError('CORRUPT', 'The zip central directory points outside the file')

  const entries = []
  let p = cdOffset
  let declaredTotal = 0
  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CEN) throw new ZipError('CORRUPT', 'Corrupt zip central directory')
    const flags = dv.getUint16(p + 8, true)
    const method = dv.getUint16(p + 10, true)
    const crc = dv.getUint32(p + 16, true)
    const compressedSize = dv.getUint32(p + 20, true)
    const size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    if (p + 46 + nameLen + extraLen + commentLen > bytes.length) throw new ZipError('CORRUPT', 'Corrupt zip central directory')
    const rawName = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0)
    const { name, unsafe } = normaliseName(rawName)
    declaredTotal += size
    entries.push({ name, unsafe, dir: name.endsWith('/'), method, flags, crc32: crc, compressedSize, size, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  if (declaredTotal > lim.maxTotalBytes) throw new ZipError('TOO_BIG', `The archive expands to ${declaredTotal} bytes; the limit is ${lim.maxTotalBytes}`)
  return entries
}

async function inflateRaw(compressed, maxBytes) {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('NO_DEFLATE', 'This browser cannot read compressed zip entries (DecompressionStream is missing)')
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    let r
    try { r = await reader.read() } catch (e) { throw new ZipError('CORRUPT', `Corrupt compressed data (${e?.message || e})`) }
    if (r.done) break
    total += r.value.length
    if (total > maxBytes) { try { await reader.cancel() } catch { /* already stopping */ } throw new ZipError('ENTRY_TOO_BIG', `An entry inflates beyond the ${maxBytes}-byte limit`) }
    chunks.push(r.value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

/** Inflates ONE entry (from listZip) with the size checks described above. */
export async function extractEntry(input, entry, limits = {}) {
  const lim = { ...ZIP_DEFAULT_LIMITS, ...limits }
  const bytes = toBytes(input)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (entry.dir) return new Uint8Array(0)
  if (entry.flags & 0x1) throw new ZipError('ENCRYPTED', `"${entry.name}" is encrypted / password protected`)
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError('METHOD_UNSUPPORTED', `"${entry.name}" uses an unsupported compression method (${entry.method})`)
  if (entry.size > lim.maxEntryBytes) throw new ZipError('ENTRY_TOO_BIG', `"${entry.name}" is ${entry.size} bytes; the limit is ${lim.maxEntryBytes}`)
  const lo = entry.localOffset
  if (lo + 30 > bytes.length || dv.getUint32(lo, true) !== SIG_LOC) throw new ZipError('CORRUPT', `Corrupt local header for "${entry.name}"`)
  const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true)
  const end = start + entry.compressedSize
  if (end > bytes.length) throw new ZipError('CORRUPT', `"${entry.name}" is truncated`)
  const raw = bytes.subarray(start, end)
  const out = entry.method === 0 ? raw.slice() : await inflateRaw(raw, Math.min(lim.maxEntryBytes, entry.size + 1))
  if (out.length !== entry.size) throw new ZipError('SIZE_MISMATCH', `"${entry.name}" does not match its declared size (${out.length} vs ${entry.size})`)
  if (crc32(out) !== entry.crc32) throw new ZipError('CRC_MISMATCH', `"${entry.name}" is corrupt (CRC mismatch)`)
  return out
}

// ── writer ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const enc = new TextEncoder()
const DOS_TIME = 0                                  // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1  // 2026-01-01 — a fixed stamp keeps generated files byte-identical between runs

async function deflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * files: [{ name: 'a/b.txt', data: Uint8Array | string }]. Returns the archive bytes.
 * options.deflate: compress entries when it makes them smaller (needs CompressionStream; otherwise stored).
 */
export async function writeZip(files, { deflate = false } = {}) {
  const parts = []
  const central = []
  let offset = 0
  const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b }
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b }
  const push = (...chunks) => { for (const c of chunks) { parts.push(c); offset += c.length } }

  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : toBytes(f.data)
    const crc = crc32(data)
    let method = 0
    let body = data
    if (deflate && typeof CompressionStream !== 'undefined' && data.length > 64) {
      const z = await deflateRaw(data)
      if (z.length < data.length) { method = 8; body = z }
    }
    const localOffset = offset
    push(u32(SIG_LOC), u16(20), u16(0x800), u16(method), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(body.length), u32(data.length),
      u16(nameBytes.length), u16(0), nameBytes, body)
    central.push({ nameBytes, crc, method, csize: body.length, size: data.length, localOffset })
  }
  const cdStart = offset
  for (const c of central) {
    push(u32(SIG_CEN), u16(20), u16(20), u16(0x800), u16(c.method), u16(DOS_TIME), u16(DOS_DATE), u32(c.crc), u32(c.csize), u32(c.size),
      u16(c.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.localOffset), c.nameBytes)
  }
  const cdSize = offset - cdStart
  push(u32(SIG_EOCD), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0))

  const out = new Uint8Array(offset)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}