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
 *  - 2026-09-17: the sections themselves are SHUT, showing a count, so the
 *    page opens as a handful of lines. Every capability is still there, one
 *    tap down — which is what these tests open before reading.
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
/** Sections are shut by default — open every one of them to read the rows. */
async function openEverySection(w: any): Promise<void> {
  // Re-query each time: opening one section re-renders the list, and a wrapper
  // captured before that is pointing at a node that has been replaced.
  for (let i = 0; i < w.findAll('.section-head').length; i++) {
    const head = w.findAll('.section-head')[i]
    if (head.attributes('aria-expanded') !== 'true') await head.trigger('click')
  }
}

describe('HandbookView', () => {
  it('opens on just the reader\'s own capabilities, grouped by moment', async () => {
    const wrapper = await mountAs(TEACHER)
    await openEverySection(wrapper)
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
    await openEverySection(wrapper)
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
    await openEverySection(wrapper)
    const head = wrapper.findAll('.entry-head')[0]
    const title = head.find('.entry-title').text()
    const entry = handbookEntries().find((e) => e.title === title)!
    await head.trigger('click')
    const body = wrapper.find('.entry-body')
    expect(body.exists()).toBe(true)
    // A capability WITH a clip opens on Show me and folds its words away
    // (job #627). Since the bug-report steps were folded into their tasks
    // (job #69, 2026-09-17) every teacher capability has a clip, so the words
    // are always one more tap: "Written out".
    const fold = body.find('.entry-prose-toggle')
    if (fold.exists()) await fold.trigger('click')
    expect(wrapper.find('.entry-prose').text()).toContain(entry.how[0].replace(/\*\*/g, ''))
  })

  /**
   * Tom, 2026-09-17 (job #68): "'Just what I can do' is not a link". It was a
   * grey caption next to one button whose label flipped. Both scopes are now
   * buttons with fixed words, and the one you are in is pressed.
   */
  it('both scopes are real controls and the one you are in is pressed', async () => {
    const wrapper = await mountAs(TEACHER)
    const tabs = wrapper.findAll('.scope-tab')
    expect(tabs).toHaveLength(2)
    const mine = tabs.find((b) => b.text().includes('Just what I can do'))!
    const lot = tabs.find((b) => b.text().includes('Read the lot'))!
    expect(mine.attributes('aria-pressed')).toBe('true')
    expect(lot.attributes('aria-pressed')).toBe('false')
    // No plain-text caption doing the job a control should do.
    expect(wrapper.find('.handbook-scope').exists()).toBe(false)

    await lot.trigger('click')
    expect(lot.attributes('aria-pressed')).toBe('true')
    expect(mine.attributes('aria-pressed')).toBe('false')
    expect(mine.text()).toBe('Just what I can do')
    expect(lot.text()).toBe('Read the lot')
    // Tapping the scope you are already in changes nothing.
    await lot.trigger('click')
    expect(lot.attributes('aria-pressed')).toBe('true')

    await mine.trigger('click')
    expect(mine.attributes('aria-pressed')).toBe('true')
    const theirs = handbookEntries().filter((e) => !e.personas.includes('teacher'))
    expect(wrapper.text()).not.toContain(theirs[0].title)
  })

  it('searches locally and finds nothing gracefully', async () => {
    const wrapper = await mountAs(TEACHER)
    await wrapper.find('.handbook-search').setValue('zzzznotacapability')
    expect(wrapper.find('.handbook-empty').exists()).toBe(true)
  })

  // SHUT, SEARCHABLE, AND YOU CAN GET BACK TO THE TOP (Tom on staging,
  // 2026-09-17). Four behaviours, each one of his sentences.
  it('opens with every section shut, each showing its count', async () => {
    const wrapper = await mountAs(TEACHER)
    const heads = wrapper.findAll('.section-head')
    expect(heads.length).toBeGreaterThan(0)
    expect(wrapper.findAll('.entry-head')).toHaveLength(0)
    const counts = wrapper.findAll('.section-count').map((c) => Number(c.text()))
    const mine = handbookEntries().filter((e) => e.personas.includes('teacher'))
    expect(counts.reduce((a, b) => a + b, 0)).toBe(mine.length)
  })

  it('a section opens on its own tap, and shuts again', async () => {
    const wrapper = await mountAs(TEACHER)
    const head = wrapper.findAll('.section-head')[0]
    await head.trigger('click')
    expect(wrapper.findAll('.entry-head').length).toBeGreaterThan(0)
    await wrapper.findAll('.section-head')[0].trigger('click')
    expect(wrapper.findAll('.entry-head')).toHaveLength(0)
  })

  it('search filters the rows WITHOUT expanding any of them', async () => {
    const wrapper = await mountAs(TEACHER)
    const mine = handbookEntries().filter((e) => e.personas.includes('teacher'))
    const target = mine.find((e) => e.title.toLowerCase().includes('class'))!
    await wrapper.find('.handbook-search').setValue(target.title)
    const titles = wrapper.findAll('.entry-title').map((el) => el.text())
    expect(titles).toContain(target.title)
    expect(titles.length).toBeLessThan(mine.length)
    // Rows are narrowed, never opened: Show me stays on the closed row and
    // reading the words is a deliberate tap.
    expect(wrapper.findAll('.entry-body')).toHaveLength(0)
  })

  it('a chip jumps to its section and opens it', async () => {
    const wrapper = await mountAs(TEACHER)
    const chips = wrapper.findAll('.handbook-chip')
    expect(chips.length).toBeGreaterThan(0)
    await chips[0].trigger('click')
    expect(chips[0].classes()).toContain('is-open')
    expect(wrapper.findAll('.entry-head').length).toBeGreaterThan(0)
  })

  it('offers back to the top once the surface is scrolled', async () => {
    const root = document.createElement('div')
    root.className = 'schools-container'
    document.body.appendChild(root)
    const wrapper = await mountAs(TEACHER)
    expect(wrapper.find('.handbook-totop').exists()).toBe(false)
    Object.defineProperty(root, 'scrollTop', { value: 900, configurable: true })
    root.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.handbook-totop').exists()).toBe(true)
    root.remove()
  })
})
