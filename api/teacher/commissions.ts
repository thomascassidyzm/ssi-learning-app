/**
 * Teacher Commissions API — GET /api/teacher/commissions
 *
 * Auth required. Returns the authed teacher's commission summary so the
 * dashboard can show real accrued earnings (it previously hard-coded 0):
 *   accrued_pence       — all still-accruing balance (earning; includes held)
 *   held_pence          — accruing but still inside the refund window (not yet releasable)
 *   available_pence     — RELEASED balance the cron could actually pay (past refund
 *                         window AND total clears the £100 threshold); 0 otherwise
 *   pending_pence       — closed periods awaiting a Wise payout ('pending_payout')
 *   lifetime_paid_pence — sum of paid periods
 *   periods             — recent rows for display (newest first)
 *
 * available_pence uses the SAME rules as the payout cron so the dashboard never
 * promises money the cron can't release.
 *
 * Read-only, service-role, scoped to the caller's own teacher_id.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// £100 in pence — must match the payout cron threshold.
const PAYOUT_THRESHOLD_PENCE = 10000

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

    // Try to read hold_until (held-commission model); fall back gracefully if the
    // column isn't present yet (pre-migration) so the dashboard never 500s.
    let rows: any[] | null = null
    let hasHoldUntil = true
    {
      const withHold = await supabase
        .from('teacher_commissions')
        .select('period_start, period_end, accrued_pence, status, paid_at, wise_transfer_id, hold_until')
        .eq('teacher_id', teacher.id)
        .order('period_start', { ascending: false })

      if (withHold.error && withHold.error.code === '42703') {
        hasHoldUntil = false
        const fallback = await supabase
          .from('teacher_commissions')
          .select('period_start, period_end, accrued_pence, status, paid_at, wise_transfer_id')
          .eq('teacher_id', teacher.id)
          .order('period_start', { ascending: false })
        if (fallback.error) {
          console.error('[TeacherCommissions] Query failed:', fallback.error)
          res.status(500).json({ error: fallback.error.message })
          return
        }
        rows = fallback.data
      } else if (withHold.error) {
        console.error('[TeacherCommissions] Query failed:', withHold.error)
        res.status(500).json({ error: withHold.error.message })
        return
      } else {
        rows = withHold.data
      }
    }

    const periods = rows || []
    const sumByStatus = (status: string) =>
      periods
        .filter((p: any) => p.status === status)
        .reduce((sum: number, p: any) => sum + (p.accrued_pence || 0), 0)
    // Webhook accrues new commission as 'held'; legacy rows are 'accruing'. Both
    // are still-earning balance from the dashboard's perspective.
    const sumEarning = () =>
      periods
        .filter((p: any) => p.status === 'held' || p.status === 'accruing')
        .reduce((sum: number, p: any) => sum + (p.accrued_pence || 0), 0)

    // Sum ALL still-earning rows, not just the current month: a teacher earning
    // under the £100 payout threshold accrues a fresh sub-threshold row each month
    // until a period closes, so the dashboard must reflect the whole open balance.
    const accrued_pence = sumEarning()
    const pending_pence = sumByStatus('pending_payout')
    const lifetime_paid_pence = sumByStatus('paid')

    // RELEASED balance = accruing rows past their refund window (hold_until <= today).
    // Mirror the cron exactly: only surface as 'available' once that total clears
    // the £100 threshold; below threshold it stays held. Fail safe (treat as held)
    // when hold_until is absent or NULL.
    const todayIso = new Date().toISOString().slice(0, 10)
    const releasedPence = !hasHoldUntil
      ? 0
      : periods
          .filter(
            (p: any) =>
              (p.status === 'held' || p.status === 'accruing') &&
              p.hold_until &&
              p.hold_until <= todayIso
          )
          .reduce((sum: number, p: any) => sum + (p.accrued_pence || 0), 0)
    const available_pence = releasedPence >= PAYOUT_THRESHOLD_PENCE ? releasedPence : 0
    const held_pence = accrued_pence - available_pence

    res.status(200).json({
      accrued_pence,
      held_pence,
      available_pence,
      pending_pence,
      lifetime_paid_pence,
      periods,
    })
  } catch (error: any) {
    console.error('[TeacherCommissions] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
