/**
 * Trial policy — the ONE place that answers "what trial does this node get"
 * (founder ruling 2026-09-10, verbatim):
 *
 *   "NO - schools are 30 days for premium languages apart from Welsh. Welsh
 *    and all free languages are 365 day trials for all educational
 *    institutions"
 *
 * So the split is by LANGUAGE, not by dressing:
 *
 *   · PREMIUM (Big-10 target) course → 30 days.
 *   · WELSH + every free / minority language → 365 days.
 *   · …for EVERY educational institution — schools AND orgs alike. The
 *     earlier ruling of 2026-08-02, under which an org got a flat 30-day
 *     all-language window whatever it was teaching, is SUPERSEDED by the
 *     above and no longer encoded here.
 *
 * Heritage = Welsh + free/minority languages; callers derive it from
 * !isCommercialCourse (@ssi/core) — that stays the single premium-ness source,
 * this file is the single trial-LENGTH source. Do not add a second
 * classification: Welsh is priced premium yet is heritage for trial length,
 * and target-language classification already carries that.
 *
 * Tutors are deliberately UNTOUCHED by the 2026-09-10 ruling: a solo tutor is
 * not an educational institution, so TUTOR_TRIAL_DAYS stays 30 for every
 * language until the founder says otherwise.
 *
 * Consumers (all re-export or import from here — do not re-declare days):
 *   · api/_utils/orgPlatform.ts        — org creation stamp + backfill
 *   · api/_utils/schoolPlatformTrial.ts — school/tutor trial provisioning
 *   · api/govt/create-school.ts        — leader-created school (no course yet
 *     → heritage default: the generous window, mirrors provision.ts)
 *   · api/admin/set-trial.ts           — admin restore window
 */

/** Any educational institution on a premium (Big-10 / commercial) course. */
export const PREMIUM_TRIAL_DAYS = 30

/** Any educational institution on Welsh or a free / minority language. */
export const HERITAGE_TRIAL_DAYS = 365

/** School on a premium (Big-10 / commercial) course: standard 30 days. */
export const SCHOOL_PREMIUM_TRIAL_DAYS = PREMIUM_TRIAL_DAYS

/** School on Welsh or any non-premium course: a full year. */
export const SCHOOL_HERITAGE_TRIAL_DAYS = HERITAGE_TRIAL_DAYS

/**
 * The window a COURSE-LESS org opens with.
 *
 * An org is class-less and picks no language at signup, so there is nothing to
 * derive its length from at creation time. It therefore takes the generous
 * window — the same default api/govt/create-school.ts already gives a
 * course-less school — on the principle that the reversible mistake is the
 * one to make: an over-long trial can be shortened by an operator, a
 * customer's dashboard going dark eleven months early cannot be undone.
 *
 * NOT "30 days, all languages" any more (superseded 2026-09-10).
 */
export const ORG_TRIAL_DAYS = HERITAGE_TRIAL_DAYS

/** Tutors always get the standard 30-day window — see the header. */
export const TUTOR_TRIAL_DAYS = PREMIUM_TRIAL_DAYS

export type TrialDressing = 'org' | 'school'

/**
 * The whole ruling as one function. `isHeritage` now means the same thing for
 * BOTH dressings: schools and orgs are both educational institutions, and the
 * language decides the length for either.
 */
export function trialDaysFor(_dressing: TrialDressing, isHeritage = false): number {
  return isHeritage ? HERITAGE_TRIAL_DAYS : PREMIUM_TRIAL_DAYS
}
