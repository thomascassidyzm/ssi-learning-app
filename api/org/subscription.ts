/**
 * Org platform subscription status — GET /api/org/subscription
 *
 * Server-side read of the org billing gate, sibling of api/school/subscription.ts.
 * An org is a class-less `groups` node priced identically to a school (see
 * api/_utils/orgPlatform.ts); this endpoint answers "is this org still
 * entitled to its dashboard?" for the org-leader manager UI.
 *
 * Auth required. The org is resolved from the caller's OWN govt_admins row
 * (leaderGroupId) — never from a client-supplied id — except an ssi_admin
 * caller, who may pass ?group_id= to inspect any org (mirrors the ssi_admin
 * escape hatch in api/invite/create.ts: the platform operator reaches other
 * leaders' orgs deliberately, not by impersonation).
 *
 * Returns:
 *   {
 *     org: { id, name, platform_status, platform_expires_at, seats, member_count } | null,
 *     gate: { active: boolean, trial_days_remaining: number },
 *   }
 *
 * FAILS OPEN: no org resolved, or the platform-billing migration unapplied →
 * `org: null`, `gate.active: true` — never lock a leader out of their own
 * dashboard on infra.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { isPlatformActive } from '../_utils/platformStatus'
import { leaderGroupId, readOrgPlatformState, countSubtreeMembers } from '../_utils/orgPlatform'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

function trialDaysRemaining(status: string | null, expiresAt: string | null): number {
  if (status !== 'trial' || !expiresAt) return 0
  const ms = new Date(expiresAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized', org: null, gate: { active: true, trial_days_remaining: 0 } })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[org/subscription] Missing Supabase configuration')
    res.status(200).json({ org: null, gate: { active: true, trial_days_remaining: 0 } })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    let groupId = await leaderGroupId(supabase, auth.userId)

    // ssi_admin escape hatch: honour ?group_id= ONLY when the caller leads no
    // org of their own — a real leader always gets their OWN org, never one
    // spoofed via the query string (same invariant as invite/create.ts).
    if (!groupId) {
      const rawGroupId = req.query?.group_id
      const requestedGroupId = Array.isArray(rawGroupId) ? rawGroupId[0] : rawGroupId
      if (requestedGroupId) {
        const { data: learner } = await supabase
          .from('learners')
          .select('platform_role')
          .eq('user_id', auth.userId)
          .maybeSingle()
        if (learner?.platform_role === 'ssi_admin') {
          groupId = requestedGroupId
        }
      }
    }

    if (!groupId) {
      res.status(200).json({ org: null, gate: { active: true, trial_days_remaining: 0 }, reason: 'no-org' })
      return
    }

    const [{ data: group }, platformState] = await Promise.all([
      supabase.from('groups').select('id, name').eq('id', groupId).maybeSingle(),
      readOrgPlatformState(supabase, groupId),
    ])

    if (!group) {
      res.status(200).json({ org: null, gate: { active: true, trial_days_remaining: 0 }, reason: 'no-org' })
      return
    }

    // SUBTREE, not this node alone. The count exists to drive the manager UI's
    // honest "you're paying for N seats, you have M people" display, so it must
    // count exactly the people the org is actually covering — and
    // resolveOrgCourseCoverage covers members of clock-less SUB-groups too
    // (they bill through this org). Counting only direct members would
    // undercount every org that uses sub-groups — e.g. a council whose staff
    // all sit in departments would read as zero members — and quietly lead a
    // leader to buy too few seats.
    const memberCount = await countSubtreeMembers(supabase, groupId)

    const status = platformState?.platform_status ?? null
    const expiresAt = platformState?.platform_expires_at ?? null
    const active = isPlatformActive(status, expiresAt)

    res.status(200).json({
      org: {
        id: group.id,
        name: (group as any).name ?? null,
        platform_status: status,
        platform_expires_at: expiresAt,
        seats: platformState?.seats ?? null,
        member_count: memberCount ?? 0,
      },
      gate: {
        active,
        trial_days_remaining: trialDaysRemaining(status, expiresAt),
      },
    })
  } catch (err) {
    console.error('[org/subscription] Error:', err)
    res.status(200).json({ org: null, gate: { active: true, trial_days_remaining: 0 }, reason: 'error-fail-open' })
  }
}
