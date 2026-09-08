/**
 * useAppStaleness — the native shell's answer to "is the app I am holding
 * older than the app that is live?"
 *
 * DORMANT SINCE 2026-09-08, AND KEPT ON PURPOSE. The defect it cured was
 * structural to a BUNDLED APK: the app served its web assets from
 * `https://localhost`, so its `/version.json` was the frozen copy it shipped
 * with and it could never notice new code existed. Tom's ruling that day made
 * the shell a window onto the deployment instead, so the code running is the
 * live code and there is nothing to be behind. `shouldDescribeStaleness()`
 * therefore answers NO everywhere and this composable never fetches and never
 * fires — on the web, where the service-worker banner has always owned this
 * ground, and now in the shell too.
 *
 * The gate is asked of the platform seam, never re-derived here, which is why
 * turning the posture round took one line rather than a hunt. If a bundled
 * build ever comes back — an offline-first APK for a market with no network at
 * install time is the obvious candidate — this is the cure it needs, intact.
 * See platform/buildStaleness.ts for the comparison and the three rules it
 * obeys.
 *
 * IT DESCRIBES, IT NEVER GATES. Nothing here blocks navigation, refuses a tap,
 * opens a modal or interrupts playback (Tom's standing rule from 2026-05-21:
 * never force-update while audio is playing). It sets one boolean that one
 * quiet line reads.
 */
import { ref } from 'vue'
import { shouldDescribeStaleness } from '../platform/capabilities'
import { isProvablyStale } from '../platform/buildStaleness'
import type { BuildStamp } from '../platform/buildStaleness'
import { fetchLatestBuild } from './usePwaUpdate'

/** What this bundle is, stamped at build time by vite.config.js. */
export const runningBuild: BuildStamp = {
  buildNumber: typeof __BUILD_NUMBER__ === 'string' ? __BUILD_NUMBER__ : null,
  buildTime: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : null,
}

/** True only when we can PROVE this build is behind the live one. */
export const appIsStale = ref(false)

/**
 * Ask the live deployment what it is, and compare. Safe to call repeatedly;
 * never throws, never rejects, and leaves `appIsStale` alone on any answer it
 * cannot read.
 */
export async function checkAppStaleness(running: BuildStamp = runningBuild): Promise<boolean> {
  if (!shouldDescribeStaleness()) return false
  const latest = await fetchLatestBuild()
  appIsStale.value = isProvablyStale(running, latest)
  return appIsStale.value
}
