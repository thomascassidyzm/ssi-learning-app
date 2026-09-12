/**
 * GET /api/intel/where-and-what?days=<n> — question 8.
 *
 * "Where in the world are people using us, and on what?" Devices and
 * territories, one question because they are always asked together. Every
 * event is stamped at the edge with the country it came from, the form
 * factor of the device — phone, tablet or desktop — and, since the
 * app_shell column was applied live on 2026-09-10, whether the session ran
 * in a browser or inside the native shell. The three axes are counted here
 * as distinct real people over a window, country by country, with the
 * device and shell split inside each country.
 *
 * COUNTED OVER REAL PEOPLE, LIKE EVERY OTHER NUMBER HERE. The one shared
 * resolver applies and the machine countries are dropped by rule.
 *
 * WHAT IS READ. Every production event in the window except the per-cycle
 * firehose — audio plays, audio failures, listening ticks and prosody
 * samples — which is five sixths of the rows and adds no person the other
 * events do not already carry: nobody plays audio without also tapping play,
 * completing a round or choosing a mode in the same session. That keeps a
 * thirty-day read under the same row cap the sibling endpoints use, and
 * truncation is reported rather than hidden.
 *
 * A person seen on two devices, or in two countries, counts once in the
 * headline and once in each cell they appear in. The cells are where people
 * were, not a partition of them.
 *
 * SHELL IS YOUNG. Rows written before 2026-09-10 carry no shell and are
 * counted as "not recorded" rather than guessed at as web. The response
 * names the date so the page can say so.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners, isMachineEvent } from '../_utils/realLearnerPopulation'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Same floor as weak-points and the Insight Engine: under it, the page says too few to say. */
export const K_FLOOR = 5
const PAGE = 1000
const MAX_ROWS = 60000

/** The day the app_shell column went live; rows before it carry no shell. */
export const SHELL_RECORDED_SINCE = '2026-09-10'

/** The per-cycle events that are left out of the read. See the header. */
export const FIREHOSE_EVENTS = ['audio_play', 'audio_failed', 'listening_tick', 'cycle_prosody'] as const

export type Device = 'mobile' | 'tablet' | 'desktop' | 'unknown'
export type Shell = 'web' | 'webview' | 'unknown'

export interface CountryRow {
  /** ISO 3166 alpha-2 as the edge stamps it, or 'unknown'. */
  country: string
  people: number
  byDevice: Record<Device, number>
  byShell: Record<Shell, number>
}

export interface WhereAndWhatResponse {
  days: number
  population: number
  /** Distinct real people with any counted event in the window. */
  people: number
  /** Countries with at least one real person, machine countries excluded. */
  countries: number
  rows: CountryRow[]
  devices: { device: Device; people: number }[]
  shells: { shell: Shell; people: number }[]
  shellRecordedSince: string
  kFloor: number
  /** True when fewer than K_FLOOR real people were seen at all. */
  tooFewToSay: boolean
  truncated: boolean
  countedAt: string
}

export type EventRow = {
  learner_id: string | null
  device_type: string | null
  app_shell: string | null
  ip_country: string | null
}

const DEVICES: Device[] = ['mobile', 'tablet', 'desktop', 'unknown']
const SHELLS: Shell[] = ['web', 'webview', 'unknown']

function asDevice(v: string | null): Device {
  return v === 'mobile' || v === 'tablet' || v === 'desktop' ? v : 'unknown'
}
function asShell(v: string | null): Shell {
  return v === 'web' || v === 'webview' ? v : 'unknown'
}

type Cell = { people: Set<string>; byDevice: Record<Device, Set<string>>; byShell: Record<Shell, Set<string>> }
const cell = (): Cell => ({
  people: new Set(),
  byDevice: { mobile: new Set(), tablet: new Set(), desktop: new Set(), unknown: new Set() },
  byShell: { web: new Set(), webview: new Set(), unknown: new Set() },
})

/** The pure tally over already-filtered events, so the test needs no database. */
export function tallyWhereAndWhat(events: EventRow[]) {
  const all = new Set<string>()
  const byCountry = new Map<string, Cell>()
  const byDevice: Record<Device, Set<string>> = { mobile: new Set(), tablet: new Set(), desktop: new Set(), unknown: new Set() }
  const byShell: Record<Shell, Set<string>> = { web: new Set(), webview: new Set(), unknown: new Set() }

  for (const e of events) {
    if (!e.learner_id) continue
    const id = e.learner_id
    const country = (e.ip_country || 'unknown').toUpperCase() === 'UNKNOWN' ? 'unknown' : (e.ip_country as string).toUpperCase()
    const device = asDevice(e.device_type)
    const shell = asShell(e.app_shell)
    all.add(id)
    byDevice[device].add(id)
    byShell[shell].add(id)
    const c = byCountry.get(country) ?? byCountry.set(country, cell()).get(country)!
    c.people.add(id)
    c.byDevice[device].add(id)
    c.byShell[shell].add(id)
  }

  const size = <K extends string>(r: Record<K, Set<string>>, keys: K[]) =>
    Object.fromEntries(keys.map((k) => [k, r[k].size])) as Record<K, number>

  const rows: CountryRow[] = [...byCountry.entries()]
    .map(([country, c]) => ({ country, people: c.people.size, byDevice: size(c.byDevice, DEVICES), byShell: size(c.byShell, SHELLS) }))
    // Most people first; a country nobody could place goes last whatever its size.
    .sort((a, b) => Number(a.country === 'unknown') - Number(b.country === 'unknown') || b.people - a.people || a.country.localeCompare(b.country))

  return {
    people: all.size,
    countries: rows.filter((r) => r.country !== 'unknown').length,
    rows,
    devices: DEVICES.map((device) => ({ device, people: byDevice[device].size })).filter((d) => d.people > 0),
    shells: SHELLS.map((shell) => ({ shell, people: byShell[shell].size })).filter((s) => s.people > 0),
    tooFewToSay: all.size < K_FLOOR,
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
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30))

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const { realIds, count } = await resolveRealLearners(svc)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const events: EventRow[] = []
  let truncated = false
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await svc
      .from('player_events')
      .select('learner_id, device_type, app_shell, ip_country')
      .not('event_type', 'in', `(${FIREHOSE_EVENTS.join(',')})`)
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

  const body: WhereAndWhatResponse = {
    days,
    population: count,
    ...tallyWhereAndWhat(events),
    shellRecordedSince: SHELL_RECORDED_SINCE,
    kFloor: K_FLOOR,
    truncated,
    countedAt: new Date().toISOString(),
  }
  res.status(200).json(body)
}
