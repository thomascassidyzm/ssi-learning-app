/**
 * podSentenceSplit — the single source of truth for turning a per-TURN
 * listening_pod_sentences row into per-SENTENCE units.
 *
 * A row holds a whole speaker turn (multi-sentence text + ONE target clip +
 * ONE known clip). When the turn clips were silence-split into per-sentence
 * clips (Tom 2026-06-16) the row also carries `sentence_audio_ids` /
 * `sentence_known_audio_ids` (uuid[] in order). The UNIT the learner hears
 * should be the SENTENCE, not the turn — otherwise a 3-sentence turn plays as
 * [3 target sentences] then [3 known sentences], which is too hard to follow.
 *
 * Both consumers split the same way:
 *   - the listening OVERLAY (useListeningPods) — per-sentence cards;
 *   - the MAIN-FLOW scheduler (usePodLapScheduler) — per-sentence pod laps.
 * Keeping the boundary + pairing here means they can never drift.
 */

/** Sentence boundary: split after terminal punctuation followed by whitespace.
 *  Single-source so a future tweak (e.g. adding CJK '。') lands in one place. */
export const POD_SENTENCE_BOUNDARY = /(?<=[.!?…])\s+/

export interface PodSplitUnit {
  /** 0-based index within the source row (0 for a non-split whole-turn row). */
  index: number
  targetText: string
  knownText: string
  targetAudioId: string | null
  /** Per-sentence known (English) clip when the known side was split AND its
   *  count matches the target side; null otherwise (the translation slot then
   *  drops gracefully — the learner just doesn't get that sentence's known
   *  audio, same convention as a sentence with no known_audio_id). */
  knownAudioId: string | null
  /** True when this unit came from a multi-sentence split (vs the whole-turn
   *  fallback). Lets a caller decide id/explainer handling per case. */
  isSplit: boolean
}

export interface SplittableRow {
  target_text?: string | null
  known_text?: string | null
  target_audio_id?: string | null
  known_audio_id?: string | null
  sentence_audio_ids?: string[] | null
  sentence_known_audio_ids?: string[] | null
}

const splitText = (t: string | null | undefined): string[] =>
  (t || '').split(POD_SENTENCE_BOUNDARY).map((s) => s.trim()).filter(Boolean)

/**
 * Split a row into per-sentence units. Returns a SINGLE whole-turn unit when
 * the row hasn't been split (fewer than 2 sentence clips) — backwards
 * compatible: every course works, split or not. Otherwise returns one unit per
 * sentence clip, pairing target ⇄ known by index.
 *
 * `textById` maps a split clip's id → its stored course_audio text. When given,
 * each sentence's display text comes from its OWN clip — authoritative and
 * language-agnostic. This is essential for CJK/Indic/Thai, where the Latin
 * boundary regex can't split the target (Japanese 。/no-spaces, Thai no
 * punctuation at all) so the regex would show the whole turn on every card.
 * The regex remains the fallback for legacy/un-enriched callers.
 */
export function splitRowUnits(row: SplittableRow, textById?: Map<string, string>): PodSplitUnit[] {
  const clips = (Array.isArray(row.sentence_audio_ids) ? row.sentence_audio_ids : []).filter(Boolean) as string[]
  const knownClips = (Array.isArray(row.sentence_known_audio_ids) ? row.sentence_known_audio_ids : []).filter(Boolean) as string[]

  if (clips.length < 2) {
    return [{
      index: 0,
      targetText: row.target_text || '',
      knownText: row.known_text || '',
      targetAudioId: row.target_audio_id || null,
      knownAudioId: row.known_audio_id || null,
      isSplit: false,
    }]
  }

  const tSents = splitText(row.target_text)
  const kSents = splitText(row.known_text)
  const knownMatches = knownClips.length === clips.length
  return clips.map((clip, i) => {
    const knownClip = knownMatches ? knownClips[i] : null
    return {
      index: i,
      // Prefer the clip's own stored text; fall back to the regex split (padding
      // defensively if it produced fewer parts than clips, e.g. CJK that didn't split).
      targetText: textById?.get(clip) || tSents[i] || tSents[tSents.length - 1] || row.target_text || '',
      knownText: (knownClip && textById?.get(knownClip)) || kSents[i] || '',
      targetAudioId: clip,
      knownAudioId: knownClip,
      isSplit: true,
    }
  })
}
