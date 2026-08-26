/**
 * The body font is a correctness surface, not a styling one.
 *
 * Course text (known + target, hero line and tiles) sets no font-family of its
 * own — it inherits from `body`. So if the font in force lacks a course's
 * letters, nothing throws and no test goes red: the browser silently
 * substitutes an OS font per-character and the learner reads one word in two
 * typefaces.
 *
 * The fix is language-scoped. DM Sans stays the default everywhere — it is the
 * brand — and text in a language DM Sans cannot spell (Greek, Cyrillic,
 * Devanagari, Yoruba, pinyin tone vowels, the dot-below Latin of scn/rgn)
 * declares itself with a `lang` attribute and renders WHOLLY in Noto Sans.
 *
 * These tests pin the halves that have to agree:
 *   - the rule resolves a coverage language to the coverage font, and a
 *     Latin-only language to the brand font;
 *   - the CSS `:lang()` selector lists exactly what coverageLanguages.ts says;
 *   - both families are actually imported, and the default really is DM Sans.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  COVERAGE_LANGUAGES,
  COVERAGE_LANG_TAGS,
  needsCoverageFont,
  fontTokenForLang,
} from './coverageLanguages'

const here = dirname(fileURLToPath(import.meta.url))
const tokens = readFileSync(resolve(here, './design-tokens.css'), 'utf8')
const styles = readFileSync(resolve(here, '../style.css'), 'utf8')
/* The font stylesheets moved off the render-blocking path on 2026-08-25 — the
 * families are now requested from JS. See utils/loadWebFonts.ts. */
const fontLoader = readFileSync(resolve(here, '../utils/loadWebFonts.ts'), 'utf8')
const indexHtml = readFileSync(resolve(here, '../../index.html'), 'utf8')
/* 2026-08-26: the faces are self-hosted, so the families are now DECLARED in a
 * generated stylesheet rather than named in a Google query string. Reading the
 * real @font-face blocks is a stronger check than reading a URL — it can tell
 * whether the file a token needs actually shipped. See scripts/vendor-fonts.mjs. */
const fontsCss = readFileSync(resolve(here, '../../public/fonts/fonts.css'), 'utf8')

/**
 * Families verified to cover every letter of estate course text in the
 * languages they are used for. Measured 2026-08-18 in Chromium against the
 * woff2 subsets Google actually serves — not from a specimen page.
 */
const COVERAGE_VERIFIED = ['Noto Sans', 'Inter', 'Source Sans 3', 'Arimo']

/** Measured short on the coverage languages. Never the coverage font. */
const KNOWN_SHORT = ['DM Sans', 'Jost', 'Outfit', 'Poppins', 'Plus Jakarta Sans', 'Figtree', 'Roboto']

function primaryFamily(tokenName: string): string {
  const m = tokens.match(new RegExp(`--${tokenName}:\\s*([^;]+);`))
  expect(m, `${tokenName} must be defined in design-tokens.css`).toBeTruthy()
  const first = m![1].split(',')[0].trim()
  return first.replace(/^['"]|['"]$/g, '')
}

/** The languages named in the `:lang(...)` block of design-tokens.css. */
function cssLangTags(): string[] {
  const declarations = tokens.replace(/\/\*[\s\S]*?\*\//g, '')
  const block = declarations.match(/((?::lang\([a-z-]+\)[,\s]*)+)\{[^}]*--font-coverage[^}]*\}/)
  expect(block, 'design-tokens.css must carry a :lang() block applying --font-coverage').toBeTruthy()
  return [...block![1].matchAll(/:lang\(([a-z-]+)\)/g)].map(m => m[1]).sort()
}

describe('glyph coverage — the rule', () => {
  it('a coverage language resolves to the coverage font', () => {
    for (const lang of ['ell', 'rus', 'ukr', 'bul', 'mkd', 'hin', 'yor', 'zho', 'scn']) {
      expect(needsCoverageFont(lang), `${lang} must take the coverage font`).toBe(true)
      expect(fontTokenForLang(lang)).toBe('--font-coverage')
    }
  })

  it('a Latin-only language resolves to the brand font', () => {
    // Measured: DM Sans renders every letter these courses use.
    for (const lang of ['eng', 'spa', 'fra', 'cym', 'deu', 'ita', 'pol', 'nld', 'gle', 'tur']) {
      expect(needsCoverageFont(lang), `${lang} must stay on DM Sans`).toBe(false)
      expect(fontTokenForLang(lang)).toBe('--font-body')
    }
  })

  it('the rule reads any shape a lang attribute comes in', () => {
    expect(needsCoverageFont('el')).toBe(true)        // 639-1 alias
    expect(needsCoverageFont('el-GR')).toBe(true)     // region subtag
    expect(needsCoverageFont('EL')).toBe(true)        // :lang() is case-insensitive
    expect(needsCoverageFont('cmn')).toBe(true)       // locale alias for zho
    expect(needsCoverageFont('cym_n')).toBe(false)    // dialect code, Welsh is fine
    expect(needsCoverageFont('')).toBe(false)
    expect(needsCoverageFont(null)).toBe(false)
    expect(needsCoverageFont(undefined)).toBe(false)
  })

  it('the CSS selector and the language list say the same thing', () => {
    // Two halves of one rule: the TS list is what code asks, the CSS list is
    // what the browser applies. If they drift, a language silently loses its
    // font with nothing going red — which is the exact failure mode this
    // whole fix exists to close.
    expect(cssLangTags()).toEqual([...COVERAGE_LANG_TAGS].sort())
  })
})

describe('glyph coverage — the fonts behind it', () => {
  it('the default body font is the brand font, not the coverage font', () => {
    expect(primaryFamily('font-brand')).toBe('DM Sans')
    expect(tokens).toMatch(/--font-body:\s*var\(--font-brand\)/)
  })

  it('--font-coverage names a family whose estate coverage was measured', () => {
    expect(COVERAGE_VERIFIED).toContain(primaryFamily('font-coverage'))
    expect(KNOWN_SHORT).not.toContain(primaryFamily('font-coverage'))
  })

  it('both families are actually shipped, not just named', () => {
    for (const token of ['font-brand', 'font-coverage']) {
      const family = primaryFamily(token)
      expect(fontsCss, `${family} must be declared`).toContain(`font-family: '${family}';`)
    }
  })

  /**
   * The reason the fonts were left on Google for so long: it serves each family
   * split by unicode-range, so a learner downloads only the subsets their own
   * language uses. Self-hosting (2026-08-26) kept those splits verbatim — this
   * is the test that says so. A vendoring pass that collapsed every subset into
   * one file would still render correctly and would still pass every test
   * above, while quietly making a Welsh learner download Devanagari.
   */
  it('the per-language subsetting survived self-hosting', () => {
    const faces = fontsCss.match(/@font-face\s*\{[^}]*\}/g) ?? []
    expect(faces.length, 'fonts.css must declare the subset faces').toBeGreaterThan(30)
    for (const face of faces) {
      expect(face, 'every face must be unicode-range gated').toMatch(/unicode-range:\s*U\+/)
      expect(face, 'every face must load a local file').toMatch(/url\('\/fonts\/(core|ext)\//)
    }
    // The coverage font has to carry the scripts DM Sans cannot spell, each in
    // its own subset file — that is what makes the :lang() rule mean anything.
    for (const subset of ['devanagari', 'greek', 'cyrillic']) {
      expect(fontsCss, `Noto Sans must ship a ${subset} subset`).toContain(
        `/fonts/ext/noto-sans-${subset}-`,
      )
    }
  })

  /**
   * The whole point of A-265: once installed, no third party is in the font
   * path at all. A font file served from a host we do not control can hang on a
   * weak signal exactly as the stylesheet did.
   */
  it('no font is fetched from a third party', () => {
    expect(fontsCss, 'fonts.css must not reference a remote font host').not.toMatch(
      /https?:\/\//,
    )
    expect(fontLoader, 'the loader must request our own stylesheet').toContain(
      `'/fonts/fonts.css'`,
    )
  })

  /**
   * 2026-08-25. The font stylesheets used to be a remote @import at the top of
   * style.css and a <link> in index.html's head. Both are RENDER-BLOCKING, and
   * on a weak signal a blocking cross-origin stylesheet neither loads nor
   * fails — it hangs, and the app never paints at all. Fonts are decoration;
   * they may never gate first paint. See utils/loadWebFonts.ts.
   */
  it('no font stylesheet sits on the render-blocking path', () => {
    expect(styles, 'style.css must not @import a remote stylesheet').not.toMatch(
      /@import\s+url\(\s*['"]?https?:/i,
    )
    expect(indexHtml, 'index.html must not <link rel=stylesheet> a font host').not.toMatch(
      /<link[^>]+rel=["']?stylesheet["']?[^>]*fonts\.googleapis\.com/i,
    )
  })

  it('the loader cannot apply a font before it has arrived', () => {
    // media="print" is what makes the link non-render-blocking; the load
    // listener is what makes the font eventually apply. Both or neither.
    expect(fontLoader).toContain(`link.media = 'print'`)
    expect(fontLoader).toMatch(/addEventListener\(\s*['"]load['"]/)
  })

  it('every coverage language carries the evidence for why it is on the list', () => {
    for (const [code, meta] of Object.entries(COVERAGE_LANGUAGES)) {
      expect(meta.missing, `${code} must record what DM Sans could not render`).toBeTruthy()
      expect(meta.chars, `${code} must record how much estate text that is`).toBeGreaterThan(0)
    }
  })
})
