/**
 * The learner's sector threads — GET/POST /api/me/threads
 *
 * ONE OWNERSHIP LEDGER, TWO SCHEDULERS. This endpoint owns the SCHEDULING half
 * for the sector thread: where that thread's cursor is, and nothing else.
 * Per-thread state is EXACTLY cursor, ceiling, cycle index and pod ratchet —
 * `enrollment_threads` carries no ownership and no review state, because
 * spaced repetition in the live player is positional within each script, so a
 * paused thread resumes intact.
 *
 * GET  ?course=<baseCourseCode> -> { enrollmentId, threads: SectorThread[] }
 * POST { course, sectorCourseCode, role?, active? } -> the row
 *
 * `enrollment_threads` is service-role-only (RLS on, no policies,
 * anon/authenticated revoked), so the browser can never read or write it
 * directly — every access is this endpoint, holding the service key, scoped to
 * the caller's OWN auth uid. A caller-supplied learner id is never accepted.
 *
 * ONE SECTOR THREAD IS ACTIVE AT A TIME. Choosing a walk parks any other
 * active row for that enrolment (active=false, state intact). PARKING IS NEVER
 * DESTRUCTIVE and never deletes: toggle it back on and the cursor is exactly
 * where it was.
 *
 * A client can never mint an arbitrary thread — `sectorCourseCode` must be
 * registered in `course_sectors` under that base course, or 400. Writes are
 * LOUD: a PostgREST error is an error the caller sees, never a silent no-op
 * behind a cheerful 200.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export interface SectorThread {
  sectorCourseCode: string
  role: string
  active: boolean
  lastCompletedRoundIndex: number | null
  currentCycleIndex: number
  highestCompletedRoundIndex: number | null
  highestCompletedLegoId: string | null
  completedPodRounds: number
  podActivationRound: number | null
}

const THREAD_COLUMNS =
  'sector_course_code, role, active, last_completed_round_index, current_cycle_index, ' +
  'highest_completed_round_index, highest_completed_lego_id, completed_pod_rounds, pod_activation_round'

/** snake_case lives inside this file; the wire is camelCase. */
export function toSectorThread(row: any): SectorThread {
  return {
    sectorCourseCode: row.sector_course_code,
    role: row.role ?? 'general',
    active: row.active !== false,
    lastCompletedRoundIndex: row.last_completed_round_index ?? null,
    currentCycleIndex: row.current_cycle_index ?? 0,
    highestCompletedRoundIndex: row.highest_completed_round_index ?? null,
    highestCompletedLegoId: row.highest_completed_lego_id ?? null,
    completedPodRounds: row.completed_pod_rounds ?? 0,
    podActivationRound: row.pod_activation_round ?? null,
  }
}

async function resolveLearnerId(supabase: SupabaseClient, authUid: string): Promise<string | null> {
  const { data } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', authUid)
    .maybeSingle()
  return (data as any)?.id ?? null
}

async function findEnrollmentId(
  supabase: SupabaseClient,
  learnerId: string,
  courseCode: string
): Promise<string | null> {
  const { data } = await supabase
    .from('course_enrollments')
    .select('id')
    .eq('learner_id', learnerId)
    .eq('course_id', courseCode)
    .maybeSingle()
  return (data as any)?.id ?? null
}

async function handleGet(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  learnerId: string
): Promise<void> {
  const raw = req.query.course
  const courseCode = (Array.isArray(raw) ? raw[0] : raw || '').trim()
  if (!courseCode) {
    res.status(400).json({ error: 'Missing course' })
    return
  }

  const enrollmentId = await findEnrollmentId(supabase, learnerId, courseCode)
  if (!enrollmentId) {
    // Not enrolled yet is not an error — no walk has been chosen, so there is
    // nothing to schedule.
    res.status(200).json({ enrollmentId: null, threads: [] })
    return
  }

  const { data, error } = await supabase
    .from('enrollment_threads')
    .select(THREAD_COLUMNS)
    .eq('enrollment_id', enrollmentId)
    .order('sector_course_code')

  if (error) {
    console.error('[me/threads] Read failed:', error)
    res.status(500).json({ error: error.message })
    return
  }

  res.status(200).json({ enrollmentId, threads: (data ?? []).map(toSectorThread) })
}

async function handlePost(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  learnerId: string
): Promise<void> {
  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {}
  const courseCode = typeof body.course === 'string' ? body.course.trim() : ''
  const sectorCourseCode = typeof body.sectorCourseCode === 'string' ? body.sectorCourseCode.trim() : ''
  const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : 'general'
  const active = body.active === undefined ? true : body.active === true

  if (!courseCode || !sectorCourseCode) {
    res.status(400).json({ error: 'course and sectorCourseCode are required' })
    return
  }

  // A client may never mint an arbitrary thread: the segment has to be a
  // registered one under THIS base course.
  const { data: registration, error: registryError } = await supabase
    .from('course_sectors')
    .select('sector_course_code, roles')
    .eq('base_course_code', courseCode)
    .eq('sector_course_code', sectorCourseCode)
    .maybeSingle()

  if (registryError) {
    console.error('[me/threads] Registry check failed:', registryError)
    res.status(500).json({ error: registryError.message })
    return
  }
  if (!registration) {
    res.status(400).json({ error: 'Unknown sector for this course' })
    return
  }

  // The enrolment is the thread's parent row. A learner choosing a walk in a
  // course they are demonstrably playing may not have an enrolment row yet
  // (self-serve paths write it lazily), so create it — scoped to their OWN
  // learner id, and only ever for a base course that HAS a registered segment.
  let enrollmentId = await findEnrollmentId(supabase, learnerId, courseCode)
  if (!enrollmentId) {
    const { error: enrolError } = await supabase
      .from('course_enrollments')
      .upsert(
        { learner_id: learnerId, course_id: courseCode },
        { onConflict: 'learner_id,course_id', ignoreDuplicates: true }
      )
    if (enrolError) {
      console.error('[me/threads] Enrolment write failed:', enrolError)
      res.status(500).json({ error: enrolError.message })
      return
    }
    enrollmentId = await findEnrollmentId(supabase, learnerId, courseCode)
  }
  if (!enrollmentId) {
    res.status(500).json({ error: 'Could not resolve enrolment' })
    return
  }

  // ONE ACTIVE WALK. Park every other active row for this enrolment first —
  // state intact, nothing deleted.
  if (active) {
    const { error: parkError } = await supabase
      .from('enrollment_threads')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('enrollment_id', enrollmentId)
      .eq('active', true)
      .neq('sector_course_code', sectorCourseCode)
    if (parkError) {
      console.error('[me/threads] Park failed:', parkError)
      res.status(500).json({ error: parkError.message })
      return
    }
  }

  const { data, error } = await supabase
    .from('enrollment_threads')
    .upsert(
      {
        enrollment_id: enrollmentId,
        sector_course_code: sectorCourseCode,
        role,
        active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'enrollment_id,sector_course_code' }
    )
    .select(THREAD_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[me/threads] Write failed:', error)
    res.status(500).json({ error: error.message })
    return
  }
  if (!data) {
    res.status(500).json({ error: 'Thread write returned no row' })
    return
  }

  res.status(200).json({ enrollmentId, thread: toSectorThread(data) })
}

function safeParse(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const learnerId = await resolveLearnerId(supabase, authResult.userId)
    if (!learnerId) {
      if (req.method === 'GET') {
        res.status(200).json({ enrollmentId: null, threads: [] })
      } else {
        res.status(404).json({ error: 'No learner record' })
      }
      return
    }

    if (req.method === 'GET') {
      await handleGet(req, res, supabase, learnerId)
    } else {
      await handlePost(req, res, supabase, learnerId)
    }
  } catch (error: any) {
    console.error('[me/threads] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
