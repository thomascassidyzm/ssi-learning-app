/**
 * Per-course, per-role voice pace for the bundle — the READ side of plate
 * S-345 (Tom, 2026-08-29: "per-voice pace settings the player reads instead of
 * a blunt belt multiplier").
 *
 * One RPC per course load, not a query per clip. `public.course_voice_pace()`
 * (supabase/migrations/20260907_course_voice_pace.sql) does the derivation:
 * for each audio role, which voice actually rendered this course's REFERENCED
 * clips, and what that voice's measured natural pace is. Keying off the
 * rendered artefact rather than `courses.voice_config` is what stops casting
 * and pace disagreeing — and they do disagree today (deu_at_for_eng target2).
 *
 * WHY THIS IS SOFT-FAILING AND TIME-BOXED
 * ---------------------------------------
 * The derivation is ~375ms warm on the largest courses, but this is a shared,
 * busy database and a cold-buffer run has been measured at 8-20s (2026-09-07).
 * Blocking a course load on that would be a straight regression for every
 * learner in exchange for a per-voice speed correction worth a few percent. So
 * it is time-boxed, and a miss ships the bundle WITHOUT pace facts.
 *
 * A miss is not silent and it is not a guess: the bundle carries
 * `voicePace: { unavailable: true, unavailableReason }`, the server logs one
 * line, and the player falls back to the target number uncorrected — exactly
 * what it did before per-voice pace existed. Never a stand-in 1.0.
 *
 * The bundle response is edge-cached for a day (`s-maxage=86400`), so the cost
 * is paid roughly once per course per day per region, not once per learner.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CourseVoicePace } from '../../packages/core/src/script/voicePace'

/**
 * How long a course load will wait for the pace derivation before shipping
 * without it. 2500ms is a deliberate compromise, and the conservative side of
 * it is "do not delay the course": the warm case (~375ms) clears it with room
 * to spare, and the cold case is meant to lose. Raising this trades every
 * learner's time-to-first-play against a correction of a few percent on the
 * speaking voice — a bad trade, which is why the number is small.
 */
export const VOICE_PACE_TIMEOUT_MS = 2500

/**
 * Fetch the pace facts, or an explicit "we could not look" marker.
 *
 * NEVER throws and never returns null: the absence has to reach the payload,
 * because a missing key and a deliberate omission read identically to a client
 * and only one of them is a fact about this request.
 */
export async function fetchCourseVoicePace(
  supabase: SupabaseClient,
  courseCode: string,
  timeoutMs: number = VOICE_PACE_TIMEOUT_MS,
): Promise<CourseVoicePace> {
  const unavailable = (reason: string): CourseVoicePace => {
    console.warn(`[VoicePace] ${courseCode}: pace facts unavailable — ${reason}. ` +
      'Bundle ships without them; the player will use the target pace UNCORRECTED ' +
      '(i.e. exactly as it behaved before per-voice pace existed).')
    return {
      courseCode,
      derivedFrom: 'public.course_voice_pace()',
      roles: {},
      unavailable: true,
      unavailableReason: reason,
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const rpc = supabase.rpc('course_voice_pace', { p_course_code: courseCode })
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
    const raced = await Promise.race([rpc, timeout])
    if (raced === 'timeout') return unavailable(`derivation exceeded ${timeoutMs}ms`)

    const { data, error } = raced as { data: unknown; error: { message?: string } | null }
    if (error) return unavailable(`rpc error: ${error.message ?? 'unknown'}`)
    if (!data || typeof data !== 'object') return unavailable('rpc returned no object')

    const pace = data as CourseVoicePace
    if (!pace.roles || typeof pace.roles !== 'object') return unavailable('rpc payload had no roles')

    // One line the next person can actually find. The unmeasured case is the
    // MAJORITY case today — 196 of 427 voices carry a measurement — so it is
    // logged as ordinary information, not as an error.
    const summary = Object.entries(pace.roles)
      .map(([role, r]) => `${role}=${r?.primary?.voiceId ?? '?'}` +
        (r?.primary?.measured ? `@${r.primary.effectivePaceRatio}` : '@UNMEASURED'))
      .join(' ')
    console.log(`[VoicePace] ${courseCode}: ${summary || '(no roles)'}`)
    return pace
  } catch (err) {
    return unavailable(`threw: ${(err as Error)?.message ?? String(err)}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
