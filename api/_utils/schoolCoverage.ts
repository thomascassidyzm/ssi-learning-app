/**
 * School-STAFF coverage — a school's own staff get, in their own learner
 * account, exactly the courses their school has cover for.
 *
 * Founder ruling, 2026-09-09, verbatim: "all admins and all teachers should
 * have their OWN learner account with full priveleges - well, the SAME full
 * privileges on a course by course basis to match the school".
 *
 * WHY THIS EXISTS, on top of classCoverage.ts. Class coverage keys on being
 * TAGGED INTO A CLASS. A school admin who runs the place and never teaches a
 * class, and a teacher between classes, match nothing — 38 of the 163 staff
 * accounts on the live database (2026-09-09) resolved to NOTHING while their
 * own school sat on live cover and their students played its course in full.
 * Access must key on SCHOOL MEMBERSHIP, not on happening to hold a class.
 *
 * DERIVED, NOT STORED. School signup deliberately mints no entitlement row,
 * because a stored school grant cascades to that school's STUDENTS as free
 * play. This layer keeps that property: it is recomputed on every check from
 * the school's own row, so it can never be stale and can never cascade — the
 * staff filter (teacher/admin) is applied at read time, every time.
 *
 * COURSE FOR COURSE, never blanket premium. What a school "has cover for" is
 * the settled commercial model, the same precedence the class-creation
 * catalogue uses (useSchoolCourseCatalogue.ts):
 *
 *   1. paid (platform_status 'active')  → the whole live catalogue; a
 *      subscribed school is not language-locked.
 *   2. trial with a recorded course     → exactly that one course.
 *   3. trial with NO recorded course    → the courses of that school's own
 *      CLASSES, and nothing else.
 *
 * THE WINDOW IS THE SCHOOL'S TOO (founder ruling, 2026-09-09): "This should
 * match the trial for the school. 365 days OR 30 days depending on which
 * language they are trialling." So this layer carries the school's OWN
 * `platform_expires_at` as its expiry — 365 or 30 days is already decided,
 * once, by trialPolicy.ts when the school's trial was stamped, and nothing
 * here recomputes it. No per-person window is calculated and no per-person
 * expiry is ever written: when the school's window lapses, every member of its
 * staff stops resolving in the same instant, off the same row, with no write
 * anywhere.
 *
 * Case 3 is where this deliberately departs from the class-creation
 * catalogue, which reads a null `trial_course_code` as "no restriction" and
 * offers the full catalogue. Offering 79 languages in a dropdown is harmless;
 * GRANTING 79 languages to a school that has cover for two is exactly the
 * blanket premium the ruling rules out. On the live database that difference
 * is real: 10 of the 42 schools carry a null trial_course_code, and eight of
 * them have staff who would otherwise have been handed the entire catalogue.
 * A school with no recorded course AND no class confers nothing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatformActive } from './platformStatus'
import { chunk } from './schoolScope'
import { SCHOOL_STAFF_ROLES } from './schoolStaff'

interface SchoolRow {
  id: string
  platform_status: string | null
  platform_expires_at: string | null
  trial_course_code: string | null
  created_at: string | null
}

/**
 * Every school this account is STAFF of, under both spellings of the
 * relationship — the `user_tags` SCHOOL: membership row (teacher or admin) and
 * the `schools.admin_user_id` founding pointer. Recognising only the tag is
 * what made the school-admin predicate say no to the person who runs the
 * school (staging, 2026-08-08); see schoolStaff.ts's isSchoolAdminOf.
 *
 * Students are excluded by the role filter: their access comes from class
 * coverage, on their class's own course, and must not widen to the school's.
 */
async function staffSchoolIds(svc: SupabaseClient, authUid: string): Promise<string[]> {
  const [tagResult, pointerResult] = await Promise.all([
    svc
      .from('user_tags')
      .select('tag_value')
      .eq('user_id', authUid)
      .eq('tag_type', 'school')
      .in('role_in_context', [...SCHOOL_STAFF_ROLES])
      .is('removed_at', null),
    svc.from('schools').select('id').eq('admin_user_id', authUid),
  ])

  const fromTags = (tagResult.data ?? [])
    .map((t: any) => (t?.tag_value ? String(t.tag_value).replace('SCHOOL:', '') : null))
    .filter((id: string | null): id is string => !!id)
  const fromPointer = (pointerResult.data ?? [])
    .map((s: any) => s?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)

  return [...new Set([...fromTags, ...fromPointer])]
}

/** Distinct course codes of the classes these schools actually run. */
async function classCourseCodes(svc: SupabaseClient, schoolIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  if (schoolIds.length === 0) return out
  for (const batch of chunk(schoolIds)) {
    const { data } = await svc.from('classes').select('school_id, course_code').in('school_id', batch)
    for (const row of data ?? []) {
      const schoolId = (row as any).school_id
      const code = (row as any).course_code
      if (!schoolId || !code) continue
      if (!out.has(schoolId)) out.set(schoolId, new Set())
      out.get(schoolId)!.add(code)
    }
  }
  return out
}

/** The live catalogue — the same predicate orgCoverage.ts and grant.ts use. */
async function liveCourseCodes(svc: SupabaseClient): Promise<string[]> {
  const { data } = await svc.from('courses').select('course_code').in('new_app_status', ['live', 'beta'])
  return [
    ...new Set(
      (data ?? [])
        .map((c: any) => c?.course_code)
        .filter((code: unknown): code is string => typeof code === 'string' && code.length > 0),
    ),
  ]
}

export interface SchoolStaffCoverage {
  courses: string[]
  /**
   * The school's own `platform_expires_at`, never a window of this person's.
   * Null means the covering school records no expiry at all — the bare
   * `platform_status` DEFAULT that isPlatformActive deliberately fails open on.
   *
   * Where somebody is staff of several covered schools, this is the EARLIEST
   * boundary among them: the next moment at which this answer changes. Nothing
   * is lost by being conservative, because the answer is recomputed from the
   * school rows on every check — past that boundary the lapsed school's courses
   * simply drop out and the remaining school's own date takes over.
   */
  expiresAt: string | null
}

const NOTHING: SchoolStaffCoverage = { courses: [], expiresAt: null }

/**
 * Resolve the courses AND the window a member of school STAFF is entitled to
 * by virtue of their school's own cover. `authUid` MUST come from a verified
 * JWT.
 *
 * Costs two queries for the overwhelmingly common case of an account that is
 * staff of no school at all, and returns nothing.
 */
export async function resolveSchoolStaffCourseCoverage(
  svc: SupabaseClient,
  authUid: string,
): Promise<SchoolStaffCoverage> {
  const schoolIds = await staffSchoolIds(svc, authUid)
  if (schoolIds.length === 0) return NOTHING

  const schools: SchoolRow[] = []
  for (const batch of chunk(schoolIds)) {
    const { data } = await svc
      .from('schools')
      .select('id, platform_status, platform_expires_at, trial_course_code, created_at')
      .in('id', batch)
    for (const s of data ?? []) schools.push(s as any)
  }

  // A school whose clock has run out confers nothing — and a school row that
  // cannot be read confers nothing either, exactly as class coverage treats a
  // missing school. Only live ones go any further.
  const live = schools.filter((s) => isPlatformActive(s.platform_status, s.platform_expires_at, s.created_at))
  if (live.length === 0) return NOTHING

  const needsClassFallback = live.filter((s) => s.platform_status !== 'active' && !s.trial_course_code)
  const [classCourses, catalogue] = await Promise.all([
    needsClassFallback.length > 0
      ? classCourseCodes(svc, needsClassFallback.map((s) => s.id))
      : Promise.resolve(new Map<string, Set<string>>()),
    live.some((s) => s.platform_status === 'active') ? liveCourseCodes(svc) : Promise.resolve([]),
  ])

  const courses = new Set<string>()
  // Only a school that actually CONTRIBUTES a course gets a say in the window.
  const contributing: SchoolRow[] = []
  for (const s of live) {
    const own =
      s.platform_status === 'active'
        ? catalogue
        : s.trial_course_code
          ? [s.trial_course_code]
          : [...(classCourses.get(s.id) ?? [])]
    if (own.length === 0) continue
    for (const code of own) courses.add(code)
    contributing.push(s)
  }
  if (courses.size === 0) return NOTHING

  return { courses: [...courses], expiresAt: earliestExpiry(contributing) }
}

/** The nearest moment one of these schools' covers runs out; null if none records one. */
function earliestExpiry(live: SchoolRow[]): string | null {
  let earliest: string | null = null
  for (const s of live) {
    if (!s.platform_expires_at) continue
    if (!earliest || new Date(s.platform_expires_at) < new Date(earliest)) earliest = s.platform_expires_at
  }
  return earliest
}
