/**
 * flatViewLanding — where a retired flat schools view actually lands.
 *
 * Nav unification (2026-07-29) and the third persona through the same door
 * (founder ruling 2026-07-30): the pre-hierarchy flat views are retired for
 * group-scoped leaders and school-scoped school admins. Old URLs live on but
 * land on THE VIEW — the node home or node insights. SchoolsContainer applies
 * this after the page mounts; the Handbook (job #386) asks it BEFORE offering
 * "Show me", because a demo whose anchors live on a page this reader is
 * redirected away from would start and die on the redirect. One rule, two
 * callers, so the two can never disagree.
 *
 * Classes and Students stay flat for everyone. Teachers on these routes are
 * untouched; legacy no-group / no-school rows keep the flat views.
 */
import type { RouteLocationRaw } from 'vue-router'

export interface LandingViewer {
  groupId?: string | null
  schoolId?: string | null
  isGovtAdmin: boolean
  isSchoolAdmin: boolean
}

/** The route this viewer is sent to instead of `routeName`, or null to stay. */
export function flatViewLanding(routeName: string | null | undefined, viewer: LandingViewer): RouteLocationRaw | null {
  if (!routeName) return null
  if (viewer.groupId && viewer.isGovtAdmin) {
    if (routeName === 'schools-list') return { path: `/org/${viewer.groupId}`, query: { lens: 'schools' } }
    if (routeName === 'analytics') return `/org/${viewer.groupId}/insights`
    return null
  }
  if (viewer.schoolId && viewer.isSchoolAdmin) {
    if (routeName === 'schools-dashboard') return `/org/${viewer.schoolId}`
    if (routeName === 'teachers') return { path: `/org/${viewer.schoolId}`, query: { lens: 'teachers' } }
    if (routeName === 'analytics') return `/org/${viewer.schoolId}/insights`
  }
  return null
}

/** The route NAME each retired-able Handbook place maps to, for the check above. */
export const PLACE_ROUTE_NAMES: Record<string, string> = {
  teachers: 'teachers',
  dashboard: 'schools-dashboard',
  analytics: 'analytics',
  'schools-list': 'schools-list',
}
