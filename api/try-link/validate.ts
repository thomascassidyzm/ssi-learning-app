/**
 * Try Link Validate API - POST /api/try-link/validate
 *
 * Public (no auth). Validates a try-link code and logs the visit.
 * Returns success if the code is valid, active, and not expired.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createHash, createHmac } from 'crypto'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Same secret + format the audio proxy verifies (api/audio/[audioId].ts).
const entitlementSecret = (
  process.env.ENTITLEMENT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim()

// How long a try-link entitlement is good for once validated, when the link
// itself carries no expiry. Time-boxed so a leaked token can't grant forever.
const TRY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Mint a server-signed, time-boxed entitlement token (HMAC-SHA256). This REPLACES
 * the old client-only `ssi-demo-tier` flag: the grant is now something only the
 * server could have produced, and the audio proxy re-verifies it server-side
 * before serving premium-past-preview content. scope 'all' = a try-link tastes
 * every course (the whole point of a try-link).
 */
function mintEntitlementToken(expMs: number): string {
  const payload = b64url(Buffer.from(JSON.stringify({ kind: 'try', scope: 'all', exp: expMs })))
  const sig = b64url(createHmac('sha256', entitlementSecret).update(payload).digest())
  return `${payload}.${sig}`
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

    // Mint the entitlement token, clamped to the link's own expiry if it has one.
    const linkExpMs = link.expires_at ? new Date(link.expires_at).getTime() : null
    const expMs = linkExpMs != null
      ? Math.min(Date.now() + TRY_TOKEN_TTL_MS, linkExpMs)
      : Date.now() + TRY_TOKEN_TTL_MS
    const token = entitlementSecret ? mintEntitlementToken(expMs) : null

    res.status(200).json({
      valid: true,
      label: link.label,
      // Server-minted, time-boxed entitlement. Absent only if the server is
      // mis-configured (no secret) — the client then falls back to UI-only access.
      entitlementToken: token,
      entitlementExpiresAt: token ? expMs : null,
    })
  } catch (error: any) {
    console.error('[TryLinkValidate] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
