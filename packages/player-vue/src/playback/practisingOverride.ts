/**
 * PRACTISING OVERRIDE — the admin switch, made direct.
 *
 * Tom's ruling, 2026-09-01, after the old switch (`contentBlackout.ts`)
 * reported "Could not engage: the check was never made from this position" on
 * a real device:
 *
 *   "That is NOT what Tom asked for. It still works by sabotaging a LEGO and
 *    waiting for an existing trigger to notice — the same class of
 *    indirection as the old 'look back 40 rounds for a review-shaped round'
 *    logic, which is exactly what we replaced because it can never fire from
 *    an arbitrary position."
 *
 * So this is not a fetch simulation. It IS the flag. Flip it on and
 * `isPractising` is true on the very next read — no fetch, no probe, no
 * round boundary, no dependency on where the learner happens to be standing.
 * The direct per-cycle filter in LearningPlayer's `shouldSkipCycle`
 * (`cycleIntroducesMaterial`) consults `isPractising` on every step, so the
 * very next cycle it evaluates already honours the flip, mid-round included.
 * Flip it off and the very next cycle already doesn't.
 *
 * IN MEMORY ONLY, never persisted — same reasoning as the switch it replaces:
 * a state that survived a restart would sit in front of the boot fetch, and a
 * test switch that can brick the app on reload is worse than no switch. Every
 * app start begins with it off.
 */

import { ref } from 'vue'

/** True while the admin override is forcing PRACTISING mode on. */
export const practisingOverrideActive = ref(false)

/** Flip the override. Returns the new state so a caller renders from the
 *  source of truth rather than its own copy — and there is nothing to await:
 *  the state IS the effect. */
export function setPractisingOverride(on: boolean): boolean {
  practisingOverrideActive.value = !!on
  return practisingOverrideActive.value
}

/** Test/teardown helper. */
export function resetPractisingOverride(): void {
  practisingOverrideActive.value = false
}
