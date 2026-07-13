/**
 * Ensure a school's trigger-generated join codes (teacher + admin) exist in
 * invite_codes so they can actually be redeemed. Idempotent (upsert ignoring
 * duplicates on `code`) — safe to call on every provision/redemption.
 *
 * Non-fatal: callers must not die on the invite ledger, but failures are
 * logged loudly because a missing row means "Invalid code" for every invited
 * teacher or admin.
 */
export async function ensureJoinCodesRegistered(
  supabase: any,
  schoolId: string,
  createdBy: string,
): Promise<void> {
  const { data: school, error: readErr } = await supabase
    .from('schools')
    .select('teacher_join_code, admin_join_code')
    .eq('id', schoolId)
    .maybeSingle()
  if (readErr || !school) {
    console.error('[schoolJoinCodes] join-code read failed:', readErr?.message)
    return
  }
  const rows = [
    { code: school.teacher_join_code, code_type: 'teacher' },
    { code: school.admin_join_code, code_type: 'school_admin_join' },
  ]
    .filter((r) => !!r.code)
    .map((r) => ({ ...r, created_by: createdBy, grants_school_id: schoolId, is_active: true }))
  if (!rows.length) return
  const { error } = await supabase
    .from('invite_codes')
    .upsert(rows, { onConflict: 'code', ignoreDuplicates: true })
  if (error) {
    console.error(
      '[schoolJoinCodes] join-code registration failed (invites will not redeem):',
      error.code,
      error.message,
    )
  }
}
