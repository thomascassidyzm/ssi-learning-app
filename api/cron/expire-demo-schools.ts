/**
 * Auto-expire Demo Schools Cron — /api/cron/expire-demo-schools
 *
 * Vercel cron, configured in vercel.json to run daily at 05:00 UTC. Finds
 * every active demo_orgs row past its expires_at and runs the same clean
 * teardown as the manual "Expire" action in api/admin/demo-schools.ts: bans
 * every staff auth account (Supabase ban_duration — reversible, not a
 * delete) and marks the row 'expired'. Synthetic learner rows need no
 * teardown (they never sign in).
 *
 * Auth: Vercel cron requests carry an `Authorization: Bearer <CRON_SECRET>`
 * header set in project env — same idiom as api/cron/teacher-payouts.ts.
 * Fails CLOSED in production if CRON_SECRET is unset.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const cronSecret = (process.env.CRON_SECRET || '').trim()
const BAN_DURATION = '87600h' // ~10 years — matches api/admin/demo-schools.ts

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const authHeader = (req.headers.authorization || '').trim()
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  if (isProd && !cronSecret) {
    console.error('[cron/expire-demo-schools] CRON_SECRET not configured in production — refusing to run')
    res.status(500).json({ error: 'CRON_SECRET not configured' })
    return
  }
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    if (isProd) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    console.warn('[cron/expire-demo-schools] missing/invalid CRON_SECRET — allowed in non-prod')
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: due, error: fetchErr } = await supabase
      .from('demo_orgs')
      .select('id, prospect_name, metadata')
      .eq('status', 'active')
      .lte('expires_at', new Date().toISOString())
    if (fetchErr) throw fetchErr

    let bannedAccounts = 0
    for (const org of due || []) {
      const staffLearnerIds: string[] = ((org.metadata as any)?.staff || []).map((s: any) => s.learnerId).filter(Boolean)
      if (staffLearnerIds.length) {
        const { data: learners } = await supabase.from('learners').select('user_id').in('id', staffLearnerIds)
        for (const l of learners || []) {
          try {
            await supabase.auth.admin.updateUserById(l.user_id as string, { ban_duration: BAN_DURATION })
            bannedAccounts++
          } catch (banErr) {
            console.warn('[cron/expire-demo-schools] ban failed for', l.user_id, banErr)
          }
        }
      }
      await supabase.from('demo_orgs').update({ status: 'expired', expired_at: new Date().toISOString() }).eq('id', org.id)
      await supabase.from('player_events').insert({
        occurred_at: new Date().toISOString(),
        event_type: 'admin_demo_school_expired',
        payload: { actor_user_id: 'cron', prospect_name: org.prospect_name, demo_org_id: org.id },
      }).then(({ error }) => { if (error) console.warn('[cron/expire-demo-schools] audit insert failed:', error.message) })
    }

    console.log(`[cron/expire-demo-schools] expired ${due?.length ?? 0} org(s), banned ${bannedAccounts} account(s)`)
    res.status(200).json({ expired: due?.length ?? 0, bannedAccounts })
  } catch (error: any) {
    console.error('[cron/expire-demo-schools] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
