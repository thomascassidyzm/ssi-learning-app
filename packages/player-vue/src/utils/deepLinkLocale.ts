/**
 * A deep link to a course infers the interface language.
 *
 * Aran's ask (2026-09-02): someone follows a link straight to Spanish-for-
 * Hindi-speakers and lands on an English page about learning Spanish. The
 * course's KNOWN language — the one the learner already speaks — is the best
 * signal we have about what this visitor reads, better than a browser header,
 * because they clicked a link for exactly this pairing.
 *
 * The one rule that shapes everything here: a deep link INFERS, it never
 * OVERRIDES. So this only ever writes through setLocale(code, 'inferred'),
 * and it stands down the moment `hasChosenLocale()` says a person picked
 * their own. An earlier deep link's guess is not a choice and may be
 * replaced by a later one.
 *
 * Read from the URL, not the catalogue. Course codes are `<target>_for_<known>`
 * and the suffix agrees with `courses.known_lang` on every real course in the
 * catalogue (90/90; the sole exception is the `eng_template` scaffold row).
 * That means the language can be settled synchronously at boot, before the
 * first paint, instead of after a Supabase round trip that would render the
 * page in English and then repaint it.
 *
 * Entitlement is deliberately NOT consulted. A locked premium course still
 * tells us what language the visitor reads, and the paywall they meet should
 * be in that language too.
 */

import { hasChosenLocale, isSupportedLocale, setLocale } from '../composables/useI18n'

/**
 * The known-language code a course code names, or null.
 *
 * `spa_for_hin` → `hin`. `deu_at_for_eng` → `eng` (variant lives on the target
 * side). A code with no `_for_` separator, or with more than one, isn't a
 * course pairing we can read.
 */
export function knownLangFromCourseCode(courseCode: string | null | undefined): string | null {
  if (!courseCode) return null
  const parts = courseCode.trim().toLowerCase().split('_for_')
  if (parts.length !== 2) return null
  const known = parts[1]
  return /^[a-z]{2,3}(_[a-z]{1,3})?$/.test(known) ? known : null
}

/**
 * The interface locale a deep link implies, or null when it implies nothing
 * we can act on — no `?course=`, an unreadable code, or a known language we
 * have no translated interface for.
 *
 * The last case is the honest no-op: for a Kannada-known course we stay in
 * English rather than shipping a half-translated page.
 */
export function localeForDeepLink(search: string): string | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search || '')
  } catch {
    return null
  }
  const known = knownLangFromCourseCode(params.get('course'))
  if (!known) return null
  return isSupportedLocale(known) ? known : null
}

/**
 * Apply the inference. Returns the locale it set, or null if it stood down.
 *
 * Called once at boot from main.js, before the app mounts, so the very first
 * paint is already in the right language. Safe to call when there is no deep
 * link — that is the overwhelmingly common case and it costs one URL parse.
 */
export function applyDeepLinkLocale(search: string): string | null {
  const inferred = localeForDeepLink(search)
  if (!inferred) return null

  // A person's own pick outranks any link they follow.
  if (hasChosenLocale()) return null

  // Nothing to do if we'd be re-setting what's already live — but do fall
  // through when the source key is missing, so a legacy inferred-era value
  // gets stamped properly. Cheap either way.
  void setLocale(inferred, 'inferred')
  return inferred
}
