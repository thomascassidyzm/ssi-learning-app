/**
 * bundlePathTelemetry — one event for "did this session actually use the
 * bundle, or did it quietly fall back to the old network path?"
 *
 * WHY THIS EXISTS
 * ---------------
 * The bundle cutover replaces /round-map + N×/cycles + /infplay-cycles with a
 * single course bundle, per flagged course. When the bundle is not in hand
 * inside the boot budget, `useInstantPlayback` falls through to the old
 * endpoints — which is the RIGHT safety behaviour, the learner still plays —
 * but it announced itself only as a `console.warn`. A console line is not
 * evidence: a cutover that fell back on most cold first plays would look
 * identical, from the outside, to one that worked, and the only way anyone
 * would find out is by having the console open at the right moment (which is
 * exactly how this was found, on staging, 2026-08-29).
 *
 * So every bundle-path decision now emits `bundle_boot_path`, with an
 * `outcome` of 'bundle' or 'fallback'. The ratio of the two, per course and
 * per stage, is the health signal: a rising fallback share is the cutover
 * being cosmetic, and it is queryable rather than folklore.
 *
 * Wiring follows `introAudioTelemetry`: `useInstantPlayback` is a plain module
 * with no access to the Vue telemetry composable, so it reports through a
 * module-level sink that `LearningPlayer` points at `playerLog.event` on
 * mount. Before it is wired — and in tests, SSR and the offline builder —
 * reports are dropped on the floor. Fire-and-forget, and a throwing sink is
 * swallowed: telemetry never interferes with boot.
 */

/** Which consumer of the bundle is reporting. `full_script` is step 6: the
 *  whole-course script that used to be the Supabase walk. */
export type BundlePathStage = 'round_map' | 'cycles' | 'infplay' | 'full_script'

export interface BundlePathEvent {
  /** NOTE: no courseCode — `usePlayerLog` stamps `course_code` on the row. */
  stage: BundlePathStage
  /** 'bundle' = this stage was served from the bundle; 'fallback' = it went
   *  to the old network endpoint instead. */
  outcome: 'bundle' | 'fallback'
  /** How long the caller waited on the bundle before deciding, in ms. */
  waitedMs: number
  /** Why it fell back. 'budget' = the bundle had not arrived inside the boot
   *  budget; 'error' = the fetch or the local generation threw; 'preview' =
   *  the bundle arrived but was the unentitled preview slice, which INF PLAY
   *  deliberately refuses to generate from. Absent on a bundle outcome. */
  reason?: 'budget' | 'error' | 'preview'
  /** The boot budget in force, so a later budget change is legible in the data. */
  budgetMs?: number
  /** Error message when reason === 'error'. Truncated by the caller. */
  detail?: string
}

type Sink = (event: BundlePathEvent) => void

let sink: Sink | null = null

/**
 * Register the telemetry sink. Called once by LearningPlayer with a function
 * that forwards to `playerLog.event('bundle_boot_path', payload)`.
 * Pass null to unregister (unmount).
 */
export function setBundlePathTelemetrySink(next: Sink | null): void {
  sink = next
}

/** Report a bundle-path decision. Safe to call before the sink is wired. */
export function reportBundlePath(event: BundlePathEvent): void {
  if (!sink) return
  try {
    sink(event)
  } catch {
    // Telemetry must never break boot.
  }
}
