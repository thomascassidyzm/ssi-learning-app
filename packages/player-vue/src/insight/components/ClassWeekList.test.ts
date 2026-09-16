import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ClassWeekList from './ClassWeekList.vue'
import type { WeekClassRow } from './WeekNumbersCard.vue'

const RouterLinkStub = {
  props: { to: { type: [String, Object], required: true } },
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
}
const DAY = 86_400_000
const rows: WeekClassRow[] = [
  { id: 'q', name: 'Grade 7A', started: true, lastPlayedAt: new Date(Date.now() - 20 * DAY).toISOString(), classMinutes: 0, pupilMinutes: 0, totalMinutes: 0, newPhrases: 0 },
  { id: 'b', name: 'Grade 6A', started: true, lastPlayedAt: new Date(Date.now() - 1 * DAY).toISOString(), classMinutes: 40, pupilMinutes: 5, totalMinutes: 45, newPhrases: 9 },
  { id: 'n', name: 'Grade 6B', started: false, lastPlayedAt: null, classMinutes: null, pupilMinutes: null, totalMinutes: null, newPhrases: null },
]
const render = (classes: WeekClassRow[]) => mount(ClassWeekList, {
  props: { classes, linkFor: (id: string) => `/org/${id}/insights`, windowLabel: 'this week' },
  global: { stubs: { RouterLink: RouterLinkStub } },
})

describe('ClassWeekList — the leader’s page, quietest first', () => {
  it('one card per started class, in the order given, each saying when it last practised and its week', () => {
    const w = render(rows)
    const cards = w.findAll('.cwl-card')
    expect(cards.map((c) => c.find('.cwl-name').text())).toEqual(['Grade 7A', 'Grade 6A'])
    expect(cards[0].text().replace(/\s+/g, ' ')).toContain('last practised 2 weeks ago')
    expect(cards[1].text().replace(/\s+/g, ' ')).toContain('last practised yesterday')
    expect(cards[1].text().replace(/\s+/g, ' ')).toContain('45m')
    expect(cards[1].text().replace(/\s+/g, ' ')).toContain('9')
    expect(cards[0].attributes('href')).toBe('/org/q/insights')
  })
  it('a class that has not started is a quiet line at the end, not a card of zeros', () => {
    const w = render(rows)
    expect(w.find('.cwl-quiet-sum').text()).toBe('1 class has not started yet')
    expect(w.find('.cwl-quiet').text()).toContain('Grade 6B')
    expect(w.findAll('.cwl-card').some((c) => c.text().includes('Grade 6B'))).toBe(false)
  })
  it('silence is a gap, not a zero: a started class with no play in twelve weeks says so', () => {
    const w = render([{ ...rows[0], lastPlayedAt: null }])
    expect(w.find('.cwl-card').text()).toContain('not in the last 12 weeks')
  })
  it('no rank, no ordinal, no league table', () => {
    const t = render(rows).text()
    expect(t).not.toMatch(/\b\d+(st|nd|rd|th)\b|rank|percentile|top|bottom/i)
  })
})
