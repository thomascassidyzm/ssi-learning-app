// ============================================================================
// difficultyTurns resolver  (metrics workstream B4 / M1)
//
// Metric: per-(learner, lego) LOCAL DIFFICULTY — "who is struggling, who just
// turned." Runs the B4 curvature sensor (@ssi/core assessLocalDifficulty) over
// the live per-unit latency series (learner_lego_metrics.recent_latency_samples)
// and returns the most-struggling-first "needs attention" list.
//
// SOURCE: analytics_difficulty_turns(p_days, p_min_samples) — SECURITY DEFINER,
//   admin-only (PII: named learners). Migration 20260614_analytics_difficulty_turns.sql
//   (UNAPPLIED — apply before first use; until then this degrades to an empty table).
//
// Canonical widget: 'table' (Learner · LEGO · Signal · σ-vs-own-noise).
//
// Returns a well-formed empty table on 0-row data, a blocked/absent RPC, or no
// flagged turns. NEVER throws. The sensor lives in TS; this resolver is the wire.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TableData, DataQuery, Tone } from '../spec'
import { assessLocalDifficulty } from '@ssi/core'

interface TurnRow {
  learner_id: string
  learner_name: string | null
  lego_id: string
  course_code: string
  recent_latency_samples: number[] | null
  last_seen_at: string
}

const COLUMNS: TableData['columns'] = [
  { key: 'learner', label: 'Learner', align: 'left' },
  { key: 'unit', label: 'LEGO', align: 'left' },
  { key: 'signal', label: 'Signal', align: 'left' },
  { key: 'z', label: 'vs own noise (σ)', align: 'right', format: 'number' },
]

function emptyTable(): TableData {
  return { kind: 'table', columns: COLUMNS, rows: [] }
}

// Only the two ACTIONABLE states reach the "needs attention" list; steady /
// warming-up are not surfaced (the sensor's own discipline — show the turn).
const SIGNAL_LABEL: Record<string, string> = {
  struggling: 'Struggling ↑',
  easing: 'Easing ↓',
}
const RANK: Record<string, number> = { struggling: 0, easing: 1 }

function parseDays(window?: string): number {
  if (!window) return 30
  const m = /^(\d+)d$/.exec(window)
  return m ? Number(m[1]) : 30
}

const resolver = async (client: SupabaseClient, q: DataQuery): Promise<TableData> => {
  let rows: TurnRow[] = []
  try {
    const { data, error } = await client.rpc('analytics_difficulty_turns', {
      p_days: parseDays(q.window),
      p_min_samples: 5,
    })
    if (error) {
      console.error('[difficultyTurns] analytics_difficulty_turns error:', error.message)
      return emptyTable()
    }
    rows = (data as TurnRow[]) || []
  } catch (e: unknown) {
    console.error('[difficultyTurns] analytics_difficulty_turns threw:', e)
    return emptyTable()
  }
  if (rows.length === 0) return emptyTable()

  // Run the B4 sensor per (learner, lego) over its persisted series.
  const assessed = rows.map((r) => ({
    r,
    d: assessLocalDifficulty({
      unitId: r.lego_id,
      unitKind: 'lego',
      values: Array.isArray(r.recent_latency_samples) ? r.recent_latency_samples : [],
    }),
  }))

  const attention = assessed
    .filter((a) => a.d.state === 'struggling' || a.d.state === 'easing')
    .sort(
      (a, b) =>
        (RANK[a.d.state] - RANK[b.d.state]) ||
        (Math.abs(b.d.accelerationZ ?? 0) - Math.abs(a.d.accelerationZ ?? 0))
    )

  if (attention.length === 0) return emptyTable()

  return {
    kind: 'table',
    columns: COLUMNS,
    rows: attention.map((a) => ({
      id: `${a.r.learner_id}:${a.r.lego_id}`,
      tone: (a.d.state === 'struggling' ? 'alarm' : 'good') as Tone,
      cells: {
        learner: a.r.learner_name || a.r.learner_id.slice(0, 8),
        unit: a.r.lego_id,
        signal: SIGNAL_LABEL[a.d.state] ?? a.d.state,
        z: Math.round((a.d.accelerationZ ?? 0) * 10) / 10,
      },
    })),
  }
}

export default resolver

export type { TableData as DifficultyTurnsResult }
