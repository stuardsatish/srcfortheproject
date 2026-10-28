// node --test src/utils/__tests__/addressLogic.test.mjs
// Tests for src/utils/addressLogic.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePhone,
  emptyAddressFields,
  validateAddress,
  formatAddressLine,
  fromRow,
  toRow,
  addressFromProfile,
  isBackendMissing,
} from '../addressLogic.js'

// ── normalizePhone ──────────────────────────────────────────────────────────
describe('normalizePhone', () => {
  it('10-digit -> unchanged', () => assert.equal(normalizePhone('9876543210'), '9876543210'))
  it('+91 prefix stripped', () => assert.equal(normalizePhone('+91 9876543210'), '9876543210'))
  it('91 prefix (12 digits) stripped', () => assert.equal(normalizePhone('919876543210'), '9876543210'))
  it('leading 0 stripped (11 digits)', () => assert.equal(normalizePhone('09876543210'), '9876543210'))
  it('spaces and dashes removed', () => assert.equal(normalizePhone('98765 43210'), '9876543210'))
  it('null -> empty string', () => assert.equal(normalizePhone(null), ''))
  it('empty -> empty', () => assert.equal(normalizePhone(''), ''))
})

// ── emptyAddressFields ──────────────────────────────────────────────────────
describe('emptyAddressFields', () => {
  it('returns default label Home', () => assert.equal(emptyAddressFields().label, 'Home'))
  it('seed overrides specific keys', () => {
    const f = emptyAddressFields({ fullName: 'Priya', phone: '9876543210' })
    assert.equal(f.fullName, 'Priya')
    assert.equal(f.label, 'Home') // default preserved
  })
})

// ── validateAddress ─────────────────────────────────────────────────────────
const VALID = {
  label: 'Home', fullName: 'Priya Sharma', phone: '9876543210',
  line1: '14B Main Street', city: 'Bangalore', state: 'Karnataka', pincode: '560001',
}

describe('validateAddress', () => {
  it('valid address passes', () => {
    const r = validateAddress(VALID)
    assert.equal(r.ok, true)
    assert.deepEqual(r.errors, {})
  })
  it('label missing -> errors.label', () =>
    assert.ok(validateAddress({ ...VALID, label: '' }).errors.label))
  it('label too long -> errors.label', () =>
    assert.ok(validateAddress({ ...VALID, label: 'x'.repeat(31) }).errors.label))
  it('fullName < 2 chars -> errors.fullName', () =>
    assert.ok(validateAddress({ ...VALID, fullName: 'A' }).errors.fullName))
  it('bad phone -> errors.phone', () =>
    assert.ok(validateAddress({ ...VALID, phone: '12345' }).errors.phone))
  it('line1 < 3 chars -> errors.line1', () =>
    assert.ok(validateAddress({ ...VALID, line1: 'AB' }).errors.line1))
  it('line1 = 3 chars -> ok', () =>
    assert.equal(validateAddress({ ...VALID, line1: '14B' }).errors.line1, undefined))
  it('city missing -> errors.city', () =>
    assert.ok(validateAddress({ ...VALID, city: '' }).errors.city))
  it('state missing -> errors.state', () =>
    assert.ok(validateAddress({ ...VALID, state: '' }).errors.state))
  it('bad pincode -> errors.pincode', () =>
    assert.ok(validateAddress({ ...VALID, pincode: '12345' }).errors.pincode))
  it('valid 6-digit pincode -> ok', () =>
    assert.equal(validateAddress({ ...VALID, pincode: '560001' }).errors.pincode, undefined))
  it('values are trimmed and normalised', () => {
    const r = validateAddress({ ...VALID, line1: '  14B Main  ', city: '  Bangalore  ' })
    assert.equal(r.values.line1, '14B Main')
    assert.equal(r.values.city, 'Bangalore')
  })
  it('null fields -> ok: false', () => assert.equal(validateAddress(null).ok, false))
})

// ── formatAddressLine ───────────────────────────────────────────────────────
describe('formatAddressLine', () => {
  it('full address', () => {
    const s = formatAddressLine({ line1: '14B', city: 'Bangalore', state: 'KA', pincode: '560001' })
    assert.match(s, /14B/)
    assert.match(s, /560001/)
  })
  it('trailing comma on part is removed', () => {
    const s = formatAddressLine({ line1: 'Navy Nagar 3,', city: 'Mumbai' })
    assert.ok(!s.includes(',,'))
  })
  it('no pincode -> no dash suffix', () => {
    const s = formatAddressLine({ line1: '12 Main', city: 'Pune' })
    assert.ok(!s.includes(' - '))
  })
  it('null -> empty string', () => assert.equal(formatAddressLine(null), ''))
})

// ── fromRow / toRow ─────────────────────────────────────────────────────────
describe('fromRow', () => {
  it('maps snake_case DB row to camelCase UI object', () => {
    const row = { id: 1, full_name: 'Raj', phone: '9876543210', line1: '1 Main', line2: '', landmark: '', city: 'Delhi', state: 'DL', pincode: '110001', country: 'India', is_default: true, created_at: '2026-01-01' }
    const ui = fromRow(row)
    assert.equal(ui.fullName, 'Raj')
    assert.equal(ui.isDefault, true)
    assert.equal(ui.country, 'India')
  })
  it('null row -> defaults to empty strings', () => {
    const ui = fromRow(null)
    assert.equal(ui.fullName, '')
    assert.equal(ui.country, 'India')
  })
})

describe('toRow', () => {
  it('maps camelCase to snake_case and only emits present keys', () => {
    const row = toRow({ fullName: 'Raj', city: 'Delhi', isDefault: true })
    assert.equal(row.full_name, 'Raj')
    assert.equal(row.city, 'Delhi')
    assert.equal(row.is_default, true)
    assert.equal('pincode' in row, false) // not included in input
  })
  it('isDefault false is NOT sent', () => {
    const row = toRow({ fullName: 'A', isDefault: false })
    assert.equal('is_default' in row, false)
  })
})

// ── addressFromProfile ───────────────────────────────────────────────────────
describe('addressFromProfile', () => {
  it('null -> null', () => assert.equal(addressFromProfile(null), null))
  it('string address -> line1', () => {
    const a = addressFromProfile('14 Main Street')
    assert.equal(a.line1, '14 Main Street')
    assert.equal(a.isDefault, true)
  })
  it('empty string -> null', () => assert.equal(addressFromProfile(''), null))
  it('object with street -> maps fields', () => {
    const a = addressFromProfile({ street: '14 Main', city: 'Goa', state: 'GA', pincode: '403001' })
    assert.equal(a.line1, '14 Main')
    assert.equal(a.city, 'Goa')
  })
  it('object without street -> null', () =>
    assert.equal(addressFromProfile({ city: 'Goa' }), null))
})

// ── isBackendMissing ─────────────────────────────────────────────────────────
describe('isBackendMissing', () => {
  it('PGRST202 -> true', () => assert.equal(isBackendMissing({ code: 'PGRST202' }), true))
  it('PGRST205 -> true', () => assert.equal(isBackendMissing({ code: 'PGRST205' }), true))
  it('42P01 -> true', () => assert.equal(isBackendMissing({ code: '42P01' }), true))
  it('schema cache message -> true', () =>
    assert.equal(isBackendMissing({ message: 'Could not find the function promo_validate' }), true))
  it('ordinary error -> false', () =>
    assert.equal(isBackendMissing({ code: '23505', message: 'unique violation' }), false))
  it('null -> false', () => assert.equal(isBackendMissing(null), false))
})
