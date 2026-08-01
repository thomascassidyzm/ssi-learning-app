/**
 * orgLeader — the one shared "may this leader act on this node?" predicate,
 * factored out so api/groups/index.ts, api/groups/[id].ts, and
 * api/invite/create.ts don't each hand-roll the same rule (founder ruling
 * 2026-08-01: a group-leader (govt_admin) has "full authority over
 * everything below them" — their own governed group AND every descendant of
 * it, never a sideways or ancestor group).
 *
 * `ownGroupId` MUST come from the caller's OWN govt_admins row, resolved
 * server-side from their verified auth uid — never from client input.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isStrictDescendantGroup } from './schoolScope'

/** Is `targetGroupId` the leader's own governed group, or a strict descendant of it? */
export async function isWithinLeaderSubtree(
  svc: SupabaseClient,
  ownGroupId: string | null | undefined,
  targetGroupId: string | null | undefined,
): Promise<boolean> {
  if (!ownGroupId || !targetGroupId) return false
  if (ownGroupId === targetGroupId) return true
  return isStrictDescendantGroup(svc, ownGroupId, targetGroupId)
}
