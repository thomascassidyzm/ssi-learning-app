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
 *
 * Job #627 (2026-09-14) — Tom on staging: "the handbook still appears to be
 * pointing to the prose, rather than the clips". Three things were wrong
 * and each has a test below: the clip sat under four blocks of prose; a
 * school admin was offered almost nothing because the walks that run on
 * their own home were authored for "leader" only; and a teacher's tap landed
 * on the class LIST, where nothing claims a class-page walk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HandbookView from './HandbookView.vue'
import { handbookEntries } from '@/walkthrough/handbook'
import { walkById, clearDeferredWalk, claimDeferredWalk, useWalkthrough } from '@/walkthrough/useWalkthrough'
import { clipsFor } from '@/walkthrough/handbook'

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

// The class list the view resolves a class-page clip against: empty here, so
// the destination falls back to the list, except where a test fills it.
vi.mock('@/composables/schools/useClassesData', async () => {
  const { ref } = await import('vue')
  const classes = ref<any[]>([])
  const fetchClasses = vi.fn(() => Promise.resolve())
  return { useClassesData: () => ({ classes, fetchClasses }), __classes: classes, __fetchClasses: fetchClasses }
})

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

// An entry with a clip for the persona, read from the pack, so the test
// cannot outlive the corpus.
function entryWithClipFor(persona: string, place?: string) {
  return handbookEntries().find((e) => {
    const ids = clipsFor(e, persona as any)
    return ids.length > 0 && e.personas.includes(persona as any) && (!place || walkById(ids[0])!.place.route === place)
  })
}

describe('HandbookView — the clip leads, where a clip exists', () => {
  beforeEach(async () => {
    push.mockClear(); clearDeferredWalk(); useWalkthrough().stopWalk()
    const mod: any = await import('@/composables/schools/useClassesData')
    mod.__classes.value = []
  })

  it('opens a clip entry on Show me with one caption line, the words folded beneath; a prose-only entry opens on its words', async () => {
    const wrapper = await mountAs(SCHOOL_ADMIN)
    const withClip = entryWithClipFor('school_admin')
    const without = handbookEntries().find((e) => clipsFor(e, 'school_admin').length === 0)
    expect(withClip, 'the pack has at least one school_admin entry with a clip').toBeTruthy()
    expect(without).toBeTruthy()
    expect(wrapper.find(`#hb-${withClip!.id} .entry-clip-pill`).exists(), 'the closed entry already says it plays').toBe(true)
    await wrapper.find(`#hb-${withClip!.id} .entry-head`).trigger('click')
    await wrapper.find(`#hb-${without!.id} .entry-head`).trigger('click')
    const body = wrapper.find(`#hb-${withClip!.id} .entry-body`)
    const first = body.element.firstElementChild as HTMLElement
    expect(first.className).toContain('entry-clip')
    const offer = body.find('[data-walk-offer]')
    expect(offer.exists()).toBe(true)
    expect(offer.attributes('data-walk-offer')).toBe(clipsFor(withClip!, 'school_admin')[0])
    expect(offer.text()).toContain('Show me')
    expect(body.find('.entry-caption').exists()).toBe(true)
    expect(body.find('.entry-prose').exists(), 'the words are folded until asked for').toBe(false)
    await body.find('.entry-prose-toggle').trigger('click')
    expect(wrapper.find(`#hb-${withClip!.id} .entry-prose`).text()).toContain(withClip!.how[0].replace(/\*\*/g, ''))
    const plain = wrapper.find(`#hb-${without!.id} .entry-body`)
    expect(plain.find('[data-walk-offer]').exists()).toBe(false)
    expect(plain.find('.entry-prose').exists()).toBe(true)
  })

  it('a school admin is offered the clips that run on their own home — the account and invite walks, not only Ways in', async () => {
    const wrapper = await mountAs(SCHOOL_ADMIN)
    for (const id of ['put-the-app-on-your-device', 'set-or-change-your-password', 'bring-your-first-person-in']) {
      await wrapper.find(`#hb-${id} .entry-head`).trigger('click')
      expect(wrapper.find(`#hb-${id} [data-walk-offer]`).exists(), `${id} offers a clip to a school admin`).toBe(true)
    }
  })

  it('an entry whose anchor is a step of a walk offers that walk without a hand-written link', async () => {
    const wrapper = await mountAs({ ...SCHOOL_ADMIN, educational_role: 'govt_admin' })
    const entry = handbookEntries().find((e) => e.id === 'choose-what-role-someone-arrives-as')!
    expect(entry.walk).toBeNull()
    await wrapper.find(`#hb-${entry.id} .entry-head`).trigger('click')
    expect(wrapper.find(`#hb-${entry.id} [data-walk-offer]`).attributes('data-walk-offer')).toBe('invite-first-person')
  })

  it('a tap defers every clip for the capability and goes to its place; the node that fits claims its own', async () => {
    const wrapper = await mountAs({ ...SCHOOL_ADMIN, educational_role: 'govt_admin', group_id: 'g1' })
    await wrapper.find('#hb-bring-your-first-person-in .entry-head').trigger('click')
    await wrapper.find('#hb-bring-your-first-person-in [data-walk-offer]').trigger('click')
    expect(push).toHaveBeenCalledWith('/org/g1')
    expect(useWalkthrough().activeWalk.value).toBeNull()
    // A school claims the teacher walk; the org walk is for an org or a group.
    expect(claimDeferredWalk('leader', 'node-home', 'school')).toBe(true)
    expect(useWalkthrough().activeWalk.value?.id).toBe('invite-first-teacher')
  })

  it('a class-page clip takes the teacher to their first class, not the class list', async () => {
    const mod: any = await import('@/composables/schools/useClassesData')
    mod.__classes.value = [{ id: 'class-7a' }, { id: 'class-8b' }]
    const wrapper = await mountAs({ ...SCHOOL_ADMIN, educational_role: 'teacher' })
    const entry = entryWithClipFor('teacher', 'node-home')!
    await wrapper.find(`#hb-${entry.id} .entry-head`).trigger('click')
    await wrapper.find(`#hb-${entry.id} [data-walk-offer]`).trigger('click')
    expect(push).toHaveBeenCalledWith('/org/class-7a')
    expect(claimDeferredWalk('teacher', 'node-home', 'class')).toBe(true)
    expect(useWalkthrough().activeWalk.value?.id).toBe(clipsFor(entry, 'teacher')[0])
  })

  it('fetches the class list on mount for staff with a class-page clip, and falls back to the list until it lands', async () => {
    const mod: any = await import('@/composables/schools/useClassesData')
    const wrapper = await mountAs({ ...SCHOOL_ADMIN, educational_role: 'teacher' })
    expect(mod.__fetchClasses).toHaveBeenCalled()
    const entry = entryWithClipFor('teacher', 'node-home')!
    await wrapper.find(`#hb-${entry.id} .entry-head`).trigger('click')
    await wrapper.find(`#hb-${entry.id} [data-walk-offer]`).trigger('click')
    expect(push).toHaveBeenCalledWith('/schools/classes')
  })

  it('does not offer a walk that is not for the reader\'s persona', async () => {
    const wrapper = await mountAs({ ...SCHOOL_ADMIN, educational_role: 'teacher' })
    await wrapper.find('#hb-the-invites-desk .entry-head').trigger('click')
    expect(wrapper.find('#hb-the-invites-desk [data-walk-offer]').exists()).toBe(false)
  })
})
