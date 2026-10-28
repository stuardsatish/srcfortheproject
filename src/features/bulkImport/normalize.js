// Cell-value normalisation for the bulk importer. Pure functions, no I/O (unit-tested: __tests__/normalize.test.mjs).
// Every parser returns { ok: true, value } | { ok: false } (blank input is `{ ok: true, value: null }` — "required" is the validator's call),
// so a bad value is REPORTED, never silently turned into 0 (the legacy CSV importer did exactly that).
//
// Rule 6 of BULK_UPLOAD_TEMPLATE_GUIDE: whitespace is trimmed; NBSP (this repo is full of them — P-7) becomes a space; zero-width
// characters are removed; numbers accept 500 / 500.00 / ₹500 / 1,500.

// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH = /[‍⁠﻿]/g
const NBSP_LIKE = /[   ]/g

/** Excel hands back numbers for numeric cells and strings for text; everything becomes a string here. */
const asString = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v))

/** One-line text: no zero-width characters, NBSP -> space, whitespace runs collapsed, trimmed. */
export function cleanLine(v) {
  return asString(v).replace(ZERO_WIDTH, '').replace(NBSP_LIKE, ' ').replace(/\s+/g, ' ').trim()
}

/** Multi-line text (descriptions): same clean-up but newlines are kept (CRLF -> LF, runs of blank lines capped at one). */
export function cleanText(v) {
  return asString(v).replace(ZERO_WIDTH, '').replace(NBSP_LIKE, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const isBlank = (v) => cleanLine(v) === ''

/** 500 | "500" | "500.00" | "₹500" | "Rs. 1,500" | "1,500.5" -> number. Excel error strings and text are rejected. */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, value: v } : { ok: false }
  if (typeof v === 'boolean') return { ok: false }
  const s = cleanLine(v)
  if (s === '') return { ok: true, value: null }
  const stripped = s.replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/\s+/g, '')
  if (!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(stripped) && !/^-?\.\d+$/.test(stripped)) return { ok: false }
  const n = Number(stripped.replace(/,/g, ''))
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false }
}

/** Whole number (5, "5", 5.0, "5.00"); 5.5 is rejected. */
export function parseInteger(v) {
  const n = parseNumber(v)
  if (!n.ok) return n
  if (n.value === null) return n
  return Number.isInteger(n.value) ? n : { ok: false }
}

/** YES/NO style flag. Blank -> null (the caller decides the default). */
export function parseYesNo(v) {
  if (typeof v === 'boolean') return { ok: true, value: v }
  const s = cleanLine(v).toLowerCase()
  if (s === '') return { ok: true, value: null }
  if (['yes', 'y', 'true', '1', 'on'].includes(s)) return { ok: true, value: true }
  if (['no', 'n', 'false', '0', 'off'].includes(s)) return { ok: true, value: false }
  return { ok: false }
}

/** Real Excel date (the reader returns 'YYYY-MM-DD') or text YYYY-MM-DD / DD-MM-YYYY / DD/MM/YYYY -> 'YYYY-MM-DD'. */
export function parseDate(v) {
  const s = cleanLine(v)
  if (s === '') return { ok: true, value: null }
  let y; let m; let d
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s)
  if (match) { y = +match[1]; m = +match[2]; d = +match[3] }
  else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s))) { d = +match[1]; m = +match[2]; y = +match[3] }
  else return { ok: false }
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return { ok: false }
  return { ok: true, value: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

/** 'a|b| c ||d' -> ['a','b','c','d'] (the ONLY list separator is |; it cannot occur in a Windows file name). */
export function splitList(v) {
  return cleanLine(v).split('|').map((x) => x.trim()).filter(Boolean)
}

/**
 * 'Color=Pink|Size=M' -> { ok, value: [['Color','Pink'],['Size','M']] }. A segment without '=' or with an empty side is invalid.
 * Returned as ordered pairs (never as an object keyed by user text, so '__proto__' etc. cannot do harm).
 */
export function parseAttributePairs(v) {
  const parts = splitList(v)
  const pairs = []
  for (const part of parts) {
    const i = part.indexOf('=')
    const k = i > 0 ? part.slice(0, i).trim() : ''
    const val = i > 0 ? part.slice(i + 1).trim() : ''
    if (!k || !val) return { ok: false, bad: part }
    pairs.push([k, val])
  }
  return { ok: true, value: pairs }
}

/** Stable case-insensitive key (ids, SKUs, image names, variant names). */
export const keyOf = (v) => cleanLine(v).toLowerCase()

/** Import ID rule: A–Z a–z 0–9 . _ -  up to 64 chars, and never the `_var_` that the cart code splits on. */
export const isValidImportId = (s) => /^[A-Za-z0-9._-]{1,64}$/.test(s) && !/_var_/i.test(s)

/** File names the importer accepts for images (no path, no odd characters: they become storage object names). */
export const isValidImageFileName = (s) => /^[A-Za-z0-9][A-Za-z0-9._ ()-]{0,99}$/.test(s) && !/\.\./.test(s)

export const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'gif'])
export const extensionOf = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(name)); return m ? m[1].toLowerCase() : '' }
export const baseNameOf = (path) => String(path).replace(/\\/g, '/').split('/').pop()
export const isUrl = (s) => /^https?:\/\//i.test(s)

/** Spreadsheet-formula neutraliser for anything echoed into a CSV / xlsx REPORT: a leading = + - @ (or tab / CR) gets an apostrophe. */
export const escapeForSpreadsheet = (v) => {
  const s = asString(v)
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}