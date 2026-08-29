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

import { SCHOOL_PREMIUM_TRIAL_DAYS, SCHOOL_HERITAGE_TRIAL_DAYS } from './trialPolicy'

// A school pays £15/teacher/mo for the dashboard; the trial is time-limited
// even on free courses. Exported: THE-MODEL.md §1.11 generalizes this same
// 30d-premium/365d-free derivation to any node's binary trial entitlement
// (api/entitlement/grant.ts) — one constant pair, no drift between the two
// trial clocks.
// Values live in trialPolicy.ts (founder ruling 2026-08-02) — the single
// trial-length policy point; these names are kept for existing importers.
export const PLATFORM_TRIAL_PREMIUM_DAYS = SCHOOL_PREMIUM_TRIAL_DAYS // premium-track school + every tutor
export const PLATFORM_TRIAL_FREE_DAYS = SCHOOL_HERITAGE_TRIAL_DAYS // free-track school (still pays for the platform)

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
 * ADMIN-ENT-08 (fixed 2026-08-25): canonicalise an address before using it as a
 * trial-BURN KEY. `a+1@gmail.com`, `a+2@gmail.com` and `a.b@gmail.com` all
 * deliver to one inbox, so keying the burn on the literal address minted an
 * unlimited supply of fresh platform trials to one person.
 *
 * Only the burn key changes — the raw address is still what gets stored for
 * display/contact everywhere else.
 *
 *  - lowercase + trim (as before)
 *  - drop a `+tag` from the local part (honoured by every major provider)
 *  - drop dots from the local part ONLY on gmail/googlemail, where they are
 *    genuinely ignored; elsewhere a dot is a significant character.
 */
export function canonicaliseEmailForBurn(email: string): string {
  const trimmed = (email || '').trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return trimmed
  let local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '')
  return local ? `${local}@${domain}` : trimmed
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
  rawEmail: string,
  track: 'school' | 'tutor',
  schoolId: string | null,
): Promise<{ burned: boolean; ownedBy?: string | null; schemaUnavailable?: boolean }> {
  if (!rawEmail) {
    // No email to key the burn on — can't enforce; skip (fail open).
    return { burned: false, schemaUnavailable: true }
  }
  const email = canonicaliseEmailForBurn(rawEmail)
  const { error } = await supabase
    .from('trial_burns')
    .insert({ email, track, school_id: schoolId })
  if (!error) {
    // The canonical key is new — but burns written BEFORE this canonicalisation
    // landed are keyed on the literal address. Honour those so the change of key
    // can't hand anyone a second trial.
    const raw = rawEmail.trim().toLowerCase()
    if (raw !== email) {
      const { data: legacy } = await supabase
        .from('trial_burns')
        .select('school_id')
        .eq('email', raw)
        .eq('track', track)
        .maybeSingle()
      if (legacy) return { burned: true, ownedBy: legacy.school_id ?? null }
    }
    return { burned: false }
  }
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
 * Record the language a trial school is actually trialling, at the honest
 * moment it commits to one: the creation of its first class with a course.
 *
 * The gap this closes (founder report 2026-08-07, Chepstow): an invite-born
 * school redeems with NO course chosen — redeem.ts correctly passes a null
 * courseCode, since an invite only ever carries a school_name label — and
 * NOTHING ever filled it in afterwards. The school then taught cym_s_for_eng
 * in every class while `schools.trial_course_code` stayed null forever, so the
 * leader's home badge could only say a bare "Trial" with no language, and the
 * one-trialled-language lock (provision.ts's 409) had nothing to lock on.
 *
 * Deliberately a fill-once, never a change: the update is guarded on
 * `trial_course_code IS NULL` and `platform_status LIKE 'trial%'`, so it can
 * never overwrite a course a school already committed to (self-serve signup,
 * an admin's later correction) and never touches a paying school. A school
 * that adds a SECOND different language still meets the existing checkout
 * gate — this only names the first one.
 *
 * Fail-open, like every other platform-trial write: a school's class must
 * never fail to be created because the trial bookkeeping errored.
 */
export async function ensureSchoolTrialCourse(
  supabase: any,
  schoolId: string | null | undefined,
  courseCode: string | null | undefined,
): Promise<boolean> {
  if (!schoolId || !courseCode) return false

  const { data: school, error: readError } = await supabase
    .from('schools')
    .select('platform_status, trial_course_code')
    .eq('id', schoolId)
    .maybeSingle()
  if (readError) {
    if (!isMissingPlatformSchema(readError)) {
      console.warn('[schoolPlatformTrial] trial-course read failed (fail-open):', readError.code, readError.message)
    }
    return false
  }
  if (!school) return false
  if (!String(school.platform_status || '').startsWith('trial')) return false
  if (school.trial_course_code) return false

  const { data: updated, error: writeError } = await supabase
    .from('schools')
    .update({ trial_course_code: courseCode })
    .eq('id', schoolId)
    .is('trial_course_code', null)
    .like('platform_status', 'trial%')
    .select('id')
  if (writeError) {
    if (!isMissingPlatformSchema(writeError)) {
      console.warn('[schoolPlatformTrial] trial-course write failed (fail-open):', writeError.code, writeError.message)
    }
    return false
  }
  const wrote = Array.isArray(updated) && updated.length > 0
  if (wrote) console.log('[schoolPlatformTrial] recorded trial course', courseCode, 'for school', schoolId)
  return wrote
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
  // Heritage course (Welsh + free/minority languages) → 1-year window; a
  // commercial (Big-10) course → 1-month. Callers derive this from
  // !isCommercialCourse (@ssi/core) — the single trial-length source of truth.
  isHeritage: boolean,
): Promise<{ trial: PlatformTrial | null; burned: boolean; denied: boolean }> {
  const kind = isHeritage ? 'free_1yr' : 'premium_1mo'
  const days = isHeritage ? PLATFORM_TRIAL_FREE_DAYS : PLATFORM_TRIAL_PREMIUM_DAYS
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
