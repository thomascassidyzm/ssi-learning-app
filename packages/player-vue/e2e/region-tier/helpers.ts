/**
 * Region-tier e2e harness — shared helpers.
 *
 * Auth without email: mints synthetic sessions via the Supabase service-role
 * admin API (auth.admin.createUser + auth.admin.generateLink) instead of a
 * real inbox. generateLink({type:'magiclink'}) returns `properties.email_otp`
 * — the SAME 6-digit code GoTrue would have emailed — so we can drive the
 * app's real OTP UI (RedeemCode.vue: email → Continue → 6-digit code →
 * Verify) with a code we already know, with zero real email sent.
 *
 * Every synthetic account uses an @ssi-internal.test address (RFC 2606
 * reserved, non-routable — nothing is ever delivered anywhere) and is
 * flagged learners.is_internal = true as soon as its learner row exists, so
 * it never pollutes production telemetry.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Pull with `vercel env pull /tmp/staging.env --environment=preview` and export them, ' +
      'e.g.: export $(grep -E "^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=" /tmp/staging.env | xargs)'
  )
}

export const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export interface CleanupLedger {
  authUserIds: string[]
  learnerIds: string[]
  govtAdminIds: string[]
  schoolIds: string[]
  groupIds: string[]
  inviteCodeIds: string[]
}

export function newLedger(): CleanupLedger {
  return {
    authUserIds: [],
    learnerIds: [],
    govtAdminIds: [],
    schoolIds: [],
    groupIds: [],
    inviteCodeIds: [],
  }
}

let counter = 0
export function syntheticEmail(label: string): string {
  counter += 1
  return `e2e-region-tier-${label}-${Date.now()}-${counter}@ssi-internal.test`
}

export async function createSyntheticUser(email: string, ledger: CleanupLedger): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { e2e_region_tier: true },
  })
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`)
  ledger.authUserIds.push(data.user.id)
  return data.user.id
}

/** Polls for the learner row a redeem/provision flow creates server-side, then flags it internal. */
export async function markLearnerInternal(userId: string, ledger: CleanupLedger, attempts = 20): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const { data } = await admin.from('learners').select('id').eq('user_id', userId).maybeSingle()
    if (data) {
      await admin.from('learners').update({ is_internal: true }).eq('id', data.id as string)
      ledger.learnerIds.push(data.id as string)
      return data.id as string
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

/**
 * Drives the real RedeemCode.vue OTP flow on the CURRENT page (must already
 * be on a screen showing the email step: #redeem-email visible).
 */
export async function signInViaOtp(page: Page, email: string): Promise<void> {
  const emailInput = page.locator('#redeem-email')
  await emailInput.waitFor({ state: 'visible', timeout: 20_000 })
  await emailInput.fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()

  // The UI's own signInWithOtp() call above just minted (and "emailed", to a
  // non-routable address) a token we never see. Mint a FRESH one server-side
  // right now — GoTrue keeps one active token per (user, type), so this
  // overwrites it and its email_otp is what will actually verify.
  const otpInput = page.locator('#redeem-otp')
  await otpInput.waitFor({ state: 'visible', timeout: 20_000 })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data) throw new Error(`generateLink failed for ${email}: ${error?.message}`)
  const otp = (data.properties as any)?.email_otp
  if (!otp) throw new Error(`generateLink returned no email_otp for ${email}`)

  await otpInput.fill(otp)
  await page.getByRole('button', { name: 'Verify' }).click()
}

/** Reads the Supabase JS session access_token straight out of localStorage after sign-in. */
export async function getAccessTokenFromPage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || '{}')
          if (parsed?.access_token) return parsed.access_token as string
        } catch {
          /* not the right key */
        }
      }
    }
    return null
  })
}

export interface CleanupErrors {
  errors: string[]
}

/** Deletes everything tracked on the ledger, FK-safe order, best-effort (logs, never throws). */
export async function cleanup(ledger: CleanupLedger): Promise<CleanupErrors> {
  const errors: string[] = []
  const note = (label: string, error: { message: string } | null) => {
    if (error) errors.push(`${label}: ${error.message}`)
  }

  // 1. Break back-references from schools/govt_admins to invite_codes before
  //    deleting the codes (avoids an FK-order dependency either way).
  if (ledger.schoolIds.length) {
    const { error } = await admin.from('schools').update({ invite_code_id: null }).in('id', ledger.schoolIds)
    note('schools.invite_code_id clear', error)
  }
  if (ledger.govtAdminIds.length) {
    const { error } = await admin.from('govt_admins').update({ invite_code_id: null }).in('id', ledger.govtAdminIds)
    note('govt_admins.invite_code_id clear', error)
  }
  if (ledger.learnerIds.length) {
    const { error } = await admin.from('learners').update({ invite_code_id: null }).in('id', ledger.learnerIds)
    note('learners.invite_code_id clear', error)
  }

  // 2. Invite codes — directly minted ones, plus any join codes registered
  //    against our synthetic schools/groups (ensureJoinCodesRegistered rows).
  const codeFilters: string[] = []
  if (ledger.inviteCodeIds.length) codeFilters.push(`id.in.(${ledger.inviteCodeIds.join(',')})`)
  if (ledger.schoolIds.length) codeFilters.push(`grants_school_id.in.(${ledger.schoolIds.join(',')})`)
  if (ledger.groupIds.length) codeFilters.push(`grants_group_id.in.(${ledger.groupIds.join(',')})`)
  if (codeFilters.length) {
    const { error } = await admin.from('invite_codes').delete().or(codeFilters.join(','))
    note('invite_codes', error)
  }

  // 3. Schools, then govt_admins (both reference groups), then groups.
  if (ledger.schoolIds.length) {
    const { error } = await admin.from('schools').delete().in('id', ledger.schoolIds)
    note('schools', error)
  }
  if (ledger.govtAdminIds.length) {
    const { error } = await admin.from('govt_admins').delete().in('id', ledger.govtAdminIds)
    note('govt_admins', error)
  }
  if (ledger.groupIds.length) {
    const { error } = await admin.from('groups').delete().in('id', ledger.groupIds)
    note('groups', error)
  }

  // 4. Learners, then the auth users themselves.
  if (ledger.learnerIds.length) {
    const { error } = await admin.from('learners').delete().in('id', ledger.learnerIds)
    note('learners', error)
  }
  for (const id of ledger.authUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) errors.push(`auth user ${id}: ${error.message}`)
  }

  return { errors }
}

/** Any live, playable course — used only to drive POST /api/onboarding/provision. */
export async function pickAnyLiveCourseCode(): Promise<string> {
  const { data, error } = await admin
    .from('courses')
    .select('course_code')
    .in('new_app_status', ['live', 'beta'])
    .limit(1)
    .maybeSingle()
  if (error || !data) throw new Error(`No live/beta course found to drive provisioning: ${error?.message}`)
  return data.course_code as string
}
