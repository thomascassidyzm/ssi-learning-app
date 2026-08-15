/**
 * The body font is a correctness surface, not a styling one.
 *
 * Course text (known + target, hero line and tiles) sets no font-family of its
 * own — it inherits `--font-body` from `body`. So if `--font-body` names a font
 * that lacks a course's letters, nothing throws and no test goes red: the
 * browser silently substitutes an OS font per-character and the learner reads
 * one word in two typefaces.
 *
 * That is exactly what shipped until 2026-08-15. DM Sans carries 360
 * codepoints and none of Greek, Cyrillic, the Yoruba dot-belows (ẹ ọ ṣ Ṣ), the
 * n-grave (ǹ) or the Mandarin pinyin tone vowels (ǎ ǐ ǒ ǔ ǚ ǜ) — breaking
 * ell/rus/ukr/bul/mkd/hye/yor and the released zho_for_eng.
 *
 * These tests pin the two halves that have to agree: the token names a font
 * whose coverage was actually measured against estate course text, and the
 * stylesheet actually imports that font.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const tokens = readFileSync(resolve(here, './design-tokens.css'), 'utf8')
const styles = readFileSync(resolve(here, '../style.css'), 'utf8')

/**
 * Families verified (2026-08-15) to cover every letter in course_seeds +
 * course_legos + course_practice_phrases across all 145 courses, by parsing
 * the cmap of the woff2 subsets Google actually serves. Add to this list ONLY
 * after re-running that measurement — not on the strength of a specimen page.
 */
const COVERAGE_VERIFIED = ['Noto Sans', 'Inter', 'Source Sans 3', 'Arimo']

/** Measured short on estate course text. Never the primary body font. */
const KNOWN_SHORT = ['DM Sans', 'Jost', 'Outfit', 'Poppins', 'Plus Jakarta Sans', 'Figtree', 'Roboto']

function primaryFamily(tokenName: string): string {
  const m = tokens.match(new RegExp(`--${tokenName}:\\s*([^;]+);`))
  expect(m, `${tokenName} must be defined in design-tokens.css`).toBeTruthy()
  const first = m![1].split(',')[0].trim()
  return first.replace(/^['"]|['"]$/g, '')
}

describe('font glyph coverage', () => {
  it('--font-body names a family whose estate coverage was measured', () => {
    expect(COVERAGE_VERIFIED).toContain(primaryFamily('font-body'))
  })

  it('--font-body is not one of the families measured short on course text', () => {
    expect(KNOWN_SHORT).not.toContain(primaryFamily('font-body'))
  })

  it('the body font is actually imported, not just named', () => {
    const family = primaryFamily('font-body')
    // Google Fonts spells spaces as '+' in the css2 family param
    expect(styles).toContain(`family=${family.replace(/ /g, '+')}:`)
  })

  it('--font-display falls back to the covered body font, not a narrow one', () => {
    const display = tokens.match(/--font-display:\s*([^;]+);/)
    expect(display).toBeTruthy()
    // Noto Sans JP leads for CJK but is itself missing Ṣ/ṣ, so whatever sits
    // behind it has to be the covered family.
    const fallbacks = display![1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    expect(fallbacks.some(f => COVERAGE_VERIFIED.includes(f))).toBe(true)
    for (const short of KNOWN_SHORT) expect(fallbacks).not.toContain(short)
  })

  it('no stylesheet still asks for a font we removed for lacking coverage', () => {
    // comments are allowed to explain the history; declarations are not
    const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(declarations).not.toContain('DM+Sans')
  })
})
