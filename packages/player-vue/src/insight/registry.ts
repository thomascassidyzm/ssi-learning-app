// ============================================================================
// FILE 2 — THE SEMANTIC SUBSTRATE (registry.ts)
//
// metric id -> { def, resolver }. A metric is DEFINED + TESTED ONCE here, so two surfaces
// can never disagree about "retention". TYPE HINGE (A): def.widget === K binds the
// resolver to Resolver<K>, so registering a treemap metric with a funnel resolver is a
// COMPILE error.
//
// The spine authors ALL FIVE entries up front (full MetricDef). Resolver agents only fill
// in data/<metric>.ts bodies — registry.ts is never co-edited during the fan-out. A 6th
// metric later = one additive, mergeable line.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WidgetKind, DataForKind, DataQuery, Frame, WidgetData } from './spec'

export interface MetricDef<K extends WidgetKind = WidgetKind> {
  id: string
  label: string                 // human name for the ask-bar / discover
  frames: Frame[]               // which lenses this metric legitimately answers (B: constrains composition)
  widget: K                     // the canonical widget this metric renders into (binds the resolver's return type)
  altWidgets?: WidgetKind[]     // other widgets Claude MAY pick (e.g. retention as time-series OR cohort-grid)
  unit?: string
  description: string           // the SINGLE tested definition — correctness lives here, once
}

// Resolver is READ-ONLY, returns the EXACT variant for the metric's declared kind, NEVER throws
// (returns well-formed zeros/empties on 0-row tables or a blocked read).
export type Resolver<K extends WidgetKind> =
  (client: SupabaseClient, q: DataQuery) => Promise<DataForKind<K>>

// One entry binds def.widget === K and resolver: Resolver<K> via a generic factory.
export interface RegistryEntry<K extends WidgetKind = WidgetKind> {
  def: MetricDef<K>
  load: () => Promise<{ default: Resolver<K> }>   // lazy import of data/<metric>.ts (admin code-split chunk)
}
function entry<K extends WidgetKind>(e: RegistryEntry<K>): RegistryEntry<K> { return e }  // infers + checks K

// The registry holds entries of DIFFERENT kinds. `RegistryEntry<WidgetKind>` would (wrongly)
// demand a resolver that handles EVERY kind; what we want is "RegistryEntry<K> for SOME K".
// This distributed union is exactly that — the per-call `entry<K>()` binding above is where the
// real def.widget===K / Resolver<K> safety is enforced; this just lets heterogeneous entries
// live in one record without the invariance false-positive.
export type AnyRegistryEntry = { [K in WidgetKind]: RegistryEntry<K> }[WidgetKind]

// The five metrics (build-plan §6 first cut). data/<metric>.ts files are authored by the
// resolver agents AFTER the spine freezes — the lazy import() references resolve at build time.
export const REGISTRY = {
  courseValue: entry({
    def: {
      id: 'courseValue',
      label: 'Course value',
      frames: ['world', 'content'],
      widget: 'treemap',
      altWidgets: ['ranked-bar', 'stat'],
      description: 'LTV-proxy = reach x stickiness x retention, per course',
    },
    load: () => import('./data/courseValue'),
  }),
  contentFriction: entry({
    def: {
      id: 'contentFriction',
      label: 'Content friction',
      frames: ['content'],
      widget: 'cohort-grid',
      altWidgets: ['ranked-bar', 'table'],
      description: 'per-unit skip-back + stall + drop-off + audio_failed; reuses analytics_friction_map',
    },
    load: () => import('./data/contentFriction'),
  }),
  retention: entry({
    def: {
      id: 'retention',
      label: 'Retention',
      frames: ['group', 'world'],
      widget: 'time-series',
      altWidgets: ['cohort-grid', 'stat'],
      description: 'days-active + return-rate 7/30/90d; reuses analytics_retention_cohorts',
    },
    load: () => import('./data/retention'),
  }),
  health: entry({
    def: {
      id: 'health',
      label: 'Platform health',
      frames: ['world'],
      widget: 'stat',
      altWidgets: ['time-series'],
      description: 'audio_failed rate, cacheHit, client_version + device spread; reuses analytics_overview',
    },
    load: () => import('./data/health'),
  }),
  trialConversion: entry({
    def: {
      id: 'trialConversion',
      label: 'Trial → paid',
      frames: ['world'],
      widget: 'funnel',
      altWidgets: ['stat'],
      description: 'trial->paid funnel; subscriptions has 0 rows today -> returns a well-formed zero-stage funnel',
    },
    load: () => import('./data/trialConversion'),
  }),
  difficultyTurns: entry({
    def: {
      id: 'difficultyTurns',
      label: 'Difficulty turns',
      frames: ['world', 'group'],
      widget: 'table',
      altWidgets: ['ranked-bar'],
      description: 'per-(learner,lego) local difficulty — the B4 curvature sensor over the live latency series: who is struggling / just turned. Reads analytics_difficulty_turns (admin-only).',
    },
    load: () => import('./data/difficultyTurns'),
  }),
  coverage: entry({
    def: {
      id: 'coverage',
      label: 'Coverage',
      frames: ['group', 'world'],
      widget: 'table',
      altWidgets: ['ranked-bar', 'time-series'],
      description: 'the COVERAGE lane — the class as a learner: furthest LEGO reached (coverage), pace (LEGOs/wk over wall-clock), dosage (active min/wk), efficiency (LEGOs/min). A group-by over class_sessions by class_id. Reads analytics_class_coverage (DRAFT migration).',
    },
    load: () => import('./data/coverage'),
  }),
} satisfies Record<string, AnyRegistryEntry>

export type MetricId = keyof typeof REGISTRY

// Lookup the def without loading the resolver chunk (boards/ask-bar list metrics from this).
export function metricDef(id: string): MetricDef | undefined {
  return (REGISTRY as Record<string, AnyRegistryEntry>)[id]?.def
}

// The one helper boards/InsightsView call. Resolves a composition to a renderable variant.
// The resolver itself never throws; on an unknown metric this throws (a programming error, caught in dev).
export async function resolveMetric(client: SupabaseClient, q: DataQuery): Promise<WidgetData> {
  const e = (REGISTRY as Record<string, AnyRegistryEntry>)[q.metric]
  if (!e) throw new Error(`[insight] unknown metric '${q.metric}'`)
  const { default: resolve } = await e.load()
  // `e` is a union member, so `resolve` is a union of Resolver<K>; the host narrows by q.metric.
  return (resolve as (c: SupabaseClient, q: DataQuery) => Promise<WidgetData>)(client, q)
}

// re-export so consumers import the renderable union from one place alongside resolveMetric.
export type { WidgetData } from './spec'

// ----------------------------------------------------------------------------
// data/<metric>.ts CONTRACT — each resolver agent default-exports a Resolver<K> matching
// def.widget. The host passes in the client (useAdminClient().getClient() upstream). Each
// resolver PREFERS the analytics_* RPCs (analytics_friction_map, analytics_retention_cohorts,
// analytics_overview), mirrors the proven useAnalytics* fetch idiom (client.rpc(...), data||[],
// graceful catch), and returns the typed variant — zeros/empties on no-data, NEVER throws.
// If a raw player_events read is needed and PostgREST blocks it, author a NEW SECURITY DEFINER
// RPC as a migration FILE in supabase/migrations/ (UNAPPLIED, for Tom) and call it.
// ----------------------------------------------------------------------------
