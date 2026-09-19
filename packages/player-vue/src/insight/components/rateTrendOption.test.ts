/**
 * The Insights trend is real bars, one per bucket, never a spline (Tom,
 * 2026-09-14, job #673: "wrong data is a disaster" — a curve drawn through
 * two days of play read as a hill of practice on the days between).
 */
import { describe, it, expect } from 'vitest'
import { buildRateTrendOption, LEGEND_BAND_PX } from './rateTrendOption'

const input = {
  entityLabel: 'Class 7H',
  entity: [0, 0, 42, 0, 0, 0, 18],
  averageLabel: 'School average',
  average: [3, 3, 4, 3, 3, 4, 3],
  yLabel: 'min',
  xLabels: ['08 Sep', '09 Sep', '10 Sep', '11 Sep', '12 Sep', '13 Sep', 'now'],
  entityRgb: '96, 165, 250',
  glowRgb: '96, 165, 250',
  avgRgb: '138, 128, 120',
  palette: { line: '#ddd', ink2: '#333', ink3: '#666' },
}

describe('buildRateTrendOption', () => {
  it('draws the entity as bars and nothing in the option is smoothed or area-filled', () => {
    const option = buildRateTrendOption(input) as any
    const series = option.series as any[]
    expect(series[0].type).toBe('bar')
    for (const s of series) {
      expect(s.smooth).not.toBe(true)
      expect(s.areaStyle).toBeUndefined()
    }
    expect((option.xAxis as any).boundaryGap).toBe(true)
  })

  it('a day with no play is a zero bar, kept as zero in the data', () => {
    const option = buildRateTrendOption(input) as any
    const data = (option.series as any[])[0].data as any[]
    const values = data.map((d) => (typeof d === 'number' ? d : d.value))
    expect(values).toEqual([0, 0, 42, 0, 0, 0, 18])
  })
})

/**
 * Tom's own bug report, 18 Sep 2026, iPhone 402×874: "a genuine bug — I can't
 * read the legend on the x axis." His screenshot shows the legend's first row
 * drawn straight through the date labels.
 *
 * legend.bottom stacks UP from the canvas floor, and a long course name wraps
 * the legend onto two rows on a phone — about 34px — while the x-axis labels
 * want about 18px of the grid's bottom margin. With grid.bottom at 40 the two
 * bands could not both fit and the legend won.
 */
describe('the legend never lands on the date axis', () => {
  const TWO_LEGEND_ROWS_PX = 34
  const AXIS_LABELS_PX = 18

  it('the grid stops above a band that holds a two-row legend AND the date labels', () => {
    const option = buildRateTrendOption(input) as any
    expect(option.legend.bottom).toBe(0)
    expect(option.grid.bottom).toBe(LEGEND_BAND_PX)
    expect(LEGEND_BAND_PX).toBeGreaterThanOrEqual(TWO_LEGEND_ROWS_PX + AXIS_LABELS_PX)
  })
})
