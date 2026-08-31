/**
 * The word to the learner when offline infinite play engages.
 *
 * Tom, 2026-08-15, after testing the cache-first playback change on his phone:
 * "Basically worked but we need a message to let the learner know". The shipped
 * wording is the cause-NEUTRAL one he then chose:
 *
 *   "We can't reach new items right now, so here's a chance to practise what
 *    you've already covered — new items will come through as soon as we can
 *    reach them."
 *
 * Cause-neutral is the honest form: this fires for airplane mode AND for a
 * connection too weak to complete anything, and the learner cannot tell those
 * apart. Telling someone with full bars that they are "offline" would be a lie.
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
  nothingPlayableVisible.value = false
  nothingPlayableShownThisSession = false
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTHING ON THE DEVICE AT ALL
//
// The notice above says "here's a chance to practise what you've already
// covered". It presumes there IS something covered and cached. The other case
// — offline with nothing playable on the device — used to say nothing at all:
// a console warn ("staying put"), a paused summary, or, in Tom's airplane-mode
// session on 2026-08-31, an unescapable silence while the app kept selecting
// listening exercises it did not have.
//
// Tom's rule (2026-08-31): "if nothing is fully available it says so plainly
// to the learner rather than spinning." So this is the plain saying-so. It is
// still a NOTICE and not a gate — nothing is paused by it, and the moment any
// audio becomes reachable again playback simply resumes.
//
// Separate flag from the one above because they are different facts and a
// learner can meet both in one session: first the recycling notice, later the
// nothing-left one.
// ─────────────────────────────────────────────────────────────────────────────
const nothingPlayableVisible = ref(false)
let nothingPlayableShownThisSession = false

/**
 * Call when offline playback has genuinely run out: no forward material in the
 * cache, nothing to recycle, nothing to listen to. Pass whether the offline
 * playback predicate is currently true — online callers raise nothing, exactly
 * as above.
 *
 * Returns true if this call raised the notice.
 */
export function markOfflineNothingPlayable(offlineActive: boolean): boolean {
  if (!offlineActive) return false
  if (nothingPlayableShownThisSession) return false
  nothingPlayableShownThisSession = true
  nothingPlayableVisible.value = true
  return true
}

/** Learner acknowledged it. */
export function dismissOfflineNothingPlayableNotice(): void {
  nothingPlayableVisible.value = false
}

/** Whether the nothing-playable dialog should be on screen right now. */
export const offlineNothingPlayableVisible = readonly(nothingPlayableVisible)
