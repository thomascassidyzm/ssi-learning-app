/**
 * Server-side enforcement of the "school-goes-blind-at-expiry" rule for the
 * schools rollup/analytics API surface (docs/schools/group-commercial-model.md,
 * "Student entitlement — FINAL model"). Client-side, SchoolsContainer's
 * platformActive gate already locks the whole app out at expiry; this closes
 * the matching gap for callers who hit the analytics endpoints directly,
 * bypassing that client gate.
 *
 * Uses the SAME predicate (isPlatformActive) the class-course entitlement
 * cascade uses, applied to the school(s) a caller's OWN scope is anchored
 * to — never to the (cohort) schools/classes an endpoint merely aggregates
 * against, and never to group-level rollups (owner's ruling below).
 *
 * Owner's ruling (2026-07-15): an expired school does NOT drop out of its
 * GROUP's aggregates — those are the group leader's view of their own
 * program, already privacy-floored (K_FLOOR), and stay intact. Only a
 * SCHOOL-scoped (or class-scoped, since a class belongs to exactly one
 * school) drill-down blocks for the expired school. So this gate is never
 * applied to a govt_admin's own multi-school scope, nor to entity_level=
 * 'group' lookups — only to the caller's own school/class-anchored view.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlatformActive } from './platformStatus'
import { chunk } from './schoolScope'

interface SchoolCoverageRow {
  platform_status: string | null
  platform_expires_at: string | null
}

/** Fetch platform_status/platform_expires_at for a set of school ids. */
async function fetchSchoolCoverage(
  svc: SupabaseClient,
  schoolIds: string[],
): Promise<Map<string, SchoolCoverageRow>> {
  const out = new Map<string, SchoolCoverageRow>()
  for (const batch of chunk(schoolIds)) {
    const { data } = await svc
      .from('schools')
      .select('id, platform_status, platform_expires_at')
      .in('id', batch)
    for (const s of data ?? []) {
      out.set((s as any).id, {
        platform_status: (s as any).platform_status ?? null,
        platform_expires_at: (s as any).platform_expires_at ?? null,
      })
    }
  }
  return out
}

/** classId -> school_id for a set of classes (chunked). */
async function schoolIdByClass(svc: SupabaseClient, classIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const batch of chunk(classIds)) {
    const { data } = await svc.from('classes').select('id, school_id').in('id', batch)
    for (const c of data ?? []) if ((c as any).school_id) out.set((c as any).id, (c as any).school_id)
  }
  return out
}

/**
 * Filters a teacher/school_admin scope's classIds down to those whose school
 * still has live platform coverage. govt_admin scopes are passed through
 * unfiltered (group/region rollups stay intact per the ruling above).
 *
 * Returns `blocked: true` only when the caller HAD a non-empty scope and
 * EVERY school it resolves to has lapsed — i.e. the caller's own view, not
 * just one cohort member, has gone dark. Callers should respond 403
 * coverage_expired in that case; otherwise proceed with `classIds`.
 */
export async function filterActiveScope(
  svc: SupabaseClient,
  scope: { role: string | null; schoolIds: string[]; classIds: string[] },
): Promise<{ classIds: string[]; blocked: boolean }> {
  if (scope.role === 'govt_admin' || scope.classIds.length === 0) {
    return { classIds: scope.classIds, blocked: false }
  }

  // school_admin scopes already carry schoolIds; teacher scopes don't (a
  // teacher can span classes across schools), so derive per-class ownership
  // up front either way — it's the only thing that lets a multi-school
  // teacher lose just the expired school's classes, not their whole view.
  const classToSchool = await schoolIdByClass(svc, scope.classIds)
  const schoolIds = scope.schoolIds.length > 0
    ? scope.schoolIds
    : [...new Set(classToSchool.values())]
  if (schoolIds.length === 0) {
    return { classIds: scope.classIds, blocked: false }
  }

  const coverage = await fetchSchoolCoverage(svc, schoolIds)
  const activeSchoolIds = new Set(
    schoolIds.filter((id) => isPlatformActive(coverage.get(id)?.platform_status ?? null, coverage.get(id)?.platform_expires_at ?? null)),
  )
  if (activeSchoolIds.size === schoolIds.length) {
    return { classIds: scope.classIds, blocked: false } // all active — common case
  }

  const filtered = scope.classIds.filter((id) => {
    const sid = classToSchool.get(id)
    return !sid || activeSchoolIds.has(sid)
  })
  return { classIds: filtered, blocked: filtered.length === 0 }
}

/**
 * Coverage check for a single school/class entity a caller is drilling into
 * directly (rate-compare's entity_id). `ownSchoolId` is null for
 * entity_level='group' — group drill-downs are never gated (see file header).
 */
export async function isEntityCoverageExpired(
  svc: SupabaseClient,
  ownSchoolId: string | null,
): Promise<boolean> {
  if (!ownSchoolId) return false
  const coverage = await fetchSchoolCoverage(svc, [ownSchoolId])
  const row = coverage.get(ownSchoolId)
  if (!row) return false // unresolvable school — fail open, same axis as the entitlement cascade
  return !isPlatformActive(row.platform_status, row.platform_expires_at)
}
