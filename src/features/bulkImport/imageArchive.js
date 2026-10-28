// Reading the product-images ZIP (or a multi-file pick) for the bulk importer. Browser module (uses zip.js + Blob/File).
//
// What it decides for every file, BEFORE anything is uploaded (the validator turns each `problem` into E051 / E052 / E054 / E055):
//   * declared size above the per-image limit (5 MB, same rule as the existing product upload)     -> problem 'size'
//   * extension that is not jpg / jpeg / png / webp / gif (SVG is deliberately NOT accepted)         -> problem 'type'
//   * content that is not the image its extension claims (magic bytes: a renamed .exe / .html …)      -> problem 'content'
//   * a zip entry whose path tries to escape the archive (../, absolute)                              -> problem 'unsafe'
// Files are matched to Excel rows by EXACT file name only (the folder inside the zip is ignored) — never by position or fuzzy name.
// Operating-system junk (__MACOSX/, .DS_Store, Thumbs.db, ._x) is dropped silently so it cannot trigger "unused image" warnings.
import { listZip, extractEntry, ZipError } from './zip.js'
import { IMAGE_EXTENSIONS, extensionOf, baseNameOf, keyOf } from './normalize.js'

export const IMAGE_LIMITS = Object.freeze({ maxFiles: 500, maxImageBytes: 5 * 1024 * 1024, maxArchiveBytes: 150 * 1024 * 1024 })
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._[^/]*$)/i

/** 'jpeg' | 'png' | 'gif' | 'webp' | null from the first bytes of a file. */
export function sniffImageType(bytes) {
  const b = bytes
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  return null
}

const typeForExtension = (ext) => (ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext)
export const mimeForType = (type) => ({ jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' })[type] || 'application/octet-stream'

/** The one place that turns "name + bytes + declared size" into a `problem` (or null). */
function judge({ name, size, bytes, unsafe, limits }) {
  if (unsafe) return 'unsafe'
  const ext = extensionOf(name)
  if (!IMAGE_EXTENSIONS.includes(ext)) return 'type'
  if (size > limits.maxImageBytes) return 'size'
  if (!bytes) return 'content'
  return sniffImageType(bytes) === typeForExtension(ext) ? null : 'content'
}

/**
 * input: ArrayBuffer | Uint8Array of the ZIP.
 * Returns { files: [{ name, path, size, problem }], bytes: Map(lower-case base name -> Uint8Array), fatal: null | { code, message } }.
 */
export async function readImageArchive(input, limits = {}) {
  const lim = { ...IMAGE_LIMITS, ...limits }
  let entries
  try {
    entries = listZip(input, { maxEntries: lim.maxFiles + 200, maxEntryBytes: lim.maxImageBytes, maxTotalBytes: lim.maxArchiveBytes })
  } catch (e) {
    if (e instanceof ZipError) return { files: [], bytes: new Map(), fatal: { code: e.code, message: e.code === 'NOT_A_ZIP' ? 'The images file is not a ZIP archive.' : `The images ZIP could not be read: ${e.message}` } }
    throw e
  }
  const candidates = entries.filter((e) => !e.dir && !JUNK.test(e.name))
  if (candidates.length > lim.maxFiles) return { files: [], bytes: new Map(), fatal: { code: 'TOO_MANY_FILES', message: `The images ZIP holds ${candidates.length} files; the limit is ${lim.maxFiles}.` } }

  const files = []
  const bytes = new Map()
  for (const entry of candidates) {
    const name = baseNameOf(entry.name)
    const ext = extensionOf(name)
    let data = null
    let problem = null
    if (entry.unsafe) problem = 'unsafe'
    else if (!IMAGE_EXTENSIONS.includes(ext)) problem = 'type'
    else if (entry.size > lim.maxImageBytes) problem = 'size'
    else {
      try { data = await extractEntry(input, entry, { maxEntryBytes: lim.maxImageBytes }) } catch (e) {
        if (!(e instanceof ZipError)) throw e
        problem = e.code === 'ENTRY_TOO_BIG' ? 'size' : 'content'
      }
      if (!problem) problem = judge({ name, size: entry.size, bytes: data, unsafe: false, limits: lim })
    }
    files.push({ name, path: entry.name, size: entry.size, problem })
    if (data && !problem && !bytes.has(keyOf(name))) bytes.set(keyOf(name), data)
  }
  return { files, bytes, fatal: null }
}

/** Fallback for the multi-file picker: File[] (names are bare, sizes are real). */
export async function readLooseImages(fileList, limits = {}) {
  const lim = { ...IMAGE_LIMITS, ...limits }
  const list = Array.from(fileList).filter((f) => !JUNK.test(f.name))
  if (list.length > lim.maxFiles) return { files: [], bytes: new Map(), fatal: { code: 'TOO_MANY_FILES', message: `${list.length} images were picked; the limit is ${lim.maxFiles}.` } }
  const files = []
  const bytes = new Map()
  let total = 0
  for (const f of list) {
    total += f.size
    if (total > lim.maxArchiveBytes) return { files: [], bytes: new Map(), fatal: { code: 'TOO_BIG', message: `The picked images are larger than ${Math.round(lim.maxArchiveBytes / 1048576)} MB in total.` } }
    const name = baseNameOf(f.name)
    const ext = extensionOf(name)
    let data = null
    let problem = null
    if (!IMAGE_EXTENSIONS.includes(ext)) problem = 'type'
    else if (f.size > lim.maxImageBytes) problem = 'size'
    else { data = new Uint8Array(await f.arrayBuffer()); problem = judge({ name, size: f.size, bytes: data, unsafe: false, limits: lim }) }
    files.push({ name, path: name, size: f.size, problem })
    if (data && !problem && !bytes.has(keyOf(name))) bytes.set(keyOf(name), data)
  }
  return { files, bytes, fatal: null }
}