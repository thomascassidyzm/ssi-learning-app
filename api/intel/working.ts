/**
 * GET /api/intel/working?days=<n> — question 7.
 *
 * "Is the app working right now, and did my last fix land?" The Health
 * strip's question, answered the way the design says: the audio failure
 * rate by build, by device and by day, with the build most people are on
 * named. Environment is stamped on every event server-side, so only
 * production is read and staging and dev never mix in.
 *
 * COUNTED OVER REAL PEOPLE'S PLAYS, LIKE EVERY OTHER NUMBER HERE. The one
 * shared resolver applies, and the machine countries are dropped — Japan
 * alone was 61% of audio retries, which is a probe failing, not the app.
 * A staff member's own session is therefore not in this number; if a fix
 * needs checking before real people meet it, the deployed build is named
 * and the staging alias is where to look.
 *
 * The old analytics_health RPC is gated on the caller's own row and cannot
 * be called under a service role, so this counts from player_events
 * directly, paging with the same cap as weak-points and reporting
 * truncation rather than hiding it.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners, isMachineEvent } from '../_utils/realLearnerPopulation'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const PAGE = 1000
const MAX_ROWS = 60000

export interface Tally { plays: number; failures: number; people: number; rate: number | null }
export interface WorkingResponse {
  days: number
  population: number
  /** Real people with an audio play in the window. */
  people: number
  overall: Tally
  byDay: ({ day: string } & Tally)[]
  byBuild: ({ build: string } & Tally)[]
  byDevice: ({ device: string } & Tally)[]
  /** The build the most people played on in the last day, or null. */
  currentBuild: string | null
  truncated: boolean
  countedAt: string
}

type EventRow = {
  learner_id: string | null
  event_type: string
  client_version: string | null
  device_type: string | null
  ip_country: string | null
  occurred_at: string
}

type Acc = { plays: number; failures: number; people: Set<string> }
const acc = (): Acc => ({ plays: 0, failures: 0, people: new Set() })
const finish = (a: Acc): Tally => ({
  plays: a.plays,
  failures: a.failures,
  people: a.people.size,
  rate: a.plays + a.failures > 0 ? Math.round((a.failures / (a.plays + a.failures)) * 1000) / 1000 : null,
})

/** The pure tally over already-filtered events, so the test needs no database. */
export function tallyWorking(events: EventRow[], now = Date.now()) {
  const overall = acc()
  const byDay = new Map<string, Acc>()
  const byBuild = new Map<string, Acc>()
  const byDevice = new Map<string, Acc>()
  const lastDay = new Map<string, Set<string>>()
  const dayAgo = now - 86_400_000

  for (const e of events) {
    const isPlay = e.event_type === 'audio_play'
    const isFail = e.event_type === 'audio_failed'
    if (!isPlay && !isFail) continue
    const id = e.learner_id as string
    const bump = (a: Acc) => { if (isPlay) a.plays++; else a.failures++; a.people.add(id) }
    bump(overall)
    bump(byDay.get(e.occurred_at.slice(0, 10)) ?? byDay.set(e.occurred_at.slice(0, 10), acc()).get(e.occurred_at.slice(0, 10))!)
    const build = e.client_version || 'unknown'
    bump(byBuild.get(build) ?? byBuild.set(build, acc()).get(build)!)
    const device = e.device_type || 'unknown'
    bump(byDevice.get(device) ?? byDevice.set(device, acc()).get(device)!)
    if (new Date(e.occurred_at).getTime() >= dayAgo) {
      ;(lastDay.get(build) ?? lastDay.set(build, new Set()).get(build)!).add(id)
    }
  }

  const currentBuild = [...lastDay.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  return {
    people: overall.people.size,
    overall: finish(overall),
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, a]) => ({ day, ...finish(a) })),
    byBuild: [...byBuild.entries()].map(([build, a]) => ({ build, ...finish(a) })).sort((a, b) => b.people - a.people || b.plays - a.plays),
    byDevice: [...byDevice.entries()].map(([device, a]) => ({ device, ...finish(a) })).sort((a, b) => b.plays - a.plays),
    currentBuild,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7))

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const { realIds, count } = await resolveRealLearners(svc)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const events: EventRow[] = []
  let truncated = false
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await svc
      .from('player_events')
      .select('learner_id, event_type, client_version, device_type, ip_country, occurred_at')
      .in('event_type', ['audio_play', 'audio_failed'])
      .eq('env', 'production')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      res.status(500).json({ error: 'Could not read events' })
      return
    }
    const page = (data ?? []) as EventRow[]
    for (const e of page) {
      if (!e.learner_id || !realIds.has(e.learner_id)) continue
      if (isMachineEvent(e, realIds)) continue
      events.push(e)
    }
    if (page.length < PAGE) break
    if (from + PAGE >= MAX_ROWS) truncated = true
  }

  const body: WorkingResponse = {
    days,
    population: count,
    ...tallyWorking(events),
    truncated,
    countedAt: new Date().toISOString(),
  }
  res.status(200).json(body)
}
