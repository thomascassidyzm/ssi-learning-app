/**
 * POST /api/auth/end-other-sessions — the "sign that one out" of the
 * multi-session line.
 *
 * TOM'S RULING 3 (job #195, 2026-09-18): at proof, if there is exactly one
 * live session — nearly everyone — nothing happens and nothing is shown. Only
 * if there is more than one does the proving device see one line, defaulting
 * to KEEP. This route is what the other answer does: it ends every session on
 * the account EXCEPT the caller's own. Nothing runs unless the person taps
 * it; doing nothing is the safe path and the default.
 *
 * TOM'S RULING 2 stands beside it: proof itself never ends a session. This
 * route is never called by proof — only by the person, on that one line.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { applyCors } from '../_utils/cors'
import { getAuthUserId } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const userId = await getAuthUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }
  const token = String(req.headers.authorization || '').slice(7)
  const admin = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  // GoTrue's own scope: every session of this user other than the one the
  // token belongs to. The caller stays signed in.
  const { error } = await admin.auth.admin.signOut(token, 'others')
  if (error) {
    console.error('[end-other-sessions] failed:', error.message)
    res.status(500).json({ error: 'Could not sign the other device out. Please try again.' })
    return
  }
  res.status(200).json({ success: true })
}
