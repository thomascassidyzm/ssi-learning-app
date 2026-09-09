/**
 * Platform-subscription trial provisioning (lever-3), shared between the
 * self-serve onboarding flow (api/onboarding/provision.ts) and invite-born
 * redemption (api/code/redeem.ts's school_admin branch — region-tier-design.md
 * §1f) so both paths set the SAME trial clocks with zero duplicated logic
 * (the schoolJoinCodes.ts extraction precedent).
 *
 * Email-burn FIRST then grant. Both helpers FAIL OPEN: if the
 * school_platform_subscription migration is unapplied (trial_burns /
 * platform_* columns absent) they no-op cleanly so onboarding keeps working —
 * the dashboard gate is advisory until the migration lands.
 */

// A school pays £15/teacher/mo for the dashboard; the trial is time-limited
// even on free courses.
const PLATFORM_TRIAL_PREMIUM_DAYS = 30 // premium-track school + every tutor
const PLATFORM_TRIAL_FREE_DAYS = 365 // free-track school (still pays for the platform)

export type PlatformTrial = { track: string; kind: string; expires_at: string; days: number }

function isoIn(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

// True when a Supabase/PostgREST error means the school_platform_subscription
// migration hasn't been applied yet (missing table/column/relationship). The
// platform-trial step degrades to a no-op in that case so onboarding still works.
export function isMissingPlatformSchema(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  // PGRST204 missing column, PGRST205 missing table, 42703 undefined_column,
  // 42P01 undefined_table — plus a message-level fallback for variants.
  if (['PGRST204', 'PGRST205', '42703', '42P01'].includes(err.code || '')) return true
  return /column .* does not exist|relation .* does not exist|could not find the .* column|schema cache/i.test(
    err.message || '',
  )
}

/**
 * Burn one trial on (email, track). Returns:
 *   - { burned: false }                 → first time; the caller may grant.
 *   - { burned: true, ownedBy }         → already burned; ownedBy = the burn's
 *                                         school_id (school) so the caller can
 *                                         tell an idempotent retry from a farm.
 *   - { schemaUnavailable: true }       → trial_burns absent (pre-migration).
 */
async function burnTrial(
  supabase: any,
  email: string,
  track: 'school' | 'tutor',
  schoolId: string | null,
): Promise<{ burned: boolean; ownedBy?: string | null; schemaUnavailable?: boolean }> {
  if (!email) {
    // No email to key the burn on — can't enforce; skip (fail open).
    return { burned: false, schemaUnavailable: true }
  }
  const { error } = await supabase
    .from('trial_burns')
    .insert({ email, track, school_id: schoolId })
  if (!error) return { burned: false }
  if (error.code === '23505') {
    // Already burned. Fetch the owning row so the caller can disambiguate a
    // legitimate retry (same school) from a farm (different/deleted school).
    const { data: existing } = await supabase
      .from('trial_burns')
      .select('school_id')
      .eq('email', email)
      .eq('track', track)
      .maybeSingle()
    return { burned: true, ownedBy: existing?.school_id ?? null }
  }
  if (isMissingPlatformSchema(error)) return { burned: false, schemaUnavailable: true }
  // Any other DB error: fail open (don't block onboarding on the burn ledger).
  console.warn('[schoolPlatformTrial] trial-burn insert failed (fail-open):', error.code, error.message)
  return { burned: false, schemaUnavailable: true }
}

async function setSchoolTrialColumns(
  supabase: any,
  schoolId: string,
  courseCode: string | null,
  kind: string,
  expiresAt: string,
): Promise<void> {
  const { error } = await supabase
    .from('schools')
    .update({
      platform_status: 'trial',
      trial_course_code: courseCode,
      trial_kind: kind,
      platform_expires_at: expiresAt,
    })
    .eq('id', schoolId)
  if (error && !isMissingPlatformSchema(error)) {
    console.warn('[schoolPlatformTrial] school trial-column write failed (fail-open):', error.code, error.message)
  }
}

/**
 * Grant (or idempotently confirm) the school-track platform trial. courseCode
 * is nullable — an invite-born school (redeem.ts) has no chosen course yet at
 * redemption time, so it trials with no course lock (TeacherDashboard.vue's
 * schoolAvailableCourses reads null as "no restriction") until the admin picks
 * one; self-serve (provision.ts) always passes the course just chosen at signup.
 */
export async function provisionSchoolPlatformTrial(
  supabase: any,
  email: string,
  schoolId: string,
  courseCode: string | null,
  isFree: boolean,
): Promise<{ trial: PlatformTrial | null; burned: boolean; denied: boolean }> {
  const kind = isFree ? 'free_1yr' : 'premium_1mo'
  const days = isFree ? PLATFORM_TRIAL_FREE_DAYS : PLATFORM_TRIAL_PREMIUM_DAYS
  const expiresAt = isoIn(days)

  const burn = await burnTrial(supabase, email, 'school', schoolId)
  if (burn.schemaUnavailable) {
    // Pre-migration (or no email): skip the platform trial entirely (fail open).
    return { trial: null, burned: false, denied: false }
  }
  if (burn.burned) {
    // Idempotent retry if the surviving burn belongs to THIS school; otherwise a
    // genuine re-trial attempt (deleted/recreated school) → deny the free trial.
    if (burn.ownedBy && burn.ownedBy === schoolId) {
      // Same school re-provisioning. Ensure the trial columns are present without
      // re-extending the window: only set them if not already on a trial.
      const { data: cur } = await supabase
        .from('schools')
        .select('platform_status, platform_expires_at, trial_course_code')
        .eq('id', schoolId)
        .maybeSingle()
      if (cur && cur.platform_status === 'trial' && cur.platform_expires_at) {
        return {
          trial: { track: 'school', kind, expires_at: cur.platform_expires_at, days },
          burned: false,
          denied: false,
        }
      }
      // No trial set yet (burn raced ahead of the column write) — set it now.
      await setSchoolTrialColumns(supabase, schoolId, courseCode, kind, expiresAt)
      return { trial: { track: 'school', kind, expires_at: expiresAt, days }, burned: false, denied: false }
    }
    return { trial: null, burned: true, denied: true }
  }

  // Fresh burn → grant the trial on the schools row.
  await setSchoolTrialColumns(supabase, schoolId, courseCode, kind, expiresAt)
  return { trial: { track: 'school', kind, expires_at: expiresAt, days }, burned: false, denied: false }
}

export async function provisionTutorPlatformTrial(
  supabase: any,
  email: string,
  teacherId: string,
  existingStatus: string | null,
): Promise<{ trial: PlatformTrial | null; burned: boolean }> {
  const days = PLATFORM_TRIAL_PREMIUM_DAYS // tutor = 1 month always
  const expiresAt = isoIn(days)

  const burn = await burnTrial(supabase, email, 'tutor', null)
  if (burn.schemaUnavailable) {
    return { trial: null, burned: false }
  }
  if (burn.burned) {
    // Re-provision of an existing tutor that already has a trial set = idempotent
    // (return its existing expiry without extending it). If the burn exists but
    // this teacher has NO trial, it was burned on a prior (deleted) teacher row →
    // don't re-grant (the gate routes them to checkout).
    if (existingStatus === 'trial') {
      const { data: cur } = await supabase
        .from('teachers')
        .select('platform_expires_at')
        .eq('id', teacherId)
        .maybeSingle()
      if (cur?.platform_expires_at) {
        return { trial: { track: 'tutor', kind: 'premium_1mo', expires_at: cur.platform_expires_at, days }, burned: false }
      }
    }
    return { trial: null, burned: true }
  }

  // Fresh burn → grant the 1-month trial on the teacher row.
  const { error } = await supabase
    .from('teachers')
    .update({ platform_status: 'trial', platform_expires_at: expiresAt })
    .eq('id', teacherId)
  if (error && !isMissingPlatformSchema(error)) {
    console.warn('[schoolPlatformTrial] tutor trial-column write failed (fail-open):', error.code, error.message)
  }
  return { trial: { track: 'tutor', kind: 'premium_1mo', expires_at: expiresAt, days }, burned: false }
}
