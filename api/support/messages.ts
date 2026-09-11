/**
 * POST /api/support/messages — her question.
 *
 * Writes ONE row: direction 'in', author_source 'human', with the envelope
 * assembled server-side from her resolved scope (never from the body). The
 * answer is not produced here: the watcher on watson-1 selects rows with
 * answered_at IS NULL and writes the reply as a row of its own, which the
 * thread view picks up on its next poll. The transport is the database
 * (Tom's ruling, 2026-09-10); this route is her side of it and nothing more.
 *
 * Admins only (Tom, 2026-09-10): a teacher gets 403 here, not just no button.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import {
  resolveSupportScope,
  getOrCreateThread,
  assembleServerEnvelope,
  pickClientEnvelope,
  MESSAGE_VIEW_COLUMNS,
} from './_shared'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const MAX_BODY_CHARS = 4000
const LANGUAGES = new Set(['eng', 'cym'])

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') {
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

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    res.status(400).json({ error: 'text required' })
    return
  }
  if (text.length > MAX_BODY_CHARS) {
    res.status(400).json({ error: `text too long (max ${MAX_BODY_CHARS} characters)` })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  try {
    const scope = await resolveSupportScope(svc, auth.userId)
    if (!scope) {
      res.status(403).json({ error: 'Support is for school and organisation admins' })
      return
    }

    const [thread, server, { data: learner }] = await Promise.all([
      getOrCreateThread(svc, scope),
      assembleServerEnvelope(svc, scope),
      svc.from('learners').select('display_name').eq('user_id', auth.userId).maybeSingle(),
    ])

    const client = pickClientEnvelope(body)
    const language = typeof body.language === 'string' && LANGUAGES.has(body.language) ? body.language : thread.language

    const { data: message, error } = await svc
      .from('support_messages')
      .insert({
        thread_id: thread.id,
        body: text,
        direction: 'in',
        author_source: 'human',
        author_name: ((learner as { display_name?: string } | null)?.display_name ?? null),
        author_via: 'jwt',
        author_user_id: auth.userId,
        envelope: { client, server },
      })
      .select(MESSAGE_VIEW_COLUMNS)
      .single()
    if (error || !message) {
      res.status(500).json({ error: error?.message || 'message could not be saved' })
      return
    }

    const now = new Date().toISOString()
    await svc
      .from('support_threads')
      .update({ last_message_at: now, last_read_at: now, ...(language ? { language } : {}) })
      .eq('id', thread.id)

    res.status(200).json({ thread_id: thread.id, message })
  } catch (err) {
    console.error('[support/messages]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
