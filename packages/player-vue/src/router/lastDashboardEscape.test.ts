import { describe, it, expect, beforeEach } from 'vitest'
import router, { lastDashboard } from './index'
import { useUserRole } from '@/composables/useUserRole'

// The schools/tutor "return to dashboard" escape (App.vue's playerEscapeDashboard)
// reads lastDashboard() while sitting on the player route ('/'). This exercises
// the real route guards that write the breadcrumb, then confirms it survives
// the navigation into the player — the exact sequence a staff member's Learn
// button click produces.

describe('lastDashboard breadcrumb into the player route', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    await router.push('/')
  })

  it('is null for a plain learner who never visited a staff dashboard', async () => {
    expect(lastDashboard()).toBeNull()
  })

  it('reads "schools" after a school-role user visits /schools, and survives navigating to the player', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/schools')
    expect(lastDashboard()).toBe('schools')

    await router.push('/')
    expect(lastDashboard()).toBe('schools')
  })

  it('reads "teach" after a tutor visits /tutors/dashboard, and survives navigating to the player', async () => {
    await router.push('/tutors/dashboard')
    expect(lastDashboard()).toBe('teach')

    await router.push('/')
    expect(lastDashboard()).toBe('teach')
  })
})
