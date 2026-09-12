/**
 * DIARY SESSION ROWS — whole-class play as rate-compare session rows.
 *
 * The rate comparison (api/_utils/rateCompare.ts, drawn by the Insight Engine
 * on every node insights page) reads `ScopedSessionRow`s from the
 * `analytics_class_sessions_scoped` RPC, a view over `class_sessions`. Nothing
 * has written `class_sessions` since the play-as-class re-anchor of
 * 2026-08-19 (see _utils/classPractice.ts), so a real school that plays from
 * the front, Ysgol Cas-gwent with 34 classes and 1,784 class-account diary
 * events in the last 30 days, read "No practice recorded below this level"
 * while a demo programme with seeded `class_sessions` rows read everything.
 * Tom, 2026-09-11: "the data IS all there it's just the idiocy of what we've
 * chosen to show."
 *
 * This module derives the SAME row shape from the diary (`player_events`) for
 * each class's own account (`classes.class_learner_id`), so the shared rate
 * math and the widgets that draw it need no change:
 *
 *   - one row per in-app BLOCK, sessionised by the one rule in
 *     _utils/inAppTime.ts (five-minute idle cutoff, three-hour cap) so the
 *     minutes measure equals the in-app minutes every other school surface
 *     shows;
 *   - the block's start LEGO is the first LEGO the class heard in it and its
 *     end LEGO is the furthest, by the same course ordinal (seed_number,
 *     lego_index) the RPC assigns, so "LEGOs travelled" means the same thing
 *     for a class account as it did for a class_sessions row;
 *   - the block's course is the one its clips were on; a block with no course
 *     falls back to the class's own.
 *
 * `loadScopedSessionRows` is the one entry point: the legacy RPC rows (demo
 * seeds, and real history before the re-anchor) UNION the diary rows. A class
 * account did not exist before 2026-08-19 and class_sessions has not been
 * written since, so the two sources never describe the same lesson twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'
import { IDLE_CUTOFF_SECONDS, BLOCK_CAP_SECONDS } from './inAppTime'
import type { ScopedSessionRow } from './rateCompare'

/** PostgREST caps a single response at 1,000 rows; page every read. */
const PAGE = 1000
const DIARY_MAX_PAGES = 50
const LEGO_MAX_PAGES = 10

export interface DiaryEvent {
  learner_id: string
  occurred_at: string
  course_code: string | null
  /** `payload->>legoId`, present on clip and round events, null on the rest. */
  lego: string | null
}

export interface DiaryClass {
  id: string
  course_code: string | null
  class_learner_id: string | null
}

/** course_code → lego_id → 1-based ordinal (seed_number, lego_index order). */
export type LegoOrdinals = Map<string, Map<string, number>>

/**
 * Pure: session rows from one window's diary events. Exported so the rule is
 * testable without a database.
 */
export function sessionRowsFromDiary(
  events: DiaryEvent[],
  classes: DiaryClass[],
  ordinals: LegoOrdinals,
  opts: { idleCutoffSeconds?: number; blockCapSeconds?: number } = {},
): ScopedSessionRow[] {
  const idle = (opts.idleCutoffSeconds ?? IDLE_CUTOFF_SECONDS) * 1000
  const cap = (opts.blockCapSeconds ?? BLOCK_CAP_SECONDS) * 1000
  const classByLearner = new Map<string, DiaryClass>()
  for (const c of classes) if (c.class_learner_id) classByLearner.set(c.class_learner_id, c)

  const byLearner = new Map<string, (DiaryEvent & { t: number })[]>()
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime()
    if (!Number.isFinite(t) || !classByLearner.has(e.learner_id)) continue
    if (!byLearner.has(e.learner_id)) byLearner.set(e.learner_id, [])
    byLearner.get(e.learner_id)!.push({ ...e, t })
  }

  const out: ScopedSessionRow[] = []
  for (const [learnerId, evs] of byLearner) {
    const cls = classByLearner.get(learnerId)!
    evs.sort((a, b) => a.t - b.t)
    let block: (DiaryEvent & { t: number })[] = []
    const flush = () => {
      if (block.length === 0) return
      const first = block[0].t
      const last = block[block.length - 1].t
      const courseVotes = new Map<string, number>()
      for (const e of block) if (e.course_code) courseVotes.set(e.course_code, (courseVotes.get(e.course_code) || 0) + 1)
      let course: string | null = cls.course_code
      let best = 0
      for (const [code, n] of courseVotes) if (n > best) { best = n; course = code }
      const ords = course ? ordinals.get(course) : undefined
      let startLego: string | null = null
      let startOrd: number | null = null
      let endLego: string | null = null
      let endOrd: number | null = null
      for (const e of block) {
        if (!e.lego) continue
        const ord = ords?.get(e.lego) ?? null
        if (startLego === null) { startLego = e.lego; startOrd = ord }
        if (ord !== null && (endOrd === null || ord > endOrd)) { endLego = e.lego; endOrd = ord }
      }
      if (endLego === null) { endLego = startLego; endOrd = startOrd }
      out.push({
        class_id: cls.id,
        course_code: course,
        start_lego_id: startLego,
        end_lego_id: endLego,
        start_ord: startOrd,
        end_ord: endOrd,
        duration_seconds: Math.round(Math.min(last - first, cap) / 1000),
        started_at: new Date(first).toISOString(),
      })
      block = []
    }
    for (const e of evs) {
      if (block.length > 0 && e.t - block[block.length - 1].t > idle) flush()
      block.push(e)
    }
    flush()
  }
  return out
}

/** The RPC's ordinal: ROW_NUMBER over course_legos by (seed_number, lego_index) within a course. */
export async function loadLegoOrdinals(svc: SupabaseClient, courseCodes: string[]): Promise<LegoOrdinals> {
  const out: LegoOrdinals = new Map()
  await Promise.all(
    [...new Set(courseCodes.filter(Boolean))].map(async (code) => {
      const m = new Map<string, number>()
      let ord = 0
      for (let page = 0; page < LEGO_MAX_PAGES; page++) {
        const { data } = await svc
          .from('course_legos')
          .select('lego_id, seed_number, lego_index')
          .eq('course_code', code)
          .order('seed_number', { ascending: true })
          .order('lego_index', { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1)
        const rows = data ?? []
        for (const r of rows) m.set(String((r as any).lego_id), ++ord)
        if (rows.length < PAGE) break
      }
      out.set(code, m)
    }),
  )
  return out
}

/**
 * Session rows off the diary for the given classes' own accounts over the last
 * `days`. Classes under a demo school are dropped unless `includeDemo`, the
 * same world rule the RPC applies; a school-less class is real.
 */
export async function loadDiarySessionRows(
  svc: SupabaseClient,
  classIds: string[],
  days: number,
  includeDemo: boolean,
  now: number = Date.now(),
): Promise<ScopedSessionRow[]> {
  if (classIds.length === 0) return []
  const classes: (DiaryClass & { school_id: string | null })[] = []
  await Promise.all(
    chunk(classIds).map(async (batch) => {
      const { data } = await svc.from('classes').select('id, course_code, class_learner_id, school_id').in('id', batch)
      for (const r of data ?? []) classes.push(r as any)
    }),
  )
  let kept = classes
  if (!includeDemo) {
    const schoolIds = [...new Set(classes.map((c) => c.school_id).filter((id): id is string => !!id))]
    const demo = new Set<string>()
    await Promise.all(
      chunk(schoolIds).map(async (batch) => {
        const { data } = await svc.from('schools').select('id, is_demo').in('id', batch)
        for (const s of data ?? []) if ((s as any).is_demo) demo.add(String((s as any).id))
      }),
    )
    kept = classes.filter((c) => !c.school_id || !demo.has(c.school_id))
  }
  const learnerIds = kept.map((c) => c.class_learner_id).filter((id): id is string => !!id)
  if (learnerIds.length === 0) return []

  const sinceIso = new Date(now - Math.max(days, 1) * 86_400_000).toISOString()
  const events: DiaryEvent[] = []
  await Promise.all(
    chunk(learnerIds).map(async (batch) => {
      for (let page = 0; page < DIARY_MAX_PAGES; page++) {
        const { data } = await svc
          .from('player_events')
          .select('learner_id, occurred_at, course_code, lego:payload->>legoId')
          .in('learner_id', batch)
          .gte('occurred_at', sinceIso)
          .order('occurred_at', { ascending: true })
          .order('id', { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1)
        const rows = data ?? []
        for (const r of rows) {
          events.push({
            learner_id: String((r as any).learner_id),
            occurred_at: String((r as any).occurred_at),
            course_code: ((r as any).course_code as string | null) ?? null,
            lego: ((r as any).lego as string | null) ?? null,
          })
        }
        if (rows.length < PAGE) break
      }
    }),
  )
  if (events.length === 0) return []
  const courses = new Set<string>()
  for (const e of events) if (e.course_code) courses.add(e.course_code)
  for (const c of kept) if (c.course_code) courses.add(c.course_code)
  const ordinals = await loadLegoOrdinals(svc, [...courses])
  return sessionRowsFromDiary(events, kept, ordinals)
}

/**
 * THE ONE READ for rate-compare rows: legacy RPC rows plus diary rows, in the
 * `{ data, error }` shape the RPC call sites already handle.
 */
export async function loadScopedSessionRows(
  svc: SupabaseClient,
  classIds: string[],
  days: number,
  includeDemo: boolean,
  now: number = Date.now(),
): Promise<{ data: ScopedSessionRow[]; error: { message: string } | null }> {
  const [rpc, diary] = await Promise.all([
    svc.rpc('analytics_class_sessions_scoped', { p_class_ids: classIds, p_days: days, p_include_demo: includeDemo }),
    loadDiarySessionRows(svc, classIds, days, includeDemo, now).catch((e: unknown) => {
      console.error('[diarySessionRows] diary read failed:', e instanceof Error ? e.message : e)
      return [] as ScopedSessionRow[]
    }),
  ])
  if (rpc.error) return { data: [], error: { message: rpc.error.message } }
  return { data: [...((rpc.data as ScopedSessionRow[]) || []), ...diary], error: null }
}
