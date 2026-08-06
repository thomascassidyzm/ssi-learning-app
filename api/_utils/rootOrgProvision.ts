/**
 * createRootOrgAndLeader — the ONE place that mints a brand-new root org and
 * makes its creator the leader, so the contract can't drift between the two
 * callers that both need it: POST /api/groups (self-serve root creation,
 * founder ruling 2026-08-02) and POST /api/onboarding/provision's 'org'
 * track (the /orgs signup door).
 *
 * Does exactly what the self-serve lane in api/groups/index.ts always did:
 * insert a root `groups` row (type 'organisation', stamped with the 30-day
 * org trial via orgTrialStamp), fail open onto the pre-migration schema, then
 * mint the caller's govt_admins leader row AND their leader membership tag
 * (groupLeaderTag — founder ruling 2026-08-06). On a leader-insert failure it
 * rolls back the just-created group rather than stranding an orphaned root
 * the caller can't see or manage.
 *
 * Callers are responsible for checking the caller doesn't already lead a
 * group BEFORE calling this — it always mints a NEW org + NEW leader row,
 * never checks or dedupes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { orgTrialStamp } from './orgPlatform'
import { isMissingPlatformSchema } from './schoolPlatformTrial'
import { ensureGroupLeaderTag } from './groupLeaderTag'

export interface RootOrg {
  id: string
  name: string
  platform_status: string | null
  platform_expires_at: string | null
}

export async function createRootOrgAndLeader(
  supabase: SupabaseClient,
  userId: string,
  name: string,
): Promise<RootOrg> {
  const row: Record<string, unknown> = {
    name: name.trim(),
    type: 'organisation',
    ...orgTrialStamp(),
  }

  let { data, error } = await supabase.from('groups').insert(row).select().single()

  // Fail open on an un-migrated DB (20260801_org_platform_billing not yet
  // applied): retry the plain insert so org creation never depends on the
  // billing columns existing.
  if (error && isMissingPlatformSchema(error)) {
    delete (row as Record<string, unknown>).platform_status
    delete (row as Record<string, unknown>).platform_expires_at
    ;({ data, error } = await supabase.from('groups').insert(row).select().single())
  }
  if (error) throw error

  const { error: leaderError } = await supabase.from('govt_admins').insert({
    user_id: userId,
    group_id: data.id,
    organization_name: data.name,
    created_by: userId,
  })
  if (leaderError) {
    // Don't strand an orphaned root the caller can't see or manage.
    await supabase.from('groups').delete().eq('id', data.id)
    throw leaderError
  }

  // …and make that leadership a MEMBERSHIP too (founder ruling 2026-08-06:
  // the creator of an org becomes its first manager). govt_admins is authz
  // only — every people list in the org UI reads user_tags, which is why
  // creators used to end up governing a group they weren't in. Best-effort:
  // the org and its authz row are already sound, and the read side unions
  // govt_admins, so a failure here costs visibility, never the org.
  await ensureGroupLeaderTag(supabase, { groupId: data.id, userId, addedBy: userId })

  return {
    id: data.id,
    name: data.name,
    platform_status: (data as any).platform_status ?? null,
    platform_expires_at: (data as any).platform_expires_at ?? null,
  }
}
