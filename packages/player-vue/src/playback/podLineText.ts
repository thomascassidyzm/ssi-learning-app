/**
 * podLineText — which words a Listening Mode dialogue card shows for a line.
 *
 * A pod line normally shows its TARGET text, with the KNOWN text as a gloss
 * the eye toggles. But a line that was never spoken in the target language at
 * all — an English contribution on the floor of a bilingual Senedd transcript
 * — has NO target text, and its known clip IS the recording of what was said
 * (podModalQueue plays it for exactly that reason, Tom's ruling 2026-09-03).
 * Until job #591 such a card rendered EMPTY in Immersion, where glosses are
 * off: a blank white card lit for the length of the English clip, the walk
 * apparently on nothing (Senedd pod, scene 15 line 79 and scene 17 line 82,
 * production 2026-09-13). The words on the card must be the words in the ear.
 *
 * One rule, used by every card branch: empty target → the known text IS the
 * line, in the known language, and there is no gloss to show under it.
 */
export interface PodLineShown {
  text: string
  /** Which language the shown words are in, for the card's `lang` attribute. */
  side: 'target' | 'known'
  /** Was anything said in the target language on this line? False means the
   *  known text is already on the card and must not repeat as a gloss. */
  hasTarget: boolean
}

export function podLineShown(targetText: string | null | undefined, knownText: string | null | undefined): PodLineShown {
  const target = String(targetText ?? '').trim()
  if (target.length > 0) return { text: String(targetText ?? ''), side: 'target', hasTarget: true }
  return { text: String(knownText ?? ''), side: 'known', hasTarget: false }
}
