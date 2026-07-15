/**
 * boardTokens — parses `{{metric:slug}}` tokens out of authored board-report
 * markdown into renderable segments (living-board-report-spec.md §1).
 *
 * WP-1 scope: metric tokens only ({{series:...}} / {{table:...}} land in
 * WP-3+). An unknown slug — one with no matching resolved metric — becomes a
 * visible 'unknown' segment; the caller decides how loud to render it (an
 * inline error in the live admin view, a hard failure at snapshot-freeze time).
 */

export interface ResolvedMetric {
  slug: string
  label: string
  method: string
  value: number
  asOf: string
}

export type BoardTokenSegment =
  | { type: 'text'; text: string }
  | { type: 'metric'; metric: ResolvedMetric }
  | { type: 'unknown'; slug: string }

const METRIC_TOKEN_RE = /\{\{metric:([a-zA-Z0-9_.]+)\}\}/g

export function parseBoardTokens(
  markdown: string,
  metrics: Record<string, ResolvedMetric>,
): BoardTokenSegment[] {
  const segments: BoardTokenSegment[] = []
  let lastIndex = 0
  METRIC_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = METRIC_TOKEN_RE.exec(markdown))) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: markdown.slice(lastIndex, match.index) })
    }
    const slug = match[1]
    const metric = metrics[slug]
    segments.push(metric ? { type: 'metric', metric } : { type: 'unknown', slug })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < markdown.length) {
    segments.push({ type: 'text', text: markdown.slice(lastIndex) })
  }
  return segments
}

export function findUnknownBoardTokens(
  markdown: string,
  metrics: Record<string, ResolvedMetric>,
): string[] {
  return parseBoardTokens(markdown, metrics)
    .filter((s): s is { type: 'unknown'; slug: string } => s.type === 'unknown')
    .map(s => s.slug)
}

export function formatMetricValue(metric: ResolvedMetric): string {
  return metric.value.toLocaleString('en-GB')
}

export function metricsBySlug(metrics: ResolvedMetric[]): Record<string, ResolvedMetric> {
  const bySlug: Record<string, ResolvedMetric> = {}
  for (const m of metrics) bySlug[m.slug] = m
  return bySlug
}
