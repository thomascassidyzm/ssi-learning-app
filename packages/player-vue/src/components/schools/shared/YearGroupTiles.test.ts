/**
 * YearGroupTiles — the big number is MINUTES in the app this week, the big
 * label is the year key.
 *
 * Tom, 2026-09-15 00:52Z (job #766), on the live Chepstow Classes page: the
 * tiles showed phrases practised as their big number under a headline that
 * read "2 h 44 min in the app this week", and he read them as minutes. So
 * the number IS minutes, through the one formatter (practiceMinutes.ts), and
 * the year key — "Y7", "Other" — is the dominant element.
 *
 * Seen RED on the pre-change component (big number "120", label "Year 7") and
 * GREEN after ("1 h 4 min", "Y7").
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import YearGroupTiles from './YearGroupTiles.vue'
import type { YearGroupBreakdown } from '@/views/schools/yearGroup'

const breakdown: YearGroupBreakdown = {
  mode: 'year',
  tiles: [
    { key: 'year:7', year: 7, name: null, classCount: 3, practising: 2, minutes7d: 64, phrases7d: 120 },
    { key: 'year:8', year: 8, name: null, classCount: 2, practising: 0, minutes7d: 0, phrases7d: 0 },
    { key: 'other', year: null, name: null, classCount: 1, practising: 1, minutes7d: 12, phrases7d: 30 },
  ],
}

describe('YearGroupTiles — minutes as the number, the year key as the label', () => {
  it('shows in-app minutes through the one formatter, and Y7 / Other as the big label', () => {
    const w = mount(YearGroupTiles, { props: { breakdown }, global: { stubs: { RouterLink: true } } })
    const y7 = w.find('[data-year-tile="year:7"]')
    expect(y7.find('.year-tile-word').text()).toBe('Y7')
    expect(y7.find('[data-year-tile-minutes]').text()).toBe('1 h 4 min')
    expect(y7.find('.year-tile-sub').text()).toBe('2 of 3 classes')
    // Phrases are not the number any more.
    expect(y7.text()).not.toContain('120')

    const other = w.find('[data-year-tile="other"]')
    expect(other.find('.year-tile-word').text()).toBe('Other')
    expect(other.find('[data-year-tile-minutes]').text()).toBe('12 min')

    // No minutes this week: a dash and the quiet rule, never a lying zero.
    const y8 = w.find('[data-year-tile="year:8"]')
    expect(y8.find('[data-year-tile-minutes]').text()).toBe('—')
    expect(y8.classes()).toContain('is-quiet')
  })
})
