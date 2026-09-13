/**
 * IN-APP TIME — THE ONE MINUTE DEFINITION, for every school surface and for
 * Intelligence at Everyone scope.
 *
 * Founder ruling, Tom 2026-09-13 (22:27Z, via RBF, verbatim): "a minute is
 * everything between user pressing play and user stopping play through
 * whatever screen hit combination. listening exercises play time ALSO count
 * ... we SHOULD be able to disambiguate listening minutes IN listening MODE,
 * from main-flow listening minutes." Agreed with him the same night: when no
 * stop ever arrives (phone locked, app killed), the span closes at the last
 * audio-ended event the player emitted, never at a timeout guess.
 *
 * This supersedes the rule of 2026-09-10 ("in-app time, because gap time is
 * important"), which sessionised ANY diary event with a five-minute idle
 * cut-off. Gap time still counts — the pause the learner speaks into is
 * inside the span — but a span is now PLAY TO STOP, tagged by mode, and the
 * idle cut-off is demoted to a guard against a corrupt or absent stop.
 *
 * WHICH ROWS OPEN A SPAN, WHICH CLOSE IT, in the schema as it is:
 *
 *   MAIN FLOW (LearningPlayer.vue)
 *     open   `tap_play` — the learner pressed play. A clip arriving with no
 *            span open ALSO opens one (a lock-screen resume calls
 *            simplePlayer.resume() and emits no tap).
 *     close  `tap_pause` — the learner stopped. Closed AT the tap when the
 *            tap is within the guard of the last audio-ended point, else at
 *            the last audio-ended point (a stop tapped an hour after the
 *            audio went quiet is not an hour of play).
 *     clips  `audio_play` rows. Main-flow CYCLE clips (cycleType build / use /
 *            spaced_rep / debut / intro) are logged at clip START; their end
 *            is occurred_at + durationMs / playbackSpeed, where `durationMs`
 *            is the clip's own length stamped on the row from build
 *            2026-09-13 on, else course_audio.duration_ms for the clip's
 *            audio id (looked up only for the clip that closes a span). Pod
 *            plays (cycleType pod_play / pod_intro / pod_outro) are logged at
 *            clip END with `elapsedMs`; a pod lap in the main flow is main-flow
 *            time.
 *
 *   LISTENING MODE (ListeningOverlay.vue) — no taps exist.
 *     open   the first `audio_play` with cycleType 'listening_mode' (logged at
 *            clip END with elapsedMs, so it starts at occurred_at − elapsedMs),
 *            or a `listening_tick` (30 s heartbeat, only while playing and
 *            visible) when no listening span is open.
 *     close  the last listening clip end or tick before a silence longer than
 *            the guard, before a main-flow row, or at the end of the diary.
 *     Per-clip Listening Mode rows exist on production from 2026-09-13
 *     (04:21Z) on; before that only the tick exists, so earlier Listening
 *     Mode minutes are tick-bounded — never invented — and undercount by up
 *     to 30 s at each end of a span. LISTENING_EXACT_FROM says so in words.
 *
 *   "LAST AUDIO-ENDED" concretely = the largest clip end (or tick) the span
 *   has seen. A mode switch closes the open span at that point and opens the
 *   other mode's span at the new clip's start.
 *
 *   NOTHING ELSE MOVES A SPAN. cold_start, cursor_move, round_complete,
 *   session_complete and the rest are evidence the app was alive, not that
 *   audio was playing; under Tom's ruling they neither open, extend nor
 *   close anything. (The 2026-09-10 rule counted them; that is the change.)
 *
 * GUARDS (dials, not rulings):
 *   IDLE_CUTOFF_SECONDS = 300 — a stop later than this after the last audio-
 *     ended point, or a next clip later than this, is a new span, not a
 *     continuation. Never adds time; only stops a missing stop from doing so.
 *   BLOCK_CAP_SECONDS = 3h — no span can be the 128-hour sitting of
 *     2026-08-19 (sessions.duration_seconds, never trusted again).
 *
 * WHO IS COUNTED. Any learner id — a person's own account or a class's own
 * account (classes.class_learner_id). A learner id is sessionised once, so a
 * student's own play and the class account's play can never double-count.
 *
 * TWO READS, ONE RULE. Per-learner-list callers (school surfaces) page the
 * diary through PostgREST; Intelligence at Everyone scope reads a whole
 * window through the `diary_play_rows` function (supabase/migrations/
 * 20260913_diary_play_rows.sql), which only SELECTS and PACKS — every rule is
 * `spansFromDiary` below, and only there.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'

export const IDLE_CUTOFF_SECONDS = 300
export const BLOCK_CAP_SECONDS = 3 * 3600
/** Per-clip Listening Mode rows began on production at this instant (job #339/#343). Before it, listening minutes are tick-bounded. */
export const LISTENING_EXACT_FROM = '2026-09-13T04:21:41Z'
/** The diary rows the minute rule reads. Everything else is ignored. */
export const PLAY_EVENT_TYPES = ['tap_play', 'tap_pause', 'audio_play', 'listening_tick'] as const
export const LISTENING_MODE_CYCLE_TYPE = 'listening_mode'
/** PostgREST caps a single response at 1,000 rows; page the diary read. */
const DIARY_PAGE = 1000
const DIARY_MAX_PAGES = 50
const AUDIO_LOOKUP_CHUNK = 200

export interface SessioniseOptions {
  idleCutoffSeconds?: number
  blockCapSeconds?: number
  /** course_audio.duration_ms by audio id, for start-logged clips that carry no durationMs. */
  durations?: ReadonlyMap<string, number>
}

export type PlayMode = 'main' | 'listening'

/** One diary row as the rule sees it. Built by `toDiaryPlayRow` from a PostgREST row or by `unpackDiaryPlayRows` from the packed read. */
export interface DiaryPlayRow {
  /** occurred_at, epoch ms. */
  t: number
  kind: 'tap_play' | 'tap_pause' | 'clip' | 'tick'
  /** Listening Mode clip or tick. */
  listening?: boolean
  /** End-logged clip (pods, Listening Mode): t is the END and the clip ran this long. */
  elapsedMs?: number | null
  /** Start-logged clip (main-flow cycles): t is the START and the clip lasts this long at 1x. */
  durationMs?: number | null
  playbackSpeed?: number | null
  /** Start-logged clip with no durationMs: the audio id to resolve against course_audio. */
  audioId?: string | null
  course?: string | null
}

export interface PlaySpan {
  startMs: number
  endMs: number
  mode: PlayMode
  seconds: number
  course: string | null
  clips: number
  openedBy: 'tap_play' | 'clip' | 'tick'
  /** 'tap_pause' = closed at the stop; the others = closed at the last audio-ended point. */
  closedBy: 'tap_pause' | 'silence' | 'mode_switch' | 'tap_play' | 'end_of_diary'
  /** Where the closing clip's end came from. 'unknown' = closed at that clip's start; `closerAudioId` says which clip to resolve. */
  closeClipEnd: 'tap' | 'elapsedMs' | 'durationMs' | 'course_audio' | 'tick' | 'unknown'
  closerAudioId: string | null
}

export interface DiarySessionisation {
  seconds: number
  mainSeconds: number
  listeningSeconds: number
  spans: PlaySpan[]
  /** Audio ids of span-closing clips whose end is unknown — resolve via course_audio and re-run. */
  unresolvedAudioIds: string[]
}

interface ClipBounds { start: number; end: number; endFrom: PlaySpan['closeClipEnd']; audioId: string | null }

function clipBounds(r: DiaryPlayRow, durations?: ReadonlyMap<string, number>): ClipBounds {
  if (r.kind === 'tick') return { start: r.t, end: r.t, endFrom: 'tick', audioId: null }
  if (r.elapsedMs != null && Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0) {
    return { start: r.t - r.elapsedMs, end: r.t, endFrom: 'elapsedMs', audioId: null }
  }
  const speed = r.playbackSpeed && r.playbackSpeed > 0 ? r.playbackSpeed : 1
  if (r.durationMs != null && Number.isFinite(r.durationMs) && r.durationMs >= 0) {
    return { start: r.t, end: r.t + r.durationMs / speed, endFrom: 'durationMs', audioId: null }
  }
  const known = r.audioId ? durations?.get(r.audioId) : undefined
  if (known != null && Number.isFinite(known) && known >= 0) {
    return { start: r.t, end: r.t + known / speed, endFrom: 'course_audio', audioId: null }
  }
  return { start: r.t, end: r.t, endFrom: 'unknown', audioId: r.audioId ?? null }
}

/**
 * THE RULE. Pure: play-to-stop spans from one learner's diary rows (any
 * order), each tagged main / listening. Exported so it is testable without a
 * database, and so that every reader of the diary shares it.
 */
export function spansFromDiary(rows: DiaryPlayRow[], opts: SessioniseOptions = {}): PlaySpan[] {
  const guard = (opts.idleCutoffSeconds ?? IDLE_CUTOFF_SECONDS) * 1000
  const cap = (opts.blockCapSeconds ?? BLOCK_CAP_SECONDS) * 1000
  const sorted = rows.filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t)
  const out: PlaySpan[] = []

  let open: {
    start: number
    lastEnd: number
    mode: PlayMode
    openedBy: PlaySpan['openedBy']
    lastEndFrom: PlaySpan['closeClipEnd']
    lastAudioId: string | null
    clips: number
    votes: Map<string, number>
  } | null = null

  const finish = (endMs: number, closedBy: PlaySpan['closedBy'], closeClipEnd?: PlaySpan['closeClipEnd']) => {
    if (!open) return
    const end = Math.min(Math.max(endMs, open.start), open.start + cap)
    let course: string | null = null
    let best = 0
    for (const [code, n] of open.votes) if (n > best) { best = n; course = code }
    const endFrom = closeClipEnd ?? open.lastEndFrom
    out.push({
      startMs: open.start,
      endMs: end,
      mode: open.mode,
      seconds: Math.round((end - open.start) / 1000),
      course,
      clips: open.clips,
      openedBy: open.openedBy,
      closedBy,
      closeClipEnd: endFrom,
      closerAudioId: endFrom === 'unknown' ? open.lastAudioId : null,
    })
    open = null
  }

  for (const r of sorted) {
    if (r.kind === 'tap_play') {
      // A play tap while a span is open: the stop was missed. Close at the
      // last audio-ended point — named 'tap_play' when the tap came within the
      // guard of it, 'silence' when the audio had long gone quiet.
      if (open) finish(Math.min(open.lastEnd, r.t), r.t <= open.lastEnd + guard ? 'tap_play' : 'silence')
      open = { start: r.t, lastEnd: r.t, mode: 'main', openedBy: 'tap_play', lastEndFrom: 'tap', lastAudioId: null, clips: 0, votes: new Map() }
      continue
    }
    if (r.kind === 'tap_pause') {
      if (!open) continue // a stop with nothing playing is nothing
      if (r.t <= open.lastEnd + guard) finish(r.t, 'tap_pause', 'tap')
      else finish(open.lastEnd, 'silence')
      continue
    }
    // clip or tick
    const mode: PlayMode = r.listening ? 'listening' : 'main'
    const b = clipBounds(r, opts.durations)
    if (open && open.mode !== mode) finish(Math.min(open.lastEnd, b.start), 'mode_switch')
    else if (open && b.start > open.lastEnd + guard) finish(open.lastEnd, 'silence')
    if (!open) {
      open = { start: b.start, lastEnd: b.start, mode, openedBy: r.kind === 'tick' ? 'tick' : 'clip', lastEndFrom: b.endFrom, lastAudioId: b.audioId, clips: 0, votes: new Map() }
    }
    if (b.end >= open.lastEnd) {
      open.lastEnd = b.end
      open.lastEndFrom = b.endFrom
      open.lastAudioId = b.audioId
    }
    if (r.kind === 'clip') open.clips++
    if (r.course) open.votes.set(r.course, (open.votes.get(r.course) || 0) + 1)
  }
  finish(open ? open.lastEnd : 0, 'end_of_diary')
  return out
}

/** Pure: seconds by mode plus the spans themselves, from one learner's rows. */
export function sessioniseDiary(rows: DiaryPlayRow[], opts: SessioniseOptions = {}): DiarySessionisation {
  const spans = spansFromDiary(rows, opts)
  let mainSeconds = 0
  let listeningSeconds = 0
  const unresolved = new Set<string>()
  for (const s of spans) {
    if (s.mode === 'listening') listeningSeconds += s.seconds
    else mainSeconds += s.seconds
    if (s.closerAudioId) unresolved.add(s.closerAudioId)
  }
  return { seconds: mainSeconds + listeningSeconds, mainSeconds, listeningSeconds, spans, unresolvedAudioIds: [...unresolved] }
}

/**
 * LEGACY ADAPTER — kept for callers that hold bare timestamps and no event
 * types (classProgressCopy). Each stamp is read as a zero-length main-flow
 * clip, which under the rule above degenerates to exactly the 2026-09-10
 * behaviour: consecutive stamps within the guard form one span worth last
 * minus first. Prefer sessioniseDiary wherever the rows carry their type.
 */
export function sessioniseSeconds(timestampsMs: number[], opts: SessioniseOptions = {}): number {
  return sessioniseDiary(timestampsMs.map((t) => ({ t, kind: 'clip' as const, durationMs: 0 })), opts).seconds
}

/**
 * Pure: the distinct UTC days (YYYY-MM-DD) on which a learner has any event —
 * "how many of the last seven days the class practised on", the sentence the
 * Handbook already uses for a class's health mark. A day with one clip counts:
 * presence, not length, is the question here.
 */
export function activeDays(timestampsMs: number[]): string[] {
  const days = new Set<string>()
  for (const t of timestampsMs) {
    if (!Number.isFinite(t)) continue
    days.add(new Date(t).toISOString().slice(0, 10))
  }
  return [...days].sort()
}

const DAY_MS = 86_400_000

/** Pure: a span's seconds split across the UTC days it covers. */
export function spanSecondsByDay(spans: PlaySpan[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of spans) {
    let cursor = s.startMs
    while (cursor < s.endMs) {
      const day = new Date(cursor).toISOString().slice(0, 10)
      const midnight = Math.floor(cursor / DAY_MS) * DAY_MS + DAY_MS
      const stop = Math.min(midnight, s.endMs)
      out[day] = (out[day] || 0) + (stop - cursor) / 1000
      cursor = stop
    }
    if (s.endMs === s.startMs) {
      const day = new Date(s.startMs).toISOString().slice(0, 10)
      out[day] = out[day] || 0
    }
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k])
  return out
}

/** Pure, legacy shape: sessionised seconds per UTC day from bare stamps (see sessioniseSeconds). */
export function sessioniseSecondsByDay(timestampsMs: number[], opts: SessioniseOptions = {}): Record<string, number> {
  const spans = spansFromDiary(timestampsMs.map((t) => ({ t, kind: 'clip' as const, durationMs: 0 })), opts)
  return spanSecondsByDay(spans)
}

export interface InAppTime {
  /** Play-to-stop seconds, both modes (spansFromDiary). */
  seconds: number
  mainSeconds: number
  listeningSeconds: number
  /** Distinct UTC days with any play row in the window, ascending. */
  days: string[]
  /** Seconds per UTC day (YYYY-MM-DD) — the class list's activity sparkline (job #265). */
  secondsByDay: Record<string, number>
  spans: PlaySpan[]
}

// ─────────────────────────────────────────────────────────────────────────
// Row adapters — PostgREST row → DiaryPlayRow, packed read → DiaryPlayRow.
// ─────────────────────────────────────────────────────────────────────────

/** The PostgREST select that carries what the rule needs, aliased flat. */
export const DIARY_PLAY_SELECT =
  'learner_id, occurred_at, event_type, course_code, ct:payload->>cycleType, elapsed:payload->>elapsedMs, duration:payload->>durationMs, speed:payload->>playbackSpeed, url:payload->>url'

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function audioIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = url.match(/\/api\/audio\/([0-9a-fA-F-]{36})/)
  return m ? m[1] : null
}

/** A PostgREST diary row (DIARY_PLAY_SELECT shape, or a fixture carrying `payload`) → the rule's row; null for a row the rule ignores. */
export function toDiaryPlayRow(raw: Record<string, unknown>): DiaryPlayRow | null {
  const t = new Date(String(raw.occurred_at)).getTime()
  if (!Number.isFinite(t)) return null
  const type = String(raw.event_type ?? '')
  const payload = (raw.payload && typeof raw.payload === 'object' ? raw.payload : {}) as Record<string, unknown>
  const course = (raw.course_code as string | null) ?? null
  if (type === 'tap_play' || type === 'tap_pause') return { t, kind: type, course }
  if (type === 'listening_tick') return { t, kind: 'tick', listening: true, course }
  if (type !== 'audio_play') return null
  const ct = (raw.ct ?? payload.cycleType) as string | null | undefined
  const elapsedMs = num(raw.elapsed ?? payload.elapsedMs)
  const durationMs = num(raw.duration ?? payload.durationMs)
  const playbackSpeed = num(raw.speed ?? payload.playbackSpeed)
  const audioId = elapsedMs == null && durationMs == null ? audioIdFromUrl(raw.url ?? payload.url) : null
  return { t, kind: 'clip', listening: ct === LISTENING_MODE_CYCLE_TYPE, elapsedMs, durationMs, playbackSpeed, audioId, course }
}

/**
 * The packed read (`diary_play_rows`): { learnerId: [[t, k, listening, elapsedMs, durationMs, speed, audioId, course], …] }
 * where k ∈ 'p' (tap_play) | 's' (tap_pause) | 'a' (audio_play) | 't' (listening_tick).
 */
export function unpackDiaryPlayRows(packed: unknown): Map<string, DiaryPlayRow[]> {
  const out = new Map<string, DiaryPlayRow[]>()
  if (!packed || typeof packed !== 'object') return out
  for (const [lid, rows] of Object.entries(packed as Record<string, unknown[]>)) {
    const list: DiaryPlayRow[] = []
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!Array.isArray(r)) continue
      const [t, k, listening, elapsed, duration, speed, audioId, course] = r as unknown[]
      const tt = Number(t)
      if (!Number.isFinite(tt)) continue
      const c = typeof course === 'string' ? course : null
      if (k === 'p') list.push({ t: tt, kind: 'tap_play', course: c })
      else if (k === 's') list.push({ t: tt, kind: 'tap_pause', course: c })
      else if (k === 't') list.push({ t: tt, kind: 'tick', listening: true, course: c })
      else if (k === 'a') list.push({ t: tt, kind: 'clip', listening: Number(listening) === 1, elapsedMs: num(elapsed), durationMs: num(duration), playbackSpeed: num(speed), audioId: typeof audioId === 'string' ? audioId : null, course: c })
    }
    out.set(lid, list)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Reads.
// ─────────────────────────────────────────────────────────────────────────

/** course_audio.duration_ms for the given audio ids, chunked; ids it cannot find are simply absent. */
export async function loadAudioDurations(svc: SupabaseClient, audioIds: Iterable<string>): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set([...audioIds].filter(Boolean))]
  if (ids.length === 0) return out
  await Promise.all(
    chunk(ids, AUDIO_LOOKUP_CHUNK).map(async (batch) => {
      const { data } = await svc.from('course_audio').select('id, duration_ms').in('id', batch)
      for (const r of data ?? []) {
        const ms = num((r as any).duration_ms)
        if (ms != null) out.set(String((r as any).id), ms)
      }
    }),
  )
  return out
}

/**
 * Sessionise every learner's rows, resolving the closing clips' lengths from
 * course_audio in ONE lookup and re-running — the pure rule twice, one read.
 */
export async function sessioniseAll(
  svc: SupabaseClient,
  rowsByLearner: Map<string, DiaryPlayRow[]>,
  opts: SessioniseOptions = {},
): Promise<Map<string, DiarySessionisation>> {
  const first = new Map<string, DiarySessionisation>()
  const unresolved = new Set<string>()
  for (const [lid, rows] of rowsByLearner) {
    const s = sessioniseDiary(rows, opts)
    first.set(lid, s)
    for (const id of s.unresolvedAudioIds) unresolved.add(id)
  }
  if (unresolved.size === 0) return first
  const found = await loadAudioDurations(svc, unresolved)
  if (found.size === 0) return first
  const durations = new Map<string, number>(opts.durations ?? [])
  for (const [k, v] of found) durations.set(k, v)
  const out = new Map<string, DiarySessionisation>()
  for (const [lid, rows] of rowsByLearner) {
    out.set(lid, first.get(lid)!.unresolvedAudioIds.length ? sessioniseDiary(rows, { ...opts, durations }) : first.get(lid)!)
  }
  return out
}

/** Paged PostgREST read of the play rows for a list of learner ids over [sinceIso, now). */
export async function readDiaryPlayRows(
  svc: SupabaseClient,
  learnerIds: string[],
  sinceIso: string,
): Promise<Map<string, DiaryPlayRow[]>> {
  const out = new Map<string, DiaryPlayRow[]>()
  const ids = [...new Set(learnerIds.filter(Boolean))]
  if (ids.length === 0) return out
  await Promise.all(
    chunk(ids).map(async (batch) => {
      for (let page = 0; page < DIARY_MAX_PAGES; page++) {
        const { data } = await svc
          .from('player_events')
          .select(DIARY_PLAY_SELECT)
          .in('learner_id', batch)
          .in('event_type', [...PLAY_EVENT_TYPES])
          .gte('occurred_at', sinceIso)
          .order('occurred_at', { ascending: true })
          .order('id', { ascending: true })
          .range(page * DIARY_PAGE, page * DIARY_PAGE + DIARY_PAGE - 1)
        const rows = data ?? []
        for (const r of rows) {
          const lid = String((r as any).learner_id)
          const row = toDiaryPlayRow(r as Record<string, unknown>)
          if (!row) continue
          if (!out.has(lid)) out.set(lid, [])
          out.get(lid)!.push(row)
        }
        if (rows.length < DIARY_PAGE) break
      }
    }),
  )
  return out
}

/**
 * The packed read for a whole window: every learner with play rows in
 * [sinceIso, untilIso) on `env` (null = every env), or only `learnerIds` when
 * given. One round trip whatever the volume — 131k rows of a 30-day
 * production window come back in well under a second, where paged PostgREST
 * would need 131 pages.
 */
export async function readDiaryPlayRowsPacked(
  svc: SupabaseClient,
  sinceIso: string,
  untilIso: string,
  env: string | null = 'production',
  learnerIds: string[] | null = null,
): Promise<Map<string, DiaryPlayRow[]>> {
  const { data, error } = await svc.rpc('diary_play_rows', {
    p_since: sinceIso,
    p_until: untilIso,
    p_env: env,
    p_learner_ids: learnerIds,
  })
  if (error) throw new Error(`diary_play_rows: ${error.message}`)
  return unpackDiaryPlayRows(data)
}

/**
 * In-app seconds per learner id over [sinceIso, now), off the diary. A learner
 * with no play rows in the window is absent from the map (read as 0).
 */
export async function inAppSecondsByLearner(
  svc: SupabaseClient,
  learnerIds: string[],
  sinceIso: string,
  opts: SessioniseOptions = {},
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const [lid, t] of await inAppTimeByLearner(svc, learnerIds, sinceIso, opts)) out.set(lid, t.seconds)
  return out
}

/**
 * In-app time AND active days per learner id over [sinceIso, now), from ONE
 * diary read — the days ride on the same rows the seconds are sessionised
 * from, so a caller that wants both never pays for the diary twice.
 */
export async function inAppTimeByLearner(
  svc: SupabaseClient,
  learnerIds: string[],
  sinceIso: string,
  opts: SessioniseOptions = {},
): Promise<Map<string, InAppTime>> {
  const out = new Map<string, InAppTime>()
  const rowsByLearner = await readDiaryPlayRows(svc, learnerIds, sinceIso)
  if (rowsByLearner.size === 0) return out
  const sessions = await sessioniseAll(svc, rowsByLearner, opts)
  for (const [lid, rows] of rowsByLearner) {
    const s = sessions.get(lid)!
    out.set(lid, {
      seconds: s.seconds,
      mainSeconds: s.mainSeconds,
      listeningSeconds: s.listeningSeconds,
      days: activeDays(rows.map((r) => r.t)),
      secondsByDay: spanSecondsByDay(s.spans),
      spans: s.spans,
    })
  }
  return out
}
