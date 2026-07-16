import { describe, it, expect, beforeEach } from 'vitest'
import { computed } from 'vue'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'

// Reproduces SchoolsContainer.vue's showLogin/showDashboard/hasSchoolContext
// gating against the REAL useUserRole + useSchoolContext singletons — the
// same style as SchoolsContainer.showNoAccess.test.ts.
//
// Bug: auth.signOut() (useAuth.ts) clears the role cache + entitlement
// caches but never touched useSchoolContext's currentUser singleton.
// SchoolsTopBar.vue's sign-out (used by every already-signed-in schools
// user — the ONLY sign-out path in the app that does a soft router.push
// instead of a hard reload) left ctx.currentUser holding the ex-user's
// data. hasSchoolContext then stayed wrongly true post-sign-out, which
// starves showLogin (needs !hasSchoolContext) — and because canAccessSchools
// is also false post-clear, showDashboard fails too. Neither gate is
// satisfied: the container renders nothing until a hard reload wipes the
// stale singleton clean. This is the reachable root cause behind "signs in
// as a different role in the same tab, dashboard doesn't load without a
// manual refresh."
describe('SchoolsContainer sign-out leaves a clean gating state', () => {
  const role = useUserRole()
  const ctx = useSchoolContext()

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    role.clear()
    ctx.clear()
  })

  function gating(isAuthenticated: boolean) {
    const hasSchoolContext = computed(() => !!ctx.currentUser.value)
    const showLogin = computed(() => !isAuthenticated && !hasSchoolContext.value)
    const showDashboard = computed(
      () => (isAuthenticated || hasSchoolContext.value) && role.canAccessSchools.value,
    )
    return { hasSchoolContext: hasSchoolContext.value, showLogin: showLogin.value, showDashboard: showDashboard.value }
  }

  it('signed in as govt_admin: dashboard gate is satisfied', () => {
    role.initialize(null, 'govt_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'govt-1', learner_id: 'l1', display_name: 'Leader', educational_role: 'govt_admin', platform_role: null,
    }
    const g = gating(true)
    expect(g.showDashboard).toBe(true)
    expect(g.showLogin).toBe(false)
  })

  it('after sign-out (role + school context both cleared), the login gate is clean — not a dead zone', () => {
    // Prior session: govt_admin signed in.
    role.initialize(null, 'govt_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'govt-1', learner_id: 'l1', display_name: 'Leader', educational_role: 'govt_admin', platform_role: null,
    }

    // The fixed sign-out sequence — mirrors auth.signOut() + SchoolsTopBar's
    // added ctx.clear() call.
    role.clear()
    ctx.clear()

    const g = gating(false)
    expect(g.hasSchoolContext).toBe(false)
    expect(g.showLogin).toBe(true) // clean login door, not a blank screen
    expect(g.showDashboard).toBe(false)
  })

  it('regression guard: without clearing school context, sign-out strands the container in neither state', () => {
    role.initialize(null, 'govt_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'govt-1', learner_id: 'l1', display_name: 'Leader', educational_role: 'govt_admin', platform_role: null,
    }

    // Old buggy sequence: only the role cache is cleared.
    role.clear()

    const g = gating(false)
    expect(g.hasSchoolContext).toBe(true) // stale — the bug
    expect(g.showLogin).toBe(false) // login door is hidden...
    expect(g.showDashboard).toBe(false) // ...but the dashboard never satisfies either. Dead zone.
  })

  it('a fresh sign-in as a DIFFERENT user after a clean sign-out loads that user\'s own context', () => {
    role.initialize(null, 'govt_admin')
    ;(ctx.currentUser as any).value = {
      user_id: 'govt-1', learner_id: 'l1', display_name: 'Leader', educational_role: 'govt_admin', platform_role: null,
    }
    role.clear()
    ctx.clear()

    // New teacher signs in.
    role.initialize(null, 'teacher')
    ;(ctx.currentUser as any).value = {
      user_id: 'teacher-1', learner_id: 'l2', display_name: 'Teacher', educational_role: 'teacher', platform_role: null,
    }

    const g = gating(true)
    expect(g.showDashboard).toBe(true)
    expect(ctx.currentUser.value?.user_id).toBe('teacher-1')
  })
})
