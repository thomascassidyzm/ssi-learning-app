/**
 * podTurns.ts — group a pod's flat, ordered sentence list into speaker TURNS,
 * for the always-visible whole-turn display (2026-07-14, replacing Stage-0's
 * audio breakdown ladder — see podStageComposition.ts header).
 *
 * A turn is a maximal run of consecutive sentences connected by
 * `glue_to_next` (computed speaker-aware by flattenPodRows: split siblings of
 * one row always glue, a speaker change breathes). Turns never span a lap
 * boundary check — they're pure structure over the sentence list, independent
 * of which sentences a given lap actually plays.
 */

export interface PodTurnSpan {
  /** Inclusive start index into the sentence array. */
  start: number
  /** Inclusive end index into the sentence array. */
  end: number
}

/** Minimal shape this module reads — any pod sentence row qualifies. */
export interface GluedRow {
  glue_to_next?: boolean | null
}

/** Compute turn spans over an ordered sentence list. Pure, no Vue. */
export function computeTurnSpans(sentences: readonly GluedRow[]): PodTurnSpan[] {
  const spans: PodTurnSpan[] = []
  let start = 0
  for (let i = 0; i < sentences.length; i++) {
    if (!sentences[i].glue_to_next || i === sentences.length - 1) {
      spans.push({ start, end: i })
      start = i + 1
    }
  }
  return spans
}

/** Find the span containing a given sentence index, or null if out of range. */
export function turnSpanForIndex(spans: readonly PodTurnSpan[], index: number): PodTurnSpan | null {
  return spans.find((s) => index >= s.start && index <= s.end) ?? null
}

/**
 * Governs whole-turn display text per exercise layer (product rule,
 * 2026-07-22, Tom/Aran): Layer-1 listening-cup seed plays — segued through
 * the shared pod-lap pipeline (LearningPlayer's playPodLap) — are audio-only,
 * never text. Layer-2 pod sentences always resolve a turn and show text.
 * `play.sentenceIdx` indexes the L1 seed catalogue, not podScheduler's
 * sentence list, so without this guard `turnSpanForIndex` can coincidentally
 * resolve a span and render the WRONG pod sentence's text during an L1 cup.
 */
export function podPlayShowsTurnText(play: { isLayer1?: boolean } | null | undefined): boolean {
  return !!play && !play.isLayer1
}
