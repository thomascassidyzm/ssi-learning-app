import { describe, it, expect, beforeEach } from 'vitest'
import { useUserRole } from './useUserRole'

// initialize()'s null-downgrade guard — the clobber half of the ssi_admin
// no-access bug on staging. Some callers only know ONE role (e.g.
// RedeemCode.vue's optimistic post-redemption write knows the just-redeemed
// educational role but passes null for platform) and null there means "I
// don't know", not "clear this". Overwriting a known non-null role with that
// null previously stuck via localStorage until the next full DB re-sync.

describe('useUserRole initialize() null-downgrade guard', () => {
  beforeEach(() => {
    localStorage.clear()
    useUserRole().clear()
  })

  it('does not downgrade a known platform role when a caller passes null', () => {
    const { initialize, platformRole } = useUserRole()
    initialize('ssi_admin', null)
    expect(platformRole.value).toBe('ssi_admin')

    // A partial-payload caller (e.g. redeeming a school join code) only
    // knows the educational role and passes null for platform.
    initialize(null, 'teacher')
    expect(platformRole.value).toBe('ssi_admin') // preserved, not clobbered
    expect(useUserRole().educationalRole.value).toBe('teacher')
  })

  it('does not downgrade a known educational role when a caller passes null', () => {
    const { initialize, educationalRole } = useUserRole()
    initialize(null, 'govt_admin')
    expect(educationalRole.value).toBe('govt_admin')

    initialize('tester', null)
    expect(educationalRole.value).toBe('govt_admin') // preserved
    expect(useUserRole().platformRole.value).toBe('tester')
  })

  it('persists the preserved (not the clobbered-null) value to localStorage', () => {
    const { initialize } = useUserRole()
    initialize('ssi_admin', null)
    initialize(null, 'teacher')

    const stored = JSON.parse(localStorage.getItem('ssi-user-role') || '{}')
    expect(stored.platformRole).toBe('ssi_admin')
    expect(stored.educationalRole).toBe('teacher')
  })

  it('accepts a genuine null when nothing was previously cached', () => {
    const { initialize, platformRole, educationalRole } = useUserRole()
    initialize(null, null)
    expect(platformRole.value).toBeNull()
    expect(educationalRole.value).toBeNull()
  })

  it('a genuine role demotion requires an explicit clear/logout, not a silent initialize() downgrade', () => {
    // initialize() can't tell "caller doesn't know this field" apart from
    // "the DB genuinely says null now" — both arrive as null. Per the
    // standing rule, a non-null role only ever comes down via clear(); a
    // background re-sync alone can't silently de-privilege a cached admin.
    const { initialize, clear, platformRole } = useUserRole()
    initialize('ssi_admin', null)
    initialize(null, null)
    expect(platformRole.value).toBe('ssi_admin')

    clear()
    expect(platformRole.value).toBeNull()
  })

  it('logout still clears both roles regardless of the guard', () => {
    const { initialize, clear, platformRole, educationalRole, isInitialized } = useUserRole()
    initialize('ssi_admin', 'govt_admin')
    clear()
    expect(platformRole.value).toBeNull()
    expect(educationalRole.value).toBeNull()
    expect(isInitialized.value).toBe(false)
    expect(localStorage.getItem('ssi-user-role')).toBeNull()
  })
})
