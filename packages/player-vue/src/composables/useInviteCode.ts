import { ref, readonly } from 'vue'

export interface InviteCodeContext {
  code: string
  inviteCodeId: string
  codeType: 'govt_admin' | 'school_admin' | 'teacher' | 'student'
  regionName?: string
  schoolName?: string
  className?: string
  courseName?: string
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
      const res = await fetch('/api/invite/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      })
      const data = await res.json()
      if (data.valid) {
        pendingCode.value = {
          code: code.trim().toUpperCase(),
          inviteCodeId: data.inviteCodeId,
          codeType: data.codeType,
          regionName: data.context?.regionName,
          schoolName: data.context?.schoolName,
          className: data.context?.className,
          courseName: data.context?.courseName,
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

  async function redeemCode(clerkToken: string): Promise<{ success: boolean; role?: string; redirectTo?: string; error?: string }> {
    if (!pendingCode.value) {
      return { success: false, error: 'No pending code' }
    }
    isRedeeming.value = true
    try {
      const res = await fetch('/api/invite/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${clerkToken}`,
        },
        body: JSON.stringify({ code: pendingCode.value.code }),
      })
      const data = await res.json()
      if (data.success) {
        clearPendingCode()
        return { success: true, role: data.role, redirectTo: data.redirectTo }
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
