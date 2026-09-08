/**
 * The per-course question, and the sentence that goes with each answer.
 *
 * The picker, the settings screen and the player's paywall all ask this one
 * composable, so the three of them cannot end up telling a Canolfan learner
 * three different stories about what their funder bought.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'

const freeAccess = ref<{ groupId: string; orgName: string | null; until: string; courses: string[] } | null>(null)
const hasFreeAccess = computed(() => {
  const until = freeAccess.value?.until
  return !!until && new Date(until) > new Date()
})

vi.mock('./useSubscription', () => ({
  useSharedSubscription: () => ({ freeAccess, hasFreeAccess }),
}))

import { useOrgFreeAccess } from './useOrgFreeAccess'

const FUTURE = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString()
const CANOLFAN = {
  groupId: 'g1',
  orgName: 'the National Centre for Learning Welsh',
  until: FUTURE,
  courses: ['cym_n_for_eng', 'cym_s_for_eng'],
}

beforeEach(() => { freeAccess.value = null })

describe('is this course already paid for?', () => {
  it('yes for the courses the funder bought, both dialects', () => {
    freeAccess.value = { ...CANOLFAN }
    const { coversCourse } = useOrgFreeAccess()
    expect(coversCourse('cym_n_for_eng')).toBe(true)
    expect(coversCourse('cym_s_for_eng')).toBe(true)
  })

  it('FAILURE MODE: no for a language they were never given', () => {
    freeAccess.value = { ...CANOLFAN }
    const { coversCourse } = useOrgFreeAccess()
    expect(coversCourse('spa_for_eng')).toBe(false)
    expect(coversCourse(null)).toBe(false)
  })

  it('no for anybody without a grant, and no for an expired one', () => {
    expect(useOrgFreeAccess().coversCourse('cym_n_for_eng')).toBe(false)
    freeAccess.value = { ...CANOLFAN, until: '2020-01-01T00:00:00.000Z' }
    expect(useOrgFreeAccess().coversCourse('cym_n_for_eng')).toBe(false)
  })
})

describe('what the surfaces say', () => {
  it('names the language, the date and the funder, dialects collapsed', () => {
    freeAccess.value = { ...CANOLFAN }
    const { coverLine } = useOrgFreeAccess()
    expect(coverLine.value).toContain('Welsh is free until')
    expect(coverLine.value).toContain('the National Centre for Learning Welsh')
    // One "Welsh", not two, however many dialects the grant lists.
    expect(coverLine.value.match(/Welsh is free/g)).toHaveLength(1)
  })

  it('FAILURE MODE: the wall for another language explains itself', () => {
    freeAccess.value = { ...CANOLFAN }
    const { needsOwnSubscription } = useOrgFreeAccess()
    expect(needsOwnSubscription('spa_for_eng', 'Spanish')).toBe(
      'You have free access to Welsh through the National Centre for Learning Welsh. Spanish needs its own subscription.'
    )
  })

  it('says nothing for a course that IS covered — there is no wall to explain', () => {
    freeAccess.value = { ...CANOLFAN }
    expect(useOrgFreeAccess().needsOwnSubscription('cym_n_for_eng', 'Welsh')).toBe('')
  })

  it('says nothing to an ordinary learner — their copy is untouched', () => {
    expect(useOrgFreeAccess().needsOwnSubscription('spa_for_eng', 'Spanish')).toBe('')
    expect(useOrgFreeAccess().coverLine.value).toBe('')
  })
})
