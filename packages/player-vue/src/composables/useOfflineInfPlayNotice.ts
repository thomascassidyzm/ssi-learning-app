/**
 * The word to the learner when offline infinite play engages.
 *
 * Tom, 2026-08-15, after testing the cache-first playback change on his phone:
 *
 *   "Basically worked but we need a message to let the learner know … you're
 *    offline so we're just going to give you a chance to practice what you've
 *    already covered. You'll get new items when you next go online"
 *
 * The rule this serves is #595's: play what you have, never gate the learner.
 * So this is a NOTICE, not a gate — it never pauses audio, it is dismissible,
 * and it shows at most ONCE per session. A learner on one bar who never flipped
 * any toggle now gets told why the material started repeating, instead of
 * quietly wondering.
 *
 * It rides the SAME signal the playback path rides (`offlinePlaybackActive()`
 * in LearningPlayer, i.e. toggle OR browser-offline OR observed stall) — it
 * never asks `navigator.onLine` itself, because that lies on weak signal. See
 * `config/networkGate.ts`.
 */
import { ref, readonly } from 'vue'

// Module-level shared state, matching useOfflineDownloadStatus: the notice is
// raised deep in LearningPlayer's playback path and read by the template, and
// nothing about it is per-component.
const visible = ref(false)

// Once per session — "session" being this page/app lifetime. Dismissed means
// dismissed: if the app stays offline, or drops offline again after a recovery,
// it does not come back and nag.
let shownThisSession = false

/**
 * Call when offline infinite play has ACTUALLY engaged — i.e. cached content
 * was just recycled into the queue — passing whether the offline playback
 * predicate is currently true.
 *
 * Returns true if this call raised the notice, which is what the tests assert
 * on and what keeps the trigger honest: online recycles raise nothing.
 */
export function markOfflineInfPlayEngaged(offlineActive: boolean): boolean {
  if (!offlineActive) return false
  if (shownThisSession) return false
  shownThisSession = true
  visible.value = true
  return true
}

/** Learner acknowledged it. */
export function dismissOfflineInfPlayNotice(): void {
  visible.value = false
}

/** Whether the dialog should be on screen right now. */
export const offlineInfPlayNoticeVisible = readonly(visible)

/** Test seam — reset module state between cases. */
export function __resetOfflineInfPlayNoticeForTests(): void {
  visible.value = false
  shownThisSession = false
}
