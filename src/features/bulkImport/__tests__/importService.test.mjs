// node --test src/features/bulkImport/__tests__/importService.test.mjs   (npm run test:unit)
// The runner is tested against a FAKE Supabase client: what is called, in which order, with which arguments, and what happens on failure.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createImportRunner, ImportError, fingerprint, sha256Hex, BUCKET } from '../importService.js'

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const sourceBytes = new Map([['s1.jpg', JPEG], ['p1.png', PNG]])
const PATHS = ['prod_a/thumbnail/S1.jpg', 'prod_b/thumbnail/P1.png']

/** a fake supabase-js client; `script` decides what each RPC answers */
function fake({ rpc = {}, uploadFails = {}, removeError = null } = {}) {
  const log = []
  let inFlight = 0
  let maxInFlight = 0
  const attempts = {}
  const client = {
    async rpc(name, args) {
      log.push(['rpc', name, args])
      const h = rpc[name]
      if (!h) return { data: null, error: { message: `no handler for ${name}` } }
      return typeof h === 'function' ? h(args) : h
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, BUCKET)
        return {
          async upload(path, bytes, opts) {
            inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight)
            await new Promise((r) => setTimeout(r, 2))
            inFlight -= 1
            attempts[path] = (attempts[path] || 0) + 1
            log.push(['upload', path, opts])
            const failures = uploadFails[path] || 0
            if (attempts[path] <= failures) return { data: null, error: { message: 'network down' } }
            return { data: { path }, error: null }
          },
          async remove(paths) { log.push(['remove', paths]); return { error: removeError } },
          getPublicUrl(path) { return { data: { publicUrl: `https://cdn.test/${path}` } } },
        }
      },
    },
  }
  return { client, log, attempts, get maxInFlight() { return maxInFlight } }
}
const names = (log) => log.map((l) => (l[0] === 'rpc' ? `rpc:${l[1]}` : l[0]))
const noSleep = async () => {}
const staged = { ok: true, already: false, batch_id: 'b-1', status: 'staged', image_paths: PATHS, summary: { products: 2 }, groups: [] }
const committed = { ok: true, already: false, status: 'committed', batch_id: 'b-1', summary: { created_products: 2, created_variants: 0 }, report: [] }

describe('the happy path', () => {
  it('stage -> upload every path (upsert, correct content type) -> commit with the public URLs', async () => {
    const f = fake({ rpc: { import_stage_batch: { data: staged, error: null }, import_commit_batch: { data: committed, error: null } } })
    const progress = []
    const r = await createImportRunner(f.client, { sleep: noSleep }).run({ fileHash: 'h'.repeat(64), fileName: 'p.xlsx', groups: [{ import_key: 'A' }], sourceBytes, onProgress: (p) => progress.push(p) })
    assert.equal(r.ok, true)
    assert.deepEqual(names(f.log).filter((n, i, a) => a.indexOf(n) === i), ['rpc:import_stage_batch', 'upload', 'rpc:import_commit_batch'])
    assert.equal(names(f.log)[0], 'rpc:import_stage_batch'); assert.equal(names(f.log).at(-1), 'rpc:import_commit_batch')
    const uploads = Object.fromEntries(f.log.filter((l) => l[0] === 'upload').map((l) => [l[1], l[2]]))
    assert.deepEqual(uploads['prod_a/thumbnail/S1.jpg'], { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
    assert.equal(uploads['prod_b/thumbnail/P1.png'].contentType, 'image/png')
    const stageArgs = f.log[0][2]
    assert.deepEqual(stageArgs, { p_file_hash: 'h'.repeat(64), p_file_name: 'p.xlsx', p_groups: [{ import_key: 'A' }] })
    const commitArgs = f.log.find((l) => l[1] === 'import_commit_batch')[2]
    assert.deepEqual(commitArgs, { p_batch_id: 'b-1', p_urls: { 'prod_a/thumbnail/S1.jpg': 'https://cdn.test/prod_a/thumbnail/S1.jpg', 'prod_b/thumbnail/P1.png': 'https://cdn.test/prod_b/thumbnail/P1.png' } })
    assert.deepEqual(progress.filter((p) => p.phase === 'upload').map((p) => p.done), [1, 2])
    assert.equal(progress.at(-1).phase, 'commit')
  })
  it('uploads run in parallel but never above the concurrency limit', async () => {
    const paths = Array.from({ length: 9 }, (_, i) => `prod_${i}/thumbnail/S1.jpg`)
    const f = fake()
    await createImportRunner(f.client, { sleep: noSleep, concurrency: 3 }).uploadImages({ imagePaths: paths, sourceBytes })
    assert.ok(f.maxInFlight >= 2 && f.maxInFlight <= 3, `max in flight ${f.maxInFlight}`)
    assert.equal(f.log.filter((l) => l[0] === 'upload').length, 9)
  })
})

describe('idempotency and "nothing to do"', () => {
  it('an already COMMITTED batch is reported without uploading or committing again', async () => {
    const f = fake({ rpc: { import_stage_batch: { data: { ok: true, already: true, status: 'committed', batch_id: 'b-1', summary: {}, report: [{ import_key: 'A' }] }, error: null } } })
    const r = await createImportRunner(f.client).run({ fileHash: 'h', groups: [], sourceBytes })
    assert.equal(r.ok, true); assert.equal(r.commit.already, true); assert.deepEqual(names(f.log), ['rpc:import_stage_batch'])
  })
  it('an all-unchanged file stops after the stage', async () => {
    const f = fake({ rpc: { import_stage_batch: { data: { ok: true, status: 'unchanged', groups: [{ status: 'unchanged' }] }, error: null } } })
    const r = await createImportRunner(f.client).run({ fileHash: 'h', groups: [], sourceBytes })
    assert.equal(r.nothingToDo, true); assert.deepEqual(names(f.log), ['rpc:import_stage_batch'])
  })
  it('an already STAGED batch (a retry) continues with the upload + commit', async () => {
    const f = fake({ rpc: { import_stage_batch: { data: { ...staged, already: true }, error: null }, import_commit_batch: { data: committed, error: null } } })
    const r = await createImportRunner(f.client, { sleep: noSleep }).run({ fileHash: 'h', groups: [], sourceBytes })
    assert.equal(r.ok, true); assert.ok(names(f.log).includes('upload'))
  })
})

describe('failures leave the store consistent', () => {
  it('stage refuses the file: no upload, no commit, the errors are handed back', async () => {
    const errors = [{ code: 'E024', row: 3, import_key: 'A', message: 'SKU taken' }]
    const f = fake({ rpc: { import_stage_batch: { data: { ok: false, errors, groups: [] }, error: null } } })
    const r = await createImportRunner(f.client).run({ fileHash: 'h', groups: [], sourceBytes })
    assert.deepEqual([r.ok, r.errors], [false, errors]); assert.deepEqual(names(f.log), ['rpc:import_stage_batch'])
  })
  it('a flaky upload is retried with back-off and then succeeds', async () => {
    const f = fake({ uploadFails: { 'prod_a/thumbnail/S1.jpg': 2 } })
    const waits = []
    await createImportRunner(f.client, { sleep: async (ms) => { waits.push(ms) } }).uploadImages({ imagePaths: ['prod_a/thumbnail/S1.jpg'], sourceBytes })
    assert.equal(f.attempts['prod_a/thumbnail/S1.jpg'], 3); assert.deepEqual(waits, [250, 500])
  })
  it('a permanent upload failure throws UPLOAD_FAILED, never commits, and does NOT cancel (the admin may simply retry)', async () => {
    const f = fake({ rpc: { import_stage_batch: { data: staged, error: null }, import_commit_batch: { data: committed, error: null } }, uploadFails: { 'prod_b/thumbnail/P1.png': 99 } })
    await assert.rejects(() => createImportRunner(f.client, { sleep: noSleep, retries: 2 }).run({ fileHash: 'h', groups: [], sourceBytes }), (e) => {
      assert.ok(e instanceof ImportError); assert.equal(e.code, 'UPLOAD_FAILED'); assert.deepEqual(e.details.failed.map((x) => x.path), ['prod_b/thumbnail/P1.png']); return true
    })
    assert.ok(!names(f.log).includes('rpc:import_commit_batch')); assert.ok(!names(f.log).includes('rpc:import_cancel_batch'))
    assert.equal(f.attempts['prod_b/thumbnail/P1.png'], 3, '1 try + 2 retries')
  })
  it('a source file that is no longer in memory is reported BEFORE anything is uploaded', async () => {
    const f = fake()
    await assert.rejects(() => createImportRunner(f.client).uploadImages({ imagePaths: ['prod_a/thumbnail/GONE.jpg', ...PATHS], sourceBytes }), (e) => e.code === 'SOURCE_MISSING')
    assert.equal(f.log.length, 0)
  })
  it('the server saying IMAGES_MISSING / COMMIT_FAILED comes back as ok:false with its code (no exception)', async () => {
    for (const code of ['IMAGES_MISSING', 'COMMIT_FAILED']) {
      const f = fake({ rpc: { import_stage_batch: { data: staged, error: null }, import_commit_batch: { data: { ok: false, code, message: 'nope' }, error: null } } })
      const r = await createImportRunner(f.client, { sleep: noSleep }).run({ fileHash: 'h', groups: [], sourceBytes })
      assert.deepEqual([r.ok, r.code, r.message], [false, code, 'nope'])
    }
  })
  it('an RPC transport error becomes an ImportError carrying the message', async () => {
    const f = fake({ rpc: { import_stage_batch: { data: null, error: { code: '42501', message: 'Admin access required' } } } })
    await assert.rejects(() => createImportRunner(f.client).run({ fileHash: 'h', groups: [], sourceBytes }), (e) => e instanceof ImportError && e.code === '42501' && /Admin access/.test(e.message))
  })
})

describe('cancel', () => {
  it('cancels the batch, then removes the uploaded files in chunks of 100', async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `prod_${i}/thumbnail/S1.jpg`)
    const f = fake({ rpc: { import_cancel_batch: { data: { ok: true, status: 'cancelled', image_paths: paths }, error: null } } })
    const r = await createImportRunner(f.client).cancel('b-1')
    assert.deepEqual([r.status, r.removed, r.leftover.length], ['cancelled', 250, 0])
    assert.deepEqual(f.log.filter((l) => l[0] === 'remove').map((l) => l[1].length), [100, 100, 50])
    assert.equal(names(f.log)[0], 'rpc:import_cancel_batch')
  })
  it('storage errors are reported (leftover), not thrown', async () => {
    const f = fake({ rpc: { import_cancel_batch: { data: { ok: true, status: 'cancelled', image_paths: PATHS }, error: null } }, removeError: { message: 'denied' } })
    const r = await createImportRunner(f.client).cancel('b-1')
    assert.deepEqual([r.removed, r.leftover], [0, PATHS])
  })
})

describe('fingerprint (the identity of an import)', () => {
  it('same files -> same hash; one changed byte in the workbook or an image -> a different one; order of images is irrelevant', async () => {
    const wb = new Uint8Array([1, 2, 3])
    const imgs = [{ name: 'A.jpg', bytes: JPEG }, { name: 'b.png', bytes: PNG }]
    const h1 = await fingerprint({ workbookBytes: wb, referencedImages: imgs })
    assert.match(h1, /^[0-9a-f]{64}$/)
    assert.equal(await fingerprint({ workbookBytes: wb, referencedImages: [...imgs].reverse() }), h1)
    assert.notEqual(await fingerprint({ workbookBytes: new Uint8Array([1, 2, 4]), referencedImages: imgs }), h1)
    assert.notEqual(await fingerprint({ workbookBytes: wb, referencedImages: [imgs[0], { name: 'b.png', bytes: JPEG }] }), h1)
    assert.notEqual(await fingerprint({ workbookBytes: wb, referencedImages: [imgs[0]] }), h1)
    assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})