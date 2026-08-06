/**
 * introAudioTelemetry — one event for the whole class of "the intro went
 * quiet".
 *
 * WHY THIS EXISTS
 * ---------------
 * Intro/presentation audio never passes through SimplePlayer's failure path,
 * because nothing FAILS: the round-building adapters resolve a prompt URL,
 * and when there is no presentation clip the URL is simply empty. SimplePlayer
 * skips a phase with no audio, by design, without a word. SimplePlayer is also
 * the only emitter of `audio_failed`. Net effect: a LEGO with no presentation
 * audio produced silence that emitted NOTHING, anywhere — which is why an
 * estate-wide gap surfaced months later as a single learner's bug report
 * rather than on the health board on day one (diagnosis 2026-08-04).
 *
 * This module is the missing emitter. The round-building adapters
 * (`toSimpleRounds`, `backendCyclesToRounds`) are pure functions with no
 * access to the Vue telemetry composable, so they report through a
 * module-level sink that `LearningPlayer` wires to `playerLog.event` on
 * mount. Before it is wired — and in tests, SSR, and the offline builder —
 * reports are dropped on the floor.
 *
 * Non-blocking by construction: the sink is `usePlayerLog`'s buffered event
 * path (batched, silent on failure), calls are fire-and-forget, and a throwing
 * sink is swallowed. Telemetry never interferes with playback.
 */

/** Which rung of the fallback ladder a cycle actually landed on. */
export type IntroAudioFallbackTier =
  /** No presentation clip; the known-language clip took the prompt slot.
   *  Degraded but audible — the learner still hears the LEGO. */
  | 'known_fallback'
  /** Neither presentation nor known audio. Nothing plays for the prompt;
   *  this is the silent-intro case Aran reported. */
  | 'silent'

export interface IntroAudioMissingEvent {
  /** NOTE: no courseCode here — `usePlayerLog` stamps `course_code` on the
   *  event ROW (same as `audio_play`), so carrying it in the payload too
   *  would just be a second copy that can drift. */
  legoId: string
  cycleId: string
  /** 'intro' | 'component_intro' — which introduction went quiet. */
  cycleType: string
  tier: IntroAudioFallbackTier
  /** 'backend' (instant-playback cycles endpoint) | 'script' (legacy
   *  generateLearningScript path) — tells you WHICH producer to fix. */
  source: 'backend' | 'script'
}

type Sink = (event: IntroAudioMissingEvent) => void

let sink: Sink | null = null

/**
 * Register the telemetry sink. Called once by LearningPlayer with a function
 * that forwards to `playerLog.event('intro_audio_missing', payload)`.
 * Pass null to unregister (unmount).
 */
export function setIntroAudioTelemetrySink(next: Sink | null): void {
  sink = next
}

/**
 * Report an intro/component_intro cycle whose presentation audio was absent.
 * Safe to call from anywhere, including before the sink is wired.
 */
export function reportIntroAudioMissing(event: IntroAudioMissingEvent): void {
  if (!sink) return
  try {
    sink(event)
  } catch {
    // Telemetry must never break round building.
  }
}
