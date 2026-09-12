/**
 * HandbookView — where a capability has a clip in the pack, the Handbook
 * entry offers it (job #302, 2026-09-12). Tom: "the How This Works clips
 * don't surface in the handbook". Before this change the page rendered the
 * prose and nothing else, though pack.json named the walk on the entry.
 *
 * The walk cannot run on the Handbook page — its anchors live on the page
 * the capability lives on — so the tap defers the walk and goes there; the
 * destination's own Show-me surface claims it on mount (useWalkthrough
 * claimDeferredWalk). This test proves the Handbook half: the affordance
 * exists on an entry with a walk for the reader's persona, is absent on an
 * entry without one, and a tap defers exactly that walk and navigates to
 * the walk's place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HandbookView from './HandbookView.vue'
import { handbookEntries } from '@/walkthrough/handbook'
import { walkById, clearDeferredWalk, claimDeferredWalk, useWalkthrough } from '@/walkthrough/useWalkthrough'

const push = vi.fn(() => Promise.resolve())
vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'schools-handbook', params: {}, query: {} }),
  useRouter: () => ({ push, replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const SCHOOL_ADMIN = {
  user_id: 'u', learner_id: 'l', display_name: 'Angharad',
  educational_role: 'school_admin' as const, platform_role: null,
  school_id: 'school-1', _scopeSource: 'self' as const,
}

vi.mock('@/composables/schools/useSchoolContext', async () => {
  const { ref } = await import('vue')
  const currentUser = ref<any>(null)
  return { useSchoolContext: () => ({ currentUser }), __currentUser: currentUser }
})

async function mountAs(user: any) {
  const mod: any = await import('@/composables/schools/useSchoolContext')
  mod.__currentUser.value = user
  return mount(HandbookView)
}

// An entry whose walk is for the persona, read from the pack, so the test
// cannot outlive the corpus.
function entryWithWalkFor(persona: string) {
  return handbookEntries().find((e) => {
    const w = e.walk ? walkById(e.walk) : null
    return !!w && w.personas.includes(persona as any) && e.personas.includes(persona as any)
  })
}

describe('HandbookView — Show me, where a clip exists', () => {
  beforeEach(() => { push.mockClear(); clearDeferredWalk(); useWalkthrough().stopWalk() })

  it('offers the walk on an entry that has one for the reader, and not on one that has none', async () => {
    const wrapper = await mountAs(SCHOOL_ADMIN)
    const withWalk = entryWithWalkFor('school_admin')
    const without = handbookEntries().find((e) => !e.walk)
    expect(withWalk, 'the pack has at least one school_admin entry with a walk').toBeTruthy()
    expect(without).toBeTruthy()
    await wrapper.find(`#hb-${withWalk!.id} .entry-head`).trigger('click')
    await wrapper.find(`#hb-${without!.id} .entry-head`).trigger('click')
    const offer = wrapper.find(`#hb-${withWalk!.id} [data-walk-offer]`)
    expect(offer.exists(), 'the entry with a clip shows Show me').toBe(true)
    expect(offer.attributes('data-walk-offer')).toBe(withWalk!.walk)
    expect(offer.text()).toContain('Show me')
    expect(offer.text()).toContain(walkById(withWalk!.walk!)!.title)
    expect(wrapper.find(`#hb-${without!.id} [data-walk-offer]`).exists()).toBe(false)
  })

  it('a tap defers that walk and goes to the page it lives on; nothing plays on the Handbook itself', async () => {
    const wrapper = await mountAs(SCHOOL_ADMIN)
    const entry = entryWithWalkFor('school_admin')!
    const walk = walkById(entry.walk!)!
    await wrapper.find(`#hb-${entry.id} .entry-head`).trigger('click')
    await wrapper.find(`#hb-${entry.id} [data-walk-offer]`).trigger('click')
    expect(push).toHaveBeenCalledTimes(1)
    expect(String((push.mock.calls as unknown[][])[0][0]).length).toBeGreaterThan(1)
    // Not started here — the Handbook has none of the walk's anchors.
    expect(useWalkthrough().activeWalk.value).toBeNull()
    // The destination's own Show-me surface claims it, by persona × place.
    expect(claimDeferredWalk('teacher', 'nowhere')).toBe(false)
    expect(claimDeferredWalk('school_admin', walk.place.route, walk.place.kinds?.[0])).toBe(true)
    expect(useWalkthrough().activeWalk.value?.id).toBe(walk.id)
  })

  it('does not offer a walk that is not for the reader\'s persona', async () => {
    const wrapper = await mountAs({ ...SCHOOL_ADMIN, educational_role: 'teacher' })
    const leaderOnly = handbookEntries().find((e) => {
      const w = e.walk ? walkById(e.walk) : null
      return !!w && !w.personas.includes('teacher')
    })
    expect(leaderOnly, 'the pack has a walk that is not a teacher\'s').toBeTruthy()
    await wrapper.find(`#hb-${leaderOnly!.id} .entry-head`).trigger('click')
    expect(wrapper.find(`#hb-${leaderOnly!.id} [data-walk-offer]`).exists()).toBe(false)
  })
})
