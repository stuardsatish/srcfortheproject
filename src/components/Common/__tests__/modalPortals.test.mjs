// node --test src/components/Common/__tests__/modalPortals.test.mjs   (npm run test:unit)
// Regression (browser test round, 2026-10-18): the pages animate their cards / drawers with GSAP, which leaves `transform: matrix(1,0,0,1,0,0)`
// on them, and a transformed ancestor becomes the containing block of `position: fixed`. A dialog rendered IN PLACE inside such an
// ancestor is boxed into it (the bulk uploader was squeezed into a 185 px card; every ModalShell window opened from the order / request
// drawers was boxed into the 480 px drawer). Source-level guard: the two dialog components render into <body> through a portal.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel) => readFileSync(join(srcRoot, rel), 'utf8')

describe('dialogs render into <body>', () => {
  for (const file of ['components/Common/ModalShell.jsx', 'features/bulkImport/BulkProductImport.jsx']) {
    it(`${file} uses createPortal(..., document.body)`, () => {
      const text = read(file)
      assert.match(text, /import \{ createPortal \} from "react-dom"/)
      assert.match(text, /return createPortal\(\s*<div role="dialog"/)
      assert.match(text, /<\/div>,\s*document\.body,?\s*\)/)
    })
  }
})