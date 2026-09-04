/**
 * podModalQueue — how a listening unit becomes a play queue, in one place.
 *
 * Lifted out of ListeningOverlay.vue's `<script setup>` on 2026-09-03 so the
 * rule can be tested directly rather than through an inline-equivalent copy in
 * a test file, which is free to drift from the thing it claims to pin.
 *
 *   immersion — each unit's TARGET once at base speed. A unit with NO TARGET
 *               TEXT AT ALL falls back to its known clip; see below.
 *   drill     — per unit: TARGET first (the learner meets the target before the
 *               meaning), then KNOWN, then TARGET twice more, all at base speed.
 *               A unit with no target plays its known alone.
 */

export interface ModalUnit {
  /** The target-language words. EMPTY means the line was never in the target
   *  language at all — not that its recording is missing. */
  targetText?: string | null
  targetAudioId?: string | null
  knownAudioId?: string | null
}

export interface ModalQueueItem {
  id: string
  rate: number
}

/** Was anything said in the target language on this line? */
const hasTargetText = (u: ModalUnit): boolean => String(u.targetText || '').trim().length > 0

export function buildModalQueue(units: ModalUnit[], mode: string, base: number): ModalQueueItem[] {
  const queue: ModalQueueItem[] = []
  if (mode === 'drill') {
    for (const u of units) {
      if (u.targetAudioId) {
        queue.push({ id: u.targetAudioId, rate: base })                       // target first
        if (u.knownAudioId) queue.push({ id: u.knownAudioId, rate: base })    // then meaning
        queue.push({ id: u.targetAudioId, rate: base })                       // target
        queue.push({ id: u.targetAudioId, rate: base })                       // target again
      } else if (u.knownAudioId) {
        queue.push({ id: u.knownAudioId, rate: base })
      }
    }
    return queue
  }
  // immersion (default): target only, at the chosen speed.
  for (const u of units) {
    if (u.targetAudioId) { queue.push({ id: u.targetAudioId, rate: base }); continue }
    // A line that was never spoken in the target language AT ALL — an English
    // contribution on the floor of a bilingual Senedd transcript — has no target
    // text and no target clip, and its KNOWN side IS the recording of what was
    // said. Play it, or the learner gets silence where a real turn was: Steve's
    // Senedd pod carries 168 such lines, and they are the questions that the
    // Welsh answers are answering (Tom's ruling, 2026-09-03).
    //
    // The empty-target test is doing the work, and it is not a formality. A line
    // that HAS target text and no clip is a GAP — audio not recorded yet — and it
    // must stay silent: speaking its translation instead would put the known
    // language in the learner's ear during an IMMERSION listen and hide a missing
    // recording behind something that sounds perfectly fine.
    if (!hasTargetText(u) && u.knownAudioId) queue.push({ id: u.knownAudioId, rate: base })
  }
  return queue
}
