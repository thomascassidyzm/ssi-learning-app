/**
 * Try Link Creation API - POST /api/try-link/create
 *
 * Admin-only. Creates a shareable try-link for zero-friction course previews.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { generateCode, redactCode } from '../_utils/codeGen'

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

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify caller is admin
  const { data: learner } = await supabase
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', authResult.userId)
    .single()

  if (!learner || (learner.platform_role !== 'ssi_admin' && learner.educational_role !== 'god')) {
    res.status(403).json({ error: 'Only SSi admins can create try links' })
    return
  }

  const { label, ttl_days } = req.body || {}

  if (!label || typeof label !== 'string' || !label.trim()) {
    res.status(400).json({ error: 'label is required' })
    return
  }

  const ttl = typeof ttl_days === 'number' && ttl_days > 0 ? ttl_days : 90

  try {
    // Generate unique code (check try_links, invite_codes, entitlement_codes)
    let newCode: string | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateCode()

      const [tr, ir, er] = await Promise.all([
        supabase.from('try_links').select('id').eq('code', candidate).maybeSingle(),
        supabase.from('invite_codes').select('id').eq('code', candidate).maybeSingle(),
        supabase.from('entitlement_codes').select('id').eq('code', candidate).maybeSingle(),
      ])

      // If any uniqueness probe errored, don't treat the code as free — that
      // could mint a duplicate. Skip this candidate and try another.
      if (tr.error || ir.error || er.error) continue

      if (!tr.data && !ir.data && !er.data) {
        newCode = candidate
        break
      }
    }

    if (!newCode) {
      res.status(500).json({ error: 'Could not generate unique code, please try again' })
      return
    }

    const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000).toISOString()

    const { data: created, error: insertError } = await supabase
      .from('try_links')
      .insert({
        code: newCode,
        label: label.trim(),
        created_by: authResult.userId,
        ttl_days: ttl,
        expires_at: expiresAt,
        is_active: true,
      })
      .select('id, code, label, expires_at, ttl_days, created_at')
      .single()

    if (insertError || !created) {
      console.error('[TryLinkCreate] Insert failed:', insertError)
      res.status(500).json({ error: insertError?.message || 'Insert failed' })
      return
    }

    console.log('[TryLinkCreate] Created:', redactCode(newCode), 'label:', label, 'by:', authResult.userId)
    res.status(201).json(created)
  } catch (error: any) {
    console.error('[TryLinkCreate] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
