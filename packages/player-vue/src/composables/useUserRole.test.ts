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

// THE-MODEL §1.3/§2.1/I5: 'tutor' is a groupless teacher, not a separate
// type — every gate that admits 'teacher' must admit 'tutor' identically.
describe('useUserRole — tutor is teacher-shaped (THE-MODEL I5)', () => {
  beforeEach(() => {
    localStorage.clear()
    useUserRole().clear()
  })

  it('isTeacher/hasSchoolRole/canAccessSchools are all true for a tutor, matching a school teacher', () => {
    const { initialize, isTeacher, hasSchoolRole, canAccessSchools } = useUserRole()
    initialize(null, 'tutor')
    expect(isTeacher.value).toBe(true)
    expect(hasSchoolRole.value).toBe(true)
    expect(canAccessSchools.value).toBe(true)

    initialize(null, 'teacher')
    expect(isTeacher.value).toBe(true)
    expect(hasSchoolRole.value).toBe(true)
    expect(canAccessSchools.value).toBe(true)
  })

  it('a plain student or unset role is still excluded', () => {
    const { initialize, isTeacher, hasSchoolRole } = useUserRole()
    initialize(null, 'student')
    expect(isTeacher.value).toBe(false)
    expect(hasSchoolRole.value).toBe(false)

    initialize(null, null)
    expect(isTeacher.value).toBe(false)
    expect(hasSchoolRole.value).toBe(false)
  })
})

// setAuthoritative() — the counterpart for the ONE caller (useAuth's
// syncRealRoleCache) that always holds the full, real DB row. The
// initialize() guard above is correct for partial-knowledge callers, but its
// original implementation (458bb15f) accidentally also swallowed a genuine
// demotion from a full-row caller: since it evaluates each field
// independently, `syncRealRoleCache(null, 'teacher')` for a real
// de-platformed ssi_admin hit the exact same "null + cached non-null →
// preserve" branch as RedeemCode's partial write. That meant a demoted
// ssi_admin's platform_role NEVER cleared from the cache — not on
// useAdminGate's periodic re-validation (Trinity audit finding #2,
// docs/trinity/admin.md), and not even on a hard reload (restoreFromCache()
// seeds the stale 'ssi_admin' from localStorage before the DB re-fetch
// lands, so the guard sees "cached non-null" and wins every time) — only an
// explicit sign-out actually fixed it. setAuthoritative always writes
// exactly what the DB says, including a genuine null.
describe('useUserRole setAuthoritative() — full-row sync', () => {
  beforeEach(() => {
    localStorage.clear()
    useUserRole().clear()
  })

  it('reflects a genuine platform-role demotion to null, unlike initialize()', () => {
    const { setAuthoritative, platformRole, educationalRole } = useUserRole()
    setAuthoritative('ssi_admin', null)
    expect(platformRole.value).toBe('ssi_admin')

    // The real DB row now has platform_role: null (de-platformed) and a new
    // educational role — both fields known, both genuinely this value.
    setAuthoritative(null, 'teacher')
    expect(platformRole.value).toBeNull()
    expect(educationalRole.value).toBe('teacher')
  })

  it('the same demotion via initialize() is (correctly, for a partial caller) swallowed — proving the two paths differ', () => {
    const { initialize, platformRole } = useUserRole()
    initialize('ssi_admin', null)
    initialize(null, 'teacher')
    expect(platformRole.value).toBe('ssi_admin') // partial-payload guard still protects RedeemCode's call shape
  })

  it('survives a restoreFromCache() reload seed — the hard-reload case, not just live revalidation', () => {
    const { setAuthoritative, restoreFromCache, platformRole, isInitialized } = useUserRole()
    setAuthoritative('ssi_admin', null) // yesterday's session, persisted to localStorage

    // Simulate a fresh page load's in-memory state (nothing resolved yet)
    // WITHOUT touching localStorage — clear() would wipe the cache this
    // scenario depends on; a real reload only resets the JS heap.
    platformRole.value = null
    isInitialized.value = false
    restoreFromCache() // seeds isInitialized=true, platformRole='ssi_admin' from the stale cache

    // The post-reload DB fetch discovers the demotion.
    setAuthoritative(null, 'teacher')
    expect(platformRole.value).toBeNull()
  })

  it('persists the genuine null to localStorage', () => {
    const { setAuthoritative } = useUserRole()
    setAuthoritative('ssi_admin', null)
    setAuthoritative(null, 'teacher')

    const stored = JSON.parse(localStorage.getItem('ssi-user-role') || '{}')
    expect(stored.platformRole).toBeNull()
    expect(stored.educationalRole).toBe('teacher')
  })
})
