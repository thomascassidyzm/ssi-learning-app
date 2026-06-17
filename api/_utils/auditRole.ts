/**
 * Append a row to role_change_audit.
 *
 * Best-effort: a failure here must NEVER break the grant it is recording, so it
 * swallows all errors (the grant has already happened by the time we log it).
 * Writes use the service-role client (bypasses RLS).
 *
 * Different call sites know different identifiers for the target — the admin
 * panel has learners.id, code redemption has the auth uid — so both are
 * optional; pass whichever you have.
 */

type ServiceClient = { from: (table: string) => any }

export interface RoleChangeEntry {
  actorUserId?: string | null      // auth uid of who made the change (self for redemptions)
  targetLearnerId?: string | null  // learners.id
  targetUserId?: string | null     // auth uid of the target
  field: 'platform_role' | 'educational_role' | 'dashboard'
  oldValue?: string | null
  newValue?: string | null
  source: 'update-user-role' | 'invite-code' | 'entitlement-code' | 'email-allowlist'
  codeUsed?: string | null
  detail?: Record<string, unknown> | null
}

export async function recordRoleChange(
  supabase: ServiceClient,
  entry: RoleChangeEntry,
): Promise<void> {
  try {
    const { error } = await supabase.from('role_change_audit').insert({
      actor_user_id: entry.actorUserId ?? null,
      target_learner_id: entry.targetLearnerId ?? null,
      target_user_id: entry.targetUserId ?? null,
      field: entry.field,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      source: entry.source,
      code_used: entry.codeUsed ?? null,
      detail: entry.detail ?? null,
    })
    if (error) console.warn('[auditRole] failed to record role change:', error.message)
  } catch (err) {
    console.warn('[auditRole] failed to record role change:', err)
  }
}
