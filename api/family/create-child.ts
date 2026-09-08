/**
 * SSi Family — POST /api/family/create-child (FAMILY-PLAN-SPEC.md §4.1(b))
 *
 * The age-verification sidestep, preserved religiously. Owner-only. Body:
 * { display_name }. Creates a Supabase auth user on a SYNTHETIC address we
 * own (fam-<uuid>@members.saysomethingin.app, email_confirm:true via the
 * admin API — never sent, never seen), a learners row, and an ACTIVE
 * membership (is_child_account: true). Returns a one-time sign-in link
 * (magiclink, never emailed) for the parent to open/scan on the kid's
 * device once. The child never enters an email, password, or birthday —
 * the parent performs every step; the account's only PII is a first name.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { verifyAuthToken } from '../_utils/auth'
import { resolveLearnerId, countUsedSeats, FAMILY_SEAT_CAP } from '../_utils/familyMembership'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const SYNTHETIC_EMAIL_DOMAIN = 'members.saysomethingin.app'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const rawName = (req.body || {}).display_name
  const displayName = typeof rawName === 'string' ? rawName.trim() : ''
  if (!displayName) {
    res.status(400).json({ error: 'display_name is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const ownerLearnerId = await resolveLearnerId(supabase, authResult.userId)
  if (!ownerLearnerId) {
    res.status(404).json({ error: 'Learner account not found' })
    return
  }

  const usedSeats = await countUsedSeats(supabase, ownerLearnerId)
  if (usedSeats >= FAMILY_SEAT_CAP) {
    res.status(400).json({ error: `Family is full (${FAMILY_SEAT_CAP} seats including you)` })
    return
  }

  const syntheticEmail = `fam-${randomUUID()}@${SYNTHETIC_EMAIL_DOMAIN}`

  // WHAT GOES WRONG HERE IS SAID IN FULL. "Failed to create child account" was
  // the whole of what a parent saw on 2026-09-07 — no cause, nothing to do
  // next. Every failure below says what did not happen and that nothing was
  // left half-made, so trying again is safe and obviously so.
  const tryAgain = `We could not set up ${displayName}'s account, and nothing was saved. Please try again in a moment.`

  const { data: createdUser, error: createUserErr } = await supabase.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true, // never sent, never seen — synthetic address we own
    user_metadata: { family_child: true, display_name: displayName },
  })
  if (createUserErr || !createdUser?.user) {
    console.error('[family/create-child] auth user creation failed:', createUserErr)
    res.status(500).json({ error: tryAgain, detail: 'auth_user' })
    return
  }
  const childUserId = createdUser.user.id as string

  // THE ROW THE DATABASE HAS ALREADY MADE. `on_auth_user_created` fires on the
  // insert above and writes the learners row itself, naming it from the
  // display_name in user_metadata. This endpoint used to INSERT a second one
  // and hit learners_user_id_key every single time — so no child account had
  // ever been created on the live database (zero rows, checked 2026-09-08),
  // and every parent who tried saw "Failed to create child account". Upsert
  // on user_id adopts the trigger's row, and still creates one wherever the
  // trigger is absent.
  const { data: childLearner, error: learnerErr } = await supabase
    .from('learners')
    .upsert({ user_id: childUserId, display_name: displayName }, { onConflict: 'user_id' })
    .select('id')
    .single()

  if (learnerErr || !childLearner) {
    console.error('[family/create-child] learner row creation failed:', learnerErr)
    // Best-effort cleanup so a failed create-child never leaves an orphaned
    // auth user with no matching learner (would silently fail every future
    // sign-in link for this child).
    await supabase.auth.admin.deleteUser(childUserId).catch(() => {})
    res.status(500).json({ error: tryAgain, detail: 'learner_row' })
    return
  }

  const { data: membership, error: memberErr } = await supabase
    .from('family_members')
    .insert({
      owner_learner_id: ownerLearnerId,
      member_learner_id: childLearner.id,
      is_child_account: true,
      status: 'active',
    })
    .select('*')
    .single()

  if (memberErr || !membership) {
    console.error('[family/create-child] membership creation failed:', memberErr)
    await supabase.auth.admin.deleteUser(childUserId).catch(() => {})
    res.status(500).json({ error: tryAgain, detail: 'membership' })
    return
  }

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: syntheticEmail,
  })
  if (linkErr || !linkData?.properties?.action_link) {
    console.error('[family/create-child] sign-in link generation failed:', linkErr)
    // The account exists and is entitled — don't roll it back over a link
    // failure; the parent can re-mint via /api/family/signin-link.
    res.status(200).json({ member: membership, signInLink: null, linkError: `${displayName}'s account is ready, but we could not make a sign-in link just now. Tap "Get sign-in link" on their row to try again.` })
    return
  }

  res.status(200).json({ member: membership, signInLink: linkData.properties.action_link })
}
