/**
 * GET /api/classes/:id/brain — THE CLASS'S BRAIN, for the Course journey card.
 *
 * The chunks of the course on a line in the order the course introduces them,
 * every cycle the class has played, and the four totals under them. The rules
 * live in _utils/classBrain.ts, which is the app implementation of the
 * replaying-brain specimen (docs/specimens/replaying-brain/).
 *
 * The unit is the CLASS: everything here is read from the class's own learner
 * account, which is what Play as class runs on. No pupil account is read, so
 * no pupil is behind any of it and nothing here can be broken out per pupil.
 *
 * Who may read: an ssi_admin, or anyone whose visible scope carries the class.
 *
 * The answer carries the WHOLE stretch of the course the class has reached,
 * plus a little headroom. It used to carry only the last sixty chunks, which
 * kept the answer small by throwing the class's own past away; the card folds
 * the axis instead (Tom, 2026-09-17: "log-fold plus cloth"), so the past has
 * to be here for it to fold. Each event is still five short fields, so the
 * card can fetch it after the page has painted.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../../_utils/auth'
import { resolveVisibleScope } from '../../_utils/schoolScope'
import { applyCors } from '../../_utils/cors'
import { inAppSecondsByLearner, secondsToMinutesUp } from '../../_utils/inAppTime'
import { buildBrain, chooseAxis, phraseIdFromCycleId, type PlayRow, type PhraseRow } from '../../_utils/classBrain'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** How far back the brain reads. A class account's diary is small; this is one learner. */
export const BRAIN_WINDOW_DAYS = 180
/** PostgREST caps one response at 1,000 rows. */
const PAGE = 1000
const MAX_PAGES = 12
/**
 * A ceiling on the answer, not a lens. The card folds whatever it is sent, so
 * this only exists to bound the response for a class deeper into a course than
 * anything that has yet been built; past it the oldest chunks give way.
 */
const MAX_AXIS = 2000

interface AxisLego { id: string; seed: number; t: string; k: string }

async function readAllLegos(svc: SupabaseClient, courseCode: string): Promise<{ id: string; seed: number; index: number; t: string; k: string }[]> {
  const out: { id: string; seed: number; index: number; t: string; k: string }[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await svc
      .from('course_legos')
      .select('lego_id, seed_number, lego_index, target_text, known_text')
      .eq('course_code', courseCode)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    const rows = data ?? []
    for (const r of rows) {
      out.push({
        id: String((r as any).lego_id),
        seed: Number((r as any).seed_number) || 0,
        index: Number((r as any).lego_index) || 0,
        t: String((r as any).target_text || ''),
        k: String((r as any).known_text || ''),
      })
    }
    if (rows.length < PAGE) break
  }
  return out
}

/** A diary row as the brain reads it: the play fields, plus a belt_skip's own destination. */
interface DiaryRow extends PlayRow { target_seed: number | null }

/**
 * The class's diary, NEWEST-FIRST and capped — then handed back in time order.
 *
 * The cap is real: a class deeper than 12,000 rows has to lose something. It
 * loses its PAST, never its frontier. Reading ascending lost the opposite end
 * — the deepest real class carries 30,482 rows, so the card was drawn from its
 * first fortnight and showed nothing of where it is now.
 */
export async function readDiary(svc: SupabaseClient, learnerId: string, sinceIso: string): Promise<DiaryRow[]> {
  const out: DiaryRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await svc
      .from('player_events')
      .select('event_type, occurred_at, payload')
      .eq('learner_id', learnerId)
      .in('event_type', ['audio_play', 'audio_failed', 'belt_skip', 'lego_skip'])
      .gte('occurred_at', sinceIso)
      .order('occurred_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    const rows = data ?? []
    for (const r of rows) {
      const p = ((r as any).payload || {}) as Record<string, unknown>
      out.push({
        event_type: String((r as any).event_type),
        occurred_at: String((r as any).occurred_at),
        role: typeof p.role === 'string' ? p.role : null,
        lego_id: typeof p.legoId === 'string' ? p.legoId : typeof p.fromLegoId === 'string' ? p.fromLegoId : null,
        cycle_id: typeof p.cycleId === 'string' ? p.cycleId : null,
        target_seed: typeof p.targetSeed === 'number' && Number.isFinite(p.targetSeed) ? p.targetSeed : null,
      })
    }
    if (rows.length < PAGE) break
  }
  // Back into time order: the brain pairs each target1 with the target2 that
  // follows it, and reads its sittings off the run.
  out.reverse()
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!supabaseUrl || !supabaseServiceKey) { res.status(500).json({ error: 'Server misconfigured' }); return }

  const classId = String(req.query.id || '').trim()
  if (!classId) { res.status(400).json({ error: 'Class id required' }); return }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  try {
    const adminResult = await verifyAdmin(req)
    let authUid: string | null = null
    let isAdmin = false
    if (!('error' in adminResult)) { isAdmin = true; authUid = adminResult.userId }
    else if (adminResult.userId) authUid = adminResult.userId
    else {
      const auth = await verifyAuthToken(req)
      if (!auth.valid || !auth.userId) { res.status(401).json({ error: auth.error || 'Unauthorized' }); return }
      authUid = auth.userId
    }

    const { data: cls } = await svc
      .from('classes')
      .select('id, class_name, course_code, class_learner_id')
      .eq('id', classId)
      .maybeSingle()
    if (!cls) { res.status(404).json({ error: 'Not found' }); return }
    if (!isAdmin) {
      const scope = await resolveVisibleScope(svc, authUid!)
      if (!scope.classIds.includes(classId)) { res.status(403).json({ error: 'That class is outside your visible scope' }); return }
    }

    const courseCode = String((cls as any).course_code || '')
    const classLearnerId = (cls as any).class_learner_id as string | null
    const empty = {
      courseCode,
      legos: [] as AxisLego[],
      legosTotal: 0,
      axisFrom: 0,
      events: [],
      sittings: [],
      phrases: {},
      tally: { total: 0, hearings: 0, detoured: 0, intro: 0, debut: 0, build: 0, use: 0, other: 0 },
      introducedCount: 0,
      distinctPhrases: 0,
      minutes: 0,
      reachedSeed: 0,
      reachedSeedText: null as { t: string; k: string } | null,
      seedsTotal: 0,
      windowDays: BRAIN_WINDOW_DAYS,
    }
    // A class that has never pressed Play as class has no account of its own,
    // so there is nothing to draw. The card says so in words.
    if (!classLearnerId || !courseCode) { res.setHeader('Cache-Control', 'no-store'); res.status(200).json(empty); return }

    const sinceIso = new Date(Date.now() - BRAIN_WINDOW_DAYS * 86400000).toISOString()
    const [legos, diary] = await Promise.all([readAllLegos(svc, courseCode), readDiary(svc, classLearnerId, sinceIso)])
    if (legos.length === 0) { res.setHeader('Cache-Control', 'no-store'); res.status(200).json(empty); return }

    const ordinalOf = new Map<string, number>()
    const seedOf = new Map<string, number>()
    legos.forEach((l, i) => { ordinalOf.set(l.id, i); seedOf.set(l.id, l.seed) })

    // The phrases behind the cycles played — read by the ids the diary names,
    // never the whole course.
    const cycleIds = new Set<string>()
    for (const r of diary) if (r.cycle_id) cycleIds.add(r.cycle_id)
    const phraseIds = new Set<string>()
    // One parser, shared with the brain — so the rows read here and the rows
    // the brain looks up can never be a different set.
    for (const c of cycleIds) {
      const id = phraseIdFromCycleId(c, courseCode)
      if (id) phraseIds.add(id)
    }
    const phrases = new Map<string, PhraseRow>()
    const ids = [...phraseIds]
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await svc
        .from('course_practice_phrases')
        .select('id, target_text, known_text, phrase_role, position, lego_id, decomposition')
        .in('id', ids.slice(i, i + 200))
      for (const r of data ?? []) phrases.set(String((r as any).id), r as unknown as PhraseRow)
    }

    const skips = diary
      .filter((r) => r.event_type === 'belt_skip' || r.event_type === 'lego_skip')
      .map((r) => ({ occurred_at: r.occurred_at, event_type: r.event_type, target_seed: skipTargetSeed(r) }))
    const brain = buildBrain({ courseCode, rows: diary, skips, ordinalOf, seedOf, phrases })

    // THE AXIS. The whole course is thousands of chunks; the card gets the
    // stretch the class has actually played — from just before its first lit
    // chunk to just past its frontier. The rules are in chooseAxis.
    const { axisFrom, axisTo, reachOrd } = chooseAxis(legos.length, brain.events, MAX_AXIS)
    const reachedSeed = reachOrd >= 0 ? (legos[reachOrd]?.seed ?? 0) : 0

    let minutes = 0
    try {
      const secs = await inAppSecondsByLearner(svc, [classLearnerId], sinceIso)
      minutes = secondsToMinutesUp(secs.get(classLearnerId) || 0)
    } catch (e) {
      // The minutes tile is the only thing that needs this read; a slow diary
      // must never cost the drawing. It shows a dash.
      console.warn('[class-brain] in-app minutes unavailable:', e)
      minutes = -1
    }

    let reachedSeedText: { t: string; k: string } | null = null
    if (reachedSeed > 0) {
      const { data: seedRow } = await svc
        .from('course_seeds')
        .select('target_text, known_text')
        .eq('course_code', courseCode)
        .eq('seed_number', reachedSeed)
        .maybeSingle()
      if (seedRow) reachedSeedText = { t: String((seedRow as any).target_text || ''), k: String((seedRow as any).known_text || '') }
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      courseCode,
      legos: legos.slice(axisFrom, axisTo).map((l) => ({ id: l.id, seed: l.seed, t: l.t, k: l.k })),
      legosTotal: legos.length,
      axisFrom,
      events: brain.events,
      sittings: brain.sittings,
      phrases: brain.phraseText,
      tally: brain.tally,
      introducedCount: brain.introducedCount,
      distinctPhrases: brain.distinctPhrases,
      minutes,
      reachedSeed,
      reachedSeedText,
      seedsTotal: legos.length ? legos[legos.length - 1].seed : 0,
      windowDays: BRAIN_WINDOW_DAYS,
    })
  } catch (err) {
    console.error('[class-brain] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * belt_skip carries its destination on its own payload (`targetSeed`).
 * lego_skip never does — the player logs only where it skipped FROM — so its
 * destination is derived from the next play, in _utils/classBrain.ts.
 */
function skipTargetSeed(r: DiaryRow): number | null {
  return r.event_type === 'belt_skip' ? r.target_seed : null
}
