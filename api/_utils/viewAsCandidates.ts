/**
 * View As candidates ranked by the minutes their CLASSES played this week.
 *
 * Tom, 2026-09-14 16:20Z (job #683): the View As picker should land him on
 * "examples with ACTUAL data, not default to a teacher with zero play-as-class
 * minutes". His tour had landed on Mr Williams at Monmouth, whose one class
 * had 0 minutes played as class, so every screen read zero.
 *
 * The number is the play-as-class figure: the class account's own in-app
 * time (classes.class_learner_id, definition in inAppTime.ts) over the last
 * seven days — never the person's own practice_minutes, which is all-time and
 * their own account, exactly the number that would mislead here. A teacher's
 * classes come from class_teachers; a school leader's are every class in the
 * school they administer (schools.admin_user_id). Computed once per request.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { inAppTimeByLearner, secondsToMinutesUp } from './inAppTime'
import { chunk } from './schoolScope'

const CHUNK = 200

export interface CandidateRow {
  /** learners.id — the key of the activity rollup. */
  id?: string
  user_id: string
  educational_role: string | null
  last_active?: string | null
}

export interface ClassMinutes {
  /** Whole minutes, rounded up, of play-as-class across the person's classes in the last seven days. */
  class_minutes_7d: number
  /** Their school's name, for the picker line. */
  school_name: string | null
}

/**
 * Pure: the ranking the picker relies on. Most class minutes first; ties by
 * most recent own activity.
 *
 * Job #693: the caller ranks BEFORE the page's activity rollup exists, so the
 * tie-break used to compare empty strings. `lastActiveByLearnerId` is that
 * rollup (learners.id → last practised), read for the whole candidate set and
 * consulted here; a row's own `last_active` still counts when it carries one.
 */
export function rankByClassMinutes<T extends CandidateRow>(
  rows: T[],
  minutes: Map<string, ClassMinutes>,
  lastActiveByLearnerId?: Map<string, { last_active: string | null }>,
): (T & ClassMinutes)[] {
  return rows
    .map((r) => ({
      ...r,
      last_active: r.last_active ?? (r.id ? lastActiveByLearnerId?.get(r.id)?.last_active ?? null : null),
      class_minutes_7d: minutes.get(r.user_id)?.class_minutes_7d ?? 0,
      school_name: minutes.get(r.user_id)?.school_name ?? null,
    }))
    .sort((a, b) => (b.class_minutes_7d - a.class_minutes_7d) || String(b.last_active || '').localeCompare(String(a.last_active || '')))
}

/** Seven-day play-as-class minutes per candidate user_id, for teachers and school leaders. Others map to 0. */
export async function loadClassMinutes7d(svc: SupabaseClient, rows: CandidateRow[]): Promise<Map<string, ClassMinutes>> {
  const out = new Map<string, ClassMinutes>()
  const teacherIds = rows.filter((r) => r.educational_role === 'teacher').map((r) => r.user_id)
  const adminIds = rows.filter((r) => r.educational_role === 'school_admin').map((r) => r.user_id)
  if (teacherIds.length === 0 && adminIds.length === 0) return out

  const classIdsByUser = new Map<string, Set<string>>()
  const schoolIdByUser = new Map<string, string>()
  const add = (u: string, c: string) => { if (!classIdsByUser.has(u)) classIdsByUser.set(u, new Set()); classIdsByUser.get(u)!.add(c) }

  // Teachers: their classes via class_teachers.
  for (const ids of chunk(teacherIds, CHUNK)) {
    const { data } = await svc.from('class_teachers').select('class_id, teacher_user_id').in('teacher_user_id', ids)
    for (const r of (data || []) as any[]) add(r.teacher_user_id, r.class_id)
  }
  // Leaders: every class in the school they administer.
  const schoolNameById = new Map<string, string>()
  const adminBySchool = new Map<string, string[]>()
  for (const ids of chunk(adminIds, CHUNK)) {
    const { data } = await svc.from('schools').select('id, school_name, admin_user_id').in('admin_user_id', ids)
    for (const s of (data || []) as any[]) {
      schoolNameById.set(s.id, s.school_name)
      schoolIdByUser.set(s.admin_user_id, s.id)
      adminBySchool.set(s.id, [...(adminBySchool.get(s.id) || []), s.admin_user_id])
    }
  }
  const classRows: { id: string; school_id: string | null; class_learner_id: string | null }[] = []
  for (const ids of chunk([...adminBySchool.keys()], CHUNK)) {
    const { data } = await svc.from('classes').select('id, school_id, class_learner_id').in('school_id', ids)
    for (const c of (data || []) as any[]) { classRows.push(c); for (const u of adminBySchool.get(c.school_id) || []) add(u, c.id) }
  }
  // Teachers' classes: the rows we do not have yet (school, class account).
  const known = new Set(classRows.map((c) => c.id))
  const teacherClassIds = [...new Set([...teacherIds.flatMap((u) => [...(classIdsByUser.get(u) || [])])])].filter((c) => !known.has(c))
  for (const ids of chunk(teacherClassIds, CHUNK)) {
    const { data } = await svc.from('classes').select('id, school_id, class_learner_id').in('id', ids)
    for (const c of (data || []) as any[]) classRows.push(c)
  }
  const classById = new Map(classRows.map((c) => [c.id, c]))
  const missingSchools = [...new Set(classRows.map((c) => c.school_id).filter((s): s is string => !!s && !schoolNameById.has(s)))]
  for (const ids of chunk(missingSchools, CHUNK)) {
    const { data } = await svc.from('schools').select('id, school_name').in('id', ids)
    for (const s of (data || []) as any[]) schoolNameById.set(s.id, s.school_name)
  }
  for (const u of teacherIds) {
    const first = [...(classIdsByUser.get(u) || [])].map((c) => classById.get(c)?.school_id).find((s) => !!s)
    if (first) schoolIdByUser.set(u, first)
  }

  // ONE diary read for every class account, then a sum per person.
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const classLearnerIds = [...new Set(classRows.map((c) => c.class_learner_id).filter((x): x is string => !!x))]
  const inApp = classLearnerIds.length ? await inAppTimeByLearner(svc, classLearnerIds, since) : new Map<string, { seconds: number }>()

  for (const u of [...teacherIds, ...adminIds]) {
    let seconds = 0
    for (const c of classIdsByUser.get(u) || []) {
      const lid = classById.get(c)?.class_learner_id
      if (lid) seconds += inApp.get(lid)?.seconds || 0
    }
    const sid = schoolIdByUser.get(u)
    out.set(u, { class_minutes_7d: secondsToMinutesUp(seconds), school_name: sid ? (schoolNameById.get(sid) ?? null) : null })
  }
  return out
}
