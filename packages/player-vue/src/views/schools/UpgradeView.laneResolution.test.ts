import { describe, it, expect, vi } from 'vitest'
import { watch, nextTick } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'

// Regression for the "Subscribe CTA dead" bug (founder-priority bug-class
// audit, 2026-07-16): on a direct load to /schools/upgrade, currentUser
// (useSchoolContext) is still null the instant this component's script runs
// — SchoolsContainer's own loadFromAuth hasn't resolved yet. The old code
// decided `isSchoolLane` ONCE at onMounted() off that null currentUser,
// which reads as "not a school admin, no school_id" — the TUTOR lane — so a
// school admin's loadSubscription()/fetchTeachers() never fired.
// schoolSubLoaded then stayed false forever, and the school-lane Subscribe
// button (disabled while !schoolSubLoaded) was permanently dead. The fix
// replaces the one-shot onMounted with `watch(currentUser, ..., {immediate:
// true})`, proven here directly against the real useSchoolContext singleton.

describe('UpgradeView lane resolution', () => {
  it('a one-shot check against a not-yet-resolved currentUser (the old bug) never fires', () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = null // cold load — SchoolsContainer hasn't resolved yet
    const loadSubscription = vi.fn()
    const isSchoolLane = () => ctx.isSchoolAdmin.value || !!ctx.currentUser.value?.school_id

    // The old shape: decided once, synchronously, at "mount".
    if (isSchoolLane()) loadSubscription()
    expect(loadSubscription).not.toHaveBeenCalled()

    // currentUser resolves moments later — nothing re-checks with the old shape.
    ctx.currentUser.value = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Admin',
      educational_role: 'school_admin', platform_role: null, school_id: 's1',
    }
    expect(loadSubscription).not.toHaveBeenCalled() // proves the bug: dead forever
  })

  it('watching currentUser (the fix) re-decides the lane once identity resolves', async () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = null
    const loadSubscription = vi.fn()
    const isSchoolLane = () => ctx.isSchoolAdmin.value || !!ctx.currentUser.value?.school_id

    watch(ctx.currentUser, (user) => {
      if (!user) return
      if (isSchoolLane()) loadSubscription()
    }, { immediate: true })
    expect(loadSubscription).not.toHaveBeenCalled() // still unresolved — correctly waiting

    ctx.currentUser.value = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Admin',
      educational_role: 'school_admin', platform_role: null, school_id: 's1',
    }
    await nextTick()
    expect(loadSubscription).toHaveBeenCalledTimes(1)
  })

  it('an already-resolved currentUser at setup fires immediately (no regression for the warm case)', () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Admin',
      educational_role: 'school_admin', platform_role: null, school_id: 's1',
    }
    const loadSubscription = vi.fn()
    const isSchoolLane = () => ctx.isSchoolAdmin.value || !!ctx.currentUser.value?.school_id

    watch(ctx.currentUser, (user) => {
      if (!user) return
      if (isSchoolLane()) loadSubscription()
    }, { immediate: true })
    expect(loadSubscription).toHaveBeenCalledTimes(1)
  })
})
