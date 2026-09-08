/**
 * The per-course voice-pace facts, held where every speed path can reach them.
 *
 * WHY A STORE AND NOT A PROP. The facts arrive on the course bundle (plate
 * S-345), but the baked speed is computed from `TargetSpeedConfig`, which is
 * assembled in `LearningPlayer.currentTargetSpeedConfig()` and consumed by
 * BOTH round-builders and by the whole-course bundle path. Threading the
 * bundle through all of those would mean touching every call site to deliver
 * one small object that is the same for the whole session. One module-scoped
 * map, written once when a bundle lands, is the cheaper shape — and it means a
 * path that never sees a bundle simply reads nothing and gets the uncorrected
 * behaviour, which is the correct fallback rather than a special case.
 *
 * It holds FACTS, never a decision. Nothing here computes a speed.
 */

import type { CourseVoicePace } from '@ssi/core'

const byCourse = new Map<string, CourseVoicePace>()

/** Record the pace facts a bundle arrived with. A bundle with none (cached
 *  before this shipped, or an omission the server made deliberately) clears
 *  any previous entry rather than leaving a stale one in place: pace belongs
 *  to the bundle that carried it. */
export function setCourseVoicePace(courseCode: string, pace: CourseVoicePace | null | undefined): void {
  if (!courseCode) return
  if (!pace) {
    byCourse.delete(courseCode)
    return
  }
  byCourse.set(courseCode, pace)
  if (pace.unavailable) {
    console.warn(`[VoicePace] ${courseCode}: server could not derive pace facts (${pace.unavailableReason ?? 'no reason given'}). ` +
      'Target clips play at the mode\'s pace UNCORRECTED — the same speed they would have with no per-voice pace at all.')
    return
  }
  // One findable line per course load, naming the voice whose pace is being
  // applied and saying plainly when we have never measured it. The unmeasured
  // case is the majority case (196 of 427 voices measured, 2026-09-07), so it
  // is stated rather than hidden.
  for (const [role, r] of Object.entries(pace.roles ?? {})) {
    if (!r?.primary) continue
    const p = r.primary
    const detail = p.measured
      ? `pace ${p.effectivePaceRatio}× of its language's reference`
      : p.knownVoice
        ? 'NEVER MEASURED — target pace used uncorrected'
        : 'NOT IN THE VOICES TABLE at this id — cannot be measured until that is fixed; target pace used uncorrected'
    console.log(`[VoicePace] ${courseCode} ${role}: ${p.voiceId} (${p.clips} clips) — ${detail}`)
  }
}

/** The pace facts for a course, or null if none arrived. Null is an absence:
 *  callers must fall back to the uncorrected target pace, never to 1.0. */
export function getCourseVoicePace(courseCode: string | null | undefined): CourseVoicePace | null {
  if (!courseCode) return null
  return byCourse.get(courseCode) ?? null
}

/** Test seam. */
export function resetCourseVoicePace(): void {
  byCourse.clear()
}
