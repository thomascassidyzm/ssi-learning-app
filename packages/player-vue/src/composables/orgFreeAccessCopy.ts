/**
 * WHAT IS FREE, AND WHAT IS NOT — said in one voice, in every place that says it.
 *
 * A learner on a funded org enrolment has free access to the courses their
 * funder bought, and to nothing else. Both halves of that have to be said, and
 * said together: "you need a subscription", on its own, in front of somebody
 * who has just been told their year is free, reads as a contradiction and
 * frightens exactly the learner this cohort is full of (Kai, 2026-09-08).
 *
 * Pure functions, no Vue, so the sentences can be tested as sentences.
 * British English, mechanism only, no parentheses — the house voice.
 */

/** 'cym_n_for_eng' → 'cym'. Dialect suffixes collapse: North and South Welsh
 *  are both Welsh to a learner reading a sentence about what they can play. */
export function baseLangOfCourseCode(code: string): string {
  const target = (code || '').split('_for_')[0] || ''
  return target.replace(/_(n|s|north|south|latam)$/i, '')
}

/** ['Welsh'] → 'Welsh'. ['Welsh','Irish'] → 'Welsh and Irish'.
 *  ['a','b','c'] → 'a, b and c'. No Oxford comma; this is British copy. */
export function joinNames(names: string[]): string {
  const clean = names.filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`
}

/** The language names a set of course codes teaches, deduped, in order. */
export function languagesOfCourses(codes: string[], nameFor: (lang: string) => string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const code of codes) {
    const base = baseLangOfCourseCode(code)
    if (!base || seen.has(base)) continue
    seen.add(base)
    const name = nameFor(base)
    if (name) names.push(name)
  }
  return names
}

/** Settings, and the picker's premium header: what they have, and until when. */
export function orgCoverLine(opts: { languages: string[]; orgName?: string | null; until?: string | null }): string {
  const langs = joinNames(opts.languages)
  const through = opts.orgName ? ` through ${opts.orgName}` : ' through your group'
  const until = opts.until ? ` until ${opts.until}` : ''
  if (!langs) return `Free${until}${through}`.trim()
  return `${langs} is free${until}${through}`
}

/**
 * The paywall, and any other "you need a subscription" moment, for a learner
 * who already has free access to something else. Names both sides so the two
 * facts stop contradicting each other.
 */
export function needsOwnSubscriptionLine(opts: {
  languages: string[]
  orgName?: string | null
  courseLanguage?: string | null
}): string {
  const langs = joinNames(opts.languages)
  if (!langs) return ''
  const through = opts.orgName ? ` through ${opts.orgName}` : ' through your group'
  const other = opts.courseLanguage && opts.courseLanguage !== langs
    ? `${opts.courseLanguage} needs its own subscription.`
    : 'This one needs its own subscription.'
  return `You have free access to ${langs}${through}. ${other}`
}
