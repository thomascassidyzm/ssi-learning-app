/**
 * shellOriginState — "did anything this device saved come across with it?"
 *
 * THE FAILURE THIS EXISTS TO PREVENT. Until 2026-09-08 the Android shell served
 * the app from the origin `https://localhost`, and everything a learner's
 * device saved — their position, their sign-in, their downloaded audio, their
 * offline lease — was keyed to that origin by the browser. The shell now loads
 * the deployment, which is a DIFFERENT origin, so none of it is visible to the
 * new build. Installing the new APK over the old one looks, from inside, like a
 * device that has never run the app.
 *
 * That is acceptable: only dev installs exist. Losing it SILENTLY is not. Tom,
 * ruling the detector in before the switch: "it's the kind of failure that
 * looks like progress." A learner who opens the app, finds themselves at the
 * beginning and concludes the app is broken, or worse does not notice and
 * starts again from seed one, is the outcome this line prevents.
 *
 * WHY DETECT RATHER THAN MIGRATE. Migration means moving localStorage and an
 * IndexedDB audio cache from one origin to another inside a WebView, for a
 * population of one emulator and a handful of dev installs. The audio is
 * re-downloadable and the sign-in is one email away; the position is the part
 * that matters and it comes back from the account. Detection is a few lines
 * and it is honest.
 *
 * NO MARKER IS WRITTEN. The test is simply "does this origin hold any app
 * state", so the line disappears the moment the learner signs in or plays,
 * with nothing to keep in step and nothing to clear. It is deliberately true
 * for a genuinely new install too, which is why the sentence it drives is
 * written to be true of both: an honest line about a device that has nothing
 * saved on it yet.
 */

import { isNativeShell } from './capabilities'

/** The bit of `localStorage` this module needs. */
export interface KeyValueStore {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
}

/**
 * Does this key belong to the app rather than to the browser or another site?
 *
 * Two families: everything the app writes is prefixed `ssi-` or `ssi_`, and
 * Supabase parks the session under `sb-<project>-auth-token`. A signed-in
 * learner who has never played still counts as state carried over.
 */
export function isAppStateKey(key: string): boolean {
  return key.startsWith('ssi-') || key.startsWith('ssi_') || /^sb-.+-auth-token$/.test(key)
}

/**
 * Has anything at all been saved by this app, on this origin?
 *
 * Three answers, not two. A store that will not answer — private mode, a
 * locked-down WebView, a quota error — is not evidence either way, and
 * treating it as "nothing saved" would put a line about lost state in front of
 * someone who has lost none. Silent when unsure, the same rule buildStaleness
 * obeys.
 */
export function appStateOnThisOrigin(
  store: KeyValueStore | null | undefined,
): 'present' | 'absent' | 'unknown' {
  if (!store) return 'unknown'
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key && isAppStateKey(key)) return 'present'
    }
    return 'absent'
  } catch {
    return 'unknown'
  }
}

/**
 * Should the app say that nothing came across with it?
 *
 * TRUE only inside the shell, and only while this origin holds nothing. On the
 * web it is always false: a browser tab has not changed origin and never had
 * an earlier install to lose.
 */
export function shellStorageIsFresh(
  shellIsWebView: boolean,
  store: KeyValueStore | null | undefined,
): boolean {
  if (!shellIsWebView) return false
  return appStateOnThisOrigin(store) === 'absent'
}

/**
 * The same question, asked of the real environment — this is what UI calls.
 *
 * It reads the shell and the store here, inside the seam, because
 * `platformDoors.test.ts` fails the build on a shell predicate anywhere else,
 * and rightly: a component asking "am I in a WebView" is the second door that
 * makes both platforms unreasonable about. The component asks a question about
 * ITSELF — should I say this — and gets one boolean.
 */
export function nothingSavedOnThisOrigin(): boolean {
  let store: KeyValueStore | null = null
  try {
    store = typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    // A WebView that refuses storage entirely. Unknown, so silent.
    return false
  }
  return shellStorageIsFresh(isNativeShell(), store)
}
