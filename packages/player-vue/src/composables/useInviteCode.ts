import { ref, readonly } from 'vue'

export interface InviteCodeContext {
  code: string
  codeKind: 'invite' | 'entitlement'
  // Invite-specific
  inviteCodeId?: string
  codeType?: 'ssi_admin' | 'govt_admin' | 'school_admin' | 'school_admin_join' | 'teacher' | 'student' | 'tester'
  groupName?: string
  schoolName?: string
  className?: string
  courseName?: string
  // Entitlement-specific
  entitlementCodeId?: string
  label?: string
  accessType?: 'full' | 'courses'
  grantedCourses?: readonly string[]
  accessDescription?: string
  durationDescription?: string
  // Set when validateCode ran with a bearer token and the signed-in user has
  // already redeemed this code's context — subsequent redeems of a personal
  // link go straight to their surface (founder ruling 2026-07-20).
  alreadyRedeemed?: boolean
  redirectTo?: string
}

// Module-level singleton state
const pendingCode = ref<InviteCodeContext | null>(null)
const validationError = ref<string | null>(null)
const isValidating = ref(false)
const isRedeeming = ref(false)

// Single-flight guard for redeemCode(). RedeemCode.vue calls doRedeem() from
// two sites (handleVerifyOtp's direct call, and the isSignedIn watcher that
// fires when the OTP verify's auth-state-change event lands) — both are
// intentional (the watcher is the primary path; the direct call covers the
// watcher not firing fast enough), but without this guard both could reach
// here concurrently and POST /api/code/redeem twice before either had
// cleared pendingCode, doubling up server-side writes (confirmed: 3 `schools`
// rows for one admin on staging). Memoizing the in-flight promise means the
// second caller gets the first call's result instead of firing a second
// request.
let inFlightRedeem: Promise<{ success: boolean; role?: string; redirectTo?: string; label?: string; codeKind?: string; error?: string }> | null = null

// Restore from sessionStorage on load (survives OAuth redirect)
const SESSION_KEY = 'ssi-pending-invite-code'
try {
  const stored = sessionStorage.getItem(SESSION_KEY)
  if (stored) {
    pendingCode.value = JSON.parse(stored)
  }
} catch {}

function persistPendingCode() {
  if (pendingCode.value) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(pendingCode.value))
  } else {
    sessionStorage.removeItem(SESSION_KEY)
  }
}

export function useInviteCode() {
  async function validateCode(code: string, authToken?: string): Promise<boolean> {
    validationError.value = null
    isValidating.value = true
    try {
      const res = await fetch('/api/code/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Optional bearer: lets the server report alreadyRedeemed for the
          // signed-in user so a re-clicked personal link goes straight to
          // their surface instead of re-running the flow.
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      })
      const data = await res.json()
      if (data.valid) {
        if (data.codeKind === 'entitlement') {
          pendingCode.value = {
            code: code.trim().toUpperCase(),
            codeKind: 'entitlement',
            entitlementCodeId: data.entitlementCodeId,
            label: data.label,
            accessType: data.accessType,
            grantedCourses: data.grantedCourses,
            accessDescription: data.accessDescription,
            durationDescription: data.durationDescription,
          }
        } else {
          pendingCode.value = {
            code: code.trim().toUpperCase(),
            codeKind: 'invite',
            inviteCodeId: data.inviteCodeId,
            codeType: data.codeType,
            groupName: data.context?.groupName,
            schoolName: data.context?.schoolName,
            className: data.context?.className,
            courseName: data.context?.courseName,
            alreadyRedeemed: data.alreadyRedeemed === true,
            redirectTo: data.redirectTo,
          }
        }
        persistPendingCode()
        return true
      } else {
        validationError.value = data.error || 'Invalid code'
        return false
      }
    } catch (err: any) {
      validationError.value = err.message || 'Failed to validate code'
      return false
    } finally {
      isValidating.value = false
    }
  }

  async function redeemCode(authToken: string): Promise<{ success: boolean; role?: string; redirectTo?: string; label?: string; codeKind?: string; courseCode?: string | null; error?: string }> {
    // Single-flight: a redemption already in progress wins; concurrent callers
    // (see comment on inFlightRedeem above) get its result rather than firing
    // a second request. Checked+set synchronously (no await before it), so
    // there's no interleaving window between the check and the set.
    if (inFlightRedeem) return inFlightRedeem
    if (!pendingCode.value) {
      return { success: false, error: 'No pending code' }
    }
    isRedeeming.value = true
    const codeAtStart = pendingCode.value
    inFlightRedeem = (async () => {
      try {
        const res = await fetch('/api/code/redeem', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            code: codeAtStart.code,
            codeKind: codeAtStart.codeKind,
          }),
        })
        const data = await res.json()
        if (data.success) {
          clearPendingCode()
          return {
            success: true,
            codeKind: codeAtStart.codeKind,
            role: data.role,
            label: data.label,
            redirectTo: data.redirectTo,
            courseCode: data.courseCode,
          }
        } else {
          return { success: false, error: data.error || 'Failed to redeem code' }
        }
      } catch (err: any) {
        return { success: false, error: err.message || 'Failed to redeem code' }
      } finally {
        isRedeeming.value = false
        inFlightRedeem = null
      }
    })()
    return inFlightRedeem
  }

  /**
   * Possession-based onboarding (docs/schools/email-deliverability-plan.md,
   * Option A) — no OTP round-trip. Creates the account + mints a session
   * server-side from possession of the (already-validated) pending invite
   * code alone. Caller still owns calling supabase.auth.setSession(...) with
   * the returned tokens and then redeemCode() exactly as the OTP path does.
   */
  async function possessionRedeem(
    email: string,
    displayName?: string
  ): Promise<{ success: boolean; session?: { access_token: string; refresh_token: string }; reason?: string; error?: string }> {
    if (!pendingCode.value || pendingCode.value.codeKind !== 'invite') {
      return { success: false, error: 'No pending invite code' }
    }
    try {
      const res = await fetch('/api/auth/possession-redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: pendingCode.value.code,
          email,
          displayName,
        }),
      })
      const data = await res.json()
      if (data.success) {
        return { success: true, session: data.session }
      }
      return { success: false, reason: data.reason, error: data.error || 'Failed to set up your account' }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to set up your account' }
    }
  }

  /**
   * Straight-in link redemption — the invite LINK is the credential. No email
   * typed: the server mints the account + a session from possession of the
   * (already-validated) pending code alone (api/auth/possession-redeem.ts
   * linkAuth mode), flagging it for a real-email prompt on first run. Same
   * return shape as possessionRedeem; caller owns setSession() + redeemCode().
   */
  async function linkPossessionRedeem(
    displayName?: string
  ): Promise<{ success: boolean; session?: { access_token: string; refresh_token: string }; reason?: string; error?: string }> {
    if (!pendingCode.value || pendingCode.value.codeKind !== 'invite') {
      return { success: false, error: 'No pending invite code' }
    }
    try {
      const res = await fetch('/api/auth/possession-redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: pendingCode.value.code,
          linkAuth: true,
          displayName,
        }),
      })
      const data = await res.json()
      if (data.success) {
        return { success: true, session: data.session }
      }
      return { success: false, reason: data.reason, error: data.error || 'Failed to sign you in' }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to sign you in' }
    }
  }

  function clearPendingCode() {
    pendingCode.value = null
    validationError.value = null
    sessionStorage.removeItem(SESSION_KEY)
  }

  return {
    pendingCode: readonly(pendingCode),
    validationError: readonly(validationError),
    isValidating: readonly(isValidating),
    isRedeeming: readonly(isRedeeming),
    validateCode,
    redeemCode,
    possessionRedeem,
    linkPossessionRedeem,
    clearPendingCode,
  }
}
