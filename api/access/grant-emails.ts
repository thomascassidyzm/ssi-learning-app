/**
 * Email-allowlist admin API - POST /api/access/grant-emails
 *
 * ADMIN-GATED (ssi_admin / god — via verifyAdmin). Paste a list of emails and
 * those users get free access automatically on their next sign-in (via
 * /api/access/claim), with no code to type.
 *
 * Behaviour:
 *  - Insert an email_access_grants row per email (deduped: skip if an active,
 *    unredeemed grant for the same normalized email + same access already
 *    exists).
 *  - Best-effort APPLY IMMEDIATELY to existing accounts so already-signed-up
 *    waiting users don't have to re-sign-in: for each email, find learners whose
 *    verified_emails contains it (case-insensitive) and apply now. Non-fatal.
 *
 * Returns { created, applied_now }.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyGrantsForLearner } from './claim'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

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

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }
  const adminUserId = adminResult.userId

  const {
    emails,
    access_type = 'full',
    granted_courses,
    duration_type = 'lifetime',
    duration_days,
    grants_platform_role,
    grants_dashboard_courses,
    label,
  } = req.body || {}

  if (!Array.isArray(emails) || emails.length === 0) {
    res.status(400).json({ error: 'emails must be a non-empty array' })
    return
  }

  if (!['full', 'courses'].includes(access_type)) {
    res.status(400).json({ error: 'Invalid access_type (must be "full" or "courses")' })
    return
  }
  if (access_type === 'courses' && (!Array.isArray(granted_courses) || granted_courses.length === 0)) {
    res.status(400).json({ error: 'granted_courses required for "courses" access type' })
    return
  }
  if (!['lifetime', 'time_limited'].includes(duration_type)) {
    res.status(400).json({ error: 'Invalid duration_type (must be "lifetime" or "time_limited")' })
    return
  }
  if (duration_type === 'time_limited' && (!duration_days || typeof duration_days !== 'number' || duration_days < 1)) {
    res.status(400).json({ error: 'duration_days required for time_limited grants (must be >= 1)' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Normalize + dedupe the input list itself.
  const normalizedSet = new Set<string>()
  const cleanEmails: string[] = []
  for (const raw of emails) {
    if (typeof raw !== 'string') continue
    const norm = raw.toLowerCase().trim()
    if (!norm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm)) continue
    if (normalizedSet.has(norm)) continue
    normalizedSet.add(norm)
    cleanEmails.push(raw.trim())
  }

  if (cleanEmails.length === 0) {
    res.status(400).json({ error: 'No valid emails provided' })
    return
  }

  let created = 0
  let appliedNow = 0

  try {
    for (const email of cleanEmails) {
      const normalizedEmail = email.toLowerCase().trim()

      // Dedupe: is there already an active, unredeemed grant of the SAME access
      // for this email? If so, skip creating a duplicate.
      const { data: existingGrants } = await supabase
        .from('email_access_grants')
        .select('id, access_type, granted_courses')
        .eq('email_normalized', normalizedEmail)
        .eq('is_active', true)
        .is('redeemed_at', null)

      const sameAccessExists = (existingGrants || []).some(g =>
        g.access_type === access_type &&
        JSON.stringify(((g.granted_courses as string[] | null) || []).slice().sort()) ===
          JSON.stringify(((access_type === 'courses' ? granted_courses : []) as string[]).slice().sort()),
      )

      let grantId: string | null = null

      if (sameAccessExists) {
        // Reuse the existing matching grant for the immediate-apply step.
        grantId = (existingGrants!.find(g => g.access_type === access_type)?.id as string) ?? null
      } else {
        const insertRow: Record<string, unknown> = {
          email,
          access_type,
          duration_type,
          created_by: adminUserId,
          is_active: true,
        }
        if (access_type === 'courses') insertRow.granted_courses = granted_courses
        if (duration_type === 'time_limited') insertRow.duration_days = duration_days
        if (grants_platform_role) insertRow.grants_platform_role = grants_platform_role
        if (Array.isArray(grants_dashboard_courses) && grants_dashboard_courses.length > 0) {
          insertRow.grants_dashboard_courses = grants_dashboard_courses
        }
        if (label) insertRow.label = label

        const { data: createdRow, error: insertError } = await supabase
          .from('email_access_grants')
          .insert(insertRow)
          .select('id')
          .single()

        if (insertError || !createdRow) {
          console.error('[GrantEmails] Failed to insert grant for', normalizedEmail, insertError)
          continue
        }
        created += 1
        grantId = createdRow.id as string
      }

      // Best-effort immediate apply to existing accounts (waiting users).
      if (grantId) {
        const { data: learners } = await supabase
          .from('learners')
          .select('id, verified_emails')
          .contains('verified_emails', [normalizedEmail])

        // .contains is case-sensitive; verified_emails are stored lowercased on
        // write, but guard anyway by re-checking case-insensitively.
        for (const learner of learners || []) {
          const emails: string[] = (learner.verified_emails as string[] | null) || []
          const matches = emails.some(e => e.toLowerCase().trim() === normalizedEmail)
          if (!matches) continue
          try {
            const result = await applyGrantsForLearner(supabase, learner.id as string, normalizedEmail)
            appliedNow += result.granted
          } catch (applyErr) {
            console.error('[GrantEmails] Immediate apply failed (non-fatal):', applyErr)
          }
        }
      }
    }

    res.status(200).json({ created, applied_now: appliedNow })
  } catch (err) {
    console.error('[GrantEmails] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
