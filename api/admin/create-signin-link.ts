/**
 * Create Sign-In Link API - POST /api/admin/create-signin-link
 *
 * Admin-only rescue tool: mints a real Supabase magic-link for a target user
 * and hands the URL straight back to the admin, instead of emailing it.
 *
 * Use case: school email gateways (Microsoft/Exchange Online education
 * tenants) silently quarantine our OTP mail — see
 * docs/schools/email-deliverability-plan.md. When a teacher can't receive
 * the OTP, an admin mints this link out-of-band (Slack/WhatsApp/in person)
 * and the teacher clicks it to sign in directly.
 *
 * Security: single-use, short-lived (Supabase default ~1h), and whoever
 * clicks it becomes that user — the caveats shown client-side are load
 * bearing, not decoration. Requires ssi_admin (verifyAdmin). Every mint is
 * audit-logged to player_events (event_type: admin_signin_link_minted) and
 * lightly rate-limited per admin.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const RATE_WINDOW_MS = 15 * 60 * 1000
const PER_ADMIN_LIMIT = 15

/** Derive the app origin from the request — never trust a client-supplied value here. */
function getAppOrigin(req: VercelRequest): string {
  const host = ((req.headers['host'] as string) || '').toLowerCase().replace(/:\d+$/, '')
  if (host === 'saysomethingin.app' || host === 'www.saysomethingin.app') return 'https://saysomethingin.app'
  if (host === 'staging.saysomethingin.app') return 'https://staging.saysomethingin.app'
  if (host) return `https://${host}`
  return 'https://saysomethingin.app'
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const { learner_id } = (req.body || {}) as { learner_id?: string }
  if (!learner_id || typeof learner_id !== 'string') {
    res.status(400).json({ error: 'learner_id is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Lightweight per-admin rate limit — counts this admin's own recent
    // mints via jsonb containment on the audit event we write below.
    const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
    const { count: recentCount, error: rateErr } = await supabase
      .from('player_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'admin_signin_link_minted')
      .gte('occurred_at', cutoff)
      .contains('payload', { actor_user_id: adminResult.userId })

    if (rateErr) {
      console.warn('[CreateSigninLink] rate-limit check failed (failing open):', rateErr.message)
    } else if ((recentCount ?? 0) >= PER_ADMIN_LIMIT) {
      res.status(429).json({ error: 'Too many sign-in links minted recently. Please wait a few minutes.' })
      return
    }

    const { data: learner, error: learnerErr } = await supabase
      .from('learners')
      .select('id, user_id, display_name')
      .eq('id', learner_id)
      .single()

    if (learnerErr || !learner) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const { data: emailRow } = await supabase
      .from('learner_emails')
      .select('email')
      .eq('learner_id', learner_id)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle()

    const email = emailRow?.email
    if (!email) {
      res.status(400).json({ error: 'This user has no email on file to sign in with.' })
      return
    }

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: getAppOrigin(req) },
    })

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[CreateSigninLink] generateLink failed:', linkError)
      res.status(500).json({ error: 'Could not create sign-in link. Please try again.' })
      return
    }

    const actionLink = linkData.properties.action_link

    // Best-effort audit — must never block the response, the link is already minted.
    try {
      const { error: auditErr } = await supabase.from('player_events').insert({
        occurred_at: new Date().toISOString(),
        user_id: learner_id,
        learner_id,
        event_type: 'admin_signin_link_minted',
        payload: { actor_user_id: adminResult.userId, target_user_id: learner.user_id },
        env: getAppOrigin(req).includes('staging') ? 'staging' : (getAppOrigin(req) === 'https://saysomethingin.app' ? 'production' : 'dev'),
      })
      if (auditErr) console.warn('[CreateSigninLink] audit insert failed:', auditErr.message)
    } catch (auditErr) {
      console.warn('[CreateSigninLink] audit insert threw:', auditErr)
    }

    res.status(200).json({ success: true, action_link: actionLink, email })
  } catch (err) {
    console.error('[CreateSigninLink] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
