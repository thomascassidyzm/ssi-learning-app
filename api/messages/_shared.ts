/**
 * The inbox routes' shared preamble (job #684). Every route: CORS, refuse
 * under View As, verify the token, service client. Identity comes from the
 * verified token only — never from the body — and every read and write is
 * filtered on that recipient, so the routes are own-row by construction.
 *
 * VIEW AS. An ssi_admin touring as a teacher must mark nothing read, dismiss
 * nothing and undo nothing in that teacher's name (job #681's rule). The
 * three writes refuse the tagged request outright; the list also refuses,
 * because the admin's own token would list the ADMIN's inbox on the viewed
 * person's screen, which is a wrong picture rather than a leak. A tour
 * therefore renders the inbox as empty-and-read-only, and the client says so.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export interface InboxCaller {
  svc: SupabaseClient
  userId: string
}

export async function resolveInboxCaller(
  req: VercelRequest,
  res: VercelResponse,
  opts: { method: 'GET' | 'POST' },
): Promise<InboxCaller | null> {
  if (applyCors(req, res, { methods: opts.method })) return null
  if (req.method !== opts.method) {
    res.status(405).json({ error: 'Method not allowed' })
    return null
  }
  const viewAs = rejectIfViewAs(req)
  if (viewAs) {
    res.status(viewAs.status).json({ error: 'The inbox is read-only while viewing as another user' })
    return null
  }
  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return null
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return null
  }
  return { svc: createClient(supabaseUrl, supabaseServiceKey), userId: auth.userId }
}

/** The message id from a POST body, or null after answering 400. */
export function messageIdFromBody(req: VercelRequest, res: VercelResponse): string | null {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  if (!id) { res.status(400).json({ error: 'id is required' }); return null }
  return id
}
