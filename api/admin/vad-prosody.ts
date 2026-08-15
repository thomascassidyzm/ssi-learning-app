/**
 * Admin VAD prosody aggregates — GET /api/admin/vad-prosody
 *
 * ssi_admin only. Returns ONE per-learner aggregate of the cycle_prosody
 * telemetry, for every learner who has any.
 *
 * WHY A SERVER ENDPOINT, when the rest of the Voice & pause board reads
 * Supabase straight from the browser: player_events is own-row under RLS for
 * EVERYONE, admins included. Verified live 2026-08-12 with a real ssi_admin
 * JWT — learner_lego_metrics returns another learner's 65 rows, player_events
 * returns 0 of their 321 cycle_prosody rows. So a client-side prosody read can
 * only ever render dashes. (That same block, not the analytics exclusion, is
 * why "Recent activity" reads 0 for demo learners on the admin user page.)
 *
 * The RLS posture is deliberate and untouched: this endpoint is the
 * server-mediated door the RLS doctrine calls for — own-row in the policy,
 * cross-user authz in an endpoint with a test.
 *
 * AGGREGATES ONLY. Nothing per-event and no envelope contour ever leaves here —
 * counts and means per learner, so the caller can roll up to any scope and
 * still state its own denominator.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const PAGE = 1000
const MAX_EVENTS = 100_000     // safety cap; logged in the response so a truncation is never silent

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

function emptyAgg(): ProsodyAgg {
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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }
  if (!supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Scalar JSON projections only — the 128-point envelope contour never
    // crosses the wire.
    const select =
      'user_id, ' +
      'payload->>peakEnergyDb, payload->>averageEnergyDb, ' +
      'payload->>startedDuringPrompt, payload->>stillSpeakingAtVoice1, ' +
      'payload->envelope->>peakCount'

    const rows: Record<string, unknown>[] = []
    let truncated = false
    for (let from = 0; from < MAX_EVENTS; from += PAGE) {
      const { data, error } = await supabase
        .from('player_events')
        .select(select)
        .eq('event_type', 'cycle_prosody')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const page = (data || []) as unknown as Record<string, unknown>[]
      rows.push(...page)
      if (page.length < PAGE) break
      if (from + PAGE >= MAX_EVENTS) truncated = true
    }

    const byLearner = foldProsody(rows)
    res.status(200).json({
      events: rows.length,
      learners: Object.keys(byLearner).length,
      truncated,                       // never a silent cap
      byLearner,
    })
  } catch (e: unknown) {
    console.error('[admin/vad-prosody]', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to aggregate prosody' })
  }
}
