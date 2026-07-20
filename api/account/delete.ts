/**
 * Delete the caller's own account — POST /api/account/delete
 *
 * Server-mediated replacement for SettingsScreen.vue's confirmDelete, which
 * ran six client-side `.delete()` calls the `authenticated` role has no
 * DELETE grant for (permission-denied, silently swallowed — the false
 * "Account deleted successfully" bug) and never touched the Supabase Auth
 * identity at all, since the client SDK has no admin API. That identity is
 * the actual GDPR gap: without removing it, the person can still sign back
 * in, and the auth.users→learners provisioning trigger hands them a fresh
 * blank learner row under the same email — "deleted" in name only.
 *
 * Every learner-scoped table (response_metrics, spike_events, lego_progress,
 * seed_progress, sessions, course_enrollments, subscriptions,
 * user_entitlements, learner_points, learner_milestones, offline_leases,
 * learner_emails, and more — verified live via FK introspection) already
 * carries `learner_id REFERENCES learners(id) ON DELETE CASCADE`. Deleting
 * the learners row is therefore both correct and complete: it reaches every
 * cascaded table in one atomic statement instead of an enumerated list that
 * silently drifts out of date as new learner-scoped tables are added.
 *
 * Two tables intentionally do NOT cascade (ON DELETE RESTRICT):
 * classes.class_learner_id (synthetic play-as-class learner entities) and
 * family_members.owner_learner_id/member_learner_id. A real learner hitting
 * either means the delete needs a human decision first (family transfer,
 * class-entity reassignment) — surfaced as a clear 409, never silently
 * skipped and never partially applied.
 *
 * Auth: verifyAuthToken only — this deletes the CALLER's own account. There
 * is no target-user parameter; accepting one would let any authenticated
 * caller delete someone else's account.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const FK_RESTRICT_VIOLATION = '23503'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[account/delete] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Resolve the caller's OWN learner row from their verified auth id —
    // never from the request body, so there is no target-account parameter
    // to abuse.
    const { data: learner, error: learnerLookupErr } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (learnerLookupErr) {
      console.error('[account/delete] Learner lookup failed:', learnerLookupErr)
      res.status(500).json({ error: 'Failed to look up account', detail: learnerLookupErr.message })
      return
    }

    // Deleting the learners row cascades to every learner-scoped table via
    // ON DELETE CASCADE (verified live: response_metrics, spike_events,
    // lego_progress, seed_progress, sessions, course_enrollments,
    // subscriptions, user_entitlements, learner_points, learner_milestones,
    // offline_leases, learner_emails, and the rest of the learner-data
    // spine) — one statement, nothing to enumerate or let drift.
    if (learner) {
      const { error: deleteErr } = await supabase.from('learners').delete().eq('id', learner.id)
      if (deleteErr) {
        if (deleteErr.code === FK_RESTRICT_VIOLATION) {
          console.warn('[account/delete] Blocked by FK restrict (family/class-entity link):', deleteErr.message)
          res.status(409).json({
            error: 'Your account is linked to a family plan or a school class and cannot be deleted automatically. Contact support to complete this.',
          })
          return
        }
        console.error('[account/delete] Data deletion failed:', deleteErr)
        res.status(500).json({ error: 'Failed to delete account data', detail: deleteErr.message, dataDeleted: false, authDeleted: false })
        return
      }
    }

    // Remove the Auth identity itself — the step the client SDK cannot do.
    // Run this AFTER data deletion: if this step fails, the account is left
    // data-erased-but-signable-in (recoverable — retry this endpoint, or an
    // admin can force it), which is safer than the reverse order leaving
    // undeleted personal data behind an identity nobody can sign in to
    // retry with.
    const { error: authDeleteErr } = await supabase.auth.admin.deleteUser(auth.userId)
    if (authDeleteErr) {
      console.error('[account/delete] Auth identity deletion failed:', authDeleteErr)
      res.status(500).json({
        error: 'Account data was deleted, but the sign-in identity could not be removed. Please contact support.',
        dataDeleted: true,
        authDeleted: false,
      })
      return
    }

    res.status(200).json({ ok: true, dataDeleted: true, authDeleted: true })
  } catch (err: any) {
    console.error('[account/delete] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
