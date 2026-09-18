/**
 * nativeContract — "is this web build asking the shell for something the
 * installed shell does not have?"
 *
 * THE PROBLEM THIS ANSWERS, and why it only exists in this shape. Since Tom's
 * ruling of 2026-09-08 the Android APK carries no web code: it is a WebView
 * onto the deployment (see capacitor.config.ts). So web changes reach an
 * installed phone on its next launch with nothing to ship and nothing to
 * review — which is exactly what was wanted, and which quietly creates ONE new
 * way to break a learner. A web change that needs something NATIVE — a
 * Capacitor plugin, a permission, a manifest entry, a WebView setting — ships
 * to every installed APK the same afternoon, and on an APK that predates that
 * native change it simply does not work. Nothing tells anybody. The learner
 * sees a feature that does nothing.
 *
 * So every build declares which KIND of change it is, and the declaration is a
 * single integer either side of the seam:
 *
 *   SHELL_NATIVE_LEVEL      (capacitor.config.ts) — what the NATIVE shell has.
 *                            Bumping it means "this change needs a Play Store
 *                            release", and it is the one line in the repo that
 *                            says so.
 *   WEB_REQUIRES_NATIVE_LEVEL (here)              — what the WEB code needs.
 *                            Bumping it means "older installed APKs cannot run
 *                            this build properly, and should be told so."
 *
 * A web-only change touches NEITHER. That is the common case and it must stay
 * free: nothing to declare, nothing to review, nothing to bump.
 *
 * SILENT UNLESS THERE IS SOMETHING TO SAY. WEB_REQUIRES_NATIVE_LEVEL is 0 and
 * should stay 0 until a web change genuinely depends on a native one. The
 * whole mechanism is therefore invisible today, which is the correct resting
 * state — the same rule buildStaleness obeys, and for the same reason: a line
 * telling somebody to go to the Play Store when nothing is wrong is worse than
 * no line at all.
 *
 * AND AN UNMARKED SHELL IS LEVEL 0, NOT "UNKNOWN". Every APK built before this
 * existed appends `SSiShell/android` with no level on it. Reading those as 0 is
 * the truth — they predate the contract, so they have none of it — and it is
 * also the safe side: they are told about a level they lack, never reassured
 * about one they have.
 */

import { platform } from './capabilities'

/**
 * The native contract level THIS WEB BUILD requires of the shell running it.
 *
 * Bump this ONLY in the change that starts depending on a native capability,
 * and only once the shell carrying that capability is on the Play Store — the
 * bump is what tells everyone still on an older APK to go and get it.
 */
export const WEB_REQUIRES_NATIVE_LEVEL = 0

/**
 * Is the shell this app is running inside older than the web code it is
 * running?
 *
 * False on the web, always: a browser has no native contract to be short of.
 */
export function needsStoreUpdate(): boolean {
  const p = platform()
  if (p.shell !== 'webview') return false
  return p.nativeLevel < WEB_REQUIRES_NATIVE_LEVEL
}
