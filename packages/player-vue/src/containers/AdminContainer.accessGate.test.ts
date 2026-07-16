import { describe, it, expect, beforeEach } from 'vitest'
import { computed } from 'vue'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'

// AdminContainer.vue's knowsAnswer/isCheckingAccess/isDenied computeds,
// reproduced here against the REAL singletons — the founder-priority fix for
// /admin/* deep links bouncing straight to the bare player. Before this,
// AdminContainer had NO gate at all: the top-level router guard alone
// decided access, straight off the synchronous role cache, and denied
// outright whenever that cache didn't yet have an answer (a fresh browser,
// no cache). This gate is what lets the guard defer instead of deny, and
// still corrects (redirects) once the shared resolved-session gate
// genuinely resolves to a non-admin.

describe('AdminContainer access gate', () => {
  beforeEach(() => {
    localStorage.clear()
    useUserRole().clear()
    useResolvedSession().reset()
  })

  function gating() {
    const { canAccessAdmin, isInitialized } = useUserRole()
    const { isResolved } = useResolvedSession()
    const knowsAnswer = computed(() => isInitialized.value || isResolved.value)
    const isCheckingAccess = computed(() => !knowsAnswer.value)
    const isDenied = computed(() => knowsAnswer.value && !canAccessAdmin.value)
    return { isCheckingAccess: isCheckingAccess.value, isDenied: isDenied.value }
  }

  it('shows the loading state on a fresh browser — no cache, gate not yet resolved', () => {
    const { isCheckingAccess, isDenied } = gating()
    expect(isCheckingAccess).toBe(true)
    expect(isDenied).toBe(false) // must NOT deny just because we don't know yet
  })

  it('trusts an already-cached admin instantly — no wait for the async gate', () => {
    useUserRole().initialize('ssi_admin', null)
    const { isCheckingAccess, isDenied } = gating()
    expect(isCheckingAccess).toBe(false)
    expect(isDenied).toBe(false)
  })

  it('trusts an already-cached non-admin instantly and denies', () => {
    useUserRole().initialize(null, 'teacher')
    const { isCheckingAccess, isDenied } = gating()
    expect(isCheckingAccess).toBe(false)
    expect(isDenied).toBe(true)
  })

  it('a resolved guest (no cache, real session check finished) is denied, not left checking forever', () => {
    useResolvedSession().resolve(false)
    const { isCheckingAccess, isDenied } = gating()
    expect(isCheckingAccess).toBe(false)
    expect(isDenied).toBe(true)
  })

  it('an authenticated-but-role-not-yet-synced session keeps checking, never denies prematurely', () => {
    useResolvedSession().resolve(true)
    const { isCheckingAccess, isDenied } = gating()
    expect(isCheckingAccess).toBe(true)
    expect(isDenied).toBe(false)

    useUserRole().initialize('ssi_admin', null)
    const after = gating()
    expect(after.isCheckingAccess).toBe(false)
    expect(after.isDenied).toBe(false)
  })
})
