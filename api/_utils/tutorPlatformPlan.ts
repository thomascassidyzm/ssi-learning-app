/**
 * isTutorPlatformPlanName — is this subscriptions.plan_name a paid tutor?
 *
 * The tutor_platform checkout stamps 'SSi Premium (tutor bundle)'. But a
 * Family owner who also pays for the tutor bundle keeps 'SSi Family' on
 * their single subscriptions row (Family outranks Premium there, and that
 * row carries five other people's access) — so a literal match on the tutor
 * bundle name alone can't see that they're a paying tutor too. Both plan
 * names count.
 */
export const TUTOR_PLATFORM_PLAN_NAME = 'SSi Premium (tutor bundle)'
export const FAMILY_PLAN_NAME = 'SSi Family'

export function isTutorPlatformPlanName(planName: string | null | undefined): boolean {
  return planName === TUTOR_PLATFORM_PLAN_NAME || planName === FAMILY_PLAN_NAME
}
