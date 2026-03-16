/**
 * Entitlement Code Creation API - POST /api/entitlement/create
 *
 * Requires auth. Only ssi_admin users can create entitlement codes.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { generateCode } from '../_utils/codeGen'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

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
  const userId = authResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify caller is ssi_admin or god
  const { data: learner } = await supabase
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', userId)
    .single()

  if (!learner || (learner.platform_role !== 'ssi_admin' && learner.educational_role !== 'god')) {
    res.status(403).json({ error: 'Only SSi admins can create entitlement codes' })
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
    if (max_uses !== undefined && max_uses !== null) insertData.max_uses = max_uses
    if (expires_at !== undefined) insertData.expires_at = expires_at
    if (grants_platform_role && ['ssi_admin', 'popty_user'].includes(grants_platform_role)) {
      insertData.grants_platform_role = grants_platform_role
    }
    if (grants_dashboard_courses && Array.isArray(grants_dashboard_courses) && grants_dashboard_courses.length > 0) {
      insertData.grants_dashboard_courses = grants_dashboard_courses
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
    res.status(201).json({
      code: created.code,
      id: created.id,
    })
  } catch (error: any) {
    console.error('[EntitlementCreate] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
