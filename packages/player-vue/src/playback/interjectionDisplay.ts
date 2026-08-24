/**
 * Interjection display gating — "is the guide speaking right now?"
 *
 * Extracted from LearningPlayer.vue so the rule is unit-testable. While a
 * between-rounds interjection plays (Aran's voice: an ordered instruction from
 * the meta-cognitive track, or a random encouragement), the hero card must show
 * the "your guide is speaking" wave — NEVER the next LEGO's text, which the
 * engine has queued but not started, and which therefore renders as an empty
 * card.
 *
 * Defensive default (2026-08-06): ANY commentary that isn't the course welcome
 * shows the wave, including a clip whose `type` is missing or unrecognised. An
 * unknown interjection degrades to "guide is speaking", never to a blank box.
 * The welcome keeps its own separate "listen to your guide" surface.
 */

export type CommentaryDisplayType = 'welcome' | 'instruction' | 'encouragement'

/**
 * @param playingCommentaryAudio true while playCommentaryAudio holds the floor
 * @param type the clip's `type`, or null/unknown if the service didn't set one
 */
export function shouldShowInterjection(
  playingCommentaryAudio: boolean,
  type: string | null | undefined,
): boolean {
  if (!playingCommentaryAudio) return false
  return type !== 'welcome'
}
