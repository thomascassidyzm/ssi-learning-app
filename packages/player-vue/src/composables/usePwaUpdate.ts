/**
 * Shared PWA update state.
 *
 * Visibility strategy:
 *   - needRefresh && !userDismissed → banner (PwaUpdatePrompt)
 *   - needRefresh &&  userDismissed → blue dot on the logo (LearningPlayer)
 *   - Click either → applyUpdate()
 */
import { ref } from 'vue'
import { apiOrigin } from '../platform/apiBase'
import type { BuildStamp } from '../platform/buildStaleness'

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

/**
 * Where `/version.json` actually LIVES for this shell.
 *
 * On the web: the relative path, unchanged — the page origin IS the
 * deployment, and that is what fixed the phantom update banner in 1403ac0e.
 *
 * In a bundled native shell: the API origin. The APK freezes its own
 * `/version.json` into `assets/public/` and serves it from `https://localhost`,
 * so the relative path can only ever hand back the running build's own id —
 * the app asks itself and agrees with itself forever. `apiUrl()` cannot do
 * this job: it deliberately rewrites `/api/...` paths only, and this is not
 * one.
 */
function versionUrl(): string {
  const origin = apiOrigin()
  return origin ? `${origin}/version.json` : '/version.json'
}

/**
 * Fetches the build stamp actually live right now, bypassing every cache
 * layer. Null when it cannot be read at all (offline, endpoint down,
 * unparseable) — callers decide what silence means for them.
 */
export async function fetchLatestBuild(): Promise<BuildStamp | null> {
  try {
    const res = await fetch(versionUrl(), { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const buildNumber = typeof data?.buildNumber === 'string' ? data.buildNumber : null
    const buildTime = typeof data?.buildTime === 'string' ? data.buildTime : null
    if (!buildNumber && !buildTime) return null
    return { buildNumber, buildTime }
  } catch {
    return null
  }
}

/** Fetches the build id actually live right now, bypassing every cache layer. */
export async function fetchLatestBuildNumber(): Promise<string | null> {
  return (await fetchLatestBuild())?.buildNumber ?? null
}
