/**
 * boardMetrics — the metric registry for the living board report.
 *
 * One place every board number comes from: slug, label, one-line method
 * (shown on hover so a board number is never unexplained), and a resolver
 * that runs a live query against the service-role Supabase client. All
 * global aggregates exclude is_demo rows (learners/schools), the standing
 * rule from the 2026-06-10 demo-data-separation migration — otherwise the
 * IME/Ireland demo estate would inflate real business numbers.
 *
 * Server-side only (Vercel functions) — never called from the browser, per
 * the resolveVisibleScope division of labour.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface MetricValue {
  slug: string
  label: string
  method: string
  value: number
  asOf: string // ISO timestamp — when this value was computed
}

export interface BoardMetric {
  slug: string
  label: string
  method: string
  resolve(svc: SupabaseClient): Promise<{ value: number; asOf: string }>
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

// Sessions in a 30-day window are currently in the low thousands (checked
// live 2026-07-15: ~3k). This page cap is a generous multiple of that, not a
// tuned limit — revisit if real traffic ever approaches it.
const SESSIONS_PAGE_SIZE = 1000
const SESSIONS_MAX_PAGES = 25

async function countActiveLearners(svc: SupabaseClient, sinceIso: string): Promise<number> {
  const { data: demoRows, error: demoError } = await svc
    .from('learners')
    .select('id')
    .eq('is_demo', true)
  if (demoError) throw demoError
  const demoIds = new Set((demoRows ?? []).map(r => r.id as string))

  const activeIds = new Set<string>()
  for (let page = 0; page < SESSIONS_MAX_PAGES; page++) {
    const from = page * SESSIONS_PAGE_SIZE
    const to = from + SESSIONS_PAGE_SIZE - 1
    const { data, error } = await svc
      .from('sessions')
      .select('learner_id')
      .gte('started_at', sinceIso)
      .range(from, to)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      const learnerId = row.learner_id as string
      if (!demoIds.has(learnerId)) activeIds.add(learnerId)
    }
    if (data.length < SESSIONS_PAGE_SIZE) break
  }
  return activeIds.size
}

export const BOARD_METRICS: BoardMetric[] = [
  {
    slug: 'learners.active_30d',
    label: 'Active learners (30d)',
    method: 'Distinct learners with a session in the last 30 days, excluding demo learners.',
    async resolve(svc) {
      const asOf = new Date().toISOString()
      const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString()
      const value = await countActiveLearners(svc, since)
      return { value, asOf }
    },
  },
  {
    slug: 'minutes.total_30d',
    label: 'Practice minutes (30d)',
    method: 'Sum of daily_contributions.minutes_practiced over the last 30 days (demo sessions already excluded at write time by the update_daily_contributions trigger).',
    async resolve(svc) {
      const asOf = new Date().toISOString()
      const sinceDate = new Date(Date.now() - THIRTY_DAYS_MS).toISOString().slice(0, 10)
      const { data, error } = await svc
        .from('daily_contributions')
        .select('minutes_practiced')
        .gte('contribution_date', sinceDate)
      if (error) throw error
      const value = (data ?? []).reduce((sum, r) => sum + (r.minutes_practiced ?? 0), 0)
      return { value, asOf }
    },
  },
  {
    slug: 'schools.total',
    label: 'Schools on platform',
    method: 'Count of schools rows, excluding demo schools.',
    async resolve(svc) {
      const asOf = new Date().toISOString()
      const { count, error } = await svc
        .from('schools')
        .select('id', { count: 'exact', head: true })
        .eq('is_demo', false)
      if (error) throw error
      return { value: count ?? 0, asOf }
    },
  },
]

export function getBoardMetric(slug: string): BoardMetric | undefined {
  return BOARD_METRICS.find(m => m.slug === slug)
}

export async function resolveBoardMetric(svc: SupabaseClient, slug: string): Promise<MetricValue | null> {
  const metric = getBoardMetric(slug)
  if (!metric) return null
  const { value, asOf } = await metric.resolve(svc)
  return { slug: metric.slug, label: metric.label, method: metric.method, value, asOf }
}

export async function resolveAllBoardMetrics(svc: SupabaseClient): Promise<MetricValue[]> {
  return Promise.all(
    BOARD_METRICS.map(async metric => {
      const { value, asOf } = await metric.resolve(svc)
      return { slug: metric.slug, label: metric.label, method: metric.method, value, asOf }
    }),
  )
}
