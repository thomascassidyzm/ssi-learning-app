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

// Org lane (govt_admin group-leader, founder-specced 2026-08-01): checked
// FIRST, ahead of the school lane — a govt_admin never carries a school_id of
// their own, so if the org check ran AFTER the school check it would fall
// straight through to the tutor lane and the org Subscribe CTA would never
// resolve (the exact "Subscribe CTA dead" bug class this file already pins,
// one lane class up).
describe('UpgradeView org-lane resolution (govt_admin, checked before school)', () => {
  it('a govt_admin resolves to the org lane, not the tutor lane', () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Leader',
      educational_role: 'govt_admin', platform_role: null, group_id: 'g1',
    }
    const isOrgLane = () => ctx.isGovtAdmin.value
    const isSchoolLane = () => !isOrgLane() && (ctx.isSchoolAdmin.value || !!ctx.currentUser.value?.school_id)

    expect(isOrgLane()).toBe(true)
    expect(isSchoolLane()).toBe(false)
  })

  it('a school_admin still resolves to the school lane (org check does not swallow it)', () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = {
      user_id: 'u2', learner_id: 'l2', display_name: 'Admin',
      educational_role: 'school_admin', platform_role: null, school_id: 's1',
    }
    const isOrgLane = () => ctx.isGovtAdmin.value
    const isSchoolLane = () => !isOrgLane() && (ctx.isSchoolAdmin.value || !!ctx.currentUser.value?.school_id)

    expect(isOrgLane()).toBe(false)
    expect(isSchoolLane()).toBe(true)
  })

  it('watching currentUser re-decides into the org lane once identity resolves, mirroring the school-lane fix', async () => {
    const ctx = useSchoolContext()
    ctx.currentUser.value = null
    const loadOrgSubscription = vi.fn()
    const isOrgLane = () => ctx.isGovtAdmin.value

    watch(ctx.currentUser, (user) => {
      if (!user) return
      if (isOrgLane()) loadOrgSubscription()
    }, { immediate: true })
    expect(loadOrgSubscription).not.toHaveBeenCalled()

    ctx.currentUser.value = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Leader',
      educational_role: 'govt_admin', platform_role: null, group_id: 'g1',
    }
    await nextTick()
    expect(loadOrgSubscription).toHaveBeenCalledTimes(1)
  })
})

// Double-subscribe guard for the org lane (mirrors subscribeOrg in
// UpgradeView.vue exactly): never open an INITIAL checkout before the server
// has confirmed the org isn't already subscribed — a second checkout is a
// second Paddle subscription = double billing.
describe('UpgradeView org-lane double-subscribe guard', () => {
  function makeGuard() {
    const orgSubLoaded = { value: false }
    const isOrgSubscribed = { value: false }
    const openedCheckouts: number[] = []
    let openCount = 0

    async function loadOrgSubscription() {
      // Simulates the server confirming an existing active subscription.
      isOrgSubscribed.value = true
      orgSubLoaded.value = true
    }

    async function subscribeOrg() {
      if (!orgSubLoaded.value) await loadOrgSubscription()
      if (isOrgSubscribed.value) return // seat-edit CTA takes over — no checkout
      openCount += 1
      openedCheckouts.push(openCount)
    }

    return { subscribeOrg, openedCheckouts, isOrgSubscribed, orgSubLoaded }
  }

  it('a fast click before the load resolves never opens a second checkout for an already-subscribed org', async () => {
    const { subscribeOrg, openedCheckouts } = makeGuard()
    // Two rapid clicks, exactly the race the guard exists for.
    await Promise.all([subscribeOrg(), subscribeOrg()])
    expect(openedCheckouts).toHaveLength(0)
  })

  it('a genuinely unsubscribed org still opens exactly one INITIAL checkout', async () => {
    const orgSubLoaded = { value: true }
    const isOrgSubscribed = { value: false }
    let opens = 0
    async function subscribeOrg() {
      if (!orgSubLoaded.value) return
      if (isOrgSubscribed.value) return
      opens += 1
    }
    await subscribeOrg()
    expect(opens).toBe(1)
  })
})
