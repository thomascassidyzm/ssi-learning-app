/**
 * boardMetrics — the metric registry for the living board report.
 *
 * One place every board number comes from: slug, label, one-line method
 * (shown on hover so a board number is never unexplained), and a resolver
 * that runs a live query against the service-role Supabase client. All
 * global aggregates exclude test/demo rows via the FLAG, never a name
 * heuristic: schools.total uses schools.is_test (superset of is_demo — see
 * 20260715_schools_groups_is_test_flag.sql); the learner metrics use
 * test_learner_ids() (20260715_test_learner_exclusion.sql), a superset of
 * is_demo covering staff/QA (is_internal), owner plus-address test accounts,
 * and real signups tied to an is_test school/class. Otherwise the demo/test
 * estate inflates real business numbers.
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
  // test_learner_ids() is the canonical test/internal/demo learner set (see
  // 20260715_test_learner_exclusion.sql) — a superset of is_demo alone, which
  // undercounted by missing staff/QA accounts, owner plus-address test
  // signups, and real signups tied to is_test schools/classes.
  const { data: testRows, error: testError } = await svc.rpc('test_learner_ids')
  if (testError) throw testError
  const testIds = new Set((testRows ?? []).map((r: { learner_id: string }) => r.learner_id))

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
      if (!testIds.has(learnerId)) activeIds.add(learnerId)
    }
    if (data.length < SESSIONS_PAGE_SIZE) break
  }
  return activeIds.size
}

export const BOARD_METRICS: BoardMetric[] = [
  {
    slug: 'learners.active_30d',
    label: 'Active learners (30d)',
    method: 'Distinct learners with a session in the last 30 days, excluding demo/internal/test learners (test_learner_ids()).',
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
    method: 'Sum of daily_contributions.minutes_practiced over the last 30 days (demo/internal/test sessions already excluded at write time by the update_daily_contributions trigger via test_learner_ids()).',
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
    method: 'Count of schools rows, excluding is_test schools (soak-test/E2E/owner-test — a superset of is_demo; every school in the DB is currently is_test, so this reads 0 until a real pilot school lands).',
    async resolve(svc) {
      const asOf = new Date().toISOString()
      const { count, error } = await svc
        .from('schools')
        .select('id', { count: 'exact', head: true })
        .eq('is_test', false)
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
