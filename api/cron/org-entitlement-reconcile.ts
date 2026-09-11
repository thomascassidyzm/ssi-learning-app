/**
 * Free-period reconciliation — /api/cron/org-entitlement-reconcile
 * ================================================================
 *
 * THE FAILURE THIS EXISTS TO PREVENT. An enrolment is a promise and the
 * user_entitlements row is what keeps it; a learner holding the first without
 * the second is entitled to nothing, permanently, and nobody finds out. It
 * used to be entirely silent: api/org/enrol.ts swallowed a failed grant while
 * still reporting success, and api/_utils/orgFreeAccess.ts reads the
 * INTERSECTION of policy and entitlement, so an empty intersection just sells
 * the learner a course their funder had already paid for. Nothing anywhere
 * looked for the gap.
 *
 * The endpoint no longer lies and every replay path heals, so this is the
 * backstop rather than the fix — for the learner who never came back, and for
 * anything a future writer gets wrong. Daily, at a quiet hour.
 *
 * IT REPAIRS RATHER THAN REPORTS. A detected gap is closed on the spot,
 * through the same api/_utils/orgEntitlementGrant.ts rule the endpoint uses,
 * with the ENROLMENT'S OWN free_access_until as the expiry — the learner's year
 * runs from their enrolment date and a repair must never quietly extend it.
 * The grant's primary key is computed from learner and group, so a repair
 * racing a live enrolment cannot produce two grants.
 *
 * HOW AN OPERATOR SEES IT RAN. One summary line per run —
 * `[cron/org-entitlement-reconcile] considered N, repaired M, failed K` — and
 * the same three numbers in the JSON body, so the Vercel cron log for this
 * path shows both the invocation and the outcome, and a human or a probe with
 * the bearer can hit the endpoint and read the identical answer. A repaired
 * learner is also named in the log, so a repair is checkable against the row.
 *
 * Auth: the same CRON_SECRET bearer as every other cron in this directory,
 * failing closed on every deployed environment.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { checkCronAuth } from '../_utils/cronAuth'
import { ensureOrgEntitlement } from '../_utils/orgEntitlementGrant'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const cronSecret = (process.env.CRON_SECRET || '').trim()

/** One page is plenty: the whole table is in the low thousands at most. */
const PAGE = 1000

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const cronAuth = checkCronAuth((req.headers.authorization || '').trim(), cronSecret)
  if (!cronAuth.ok) {
    console.error(`[cron/org-entitlement-reconcile] ${cronAuth.error} — refusing to run`)
    res.status(cronAuth.status || 401).json({ error: cronAuth.error })
    return
  }
  if (cronAuth.warning) console.warn(`[cron/org-entitlement-reconcile] ${cronAuth.warning}`)
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const now = new Date()

  try {
    const { data: policies } = await supabase
      .from('org_enrolment_policies')
      .select('group_id, org_display_name, granted_courses')
    const policyByGroup = new Map(((policies ?? []) as any[]).map((p) => [p.group_id, p]))
    if (!policyByGroup.size) {
      console.log('[cron/org-entitlement-reconcile] considered 0, repaired 0, failed 0')
      res.status(200).json({ considered: 0, repaired: 0, failed: 0 })
      return
    }

    const { data: enrolments } = await supabase
      .from('org_enrolments')
      .select('id, learner_id, group_id, free_access_until')
      .limit(PAGE)

    // Only enrolments whose policy actually grants something can be broken. A
    // policy with an empty granted_courses list correctly produces no
    // entitlement row, and counting those as failures would be crying wolf
    // daily for ever.
    const candidates = ((enrolments ?? []) as any[]).filter((e) => {
      const p = policyByGroup.get(e.group_id)
      return !!p && Array.isArray(p.granted_courses) && p.granted_courses.length > 0
    })

    let repaired = 0
    let failed = 0
    for (const row of candidates) {
      const policy = policyByGroup.get(row.group_id)
      const outcome = await ensureOrgEntitlement(
        supabase,
        row.learner_id,
        row.group_id,
        policy.granted_courses,
        row.free_access_until,
        now,
      )
      if (outcome.status === 'granted') {
        repaired++
        // Named, so the repair is checkable against the row rather than being
        // a number an operator has to take on trust.
        console.warn(
          '[cron/org-entitlement-reconcile] repaired a missing free period — enrolment',
          row.id,
          'learner',
          row.learner_id,
        )
      } else if (outcome.status === 'failed') {
        failed++
        console.error('[cron/org-entitlement-reconcile] repair failed for enrolment', row.id, outcome.error)
      }
    }

    console.log(
      `[cron/org-entitlement-reconcile] considered ${candidates.length}, repaired ${repaired}, failed ${failed}`,
    )
    res.status(200).json({ considered: candidates.length, repaired, failed })
  } catch (error: any) {
    console.error('[cron/org-entitlement-reconcile] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
