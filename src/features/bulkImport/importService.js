// Orchestrates a bulk import against Supabase:  stage (RPC, authoritative dry run) -> upload images -> commit (RPC, atomic).
// Everything that touches the network goes through the `client` argument (a supabase-js client in the app, a fake in
// __tests__/importService.test.mjs), so retries, ordering and clean-up are unit-tested.
//
// Guarantees (see migration 20261017_02_bulk_import.sql):
//   * stage writes nothing but a staged batch row, and only when the whole file is valid;
//   * uploads go to deterministic paths with upsert:true, so a retry overwrites its own files and nothing else;
//   * commit is one transaction — all products or none; a failed commit leaves the batch staged (retry) and cancel removes the files;
//   * the same file hash always maps to the same batch, so a double click / network retry / re-upload cannot create duplicates.
import { keyOf, baseNameOf } from './normalize.js'
import { mimeForType, sniffImageType } from './imageArchive.js'

export const BUCKET = 'products'

export class ImportError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ImportError'; this.code = code; this.details = details }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The identity of an import = the workbook bytes + the bytes of every image the sheet references.
 * Editing a cell or swapping a picture gives a new fingerprint (a new batch); picking the same files again gives the same one.
 */
export async function fingerprint({ workbookBytes, referencedImages = [] }) {
  const parts = [`workbook:${await sha256Hex(workbookBytes)}`]
  const sorted = [...referencedImages].sort((a, b) => (keyOf(a.name) < keyOf(b.name) ? -1 : keyOf(a.name) > keyOf(b.name) ? 1 : 0))
  for (const img of sorted) parts.push(`image:${keyOf(img.name)}:${await sha256Hex(img.bytes)}`)
  return sha256Hex(new TextEncoder().encode(parts.join('\n')))
}

const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out }

export function createImportRunner(client, { sleep = defaultSleep, retries = 3, concurrency = 4 } = {}) {
  const rpc = async (name, args) => {
    const { data, error } = await client.rpc(name, args)
    if (error) throw new ImportError(error.code || 'RPC_FAILED', error.message || String(error), { rpc: name })
    return data
  }

  /** Stage. Resolves to the RPC document: { ok, already?, status?, batch_id?, groups, image_paths, errors?, summary } */
  async function stage({ fileHash, fileName, groups }) {
    return rpc('import_stage_batch', { p_file_hash: fileHash, p_file_name: fileName || null, p_groups: groups })
  }

  /** Uploads every path of the batch. `sourceBytes`: Map(lower-case file name -> Uint8Array). Throws UPLOAD_FAILED with the failed paths. */
  async function uploadImages({ imagePaths, sourceBytes, onProgress = () => {} }) {
    const missing = imagePaths.filter((p) => !sourceBytes.has(keyOf(baseNameOf(p))))
    if (missing.length) throw new ImportError('SOURCE_MISSING', `${missing.length} image(s) are no longer available in the selected files (${missing.slice(0, 3).map(baseNameOf).join(', ')}…). Pick the images again.`, { missing })
    const failed = []
    let done = 0
    const queue = [...imagePaths]
    const bucket = client.storage.from(BUCKET)
    const worker = async () => {
      for (;;) {
        const path = queue.shift()
        if (path === undefined) return
        const bytes = sourceBytes.get(keyOf(baseNameOf(path)))
        const contentType = mimeForType(sniffImageType(bytes))
        let ok = false
        let lastError = null
        for (let attempt = 0; attempt <= retries && !ok; attempt++) {
          if (attempt > 0) await sleep(250 * 2 ** (attempt - 1))
          const { error } = await bucket.upload(path, bytes, { upsert: true, contentType, cacheControl: '3600' })
          if (error) lastError = error; else ok = true
        }
        if (!ok) failed.push({ path, message: lastError?.message || 'upload failed' })
        done += 1
        onProgress({ phase: 'upload', done, total: imagePaths.length, label: baseNameOf(path) })
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, imagePaths.length || 1)) }, worker))
    if (failed.length) throw new ImportError('UPLOAD_FAILED', `${failed.length} of ${imagePaths.length} image(s) could not be uploaded (${failed[0].message}). Nothing was imported; run the import again to retry.`, { failed })
    return { uploaded: imagePaths.length }
  }

  /** Public URL of every path (the server stores URLs, exactly like the admin product form does). */
  const urlsFor = (imagePaths) => {
    const bucket = client.storage.from(BUCKET)
    return Object.fromEntries(imagePaths.map((p) => [p, bucket.getPublicUrl(p).data.publicUrl]))
  }

  async function commit({ batchId, imagePaths }) {
    return rpc('import_commit_batch', { p_batch_id: batchId, p_urls: urlsFor(imagePaths) })
  }

  /** Cancels a staged batch and deletes its uploaded files. Storage errors are reported, never thrown (the DB side is already cancelled). */
  async function cancel(batchId) {
    const res = await rpc('import_cancel_batch', { p_batch_id: batchId })
    const paths = res.image_paths || []
    const failed = []
    for (const part of chunk(paths, 100)) {
      const { error } = await client.storage.from(BUCKET).remove(part)
      if (error) failed.push(...part)
    }
    return { status: res.status, removed: paths.length - failed.length, leftover: failed }
  }

  /**
   * The whole import. Resolves to { ok:true, stage, commit } | { ok:false, stage?, commit?, errors?, code?, message? }.
   * Throws ImportError for transport / upload problems (the batch stays staged: call run() again, or cancel()).
   */
  async function run({ fileHash, fileName, groups, sourceBytes, onProgress = () => {} }) {
    onProgress({ phase: 'stage', done: 0, total: 1, label: 'Checking the file against the store' })
    const st = await stage({ fileHash, fileName, groups })
    onProgress({ phase: 'stage', done: 1, total: 1, label: 'Checked' })
    if (!st.ok) return { ok: false, stage: st, errors: st.errors || [] }
    if (st.status === 'unchanged') return { ok: true, stage: st, commit: null, nothingToDo: true }
    if (st.status === 'committed') return { ok: true, stage: st, commit: { ok: true, already: true, report: st.report, summary: st.summary } }
    const paths = st.image_paths || []
    await uploadImages({ imagePaths: paths, sourceBytes, onProgress })
    onProgress({ phase: 'commit', done: 0, total: 1, label: 'Creating the products' })
    const done = await commit({ batchId: st.batch_id, imagePaths: paths })
    onProgress({ phase: 'commit', done: 1, total: 1, label: 'Done' })
    if (!done.ok) return { ok: false, stage: st, commit: done, code: done.code, message: done.message }
    return { ok: true, stage: st, commit: done }
  }

  return { stage, uploadImages, commit, cancel, run, urlsFor }
}