/**
 * What course a stranger lands in on a first open with nothing to go on.
 *
 * FAILURE MODE (dev + staging, 2026-09-08): App.vue's fallback preferred a
 * hardcoded course code — `zho_for_eng` — so somebody opening SaySomethingin
 * for the first time in India, with no `?course=` link, no saved preference
 * and no enrolment, was looking at a Chinese course in the first three
 * seconds. Kai hit the same thing behind the Canolfan picker, which is what
 * `scopedPickerClose.ts` closed; this is the general default it deliberately
 * left alone.
 *
 * There is nothing to infer about a visitor we know nothing about, and this
 * does not try: no locale sniffing, no geo guess. It states the one honest
 * thing the app can say — the visitor is being spoken to in English, so the
 * course behind the picker is one whose KNOWN language is English. Among
 * those a free course beats a premium one, because a premium course is a
 * 19-seed preview and a paywall is a poor first three seconds.
 *
 * The ordering inside each band is the catalogue's own (App.vue orders by
 * display_name), so this adds no ranking of its own — it filters, and the
 * course it picks is stamped 'default' by the caller, never 'chosen'.
 */

export interface CatalogueCourse {
  course_code?: string | null
  known_lang?: string | null
  pricing_tier?: string | null
}

const ENGLISH = 'eng'

/**
 * @param courses the catalogue, in the order the app fetched it
 * @param canAccess the app's own entitlement gate — access OR preview
 */
export function pickFirstOpenDefaultCourse<T extends CatalogueCourse>(
  courses: readonly T[] | null | undefined,
  canAccess: (course: T) => boolean,
): T | null {
  const open = (courses ?? []).filter((c) => c && canAccess(c))
  if (open.length === 0) return null
  const englishKnown = open.filter((c) => (c.known_lang || '').toLowerCase() === ENGLISH)
  return (
    englishKnown.find((c) => (c.pricing_tier || '').toLowerCase() !== 'premium') ||
    englishKnown[0] ||
    open[0]
  )
}
