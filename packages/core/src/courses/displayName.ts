/**
 * Course display names — the single source of truth for turning a raw course
 * code (`fra_for_eng`, `eng_for_hin`, `cym`) into a human label the way it
 * should appear anywhere user-facing ("French for English speakers").
 *
 * Codes stay the URL/query/deep-link value; only the LABEL is derived here.
 * When a course row carries its own `display_name`, prefer that (it's the
 * authored label) and fall back to this derivation.
 */

/**
 * ISO 639-3 language codes → English language name. Extend as courses land;
 * an unknown code falls back to a Title-cased version of the code itself so
 * nothing ever renders as a broken blank.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  spa: 'Spanish',
  fra: 'French',
  deu: 'German',
  ita: 'Italian',
  por: 'Portuguese',
  zho: 'Chinese',
  jpn: 'Japanese',
  ara: 'Arabic',
  kor: 'Korean',
  cym: 'Welsh',
  gle: 'Irish',
  glv: 'Manx',
  cor: 'Cornish',
  eus: 'Basque',
  cat: 'Catalan',
  hin: 'Hindi',
  tam: 'Tamil',
  nld: 'Dutch',
  dan: 'Danish',
  nor: 'Norwegian',
  ell: 'Greek',
  hrv: 'Croatian',
}

/**
 * Dialect/variant suffixes. A course code carries its variant on the language
 * part (`cym_s_for_eng`), and the variant is shown in brackets after the
 * language: `cym_s` → "Welsh (South)".
 *
 * These are the SAME words the schools/player UI already renders through
 * `useI18n`'s getLanguageName — that's why the Classes page reads
 * "Welsh (South)". Kept in step deliberately: two spellings of the same
 * language in one product is the bug this table exists to prevent.
 */
export const LANGUAGE_VARIANT_NAMES: Record<string, string> = {
  cym_n: 'North',
  cym_s: 'South',
  nob: 'Bokmål',
  nno: 'Nynorsk',
}

/** `cym_s` / `cym-s` / `CYM_S` → `cym_s`. */
function normaliseLangCode(code: string): string {
  return code.trim().toLowerCase().replace(/-/g, '_')
}

/**
 * Resolve a single language code — bare (`cym`) or dialect-variant (`cym_s`) —
 * to its display name, with a graceful Title-case fallback for codes we
 * haven't named yet.
 *
 *   `cym`   → "Welsh"
 *   `cym_s` → "Welsh (South)"
 *   `nob`   → "Norwegian (Bokmål)"
 */
export function languageName(code: string): string {
  const key = normaliseLangCode(code)
  if (LANGUAGE_NAMES[key]) return LANGUAGE_NAMES[key]

  // Variant code: name the base language, bracket the variant. `nob`/`nno`
  // are whole ISO codes rather than `base_variant`, so they carry their own
  // base explicitly.
  const variant = LANGUAGE_VARIANT_NAMES[key]
  if (variant) {
    const base = key === 'nob' || key === 'nno' ? 'nor' : key.slice(0, key.lastIndexOf('_'))
    return `${languageName(base)} (${variant})`
  }

  return key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * A language slot in a course code: a base ISO code, optionally carrying a
 * short dialect variant (`cym_s`). The variant is bounded to 1-3 chars so a
 * multi-word code like `cym_anthem_for_jpn` doesn't get mis-parsed as a
 * dialect of Welsh.
 */
const LANG_SLOT = '[a-z]{2,3}(?:_[a-z]{1,3})?'
const COURSE_CODE = new RegExp(`^(${LANG_SLOT})_for_(${LANG_SLOT})$`, 'i')
const BARE_LANG = new RegExp(`^${LANG_SLOT}$`, 'i')

/**
 * Split a `{target}_for_{known}` code into its two language slots, or null if
 * the code isn't in course shape.
 *
 * The `_for_` separator is matched non-greedily on the target side so that
 * `cym_s_for_eng` splits as `cym_s` / `eng` — the old `[a-z]{2,3}` target
 * pattern missed every dialect course entirely, which is how Insights came to
 * print the raw code "Cym_s_for_eng" (founder-reported, 2026-08-07).
 */
function splitCourseCode(raw: string): { target: string; known: string } | null {
  const match = raw.match(COURSE_CODE)
  if (!match) return null
  return { target: match[1], known: match[2] }
}

/**
 * Turn a course code into a human display name.
 *   `fra_for_eng` → "French for English speakers"
 *   `eng_for_hin` → "English for Hindi speakers"
 *   `cym`         → "Welsh"
 *
 * Codes not in `{target}_for_{known}` shape fall back to a naming of their
 * parts, so a stray value never leaks a raw underscore code to a learner.
 */
export function courseDisplayName(code: string | null | undefined): string {
  if (!code) return ''
  const raw = code.trim()
  const parts = splitCourseCode(raw)
  if (parts) {
    return `${languageName(parts.target)} for ${languageName(parts.known)} speakers`
  }
  // Bare target code (e.g. `cym`, `cym_s`) — just the language.
  if (BARE_LANG.test(raw)) return languageName(raw)
  // Unknown shape — Title-case the whole thing rather than leak the code.
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/**
 * The SHORT label for a course — the target language alone, the way the
 * schools UI names a class's course.
 *
 *   `cym_s_for_eng` → "Welsh (South)"
 *   `fra_for_eng`   → "French"
 *
 * Use this wherever the known language is already implied by context (a
 * school's own dashboard, a trial badge, a chart axis) and the full
 * "X for Y speakers" sentence would just be noise. Falls back to
 * `courseDisplayName` for codes that aren't in course shape, so a stray
 * value still never leaks a raw underscore code to a user.
 */
export function courseShortName(code: string | null | undefined): string {
  if (!code) return ''
  const raw = code.trim()
  const parts = splitCourseCode(raw)
  if (parts) return languageName(parts.target)
  if (BARE_LANG.test(raw)) return languageName(raw)
  return courseDisplayName(raw)
}
