/**
 * HandbookView — the page must RENDER the compiled capabilities, badged.
 *
 * A predicate test would not prove the founder's two rulings of 2026-09-07,
 * so this mounts the real SFC: every capability shows for a teacher, not
 * only their own, and the ones that are not theirs carry a role badge saying
 * whose they are. The entries come from the compiled pack — if this file
 * ever needed a hardcoded list of capabilities to pass, the design would
 * already be broken.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HandbookView from './HandbookView.vue'
import { handbookEntries, ROLE_BADGES } from '@/walkthrough/handbook'

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'schools-handbook', params: {}, query: {} }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
}))

const TEACHER = {
  user_id: 'u', learner_id: 'l', display_name: 'Nia',
  educational_role: 'teacher' as const, platform_role: null,
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

describe('HandbookView', () => {
  it('renders every compiled capability, not a list of its own', async () => {
    const wrapper = await mountAs(TEACHER)
    const text = wrapper.text()
    const all = handbookEntries()
    expect(all.length).toBeGreaterThan(0)
    for (const e of all) expect(text, e.id).toContain(e.title)
  })

  it('badges the capabilities that are somebody else\'s, per the 2026-09-07 ruling', async () => {
    const wrapper = await mountAs(TEACHER)
    const notATeachers = handbookEntries().filter((e) => !e.personas.includes('teacher'))
    expect(notATeachers.length).toBeGreaterThan(0)
    const pills = wrapper.findAll('.status-pill').map((p) => p.text())
    expect(pills.length).toBeGreaterThan(0)
    for (const p of pills) expect(Object.values(ROLE_BADGES)).toContain(p)
  })

  it('narrows to the reader\'s own capabilities only when they ask', async () => {
    const wrapper = await mountAs(TEACHER)
    const mine = handbookEntries().filter((e) => e.personas.includes('teacher'))
    const theirs = handbookEntries().filter((e) => !e.personas.includes('teacher'))
    expect(mine.length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain(theirs[0].title)
    await wrapper.findAll('.scope-option')[1].trigger('click')
    expect(wrapper.text()).toContain(mine[0].title)
    expect(wrapper.text()).not.toContain(theirs[0].title)
  })

  it('opens an entry in place, with its prose', async () => {
    const wrapper = await mountAs(TEACHER)
    const entry = handbookEntries()[0]
    await wrapper.find('.entry-head').trigger('click')
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
