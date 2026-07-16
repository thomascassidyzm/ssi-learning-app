/**
 * Group + school rollup for a govt_admin — GET /api/school/group-summary
 *
 * Root cause of the "IME group dashboard shows zeros" bug: `group_summary` /
 * `school_summary` / `class_activity_stats` are `security_invoker='on')`
 * views that LATERAL-join `user_tags` to count teachers/students and sum
 * practice hours. `user_tags`'s RLS SELECT policy grants a row's owner, an
 * ssi_admin, a SCHOOL's own admin, or a CLASS's own teacher — but has no
 * govt_admin/group-leader branch (by design: RLS answers "is this my row?"
 * only, hierarchy authz belongs in a server-mediated endpoint, never a
 * "clever" policy — see CLAUDE.md's RLS doctrine). So when the client
 * (`useSchoolData.ts`) queried these views directly as the group leader's
 * own authenticated session, every `user_tags` subquery silently saw zero
 * rows — teacher_count/student_count/total_practice_hours all zeroed, while
 * school_count/class_count (which never touch user_tags) stayed correct.
 * That's exactly the reported symptom (schools/classes right, everything
 * else zero) for every govt_admin, not just IME.
 *
 * Fix: resolve the caller's scope server-side (resolveVisibleScope, the
 * same primitive class-practice-7d.ts/daily-activity.ts already use) with
 * the SERVICE ROLE, then read the views under that role — authorization is
 * enforced HERE (govt_admin's own group subtree only), not by RLS.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope, chunk } from '../_utils/schoolScope'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
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

  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const scope = await resolveVisibleScope(svc, auth.userId)
    if (scope.role !== 'govt_admin' || !scope.groupId) {
      res.status(403).json({ error: 'Not a group leader' })
      return
    }

    const [{ data: group, error: groupErr }, { data: schoolRows, error: schoolErr }] = await Promise.all([
      svc.from('group_summary').select('*').eq('group_id', scope.groupId).maybeSingle(),
      scope.schoolIds.length
        ? svc.from('school_summary').select('*').in('school_id', scope.schoolIds).order('school_name')
        : Promise.resolve({ data: [], error: null } as any),
    ])
    if (groupErr) throw groupErr
    if (schoolErr) throw schoolErr

    // Best-class active_days_last_7 per school (health dots) — same view,
    // same user_tags dependency, same fix.
    const activeDaysBySchool = new Map<string, number>()
    for (const batch of chunk(scope.schoolIds)) {
      const { data } = await svc
        .from('class_activity_stats')
        .select('school_id, active_days_last_7')
        .in('school_id', batch)
      for (const row of data ?? []) {
        const prev = activeDaysBySchool.get((row as any).school_id) ?? 0
        const v = (row as any).active_days_last_7 ?? 0
        if (v > prev) activeDaysBySchool.set((row as any).school_id, v)
      }
    }

    const schools = (schoolRows ?? []).map((s: any) => ({
      ...s,
      active_days_last_7: activeDaysBySchool.get(s.school_id) ?? 0,
    }))

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ group: group ?? null, schools })
  } catch (err) {
    console.error('[group-summary] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
