/**
 * Mark course welcome as played — POST /api/welcome/played
 *
 * The welcome plays ONCE EVER per learner, not once per course. The flag lives
 * on learners.welcome_played_at (per-learner, course-agnostic). `learners` is
 * column-write-locked for clients (20260521180000_block_anon_role_escalation),
 * so the mark goes through this service-role endpoint.
 *
 * Auth: verifyAuthToken. A caller can only mark their OWN learner row (matched
 * by auth user_id). Idempotent — never overwrites the original timestamp.
 *
 * Risk model: worst case a user marks their own welcome played and skips their
 * own welcome. Zero impact on anyone else; no privileged field touched.
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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data, error } = await supabase
      .from('learners')
      .update({ welcome_played_at: new Date().toISOString() })
      .eq('user_id', authResult.userId)
      .is('welcome_played_at', null) // idempotent — keep the first timestamp
      .select('id')

    if (error) {
      console.error('[welcome/played] update failed:', error)
      res.status(500).json({ error: 'Failed to mark welcome' })
      return
    }

    res.status(200).json({ marked: data?.length || 0 })
  } catch (err) {
    console.error('[welcome/played] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
