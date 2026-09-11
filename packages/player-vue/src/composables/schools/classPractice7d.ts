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

export async function fetchClassPractice7d(classIds: string[], user: SchoolUser | null | undefined, client?: SupabaseClient | null): Promise<ClassPractice7d | null> {
  if (classIds.length === 0) return { practiceByClass: {}, activeDaysByClass: {}, classAccountByClass: {} }
  const c = client ?? getSchoolsClient()
  const { data: { session } } = await c.auth.getSession()
  const token = session?.access_token
  if (!token) return null
  const schoolParam = user?._scopeSource === 'admin-view' && user.school_id ? `&school_id=${encodeURIComponent(user.school_id)}` : ''
  const res = await fetch(`/api/school/class-practice-7d?class_ids=${classIds.join(',')}${schoolParam}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = await res.json()
  return {
    practiceByClass: (data?.practiceByClass as Record<string, number>) || {},
    activeDaysByClass: (data?.activeDaysByClass as Record<string, number>) || {},
    classAccountByClass: (data?.classAccountByClass as Record<string, ClassAccountProgress>) || {},
  }
}
