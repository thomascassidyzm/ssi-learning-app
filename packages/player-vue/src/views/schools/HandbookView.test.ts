/**
 * HandbookView — the page must RENDER the compiled capabilities, badged.
 *
 * A predicate test would not prove the founder's rulings, so this mounts the
 * real SFC. Two rulings hold it, and the second amends the first:
 *
 *  - 2026-09-07: EVERY capability shows, badged by role, not only the
 *    reader's own — a teacher seeing what an admin can do is how they know
 *    who to ask.
 *  - 2026-09-16: "the whole list is a bit overwhelming". So the page OPENS on
 *    the reader's own, grouped by moment, and everything-with-badges is what
 *    "Read the lot" gives you. Nothing was taken away; the tap moved.
 *
 * The entries come from the compiled pack — if this file ever needed a
 * hardcoded list of capabilities to pass, the design would already be broken.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HandbookView from './HandbookView.vue'
import { handbookEntries, HANDBOOK_MOMENTS, HANDBOOK_SECTIONS, ROLE_BADGES } from '@/walkthrough/handbook'

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'schools-handbook', params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(() => Promise.resolve()), replace: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const TEACHER = {
  user_id: 'u', learner_id: 'l', display_name: 'Nia',
  educational_role: 'teacher' as const, platform_role: null,
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

const readTheLot = (w: any) => w.findAll('.btn-ghost').find((b: any) => b.text().includes('Read the lot'))!

describe('HandbookView', () => {
  it('opens on just the reader\'s own capabilities, grouped by moment', async () => {
    const wrapper = await mountAs(TEACHER)
    const text = wrapper.text()
    const mine = handbookEntries().filter((e) => e.personas.includes('teacher'))
    const theirs = handbookEntries().filter((e) => !e.personas.includes('teacher'))
    expect(mine.length).toBeGreaterThan(0)
    for (const e of mine) expect(text, e.id).toContain(e.title)
    expect(text).not.toContain(theirs[0].title)
    // The three moments, in frequency order, are the headings on the page.
    for (const m of HANDBOOK_MOMENTS) expect(text).toContain(m.title)
  })

  it('"Read the lot" gives back every capability, badged with whose it is', async () => {
    const wrapper = await mountAs(TEACHER)
    await readTheLot(wrapper).trigger('click')
    const text = wrapper.text()
    const all = handbookEntries()
    expect(all.length).toBeGreaterThan(0)
    for (const e of all) expect(text, e.id).toContain(e.title)
    // …in the six alphabetical sections, the compendium's own index.
    for (const s of HANDBOOK_SECTIONS) expect(text).toContain(s.title)
    const pills = wrapper.findAll('.status-pill').map((p) => p.text())
    expect(pills.length).toBeGreaterThan(0)
    for (const p of pills) expect(Object.values(ROLE_BADGES)).toContain(p)
  })

  it('leads with Your next three, above everything else', async () => {
    const wrapper = await mountAs(TEACHER)
    const next = wrapper.find('.handbook-next')
    expect(next.exists()).toBe(true)
    expect(next.findAll('.next-link')).toHaveLength(3)
  })

  it('opens an entry in place, with its prose', async () => {
    const wrapper = await mountAs(TEACHER)
    // A capability WITH a clip opens on Show me and folds its words away
    // (job #627), so read the prose off one that has none.
    const head = wrapper.findAll('.entry-head').find((h) => !h.find('.entry-clip-pill').exists())!
    const title = head.find('.entry-title').text()
    const entry = handbookEntries().find((e) => e.title === title)!
    await head.trigger('click')
    const body = wrapper.find('.entry-body')
    expect(body.exists()).toBe(true)
    expect(body.text()).toContain(entry.how[0].replace(/\*\*/g, ''))
  })

  it('searches locally and finds nothing gracefully', async () => {
    const wrapper = await mountAs(TEACHER)
    await wrapper.find('.handbook-search').setValue('zzzznotacapability')
    expect(wrapper.find('.handbook-empty').exists()).toBe(true)
  })
})
