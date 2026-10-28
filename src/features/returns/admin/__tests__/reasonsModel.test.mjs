// node --test src/features/returns/admin/__tests__/reasonsModel.test.mjs   (npm run test:unit)
// The admin editor of the configurable return / exchange reasons (website only). Its rules mirror the CHECKs of public.request_reasons.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { REASON_TYPES, blankReason, mapReason, mapReasons, reasonRow, reasonSummary, slugReasonCode, validateReason } from '../reasonsModel.js'

const R = (code, over = {}) => ({ code, label: code, appliesTo: ['return', 'exchange'], sellerFault: false, requiresEvidence: false, requiresDescription: false, active: true, sortOrder: 100, ...over })
const SEEDED = [R('damaged', { sellerFault: true, requiresEvidence: true }), R('incorrect_size'), R('other', { requiresDescription: true })]

describe('slugReasonCode', () => {
  it('lower-case letters, digits and single underscores, at most 40 characters', () => {
    assert.equal(slugReasonCode('Wrong colour sent!'), 'wrong_colour_sent')
    assert.equal(slugReasonCode('  Size / fit  '), 'size_fit')
    assert.equal(slugReasonCode('x'.repeat(60)).length, 40)
    assert.equal(slugReasonCode(''), '')
    assert.equal(slugReasonCode(null), '')
  })
})

describe('mapReason / reasonRow', () => {
  it('maps a request_reasons row; unknown types are dropped, defaults are sane', () => {
    assert.deepEqual(mapReason({ code: 'damaged', label: 'Damaged product', applies_to: ['return', 'exchange', 'refund'], seller_fault: true, requires_evidence: true, requires_description: false, active: true, sort_order: 10 }),
      { code: 'damaged', label: 'Damaged product', appliesTo: ['return', 'exchange'], sellerFault: true, requiresEvidence: true, requiresDescription: false, active: true, sortOrder: 10 })
    assert.deepEqual(mapReason({ code: 'x' }), { code: 'x', label: '', appliesTo: [], sellerFault: false, requiresEvidence: false, requiresDescription: false, active: true, sortOrder: 100 })
    assert.equal(mapReason(null), null)
    assert.deepEqual(mapReasons([{ code: 'a' }, null, { code: 'b', active: false }]).map((r) => [r.code, r.active]), [['a', true], ['b', false]])
  })
  it('writes the database columns', () => {
    const r = reasonRow({ code: 'late', label: 'Arrived late', appliesTo: ['return'], sellerFault: true, requiresEvidence: false, requiresDescription: true, active: false, sortOrder: 55 })
    assert.deepEqual({ ...r, updated_at: '-' }, { code: 'late', label: 'Arrived late', applies_to: ['return'], seller_fault: true, requires_evidence: false, requires_description: true, active: false, sort_order: 55, updated_at: '-' })
    assert.match(r.updated_at, /^\d{4}-\d\d-\d\dT/)
  })
})

describe('validateReason', () => {
  it('a good new reason is accepted and cleaned (trimmed, code lower-cased, defaults)', () => {
    const r = validateReason({ ...blankReason(), label: '  Arrived late ', code: ' Arrived_Late ', sellerFault: true }, { existing: SEEDED, isNew: true })
    assert.equal(r.ok, true)
    assert.deepEqual(r.value, { code: 'arrived_late', label: 'Arrived late', appliesTo: ['return', 'exchange'], sellerFault: true, requiresEvidence: false, requiresDescription: false, active: true, sortOrder: 100 })
  })
  const bad = [
    [{ label: '' }, 'label'], [{ label: ' ' }, 'label'], [{ label: 'x'.repeat(81) }, 'label'],
    [{ code: '' }, 'code'], [{ code: 'a' }, 'code'], [{ code: 'Has Space' }, 'code'], [{ code: 'dash-ed' }, 'code'], [{ code: 'x'.repeat(41) }, 'code'],
    [{ code: 'damaged' }, 'code'],                                   // already used (new reason)
    [{ appliesTo: [] }, 'appliesTo'], [{ appliesTo: ['refund'] }, 'appliesTo'], [{ appliesTo: null }, 'appliesTo'],
    [{ sortOrder: 1.5 }, 'sortOrder'], [{ sortOrder: -1 }, 'sortOrder'], [{ sortOrder: 100001 }, 'sortOrder'], [{ sortOrder: 'abc' }, 'sortOrder'],
  ]
  for (const [over, field] of bad) {
    it(`${JSON.stringify(over)} is refused on ${field}`, () => {
      const r = validateReason({ ...blankReason(), label: 'Fine label', code: 'fine_code', ...over }, { existing: SEEDED, isNew: true })
      assert.equal(r.ok, false)
      assert.ok(r.errors[field], JSON.stringify(r.errors))
    })
  }
  it('an empty sort order means 100; editing keeps the code (a duplicate is only refused for a NEW reason)', () => {
    assert.equal(validateReason({ ...blankReason(), label: 'A', code: 'aa', sortOrder: '' }).value.sortOrder, 100)
    assert.equal(validateReason({ ...SEEDED[0], label: 'Damaged on arrival' }, { existing: SEEDED, isNew: false }).ok, true)
  })
  it('a change can never leave a request type without an active reason', () => {
    const only = [R('aa', { appliesTo: ['return'] }), R('bb', { appliesTo: ['exchange'] })]
    assert.match(validateReason({ ...only[0], active: false }, { existing: only, isNew: false }).errors.active, /Return requests need at least one active reason/)
    assert.match(validateReason({ ...only[1], active: false }, { existing: only, isNew: false }).errors.active, /Exchange requests need at least one active reason/)
    assert.match(validateReason({ ...only[0], appliesTo: ['exchange'] }, { existing: only, isNew: false }).errors.active, /Return requests/)     // moving it away from Return
    assert.equal(validateReason({ ...SEEDED[0], active: false }, { existing: SEEDED, isNew: false }).ok, true)                                  // others still cover both types
    assert.equal(validateReason({ ...only[0], active: false }, { existing: [...only, R('cc', { appliesTo: ['return'] })], isNew: false }).ok, true)
  })
  it('switching a reason on again is always fine', () => {
    const off = [R('aa', { active: false }), R('bb', { appliesTo: ['return'] })]
    assert.equal(validateReason({ ...off[0], active: true }, { existing: off, isNew: false }).ok, true)
  })
})

describe('reasonSummary', () => {
  it('names the types and the flags', () => {
    assert.equal(reasonSummary(R('damaged', { sellerFault: true, requiresEvidence: true })), "Return · Exchange | seller's fault | photo required")
    assert.equal(reasonSummary(R('other', { appliesTo: ['return'], requiresDescription: true })), 'Return | description required')
    assert.equal(reasonSummary(R('plain', { appliesTo: ['exchange'] })), 'Exchange')
  })
  it('the two request types', () => assert.deepEqual(REASON_TYPES, ['return', 'exchange']))
})