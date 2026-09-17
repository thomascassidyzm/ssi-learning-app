/**
 * ClassBrain — the Course journey card, drawn.
 *
 * What is pinned here: the card says NEW PHRASES for chunks met for the first
 * time and PRACTISED for hearings and repeats, which is the distinction Tom
 * asked for on 2026-09-17; the ink reaches only as far as the class has played;
 * and the replay and the full-screen overlay are on the card itself, not
 * somewhere else to navigate to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ClassBrain from './ClassBrain.vue'
import type { ClassBrainPayload } from './classBrainData'

const payload: ClassBrainPayload = {
  courseCode: 'cym_s_for_eng',
  legos: [
    { id: 'S0001L01', seed: 1, t: 'dw i', k: 'I am' },
    { id: 'S0001L02', seed: 1, t: 'eisiau', k: 'want' },
    { id: 'S0002L01', seed: 2, t: 'dysgu', k: 'to learn' },
    { id: 'S0003L01', seed: 3, t: 'siarad', k: 'to speak' },
  ],
  legosTotal: 320,
  axisFrom: 0,
  events: [
    { t: '2026-09-15T09:00:00.000Z', lego: 0, phrase: null, fires: [0], kind: 'intro', hearings: 2, s: 0 },
    { t: '2026-09-15T09:00:20.000Z', lego: 1, phrase: null, fires: [1], kind: 'intro', hearings: 2, s: 0 },
    { t: '2026-09-16T09:00:00.000Z', lego: 2, phrase: 'cym_s_for_eng:S0002L01B01', fires: [0, 2], kind: 'build', hearings: 2, s: 1 },
  ],
  sittings: ['2026-09-15', '2026-09-16'],
  phrases: { 'cym_s_for_eng:S0002L01B01': { t: 'dw i eisiau dysgu', k: 'I want to learn', lego: 2, role: 'build', pos: 1 } },
  tally: { total: 3, hearings: 6, detoured: 0, intro: 2, debut: 0, build: 1, use: 0, other: 0 },
  introducedCount: 2,
  distinctPhrases: 1,
  minutes: 24,
  reachedSeed: 2,
  reachedSeedText: { t: 'dw i eisiau dysgu Cymraeg', k: 'I want to learn Welsh' },
  seedsTotal: 40,
  windowDays: 180,
}

function mountBrain() {
  return mount(ClassBrain, { props: { classId: 'class-1', getToken: async () => 'token' } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })) as never)
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('ClassBrain', () => {
  it('names NEW PHRASES for first meetings and PRACTISED for the repeats', async () => {
    const w = mountBrain()
    await flushPromises()
    const text = w.text()
    expect(text).toContain('New phrases')
    expect(text).toContain('Practised')
    // Two chunks met, one phrase practised, six hearings behind it.
    expect(text).toContain('1 phrases')
    expect(text).toContain('practised 6 times')
    // The old word is gone from the card entirely.
    expect(text).not.toContain('Phrases introduced')
    // HEARD is wrong and is gone (Tom, 2026-09-17): the class has not heard the
    // phrase until after it has tried to say it, so the card never claims it.
    expect(text.toLowerCase()).not.toContain('heard')
  })

  it('lights only the chunks the class has played, and leaves the rest grey', async () => {
    const w = mountBrain()
    await flushPromises()
    const fills = w.findAll('circle').map((c) => c.attributes('fill'))
    expect(fills).toHaveLength(4)
    // Three chunks fired across the three cycles; the fourth is not yet reached.
    expect(fills.filter((f) => f === '#e4dfd8')).toHaveLength(1)
  })

  it('opens the replay on the card, without navigating anywhere', async () => {
    const w = mountBrain()
    await flushPromises()
    expect(w.find('#cb-replay').exists()).toBe(false)
    await w.findAll('button').find((b) => b.text().includes('Replay'))!.trigger('click')
    expect(w.find('#cb-replay').exists()).toBe(true)
    expect(w.text()).toContain('dw i eisiau dysgu')
    // No link out: the brain is the card.
    expect(w.findAll('a')).toHaveLength(0)
  })

  it('expands to a full-screen overlay with an obvious close', async () => {
    const w = mountBrain()
    await flushPromises()
    await w.findAll('button').find((b) => b.attributes('aria-label') === 'Open full screen')!.trigger('click')
    await flushPromises()
    const overlay = document.querySelector('.cb-full')
    expect(overlay).not.toBeNull()
    expect(overlay!.querySelector('.cb-close')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('leaves full screen by Close, by the scrim, by Escape and by the back gesture', async () => {
    const w = mountBrain()
    await flushPromises()
    const expand = (): Promise<void> => w.findAll('button').find((b) => b.attributes('aria-label') === 'Open full screen')!.trigger('click')

    // 1. the large labelled Close
    await expand()
    await flushPromises()
    expect(document.querySelector('.cb-full')).not.toBeNull()
    expect(document.querySelector('.cb-close')!.textContent).toContain('Close')
    await (document.querySelector('.cb-close') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('.cb-full')).toBeNull()

    // 2. the scrim strip above the sheet
    await expand()
    await flushPromises()
    ;(document.querySelector('.cb-scrim') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('.cb-full')).toBeNull()

    // 3. Escape, on a desktop
    await expand()
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(document.querySelector('.cb-full')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('THE BACK GESTURE: opening pushes a history entry, and popping it closes the overlay', async () => {
    // Tom got stuck in the overlay on a real phone, 2026-09-17. On a phone the
    // first thing you try is the back gesture, and before this it left the class
    // page entirely rather than closing the sheet.
    const push = vi.spyOn(window.history, 'pushState')
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const w = mountBrain()
    await flushPromises()
    await w.findAll('button').find((b) => b.attributes('aria-label') === 'Open full screen')!.trigger('click')
    await flushPromises()
    expect(document.querySelector('.cb-full')).not.toBeNull()
    expect(push).toHaveBeenCalled()

    // The browser's own back: our entry is already gone, so the overlay closes
    // and nothing spends a SECOND entry (which would leave the page).
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    await flushPromises()
    expect(document.querySelector('.cb-full')).toBeNull()
    expect(back).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('')
    push.mockRestore()
    back.mockRestore()
  })

  it('says so in words when the class has never played together', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...payload, events: [], sittings: [] }) })) as never)
    const w = mountBrain()
    await flushPromises()
    expect(w.text()).toContain('Nothing to draw yet')
    expect(w.find('svg').exists()).toBe(false)
  })
})
