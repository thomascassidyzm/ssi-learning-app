/**
 * practiceByCourse — the ONE client door to per-course practice minutes.
 *
 * It used to be a direct RPC call on the admin practice-minutes-by-course
 * function, made from four places in browser code. That function is SECURITY DEFINER, and while its
 * platform-wide path was gated to ssi_admin in August 2026, its NAMED-LEARNER
 * path was not: any signed-in user with a learner UUID could read that
 * person's whole practice history. The reads now go through
 * POST /api/school/practice-by-course, which resolves the caller's visible
 * scope server-side, and the function is service_role only.
 *
 * FAILURES ARE LOUD. This throws rather than returning an empty list: a
 * dashboard that renders zeroes because an authorization call failed is worse
 * than one that says it could not load, because nobody notices the zeroes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PracticeByCourseRow {
  course_code: string
  practice_minutes: number
  is_estimated: boolean
}

/**
 * @param learnerIds the learners to aggregate, or `null` for the platform-wide
 *                   aggregate (ssi_admin only — the server refuses everyone else).
 */
export async function fetchPracticeByCourse(
  client: SupabaseClient,
  learnerIds: string[] | null,
): Promise<PracticeByCourseRow[]> {
  // An empty set is a question with a known answer; asking the server would
  // only earn a 400.
  if (learnerIds && learnerIds.length === 0) return []

  const { data } = await client.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch('/api/school/practice-by-course', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(learnerIds === null ? {} : { learner_ids: learnerIds }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message || body?.error || `practice-by-course ${res.status}`)
  }
  const body = (await res.json()) as { practice?: PracticeByCourseRow[] }
  return body.practice ?? []
}
