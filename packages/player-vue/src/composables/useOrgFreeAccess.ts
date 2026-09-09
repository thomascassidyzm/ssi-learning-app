/**
 * "IS THIS COURSE ALREADY PAID FOR, AND HOW DO I SAY SO?"
 *
 * One place for the whole of it, so the picker, the settings screen and the
 * paywall cannot drift into three different accounts of the same learner's
 * position. Reads the grant /api/subscription reports (api/_utils/
 * orgFreeAccess.ts) and turns it into the two questions surfaces actually ask:
 *
 *   coversCourse(code) — do NOT sell them this one, it is already theirs;
 *   needsOwnSubscription(code, name) — sell them this one, but say in the same
 *     breath what they already have, or the price contradicts the free year
 *     they were promised.
 *
 * The grant names courses, not languages, so a Canolfan learner is silent-on-
 * price for Welsh and quoted the ordinary price for Spanish. That is the
 * intended shape, not a gap.
 */
import { computed } from 'vue'
import { useSharedSubscription } from './useSubscription'
import { getLanguageName } from './useI18n'
import {
  languagesOfCourses,
  orgCoverLine,
  needsOwnSubscriptionLine,
} from './orgFreeAccessCopy'

export function useOrgFreeAccess() {
  const { freeAccess, hasFreeAccess } = useSharedSubscription()

  const coveredCourses = computed<string[]>(() =>
    hasFreeAccess.value ? (freeAccess.value?.courses ?? []) : []
  )

  const orgName = computed(() => freeAccess.value?.orgName ?? null)

  /** 'Welsh' — what the grant buys, in the learner's own interface language. */
  const coveredLanguages = computed(() =>
    languagesOfCourses(coveredCourses.value, (lang) => getLanguageName(lang))
  )

  const freeUntilLabel = computed(() => {
    const until = freeAccess.value?.until
    if (!until) return null
    const when = new Date(until)
    if (Number.isNaN(when.getTime())) return null
    return when.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  })

  /** Is THIS course already paid for by the funder? */
  function coversCourse(courseCode?: string | null): boolean {
    if (!courseCode) return false
    return coveredCourses.value.includes(courseCode)
  }

  /** 'Welsh is free until 8 September 2027 through …' — for the places that
   *  used to show a price and now have nothing to charge. */
  const coverLine = computed(() =>
    coveredCourses.value.length === 0
      ? ''
      : orgCoverLine({
          languages: coveredLanguages.value,
          orgName: orgName.value,
          until: freeUntilLabel.value,
        })
  )

  /**
   * The sentence for a course the grant does NOT cover. Empty when there is no
   * grant to explain — an ordinary learner reads the ordinary copy, unchanged.
   */
  function needsOwnSubscription(courseCode?: string | null, courseLanguage?: string | null): string {
    if (coveredCourses.value.length === 0) return ''
    if (coversCourse(courseCode)) return ''
    return needsOwnSubscriptionLine({
      languages: coveredLanguages.value,
      orgName: orgName.value,
      courseLanguage: courseLanguage ?? null,
    })
  }

  return {
    hasFreeAccess,
    freeAccess,
    coveredCourses,
    coveredLanguages,
    orgName,
    freeUntilLabel,
    coverLine,
    coversCourse,
    needsOwnSubscription,
  }
}
