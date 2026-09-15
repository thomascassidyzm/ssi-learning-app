/**
 * The admin messaging routes' shared preamble (job #821): CORS, method,
 * ssi_admin only (verifyAdmin), service client. The composer is an SSi admin
 * tool; nothing here is reachable by a school role.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../../_utils/auth'
import { applyCors } from '../../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export async function resolveAdminCaller(
  req: VercelRequest,
  res: VercelResponse,
  opts: { method: 'GET' | 'POST' },
): Promise<{ svc: SupabaseClient; userId: string } | null> {
  if (applyCors(req, res, { methods: opts.method })) return null
  if (req.method !== opts.method) {
    res.status(405).json({ error: 'Method not allowed' })
    return null
  }
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return null
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return null
  }
  return { svc: createClient(supabaseUrl, supabaseServiceKey), userId: admin.userId }
}
