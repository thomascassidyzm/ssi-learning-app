/**
 * THE METRIC REGISTRY — every number the intelligence surface shows, defined
 * once, owned by exactly one question.
 *
 * Design §3.1: "Each registered metric renders on exactly one question page.
 * Two pages showing the same number is the fossil we are burying; a test over
 * the registry enforces it." The room with no hand went further (2026-09-10):
 * the durable part of this surface is what every reader shares whoever they
 * are — the population resolver, this registry, the aggregates, the k-floor,
 * the stamp — and the pages are a thin view over them. So a page never
 * computes a number of its own: it names a metric from here, and the metric
 * names the endpoint that computes it under the shared population rule.
 *
 * `question` is the ONE owner. intel/grammar.test.ts fails the build if a
 * view names a metric another question owns, or if a built question owns
 * nothing.
 */
import type { Question } from './questions'

export interface Metric {
  /** The question that owns this number, by slug. */
  question: Question['slug']
  /** Plain words, as the page says it. Never metric, cohort, telemetry. */
  label: string
  /** The endpoint that computes it, under api/_utils/realLearnerPopulation. */
  endpoint: string
  /** Distinct real people, a share, minutes, or a count of things. */
  unit: 'people' | 'share' | 'minutes' | 'count'
}

export const METRICS = {
  practisedThisWeek: { question: 'pulse', label: 'real people who practised in the last seven days', endpoint: '/api/intel/pulse', unit: 'people' },
  practisedLastWeek: { question: 'pulse', label: 'real people who practised in the seven days before', endpoint: '/api/intel/pulse', unit: 'people' },
  peopleByCourse: { question: 'pulse', label: 'this week\'s people, by course', endpoint: '/api/intel/pulse', unit: 'people' },
  peopleByCountry: { question: 'pulse', label: 'this week\'s people, by country', endpoint: '/api/intel/pulse', unit: 'people' },
  moneyStanding: { question: 'pulse', label: 'this week\'s people, paying, gifted or free', endpoint: '/api/intel/pulse', unit: 'people' },
  weakPointsByLego: { question: 'weak-points', label: 'trouble per person who met each piece of a course', endpoint: '/api/intel/weak-points', unit: 'count' },
  stoppedShareByLego: { question: 'weak-points', label: 'share of people whose last practice in a course was on this piece', endpoint: '/api/intel/weak-points', unit: 'share' },
} as const satisfies Record<string, Metric>

export type MetricId = keyof typeof METRICS

/** The metric, checked at the call site against the page's own question. */
export function metric(id: MetricId, owner: Question['slug']): Metric {
  const m = METRICS[id]
  if (m.question !== owner) {
    throw new Error(`metric "${id}" belongs to question "${m.question}", not "${owner}" — one metric, one page`)
  }
  return m
}
