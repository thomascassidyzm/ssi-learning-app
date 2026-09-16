import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WeekNumbersCard, { type WeekBlock, type AllTimeBlock } from './WeekNumbersCard.vue'

function block(over: Partial<WeekBlock> = {}): WeekBlock {
  return {
    window: 'last_week',
    label: 'Last week',
    rangeLabel: '7–13 Sep',
    timeZone: 'Europe/London',
    entity: { label: '11P', classMinutes: 18, pupilMinutes: 0, totalMinutes: 18, newPhrases: 7, hasData: true },
    cohort: { label: 'Ysgol Cas-gwent Chepstow School average', classMinutes: 8, pupilMinutes: 2, totalMinutes: 10, newPhrases: 4, size: 27, sizeLabel: '27 classes' },
    bars: { weeks: ['7–13 Sep', '14–20 Sep'], entity: [18, 0], cohort: [8, 0.1] },
    ...over,
  }
}

type CardProps = { data: WeekBlock; noCohortReason?: string; allTime?: AllTimeBlock | null }
const render = (props: CardProps) => mount(WeekNumbersCard, { props })
const rowText = (w: ReturnType<typeof render>, key: string) => w.findAll(`.wk-row-${key} .wk-cell`).map((c) => c.text().trim()).join(' ').trim()

describe('WeekNumbersCard — one card, two columns, three numbers, no rank', () => {
  it('names the week and its dates', () => {
    const t = render({ data: block() }).text()
    expect(t).toContain('Last week')
    expect(t).toContain('7–13 Sep')
  })

  it('keeps play-as-class and students’ own time apart, then adds them — each with the cohort BESIDE it on one row', () => {
    const w = render({ data: block() })
    expect(rowText(w, 'class')).toBe('Play as class 18m 8m')
    expect(rowText(w, 'pupils')).toBe('Students on their own 0m 2m')
    expect(rowText(w, 'total')).toBe('Total learning time 18m 10m')
    expect(rowText(w, 'phrases')).toBe('New phrases 7 4')
    // two columns of numbers in ONE grid — never two stacked cards
    expect(w.findAll('.wk-table')).toHaveLength(1)
    expect(w.find('.wk-col-entity').text()).toBe('11P')
  })

  it('names the fixed denominator beside the cohort', () => {
    const t = render({ data: block() }).text().replace(/\s+/g, ' ')
    expect(t).toContain('Ysgol Cas-gwent Chepstow School average · 27 classes')
  })

  it('NEVER draws a ratio, a percentage-of-average, a delta, a percentile or an ordinal rank', () => {
    const t = render({ data: block() }).text()
    expect(t).not.toMatch(/\d+\s*%/)
    expect(t).not.toMatch(/above average|below average|vs average|×|x the/i)
    expect(t).not.toMatch(/percentile|\b\d+(st|nd|rd|th)\b|\bof \d+\b/i)
  })

  it('draws ONE thin temperature line under the total — the class over the cohort — and no chart furniture', () => {
    const w = render({ data: block() })
    expect(w.findAll('[data-testid="temperature-line"]')).toHaveLength(1)
    expect(w.find('.wk-row-line').exists()).toBe(true)
    expect(w.text()).not.toMatch(/minutes \/ week|axis|legend/i)
  })

  it('says minutes the way a school does, in hours past the hour', () => {
    const t = render({ data: block({ entity: { label: '11P', classMinutes: 85, pupilMinutes: 120, totalMinutes: 205, newPhrases: 3, hasData: true } }) }).text().replace(/\s+/g, ' ')
    expect(t).toContain('1h 25m')
    expect(t).toContain('2h')
    expect(t).toContain('3h 25m')
  })

  it('renders its own week with no cohort at all, and says why', () => {
    const w = render({ data: block({ cohort: null, bars: { weeks: ['a'], entity: [18], cohort: [null] } }), noCohortReason: 'No other classes running this course yet.' })
    expect(w.text()).toContain('11P')
    expect(w.text()).toContain('No other classes running this course yet.')
    expect(rowText(w, 'class')).toBe('Play as class 18m')
  })

  it('a quiet week reads as a quiet week — no scolding, no target, no streak', () => {
    const t = render({ data: block({ entity: { label: '11P', classMinutes: 0, pupilMinutes: 0, totalMinutes: 0, newPhrases: 0, hasData: false } }) }).text()
    expect(t).toContain('0m')
    expect(t).not.toMatch(/streak|target|goal|behind|should|missed/i)
  })

  it('says the right noun above class level, because the server counts it', () => {
    const t = render({ data: block({ cohort: { label: 'Global average · this course', classMinutes: 8, pupilMinutes: 0, totalMinutes: 8, newPhrases: 4, size: 9, sizeLabel: '9 schools' } }) }).text().replace(/\s+/g, ' ')
    expect(t).toContain('Global average · this course · 9 schools')
    expect(t).not.toContain('classes')
  })

  it('names a capped pupil read rather than reporting zero individual practice as a fact', () => {
    const t = render({ data: block({ pupilMinutesCapped: true }) }).text().replace(/\s+/g, ' ')
    expect(t).toContain("Students' own minutes aren't counted at this level")
  })

  it('ALL TIME is totals only, on its own line, with no comparison figure', () => {
    const w = render({ data: block(), allTime: { started: true, sinceLabel: '3 Feb 2026', classMinutes: 800, pupilMinutes: 60, totalMinutes: 860, phrasesReached: 112 } })
    const line = w.find('[data-walk="insights-all-time"]').text().replace(/\s+/g, ' ')
    expect(line).toBe('Since 3 Feb 2026 · 14h 20m practised · 112 phrases reached')
    expect(line).not.toMatch(/average|school/i)
    const dark = render({ data: block(), allTime: { started: false } })
    expect(dark.find('[data-walk="insights-all-time"]').text()).toBe('This class has not started yet.')
    expect(render({ data: block(), allTime: null }).find('[data-walk="insights-all-time"]').exists()).toBe(false)
  })

  it('the why? chip stays, and explains Fast vs Easy on a tap — never on the glance', async () => {
    const w = render({ data: block() })
    expect(w.text()).not.toMatch(/Fast mode/)
    await w.find('.wk-why').trigger('click')
    expect(w.text()).toMatch(/Fast mode/)
  })
})
