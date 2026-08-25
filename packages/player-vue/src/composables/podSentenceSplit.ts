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
 *  Single-source so a future tweak (e.g. adding CJK '。') lands in one place.
 *
 *  '…' IS NOT TERMINAL (2026-08-24). It used to be, and that was wrong in the
 *  direction that costs the learner a card: Croatian Pod 1 writes hesitation
 *  with an ellipsis — "Da, mogu li dobiti… i čašu vode, molim." is ONE sentence
 *  — and 78 of its 131 multi-sentence rows do it. Counting '…' as a sentence
 *  end over-counted those turns, so the scheduler's coverage check
 *  (tSents.length <= clips.length, the branch with no textById oracle) rejected
 *  their correctly-spliced clips and fell back to the whole turn, while the
 *  overlay's word-coverage oracle accepted them. Two doors disagreeing on the
 *  unit count also desynchronises the shared podOrdinal.
 *
 *  Safe estate-wide, measured rather than assumed before the change: across all
 *  67 live core pods and 11,483 rows, exactly 225 rows change their regex count
 *  (hrv 78, cym_s 144, fin 3) and NOT ONE of them is currently split — every
 *  affected row has fewer than 2 sentence clips, so it returns wholeTurn()
 *  before any of this is consulted. Zero currently-split rows change unit count
 *  or unit text.
 *
 *  Under-splitting is also the safe direction here in general: a turn this
 *  regex declines to split keeps its whole, correct clip (the same way the
 *  regex is blind to the Devanagari danda '।'), whereas over-splitting hands
 *  out cards with no translation. */
export const POD_SENTENCE_BOUNDARY = /(?<=[.!?])\s+/

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

/** Letters and digits only, lower-cased: compares WORDS while ignoring
 *  punctuation, spacing and case, which routinely differ between a turn's
 *  stored text and its per-sentence clips' stored texts. Unicode-aware so it
 *  works on every script we ship, not just Latin. */
const wordsOnly = (t: string | null | undefined): string =>
  (t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Do the split clips between them account for the WHOLE turn's text?
 *
 * The unit count comes from the CLIPS, so any sentence of text beyond the last
 * clip is not merely silent — it never reaches the screen at all. That shipped:
 * Italian Pod 1 Scene 1 rendered Sarah's "Buongiorno. Come stai?" as just
 * "Buongiorno.", so the neighbour answered a question the learner never saw
 * asked (founder report, 2026-08-24).
 *
 * Compared on words rather than sentence COUNTS on purpose: the boundary regex
 * mis-splits abbreviations ("Sig. Rossi" looks like two sentences) and cannot
 * split CJK/Indic/Thai at all, so a count test would both false-alarm and
 * miss. Word coverage is the thing we actually care about — no text lost.
 */
const clipsCoverTurn = (clips: string[], turnText: string | null | undefined, textById: Map<string, string>): boolean =>
  clips.map((id) => wordsOnly(textById.get(id))).join('') === wordsOnly(turnText)

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

  const wholeTurn = (): PodSplitUnit[] => [{
    index: 0,
    targetText: row.target_text || '',
    knownText: row.known_text || '',
    targetAudioId: row.target_audio_id || null,
    knownAudioId: row.known_audio_id || null,
    isSplit: false,
  }]

  // Stale-slice guard. Split clip ids can outlive the course_audio rows they
  // point at — e.g. a course's main audio is re-rendered and the old June
  // per-sentence slices are deleted, but the pod row still lists them. Playing
  // a dangling id fails silently ("can't find the phrase"). When the caller
  // gives us textById (built from the clips that DO exist in course_audio), it
  // is the existence oracle: if any target/known split clip is missing, don't
  // emit a broken split — fall through to the whole-turn clip, which is the
  // canonical render and is always present. All-or-nothing so a partial split
  // never misaligns audio against the regex-split text.
  if (textById && (
    !clips.every((id) => textById.has(id)) ||
    (knownClips.length > 0 && !knownClips.every((id) => textById.has(id)))
  )) {
    return wholeTurn()
  }

  if (clips.length < 2) return wholeTurn()

  const tSents = splitText(row.target_text)

  // NO SENTENCE WITH TEXT IS EVER DROPPED FROM THE SCREEN. The split emits one
  // unit per CLIP, so a turn whose clips don't account for all of its text
  // loses the remainder silently. When that's the case, render the whole turn:
  // its text is complete by construction and its one clip is the canonical
  // audio for all of it. Same all-or-nothing reasoning as the stale-slice
  // guard above — a partial split is worse than no split.
  //
  // With textById we can check coverage honestly, word for word. Without it
  // (the scheduler's bare call) the regex count is the only signal available;
  // it can only over-count on abbreviations, and over-counting here costs a
  // split, never a sentence.
  const covered = textById
    ? clipsCoverTurn(clips, row.target_text, textById)
    : tSents.length <= clips.length
  if (!covered) {
    console.warn('[podSentenceSplit] split clips do not cover the turn text — rendering the whole turn instead.',
      { clips: clips.length, textSentences: tSents.length, targetText: row.target_text })
    return wholeTurn()
  }
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
