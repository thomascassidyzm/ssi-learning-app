// ============================================================================
// coverage resolver  (teaching-insights — the COVERAGE lane)
//
// Metric: per-CLASS progress, treating the class as a first-class learner.
// "The class is itself a learner." (tutor-insights.md §2–§3)
//
// Four numbers per class, the leadership distillation:
//   · Coverage   — furthest LEGO reached in the program (seed is the rollup).
//   · Pace       — coverage advance over WALL-CLOCK time (LEGOs / week). HEADLINE.
//   · Dosage     — active minutes per week (flow rate, not a vanity total).
//   · Efficiency — coverage per active-minute (LEGOs ÷ minutes).
//
// SOURCE: analytics_class_coverage(p_days) — SECURITY DEFINER. A group-by over
//   class_sessions (which ALREADY EXISTS — zero new event instrumentation, and
//   independent of the Lane B teacher_user_id cleanup since it groups by the
//   clean class_id). Migration 20260614_analytics_class_coverage.sql is DRAFT /
//   UNAPPLIED — until applied this resolver degrades to a well-formed empty table.
//
// Canonical widget: 'table' (Class · Course · Coverage · Pace · Active min/wk · Efficiency).
//
// Returns a well-formed empty table on 0-row data or a blocked/absent RPC.
// NEVER throws.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TableData, DataQuery, Tone } from '../spec'

// ---- Raw RPC row shape (one row per class) ---------------------------------
// The migration computes the heavy lifting (furthest LEGO, span, sums) SQL-side;
// the resolver only derives the rates + tones so the same arithmetic is testable.
interface CoverageRow {
  class_id: string
  class_name: string | null
  course_code: string | null
  furthest_lego_id: string | null   // S####L## — the furthest end_lego_id reached
  legos_advanced: number             // furthest - start position (program LEGOs covered)
  active_minutes: number             // SUM(duration_seconds) / 60 over the window
  active_weeks: number               // wall-clock span of activity in weeks (>= ~1)
}

const COLUMNS: TableData['columns'] = [
  { key: 'class', label: 'Class', align: 'left' },
  { key: 'course', label: 'Course', align: 'left' },
  { key: 'coverage', label: 'Coverage', align: 'left' },
  { key: 'pace', label: 'Pace (LEGOs/wk)', align: 'right', format: 'number' },
  { key: 'dosage', label: 'Active min/wk', align: 'right', format: 'number' },
  { key: 'efficiency', label: 'Efficiency (LEGOs/min)', align: 'right', format: 'number' },
]

function emptyTable(): TableData {
  return { kind: 'table', columns: COLUMNS, rows: [] }
}

function parseDays(window?: string): number {
  if (!window) return 90
  const m = /^(\d+)d$/.exec(window)
  return m ? Number(m[1]) : 90
}

// LEGO ids are S####L## — parse to an orderable number for "furthest reached" and
// to render the coverage cell as "S#### · L##". seed*100 + lego keeps ordering monotone.
export function parseLegoOrder(legoId: string | null): number {
  if (!legoId) return 0
  const m = /^S(\d+)L(\d+)$/.exec(legoId.trim())
  if (!m) return 0
  return Number(m[1]) * 100 + Number(m[2])
}

function coverageLabel(legoId: string | null): string {
  if (!legoId) return '—'
  const m = /^S(\d+)L(\d+)$/.exec(legoId.trim())
  if (!m) return legoId
  return `S${Number(m[1])} · L${Number(m[2])}`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Pace tone is RELATIVE to the cohort (a class is healthy if it advances vs its
// peers, not against an absolute bar): fastest = good, slowest / stalled = alarm.
// This mirrors the demo generator so both paths render with the same grading.
export function paceTone(pace: number, maxPace: number): Tone {
  if (pace <= 0) return 'alarm'              // stalled — no advance over wall-clock
  if (maxPace === 0) return 'neutral'
  const r = pace / maxPace
  if (r >= 0.66) return 'good'
  if (r >= 0.33) return 'neutral'
  return 'warn'
}

const resolver = async (client: SupabaseClient, q: DataQuery): Promise<TableData> => {
  let rows: CoverageRow[] = []
  try {
    const { data, error } = await client.rpc('analytics_class_coverage', {
      p_days: parseDays(q.window),
    })
    if (error) {
      console.error('[coverage] analytics_class_coverage error:', error.message)
      return emptyTable()
    }
    rows = (data as CoverageRow[]) || []
  } catch (e: unknown) {
    console.error('[coverage] analytics_class_coverage threw:', e)
    return emptyTable()
  }
  if (rows.length === 0) return emptyTable()

  // Derive per-class rates, then grade pace relative to the fastest class.
  const derived = rows.map((r) => {
    const weeks = Math.max(r.active_weeks, 1 / 7)   // floor at one day so single-session classes don't divide by ~0
    const minutes = Math.max(r.active_minutes, 0)
    const pace = round1(Math.max(r.legos_advanced, 0) / weeks)
    const dosage = round1(minutes / weeks)
    const efficiency = minutes > 0 ? round2(Math.max(r.legos_advanced, 0) / minutes) : 0
    return { r, pace, dosage, efficiency }
  })

  const maxPace = derived.reduce((m, d) => Math.max(m, d.pace), 0)

  // Headline order: fastest pace first (the league table of advance).
  derived.sort((a, b) => b.pace - a.pace)

  return {
    kind: 'table',
    columns: COLUMNS,
    rows: derived.map((d) => ({
      id: d.r.class_id,
      tone: paceTone(d.pace, maxPace),
      cells: {
        class: d.r.class_name || d.r.class_id.slice(0, 8),
        course: d.r.course_code || '—',
        coverage: coverageLabel(d.r.furthest_lego_id),
        pace: d.pace,
        dosage: d.dosage,
        efficiency: d.efficiency,
      },
    })),
  }
}

export default resolver

export type { TableData as CoverageResult }
