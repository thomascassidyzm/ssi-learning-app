import { ref, readonly } from 'vue'

export interface InviteCodeContext {
  code: string
  codeKind: 'invite' | 'entitlement'
  // Invite-specific
  inviteCodeId?: string
  codeType?: 'ssi_admin' | 'god' | 'govt_admin' | 'school_admin' | 'school_admin_join' | 'teacher' | 'student' | 'tester'
  groupName?: string
  schoolName?: string
  className?: string
  courseName?: string
  // Entitlement-specific
  entitlementCodeId?: string
  label?: string
  accessType?: 'full' | 'courses'
  grantedCourses?: string[]
  accessDescription?: string
  durationDescription?: string
}

// Module-level singleton state
const pendingCode = ref<InviteCodeContext | null>(null)
const validationError = ref<string | null>(null)
const isValidating = ref(false)
const isRedeeming = ref(false)

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
  async function validateCode(code: string): Promise<boolean> {
    validationError.value = null
    isValidating.value = true
    try {
      const res = await fetch('/api/code/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  async function redeemCode(authToken: string): Promise<{ success: boolean; role?: string; redirectTo?: string; label?: string; codeKind?: string; error?: string }> {
    if (!pendingCode.value) {
      return { success: false, error: 'No pending code' }
    }
    isRedeeming.value = true
    try {
      const res = await fetch('/api/code/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          code: pendingCode.value.code,
          codeKind: pendingCode.value.codeKind,
        }),
      })
      const data = await res.json()
      if (data.success) {
        const codeKind = pendingCode.value.codeKind
        clearPendingCode()
        return {
          success: true,
          codeKind,
          role: data.role,
          label: data.label,
          redirectTo: data.redirectTo,
        }
      } else {
        return { success: false, error: data.error || 'Failed to redeem code' }
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to redeem code' }
    } finally {
      isRedeeming.value = false
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
    clearPendingCode,
  }
}
