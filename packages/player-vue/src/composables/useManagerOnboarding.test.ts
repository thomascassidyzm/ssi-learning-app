/**
 * The org-manager onboarding gate's decision logic.
 *
 * The thing worth pinning is the SHAPE of the decision, not the modal: who is
 * gated (org leaders on the member mount, and nobody else), which direction we
 * fail in when the has_password flag is missing, and that the install nudge
 * never fires twice or against an already-installed app.
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import {
  MIN_PASSWORD_LENGTH,
  dismissInstall,
  hasPasswordFlag,
  installDismissKey,
  isInstallDismissed,
  needsPasswordGate,
  shouldPromptInstall,
  useManagerOnboarding,
  validatePassword,
} from './useManagerOnboarding'

function memStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    map,
  }
}

describe('hasPasswordFlag', () => {
  it('is true only for an explicit has_password === true', () => {
    expect(hasPasswordFlag({ user_metadata: { has_password: true } })).toBe(true)
  })

  it('treats a MISSING flag as no password — the safe direction', () => {
    // An older account may hold a real password with no flag. Worst case they
    // set one they already had; the other direction locks them out for real.
    expect(hasPasswordFlag({ user_metadata: {} })).toBe(false)
    expect(hasPasswordFlag({})).toBe(false)
    expect(hasPasswordFlag(null)).toBe(false)
    expect(hasPasswordFlag(undefined)).toBe(false)
  })

  it('does not accept a truthy non-true value', () => {
    expect(hasPasswordFlag({ user_metadata: { has_password: 'yes' } })).toBe(false)
  })
})

describe('needsPasswordGate', () => {
  it('gates an org leader on the member mount with no password', () => {
    expect(needsPasswordGate({ member: true, leadsOrg: true, hasPassword: false })).toBe(true)
  })

  it('does not gate once they have a password', () => {
    expect(needsPasswordGate({ member: true, leadsOrg: true, hasPassword: true })).toBe(false)
  })

  it('leaves the SCHOOLS lane alone — a non-org leader is never gated', () => {
    // /org/:id renders school nodes on the same member mount, so `member`
    // alone would leak the gate into the schools lane.
    expect(needsPasswordGate({ member: true, leadsOrg: false, hasPassword: false })).toBe(false)
  })

  it('does not gate the ssi_admin god-view mount', () => {
    expect(needsPasswordGate({ member: false, leadsOrg: true, hasPassword: false })).toBe(false)
  })
})

describe('shouldPromptInstall', () => {
  it('prompts a browser tab that has not been dismissed', () => {
    expect(shouldPromptInstall({ standalone: false, dismissed: false })).toBe(true)
  })

  it('never prompts an app already running standalone', () => {
    expect(shouldPromptInstall({ standalone: true, dismissed: false })).toBe(false)
  })

  it('never nags after a dismissal', () => {
    expect(shouldPromptInstall({ standalone: false, dismissed: true })).toBe(false)
  })
})

describe('install dismissal persistence', () => {
  it('keys per user so a shared device does not silence the next person', () => {
    expect(installDismissKey('user-a')).not.toBe(installDismissKey('user-b'))
  })

  it('round-trips a dismissal', () => {
    const s = memStorage()
    expect(isInstallDismissed('user-a', s)).toBe(false)
    dismissInstall('user-a', s)
    expect(isInstallDismissed('user-a', s)).toBe(true)
    expect(isInstallDismissed('user-b', s)).toBe(false)
  })

  it('survives storage that throws — a nudge is not worth an exception', () => {
    const blocked = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
    }
    expect(() => dismissInstall('user-a', blocked)).not.toThrow()
    expect(isInstallDismissed('user-a', blocked)).toBe(false)
  })
})

describe('validatePassword', () => {
  it('matches SettingsScreen exactly — same minimum, same words', () => {
    expect(validatePassword('short', 'short')).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
    expect(validatePassword('longenough', 'different')).toBe('Passwords do not match')
    expect(validatePassword('longenough', 'longenough')).toBeNull()
  })

  it('accepts exactly the minimum length', () => {
    const at = 'a'.repeat(MIN_PASSWORD_LENGTH)
    expect(validatePassword(at, at)).toBeNull()
  })
})

describe('useManagerOnboarding', () => {
  it('tracks has_password reactively off the auth user ref', () => {
    const user = ref<{ id: string; user_metadata: Record<string, unknown> } | null>({
      id: 'u1',
      user_metadata: {},
    })
    const { hasPassword, userId } = useManagerOnboarding(user)
    expect(hasPassword.value).toBe(false)
    expect(userId.value).toBe('u1')
    user.value = { id: 'u1', user_metadata: { has_password: true } }
    expect(hasPassword.value).toBe(true)
  })
})
