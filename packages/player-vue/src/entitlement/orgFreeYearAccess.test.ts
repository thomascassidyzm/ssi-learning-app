/**
 * THE FREE YEAR ENDING, and handing back to normal paid billing.
 * =============================================================
 *
 * Kai, 2026-09-08, on the old system: enrolment sometimes failed to recognise
 * an existing learner and "consequently never cancelled their old
 * subscriptions" — some of which are still running a year later. The other
 * half of that ask was explicit: the free-year time limit must actually
 * expire, and the hand-back to paying must be smooth, and both should be built
 * and tested NOW rather than deferred with the cancellation question.
 *
 * WHAT IS BEING TESTED HERE, and why it is this function. Course access in
 * this app is decided by `checkCourseAccess` in @ssi/core — the same function
 * the player, the download gate and the server-side entitlement read all call.
 * The Canolfan free year is a `user_entitlements` row of access_type
 * 'courses', a granted_courses list and an expires_at, so what these tests
 * assert is that the shape this build writes behaves correctly in the function
 * that actually decides. No new access mechanism was invented; this is
 * verification that the existing one carries it, which is what Kai asked for.
 *
 * A note on the scope rule, verified against the live courses table on
 * 2026-09-08: exactly two Welsh courses are released and live — cym_n_for_eng
 * and cym_s_for_eng — and both are premium tier.
 *
 * This lives in player-vue rather than beside the endpoint because @ssi/core
 * is what it exercises, and the api vitest project does not resolve that
 * package. The rule it covers is the same one the server reads.
 */
import { describe, it, expect } from 'vitest'
import { checkCourseAccess } from '@ssi/core'

const WELSH_N = { course_code: 'cym_n_for_eng', pricing_tier: 'premium' as const, is_community: false }
const WELSH_S = { course_code: 'cym_s_for_eng', pricing_tier: 'premium' as const, is_community: false }
const SPANISH = { course_code: 'spa_for_eng', pricing_tier: 'premium' as const, is_community: false }

const IN_A_YEAR = new Date(Date.now() + 300 * 86400000).toISOString()
const LAST_MONTH = new Date(Date.now() - 30 * 86400000).toISOString()

/** What api/org/enrol.ts writes: the two Welsh courses, expiring. */
const freeYear = (expiresAt: string) => [{
  id: 'ent-canolfan',
  accessType: 'courses',
  grantedCourses: ['cym_n_for_eng', 'cym_s_for_eng'],
  expiresAt,
} as any]

/** No subscription at all — the ordinary Canolfan learner. */
const NOT_SUBSCRIBED = { isActive: false, tier: 'free', isPending: false } as any
/** They pay us directly, on top of or instead of the free year. */
const SUBSCRIBED = { isActive: true, tier: 'paid', isPending: false } as any

describe('during the free year', () => {
  it('unlocks the two Welsh courses', () => {
    for (const course of [WELSH_N, WELSH_S]) {
      const access = checkCourseAccess(course, NOT_SUBSCRIBED, freeYear(IN_A_YEAR))
      expect(access.canAccess, course.course_code).toBe(true)
      expect(access.reason, course.course_code).toBe('entitled')
      expect(access.upgradeRequired, course.course_code).toBe(false)
    }
  })

  it('FAILURE MODE: the free year quietly unlocking the whole catalogue', () => {
    // The grant is scoped, and Spanish is not in it. If this ever passes, we
    // are giving away every course to a funded cohort.
    const access = checkCourseAccess(SPANISH, NOT_SUBSCRIBED, freeYear(IN_A_YEAR))
    expect(access.canAccess).toBe(false)
    expect(access.upgradeRequired).toBe(true)
  })
})

describe('paying to upgrade on top of the free year', () => {
  it('a Canolfan learner who ALSO subscribes gets everything, Welsh included', () => {
    // Kai's point 5. The two are additive, not exclusive: the subscription is
    // checked before the entitlement and covers the whole catalogue, and the
    // Welsh grant keeps working underneath it.
    expect(checkCourseAccess(SPANISH, SUBSCRIBED, freeYear(IN_A_YEAR)).canAccess).toBe(true)
    expect(checkCourseAccess(WELSH_N, SUBSCRIBED, freeYear(IN_A_YEAR)).canAccess).toBe(true)
  })

  it('and if they later cancel that subscription, the free year is still theirs', () => {
    // The upgrade lapsing must not take the funded access with it.
    expect(checkCourseAccess(WELSH_N, NOT_SUBSCRIBED, freeYear(IN_A_YEAR)).canAccess).toBe(true)
    expect(checkCourseAccess(SPANISH, NOT_SUBSCRIBED, freeYear(IN_A_YEAR)).canAccess).toBe(false)
  })
})

describe('when the free year ends', () => {
  it('FAILURE MODE: an expired free year that keeps letting people in', () => {
    // A year that never actually ends is a year we cannot ever charge for, and
    // it is the mirror image of the old system's subscriptions that never
    // stopped charging.
    for (const course of [WELSH_N, WELSH_S]) {
      const access = checkCourseAccess(course, NOT_SUBSCRIBED, freeYear(LAST_MONTH))
      expect(access.canAccess, course.course_code).toBe(false)
    }
  })

  it('hands back to the ordinary paywall, not to a locked door', () => {
    // Smooth means: they become a normal free user. They can still hear the
    // preview, they are told an upgrade is what unlocks the rest, and nothing
    // about them needs repairing by hand.
    const access = checkCourseAccess(WELSH_N, NOT_SUBSCRIBED, freeYear(LAST_MONTH))
    expect(access.canPreview).toBe(true)
    expect(access.upgradeRequired).toBe(true)
    expect(access.reason).toBe('preview_only')
  })

  it('somebody who subscribed during the year notices nothing at all when it ends', () => {
    // The one transition that must be invisible: they were already paying, so
    // the expiry of the free grant changes nothing they can see.
    const before = checkCourseAccess(WELSH_N, SUBSCRIBED, freeYear(IN_A_YEAR))
    const after = checkCourseAccess(WELSH_N, SUBSCRIBED, freeYear(LAST_MONTH))
    expect(before.canAccess).toBe(true)
    expect(after.canAccess).toBe(true)
    expect(after.reason).toBe('subscribed')
  })

  it('expiry is decided by the date on the grant, with no grace nobody asked for', () => {
    const justGone = new Date(Date.now() - 1000).toISOString()
    const justLeft = new Date(Date.now() + 60_000).toISOString()
    expect(checkCourseAccess(WELSH_N, NOT_SUBSCRIBED, freeYear(justGone)).canAccess).toBe(false)
    expect(checkCourseAccess(WELSH_N, NOT_SUBSCRIBED, freeYear(justLeft)).canAccess).toBe(true)
  })

  it('a learner with no grant at all is exactly where an expired one leaves them', () => {
    // The hand-back is not a special state — it is simply the ordinary one.
    const expired = checkCourseAccess(WELSH_N, NOT_SUBSCRIBED, freeYear(LAST_MONTH))
    const never = checkCourseAccess(WELSH_N, NOT_SUBSCRIBED, [])
    expect(expired).toEqual(never)
  })
})
