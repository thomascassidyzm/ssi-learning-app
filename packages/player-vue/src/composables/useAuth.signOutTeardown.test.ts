import { describe, it, expect, beforeEach } from 'vitest'
import { useAuth } from './useAuth'
import { useUserRole } from './useUserRole'
import { useStartSurface } from './useStartSurface'
import { useSchoolContext } from './schools/useSchoolContext'
import { useResolvedSession } from './useResolvedSession'

// Founder ruling 2026-07-18 (remember progress, not position): view-as /
// impersonation context and any "which surface was I on" state is strictly
// session-scoped — signOut must tear it ALL down so a later login can never
// resurrect it. This is the regression test for the trap where a stale
// role/class context from a tutor test session resurfaced the /schools
// dashboard in a view-as context on a fresh login.

describe('signOut teardown — view-as and surface state die with the session', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    useStartSurface().clear()
    useSchoolContext().clear()
    useResolvedSession().reset()
  })

  it('clears the persisted class-context, dashboard breadcrumb and demo class state', async () => {
    localStorage.setItem('ssi-active-class', JSON.stringify({ id: 'c1', name: '6S' }))
    localStorage.setItem('ssi-last-dashboard', 'schools')
    sessionStorage.setItem('ssi-demo-active-class', JSON.stringify({ id: 'c2', name: 'Demo' }))

    await useAuth().signOut()

    expect(localStorage.getItem('ssi-active-class')).toBeNull()
    expect(localStorage.getItem('ssi-last-dashboard')).toBeNull()
    expect(sessionStorage.getItem('ssi-demo-active-class')).toBeNull()
  })

  it('clears an in-memory view-as (admin-view persona) school context', async () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = {
      user_id: 'persona-uid',
      learner_id: 'persona-learner',
      display_name: 'Tutor Test',
      educational_role: 'tutor',
      platform_role: null,
      _scopeSource: 'admin-view',
    }

    await useAuth().signOut()

    expect(ctx.currentUser.value).toBeNull()
  })

  it('clears the role cache and the start-surface preference singleton', async () => {
    useUserRole().initialize(null, 'tutor')
    useStartSurface().setFromPreferences({ start_surface: 'schools' })

    await useAuth().signOut()

    expect(useUserRole().isInitialized.value).toBe(false)
    expect(localStorage.getItem('ssi-user-role')).toBeNull()
    expect(useStartSurface().preferred.value).toBeNull()
  })

  it('does NOT touch course-progress persistence', async () => {
    localStorage.setItem('ssi_learning_position_spa_for_eng', JSON.stringify({ legoId: 'S0042L03' }))
    localStorage.setItem('ssi-last-course', 'spa_for_eng')

    await useAuth().signOut()

    expect(localStorage.getItem('ssi_learning_position_spa_for_eng')).not.toBeNull()
    expect(localStorage.getItem('ssi-last-course')).toBe('spa_for_eng')
  })
})
