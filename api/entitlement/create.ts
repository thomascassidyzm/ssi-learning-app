/**
 * Entitlement Code Creation API - POST /api/entitlement/create
 *
 * Requires auth. Only ssi_admin users can create entitlement codes. Also the
 * backing endpoint for the admin "Grant free access" tool (AdminAccess.vue) —
 * an optional `metadata` bag lets that tool attach who the code was minted
 * for (email/name/note) without a schema change (entitlement_codes.metadata
 * is already jsonb). Every mint is rate-limited per admin and audit-logged
 * to player_events, same pattern as api/admin/create-signin-link.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { generateCode } from '../_utils/codeGen'
import { boundPrivilegedCodeLimits } from '../_utils/codeGuard'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

const RATE_WINDOW_MS = 15 * 60 * 1000
const PER_ADMIN_LIMIT = 30

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
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
  const userId = adminResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Per-admin rate limit — counts this admin's own recent mints via jsonb
  // containment on the audit event we write below. Fails open on error (a
  // transient audit-query blip must never block a legitimate mint).
  const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
  const { count: recentCount, error: rateErr } = await supabase
    .from('player_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'admin_entitlement_code_minted')
    .gte('occurred_at', cutoff)
    .contains('payload', { actor_user_id: userId })

  if (rateErr) {
    console.warn('[EntitlementCreate] rate-limit check failed (failing open):', rateErr.message)
  } else if ((recentCount ?? 0) >= PER_ADMIN_LIMIT) {
    res.status(429).json({ error: 'Too many codes minted recently. Please wait a few minutes.' })
    return
  }

  const {
    access_type,
    granted_courses,
    duration_type,
    duration_days,
    label,
    max_uses,
    expires_at,
    grants_platform_role,
    grants_dashboard_courses,
    metadata,
  } = req.body || {}

  // Validate required fields
  if (!access_type || !['full', 'courses'].includes(access_type)) {
    res.status(400).json({ error: 'Invalid access_type (must be "full" or "courses")' })
    return
  }

  if (access_type === 'courses' && (!granted_courses || !Array.isArray(granted_courses) || granted_courses.length === 0)) {
    res.status(400).json({ error: 'granted_courses required for "courses" access type' })
    return
  }

  if (!duration_type || !['lifetime', 'time_limited'].includes(duration_type)) {
    res.status(400).json({ error: 'Invalid duration_type (must be "lifetime" or "time_limited")' })
    return
  }

  if (duration_type === 'time_limited' && (!duration_days || typeof duration_days !== 'number' || duration_days < 1)) {
    res.status(400).json({ error: 'duration_days required for time_limited codes (must be >= 1)' })
    return
  }

  if (!label || typeof label !== 'string') {
    res.status(400).json({ error: 'label is required' })
    return
  }

  try {
    // Generate unique code with up to 10 retries
    // Check both invite_codes and entitlement_codes for uniqueness
    let newCode: string | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateCode()

      const { data: existingInvite } = await supabase
        .from('invite_codes')
        .select('id')
        .eq('code', candidate)
        .maybeSingle()

      const { data: existingEntitlement } = await supabase
        .from('entitlement_codes')
        .select('id')
        .eq('code', candidate)
        .maybeSingle()

      if (!existingInvite && !existingEntitlement) {
        newCode = candidate
        break
      }
    }

    if (!newCode) {
      console.error('[EntitlementCreate] Failed to generate unique code after 10 attempts')
      res.status(500).json({ error: 'Could not generate unique code, please try again' })
      return
    }

    const insertData: Record<string, unknown> = {
      code: newCode,
      access_type,
      duration_type,
      label,
      created_by: userId,
      is_active: true,
    }
    if (access_type === 'courses') insertData.granted_courses = granted_courses
    if (duration_type === 'time_limited') insertData.duration_days = duration_days

    // A code that grants a platform_role is an admin-granting bearer token —
    // force the redemption window + use cap to be bounded. Plain content
    // entitlement codes keep the caller's values.
    const grantsRole = !!(grants_platform_role && ['ssi_admin', 'popty_user'].includes(grants_platform_role))
    if (grantsRole) {
      insertData.grants_platform_role = grants_platform_role
      const bounded = boundPrivilegedCodeLimits(expires_at, max_uses)
      insertData.expires_at = bounded.expires_at
      insertData.max_uses = bounded.max_uses
    } else {
      if (max_uses !== undefined && max_uses !== null) insertData.max_uses = max_uses
      if (expires_at !== undefined) insertData.expires_at = expires_at
    }
    if (grants_dashboard_courses && Array.isArray(grants_dashboard_courses) && grants_dashboard_courses.length > 0) {
      insertData.grants_dashboard_courses = grants_dashboard_courses
    }
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      insertData.metadata = metadata
    }

    const { data: created, error: insertError } = await supabase
      .from('entitlement_codes')
      .insert(insertData)
      .select('id, code')
      .single()

    if (insertError || !created) {
      console.error('[EntitlementCreate] Failed to insert:', insertError)
      res.status(500).json({ error: insertError?.message || 'Insert failed' })
      return
    }

    console.log('[EntitlementCreate] Created code:', newCode, 'label:', label, 'by:', userId)

    // Best-effort audit — must never block the response, the code is already minted.
    try {
      const { error: auditErr } = await supabase.from('player_events').insert({
        occurred_at: new Date().toISOString(),
        event_type: 'admin_entitlement_code_minted',
        payload: { actor_user_id: userId, entitlement_code_id: created.id, label, access_type, metadata: metadata ?? null },
      })
      if (auditErr) console.warn('[EntitlementCreate] audit insert failed:', auditErr.message)
    } catch (auditErr) {
      console.warn('[EntitlementCreate] audit insert threw:', auditErr)
    }

    res.status(201).json({
      code: created.code,
      id: created.id,
    })
  } catch (error: any) {
    console.error('[EntitlementCreate] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
