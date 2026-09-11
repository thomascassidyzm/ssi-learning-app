/**
 * A first open with no referrer.
 *
 * FAILURE MODE (2026-09-08): a stranger opening the app in India — no
 * `?course=` link, no saved course, no enrolment — landed on a Chinese
 * course, because App.vue's fallback preferred the hardcoded `zho_for_eng`.
 */
import { describe, it, expect } from 'vitest'
import { pickFirstOpenDefaultCourse } from './firstOpenDefaultCourse'

// Alphabetical by display_name, which is the order App.vue fetches in.
const CATALOGUE = [
  { course_code: 'afr_for_eng', known_lang: 'eng', pricing_tier: 'free' },
  { course_code: 'eng_for_fra', known_lang: 'fra', pricing_tier: 'premium' },
  { course_code: 'deu_at_for_eng', known_lang: 'eng', pricing_tier: 'premium' },
  { course_code: 'zho_for_eng', known_lang: 'eng', pricing_tier: 'premium' },
]

const all = () => true

describe('pickFirstOpenDefaultCourse', () => {
  it('FAILURE MODE: a first open with no referrer no longer lands on Chinese', () => {
    const picked = pickFirstOpenDefaultCourse(CATALOGUE, all)
    expect(picked?.course_code).not.toBe('zho_for_eng')
    expect(picked?.course_code).toBe('afr_for_eng')
  })

  it('speaks English to a visitor it knows nothing about', () => {
    const picked = pickFirstOpenDefaultCourse(CATALOGUE, all)
    expect(picked?.known_lang).toBe('eng')
  })

  it('prefers a free English course over a premium one', () => {
    const premiumFirst = [
      { course_code: 'zho_for_eng', known_lang: 'eng', pricing_tier: 'premium' },
      { course_code: 'afr_for_eng', known_lang: 'eng', pricing_tier: 'free' },
    ]
    expect(pickFirstOpenDefaultCourse(premiumFirst, all)?.course_code).toBe('afr_for_eng')
  })

  it('takes a premium English course rather than a non-English one', () => {
    const onlyPremiumEnglish = [
      { course_code: 'cat_for_spa', known_lang: 'spa', pricing_tier: 'free' },
      { course_code: 'zho_for_eng', known_lang: 'eng', pricing_tier: 'premium' },
    ]
    expect(pickFirstOpenDefaultCourse(onlyPremiumEnglish, all)?.course_code).toBe('zho_for_eng')
  })

  it('falls back to the first accessible course when nothing is English-known', () => {
    const noEnglish = [
      { course_code: 'cat_for_spa', known_lang: 'spa', pricing_tier: 'free' },
      { course_code: 'zho_for_gle', known_lang: 'gle', pricing_tier: 'premium' },
    ]
    expect(pickFirstOpenDefaultCourse(noEnglish, all)?.course_code).toBe('cat_for_spa')
  })

  it('never returns a course the entitlement gate refuses', () => {
    const canAccess = (c: { course_code?: string | null }) => c.course_code !== 'afr_for_eng'
    expect(pickFirstOpenDefaultCourse(CATALOGUE, canAccess)?.course_code).toBe('deu_at_for_eng')
  })

  it('returns null for an empty or missing catalogue', () => {
    expect(pickFirstOpenDefaultCourse([], all)).toBeNull()
    expect(pickFirstOpenDefaultCourse(null, all)).toBeNull()
  })
})
