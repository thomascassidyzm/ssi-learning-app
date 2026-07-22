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

/**
 * Distinct, ordered 0-based sentence indices a lap's plays actually sound —
 * the teleprompter's scoping key (Tom 2026-07-22: "the display needs to know
 * WHICH phrases are in each POD... the last thing we want is the whole
 * dialogue"). A sentence with multiple plays (e.g. stage ['ps','trans','ps'])
 * contributes its index once. Layer-1 segued plays are excluded — they index
 * a different catalogue (see podPlayShowsTurnText).
 */
export function podLapPlayedSentenceIndices(
  plays: readonly { sentenceIdx: number; isLayer1?: boolean }[],
): number[] {
  const set = new Set<number>()
  for (const p of plays) {
    if (podPlayShowsTurnText(p)) set.add(p.sentenceIdx - 1)
  }
  return Array.from(set).sort((a, b) => a - b)
}

/**
 * The [start, end] (inclusive, 0-based) slice of the FULL sentence list a pod
 * lap's teleprompter should render: EXACTLY the sentences this lap plays,
 * never a dimmed neighbour on either side (Tom 2026-07-22 follow-up: a
 * neighbour sentence reads as part of the exercise even dimmed, and the audio
 * never sounds it — "if it is not sounded, it must not look like part of the
 * exercise"). Null when nothing is playing yet (no window to show).
 */
export function podLapDisplayRange(
  totalSentences: number,
  playedIndices: readonly number[],
): { start: number; end: number } | null {
  if (totalSentences <= 0 || playedIndices.length === 0) return null
  return {
    start: Math.max(0, Math.min(...playedIndices)),
    end: Math.min(totalSentences - 1, Math.max(...playedIndices)),
  }
}
