/**
 * Invite Code Creation API - POST /api/invite/create
 *
 * Requires Clerk JWT. Creates a new invite code. Caller must have appropriate
 * permission for the code_type they're creating.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyClerkToken } from '../_utils/clerk'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

// Consonants only, excluding I and O (confusable with 1 and 0)
const CODE_CONSONANTS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

function generateCode(): string {
  let letters = ''
  for (let i = 0; i < 3; i++) {
    letters += CODE_CONSONANTS[Math.floor(Math.random() * CODE_CONSONANTS.length)]
  }
  let digits = ''
  for (let i = 0; i < 3; i++) {
    digits += Math.floor(Math.random() * 10).toString()
  }
  return `${letters}-${digits}`
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Verify Clerk JWT
  const authResult = await verifyClerkToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const {
    code_type,
    grants_region,
    grants_school_id,
    grants_class_id,
    metadata,
    expires_at,
    max_uses,
  } = req.body || {}

  if (!code_type || typeof code_type !== 'string') {
    res.status(400).json({ error: 'Missing code_type' })
    return
  }

  const validCodeTypes = ['govt_admin', 'school_admin', 'teacher', 'student']
  if (!validCodeTypes.includes(code_type)) {
    res.status(400).json({ error: 'Invalid code_type' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Verify caller has permission for the code_type
    if (code_type === 'govt_admin') {
      const { data: learner } = await supabase
        .from('learners')
        .select('platform_role')
        .eq('user_id', userId)
        .single()
      if (!learner || learner.platform_role !== 'ssi_admin') {
        res.status(403).json({ error: 'Only SSi admins can create govt_admin codes' })
        return
      }
    } else if (code_type === 'school_admin') {
      const { data: govtAdmin } = await supabase
        .from('govt_admins')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()
      if (!govtAdmin) {
        res.status(403).json({ error: 'Only government admins can create school_admin codes' })
        return
      }
    } else if (code_type === 'teacher') {
      if (!grants_school_id) {
        res.status(400).json({ error: 'grants_school_id required for teacher codes' })
        return
      }
      const { data: school } = await supabase
        .from('schools')
        .select('id')
        .eq('id', grants_school_id)
        .eq('admin_user_id', userId)
        .maybeSingle()
      if (!school) {
        res.status(403).json({ error: 'Only the school admin can create teacher codes for this school' })
        return
      }
    } else if (code_type === 'student') {
      if (!grants_class_id) {
        res.status(400).json({ error: 'grants_class_id required for student codes' })
        return
      }
      const { data: classRow } = await supabase
        .from('classes')
        .select('id')
        .eq('id', grants_class_id)
        .eq('teacher_user_id', userId)
        .maybeSingle()
      if (!classRow) {
        res.status(403).json({ error: 'Only the class teacher can create student codes for this class' })
        return
      }
    }

    // Generate unique code with up to 10 retries
    let newCode: string | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateCode()
      const { data: existing } = await supabase
        .from('invite_codes')
        .select('id')
        .eq('code', candidate)
        .maybeSingle()
      if (!existing) {
        newCode = candidate
        break
      }
    }

    if (!newCode) {
      console.error('[InviteCreate] Failed to generate unique code after 10 attempts')
      res.status(500).json({ error: 'Could not generate unique code, please try again' })
      return
    }

    // Insert the new invite code
    const insertData: Record<string, unknown> = {
      code: newCode,
      code_type,
      created_by: userId,
      is_active: true,
    }
    if (grants_region !== undefined) insertData.grants_region = grants_region
    if (grants_school_id !== undefined) insertData.grants_school_id = grants_school_id
    if (grants_class_id !== undefined) insertData.grants_class_id = grants_class_id
    if (metadata !== undefined) insertData.metadata = metadata
    if (expires_at !== undefined) insertData.expires_at = expires_at
    if (max_uses !== undefined) insertData.max_uses = max_uses

    const { data: created, error: insertError } = await supabase
      .from('invite_codes')
      .insert(insertData)
      .select('id, code')
      .single()

    if (insertError || !created) {
      console.error('[InviteCreate] Failed to insert invite code:', insertError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    console.log('[InviteCreate] Created code:', newCode, 'type:', code_type, 'by:', userId)
    res.status(201).json({
      code: created.code,
      id: created.id,
    })
  } catch (error) {
    console.error('[InviteCreate] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
