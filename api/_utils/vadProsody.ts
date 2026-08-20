/**
 * vadProsody — the ONE cycle_prosody aggregation, shared by every door that
 * serves prosody.
 *
 * WHY IT EXISTS AS A UTIL: player_events is own-row under RLS for EVERYONE,
 * admins included. Verified live 2026-08-12 with a real ssi_admin JWT —
 * learner_lego_metrics returns another learner's 65 rows, player_events returns
 * 0 of their 321 cycle_prosody rows. So prosody can only ever be read
 * server-side, with the service role, behind an authz predicate. There are now
 * two such doors (GET /api/admin/vad-prosody for the admin board, GET
 * /api/org/vad for the hierarchy-scoped node surfaces) and exactly one
 * implementation of the read + fold, here.
 *
 * AGGREGATES ONLY. Nothing per-event and no envelope contour ever leaves this
 * module — counts and means per learner, each carrying the base it was taken
 * over, so any caller can roll up to any scope and still state its own
 * denominator.
 *
 * THE IDENTITY TRAP (CLAUDE.md): player_events.user_id is uuid but holds
 * learners.id, NOT the auth uid. `learnerIds` here are learners.id throughout.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'

const PAGE = 1000
const MAX_EVENTS = 100_000     // safety cap; reported in the result so a truncation is never silent

/** One learner's prosody read. Every mean carries the base it was taken over. */
export interface ProsodyAgg {
  events: number
  peakEnergyDbSum: number
  peakEnergyDbBase: number
  averageEnergyDbSum: number
  averageEnergyDbBase: number
  peakCountSum: number
  peakCountBase: number
  startedDuringPrompt: number
  startedDuringPromptBase: number
  stillSpeakingAtVoice1: number
  stillSpeakingAtVoice1Base: number
}

export function emptyAgg(): ProsodyAgg {
  return {
    events: 0,
    peakEnergyDbSum: 0, peakEnergyDbBase: 0,
    averageEnergyDbSum: 0, averageEnergyDbBase: 0,
    peakCountSum: 0, peakCountBase: 0,
    startedDuringPrompt: 0, startedDuringPromptBase: 0,
    stillSpeakingAtVoice1: 0, stillSpeakingAtVoice1Base: 0,
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function bool(v: unknown): boolean | null {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return null
}

export function foldProsody(rows: Record<string, unknown>[]): Record<string, ProsodyAgg> {
  const out: Record<string, ProsodyAgg> = {}
  for (const raw of rows) {
    const id = raw.user_id ? String(raw.user_id) : null
    if (!id) continue
    const agg = out[id] ?? (out[id] = emptyAgg())
    agg.events++

    const peak = num(raw.peakEnergyDb)
    if (peak !== null) { agg.peakEnergyDbSum += peak; agg.peakEnergyDbBase++ }

    const avg = num(raw.averageEnergyDb)
    if (avg !== null) { agg.averageEnergyDbSum += avg; agg.averageEnergyDbBase++ }

    const peaks = num(raw.peakCount)
    if (peaks !== null) { agg.peakCountSum += peaks; agg.peakCountBase++ }

    const early = bool(raw.startedDuringPrompt)
    if (early !== null) { agg.startedDuringPromptBase++; if (early) agg.startedDuringPrompt++ }

    const over = bool(raw.stillSpeakingAtVoice1)
    if (over !== null) { agg.stillSpeakingAtVoice1Base++; if (over) agg.stillSpeakingAtVoice1++ }
  }
  return out
}

/**
 * Scalar JSON projections only — the 128-point envelope contour never crosses
 * the wire, in either direction, for any caller.
 */
const SELECT =
  'user_id, ' +
  'payload->>peakEnergyDb, payload->>averageEnergyDb, ' +
  'payload->>startedDuringPrompt, payload->>stillSpeakingAtVoice1, ' +
  'payload->envelope->>peakCount'

export interface ProsodyResult {
  events: number
  learners: number
  truncated: boolean
  byLearner: Record<string, ProsodyAgg>
}

/**
 * Read + fold cycle_prosody with the service role.
 *
 * `learnerIds` is the AUTHORIZED SET, already resolved from the caller's own
 * verified identity — never from client input. Pass `null` for "no filter",
 * which is the ssi_admin whole-forest case and nothing else. An EMPTY array is
 * a legitimate answer meaning "this caller may see nobody" and returns an empty
 * result without touching the table — it is never treated as "no filter".
 */
export async function fetchProsodyAggs(
  svc: SupabaseClient,
  learnerIds: string[] | null,
): Promise<ProsodyResult> {
  if (learnerIds !== null && learnerIds.length === 0) {
    return { events: 0, learners: 0, truncated: false, byLearner: {} }
  }

  const rows: Record<string, unknown>[] = []
  let truncated = false

  // Chunked so a large scope never blows the PostgREST .in() URL cap. Each
  // chunk paginates independently; the MAX_EVENTS cap is global across chunks
  // so a wide scope can't quietly out-read the admin one.
  const batches: (string[] | null)[] = learnerIds === null ? [null] : chunk(learnerIds)
  for (const batch of batches) {
    for (let from = 0; from < MAX_EVENTS; from += PAGE) {
      if (rows.length >= MAX_EVENTS) { truncated = true; break }
      let q = svc
        .from('player_events')
        .select(SELECT)
        .eq('event_type', 'cycle_prosody')
      if (batch !== null) q = q.in('user_id', batch)
      const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1)
      if (error) throw error
      const page = (data || []) as unknown as Record<string, unknown>[]
      rows.push(...page)
      if (page.length < PAGE) break
      if (from + PAGE >= MAX_EVENTS) truncated = true
    }
    if (truncated) break
  }

  const byLearner = foldProsody(rows)
  return { events: rows.length, learners: Object.keys(byLearner).length, truncated, byLearner }
}
