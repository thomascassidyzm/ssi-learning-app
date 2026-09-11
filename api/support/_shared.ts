/**
 * The support channel's server side, shared by the three routes.
 *
 * THE GATE (Tom, 2026-09-10 21:55Z: "the in-app support channel for admins
 * only - not individual teachers"). A caller may use the channel when their
 * OWN resolved scope — resolveVisibleScope, from the verified JWT, never from
 * anything the client claims — says they are a school_admin with a school or
 * a govt_admin with a group. A teacher's scope has no school and no group
 * (see filterActiveScope's docstring in schoolScope.ts), so a teacher is
 * refused here whatever the UI shows. RLS answers "is this my row?"; this is
 * the hierarchy authz the repo keeps in endpoints.
 *
 * THE ENVELOPE (spec §3). What we already know the moment she presses Send,
 * so she never describes her setup and never sends a screenshot. Two halves,
 * kept apart on purpose:
 *   envelope.client  — what her browser SAID: the route, the build, the
 *                      device, the tile she tapped and the value it showed.
 *                      Useful, and never trusted for identity.
 *   envelope.server  — what the server COMPUTES from her scope right now:
 *                      the school row, school_summary's hours and counts, and
 *                      the class-practice figures the tile prefers. The agent
 *                      holding both halves can see the displayed number and
 *                      the computed number disagree without any diagnosis.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveVisibleScope } from '../_utils/schoolScope'
import { loadClassPractice, practisedSince, CLASS_PRACTICE_WINDOW_DAYS } from '../_utils/classPractice'

export type SupportScope =
  | { kind: 'school'; schoolId: string; role: 'school_admin'; learnerId: string | null }
  | { kind: 'group'; groupId: string; schoolIds: string[]; role: 'govt_admin'; learnerId: string | null }

/**
 * Who may open the channel, and on whose behalf. Null = not an admin of
 * anything, and the route answers 403.
 */
export async function resolveSupportScope(svc: SupabaseClient, authUid: string): Promise<SupportScope | null> {
  const scope = await resolveVisibleScope(svc, authUid)
  if (scope.role === 'school_admin' && scope.schoolIds.length === 1) {
    return { kind: 'school', schoolId: scope.schoolIds[0], role: 'school_admin', learnerId: scope.learnerId }
  }
  if (scope.role === 'govt_admin' && scope.groupId) {
    return { kind: 'group', groupId: scope.groupId, schoolIds: scope.schoolIds, role: 'govt_admin', learnerId: scope.learnerId }
  }
  return null
}

export interface SupportThreadRow {
  id: string
  school_id: string | null
  group_id: string | null
  created_at: string
  last_message_at: string | null
  last_read_at: string | null
  language: string | null
  standing_notes: Record<string, unknown>
}

/** The thread for this scope, created on first use (spec §14 item 7). */
export async function getOrCreateThread(svc: SupabaseClient, scope: SupportScope): Promise<SupportThreadRow> {
  const col = scope.kind === 'school' ? 'school_id' : 'group_id'
  const key = scope.kind === 'school' ? scope.schoolId : scope.groupId
  const { data: existing } = await svc.from('support_threads').select('*').eq(col, key).maybeSingle()
  if (existing) return existing as SupportThreadRow
  const { data: created, error } = await svc
    .from('support_threads')
    .insert({ [col]: key })
    .select('*')
    .single()
  if (error || !created) {
    // A concurrent first open may have won the unique index; read it back.
    const { data: again } = await svc.from('support_threads').select('*').eq(col, key).maybeSingle()
    if (again) return again as SupportThreadRow
    throw new Error(error?.message || 'support thread could not be created')
  }
  return created as SupportThreadRow
}

/** The fields the client may contribute, all optional, none about identity. */
export interface ClientEnvelope {
  route?: string
  build_version?: string
  device_info?: { userAgent?: string; screen?: string; language?: string }
  anchor?: string
  displayed_label?: string
  displayed_value?: string
}

const CLIENT_KEYS: Array<keyof ClientEnvelope> = ['route', 'build_version', 'device_info', 'anchor', 'displayed_label', 'displayed_value']

/** Keep only the known client fields, each bounded, so the envelope cannot be used to smuggle. */
export function pickClientEnvelope(body: unknown): ClientEnvelope {
  const out: ClientEnvelope = {}
  if (!body || typeof body !== 'object') return out
  const b = body as Record<string, unknown>
  for (const k of CLIENT_KEYS) {
    const v = b[k]
    if (v == null) continue
    if (k === 'device_info') {
      if (typeof v === 'object') {
        const d = v as Record<string, unknown>
        out.device_info = {
          userAgent: typeof d.userAgent === 'string' ? d.userAgent.slice(0, 400) : undefined,
          screen: typeof d.screen === 'string' ? d.screen.slice(0, 40) : undefined,
          language: typeof d.language === 'string' ? d.language.slice(0, 16) : undefined,
        }
      }
      continue
    }
    if (typeof v === 'string') out[k] = v.slice(0, 300)
  }
  return out
}

export interface ServerEnvelope {
  role: 'school_admin' | 'govt_admin'
  school: {
    id: string
    name: string | null
    region_code: string | null
    platform_status: string | null
    trial_course_code: string | null
    trial_kind: string | null
  } | null
  group: { id: string; school_count: number } | null
  summary: {
    total_practice_hours: number
    staff_practice_hours: number
    student_count: number
    teacher_count: number
    class_count: number
  } | null
  class_practice: {
    window_days: number
    class_count: number
    active_classes: number
    phrases: number
  } | null
  computed_at: string
}

/**
 * The server's own reading of her school, fetched fresh — never carried
 * forward from an earlier message (spec §11: "a cached figure is how you end
 * up telling a head teacher something that was true last Tuesday").
 */
export async function assembleServerEnvelope(svc: SupabaseClient, scope: SupportScope): Promise<ServerEnvelope> {
  const computed_at = new Date().toISOString()
  if (scope.kind === 'group') {
    return {
      role: 'govt_admin',
      school: null,
      group: { id: scope.groupId, school_count: scope.schoolIds.length },
      summary: null,
      class_practice: null,
      computed_at,
    }
  }

  const [{ data: school }, { data: summary }, { data: classes }] = await Promise.all([
    svc.from('schools').select('id, school_name, region_code, platform_status, trial_course_code, trial_kind').eq('id', scope.schoolId).maybeSingle(),
    svc.from('school_summary').select('total_practice_hours, staff_practice_hours, student_count, teacher_count, class_count').eq('school_id', scope.schoolId).maybeSingle(),
    svc.from('classes').select('id, class_learner_id').eq('school_id', scope.schoolId).eq('is_active', true),
  ])

  const classRows = (classes ?? []) as Array<{ id: string; class_learner_id?: string | null }>
  let class_practice: ServerEnvelope['class_practice'] = null
  try {
    const facts = await loadClassPractice(svc, classRows)
    const weekAgo = Date.now() - CLASS_PRACTICE_WINDOW_DAYS * 86400000
    let phrases = 0
    let active = 0
    for (const f of facts.values()) {
      phrases += f.phrases
      if (practisedSince(f, weekAgo)) active += 1
    }
    class_practice = { window_days: CLASS_PRACTICE_WINDOW_DAYS, class_count: classRows.length, active_classes: active, phrases }
  } catch {
    class_practice = null
  }

  const s = school as Record<string, unknown> | null
  const m = summary as Record<string, unknown> | null
  return {
    role: 'school_admin',
    school: s
      ? {
          id: String(s.id),
          name: (s.school_name as string | null) ?? null,
          region_code: (s.region_code as string | null) ?? null,
          platform_status: (s.platform_status as string | null) ?? null,
          trial_course_code: (s.trial_course_code as string | null) ?? null,
          trial_kind: (s.trial_kind as string | null) ?? null,
        }
      : null,
    group: null,
    summary: m
      ? {
          total_practice_hours: Number(m.total_practice_hours) || 0,
          staff_practice_hours: Number(m.staff_practice_hours) || 0,
          student_count: Number(m.student_count) || 0,
          teacher_count: Number(m.teacher_count) || 0,
          class_count: Number(m.class_count) || 0,
        }
      : null,
    class_practice,
    computed_at,
  }
}

/** A message row as the thread view receives it — the envelope stays server-side. */
export interface SupportMessageView {
  id: string
  body: string
  direction: 'in' | 'out'
  author_source: string
  author_name: string | null
  in_reply_to: string | null
  escalated_at: string | null
  escalation_resolved_at: string | null
  answered_at: string | null
  created_at: string
}

export const MESSAGE_VIEW_COLUMNS =
  'id, body, direction, author_source, author_name, in_reply_to, escalated_at, escalation_resolved_at, answered_at, created_at'
