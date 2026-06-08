// ============================================================================
// INSIGHT ENGINE — metric resolver: trialConversion
//
// Returns a FunnelData with five fixed stages describing the trial→paid funnel:
//   trial-started → day-1 session → day-4 return → day-7 active → converted
//
// Source: analytics_trial_conversion() SECURITY DEFINER RPC
//   (migration: supabase/migrations/20260602_analytics_trial_conversion.sql)
//
// The subscriptions table has 0 rows today. The resolver NEVER throws on empty
// data — it returns a structurally valid 5-stage funnel of zeros. The RPC itself
// also returns zero-rows safely. Both layers are belt-and-braces.
//
// Resolver signature matches Resolver<'funnel'> as declared in registry.ts.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FunnelData, Tone } from '../spec'
import type { DataQuery } from '../spec'

// ---- Result type (exported so boards / wrapper may reference it) -----------

/** One stage of the trial→paid funnel as returned by analytics_trial_conversion(). */
export interface TrialFunnelStage {
  stage: string
  label: string
  learner_count: number
}

/** Typed result from the analytics_trial_conversion() RPC. */
export type TrialConversionResult = TrialFunnelStage[]

// ---- Stage definitions (ordered, frozen) -----------------------------------

interface StageDef {
  id: string
  label: string
  /** threshold below which we warn (as share of the preceding stage). 0 = no threshold. */
  warnThreshold: number
}

const STAGE_DEFS: StageDef[] = [
  { id: 'trial_started', label: 'Trial started',  warnThreshold: 0 },
  { id: 'day1_session',  label: 'Day-1 session',  warnThreshold: 0.4 },
  { id: 'day4_return',   label: 'Day-4 return',   warnThreshold: 0.3 },
  { id: 'day7_active',   label: 'Day-7 active',   warnThreshold: 0.3 },
  { id: 'converted',     label: 'Converted',      warnThreshold: 0 },
]

// ---- Well-formed zero result ------------------------------------------------

function zeroFunnel(): FunnelData {
  return {
    kind: 'funnel',
    stages: STAGE_DEFS.map((s) => ({
      id:    s.id,
      label: s.label,
      value: 0,
      tone:  'neutral' as Tone,
    })),
  }
}

// ---- Tone derivation --------------------------------------------------------

/**
 * Assigns a Tone to each stage based on its share of the previous stage.
 * Stage 0 (trial_started) is always 'neutral' — it is the baseline.
 * Stages with values but a low share are 'warn'.
 * A stage at 0 with a non-zero predecessor is 'alarm'.
 */
function deriveTone(value: number, prev: number, threshold: number): Tone {
  if (prev === 0) return 'neutral'
  if (value === 0) return 'alarm'
  const share = value / prev
  if (threshold > 0 && share < threshold) return 'warn'
  return 'good'
}

// ---- Resolver (default export, matches Resolver<'funnel'>) -----------------

export default async function resolve(
  client: SupabaseClient,
  _q: DataQuery,
): Promise<FunnelData> {
  // Call the analytics_trial_conversion RPC. Mirrors the exact idiom in
  // useAnalyticsOverview/useAnalyticsGrowth: client.rpc(), data || [], catch.
  let rows: TrialConversionResult = []

  try {
    const { data, error } = await client.rpc('analytics_trial_conversion')
    if (error) {
      // RPC missing (pre-migration), blocked by RLS, or god-gate failed —
      // all map to a graceful zero funnel, not a throw.
      console.warn('[trialConversion] RPC error — returning zeros:', error.message)
      return zeroFunnel()
    }
    rows = (data as TrialConversionResult) || []
  } catch (e: any) {
    console.warn('[trialConversion] Unexpected error — returning zeros:', e?.message ?? e)
    return zeroFunnel()
  }

  // Index the rows by stage id so STAGE_DEFS drives ordering, not the DB row order.
  const byId = new Map<string, number>(
    rows.map((r) => [r.stage, Number(r.learner_count ?? 0)])
  )

  // Build the FunnelData stages in canonical order, annotating tone.
  const stages: FunnelData['stages'] = []
  let prevValue = 0

  for (let i = 0; i < STAGE_DEFS.length; i++) {
    const def = STAGE_DEFS[i]
    const value = byId.get(def.id) ?? 0
    const tone: Tone = i === 0 ? 'neutral' : deriveTone(value, prevValue, def.warnThreshold)
    stages.push({ id: def.id, label: def.label, value, tone })
    prevValue = value
  }

  return { kind: 'funnel', stages }
}
