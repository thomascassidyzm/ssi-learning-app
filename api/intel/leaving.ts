/**
 * GET /api/intel/leaving — question 2.
 *
 * "Who is about to leave, and who has already gone quiet?" One page for what
 * used to be Needs attention, the Lifecycle board, the Retention tabs and
 * part of the Discovery feed: people who were regular and have stopped,
 * subscribers with no practice, and trials ending — the list of who to write
 * to and why. It sends nothing; Resend sends.
 *
 * RANKED BY RECENCY AND REGULARITY, NOT BY VALUE. The design says "ranked by
 * how much we would lose", and no amount is stored anywhere in this
 * database — the subscriptions table carries state, never money. So the
 * ranking is what exists: how recently they were last seen, and how regular
 * they were before they stopped. The page says so in plain words rather
 * than inventing a value proxy.
 *
 * WHO IS ON IT. Real people only, through the one shared resolver. A person
 * appears when at least one of these is true:
 *   - REGULAR AND STOPPED: they practised on three or more distinct days in
 *     the four weeks before the last week, and not at all in the last week.
 *   - PAYING AND QUIET: a live subscription and no practice in the last
 *     seven days.
 *   - ENDING SOON: a subscription cancelling at period end, or a gift that
 *     runs out within fourteen days.
 * Each row carries every reason that applies, so the page never has to
 * choose one to show.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners } from '../_utils/realLearnerPopulation'
import { isPayingStatus } from '../_utils/entitlementCohort'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const DAY_MS = 86_400_000
/** Distinct practice days in the four weeks before the last week that make somebody "regular". */
export const REGULAR_DAYS = 3
/** A gift or period ending within this many days is "ending soon". */
export const ENDING_SOON_DAYS = 14

export type LeavingReason = 'regular-and-stopped' | 'paying-and-quiet' | 'ending-soon'

export interface LeavingRow {
  learnerId: string
  name: string | null
  email: string | null
  reasons: LeavingReason[]
  /** Days since they last practised, or null if never. */
  daysSincePractice: number | null
  /** Distinct days practised in the four weeks before the last week. */
  regularDays: number
  course: string | null
  /** ISO date a subscription period or a gift ends, when that is a reason. */
  endsAt: string | null
}

export interface LeavingResponse {
  population: number
  /** Real people who practised on any day in the last five weeks. */
  practisedRecently: number
  rows: LeavingRow[]
  counts: Record<LeavingReason, number>
  /** How long since each row's person practised, in week buckets, for the chart. */
  buckets: { label: string; people: number }[]
  countedAt: string
}

type SessionRow = { learner_id: string; course_id: string | null; started_at: string }

/**
 * The rule, as one pure function over one person's facts. Exported so the
 * test can prove each reason without a database.
 */
export function reasonsFor(
  f: {
    lastPracticed: number | null
    regularDays: number
    paying: boolean
    cancelling: boolean
    endsAt: number | null
  },
  now: number,
): LeavingReason[] {
  const reasons: LeavingReason[] = []
  const quietForAWeek = f.lastPracticed === null || now - f.lastPracticed > 7 * DAY_MS
  if (f.regularDays >= REGULAR_DAYS && quietForAWeek) reasons.push('regular-and-stopped')
  if (f.paying && quietForAWeek) reasons.push('paying-and-quiet')
  const endingSoon = f.endsAt !== null && f.endsAt > now && f.endsAt - now <= ENDING_SOON_DAYS * DAY_MS
  if (f.cancelling || endingSoon) reasons.push('ending-soon')
  return reasons
}

/** Most recently seen first; among equals, the more regular first. */
export function rankLeaving(a: LeavingRow, b: LeavingRow): number {
  const ra = a.daysSincePractice ?? Number.POSITIVE_INFINITY
  const rb = b.daysSincePractice ?? Number.POSITIVE_INFINITY
  return ra - rb || b.regularDays - a.regularDays || (a.name ?? '').localeCompare(b.name ?? '')
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

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const { realIds, count } = await resolveRealLearners(svc)
  const now = Date.now()
  const fiveWeeksAgo = new Date(now - 35 * DAY_MS).toISOString()
  const oneWeekAgo = now - 7 * DAY_MS

  const { data: sessions, error: sessionsError } = await svc
    .from('sessions')
    .select('learner_id, course_id, started_at')
    .gte('started_at', fiveWeeksAgo)
  if (sessionsError) {
    res.status(500).json({ error: 'Could not read practice' })
    return
  }

  // Per person: last practice, distinct practice days in weeks two to five,
  // and the course they were last in.
  const last = new Map<string, number>()
  const regularDays = new Map<string, Set<string>>()
  const lastCourse = new Map<string, string | null>()
  for (const s of (sessions ?? []) as SessionRow[]) {
    if (!realIds.has(s.learner_id)) continue
    const t = new Date(s.started_at).getTime()
    if (t > (last.get(s.learner_id) ?? 0)) {
      last.set(s.learner_id, t)
      lastCourse.set(s.learner_id, s.course_id)
    }
    if (t < oneWeekAgo) {
      let days = regularDays.get(s.learner_id)
      if (!days) { days = new Set(); regularDays.set(s.learner_id, days) }
      days.add(s.started_at.slice(0, 10))
    }
  }

  // The money side and the gift side, for everyone real — a paying person
  // who never practised is exactly who this page is for.
  const [{ data: subs }, { data: ents }] = await Promise.all([
    svc.from('subscriptions').select('learner_id, status, cancel_at_period_end, current_period_end'),
    svc.from('user_entitlements').select('learner_id, expires_at'),
  ])
  const paying = new Map<string, { cancelling: boolean; endsAt: number | null }>()
  for (const s of (subs ?? []) as { learner_id: string; status: string | null; cancel_at_period_end: boolean | null; current_period_end: string | null }[]) {
    if (!realIds.has(s.learner_id) || !isPayingStatus(s.status)) continue
    const endsAt = s.current_period_end ? new Date(s.current_period_end).getTime() : null
    paying.set(s.learner_id, { cancelling: !!s.cancel_at_period_end, endsAt })
  }
  const giftEnds = new Map<string, number>()
  for (const e of (ents ?? []) as { learner_id: string; expires_at: string | null }[]) {
    if (!realIds.has(e.learner_id) || !e.expires_at) continue
    const t = new Date(e.expires_at).getTime()
    if (t > now && t < (giftEnds.get(e.learner_id) ?? Number.POSITIVE_INFINITY)) giftEnds.set(e.learner_id, t)
  }

  const candidates = new Set<string>([...last.keys(), ...paying.keys(), ...giftEnds.keys()])
  const flagged: Omit<LeavingRow, 'name' | 'email'>[] = []
  for (const id of candidates) {
    const p = paying.get(id)
    const gift = giftEnds.get(id) ?? null
    const endsAt = p?.cancelling ? p.endsAt : gift
    const facts = {
      lastPracticed: last.get(id) ?? null,
      regularDays: regularDays.get(id)?.size ?? 0,
      paying: !!p,
      cancelling: !!p?.cancelling,
      endsAt: gift ?? p?.endsAt ?? null,
    }
    const reasons = reasonsFor(facts, now)
    if (!reasons.length) continue
    const lp = last.get(id)
    flagged.push({
      learnerId: id,
      reasons,
      daysSincePractice: lp ? Math.floor((now - lp) / DAY_MS) : null,
      regularDays: facts.regularDays,
      course: lastCourse.get(id) ?? null,
      endsAt: reasons.includes('ending-soon') && endsAt ? new Date(endsAt).toISOString() : null,
    })
  }

  // Names and a primary email, only for the people on the list.
  const ids = flagged.map((r) => r.learnerId)
  const names = new Map<string, string | null>()
  const emails = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const [{ data: ls }, { data: es }] = await Promise.all([
      svc.from('learners').select('id, display_name').in('id', chunk),
      svc.from('learner_emails').select('learner_id, email, is_primary').in('learner_id', chunk).order('is_primary', { ascending: false }),
    ])
    for (const l of (ls ?? []) as { id: string; display_name: string | null }[]) names.set(l.id, l.display_name)
    for (const e of (es ?? []) as { learner_id: string; email: string | null }[]) if (!emails.has(e.learner_id)) emails.set(e.learner_id, e.email)
  }

  const rows: LeavingRow[] = flagged
    .map((r) => ({ ...r, name: names.get(r.learnerId) ?? null, email: emails.get(r.learnerId) ?? null }))
    .sort(rankLeaving)

  const counts: Record<LeavingReason, number> = { 'regular-and-stopped': 0, 'paying-and-quiet': 0, 'ending-soon': 0 }
  for (const r of rows) for (const reason of r.reasons) counts[reason] += 1

  const bucketDefs = [
    { label: 'gone a week', min: 7, max: 14 },
    { label: 'gone two weeks', min: 14, max: 21 },
    { label: 'gone three weeks', min: 21, max: 28 },
    { label: 'gone a month or more', min: 28, max: Number.POSITIVE_INFINITY },
    { label: 'never practised', min: null, max: null },
  ]
  const buckets = bucketDefs.map((b) => ({
    label: b.label,
    people: rows.filter((r) =>
      b.min === null ? r.daysSincePractice === null : r.daysSincePractice !== null && r.daysSincePractice >= b.min && r.daysSincePractice < (b.max as number),
    ).length,
  }))

  const body: LeavingResponse = {
    population: count,
    practisedRecently: last.size,
    rows: rows.slice(0, 200),
    counts,
    buckets,
    countedAt: new Date().toISOString(),
  }
  res.status(200).json(body)
}
