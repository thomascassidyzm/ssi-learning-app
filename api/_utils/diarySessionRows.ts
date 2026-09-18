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
 *   - one row per play-to-stop SPAN, by the one rule in _utils/inAppTime.ts
 *     (Tom's ruling 2026-09-13: play to stop, closed at the last audio-ended
 *     point, tagged by mode) so the minutes measure equals the in-app
 *     minutes every other school surface and Intelligence show;
 *   - the block's start LEGO is the first LEGO the class heard in it and its
 *     end LEGO is the furthest, by the same course ordinal (seed_number,
 *     lego_index) the RPC assigns, so "LEGOs travelled" means the same thing
 *     for a class account as it did for a class_sessions row;
 *   - the block's course is the one its clips were on; a block with no course
 *     falls back to the class's own.
 *
 * `loadScopedSessionRows` uses the diary exclusively for classes with a class
 * account, matching Overview. The lesson recorder writes class_sessions again,
 * but those records describe the same practice, not additional minutes.
 * Legacy/demo classes without a class account retain their RPC history.
 *
 * EVERY READ IN HERE FAILS LOUDLY (job #180). A diary error throws
 * `DiaryReadError`, `loadScopedSessionRows` returns it in its `{ data, error }`
 * shape, and the rate-compare routes answer 500 — because an empty diary and a
 * broken diary look identical once the legacy rows are dropped, and the wrong
 * one of those reads to a school as "no practice".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'
import {
  DIARY_PLAY_SELECT,
  PLAY_EVENT_TYPES,
  sessioniseAll,
  spansFromDiary,
  toDiaryPlayRow,
  type DiaryPlayRow,
  type PlaySpan,
  type SessioniseOptions,
} from './inAppTime'
import type { ScopedSessionRow } from './rateCompare'

/** PostgREST caps a single response at 1,000 rows; page every read. */
const PAGE = 1000
const DIARY_MAX_PAGES = 50
const LEGO_MAX_PAGES = 10

/**
 * A diary read that FAILED — never an empty window. Before job #180 every
 * read in this module discarded its `error` and `loadScopedSessionRows`
 * swallowed a rejection into `[]`, so a PostgREST timeout on `player_events`
 * read as "this class practised for zero minutes" — and since job #170 drops
 * the legacy RPC rows for any class with a class account, nothing masked it.
 * A read that failed must say so; understating a real school's minutes is
 * worse than an error.
 */
export class DiaryReadError extends Error {
  constructor(where: string, message: string) {
    super(`diary read failed (${where}): ${message}`)
    this.name = 'DiaryReadError'
  }
}

/** Throw on a PostgREST error, naming the read that failed. */
function assertOk(where: string, error: { message: string } | null | undefined): void {
  if (error) throw new DiaryReadError(where, error.message)
}

/**
 * A diary row as this module reads it: the minute rule's fields (see
 * DIARY_PLAY_SELECT — event_type, cycleType, elapsedMs, durationMs, url) plus
 * the LEGO the clip was on. A row without an event_type the rule reads is
 * ignored, exactly as inAppTime.ts ignores it.
 */
export interface DiaryEvent {
  learner_id: string
  occurred_at: string
  course_code: string | null
  /** `payload->>legoId`, present on clip and round events, null on the rest. */
  lego: string | null
  event_type?: string
  ct?: string | null
  elapsed?: string | number | null
  duration?: string | number | null
  speed?: string | number | null
  url?: string | null
  payload?: Record<string, unknown> | null
}

export interface DiaryClass {
  id: string
  course_code: string | null
  class_learner_id: string | null
}

/** course_code → lego_id → 1-based ordinal (seed_number, lego_index order). */
export type LegoOrdinals = Map<string, Map<string, number>>

type TimedEvent = DiaryEvent & { t: number }

/** Group a class account's events by learner id, keeping only class accounts. */
function eventsByClassAccount(
  events: DiaryEvent[],
  classes: DiaryClass[],
  extraLearnerClasses?: Map<string, DiaryClass>,
): { classByLearner: Map<string, DiaryClass>; byLearner: Map<string, TimedEvent[]> } {
  const classByLearner = new Map<string, DiaryClass>()
  for (const c of classes) if (c.class_learner_id) classByLearner.set(c.class_learner_id, c)
  // Pupils' own accounts, each attributed to the class they belong to (job
  // #989's Y). A pupil in two classes is attributed to whichever the caller's
  // map named first — their minutes are counted once, never doubled.
  if (extraLearnerClasses) for (const [lid, c] of extraLearnerClasses) if (!classByLearner.has(lid)) classByLearner.set(lid, c)
  const byLearner = new Map<string, TimedEvent[]>()
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime()
    if (!Number.isFinite(t) || !classByLearner.has(e.learner_id)) continue
    if (!byLearner.has(e.learner_id)) byLearner.set(e.learner_id, [])
    byLearner.get(e.learner_id)!.push({ ...e, t })
  }
  for (const evs of byLearner.values()) evs.sort((a, b) => a.t - b.t)
  return { classByLearner, byLearner }
}

/**
 * Pure: one rate-compare row per play-to-stop SPAN (the one rule,
 * inAppTime.ts), for one class account. The span's LEGOs are the clips that
 * fell inside it: start = the first LEGO heard, end = the furthest by course
 * ordinal. Its course is the span's own (majority of its clips), else the
 * class's. Main-flow and Listening Mode spans are both rows: a whole-class
 * listening session is class practice.
 */
export function sessionRowsFromSpans(
  spans: PlaySpan[],
  events: TimedEvent[],
  cls: DiaryClass,
  ordinals: LegoOrdinals,
  actor: 'class' | 'pupil' = 'class',
): ScopedSessionRow[] {
  const out: ScopedSessionRow[] = []
  const SLACK = 1000
  for (const s of spans) {
    const course = s.course ?? cls.course_code
    const ords = course ? ordinals.get(course) : undefined
    let startLego: string | null = null
    let startOrd: number | null = null
    let endLego: string | null = null
    let endOrd: number | null = null
    for (const e of events) {
      if (e.t < s.startMs - SLACK) continue
      if (e.t > s.endMs + SLACK) break
      if (!e.lego) continue
      const ord = ords?.get(e.lego) ?? null
      if (startLego === null) { startLego = e.lego; startOrd = ord }
      if (ord !== null && (endOrd === null || ord > endOrd)) { endLego = e.lego; endOrd = ord }
    }
    if (endLego === null) { endLego = startLego; endOrd = startOrd }
    out.push({
      class_id: cls.id,
      actor,
      course_code: course,
      start_lego_id: startLego,
      end_lego_id: endLego,
      start_ord: startOrd,
      end_ord: endOrd,
      duration_seconds: s.seconds,
      started_at: new Date(s.startMs).toISOString(),
    })
  }
  return out
}

/**
 * Pure: session rows from one window's diary events, no database — the
 * closing clip of a span is not resolved through course_audio here (see
 * loadDiarySessionRows for the read that does). Exported so the rule is
 * testable.
 */
export function sessionRowsFromDiary(
  events: DiaryEvent[],
  classes: DiaryClass[],
  ordinals: LegoOrdinals,
  opts: SessioniseOptions = {},
): ScopedSessionRow[] {
  const { classByLearner, byLearner } = eventsByClassAccount(events, classes)
  const out: ScopedSessionRow[] = []
  for (const [learnerId, evs] of byLearner) {
    const rows = evs.map((e) => toDiaryPlayRow(e as unknown as Record<string, unknown>)).filter((r): r is DiaryPlayRow => !!r)
    out.push(...sessionRowsFromSpans(spansFromDiary(rows, opts), evs, classByLearner.get(learnerId)!, ordinals))
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
        const { data, error } = await svc
          .from('course_legos')
          .select('lego_id, seed_number, lego_index')
          .eq('course_code', code)
          .order('seed_number', { ascending: true })
          .order('lego_index', { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1)
        assertOk('course_legos', error)
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
  opts: { includePupils?: boolean } = {},
): Promise<ScopedSessionRow[]> {
  if (classIds.length === 0) return []
  const classes: (DiaryClass & { school_id: string | null })[] = []
  await Promise.all(
    chunk(classIds).map(async (batch) => {
      const { data, error } = await svc.from('classes').select('id, course_code, class_learner_id, school_id').in('id', batch)
      assertOk('classes', error)
      for (const r of data ?? []) classes.push(r as any)
    }),
  )
  let kept = classes
  if (!includeDemo) {
    const schoolIds = [...new Set(classes.map((c) => c.school_id).filter((id): id is string => !!id))]
    const demo = new Set<string>()
    await Promise.all(
      chunk(schoolIds).map(async (batch) => {
        const { data, error } = await svc.from('schools').select('id, is_demo').in('id', batch)
        assertOk('schools', error)
        for (const s of data ?? []) if ((s as any).is_demo) demo.add(String((s as any).id))
      }),
    )
    kept = classes.filter((c) => !c.school_id || !demo.has(c.school_id))
  }
  const classLearnerIds = kept.map((c) => c.class_learner_id).filter((id): id is string => !!id)
  // Y — the pupils' OWN accounts on these classes, read only when asked for
  // (job #989's week card). Every other caller pays nothing for it.
  const pupilByLearner = opts.includePupils ? await pupilLearnersByClass(svc, kept) : new Map<string, DiaryClass>()
  const learnerIds = [...new Set([...classLearnerIds, ...pupilByLearner.keys()])]
  if (learnerIds.length === 0) return []

  const sinceIso = new Date(now - Math.max(days, 1) * 86_400_000).toISOString()
  const events: DiaryEvent[] = []
  await Promise.all(
    chunk(learnerIds).map(async (batch) => {
      for (let page = 0; page < DIARY_MAX_PAGES; page++) {
        const { data, error } = await svc
          .from('player_events')
          .select(`${DIARY_PLAY_SELECT}, lego:payload->>legoId`)
          .in('learner_id', batch)
          .in('event_type', [...PLAY_EVENT_TYPES])
          .gte('occurred_at', sinceIso)
          .order('occurred_at', { ascending: true })
          .order('id', { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1)
        assertOk('player_events', error)
        const rows = data ?? []
        for (const r of rows) {
          events.push({
            ...(r as Record<string, unknown>),
            learner_id: String((r as any).learner_id),
            occurred_at: String((r as any).occurred_at),
            course_code: ((r as any).course_code as string | null) ?? null,
            lego: ((r as any).lego as string | null) ?? null,
          } as DiaryEvent)
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
  // The one rule, with each span's closing clip resolved through course_audio
  // in a single lookup (sessioniseAll) — the same read inAppTimeByLearner does.
  const { classByLearner, byLearner } = eventsByClassAccount(events, kept, pupilByLearner)
  const playRows = new Map<string, DiaryPlayRow[]>()
  for (const [lid, evs] of byLearner) {
    playRows.set(lid, evs.map((e) => toDiaryPlayRow(e as unknown as Record<string, unknown>)).filter((r): r is DiaryPlayRow => !!r))
  }
  const sessions = await sessioniseAll(svc, playRows)
  const classAccountIds = new Set(classLearnerIds)
  const out: ScopedSessionRow[] = []
  for (const [lid, evs] of byLearner) {
    out.push(...sessionRowsFromSpans(
      sessions.get(lid)?.spans ?? [], evs, classByLearner.get(lid)!, ordinals,
      classAccountIds.has(lid) ? 'class' : 'pupil',
    ))
  }
  return out
}

/**
 * PUPILS' OWN ACCOUNTS, per class — learner id → the class it belongs to.
 * Membership is `user_tags` CLASS:<id> with role_in_context 'student' (the
 * same read ownAccountLearners does for a whole scope), then user_id →
 * learners.id. Staff are deliberately out: Tom's Y is "individual students
 * time", and a teacher's own minutes are named separately on the teacher
 * home (class-practice-7d's callerOwn).
 */
export async function pupilLearnersByClass(
  svc: SupabaseClient,
  classes: DiaryClass[],
): Promise<Map<string, DiaryClass>> {
  const out = new Map<string, DiaryClass>()
  const byId = new Map(classes.map((c) => [c.id, c]))
  const ids = [...byId.keys()]
  if (ids.length === 0) return out
  const classByUid = new Map<string, DiaryClass>()
  await Promise.all(
    chunk(ids).map(async (batch) => {
      const { data, error } = await svc
        .from('user_tags')
        .select('user_id, tag_value')
        .eq('tag_type', 'class')
        .eq('role_in_context', 'student')
        .in('tag_value', batch.map((id) => `CLASS:${id}`))
        .is('removed_at', null)
      assertOk('user_tags', error)
      for (const r of data ?? []) {
        const uid = String((r as any).user_id || '')
        const cid = String((r as any).tag_value || '').replace(/^CLASS:/, '')
        const cls = byId.get(cid)
        if (uid && cls && !classByUid.has(uid)) classByUid.set(uid, cls)
      }
    }),
  )
  if (classByUid.size === 0) return out
  await Promise.all(
    chunk([...classByUid.keys()]).map(async (batch) => {
      const { data, error } = await svc.from('learners').select('id, user_id').in('user_id', batch)
      assertOk('learners', error)
      for (const r of data ?? []) {
        const lid = String((r as any).id || '')
        const cls = classByUid.get(String((r as any).user_id || ''))
        if (lid && cls) out.set(lid, cls)
      }
    }),
  )
  return out
}

/**
 * THE ONE READ for rate-compare rows: diary for class accounts, legacy RPC
 * rows only for classes without an account, in the
 * `{ data, error }` shape the RPC call sites already handle.
 */
export async function loadScopedSessionRows(
  svc: SupabaseClient,
  classIds: string[],
  days: number,
  includeDemo: boolean,
  now: number = Date.now(),
  opts: { includePupils?: boolean } = {},
): Promise<{ data: ScopedSessionRow[]; error: { message: string } | null }> {
  // Decide by account configuration, not by whether this window happens to
  // contain diary rows: a quiet window must not revive a duplicate source.
  const diaryClassIds = new Set<string>()
  for (const batch of chunk(classIds)) {
    const { data, error } = await svc.from('classes').select('id, class_learner_id').in('id', batch)
    if (error) return { data: [], error: { message: error.message } }
    for (const cls of data ?? []) if (cls.class_learner_id) diaryClassIds.add(cls.id)
  }
  // A diary failure is reported, never absorbed: the caller turns it into a
  // 5xx. Swallowing it here would understate a real school's minutes, and the
  // legacy rows that used to mask that are now deliberately dropped.
  const [rpc, diary] = await Promise.all([
    svc.rpc('analytics_class_sessions_scoped', { p_class_ids: classIds, p_days: days, p_include_demo: includeDemo }),
    loadDiarySessionRows(svc, classIds, days, includeDemo, now, opts).then(
      (rows) => ({ rows, error: null as { message: string } | null }),
      (e: unknown) => ({ rows: [] as ScopedSessionRow[], error: { message: e instanceof Error ? e.message : String(e) } }),
    ),
  ])
  if (rpc.error) return { data: [], error: { message: rpc.error.message } }
  if (diary.error) {
    console.error('[diarySessionRows] diary read failed:', diary.error.message)
    return { data: [], error: diary.error }
  }
  const legacy = ((rpc.data as ScopedSessionRow[]) || []).filter((row) => !diaryClassIds.has(row.class_id))
  return { data: [...legacy, ...diary.rows], error: null }
}
