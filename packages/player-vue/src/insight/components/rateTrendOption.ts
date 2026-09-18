// ============================================================================
// components/rateTrendOption.ts — the ECharts option for the Insights trend,
// pure so it can be tested without a canvas.
//
// REAL BARS, NOT A CURVE (Tom, 2026-09-14, job #673). Every point is one
// bucket of the window — an hour under Today, a day under the daily windows,
// a month under All time — and a bucket with no play is a zero bar. A spline
// through daily totals drew a hill of practice across days on which nobody
// pressed play, and "wrong data is a disaster - way worse than no data".
// The cohort average stays a dashed straight line between its points so the
// bars can be read against it.
// ============================================================================
import { FONT_MONO } from '../theme'

export interface RateTrendOptionInput {
  entityLabel: string
  /**
   * A number is a real bucket; NULL is ABSENCE — there was nothing there to
   * measure, as against a 0 which says there was and it was nothing. ECharts
   * draws no bar for a null and, with connectNulls off, the dashed line breaks
   * rather than ruling a straight edge across a gap it knows nothing about.
   */
  entity: (number | null)[]
  averageLabel: string
  average: (number | null)[]
  yLabel?: string
  xLabels: string[]
  entityRgb: string  // "r, g, b"
  glowRgb: string
  avgRgb: string
  palette: { line: string; ink2: string; ink3: string }
}

/** Compact value formatter for the last bar's label. */
export function fmtTrendValue(v: number): string {
  if (!Number.isFinite(v)) return ''
  if (Number.isInteger(v)) return String(v)
  return Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0)
}

export function buildRateTrendOption(i: RateTrendOptionInput): Record<string, unknown> {
  const p = i.palette
  const entityColor = `rgb(${i.entityRgb})`
  const averageColor = `rgb(${i.avgRgb})`
  const entityData = i.entity ?? []
  const lastIdx = entityData.length - 1

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v: number) => fmtTrendValue(Number(v)),
    },
    legend: {
      data: [i.entityLabel, i.averageLabel],
      bottom: 0,
      left: 'center',
      icon: 'roundRect',
      itemWidth: 16,
      itemHeight: 4,
      textStyle: { fontFamily: FONT_MONO, fontSize: 11, color: p.ink2 },
    },
    // Room for the y-axis title (top-left), the last bar's label and the legend.
    grid: { left: 46, right: 24, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: i.xLabels,
      boundaryGap: true,
      axisLine: { lineStyle: { color: p.line } },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 10.5, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: i.yLabel ?? '',
      nameLocation: 'end',
      nameGap: 12,
      nameTextStyle: { fontFamily: FONT_MONO, fontSize: 10, color: p.ink3, align: 'left' },
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 10 },
      splitLine: { lineStyle: { color: p.line, type: 'dashed' } },
    },
    series: [
      {
        name: i.entityLabel,
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { color: entityColor, borderRadius: [3, 3, 0, 0], shadowColor: `rgba(${i.glowRgb}, 0.35)`, shadowBlur: 6 },
        // The newest bucket carries its value so the current figure reads off
        // the chart — unless it is absent, which gets no bar and no label.
        data: entityData.map((v, idx) => (idx === lastIdx && typeof v === 'number'
          ? { value: v, label: { show: true, position: 'top', formatter: () => fmtTrendValue(v), color: entityColor, fontFamily: FONT_MONO, fontWeight: 'bold', fontSize: 12 } }
          : v)),
        emphasis: { focus: 'series' },
        z: 3,
      },
      {
        name: i.averageLabel,
        type: 'line',
        smooth: false,
        symbol: 'none',
        // The cohort baseline — grey, dashed, straight between its points.
        lineStyle: { color: averageColor, width: 1.8, type: 'dashed' },
        itemStyle: { color: averageColor },
        emphasis: { focus: 'series' },
        data: i.average ?? [],
        // A gap in the cohort is a gap in the line: joining across it would
        // draw a school average for weeks when no class had started.
        connectNulls: false,
        z: 2,
      },
    ],
  }
}
