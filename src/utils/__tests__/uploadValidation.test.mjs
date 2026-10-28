// node --test src/utils/__tests__/uploadValidation.test.mjs
// Tests for src/utils/uploadValidation.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateImageFile, validateImageFiles } from '../uploadValidation.js'

// Minimal File-like stub (no DOM needed)
const file = (name, type, size = 100_000) => ({ name, type, size })

describe('validateImageFile — accepted types', () => {
  it('PNG is allowed', () =>
    assert.equal(validateImageFile(file('photo.png', 'image/png')).ok, true))
  it('JPEG is allowed', () =>
    assert.equal(validateImageFile(file('photo.jpg', 'image/jpeg')).ok, true))
  it('WEBP is allowed', () =>
    assert.equal(validateImageFile(file('photo.webp', 'image/webp')).ok, true))
  it('GIF is allowed by default', () =>
    assert.equal(validateImageFile(file('anim.gif', 'image/gif')).ok, true))
  it('GIF is blocked when allowGif = false', () => {
    const r = validateImageFile(file('anim.gif', 'image/gif'), { allowGif: false })
    assert.equal(r.ok, false)
  })
})

describe('validateImageFile — blocked types', () => {
  it('SVG by MIME type is blocked', () => {
    const r = validateImageFile(file('icon.svg', 'image/svg+xml'))
    assert.equal(r.ok, false)
    assert.match(r.error, /SVG/i)
  })
  it('SVG by extension is blocked even with wrong MIME', () => {
    const r = validateImageFile(file('icon.svg', 'image/png')) // spoofed MIME
    assert.equal(r.ok, false)
  })
  it('PDF is blocked', () => {
    const r = validateImageFile(file('doc.pdf', 'application/pdf'))
    assert.equal(r.ok, false)
  })
  it('MP4 is blocked', () => {
    const r = validateImageFile(file('video.mp4', 'video/mp4'))
    assert.equal(r.ok, false)
  })
})

describe('validateImageFile — size limit', () => {
  const MB5 = 5 * 1024 * 1024
  it('exactly 5 MB passes', () =>
    assert.equal(validateImageFile(file('photo.png', 'image/png', MB5)).ok, true))
  it('5 MB + 1 byte fails', () => {
    const r = validateImageFile(file('big.png', 'image/png', MB5 + 1))
    assert.equal(r.ok, false)
    assert.match(r.error, /too large/i)
  })
  it('custom maxBytes respected', () => {
    const r = validateImageFile(file('photo.png', 'image/png', 1_000_001), { maxBytes: 1_000_000 })
    assert.equal(r.ok, false)
  })
})

describe('validateImageFile — missing file', () => {
  it('null returns ok:false with message', () => {
    const r = validateImageFile(null)
    assert.equal(r.ok, false)
    assert.ok(r.error)
  })
})

describe('validateImageFiles — list validation', () => {
  it('all valid -> ok', () => {
    const r = validateImageFiles([file('a.png', 'image/png'), file('b.jpg', 'image/jpeg')])
    assert.equal(r.ok, true)
  })
  it('one SVG in list -> first error', () => {
    const r = validateImageFiles([file('ok.png', 'image/png'), file('bad.svg', 'image/svg+xml')])
    assert.equal(r.ok, false)
    assert.match(r.error, /SVG/i)
  })
  it('empty list -> ok', () =>
    assert.equal(validateImageFiles([]).ok, true))
})
