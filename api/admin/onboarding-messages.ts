/**
 * Onboarding Messages API - /api/admin/onboarding-messages
 *
 * Admin-only. Live source for the onboarding message series
 * (docs/onboarding/onboarding-series-draft.md) — content as data, editable
 * from /admin/onboarding without a deploy. Same idiom as
 * api/admin/board-snapshot.ts: service-role client, admin-gated, RLS denies
 * everyone else.
 *
 * GET               — list all messages, series order.
 * POST { action: 'update', id, ...fields } — save an existing message.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const EDITABLE_FIELDS = [
  'title',
  'channel',
  'subject',
  'preheader',
  'body',
  'trigger_description',
  'notes',
  'active',
] as const

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('onboarding_messages')
        .select('*')
        .order('sort_order', { ascending: true })
      if (error) throw error
      res.status(200).json({ messages: data ?? [] })
    } catch (error: any) {
      console.error('[OnboardingMessages] List error:', error)
      res.status(500).json({ error: error?.message || 'Internal server error' })
    }
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { action, id } = req.body || {}

  if (action !== 'update') {
    res.status(400).json({ error: "action must be 'update'" })
    return
  }

  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'id is required' })
    return
  }

  const update: Record<string, unknown> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in (req.body || {})) update[field] = req.body[field]
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No editable fields provided' })
    return
  }

  if ('channel' in update && update.channel !== 'email' && update.channel !== 'in_app') {
    res.status(400).json({ error: "channel must be 'email' or 'in_app'" })
    return
  }

  update.updated_at = new Date().toISOString()
  update.updated_by = admin.userId

  try {
    const { data, error } = await supabase
      .from('onboarding_messages')
      .update(update)
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) {
      res.status(404).json({ error: 'Message not found' })
      return
    }
    res.status(200).json(data)
  } catch (error: any) {
    console.error('[OnboardingMessages] Update error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
