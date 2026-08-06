/**
 * groupLeaderTag — leader MEMBERSHIP for a group node.
 *
 * FOUNDER RULING (Tom, 2026-08-06): "the creator of a group/org must
 * automatically become its first manager (group leader)."
 *
 * WHY THIS FILE EXISTS. Leadership was recorded in exactly one place —
 * `govt_admins` — and `govt_admins` is an AUTHZ table: it answers "may this
 * caller act here?" and is read by groupTreeAuth and nothing else. Every people
 * count and people list in the org UI reads `user_tags`. So the creator of an
 * org came out the far side of creation holding full authority over a group
 * they were not a member of: the org page showed "1 learner, 0 groups" and no
 * manager anywhere, while the ways-in ledger right below it displayed their own
 * name against the link they had minted. The system knew exactly who they were
 * and had nowhere to say it.
 *
 * The fix is a leader `user_tags` row alongside the `govt_admins` row, so
 * leadership is a MEMBERSHIP as well as a permission.
 *
 * TWO SOURCES, DELIBERATELY. Reads union `govt_admins` with the leader tag
 * (see `leadersForNodes`) rather than switching over. Every org created before
 * this ruling has a govt_admins row and no tag, and a leader who vanished from
 * their own page on deploy day would be a worse bug than the one being fixed.
 * The union also means a repair backfill is a convenience, not a prerequisite.
 *
 * NOT AN AUTHZ CHANGE. The tag grants nothing. `resolveGroupTreeCaller` still
 * resolves authority from `govt_admins` alone, so this file cannot widen who
 * can read or write a node — it only makes visible a leadership that already
 * existed. Making the tag load-bearing for authz (which would also lift the
 * one-org-per-leader limit) is a separate, deliberate decision.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'

/**
 * `user_tags.role_in_context` for a group's leader.
 *
 * 'admin' — NOT 'leader'. The live DB carries a check constraint
 * (`user_tags_role_in_context_check`) admitting exactly admin | teacher |
 * student; 'leader', 'manager', 'owner' and 'head' are all rejected outright
 * (probed against the live schema 2026-08-06). Rather than migrate the
 * constraint on a shared DB for a word, this reuses the one the schema already
 * means: a SCHOOL: tag with role 'admin' is the person who administers that
 * school, so a GROUP: tag with role 'admin' is the person who administers that
 * group. Same idea, one level up. The UI still SAYS "group leader" — the
 * neutral vocabulary is a display concern, not a storage one.
 *
 * It is deliberately not 'teacher': computeNodeExtras counts group 'teacher'
 * tags into teacherCount, and a leader landing there would swap an invisible
 * manager for a miscounted one. 'admin' is counted by neither teacherCount nor
 * learnerCount, which is exactly right — a leader is a leader.
 *
 * Grants nothing: every reader of role 'admin' in the estate (remove-staff,
 * update-profile, update-seats, schoolIdForAdmin) filters on tag_type='school'
 * first, so a group-scoped 'admin' cannot be mistaken for a school admin.
 */
export const GROUP_LEADER_ROLE = 'admin'

export type EnsureLeaderTagResult = 'created' | 'existed' | 'failed'

/**
 * Make `userId` a leader MEMBER of `groupId`, idempotently. Safe to call on a
 * node that already has the tag (returns 'existed' without writing).
 *
 * Best-effort by design: callers create the group and the govt_admins row
 * first, and a failure here must not cost the caller their org. It returns
 * 'failed' and logs rather than throwing, and the read side falls back to
 * govt_admins anyway.
 */
export async function ensureGroupLeaderTag(
  svc: SupabaseClient,
  opts: { groupId: string; userId: string; addedBy?: string },
): Promise<EnsureLeaderTagResult> {
  const { groupId, userId } = opts
  if (!groupId || !userId) return 'failed'
  const tagValue = `GROUP:${groupId}`
  try {
    const { data: existing } = await svc
      .from('user_tags')
      .select('id')
      .eq('user_id', userId)
      .eq('tag_type', 'group')
      .eq('tag_value', tagValue)
      .eq('role_in_context', GROUP_LEADER_ROLE)
      .is('removed_at', null)
      .maybeSingle()
    if (existing) return 'existed'

    const { error } = await svc.from('user_tags').insert({
      user_id: userId,
      tag_type: 'group',
      tag_value: tagValue,
      role_in_context: GROUP_LEADER_ROLE,
      added_by: opts.addedBy || userId,
    })
    if (error) {
      console.error('[GroupLeaderTag] insert failed', { groupId, userId, error: error.message })
      return 'failed'
    }
    return 'created'
  } catch (error) {
    console.error('[GroupLeaderTag] unexpected failure', { groupId, userId, error: String(error) })
    return 'failed'
  }
}

/**
 * Leader auth-uids per node, unioning the authz table with the membership tag
 * so pre-ruling orgs still name their leader. Returns a Map keyed by node id;
 * nodes with no leader are simply absent.
 */
export async function leadersForNodes(
  svc: SupabaseClient,
  nodeIds: string[],
): Promise<Map<string, Set<string>>> {
  const byNode = new Map<string, Set<string>>()
  if (nodeIds.length === 0) return byNode
  const add = (nodeId: string, userId: string) => {
    if (!nodeId || !userId) return
    if (!byNode.has(nodeId)) byNode.set(nodeId, new Set())
    byNode.get(nodeId)!.add(userId)
  }

  await Promise.all([
    ...chunk(nodeIds).map(async (batch) => {
      const { data } = await svc.from('govt_admins').select('user_id, group_id').in('group_id', batch)
      for (const r of data ?? []) add((r as { group_id: string }).group_id, (r as { user_id: string }).user_id)
    }),
    ...chunk(nodeIds).map(async (batch) => {
      const { data } = await svc
        .from('user_tags')
        .select('user_id, tag_value')
        .eq('tag_type', 'group')
        .eq('role_in_context', GROUP_LEADER_ROLE)
        .is('removed_at', null)
        .in('tag_value', batch.map((id) => `GROUP:${id}`))
      for (const r of data ?? []) {
        add(((r as { tag_value: string }).tag_value).replace('GROUP:', ''), (r as { user_id: string }).user_id)
      }
    }),
  ])
  return byNode
}
