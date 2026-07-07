/**
 * Shared PWA update state.
 *
 * Visibility strategy:
 *   - needRefresh && !userDismissed → banner (PwaUpdatePrompt)
 *   - needRefresh &&  userDismissed → blue dot on the logo (LearningPlayer)
 *   - Click either → applyUpdate()
 */
import { ref } from 'vue'

// True while a new service worker is waiting to take control.
export const updateAvailable = ref(false)

// True after the user clicks Dismiss on the banner — the dot takes over.
// Reset to false whenever a new update notification arrives.
export const userDismissed = ref(false)

// Action that activates the waiting SW and reloads. Populated by
// PwaUpdatePrompt on mount.
export let applyUpdate: (() => void) | null = null

export function setApplyUpdate(fn: () => void) {
  applyUpdate = fn
}

// ============================================================================
// Build-identity check (fixes the stale "update available" banner)
// ============================================================================
//
// Workbox's "waiting SW" signal answers "is there a new service-worker
// SCRIPT?", not "does the learner's running app differ from what's live?".
// Navigations use NetworkFirst (see vite.config.js), so a plain reload can
// already put the learner on the newest build before the new SW even
// finishes installing — the subsequent 'waiting' event is then true but
// stale: it names a build that's already running. Comparing build ids
// closes that gap.

/** True when `latestBuild` names a genuinely different build than `runningBuild`. */
export function isDifferentBuild(runningBuild: string, latestBuild: string | null | undefined): boolean {
  // Couldn't determine the live build (offline, endpoint down) — fail open
  // so a real update is never silently swallowed.
  if (!latestBuild) return true
  // Local dev builds have no stable id to compare against.
  if (runningBuild === 'dev') return true
  return runningBuild !== latestBuild
}

/** Fetches the build id actually live right now, bypassing every cache layer. */
export async function fetchLatestBuildNumber(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.buildNumber === 'string' ? data.buildNumber : null
  } catch {
    return null
  }
}
