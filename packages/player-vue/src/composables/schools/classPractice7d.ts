/**
 * classPractice7d — ONE fetch of /api/school/class-practice-7d for a set of
 * classes, shared by the classes list (TeacherDashboard.vue) and the class
 * page (ClassDetail.vue), so both read the SAME class-account figures.
 *
 * Tom's ruling, 2026-09-11 (job #265): a class IS one learner account, so a
 * class's belt, journey, activity and minutes are that account's own. Under
 * View-as / the admin read-view the fetch runs as the ssi_admin, whose own
 * scope is empty, so the school being read goes as ?school_id= (verifyAdmin
 * gated server-side) — the bug that painted 34 classes as 0 min / Inactive.
 *
 * Job #301, 2026-09-12: a failed response used to resolve null and the list
 * rendered "…" in every cell with no word of why (Tom's staging shot: 34
 * rows of dots, "0 min in the app this week", while the school page read 352
 * minutes). Now a failure THROWS with its status and the server's message,
 * after one retry for the transient kinds, so the page can say so out loud.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSchoolsClient } from './client'
import type { SchoolUser } from './useSchoolContext'

export interface ClassAccountProgress {
  started: boolean
  journeyDone: number
  journeyTotal: number
  seedNumber: number | null
  lastPractisedAt: string | null
  phrases7d: number
  minutesByDay: number[]
}

export interface ClassPractice7d {
  practiceByClass: Record<string, number>
  activeDaysByClass: Record<string, number>
  classAccountByClass: Record<string, ClassAccountProgress>
}

/**
 * A practice fetch that did not land. Carries the HTTP status and the server's
 * own message so the page can say what happened (job #301, 2026-09-12: the
 * classes list swallowed every failure into "…" that read like data).
 */
export class ClassPracticeFetchError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ClassPracticeFetchError'
    this.status = status
  }
}

/** One retry, after a short pause, for the failures that are usually transient. */
const RETRY_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504])
const RETRY_DELAY_MS = 600

/**
 * Fetch the class-account figures for a set of classes. Resolves with the
 * payload, or THROWS a ClassPracticeFetchError — never resolves null on a
 * failure, so a caller cannot mistake "did not load" for "loaded, empty".
 * Network errors and 5xx/408/429 are retried once before they surface.
 */
export async function fetchClassPractice7d(classIds: string[], user: SchoolUser | null | undefined, client?: SupabaseClient | null): Promise<ClassPractice7d> {
  if (classIds.length === 0) return { practiceByClass: {}, activeDaysByClass: {}, classAccountByClass: {} }
  const c = client ?? getSchoolsClient()
  const { data: { session } } = await c.auth.getSession()
  const token = session?.access_token
  if (!token) throw new ClassPracticeFetchError(401, 'Your session has ended — sign in again')
  const schoolParam = user?._scopeSource === 'admin-view' && user.school_id ? `&school_id=${encodeURIComponent(user.school_id)}` : ''
  const url = `/api/school/class-practice-7d?class_ids=${classIds.join(',')}${schoolParam}`

  const attempt = async (): Promise<{ res: Response | null; status: number; message: string }> => {
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    } catch (err) {
      return { res: null, status: 0, message: err instanceof Error ? err.message : 'network error' }
    }
    if (res.ok) return { res, status: res.status, message: '' }
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.message || body?.error) message = String(body.message || body.error)
    } catch { /* non-JSON error body — the status is the message */ }
    return { res: null, status: res.status, message }
  }

  let outcome = await attempt()
  if (!outcome.res && RETRY_STATUSES.has(outcome.status)) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    outcome = await attempt()
  }
  if (!outcome.res) throw new ClassPracticeFetchError(outcome.status, outcome.message)
  const data = await outcome.res.json()
  return {
    practiceByClass: (data?.practiceByClass as Record<string, number>) || {},
    activeDaysByClass: (data?.activeDaysByClass as Record<string, number>) || {},
    classAccountByClass: (data?.classAccountByClass as Record<string, ClassAccountProgress>) || {},
  }
}
