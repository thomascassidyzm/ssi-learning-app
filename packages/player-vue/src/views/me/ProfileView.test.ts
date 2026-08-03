/**
 * ProfileView — the acceptance test for the 2026-08-03 design ruling, applied
 * to what the learner actually READS, not just to the payload shape.
 *
 * The fixture this design is measured against is the anti-gallery: six real
 * Duolingo shame emails. Every one of them needs the product to notice an
 * absence and say something about it. So the rendered surface is asserted to
 * contain no shame vocabulary, no incentive-points vocabulary, and none of the
 * internal terminology the language wall keeps off learner surfaces.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import ProfileView from './ProfileView.vue'

const PAYLOAD = {
  courseCode: 'spa_for_eng',
  adherence: {
    goesThisWeek: 247, goesTotal: 1120,
    speakingMinutesThisWeek: 96, listeningMinutesThisWeek: 34,
    daysPresentThisWeek: 4, source: 'mock',
  },
  mirror: {
    latencyNowMs: 1520, latencyEarlyMs: 2450, directionPct: -38,
    curve: [
      { hours: 0.5, ms: 2450 }, { hours: 1.5, ms: 2310 }, { hours: 2.5, ms: 2180 },
      { hours: 3.5, ms: 1990 }, { hours: 4.5, ms: 1880 }, { hours: 5.5, ms: 1740 },
    ],
    smoothShare: 0.61, unitsSteady: 34, source: 'mock',
  },
  portrait: {
    positionKnown: 'I wanted to speak to you', positionTarget: 'quería hablar contigo',
    unitsMet: 46, confidence: 0.42,
    cefr: { band: 'A2', low: 'A1', high: 'A2+' }, source: 'mock',
  },
  plan: { hoursDone: 7.5, targetHours: 30, source: 'mock' },
}

function mountView() {
  return mount(ProfileView, {
    global: {
      provide: {
        supabase: ref(null),
        activeCourse: ref({ course_code: 'spa_for_eng', target_lang: 'es' }),
        enrolledCourses: ref([]),
        handleCourseSelect: () => {},
      },
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

describe('ProfileView', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => PAYLOAD })))
  })

  it('renders the three layers', async () => {
    const w = mountView()
    await flushPromises()
    const text = w.text()
    // 1. adherence — goes, in the learner's words
    expect(text).toContain('247')
    expect(text).toContain('goes this week')
    // 2. the mirror — how quickly it comes, direction stated honestly
    expect(text).toContain('How quickly it comes')
    expect(text).toContain('1.5s')
    // 3. the portrait — a notional band with a visible interval
    expect(text).toContain('Roughly where you are')
    expect(text).toContain('A2')
    expect(text).toContain('somewhere between')
  })

  it('labels sample data as sample data rather than passing it off as live', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Sample data')
  })

  it('shows the learner their own words, never a position number', async () => {
    const w = mountView()
    await flushPromises()
    const text = w.text()
    expect(text).toContain('quería hablar contigo')
    expect(text).not.toMatch(/\bseed\s*\d/i)
    expect(text).not.toMatch(/\bS\d{4}L\d{2}\b/)
  })

  /** THE ANTI-GALLERY TEST. None of this vocabulary may reach a learner. */
  it('cannot shame the learner', async () => {
    const w = mountView()
    await flushPromises()
    const text = w.text().toLowerCase()
    // Word-bounded on purpose: naive substrings produce false alarms on warm
    // sentences ("things now come back to you"), and a test that cries wolf
    // gets deleted rather than obeyed.
    for (const shame of [
      /\bstreak/, /\bdays since\b/, /\byou missed\b/, /\bdon'?t break\b/,
      /\blast chance\b/, /\bwe haven'?t seen you\b/, /\bslipping\b/, /\bfalling behind\b/,
    ]) {
      expect(text).not.toMatch(shame)
    }
  })

  it('offers no incentive points of any kind', async () => {
    const w = mountView()
    await flushPromises()
    const text = w.text().toLowerCase()
    for (const bribe of [/\bpoints?\b/, /\bxp\b/, /\bleaderboard\b/, /\bbadges?\b/, /\btroph/, /\brank(ed|ing)?\b/]) {
      expect(text).not.toMatch(bribe)
    }
  })

  /** The language wall: internal terminology never reaches a learner surface. */
  it('keeps internal terminology behind the wall', async () => {
    const w = mountView()
    await flushPromises()
    const text = w.text().toLowerCase()
    for (const jargon of [/\blegos?\b/, /\bprosody\b/, /\bvad\b/, /\blatency\b/, /\badherence\b/, /\bscript\b/, /\bseeds?\b/]) {
      expect(text).not.toMatch(jargon)
    }
  })
})
