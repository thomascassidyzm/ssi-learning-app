/**
 * GET /api/support/thread — her school's (or org's) thread, created on first
 * use, messages oldest-first. Opening it marks it read (last_read_at), which
 * is what the unread dot and the email doorbell both key on.
 *
 * ?peek=1 answers only { unread: n } and does NOT mark the thread read — the
 * user-menu dot uses this so a glance at the menu never counts as reading.
 *
 * Admins only, server-side (Tom, 2026-09-10).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveSupportScope, getOrCreateThread, MESSAGE_VIEW_COLUMNS, type SupportMessageView } from './_shared'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Replies written since the thread was last opened. */
export function unreadCount(messages: SupportMessageView[], lastReadAt: string | null): number {
  const since = lastReadAt ? Date.parse(lastReadAt) : 0
  return messages.filter((m) => m.direction === 'out' && Date.parse(m.created_at) > since).length
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
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
    const scope = await resolveSupportScope(svc, auth.userId)
    if (!scope) {
      res.status(403).json({ error: 'Support is for school and organisation admins' })
      return
    }

    const thread = await getOrCreateThread(svc, scope)
    const { data: rows } = await svc
      .from('support_messages')
      .select(MESSAGE_VIEW_COLUMNS)
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true })
    const messages = (rows ?? []) as SupportMessageView[]
    const unread = unreadCount(messages, thread.last_read_at)

    if (req.query.peek === '1') {
      res.status(200).json({ unread })
      return
    }

    await svc.from('support_threads').update({ last_read_at: new Date().toISOString() }).eq('id', thread.id)

    res.status(200).json({
      thread: {
        id: thread.id,
        language: thread.language,
        standing_notes: thread.standing_notes ?? {},
        created_at: thread.created_at,
      },
      messages,
      unread,
    })
  } catch (err) {
    console.error('[support/thread]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
