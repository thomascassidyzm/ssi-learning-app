/**
 * Class-coverage entitlement — the FINAL student-entitlement model
 * (archive/docs-retired-2026-08-24/schools/group-commercial-model.md, "Student entitlement — FINAL
 * model", 2026-07-15): a class-affiliated student gets their class's course
 * in full for exactly as long as that class's school has live platform
 * coverage (trial or paid) — no student-level clock, no student-level state,
 * recomputed on every check.
 *
 * TEACHERS TOO (founder report 2026-09-09, Chepstow): the tag filter read
 * role_in_context='student' only, so a teacher tagged into the very class she
 * runs got NOTHING — her students played the school's trialled course in full
 * while she sat on DEFAULT access, previewing her own course to seed 19. A
 * school pays per TEACHER; the staff of a covered school are the last people
 * who should be locked out of it. Same clock, same derivation, no new state.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatformActive } from './platformStatus'
import { chunk } from './schoolScope'

export interface ClassCoverage {
  courses: string[]
  /**
   * The covering school's own `platform_expires_at` — never a window minted
   * for this person. Where several classes contribute, this is the EARLIEST
   * boundary among the schools that actually contributed a course: the next
   * moment at which this answer changes.
   *
   * Null means no contributing school records an expiry at all (the bare
   * `platform_status` DEFAULT that isPlatformActive fails open on).
   *
   * Added 2026-09-09 for the offline lease: online play recomputes this every
   * check, so an open-ended answer costs nothing there, but a DOWNLOAD is
   * carried away from the check and must not outlive the cover that granted
   * it. Same convention as schoolCoverage.ts's SchoolStaffCoverage.
   */
  expiresAt: string | null
}

/**
 * Resolve the course codes a class member is entitled to via live class
 * affiliation, and the window that cover runs to. `authUid` MUST come from a
 * verified JWT.
 *
 * For every class the caller is tagged into as a student OR AS ITS TEACHER
 * (user_tags: tag_type='class', role_in_context in ('student','teacher')),
 * resolve the class's school and grant the class's course_code iff that
 * school's platform_status/platform_expires_at is currently active (see
 * isPlatformActive). A school row that can't be found grants nothing — this
 * fails open only on the same axis api/school/subscription.ts does (a null/
 * absent platform_status on a resolvable school), never on a missing school.
 */
const NOTHING: ClassCoverage = { courses: [], expiresAt: null }

export async function resolveClassCourseCoverage(
  svc: SupabaseClient,
  authUid: string,
): Promise<ClassCoverage> {
  const { data: tags } = await svc
    .from('user_tags')
    .select('tag_value')
    .eq('user_id', authUid)
    .eq('tag_type', 'class')
    .in('role_in_context', ['student', 'teacher'])
    .is('removed_at', null)

  const classIds = [
    ...new Set(
      (tags ?? [])
        .map((t: any) => (t?.tag_value ? String(t.tag_value).replace('CLASS:', '') : null))
        .filter((id: string | null): id is string => !!id),
    ),
  ]
  if (classIds.length === 0) return NOTHING

  const classRows: { id: string; school_id: string | null; course_code: string | null }[] = []
  for (const batch of chunk(classIds)) {
    const { data } = await svc.from('classes').select('id, school_id, course_code').in('id', batch)
    for (const c of data ?? []) classRows.push(c as any)
  }

  const schoolIds = [...new Set(classRows.map((c) => c.school_id).filter((id): id is string => !!id))]
  if (schoolIds.length === 0) return NOTHING

  const schoolStatus = new Map<
    string,
    { platform_status: string | null; platform_expires_at: string | null; created_at: string | null }
  >()
  for (const batch of chunk(schoolIds)) {
    const { data } = await svc
      .from('schools')
      .select('id, platform_status, platform_expires_at, created_at')
      .in('id', batch)
    for (const s of data ?? []) schoolStatus.set((s as any).id, s as any)
  }

  const courses = new Set<string>()
  // Only a school that actually CONTRIBUTES a course gets a say in the window.
  let expiresAt: string | null = null
  for (const c of classRows) {
    if (!c.school_id || !c.course_code) continue
    const school = schoolStatus.get(c.school_id)
    if (!school) continue
    if (isPlatformActive(school.platform_status, school.platform_expires_at, school.created_at)) {
      courses.add(c.course_code)
      const exp = school.platform_expires_at
      if (exp && (!expiresAt || new Date(exp) < new Date(expiresAt))) expiresAt = exp
    }
  }
  if (courses.size === 0) return NOTHING
  return { courses: [...courses], expiresAt }
}
