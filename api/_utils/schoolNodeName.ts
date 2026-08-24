/**
 * schoolNodeName — keep a school's TWO names in step.
 *
 * A school's name lives in two rows: `schools.school_name` (the school
 * record) and `groups.name` on the school's OWN node (`schools.node_group_id`,
 * minted by ensureSchoolNode). The node is synthesised LAZILY — the first time
 * anyone opens the dashboard — taking whatever the school is called at that
 * moment, and the dashboard heading reads the NODE.
 *
 * So the ordinary order of events was the broken one (verified live on
 * production, 2026-08-06):
 *
 *   name your school, THEN open the dashboard → node born with the new name → right
 *   open the dashboard, THEN name your school → node keeps the OLD name     → stale forever
 *
 * A leader lands on her dashboard, sees "set up your school", goes and names
 * it — and the big heading keeps the name she replaced, in every browser, on
 * every machine, permanently. It is not a client cache.
 *
 * The fix is that a school and its node are ONE name with two homes, so every
 * writer of either writes both:
 *   · school → node  (`syncNodeNameForSchool`): the wizard, settings, onboarding
 *   · node → school  (`syncSchoolNameForNode`): PATCH /api/groups/:id renaming
 *     a group that IS a school's node
 *
 * BEST-EFFORT BY DESIGN, both directions. The caller's own write has already
 * succeeded by the time these run; a failure here is logged and swallowed
 * rather than turned into a 500 that tells a leader her rename failed when it
 * did not. A school with no node yet needs no sync at all — the node will be
 * born with the current name whenever it is minted.
 *
 * NOT a rename AUTHORISER. Both helpers assume the caller has already
 * established that this person may rename this thing, and that any
 * duplicate-name warning (api/_utils/groupSlug.ts) has already had its say —
 * these run AFTER the primary write, never in front of it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A school has been renamed → carry the new name onto its node, so the
 * dashboard heading follows. No node (never opened a dashboard) → nothing to
 * do, and that is the healthy case, not a failure.
 *
 * Returns the node id it renamed, or null when there was nothing to rename.
 */
export async function syncNodeNameForSchool(
  supabase: SupabaseClient,
  schoolId: string,
  name: string,
): Promise<string | null> {
  const newName = String(name ?? '').trim()
  if (!schoolId || !newName) return null
  try {
    const { data: school, error: readErr } = await supabase
      .from('schools')
      .select('node_group_id')
      .eq('id', schoolId)
      .maybeSingle()
    if (readErr) {
      console.error('[schoolNodeName] node lookup failed:', readErr.message)
      return null
    }
    const nodeId = (school as any)?.node_group_id as string | null | undefined
    if (!nodeId) return null

    const { error: updErr } = await supabase
      .from('groups')
      // name_confirmed alongside the name for the same reason the wizard sets
      // it on the school: typing your school's name IS confirming it (4936da6d).
      .update({ name: newName, name_confirmed: true, updated_at: new Date().toISOString() })
      .eq('id', nodeId)
    if (updErr) {
      console.error('[schoolNodeName] node rename failed:', updErr.message)
      return null
    }
    return nodeId
  } catch (err: any) {
    console.error('[schoolNodeName] node rename threw:', err?.message || err)
    return null
  }
}

/**
 * A GROUP has been renamed → if that group is some school's own node, carry
 * the new name onto the school record too. The mirror of the above: without
 * it, renaming a school from the org tree leaves `schools.school_name` on the
 * old name for every surface that reads the school row (rosters, invites,
 * exports, the admin school list).
 *
 * Returns the school id it renamed, or null when the group is not a school
 * node.
 */
export async function syncSchoolNameForNode(
  supabase: SupabaseClient,
  nodeGroupId: string,
  name: string,
): Promise<string | null> {
  const newName = String(name ?? '').trim()
  if (!nodeGroupId || !newName) return null
  try {
    const { data: school, error: readErr } = await supabase
      .from('schools')
      .select('id')
      .eq('node_group_id', nodeGroupId)
      .maybeSingle()
    if (readErr) {
      console.error('[schoolNodeName] school-for-node lookup failed:', readErr.message)
      return null
    }
    const schoolId = (school as any)?.id as string | undefined
    if (!schoolId) return null

    const { error: updErr } = await supabase
      .from('schools')
      .update({ school_name: newName, name_confirmed: true })
      .eq('id', schoolId)
    if (updErr) {
      console.error('[schoolNodeName] school rename failed:', updErr.message)
      return null
    }
    return schoolId
  } catch (err: any) {
    console.error('[schoolNodeName] school rename threw:', err?.message || err)
    return null
  }
}
