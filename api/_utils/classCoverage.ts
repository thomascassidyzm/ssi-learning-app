/**
 * Class-coverage entitlement — the FINAL student-entitlement model
 * (docs/schools/group-commercial-model.md, "Student entitlement — FINAL
 * model", 2026-07-15): a class-affiliated student gets their class's course
 * in full for exactly as long as that class's school has live platform
 * coverage (trial or paid) — no student-level clock, no student-level state,
 * recomputed on every check.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatformActive } from './platformStatus'
import { chunk } from './schoolScope'

/**
 * Resolve the course codes a student is entitled to via live class
 * affiliation. `authUid` MUST come from a verified JWT.
 *
 * For every class the caller is tagged into as a student
 * (user_tags: tag_type='class', role_in_context='student'), resolve the
 * class's school and grant the class's course_code iff that school's
 * platform_status/platform_expires_at is currently active (see
 * isPlatformActive). A school row that can't be found grants nothing — this
 * fails open only on the same axis api/school/subscription.ts does (a null/
 * absent platform_status on a resolvable school), never on a missing school.
 */
export async function resolveClassCourseCoverage(
  svc: SupabaseClient,
  authUid: string,
): Promise<string[]> {
  const { data: tags } = await svc
    .from('user_tags')
    .select('tag_value')
    .eq('user_id', authUid)
    .eq('tag_type', 'class')
    .eq('role_in_context', 'student')
    .is('removed_at', null)

  const classIds = [
    ...new Set(
      (tags ?? [])
        .map((t: any) => (t?.tag_value ? String(t.tag_value).replace('CLASS:', '') : null))
        .filter((id: string | null): id is string => !!id),
    ),
  ]
  if (classIds.length === 0) return []

  const classRows: { id: string; school_id: string | null; course_code: string | null }[] = []
  for (const batch of chunk(classIds)) {
    const { data } = await svc.from('classes').select('id, school_id, course_code').in('id', batch)
    for (const c of data ?? []) classRows.push(c as any)
  }

  const schoolIds = [...new Set(classRows.map((c) => c.school_id).filter((id): id is string => !!id))]
  if (schoolIds.length === 0) return []

  const schoolStatus = new Map<string, { platform_status: string | null; platform_expires_at: string | null }>()
  for (const batch of chunk(schoolIds)) {
    const { data } = await svc.from('schools').select('id, platform_status, platform_expires_at').in('id', batch)
    for (const s of data ?? []) schoolStatus.set((s as any).id, s as any)
  }

  const courses = new Set<string>()
  for (const c of classRows) {
    if (!c.school_id || !c.course_code) continue
    const school = schoolStatus.get(c.school_id)
    if (!school) continue
    if (isPlatformActive(school.platform_status, school.platform_expires_at)) {
      courses.add(c.course_code)
    }
  }
  return [...courses]
}
