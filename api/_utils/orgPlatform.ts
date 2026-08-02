/**
 * Org / workplace platform billing — the shared contract (founder-specced
 * 2026-08-01), sibling of api/_utils/schoolPlatformTrial.ts.
 *
 * An org is a class-less group node. It prices EXACTLY as a school prices
 * teachers: £15/seat/month or £150/seat/year, seats = the Paddle quantity on a
 * single per-seat price. A new org gets a 30-day all-language trial, and
 * upgrading CONVERTS THAT ORG IN PLACE — the same `groups` row flips
 * trial → active; nothing is re-provisioned, no second node is minted, and
 * every invite/sub-group/member created during the trial survives untouched.
 * Upgrade is reachable at ANY point in the trial, not only at expiry.
 *
 * Everything here operates on the SAME column quintet the school lane uses
 * (platform_status / platform_expires_at / seats / provider_*), so the gate
 * (isPlatformActive) and the webhook stay one code path per concern.
 *
 * FAILS OPEN, like the school lane: if migration 20260801_org_platform_billing
 * is unapplied (columns absent) the trial stamp no-ops and the gate treats a
 * NULL status as live, so org creation keeps working on an un-migrated DB.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingPlatformSchema } from './schoolPlatformTrial'
import { chunk } from './schoolScope'
import { ORG_TRIAL_DAYS } from './trialPolicy'

/** Founder ruling 2026-08-02: 30-day free trial covering ALL languages —
 * sourced from trialPolicy.ts, the single trial-length policy point. */
export { ORG_TRIAL_DAYS }

/** Founder ruling 2026-08-01: standard per-seat price, no volume scaling. */
export const ORG_PRICE_PER_SEAT_GBP = 15
export const ORG_ANNUAL_PRICE_PER_SEAT_GBP = 150

export interface OrgPlatformState {
  platform_status: string | null
  platform_expires_at: string | null
  seats: number | null
  provider_subscription_id?: string | null
  provider_customer_id?: string | null
}

function isoIn(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * The columns to stamp on a NEWLY created org so its 30-day clock starts at
 * creation. Returned as a patch (rather than applied here) so the creating
 * endpoint can fold it into its single INSERT — one round trip, and the org is
 * never briefly visible without a clock.
 */
export function orgTrialStamp(days: number = ORG_TRIAL_DAYS): {
  platform_status: string
  platform_expires_at: string
} {
  return { platform_status: 'trial', platform_expires_at: isoIn(days) }
}

/**
 * Start (or restart) the trial clock on an EXISTING org node. Used by the
 * backfill path for orgs created before this migration — e.g. the live
 * 'Gwynedd Council' org, which predates the clock and would otherwise sit on a
 * NULL status forever (fail-open = free forever).
 *
 * Never touches an org that is already 'active' (paid) — converting a paying
 * customer back to a trial would be a silent downgrade.
 */
export async function ensureOrgTrial(
  svc: SupabaseClient,
  groupId: string,
  days: number = ORG_TRIAL_DAYS,
): Promise<{ started: boolean; schemaUnavailable?: boolean }> {
  const { data, error } = await svc
    .from('groups')
    .select('platform_status')
    .eq('id', groupId)
    .maybeSingle()
  if (error) {
    if (isMissingPlatformSchema(error)) return { started: false, schemaUnavailable: true }
    return { started: false }
  }
  if ((data as any)?.platform_status) return { started: false }

  const { error: updateError } = await svc
    .from('groups')
    .update(orgTrialStamp(days))
    .eq('id', groupId)
  if (updateError) {
    if (isMissingPlatformSchema(updateError)) return { started: false, schemaUnavailable: true }
    return { started: false }
  }
  return { started: true }
}

/**
 * The org a caller LEADS, server-derived from their own govt_admins row — the
 * same rule that makes every leader-minted invite group-bound
 * (api/invite/create.ts). The client never sends a group id; it is read off
 * the caller's verified identity here.
 *
 * Returns null for a caller who leads nothing. ssi_admins are deliberately NOT
 * special-cased: the platform operator reaches any org through the /admin
 * surfaces, not by being silently treated as its leader.
 */
export async function leaderGroupId(
  svc: SupabaseClient,
  authUid: string,
): Promise<string | null> {
  const { data } = await svc
    .from('govt_admins')
    .select('group_id')
    .eq('user_id', authUid)
    .maybeSingle()
  return ((data as any)?.group_id as string | undefined) ?? null
}

/**
 * How many DISTINCT people this org is covering — itself plus every descendant
 * node, matched by path prefix (the same subtree rule schoolsForGroupSubtree
 * uses for schools, applied to people).
 *
 * Subtree, not this node alone, because that is exactly the population
 * `resolveOrgCourseCoverage` entitles: a clock-less sub-group bills through its
 * org. It also drives the manager UI's honest "N seats paid, M people" display
 * — an org whose staff all sit in departments would otherwise read as zero
 * members and lead its leader to buy too few seats.
 *
 * Distinct by person: someone tagged into two departments is one seat, not two.
 */
export async function countSubtreeMembers(
  svc: SupabaseClient,
  groupId: string,
): Promise<number> {
  const { data: group } = await svc.from('groups').select('path').eq('id', groupId).maybeSingle()
  const path = (group as any)?.path as string | undefined

  // No path (trigger hasn't stamped it, or a bare node) → fall back to the node
  // itself, which is still correct, just narrower.
  let nodeIds: string[] = [groupId]
  if (path) {
    const { data: subtree } = await svc.from('groups').select('id').like('path', `${path}%`)
    const ids = (subtree ?? []).map((g: any) => g.id).filter(Boolean)
    if (ids.length > 0) nodeIds = ids
  }

  const people = new Set<string>()
  for (const batch of chunk(nodeIds)) {
    const { data } = await svc
      .from('user_tags')
      .select('user_id, tag_value')
      .eq('tag_type', 'group')
      .in('tag_value', batch.map((id) => `GROUP:${id}`))
      .is('removed_at', null)
    for (const t of data ?? []) if ((t as any).user_id) people.add((t as any).user_id)
  }
  return people.size
}

/**
 * Read an org's billing state. Returns null when the row is absent; returns a
 * fully-null state (not an error) when the migration is unapplied, so callers
 * degrade to "no clock" rather than 500ing.
 */
export async function readOrgPlatformState(
  svc: SupabaseClient,
  groupId: string,
): Promise<OrgPlatformState | null> {
  const { data, error } = await svc
    .from('groups')
    .select('platform_status, platform_expires_at, seats, provider_subscription_id, provider_customer_id')
    .eq('id', groupId)
    .maybeSingle()

  if (error) {
    if (isMissingPlatformSchema(error)) {
      return { platform_status: null, platform_expires_at: null, seats: null }
    }
    return null
  }
  if (!data) return null

  return {
    platform_status: (data as any).platform_status ?? null,
    platform_expires_at: (data as any).platform_expires_at ?? null,
    seats: (data as any).seats ?? null,
    provider_subscription_id: (data as any).provider_subscription_id ?? null,
    provider_customer_id: (data as any).provider_customer_id ?? null,
  }
}
