/**
 * Trial policy — the ONE place that answers "what trial does this node get"
 * (founder ruling 2026-08-02, verbatim):
 *
 *   · ORGS (neutral dressing): 30-day trial. All languages. That is the only
 *     org trial.
 *   · SCHOOLS (education dressing) ONLY: 365-day trial for Welsh + all
 *     non-premium languages; premium languages for schools follow the
 *     standard 30-day trial.
 *
 * The policy hangs off the node's DRESSING (org vs school — the same split
 * player-vue's nodeTerminology.ts derives for vocabulary), never off scattered
 * conditionals. Heritage = Welsh + free/minority languages; callers derive it
 * from !isCommercialCourse (@ssi/core) — that stays the single premium-ness
 * source, this file is the single trial-LENGTH source.
 *
 * Consumers (all re-export or import from here — do not re-declare days):
 *   · api/_utils/orgPlatform.ts        — org creation stamp + backfill
 *   · api/_utils/schoolPlatformTrial.ts — school/tutor trial provisioning
 *   · api/govt/create-school.ts        — leader-created school (no course yet
 *     → heritage default: the generous window, mirrors provision.ts)
 */

/** Org (neutral dressing): 30 days, every language included. */
export const ORG_TRIAL_DAYS = 30

/** School on a premium (Big-10 / commercial) course: standard 30 days. */
export const SCHOOL_PREMIUM_TRIAL_DAYS = 30

/** School on Welsh or any non-premium course: a full year. */
export const SCHOOL_HERITAGE_TRIAL_DAYS = 365

/** Tutors always get the standard 30-day window. */
export const TUTOR_TRIAL_DAYS = 30

export type TrialDressing = 'org' | 'school'

/**
 * The whole ruling as one function. `isHeritage` only means anything for the
 * school dressing (an org's trial covers all languages by definition).
 */
export function trialDaysFor(dressing: TrialDressing, isHeritage = false): number {
  if (dressing === 'org') return ORG_TRIAL_DAYS
  return isHeritage ? SCHOOL_HERITAGE_TRIAL_DAYS : SCHOOL_PREMIUM_TRIAL_DAYS
}
