/**
 * Which languages need the glyph-coverage font, and why.
 *
 * DM Sans is the brand face and the default everywhere. It carries 360
 * codepoints — enough for most of the estate — but it cannot spell Greek,
 * Cyrillic, Devanagari, the Yoruba dot-belows (ẹ ọ ṣ Ṣ), the n-grave (ǹ), the
 * Mandarin pinyin tone vowels (ǎ ǐ ǒ ǔ ǚ) or the dot-below Latin of Sicilian
 * and Romagnol. A font without a letter doesn't throw: the browser substitutes
 * an OS font for that ONE character, so a word renders in two typefaces.
 *
 * The fix is language-scoped, not character-scoped: text in a language on this
 * list renders WHOLLY in --font-coverage (Noto Sans), so a run of text is
 * always typographically consistent. Everything else keeps DM Sans.
 *
 * MEASURED, 2026-08-18, not assumed:
 *   - per-language codepoint census of known_text / target_text /
 *     target_text_roman across all 146 courses in the live DB, attributed to
 *     the side of the course each string came from;
 *   - coverage measured in a real browser (Chromium 151) against the woff2
 *     subsets Google actually serves, by canvas width-divergence + document.
 *     fonts.check() per codepoint.
 * A codepoint counts as a language's own only if it is in that language's
 * script and occurs ≥10 times — otherwise a single stray Cyrillic 'а' in a
 * Turkish row would drag Turkish off the brand font.
 *
 * To change this list: re-run that measurement. Do not add a language on the
 * strength of a specimen page.
 */

/**
 * ISO 639-3 codes as the app stores them (courses.target_lang / known_lang,
 * and the i18n locale codes), each with the 639-1 alias that a standards-
 * conformant `lang` attribute might carry instead.
 *
 * The comment on each line is what DM Sans could not render, and how much of
 * it the estate contains.
 */
export const COVERAGE_LANGUAGES: Record<string, { alias?: string; missing: string; chars: number }> = {
  hin: { alias: 'hi', missing: 'all Devanagari (58 codepoints)', chars: 206590 },
  mar: { alias: 'mr', missing: 'all Devanagari (57 codepoints)', chars: 106066 },
  nep: { alias: 'ne', missing: 'all Devanagari (50 codepoints)', chars: 58855 },
  ell: { alias: 'el', missing: 'all Greek (44 codepoints)', chars: 44555 },
  ukr: { alias: 'uk', missing: 'all Cyrillic (44 codepoints)', chars: 44467 },
  bul: { alias: 'bg', missing: 'all Cyrillic (43 codepoints)', chars: 41133 },
  rus: { alias: 'ru', missing: 'all Cyrillic (47 codepoints)', chars: 37204 },
  mkd: { alias: 'mk', missing: 'all Cyrillic (40 codepoints)', chars: 26830 },
  yor: { alias: 'yo', missing: 'ǹ Ṣ ṣ Ẹ ẹ Ọ', chars: 3115 },
  ben: { alias: 'bn', missing: '। danda — see NO_COVERED_FONT, the letters need Noto Sans Bengali', chars: 1405 },
  zho: { alias: 'zh', missing: 'pinyin tone vowels ǎ ǐ ǔ ǚ (Han: see NO_COVERED_FONT)', chars: 1220 },
  pan: { alias: 'pa', missing: '। danda — see NO_COVERED_FONT, the letters need Noto Sans Gurmukhi', chars: 548 },
  scn: { missing: 'ḍ', chars: 508 },
  rgn: { missing: 'ṡ ẓ ẽ', chars: 86 },
  sme: { alias: 'se', missing: 'ŧ — a real Northern Sámi letter, in 6 rows of sme_for_eng', chars: 6 },
}

/**
 * Deliberately NOT on the list, and why — so the next person doesn't "fix" them.
 *
 * cym  — 26 rows of the Welsh estate carry U+02BC MODIFIER LETTER APOSTROPHE
 *        where the other hundreds of thousands use U+2019, which DM Sans has.
 *        26 anomalous rows do not justify moving a flagship course off the
 *        brand font: the fix belongs in the data, not the font.
 * tur, est, eus, swa — appear only through Cyrillic homoglyphs (a Cyrillic 'а'
 *        typed for a Latin 'a'), 1–3 occurrences each. Also a data fix.
 * eng  — Arabic, Devanagari and Telugu text has leaked into the English side of
 *        a few courses. Tagging English for coverage would hide that, not fix it.
 * spa, dan, bre — a stray U+2192 → in one row each.
 */

/**
 * Codepoints NO font this app loads can render — the honest residue after the
 * language rule. Recorded here rather than in a commit message so it stays
 * findable: U+0331 COMBINING MACRON BELOW and U+2192 RIGHTWARDS ARROW, neither
 * a letter of any course's alphabet.
 */
export const UNCOVERED_CODEPOINTS = ['U+0331', 'U+2192'] as const

/**
 * Locale/dialect codes that resolve to a listed language. `cmn` is the i18n
 * alias for the zho locale file; cym_n/cym_s are Welsh dialects (Welsh is NOT
 * on the coverage list — they are here only so the mapping is total).
 */
const ALIASES: Record<string, string> = { cmn: 'zho' }

/**
 * Scripts in the estate that NEITHER DM Sans NOR any font this app loads can
 * render, so they still fall back to whatever the OS supplies. Listing a
 * language here is not a fix — it is the honest record of the hole.
 *
 * Adding coverage means importing the matching Noto script family (Noto Sans
 * Arabic, Bengali, Gurmukhi, Devanagari is already inside Noto Sans, etc.),
 * which is a per-family webfont cost and a separate decision.
 */
export const NO_COVERED_FONT: Record<string, string> = {
  ara: 'Arabic (39 codepoints)',
  fas: 'Arabic (36)',
  urd: 'Arabic (39)',
  kor: 'Hangul (453)',
  hye: 'Armenian (51)',
  ben: 'Bengali (53)',
  pan: 'Gurmukhi (52)',
  guj: 'Gujarati (51)',
  tam: 'Tamil (41)',
  tel: 'Telugu (52)',
  kan: 'Kannada (52)',
  sin: 'Sinhala (50)',
  tha: 'Thai (52)',
  zho: 'Han (149) — Noto Sans JP is loaded but carries Japanese glyph forms, wrong for a Chinese course',
  yue: 'Han (12)',
  nan: 'Han (6)',
  hak: 'Han (6)',
}

/** Every `lang` attribute value that must resolve to the coverage font. */
export const COVERAGE_LANG_TAGS: string[] = Object.entries(COVERAGE_LANGUAGES)
  .flatMap(([code, meta]) => (meta.alias ? [code, meta.alias] : [code]))
  .concat(Object.keys(ALIASES))
  .sort()

/**
 * Does text in this language need the coverage font?
 * Accepts anything a `lang` attribute might hold — `ell`, `el`, `el-GR`,
 * `cym_n` — and is case-insensitive, like `:lang()` itself.
 */
export function needsCoverageFont(lang: string | null | undefined): boolean {
  if (!lang) return false
  const primary = lang.toLowerCase().split(/[-_]/)[0]
  const resolved = ALIASES[primary] || primary
  return COVERAGE_LANG_TAGS.includes(primary) || COVERAGE_LANG_TAGS.includes(resolved)
}

/**
 * The font stack a run of text in this language will actually be rendered in.
 * The single place that answers "which font does language X get?" — the CSS
 * `:lang()` block in design-tokens.css is the same rule, and the test in
 * fontGlyphCoverage.test.ts holds the two to each other.
 */
export function fontTokenForLang(lang: string | null | undefined): '--font-coverage' | '--font-body' {
  return needsCoverageFont(lang) ? '--font-coverage' : '--font-body'
}
