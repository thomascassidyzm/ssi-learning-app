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
  ell: 'Greek',
  hrv: 'Croatian',
}

/**
 * Resolve a single language code to its display name, with a graceful
 * Title-case fallback for codes we haven't named yet.
 */
export function languageName(code: string): string {
  const key = code.trim().toLowerCase()
  if (LANGUAGE_NAMES[key]) return LANGUAGE_NAMES[key]
  return key.charAt(0).toUpperCase() + key.slice(1)
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
  const match = raw.match(/^([a-z]{2,3})_for_([a-z]{2,3})$/i)
  if (match) {
    const [, target, known] = match
    return `${languageName(target)} for ${languageName(known)} speakers`
  }
  // Bare target code (e.g. `cym`) — just the language.
  if (/^[a-z]{2,3}$/i.test(raw)) return languageName(raw)
  // Unknown shape — Title-case the whole thing rather than leak the code.
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
