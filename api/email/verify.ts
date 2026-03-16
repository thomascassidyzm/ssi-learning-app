/**
 * POST /api/email/verify
 *
 * Verifies an OTP for a new email and adds it to the learner's verified_emails.
 * Uses the service role to verify the OTP server-side so the client session
 * isn't disrupted.
 *
 * Body: { email: string, token: string }
 * Auth: Bearer token (current user's JWT)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getAuthUserId } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify the requesting user is authenticated
  const userId = await getAuthUserId(req)
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { email, token } = req.body || {}

  if (!email || !token) {
    return res.status(400).json({ error: 'Missing email or token' })
  }

  const normalizedEmail = email.toLowerCase().trim()

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Verify the OTP server-side using the admin client
    // This confirms the user has access to this email without affecting client session
    const { error: verifyError } = await admin.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type: 'email',
    })

    if (verifyError) {
      return res.status(400).json({ error: verifyError.message || 'Invalid code' })
    }

    // OTP is valid — check this email isn't already linked to a DIFFERENT learner
    const { data: existingLearner } = await admin
      .from('learners')
      .select('id, user_id')
      .contains('verified_emails', [normalizedEmail])
      .single()

    if (existingLearner && existingLearner.user_id !== userId) {
      return res.status(409).json({
        error: 'This email is already linked to another account',
      })
    }

    // Add the email to this learner's verified_emails
    const { data: learner } = await admin
      .from('learners')
      .select('id, verified_emails')
      .eq('user_id', userId)
      .single()

    if (!learner) {
      return res.status(404).json({ error: 'Learner not found' })
    }

    const currentEmails: string[] = learner.verified_emails || []
    if (!currentEmails.includes(normalizedEmail)) {
      const updated = [...currentEmails, normalizedEmail]
      const { error: updateError } = await admin
        .from('learners')
        .update({ verified_emails: updated })
        .eq('id', learner.id)

      if (updateError) {
        return res.status(500).json({ error: updateError.message })
      }
    }

    return res.status(200).json({ success: true, email: normalizedEmail })
  } catch (err: any) {
    console.error('[email/verify] Error:', err)
    return res.status(500).json({ error: 'Verification failed' })
  }
}
