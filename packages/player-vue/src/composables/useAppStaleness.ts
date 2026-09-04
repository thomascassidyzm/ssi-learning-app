/**
 * useAppStaleness — the native shell's answer to "is the app I am holding
 * older than the app that is live?"
 *
 * THE DEFECT THIS CURES. The Android APK bundles its web assets and serves
 * them from `https://localhost`, so nothing inside it could ever notice new
 * code existed: its `/version.json` is the frozen copy it shipped with. Tom
 * ruled on 2026-09-04 that the bundling stays — offline-first is what India is
 * buying — so the cure is to make the lag SELF-DESCRIBING instead. See
 * platform/buildStaleness.ts for the comparison and the three rules it obeys.
 *
 * NATIVE SHELL ONLY, deliberately — and the gate is asked of the platform
 * seam (`shouldDescribeStaleness()`), never re-derived here. On the web the
 * service-worker banner already owns this ground, a reload genuinely fixes it,
 * and the sentence this drives — go and install a newer app — would be false.
 * So on the web this composable never fetches and never fires.
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
