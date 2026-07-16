/**
 * Best-effort audit log for a school-mutation request rejected because the
 * caller resolved to a school via a non-admin tag (e.g. a teacher hitting an
 * admin-only endpoint like update-profile / update-seats). Same player_events
 * pattern as create-signin-link.ts's admin_signin_link_minted — never blocks
 * the 403 response it's logging.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function auditSchoolWriteRejection(
  supabase: SupabaseClient,
  params: { authUserId: string; schoolId: string; endpoint: string; roleInContext: string | null },
): Promise<void> {
  try {
    const { error } = await supabase.from('player_events').insert({
      occurred_at: new Date().toISOString(),
      event_type: 'school_write_rejected',
      payload: {
        endpoint: params.endpoint,
        school_id: params.schoolId,
        actor_user_id: params.authUserId,
        role_in_context: params.roleInContext,
        reason: 'not_admin',
      },
    })
    if (error) console.warn('[auditSchoolWriteRejection] insert failed:', error.message)
  } catch (err) {
    console.warn('[auditSchoolWriteRejection] threw:', err)
  }
}
