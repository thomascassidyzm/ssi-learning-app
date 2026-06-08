// ============================================================================
// contentFriction resolver
//
// Metric: per-unit (lego/seed) population friction.
// Signals: skip-back rate · drop-off (stopped here) · spike rate · audio_failed.
//
// PRIMARY source: analytics_friction_map(p_course_id) — SECURITY DEFINER, anon-callable.
// SECONDARY source: analytics_friction_extended(p_course_id) — new RPC (migration:
//   20260602_analytics_friction_extended.sql, UNAPPLIED — apply before first use).
//
// Canonical widget: 'cohort-grid' (seed-band × friction-dimension heatmap).
//   x-axis: seed bands (S1–20 … S101+)
//   y-axis: friction dimensions (Drop-off, Spike-rate, Skip-back, Audio-failed)
//   cell value: normalised 0–100 score within each dimension so all four dimensions
//               share one visual map (raw counts vary too wildly to share a scale).
//
// Returns well-formed zeros on: 0-row data, missing course filter, blocked RPC.
// NEVER throws.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CohortGridData } from '../spec'
import type { DataQuery } from '../spec'

// ---- Raw RPC row shapes (Supabase returns plain objects) ----

interface FrictionMapRow {
  seed_number: number
  stopped_here_count: number
  spike_rate: number
}

interface FrictionExtendedRow {
  seed_band: string
  band_min: number
  band_max: number
  skip_back_count: number
  audio_failed_count: number
}

// ---- Band definitions (match the gallery's heatmap + the SQL bands) ----

const SEED_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'S1–20',   min:   1, max:  20 },
  { label: 'S21–40',  min:  21, max:  40 },
  { label: 'S41–60',  min:  41, max:  60 },
  { label: 'S61–80',  min:  61, max:  80 },
  { label: 'S81–100', min:  81, max: 100 },
  { label: 'S101+',   min: 101, max: Infinity },
]

// Friction dimensions rendered as the y-axis of the heatmap.
const FRICTION_DIMS = ['Drop-off', 'Spike-rate', 'Skip-back', 'Audio-failed'] as const
type FrictionDim = typeof FRICTION_DIMS[number]

// ---- Aggregation helpers ----

/** Sum friction_map rows that fall within a seed band. */
function aggregateFrictionMapBand(
  rows: FrictionMapRow[],
  min: number,
  max: number,
): { stoppedSum: number; spikeSum: number; count: number } {
  let stoppedSum = 0
  let spikeSum = 0
  let count = 0
  for (const r of rows) {
    if (r.seed_number >= min && r.seed_number <= max) {
      stoppedSum += r.stopped_here_count
      spikeSum   += r.spike_rate        // sum then average below
      count++
    }
  }
  return { stoppedSum, spikeSum, count }
}

/** Normalise an array of raw values to a 0–100 scale (linear, min–max). */
function normalise(values: number[]): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return values.map(() => 0)
  return values.map(v => Math.round(((v - min) / (max - min)) * 100))
}

// ---- EMPTY sentinel (well-formed zeros for pre-data / filtered-out state) ----

function emptyGrid(): CohortGridData {
  return {
    kind: 'cohort-grid',
    xLabels: SEED_BANDS.map(b => b.label),
    yLabels: [...FRICTION_DIMS],
    cells: [],
    min: 0,
    max: 0,
    unit: 'friction score (normalised)',
  }
}

// ---- The resolver ----

const resolver = async (
  client: SupabaseClient,
  q: DataQuery,
): Promise<CohortGridData> => {
  // A course filter is required for analytics_friction_map.
  // If omitted we return a well-formed empty grid rather than a wildcard query.
  const courseId = q.course ?? q.entityId ?? q.filter?.['course'] as string | undefined
  if (!courseId) return emptyGrid()

  // ---- 1. Primary fetch: analytics_friction_map ----
  let frictionRows: FrictionMapRow[] = []
  try {
    const { data, error } = await client.rpc('analytics_friction_map', {
      p_course_id: courseId,
    })
    if (error) {
      console.error('[contentFriction] analytics_friction_map error:', error.message)
    } else {
      frictionRows = (data as FrictionMapRow[]) || []
    }
  } catch (e: unknown) {
    console.error('[contentFriction] analytics_friction_map threw:', e)
  }

  // ---- 2. Secondary fetch: analytics_friction_extended (skip-back + audio_failed per band) ----
  // This RPC may not yet be applied (migration 20260602_analytics_friction_extended.sql is
  // UNAPPLIED). If it returns an error we degrade gracefully to zeros for those columns.
  const extendedByBand: Map<string, FrictionExtendedRow> = new Map()
  try {
    const { data, error } = await client.rpc('analytics_friction_extended', {
      p_course_id: courseId,
    })
    if (!error && data) {
      for (const row of data as FrictionExtendedRow[]) {
        extendedByBand.set(row.seed_band, row)
      }
    }
    // If error (RPC not applied yet), we silently continue — extendedByBand stays empty.
  } catch {
    // Silently degrade; skip-back + audio-failed columns will show 0.
  }

  // ---- 3. Aggregate friction_map rows into bands ----
  const bandStopRaw:   number[] = []
  const bandSpikeRaw:  number[] = []
  const bandSkipRaw:   number[] = []
  const bandFailedRaw: number[] = []

  for (const band of SEED_BANDS) {
    const { stoppedSum, spikeSum, count } = aggregateFrictionMapBand(
      frictionRows,
      band.min,
      band.max === Infinity ? Number.MAX_SAFE_INTEGER : band.max,
    )
    bandStopRaw.push(stoppedSum)
    bandSpikeRaw.push(count > 0 ? spikeSum / count : 0)   // average spike rate within band

    const ext = extendedByBand.get(band.label)
    bandSkipRaw.push(ext?.skip_back_count  ?? 0)
    bandFailedRaw.push(ext?.audio_failed_count ?? 0)
  }

  // Early-exit if all zeros (no data yet for this course)
  const hasData =
    bandStopRaw.some(v => v > 0) ||
    bandSpikeRaw.some(v => v > 0) ||
    bandSkipRaw.some(v => v > 0) ||
    bandFailedRaw.some(v => v > 0)
  if (!hasData) return emptyGrid()

  // ---- 4. Normalise each dimension independently (0-100) ----
  const stopNorm   = normalise(bandStopRaw)
  const spikeNorm  = normalise(bandSpikeRaw)
  const skipNorm   = normalise(bandSkipRaw)
  const failedNorm = normalise(bandFailedRaw)

  // ---- 5. Build the cell array (ECharts heatmap: [{x, y, value}]) ----
  const cells: CohortGridData['cells'] = []

  const dimData: Record<FrictionDim, number[]> = {
    'Drop-off':    stopNorm,
    'Spike-rate':  spikeNorm,
    'Skip-back':   skipNorm,
    'Audio-failed': failedNorm,
  }

  for (const dim of FRICTION_DIMS) {
    const values = dimData[dim]
    for (let bi = 0; bi < SEED_BANDS.length; bi++) {
      cells.push({
        x: SEED_BANDS[bi].label,
        y: dim,
        value: values[bi],
      })
    }
  }

  return {
    kind: 'cohort-grid',
    xLabels: SEED_BANDS.map(b => b.label),
    yLabels: [...FRICTION_DIMS],
    cells,
    min: 0,
    max: 100,
    unit: 'friction score (normalised)',
  }
}

export default resolver

// ---- Convenience re-export of the result type (named, for boards that want to type-narrow) ----
export type { CohortGridData as ContentFrictionResult }
