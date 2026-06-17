/**
 * Teacher Commissions API — GET /api/teacher/commissions
 *
 * Auth required. Returns the authed teacher's commission summary so the
 * dashboard can show real accrued earnings (it previously hard-coded 0):
 *   accrued_pence       — current calendar month, status 'accruing'
 *   pending_pence       — closed periods awaiting a Wise payout ('pending_payout')
 *   lifetime_paid_pence — sum of paid periods
 *   periods             — recent rows for display (newest first)
 *
 * Read-only, service-role, scoped to the caller's own teacher_id.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (!learner) {
      res.status(404).json({ error: 'Not a teacher' })
      return
    }

    const { data: teacher } = await supabase
      .from('teachers')
      .select('id')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!teacher) {
      res.status(404).json({ error: 'Not a teacher' })
      return
    }

    const { data: rows, error } = await supabase
      .from('teacher_commissions')
      .select('period_start, period_end, accrued_pence, status, paid_at, wise_transfer_id')
      .eq('teacher_id', teacher.id)
      .order('period_start', { ascending: false })

    if (error) {
      console.error('[TeacherCommissions] Query failed:', error)
      res.status(500).json({ error: error.message })
      return
    }

    const periods = rows || []
    const sumByStatus = (status: string) =>
      periods
        .filter((p: any) => p.status === status)
        .reduce((sum: number, p: any) => sum + (p.accrued_pence || 0), 0)

    // Sum ALL still-accruing rows, not just the current month: a teacher earning
    // under the £100 payout threshold accrues a fresh sub-threshold row each month
    // until a period closes, so the dashboard must reflect the whole open balance.
    const accrued_pence = sumByStatus('accruing')
    const pending_pence = sumByStatus('pending_payout')
    const lifetime_paid_pence = sumByStatus('paid')

    res.status(200).json({ accrued_pence, pending_pence, lifetime_paid_pence, periods })
  } catch (error: any) {
    console.error('[TeacherCommissions] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
