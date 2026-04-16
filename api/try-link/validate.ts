/**
 * Try Link Validate API - POST /api/try-link/validate
 *
 * Public (no auth). Validates a try-link code and logs the visit.
 * Returns success if the code is valid, active, and not expired.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { code } = req.body || {}

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'code is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Look up the try link
    const { data: link, error: lookupError } = await supabase
      .from('try_links')
      .select('id, code, label, expires_at, is_active')
      .eq('code', code.trim().toUpperCase())
      .maybeSingle()

    if (lookupError) {
      throw lookupError
    }

    if (!link) {
      res.status(404).json({ error: 'Invalid try link' })
      return
    }

    if (!link.is_active) {
      res.status(410).json({ error: 'This try link has been deactivated' })
      return
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      res.status(410).json({ error: 'This try link has expired' })
      return
    }

    // Log the visit (non-blocking — don't fail the request if logging fails)
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.headers['x-real-ip'] as string
      || 'unknown'
    const ipHash = hashIp(ip)

    supabase
      .from('try_link_visits')
      .insert({ try_link_id: link.id, ip_hash: ipHash })
      .then(({ error }) => {
        if (error) console.warn('[TryLinkValidate] Failed to log visit:', error.message)
      })

    res.status(200).json({
      valid: true,
      label: link.label,
    })
  } catch (error: any) {
    console.error('[TryLinkValidate] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
