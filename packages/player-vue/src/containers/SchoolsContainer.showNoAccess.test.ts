import { describe, it, expect, beforeEach } from 'vitest'
import { computed } from 'vue'
import { useUserRole } from '@/composables/useUserRole'

// SchoolsContainer.vue's showNoAccess/isRoleLoading computeds, reproduced
// here against the REAL useUserRole singleton. These guard the race that hit
// staging: an ssi_admin's auth session resolves (isAuthenticated=true)
// before the learner-row fetch has populated the role cache
// (isInitialized=false) — canAccessSchools defaults false until then, so a
// naive `isAuthenticated && !canAccessSchools` reads as "no access" and
// flashes (or sticks on) the join-code wall for a user who actually has it.

describe('SchoolsContainer no-access gating', () => {
  const { canAccessSchools, isInitialized, clear } = useUserRole()

  beforeEach(() => {
    localStorage.clear()
    clear()
  })

  function gating(isAuthenticated: boolean, isAuthLoading: boolean) {
    const isRoleLoading = computed(() => isAuthenticated && !isInitialized.value)
    const showNoAccess = computed(
      () => isAuthenticated && isInitialized.value && !canAccessSchools.value && !isAuthLoading,
    )
    return { isRoleLoading: isRoleLoading.value, showNoAccess: showNoAccess.value }
  }

  it('does not show the no-access door while the role cache is uninitialized', () => {
    // Auth has resolved but useUserRole().initialize() hasn't run yet —
    // exactly the staging race.
    const { showNoAccess, isRoleLoading } = gating(true, false)
    expect(showNoAccess).toBe(false)
    expect(isRoleLoading).toBe(true)
  })

  it('shows the no-access door once roles are known and genuinely absent', () => {
    useUserRole().initialize(null, null)
    const { showNoAccess, isRoleLoading } = gating(true, false)
    expect(showNoAccess).toBe(true)
    expect(isRoleLoading).toBe(false)
  })

  it('never shows the no-access door for an initialized ssi_admin', () => {
    useUserRole().initialize('ssi_admin', null)
    const { showNoAccess, isRoleLoading } = gating(true, false)
    expect(showNoAccess).toBe(false)
    expect(isRoleLoading).toBe(false)
  })
})
