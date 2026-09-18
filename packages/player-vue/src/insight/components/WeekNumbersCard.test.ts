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

type CardProps = { data: WeekBlock; noCohortReason?: string; allTime?: AllTimeBlock | null; unitNoun?: string }
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

  it('draws ONE set of weekly bars with the cohort as a faint line — under the numbers, above the all-time line — and no chart furniture', () => {
    const w = render({ data: block(), allTime: { started: true, sinceLabel: '2 Sep', totalMinutes: 60, phrasesReached: 40 } })
    expect(w.findAll('[data-testid="week-bars"]')).toHaveLength(1)
    expect(w.findAll('.wb-bar').length).toBeGreaterThan(0)
    expect(w.find('.wb-normal').exists()).toBe(true)
    expect(w.text()).not.toMatch(/minutes \/ week|axis|legend/i)
    const html = w.html()
    expect(html.indexOf('wk-table')).toBeLessThan(html.indexOf('week-bars'))
    expect(html.indexOf('week-bars')).toBeLessThan(html.indexOf('wk-alltime'))
  })

  it('the newest week is the emphasised bar — the week the numbers above it belong to', () => {
    const w = render({ data: block({ bars: { weeks: ['a', 'b', 'c'], entity: [4, 5, 6], cohort: [1, 2, 3] } }) })
    expect(w.findAll('.wb-bar').map((b) => b.classes().includes('now'))).toEqual([false, false, true])
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

  // ── job #32 fix-up, 2026-09-16 ──────────────────────────────────────────
  it('the why? text says what the cohort is COUNTED IN — schools above a school, classes above a class', async () => {
    const leader = render({
      data: block({ cohort: { label: 'Pilot Districts Region average', classMinutes: 8, pupilMinutes: 2, totalMinutes: 10, newPhrases: 4, size: 3, sizeLabel: '3 schools' } }),
      unitNoun: 'school',
    })
    await leader.find('.wk-why').trigger('click')
    // Seen RED before the fix: "the mean of every class in that scope" on a
    // page whose denominator says 3 schools. The RULE the sentence states
    // changed on 2026-09-18 — practised-in-the-window, not started — but the
    // thing this test guards did not: the NOUN follows the cohort's own unit.
    expect(leader.text()).toContain('the mean of every school in that scope that practised in the week you are reading, this school included')
    expect(leader.text()).not.toContain('every class in that scope')

    const teacher = render({ data: block(), unitNoun: 'class' })
    await teacher.find('.wk-why').trigger('click')
    expect(teacher.text()).toContain('the mean of every class in that scope')

    // No noun from the server — a class, as every mount before this one was.
    const bare = render({ data: block() })
    await bare.find('.wk-why').trigger('click')
    expect(bare.text()).toContain('the mean of every class in that scope')
  })
})

/**
 * THE CHEPSTOW SHAPE (job #207, Tom on production 2026-09-18). A school of
 * class accounts and no pupil accounts: 34 classes, 33 of them started, 11.7
 * minutes of play-as-class across the week, and the class the leader has open
 * did 7 min 22 s of it. His words: "The school average is the misleading one.
 * It can't be zero if the class I'm looking at has 8m."
 *
 * Red on the card's own Math.round formatter — every cohort cell read "0m" —
 * and green through the estate's one formatter.
 */
describe('WeekNumbersCard — a school average is a fraction, and a fraction is not zero', () => {
  const chepstow = (): WeekBlock => block({
    window: 'this_week',
    label: 'This week',
    rangeLabel: '14–18 Sep',
    entity: { label: '10P', classMinutes: 7.4, pupilMinutes: 0, totalMinutes: 7.4, newPhrases: 1, hasData: true },
    cohort: {
      label: 'Ysgol Cas-gwent Chepstow School average',
      classMinutes: 0.4, pupilMinutes: 0, totalMinutes: 0.4, newPhrases: 0.6,
      size: 33, sizeLabel: '33 classes',
    },
    bars: { weeks: ['7–13 Sep', '14–20 Sep'], entity: [12, 7.4], cohort: [8.7, 0.4] },
  })

  it('never prints a lying 0m beside a class that practised', () => {
    const w = render({ data: chepstow() })
    expect(rowText(w, 'class')).toBe('Play as class 8m <1m')
    expect(rowText(w, 'total')).toBe('Total learning time 8m <1m')
    // "Students on their own 0m" stays 0m and should: Chepstow has no pupil
    // accounts at all, so that zero is a fact rather than a rounded fraction.
    expect(rowText(w, 'pupils')).toBe('Students on their own 0m 0m')
  })

  it('does not overstate the average as a whole minute either', () => {
    const cells = render({ data: chepstow() }).findAll('.wk-row-class .wk-num').map((c) => c.text())
    expect(cells[1]).toBe('<1m')
  })

  it('an average of 0.6 new phrases is neither 1 nor 0', () => {
    expect(rowText(render({ data: chepstow() }), 'phrases')).toBe('New phrases 1 <1')
  })

  it('says what the average divides by, right there under it', () => {
    expect(render({ data: chepstow() }).find('.wk-denominator').text())
      .toBe('Ysgol Cas-gwent Chepstow School average · 33 classes')
  })

  it('a school that truly did nothing still reads zero', () => {
    const quiet = chepstow()
    quiet.cohort = { ...quiet.cohort!, classMinutes: 0, pupilMinutes: 0, totalMinutes: 0, newPhrases: 0 }
    expect(rowText(render({ data: quiet }), 'class')).toBe('Play as class 8m 0m')
  })
})

/**
 * Tom's ruling, 2026-09-18: the average divides by the classes that PRACTISED
 * in the window, "and the caption says so". Chepstow's live shape — 34
 * classes, 33 started, 9 practised, 11.7 minutes — reads 1.3 over 9 where it
 * read 0.354 over 33.
 */
describe('WeekNumbersCard — the caption names the denominator and the rule that chose it', () => {
  const practising = (): WeekBlock => block({
    window: 'this_week',
    label: 'This week',
    rangeLabel: '14–18 Sep',
    entity: { label: '10P', classMinutes: 7.4, pupilMinutes: 0, totalMinutes: 7.4, newPhrases: 1, hasData: true },
    cohort: {
      label: 'Ysgol Cas-gwent Chepstow School average',
      classMinutes: 1.3, pupilMinutes: 0, totalMinutes: 1.3, newPhrases: 2.3,
      size: 9, sizeLabel: '9 classes that practised this week',
    },
    bars: { weeks: ['7–13 Sep', '14–20 Sep'], entity: [11.9, 7.4], cohort: [9.1, 1.3] },
  })

  it('says how many classes are in the average AND that they are the ones that practised', () => {
    expect(render({ data: practising() }).find('.wk-denominator').text())
      .toBe('Ysgol Cas-gwent Chepstow School average · 9 classes that practised this week')
  })

  it('and the number beside it is a real one, not a zero', () => {
    expect(rowText(render({ data: practising() }), 'class')).toBe('Play as class 8m 2m')
  })

  it('the why? chip explains the rule a reader is being asked to trust', async () => {
    const w = render({ data: practising() })
    await w.find('.wk-why').trigger('click')
    const why = w.find('.wk-why-text').text()
    expect(why).toContain('practised in the week you are reading')
    expect(why).toContain('is not counted as a zero')
  })

  it('when nobody else practised there is no second column, and the card says which nothing that is', () => {
    const alone = practising()
    alone.cohort = null
    alone.cohortNote = 'Nothing to compare against: only this class practised this week.'
    const w = render({ data: alone })
    expect(w.findAll('.wk-row-class .wk-num')).toHaveLength(1)
    expect(w.find('.wk-note').text()).toBe('Nothing to compare against: only this class practised this week.')
  })
})
