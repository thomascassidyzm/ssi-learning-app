/**
 * Synthetic italic is a correctness surface, not a styling one.
 *
 * A script with no italic form does not fall back to upright when CSS asks for
 * italic — the browser shears the glyphs and renders a distortion, silently.
 * Nothing throws, no snapshot moves, and the learner reads letterforms that
 * their script does not have.
 *
 * These tests pin the halves that have to agree:
 *   - the predicate answers upright for a non-italic script and italic for
 *     Latin/Greek/Cyrillic, through 3-letter, 2-letter and region-tagged forms;
 *   - the `:lang()` block in design-tokens.css lists exactly what
 *     italicScripts.ts says, and carries the `!important` that makes it bite;
 *   - every language in the estate is classified, so a new course in an
 *     unclassified script fails here rather than shipping sheared text.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  LANGUAGE_SCRIPT,
  NON_ITALIC_LANG_TAGS,
  ITALIC_CAPABLE_SCRIPTS,
  hasItalicForm,
} from './italicScripts'

const here = dirname(fileURLToPath(import.meta.url))
const tokens = readFileSync(resolve(here, './design-tokens.css'), 'utf8')

/**
 * Every language on either side of a live course, plus every interface locale.
 * Read from the live DB on 2026-09-04 (149 courses) and from src/locales/.
 * `zzz` is the scaffold placeholder. Refresh this list when courses are added.
 */
const ESTATE_LANGUAGES = [
  'afr', 'ara', 'aze', 'ben', 'bre', 'bul', 'cat', 'ceb', 'ces', 'cor', 'cym',
  'dan', 'deu', 'ell', 'eng', 'est', 'eus', 'fas', 'fin', 'fra', 'fur', 'gla',
  'gle', 'glg', 'guj', 'hak', 'heb', 'hin', 'hrv', 'hun', 'hye', 'ind', 'isl',
  'ita', 'jpn', 'kan', 'kor', 'lav', 'lit', 'lmo', 'mar', 'mkd', 'mlt', 'nan',
  'nap', 'nep', 'nld', 'nor', 'pan', 'pdc', 'pol', 'por', 'rgn', 'roh', 'ron',
  'rus', 'scn', 'sin', 'sme', 'spa', 'srp', 'swa', 'swe', 'tam', 'tel', 'tha',
  'tur', 'ukr', 'urd', 'vec', 'yid', 'yor', 'yue', 'zho', 'zzz',
]

/** The languages named in the font-style block of design-tokens.css. */
function cssLangTags(): string[] {
  const declarations = tokens.replace(/\/\*[\s\S]*?\*\//g, '')
  const block = declarations.match(/((?::lang\([a-z-]+\)[,\s]*)+)\{[^}]*font-style:\s*normal[^}]*\}/)
  expect(block, 'design-tokens.css must carry a :lang() block forcing font-style: normal').toBeTruthy()
  return [...block![1].matchAll(/:lang\(([a-z-]+)\)/g)].map(m => m[1]).sort()
}

describe('hasItalicForm', () => {
  it('is false for scripts with no italic, in every code form', () => {
    expect(hasItalicForm('tam')).toBe(false)
    expect(hasItalicForm('ta')).toBe(false)
    expect(hasItalicForm('ta-IN')).toBe(false)
    expect(hasItalicForm('TA')).toBe(false)
    expect(hasItalicForm('zho')).toBe(false)
    expect(hasItalicForm('cmn')).toBe(false)
    expect(hasItalicForm('kor')).toBe(false)
    expect(hasItalicForm('ara')).toBe(false)
    expect(hasItalicForm('hin')).toBe(false)
    expect(hasItalicForm('tha')).toBe(false)
  })

  it('is true for Latin, Greek and Cyrillic, which have drawn italics', () => {
    expect(hasItalicForm('eng')).toBe(true)
    expect(hasItalicForm('spa')).toBe(true)
    expect(hasItalicForm('cym_n')).toBe(true)
    expect(hasItalicForm('ell')).toBe(true)
    expect(hasItalicForm('rus')).toBe(true)
  })

  it('allows italic for an unrecognised or absent language — the CSS default', () => {
    expect(hasItalicForm(null)).toBe(true)
    expect(hasItalicForm(undefined)).toBe(true)
    expect(hasItalicForm('')).toBe(true)
    expect(hasItalicForm('qqq')).toBe(true)
  })
})

describe('the CSS rule and the table are the same rule', () => {
  it('lists exactly the non-italic language tags', () => {
    expect(cssLangTags()).toEqual([...NON_ITALIC_LANG_TAGS].sort())
  })

  it('carries !important, without which a scoped component rule outranks it', () => {
    const block = tokens.match(/:lang\(ta\)[\s\S]{0,600}?\{([^}]*)\}/)
    expect(block).toBeTruthy()
    expect(block![1]).toMatch(/font-style:\s*normal\s*!important/)
  })
})

describe('the estate is fully classified', () => {
  it('maps every language on a live course or interface locale to a script', () => {
    const unclassified = ESTATE_LANGUAGES.filter(l => !LANGUAGE_SCRIPT[l])
    expect(unclassified, 'add these to LANGUAGE_SCRIPT with their script').toEqual([])
  })

  it('classifies Tamil, Han and Hangul as scripts without italic', () => {
    for (const lang of ['tam', 'zho', 'kor', 'jpn', 'ara', 'heb', 'hin', 'tha']) {
      expect((ITALIC_CAPABLE_SCRIPTS as readonly string[]))
        .not.toContain(LANGUAGE_SCRIPT[lang])
    }
  })
})
