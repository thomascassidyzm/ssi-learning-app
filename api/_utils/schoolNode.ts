/**
 * schoolNode — mint a school's OWN node in the one group tree (THE MODEL I2:
 * "every school is a node"). The expand migration (20260718_the_model_expand)
 * backfilled a node for every school that existed at migration time; every
 * creation path that makes a NEW schools row must call this so the invariant
 * keeps holding — otherwise the school is invisible to the tree, to rollups'
 * commercial attachment, and to the group-tag dual-write in redemption.
 *
 * Idempotent: a school that already has node_group_id is left alone.
 * Best-effort by design where callers choose (a school without a node is the
 * pre-model shape — degraded, not broken).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function ensureSchoolNode(
  supabase: SupabaseClient,
  school: { id: string; school_name: string; group_id: string | null },
  flags?: { is_demo?: boolean; is_test?: boolean },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('schools')
    .select('node_group_id')
    .eq('id', school.id)
    .maybeSingle()
  if (existing?.node_group_id) return existing.node_group_id as string

  const { data: node, error: nodeErr } = await supabase
    .from('groups')
    .insert({
      name: school.school_name,
      type: 'school',
      parent_id: school.group_id,
      is_demo: flags?.is_demo ?? false,
      is_test: flags?.is_test ?? false,
      name_confirmed: true,
    })
    .select('id')
    .single()
  if (nodeErr || !node) {
    console.error('[ensureSchoolNode] node mint failed:', nodeErr?.message)
    return null
  }
  const { error: linkErr } = await supabase
    .from('schools')
    .update({ node_group_id: node.id })
    .eq('id', school.id)
  if (linkErr) {
    console.error('[ensureSchoolNode] node link failed:', linkErr.message)
    return null
  }
  return node.id as string
}
