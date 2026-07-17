import { describe, it, expect, vi } from 'vitest'
import { ref, watch, nextTick } from 'vue'

// Regression for the admin read-view containers (AdminSchoolsContainer,
// AdminGroupContainer, AdminUserProgress, AdminClassDetail) — all four
// shared the identical shape: `onMounted(() => loadContext(routeId))` plus a
// route-id-only watch, where loadContext silently no-ops if
// auth.learner.value (the injected useAuth instance) isn't populated yet.
// On a direct load, auth.learner.value IS still null at that instant (its DB
// fetch hasn't resolved) — so isLoading stayed true forever: dead on cold
// load, undiscovered until this founder-priority bug-class audit. The fix
// watches the learner ref alongside the route id, in all four containers.

describe('admin read-view context loading', () => {
  it('loadContext triggered only by route id (the old bug) never recovers once the learner resolves late', async () => {
    const routeId = ref('school-1')
    const learner = ref<{ id: string } | null>(null)
    const loadContext = vi.fn((id: string) => {
      if (!learner.value) return // mirrors the real guard
    })

    watch(routeId, (id) => { if (id) loadContext(id) }) // old shape: no immediate, no learner dep
    expect(loadContext).not.toHaveBeenCalled()

    learner.value = { id: 'l1' } // resolves moments later
    await nextTick()
    expect(loadContext).not.toHaveBeenCalled() // proves the bug: nothing re-triggers
  })

  it('watching [routeId, learner] together (the fix) fires once both are known', async () => {
    const routeId = ref('school-1')
    const learner = ref<{ id: string } | null>(null)
    const loadContext = vi.fn()

    watch([routeId, learner], ([id, l]) => { if (id && l) loadContext(id) }, { immediate: true })
    expect(loadContext).not.toHaveBeenCalled() // learner not resolved yet — correctly waiting

    learner.value = { id: 'l1' }
    await nextTick()
    expect(loadContext).toHaveBeenCalledTimes(1)
    expect(loadContext).toHaveBeenCalledWith('school-1')
  })

  it('an already-resolved learner at setup fires immediately (no regression for the warm case)', async () => {
    const routeId = ref('school-1')
    const learner = ref<{ id: string } | null>({ id: 'l1' })
    const loadContext = vi.fn()

    watch([routeId, learner], ([id, l]) => { if (id && l) loadContext(id) }, { immediate: true })
    expect(loadContext).toHaveBeenCalledTimes(1)
  })

  it('still reloads when only the route id changes (paging between classes/schools)', async () => {
    const routeId = ref('school-1')
    const learner = ref<{ id: string } | null>({ id: 'l1' })
    const loadContext = vi.fn()

    watch([routeId, learner], ([id, l]) => { if (id && l) loadContext(id) }, { immediate: true })
    routeId.value = 'school-2'
    await nextTick()
    expect(loadContext).toHaveBeenCalledTimes(2)
    expect(loadContext).toHaveBeenLastCalledWith('school-2')
  })
})
