/**
 * bundleTierTelemetry — one event for "a stored bundle disagreed with the
 * entitlement the learner actually holds, and we healed it".
 *
 * WHY THIS EXISTS
 * ---------------
 * A cached bundle is written under whatever entitlement the caller had at the
 * moment of the fetch — and at boot that is routinely NO entitlement at all,
 * because the first course the app names is fetched before Supabase has
 * restored the session (#676: the pole-position race). The record that lands is
 * the 19-seed free preview, and until #685 nothing re-asked once the identity
 * arrived: the in-memory session map pinned it for the life of the tab, which
 * on an installed PWA is days.
 *
 * The repair is silent and automatic (Tom, 2026-09-06: "better to do it
 * automatically") — no toast, no banner, no button. So the ONLY way anyone
 * finds out it is happening, or how often, is this event. It is the alarm, and
 * it rings in telemetry rather than at the learner.
 *
 * Wiring follows `bundlePathTelemetry` exactly: `useCourseBundle` is a plain
 * module with no access to the Vue telemetry composable, so it reports through
 * a module-level sink that `LearningPlayer` points at `playerLog.event` on
 * mount. Before it is wired — and in tests, SSR and the offline builder —
 * reports are dropped on the floor. Fire-and-forget, and a throwing sink is
 * swallowed: telemetry never interferes with playback.
 */

/** What a stored record declared, and what the server now says. */
export type BundleTier = 'preview' | 'full'

export interface BundleTierEvent {
  /** The course whose stored record disagreed. Named explicitly: the heal
   *  sweeps EVERY course held on the device, not just the one being played,
   *  so `usePlayerLog`'s own `course_code` stamp is the wrong course. */
  courseCode: string
  /** The tier the stored record declared it was fetched under. */
  storedTier: BundleTier
  /** Whether that stored record was fetched with an auth token at all. A
   *  record written token-less is PROVISIONAL — it says nothing about what the
   *  learner is entitled to, only about what the app could prove at the time. */
  storedWithAuth: boolean
  /** The tier the server issued when we re-asked, holding the current identity.
   *  Absent when the refetch failed. */
  resolvedTier?: BundleTier
  /**
   * - `healed`    — the stored tier was wrong and a fuller bundle replaced it.
   * - `confirmed` — we re-asked and the server said the same thing; the record
   *                 is now authoritative rather than provisional.
   * - `failed`    — the background refetch did not land (offline, 5xx). The
   *                 cached bundle keeps serving and we try again next load.
   */
  outcome: 'healed' | 'confirmed' | 'failed'
  /** How long the background refetch took, in ms. */
  tookMs: number
  /** Error message when outcome === 'failed'. Truncated by the caller. */
  detail?: string
}

type Sink = (event: BundleTierEvent) => void

let sink: Sink | null = null

/**
 * Register the telemetry sink. Called once by LearningPlayer with a function
 * that forwards to `playerLog.event('bundle_tier_heal', payload)`.
 * Pass null to unregister (unmount).
 */
export function setBundleTierTelemetrySink(next: Sink | null): void {
  sink = next
}

/** Report a tier disagreement. Safe to call before the sink is wired. */
export function reportBundleTier(event: BundleTierEvent): void {
  if (!sink) return
  try {
    sink(event)
  } catch {
    // Telemetry must never break playback.
  }
}
