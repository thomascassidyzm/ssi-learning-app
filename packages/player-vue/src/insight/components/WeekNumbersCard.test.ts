import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WeekNumbersCard, { type WeekBlock } from './WeekNumbersCard.vue'

function block(over: Partial<WeekBlock> = {}): WeekBlock {
  return {
    window: 'last_week',
    label: 'Last week',
    rangeLabel: '7–13 Sep',
    timeZone: 'Europe/London',
    entity: { label: '11P', classMinutes: 18, pupilMinutes: 0, totalMinutes: 18, newPhrases: 7, hasData: true },
    cohort: { label: 'Ysgol Cas-gwent Chepstow School average', classMinutes: 8, pupilMinutes: 2, totalMinutes: 10, newPhrases: 4, size: 34 },
    cohortSizeLine: 'Average of all 34 classes on this course',
    bars: { weeks: ['7–13 Sep', '14–20 Sep'], entity: [18, 0], cohort: [8, 0.1] },
    ...over,
  }
}

const render = (props: Record<string, unknown>) =>
  mount(WeekNumbersCard, { props, global: { stubs: { RateTrend: true } } })

describe('WeekNumbersCard — three numbers, no ratio', () => {
  it('names the week and its dates', () => {
    const t = render({ data: block() }).text()
    expect(t).toContain('Last week')
    expect(t).toContain('7–13 Sep')
  })

  it('keeps play-as-class and students’ own time apart, then adds them', () => {
    const t = render({ data: block() }).text()
    expect(t).toContain('Play as class18m')
    expect(t).toContain('Students on their own0m')
    expect(t).toContain('Total learning time18m')
    expect(t).toContain('New phrases7')
  })

  it('puts the cohort’s SAME three beside them, and names the fixed denominator', () => {
    const t = render({ data: block() }).text().replace(/\s+/g, ' ')
    expect(t).toContain('Ysgol Cas-gwent Chepstow School average')
    expect(t).toContain('Play as class8m')
    expect(t).toContain('Average of all 34 classes on this course, this one included')
  })

  it('NEVER draws a ratio, a percentage-of-average or a delta', () => {
    const t = render({ data: block() }).text()
    expect(t).not.toMatch(/\d+\s*%/)
    expect(t).not.toMatch(/above average|below average|vs average|×|x the/i)
  })

  it('says minutes the way a school does, in hours past the hour', () => {
    const t = render({ data: block({ entity: { label: '11P', classMinutes: 85, pupilMinutes: 120, totalMinutes: 205, newPhrases: 3, hasData: true } }) }).text().replace(/\s+/g, ' ')
    expect(t).toContain('1h 25m')
    expect(t).toContain('2h')
    expect(t).toContain('3h 25m')
  })

  it('renders its own week with no cohort at all, and says why', () => {
    const t = render({ data: block({ cohort: null }), noCohortReason: 'No other classes running this course yet.' }).text()
    expect(t).toContain('11P')
    expect(t).toContain('No other classes running this course yet.')
  })

  it('a quiet week reads as a quiet week — no scolding, no target, no streak', () => {
    const t = render({ data: block({ entity: { label: '11P', classMinutes: 0, pupilMinutes: 0, totalMinutes: 0, newPhrases: 0, hasData: false } }) }).text()
    expect(t).toContain('0m')
    expect(t).not.toMatch(/streak|target|goal|behind|should|missed/i)
  })

  it('writes the percentile as a person says it — 91st, not 91th', () => {
    for (const [n, want] of [[91, '91st'], [2, '2nd'], [3, '3rd'], [11, '11th'], [12, '12th'], [13, '13th'], [100, '100th']] as const) {
      const t = render({ data: block(), percentile: n, cohortUnit: 'classes' }).text().replace(/\s+/g, ' ')
      expect(t).toContain(`${want} percentile of classes`)
    }
  })

  it('says the right noun above class level, because the server writes the sentence', () => {
    const t = render({ data: block({ cohortSizeLine: 'Average of all 9 schools on this course' }) }).text().replace(/\s+/g, ' ')
    expect(t).toContain('Average of all 9 schools on this course, this one included')
    expect(t).not.toContain('classes')
  })

  it('names a capped pupil read rather than reporting zero individual practice as a fact', () => {
    const t = render({ data: block({ pupilMinutesCapped: true }) }).text().replace(/\s+/g, ' ')
    expect(t).toContain("Students' own minutes aren't counted at this level")
  })
})
