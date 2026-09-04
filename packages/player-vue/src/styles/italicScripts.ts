/**
 * Which scripts have an italic, and which languages are written in them.
 *
 * WHY THIS EXISTS
 * ---------------
 * Italic is a Latin invention. Tamil, Han, Hangul, Devanagari, Arabic, Thai,
 * Hebrew and the rest have no italic form at all — so when CSS asks for one,
 * the browser SYNTHESISES it by shearing the upright glyphs sideways. It is
 * not a typeface, it is a transform, and on a script with vertical stems and
 * loop-shaped letters it reads as a rendering fault. Tom spotted it on
 * `zho_for_tam` (2026-09-04): Chinese upright on top of the card, Tamil
 * visibly slanted underneath.
 *
 * Latin, Greek and Cyrillic are the exception: they have real italics, and the
 * fonts this app loads (DM Sans, Noto Sans) ship them. Everything else gets
 * `font-style: normal`, enforced by the `:lang()` block in design-tokens.css.
 *
 * DERIVED, NOT ENUMERATED
 * -----------------------
 * The decision comes from the SCRIPT of the language on the line, never from a
 * list of course codes and never from a list of offending screens. Course codes
 * lie about their language (`spa_mx_for_eng` has `target_lang = 'spa'`), and a
 * per-screen list rots the moment someone adds a screen. `LANGUAGE_SCRIPT`
 * below is the one table; the CSS selector, this module's predicate and the
 * test are all read off it.
 *
 * The estate's language set is pinned by italicScripts.test.ts, so a new course
 * in an unclassified language fails a test rather than shipping sheared text.
 */

/** The scripts with a real, drawn italic — everything else is synthesised. */
export const ITALIC_CAPABLE_SCRIPTS = ['Latin', 'Greek', 'Cyrillic'] as const
export type Script = (typeof ITALIC_CAPABLE_SCRIPTS)[number] | 'Arabic' | 'Armenian'
  | 'Bengali' | 'Devanagari' | 'Gujarati' | 'Gurmukhi' | 'Han' | 'Hangul'
  | 'Hebrew' | 'Japanese' | 'Kannada' | 'Sinhala' | 'Tamil' | 'Telugu' | 'Thai'

/**
 * Every language the estate holds — both sides of all 149 courses (live DB,
 * 2026-09-04) and all 22 interface locales — mapped to the script it is
 * written in. Value is the script, not "does it italicise": the question the
 * table answers stays true even if the italic-capable set changes.
 *
 * `zzz` is the placeholder language on scaffold courses; Latin keeps it inert.
 */
export const LANGUAGE_SCRIPT: Record<string, Script> = {
  // Latin
  afr: 'Latin', aze: 'Latin', bre: 'Latin', cat: 'Latin', ceb: 'Latin',
  ces: 'Latin', cor: 'Latin', cym: 'Latin', dan: 'Latin', deu: 'Latin',
  eng: 'Latin', est: 'Latin', eus: 'Latin', fin: 'Latin', fra: 'Latin',
  fur: 'Latin', gla: 'Latin', gle: 'Latin', glg: 'Latin', hrv: 'Latin',
  hun: 'Latin', ind: 'Latin', isl: 'Latin', ita: 'Latin', lav: 'Latin',
  lit: 'Latin', lmo: 'Latin', mlt: 'Latin', nap: 'Latin', nld: 'Latin',
  nor: 'Latin', pdc: 'Latin', pol: 'Latin', por: 'Latin', rgn: 'Latin',
  roh: 'Latin', ron: 'Latin', scn: 'Latin', sme: 'Latin', spa: 'Latin',
  swa: 'Latin', swe: 'Latin', tur: 'Latin', vec: 'Latin', yor: 'Latin',
  zzz: 'Latin',
  // Cyrillic and Greek — real italics, left alone
  bul: 'Cyrillic', mkd: 'Cyrillic', rus: 'Cyrillic', srp: 'Cyrillic',
  ukr: 'Cyrillic', ell: 'Greek',
  // No italic form exists
  ara: 'Arabic', fas: 'Arabic', urd: 'Arabic',
  heb: 'Hebrew', yid: 'Hebrew',
  hin: 'Devanagari', mar: 'Devanagari', nep: 'Devanagari',
  ben: 'Bengali', guj: 'Gujarati', pan: 'Gurmukhi', kan: 'Kannada',
  sin: 'Sinhala', tam: 'Tamil', tel: 'Telugu', tha: 'Thai',
  hye: 'Armenian', jpn: 'Japanese', kor: 'Hangul',
  zho: 'Han', yue: 'Han', hak: 'Han', nan: 'Han',
}

/**
 * ISO 639-1 aliases, because `<html lang>` and the `:lang` bindings carry
 * whichever code the caller had. `syncDocumentLang` publishes the 2-letter form
 * where one exists (composables/useI18n.ts), course rows carry the 3-letter
 * form — `:lang()` has to match both.
 */
const ALIAS: Record<string, string> = {
  ara: 'ar', ben: 'bn', fas: 'fa', guj: 'gu', heb: 'he', hin: 'hi',
  hye: 'hy', jpn: 'ja', kan: 'kn', kor: 'ko', mar: 'mr', nep: 'ne',
  pan: 'pa', sin: 'si', tam: 'ta', tel: 'te', tha: 'th', urd: 'ur',
  yid: 'yi', zho: 'zh',
}

/** `cmn` is the i18n alias for the zho locale file; cym_n/cym_s are dialects. */
const LOCALE_ALIASES: Record<string, string> = { cmn: 'zho', cym_n: 'cym', cym_s: 'cym' }

/** Every `lang` attribute value that must be forced upright. Sorted, so the
 *  CSS selector and this list can be compared literally. */
export const NON_ITALIC_LANG_TAGS: string[] = Object.entries(LANGUAGE_SCRIPT)
  .filter(([, script]) => !(ITALIC_CAPABLE_SCRIPTS as readonly string[]).includes(script))
  .flatMap(([code]) => (ALIAS[code] ? [code, ALIAS[code]] : [code]))
  .concat(Object.entries(LOCALE_ALIASES)
    .filter(([, target]) => !(ITALIC_CAPABLE_SCRIPTS as readonly string[])
      .includes(LANGUAGE_SCRIPT[target]))
    .map(([alias]) => alias))
  .sort()

/**
 * Does text in this language have a real italic to render?
 *
 * Accepts anything a `lang` attribute might hold — `tam`, `ta`, `ta-IN`,
 * `cym_n` — and is case-insensitive, like `:lang()` itself. An unrecognised
 * language returns `true` (italic allowed): the CSS default, so an unknown code
 * behaves exactly as it did before this rule existed. The test is what stops an
 * estate language going unclassified.
 */
export function hasItalicForm(lang: string | null | undefined): boolean {
  if (!lang) return true
  const primary = lang.toLowerCase().split(/[-_]/)[0]
  return !NON_ITALIC_LANG_TAGS.includes(primary)
}
