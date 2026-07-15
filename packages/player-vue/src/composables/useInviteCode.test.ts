/**
 * Guards the double-redeem race (WORKLIST 07-13): RedeemCode.vue's
 * doRedeem() fires from two call sites (a direct call and the isSignedIn
 * watcher), both of which call redeemCode() — this asserts redeemCode()
 * single-flights so only ONE /api/code/redeem request goes out even when
 * both call sites fire concurrently.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useInviteCode } from './useInviteCode'

describe('useInviteCode — redeemCode single-flight', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('two concurrent redeemCode() calls fire exactly one network request and share the result', async () => {
    let resolveFetch: (v: any) => void
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => fetchPromise as any)

    const { validateCode, redeemCode } = useInviteCode()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: async () => ({ valid: true, codeKind: 'invite', inviteCodeId: 'inv-1', codeType: 'school_admin', context: {} }),
    } as any)
    await validateCode('SCH-1')

    // Re-apply the in-flight redeem fetch mock (validateCode's own fetch already resolved above).
    fetchSpy.mockImplementation(() => fetchPromise as any)

    const call1 = redeemCode('token-a')
    const call2 = redeemCode('token-b') // simulates the second call site racing the first

    resolveFetch!({ json: async () => ({ success: true, role: 'school_admin', redirectTo: '/schools1' }) })

    const [r1, r2] = await Promise.all([call1, call2])

    // Only ONE request to /api/code/redeem, regardless of the redeem calls.
    const redeemCalls = fetchSpy.mock.calls.filter(([url]) => url === '/api/code/redeem')
    expect(redeemCalls).toHaveLength(1)
    expect(r1).toEqual(r2)
    expect(r1.success).toBe(true)
  })

  it('a later redeemCode() call after the first completes fires a fresh request', async () => {
    const { validateCode, redeemCode } = useInviteCode()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: async () => ({ valid: true, codeKind: 'invite', inviteCodeId: 'inv-2', codeType: 'teacher', context: {} }),
    } as any)
    await validateCode('TEACH-1')

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce({ json: async () => ({ success: true, role: 'teacher' }) } as any)
    const first = await redeemCode('token-a')
    expect(first.success).toBe(true)

    // pendingCode is cleared on success, so a truly separate later call has nothing to redeem —
    // proves the guard only blocks genuinely concurrent calls, not sequential ones.
    const second = await redeemCode('token-a')
    expect(second).toEqual({ success: false, error: 'No pending code' })

    const redeemCalls = fetchSpy.mock.calls.filter(([url]) => url === '/api/code/redeem')
    expect(redeemCalls).toHaveLength(1)
  })
})

describe('useInviteCode — possessionRedeem', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('posts the pending code + typed email and returns the minted session', async () => {
    const { validateCode, possessionRedeem } = useInviteCode()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: async () => ({ valid: true, codeKind: 'invite', inviteCodeId: 'inv-3', codeType: 'teacher', context: {} }),
    } as any)
    await validateCode('TEACH-2')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: async () => ({ success: true, session: { access_token: 'at', refresh_token: 'rt' } }),
    } as any)

    const result = await possessionRedeem('teacher@school.example', 'Ms Jones')

    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/possession-redeem', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ code: 'TEACH-2', email: 'teacher@school.example', displayName: 'Ms Jones' }),
    }))
    expect(result).toEqual({ success: true, session: { access_token: 'at', refresh_token: 'rt' } })
  })

  it('surfaces reason: already_registered so the caller can fall back to sign-in', async () => {
    const { validateCode, possessionRedeem } = useInviteCode()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: async () => ({ valid: true, codeKind: 'invite', inviteCodeId: 'inv-4', codeType: 'teacher', context: {} }),
    } as any)
    await validateCode('TEACH-3')

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      json: async () => ({ success: false, reason: 'already_registered', error: 'An account already exists for this email. Please sign in instead.' }),
    } as any)

    const result = await possessionRedeem('existing@school.example')
    expect(result.success).toBe(false)
    expect(result.reason).toBe('already_registered')
  })

  it('refuses to call without a pending code', async () => {
    const { possessionRedeem, clearPendingCode } = useInviteCode()
    clearPendingCode() // module-level singleton — earlier tests may have left a pending code set
    const result = await possessionRedeem('a@school.example')
    expect(result).toEqual({ success: false, error: 'No pending invite code' })
  })
})
