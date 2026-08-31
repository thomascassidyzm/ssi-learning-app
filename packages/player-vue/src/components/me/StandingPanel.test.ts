import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import StandingPanel from './StandingPanel.vue'

const supabase = ref({
  auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
})

let responder: () => any

function mountPanel(courseCode: string | null = 'cym_n_for_eng') {
  return mount(StandingPanel, {
    props: { courseCode },
    global: { provide: { supabase } },
  })
}

/** Let the immediate watcher's fetch chain settle. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await nextTick()
}

beforeEach(() => {
  responder = () => ({ standing: null, reason: 'cohort-too-small' })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => responder() })))
})
afterEach(() => vi.unstubAllGlobals())

const standing = (over: Record<string, any> = {}) => ({
  standing: {
    aheadOfPct: 72,
    cohortSize: 34,
    cohortKind: 'quarter',
    cohortQuarter: '2026Q2',
    medianSeed: 40,
    seed: 88,
    ...over,
  },
})

describe('StandingPanel — silence is the default', () => {
  it('renders nothing when the cohort is under the floor', async () => {
    const w = mountPanel()
    await settle()
    expect(w.find('.panel').exists()).toBe(false)
    expect(w.text()).toBe('')
  })

  it('renders nothing, and does not call the API, without a course', async () => {
    const w = mountPanel(null)
    await settle()
    expect(w.find('.panel').exists()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('renders nothing when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const w = mountPanel()
    await settle()
    expect(w.find('.panel').exists()).toBe(false)
  })
})

describe('StandingPanel — what it shows when it can', () => {
  it('celebrates a learner above the halfway mark', async () => {
    responder = () => standing()
    const w = mountPanel()
    await settle()
    expect(w.text()).toContain('72%')
    expect(w.text()).toContain('further along than')
    expect(w.text()).toContain('one of 34 people who started this course around the same time as you')
  })

  it('drops the percentage below the halfway mark, keeping the collective line', async () => {
    responder = () => standing({ aheadOfPct: 12 })
    const w = mountPanel()
    await settle()
    expect(w.find('.panel').exists()).toBe(true)
    expect(w.text()).toContain('one of 34 people')
    // No shortfall statistic anywhere on the panel.
    expect(w.text()).not.toContain('12%')
    expect(w.text()).not.toContain('further along than')
  })

  it('drops the STRIP below the halfway mark too, not just the number', async () => {
    // A strip with the marker on the left states the shortfall graphically —
    // suppressing the figure while drawing the picture would be a fig leaf.
    responder = () => standing({ aheadOfPct: 12 })
    const w = mountPanel()
    await settle()
    expect(w.find('.strip').exists()).toBe(false)
    expect(w.find('.strip-marker').exists()).toBe(false)
    expect(w.find('.footnote').exists()).toBe(false)
    // What remains is the collective line, and only that.
    expect(w.text().trim()).toBe('You are one of 34 people who started this course around the same time as you.')
  })

  it('keeps the strip at and above the halfway mark', async () => {
    responder = () => standing({ aheadOfPct: 50 })
    const w = mountPanel()
    await settle()
    expect(w.find('.strip').exists()).toBe(true)
    expect(w.text()).toContain('50%')
  })

  it('uses the weaker wording when the cohort is the whole course', async () => {
    responder = () => standing({ cohortKind: 'course', cohortQuarter: null })
    const w = mountPanel()
    await settle()
    expect(w.text()).toContain('one of 34 people learning this course')
    expect(w.text()).not.toContain('around the same time')
  })

  it('places the marker at the point the learner is ahead of', async () => {
    responder = () => standing({ aheadOfPct: 72 })
    const w = mountPanel()
    await settle()
    expect(w.find('.strip-marker').attributes('style')).toContain('left: 72%')
  })
})

describe('StandingPanel — the two things it must never render', () => {
  it('never shows a course position as a number', async () => {
    responder = () => standing({ seed: 88, medianSeed: 40 })
    const w = mountPanel()
    await settle()
    const text = w.text()
    // Position is a LEGO, not a figure — neither the learner's own seed nor the
    // cohort median may appear anywhere on the face of the panel.
    expect(text).not.toContain('88')
    expect(text).not.toContain('40')
    expect(text.toLowerCase()).not.toContain('seed')
    expect(text.toLowerCase()).not.toContain('lego')
  })

  it('never shows a rank, a streak, or anything phrased as a shortfall', async () => {
    responder = () => standing()
    const w = mountPanel()
    await settle()
    const text = w.text().toLowerCase()
    for (const banned of ['rank', 'streak', 'behind', 'days since', 'you missed', 'keep it up', 'don’t break']) {
      expect(text).not.toContain(banned)
    }
  })

  it('says plainly that it measures progress and not time', async () => {
    responder = () => standing()
    const w = mountPanel()
    await settle()
    expect(w.text()).toContain('not how long anyone has spent in the app')
    expect(w.text()).toContain('only ever goes up')
  })
})
