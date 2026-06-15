/**
 * Email-allowlist claim API - POST /api/access/claim
 *
 * Called on every sign-in. Looks up any active, unredeemed email_access_grants
 * for the SIGNED-IN user's verified email and applies them — so a user whose
 * email was pre-granted free access gets it automatically, no code to type.
 *
 * SECURITY:
 *  - The email is derived from the VERIFIED auth session (the service-role
 *    client's auth.getUser(token).email — the OTP-verified address), NEVER from
 *    the request body. A caller cannot claim someone else's grant.
 *  - email_access_grants is RLS-on with no policy, so only this service-role
 *    path can read it.
 *  - Idempotent: a unique (learner_id, email_access_grant_id) index guarantees
 *    a grant applies at most once per learner; re-calling returns granted:0.
 *  - Never throws to the client; always 200 with the result.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { applyDashboardRole, computeEntitlementExpiry } from '../_utils/entitlementGrant'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Loosely typed service client — see api/_utils/entitlementGrant.ts for why.
type ServiceClient = { from: (table: string) => any; auth: any }

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }
  const token = authHeader.slice(7)

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Derive the identity from the VERIFIED token, not the body.
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const user = userData?.user
  const email = user?.email?.toLowerCase().trim()
  if (userError || !user || !email) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const result = await applyGrantsForEmail(supabase, user.id, email)
    res.status(200).json(result)
  } catch (err) {
    // Never throw to the client — an allowlist claim failure must not break
    // sign-in. Log and return an empty result.
    console.error('[AccessClaim] Error:', err)
    res.status(200).json({ granted: 0, items: [] })
  }
}

interface AppliedItem {
  grantId: string
  label: string | null
  access_type: string
}

/**
 * Apply every active, unredeemed email_access_grant for `email` to the learner
 * owning `userId`. Idempotent. Used by both the claim endpoint (verified
 * session) and grant-emails (admin best-effort immediate apply).
 */
export async function applyGrantsForEmail(
  supabase: ServiceClient,
  userId: string,
  email: string,
): Promise<{ granted: number; items: AppliedItem[] }> {
  const normalizedEmail = email.toLowerCase().trim()

  // Find the learner for this auth user.
  const { data: learner } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!learner) {
    return { granted: 0, items: [] }
  }
  const learnerId = learner.id as string

  return applyGrantsForLearner(supabase, learnerId, normalizedEmail)
}

/**
 * Lower-level variant keyed by a known learner_id + normalized email. Used by
 * grant-emails to apply to existing accounts found via verified_emails.
 */
export async function applyGrantsForLearner(
  supabase: ServiceClient,
  learnerId: string,
  normalizedEmail: string,
): Promise<{ granted: number; items: AppliedItem[] }> {
  // Active, unredeemed grants matching this email.
  const { data: grants } = await supabase
    .from('email_access_grants')
    .select('id, access_type, granted_courses, duration_type, duration_days, grants_platform_role, grants_dashboard_courses, label')
    .eq('email_normalized', normalizedEmail)
    .eq('is_active', true)
    .is('redeemed_at', null)

  if (!grants || grants.length === 0) {
    return { granted: 0, items: [] }
  }

  const items: AppliedItem[] = []

  for (const grant of grants) {
    // Idempotency: skip if this grant was already applied to this learner.
    const { data: existing } = await supabase
      .from('user_entitlements')
      .select('id')
      .eq('learner_id', learnerId)
      .eq('email_access_grant_id', grant.id)
      .maybeSingle()

    if (existing) continue

    const expiresAt = computeEntitlementExpiry(grant)

    const { error: insertError } = await supabase
      .from('user_entitlements')
      .insert({
        learner_id: learnerId,
        email_access_grant_id: grant.id,
        access_type: grant.access_type,
        granted_courses: grant.granted_courses,
        expires_at: expiresAt,
      })

    if (insertError) {
      // A unique-violation here means a concurrent claim already inserted it —
      // treat as already-applied (idempotent), not a failure.
      if ((insertError as { code?: string }).code === '23505') continue
      console.error('[AccessClaim] Failed to insert entitlement:', insertError)
      continue
    }

    // Apply optional dashboard role (non-fatal).
    await applyDashboardRole(supabase, learnerId, grant)

    // Mark the grant redeemed (first learner to claim it stamps it). Best-effort
    // — the unique index, not this stamp, is the real idempotency guard.
    await supabase
      .from('email_access_grants')
      .update({ redeemed_at: new Date().toISOString(), redeemed_by_learner_id: learnerId })
      .eq('id', grant.id)
      .is('redeemed_at', null)

    items.push({
      grantId: grant.id as string,
      label: (grant.label as string | null) ?? null,
      access_type: grant.access_type as string,
    })
  }

  return { granted: items.length, items }
}
