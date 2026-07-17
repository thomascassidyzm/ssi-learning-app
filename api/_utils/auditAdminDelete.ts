/**
 * Best-effort audit log for an admin-initiated school/group deletion.
 * Same player_events pattern as auditSchoolWriteRejection.ts — never blocks
 * or reverts the delete it's recording (the delete has already happened by
 * the time we log it).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function auditAdminDelete(
  supabase: SupabaseClient,
  params: { actorUserId: string; eventType: 'admin_school_deleted' | 'admin_group_deleted'; payload: Record<string, unknown> },
): Promise<void> {
  try {
    const { error } = await supabase.from('player_events').insert({
      occurred_at: new Date().toISOString(),
      event_type: params.eventType,
      payload: {
        actor_user_id: params.actorUserId,
        ...params.payload,
      },
    })
    if (error) console.warn('[auditAdminDelete] insert failed:', error.message)
  } catch (err) {
    console.warn('[auditAdminDelete] threw:', err)
  }
}
