/**
 * Class Progress API — POST /api/school/class-progress
 *
 * Server-mediated write path for play-as-class (owner ruling 2026-07-16: a
 * class is a first-class learner — own uuid, own course_enrollments row —
 * and play-as-class plays AS THAT ENTITY, not as the driving staff member).
 *
 * WHY this can't be a direct client write: course_enrollments has RLS enabled
 * (own-row only, via current_learner_id() = the CALLER's own learners row).
 * A staff member's auth uid never resolves to the class's learner id, so a
 * browser write targeting the class's row is rejected by design — and per
 * standing RLS doctrine (CLAUDE.md), the fix is a server-mediated endpoint
 * with its own authz check, never a "clever" hierarchy-aware RLS policy.
 *
 * Authorization: verifyAuthToken, then resolveVisibleScope must place classId
 * in the caller's classIds AND the caller's role must be teacher or
 * school_admin (govt_admin is excluded from play-as-class by design — see
 * usePlayAsClass.ts / docs/schools/group-commercial-model.md).
 *
 * This mirrors the @ssi/core ProgressStore methods actually invoked during
 * play (same forward-only guards, same semantics) so a class's progress
 * behaves identically to a human learner's — it's just re-implemented inline
 * here (rather than imported from @ssi/core) because no other api/*.ts
 * endpoint pulls in the core package at runtime; keeping this endpoint
 * self-contained matches the rest of the API surface.
 *
 * Body: { classId, method, args } — args EXCLUDE learnerId and courseId;
 * both are resolved server-side from the class row (classes.class_learner_id
 * / classes.course_code) so a caller can never target an arbitrary learner
 * or course. `actor_user_id` (the driving staff member) is logged for audit.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope } from '../_utils/schoolScope'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const ALLOWED_METHODS = [
  'getEnrollment',
  'createEnrollment',
  'setEnrollmentCursor',
  'setLivePosition',
  'setMode',
  'bumpInfplayRound',
  'updateCurrentCycle',
  'updateEnrollmentActivity',
  'getLegoProgressById',
  'saveLegoProgress',
  'updateLegoProgress',
  'startSession',
  'checkpointSession',
  'endSession',
] as const
type Method = typeof ALLOWED_METHODS[number]

interface ClassProgressBody {
  classId?: string
  method?: string
  args?: unknown[]
}

async function getEnrollment(svc: SupabaseClient, learnerId: string, courseId: string) {
  const { data, error } = await svc
    .from('course_enrollments')
    .select('*')
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`getEnrollment failed: ${error.message}`)
  }
  return data
}

async function createEnrollment(svc: SupabaseClient, learnerId: string, courseId: string) {
  const now = new Date().toISOString()
  const initialHelixState = {
    active_thread: 1,
    threads: {
      1: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
      2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
      3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
    },
    injected_content: {},
  }
  const { data, error } = await svc
    .from('course_enrollments')
    .insert({
      learner_id: learnerId,
      course_id: courseId,
      enrolled_at: now,
      last_practiced_at: null,
      total_practice_minutes: 0,
      helix_state: initialHelixState,
      last_completed_lego_id: null,
      last_completed_round_index: null,
    })
    .select()
    .single()
  if (error) throw new Error(`createEnrollment failed: ${error.message}`)
  return data
}

async function updateEnrollmentActivity(svc: SupabaseClient, learnerId: string, courseId: string, highestSeed: number, practiceMinutes: number) {
  const { data: enrollment, error: readErr } = await svc
    .from('course_enrollments')
    .select('highest_completed_seed, total_practice_minutes')
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
    .single()
  if (readErr && readErr.code !== 'PGRST116') {
    console.warn(`[ClassProgress] Skipping enrollment activity update (read failed): ${readErr.message}`)
    return
  }
  const currentHighest = (enrollment as any)?.highest_completed_seed || 0
  const currentMinutes = (enrollment as any)?.total_practice_minutes || 0
  const { error } = await svc
    .from('course_enrollments')
    .update({
      highest_completed_seed: Math.max(currentHighest, highestSeed),
      total_practice_minutes: currentMinutes + practiceMinutes,
      last_practiced_at: new Date().toISOString(),
    })
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
  if (error) console.warn(`[ClassProgress] Failed to update enrollment activity: ${error.message}`)
}

async function getLegoProgressById(svc: SupabaseClient, learnerId: string, legoId: string, courseId: string) {
  const { data, error } = await svc
    .from('lego_progress')
    .select('*')
    .eq('learner_id', learnerId)
    .eq('lego_id', legoId)
    .eq('course_id', courseId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`getLegoProgressById failed: ${error.message}`)
  }
  return data
}

// `progress.learner_id`/`course_id` from the client are IGNORED — always
// overwritten with the server-resolved class learner id / course, exactly
// like every other method here, so a caller can never write another
// learner's row via a spoofed payload field.
async function saveLegoProgress(svc: SupabaseClient, learnerId: string, courseId: string, progress: Record<string, any>) {
  const now = new Date().toISOString()
  const { data, error } = await svc
    .from('lego_progress')
    .insert({
      learner_id: learnerId,
      lego_id: progress.lego_id,
      course_id: courseId,
      thread_id: progress.thread_id,
      fibonacci_position: progress.fibonacci_position,
      skip_number: progress.skip_number,
      reps_completed: progress.reps_completed,
      is_retired: progress.is_retired,
      last_practiced_at: progress.last_practiced_at ?? null,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()
  if (error) throw new Error(`saveLegoProgress failed: ${error.message}`)
  return data
}

// Authorization for updateLegoProgress needs an extra hop: the client only
// has a row id (no learnerId/courseId in the call signature), so verify the
// row actually belongs to the resolved class learner before writing it.
async function updateLegoProgress(svc: SupabaseClient, learnerId: string, id: string, updates: Record<string, any>) {
  const { data: row, error: readErr } = await svc
    .from('lego_progress')
    .select('learner_id')
    .eq('id', id)
    .maybeSingle()
  if (readErr) throw new Error(`updateLegoProgress read failed: ${readErr.message}`)
  if (!row || (row as any).learner_id !== learnerId) {
    throw new Error('updateLegoProgress: row does not belong to this class')
  }
  const { error } = await svc
    .from('lego_progress')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`updateLegoProgress failed: ${error.message}`)
}

async function setEnrollmentCursor(svc: SupabaseClient, learnerId: string, courseId: string, legoId: string, roundIndex: number) {
  const { error } = await svc
    .from('course_enrollments')
    .update({
      last_completed_lego_id: legoId,
      last_completed_round_index: roundIndex,
      current_cycle_index: 0,
      last_practiced_at: new Date().toISOString(),
    })
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
  if (error) throw new Error(`setEnrollmentCursor failed: ${error.message}`)
}

async function setLivePosition(
  svc: SupabaseClient, learnerId: string, courseId: string,
  legoId: string, roundIndex: number, cycleIndex: number, opts?: { touchPracticedAt?: boolean },
) {
  const updateData: Record<string, unknown> = {
    last_completed_lego_id: legoId,
    last_completed_round_index: roundIndex,
    current_cycle_index: cycleIndex,
  }
  if (opts?.touchPracticedAt !== false) updateData.last_practiced_at = new Date().toISOString()
  const { error } = await svc
    .from('course_enrollments')
    .update(updateData)
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
    .or(`last_completed_round_index.is.null,last_completed_round_index.lte.${roundIndex}`)
  if (error) throw new Error(`setLivePosition failed: ${error.message}`)
}

async function setMode(
  svc: SupabaseClient, learnerId: string, courseId: string,
  mode: 'main' | 'infplay', ratchetHighestTo?: { legoId: string; roundIndex: number },
) {
  const { error } = await svc
    .from('course_enrollments')
    .update({ current_mode: mode, last_practiced_at: new Date().toISOString() })
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
  if (error) throw new Error(`setMode failed: ${error.message}`)

  if (mode === 'infplay') {
    const { error: initErr } = await svc
      .from('course_enrollments')
      .update({ infplay_round_index: 1 })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId)
      .or('infplay_round_index.is.null,infplay_round_index.eq.0')
    if (initErr) throw new Error(`setMode infplay init failed: ${initErr.message}`)

    if (ratchetHighestTo) {
      const { error: rErr } = await svc
        .from('course_enrollments')
        .update({ last_completed_lego_id: ratchetHighestTo.legoId })
        .eq('learner_id', learnerId)
        .eq('course_id', courseId)
        .or(`last_completed_lego_id.is.null,last_completed_lego_id.lt.${ratchetHighestTo.legoId}`)
      if (rErr) throw new Error(`setMode ratchet failed: ${rErr.message}`)
    }
  }
}

async function bumpInfplayRound(svc: SupabaseClient, learnerId: string, courseId: string) {
  const { data, error: readErr } = await svc
    .from('course_enrollments')
    .select('current_mode, infplay_round_index')
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
    .single()
  if (readErr) throw new Error(`bumpInfplayRound read failed: ${readErr.message}`)
  if (!data || data.current_mode !== 'infplay') return
  const next = ((data.infplay_round_index as number) ?? 0) + 1
  const { error } = await svc
    .from('course_enrollments')
    .update({ infplay_round_index: next })
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
  if (error) throw new Error(`bumpInfplayRound write failed: ${error.message}`)
}

async function updateCurrentCycle(svc: SupabaseClient, learnerId: string, courseId: string, cycleIndex: number) {
  const { error } = await svc
    .from('course_enrollments')
    .update({ current_cycle_index: cycleIndex, last_practiced_at: new Date().toISOString() })
    .eq('learner_id', learnerId)
    .eq('course_id', courseId)
  if (error) throw new Error(`updateCurrentCycle failed: ${error.message}`)
}

// Practice-hours spine (LANE A, docs/the-view/play-as-class-REPORT.md §1.2):
// the direct browser `sessions` insert in class mode is rejected by RLS
// (sessions_own_insert requires learner_id = current_learner_id(), which
// resolves to the STAFF row, never the class's) — so real class practice
// wrote zero `sessions` rows. Mirrors @ssi/core SessionStore's
// startSession/checkpointSession/endSession, server-mediated exactly like
// every other method in this file.
async function startSession(svc: SupabaseClient, learnerId: string, courseId: string) {
  const now = new Date().toISOString()
  const { data, error } = await svc
    .from('sessions')
    .insert({
      learner_id: learnerId,
      course_id: courseId,
      started_at: now,
      ended_at: null,
      duration_seconds: 0,
      items_practiced: 0,
      spikes_detected: 0,
      final_rolling_average: 0,
    })
    .select()
    .single()
  if (error) throw new Error(`startSession failed: ${error.message}`)
  return data
}

// checkpointSession/endSession only receive a bare sessionId from the
// client (no learnerId), so verify the row actually belongs to the
// resolved class learner before writing it — same extra-hop pattern as
// updateLegoProgress above.
async function assertSessionOwnedByClass(svc: SupabaseClient, learnerId: string, sessionId: string) {
  const { data: row, error } = await svc
    .from('sessions')
    .select('learner_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw new Error(`session ownership check failed: ${error.message}`)
  if (!row || (row as any).learner_id !== learnerId) {
    throw new Error('session does not belong to this class')
  }
}

async function checkpointSession(svc: SupabaseClient, learnerId: string, sessionId: string, itemsPracticed: number, durationSeconds: number) {
  await assertSessionOwnedByClass(svc, learnerId, sessionId)
  const { error } = await svc
    .from('sessions')
    .update({
      items_practiced: itemsPracticed,
      duration_seconds: durationSeconds,
      ended_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
  if (error) throw new Error(`checkpointSession failed: ${error.message}`)
}

async function endSession(svc: SupabaseClient, learnerId: string, sessionId: string, itemsPracticed: number, durationSeconds: number) {
  await assertSessionOwnedByClass(svc, learnerId, sessionId)
  const { data, error } = await svc
    .from('sessions')
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      items_practiced: itemsPracticed,
    })
    .eq('id', sessionId)
    .select()
    .single()
  if (error) throw new Error(`endSession failed: ${error.message}`)
  return data
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const { classId, method, args } = (req.body || {}) as ClassProgressBody
  if (!classId || typeof classId !== 'string') {
    res.status(400).json({ error: 'classId is required' })
    return
  }
  if (!method || !ALLOWED_METHODS.includes(method as Method)) {
    res.status(400).json({ error: 'Invalid method' })
    return
  }
  // Positional args forwarded to the per-method handlers. Client-supplied and
  // untyped by design (the method handlers own their own coercion); typed as
  // any[] to match the existing runtime trust model rather than narrowing each
  // call site. (Input validation of these is a separate concern, not this pass.)
  const a: any[] = Array.isArray(args) ? args : []

  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Authorization: staff (teacher/school_admin only — govt_admin excluded
    // from play-as-class by design) with this class in their visible scope.
    const scope = await resolveVisibleScope(svc, auth.userId)
    if (scope.role !== 'teacher' && scope.role !== 'school_admin') {
      res.status(403).json({ error: 'Not authorized to write class progress' })
      return
    }
    if (!scope.classIds.includes(classId)) {
      res.status(403).json({ error: 'Class not in caller scope' })
      return
    }

    const { data: cls, error: clsErr } = await svc
      .from('classes')
      .select('class_learner_id, course_code')
      .eq('id', classId)
      .maybeSingle()
    if (clsErr || !cls) {
      res.status(404).json({ error: 'Class not found' })
      return
    }
    const learnerId = (cls as any).class_learner_id as string | null
    const courseId = (cls as any).course_code as string
    if (!learnerId) {
      res.status(409).json({ error: 'Class has no learner entity yet' })
      return
    }

    console.log('[ClassProgress]', method, 'class', classId, 'actor', auth.userId)

    let result: unknown = null
    switch (method as Method) {
      case 'getEnrollment':
        result = await getEnrollment(svc, learnerId, courseId)
        break
      case 'createEnrollment':
        result = await createEnrollment(svc, learnerId, courseId)
        break
      case 'setEnrollmentCursor':
        await setEnrollmentCursor(svc, learnerId, courseId, a[0], a[1])
        break
      case 'setLivePosition':
        await setLivePosition(svc, learnerId, courseId, a[0], a[1], a[2], a[3])
        break
      case 'setMode':
        await setMode(svc, learnerId, courseId, a[0], a[1])
        break
      case 'bumpInfplayRound':
        await bumpInfplayRound(svc, learnerId, courseId)
        break
      case 'updateCurrentCycle':
        await updateCurrentCycle(svc, learnerId, courseId, a[0])
        break
      case 'updateEnrollmentActivity':
        await updateEnrollmentActivity(svc, learnerId, courseId, a[0], a[1])
        break
      case 'getLegoProgressById':
        result = await getLegoProgressById(svc, learnerId, a[0], courseId)
        break
      case 'saveLegoProgress':
        result = await saveLegoProgress(svc, learnerId, courseId, a[0])
        break
      case 'updateLegoProgress':
        await updateLegoProgress(svc, learnerId, a[0], a[1])
        break
      case 'startSession':
        result = await startSession(svc, learnerId, courseId)
        break
      case 'checkpointSession':
        await checkpointSession(svc, learnerId, a[0], a[1], a[2])
        break
      case 'endSession':
        result = await endSession(svc, learnerId, a[0], a[1], a[2])
        break
    }

    res.status(200).json({ result })
  } catch (err: any) {
    console.error('[ClassProgress] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
