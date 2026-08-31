/**
 * cursorTelemetry — one event for "when did this learner's cursor MOVE, and
 * what build was running when it did?"
 *
 * WHY THIS EXISTS
 * ---------------
 * `course_enrollments` carries a cursor and nothing that dates it: no
 * `updated_at`, no audit table, no history. So when a real learner turned up
 * on 2026-08-31 at round 1399 of a course they were 13 rounds into, the
 * position could not even be dated, let alone correlated with the client build
 * that wrote it — and 39% of learners see two builds in a day, so "which build
 * did this" is the question that actually separates a bug from a tap.
 *
 * The durable floor for that is the `updated_at` column + trigger added in
 * migration `20260831_course_enrollments_cursor_trail.sql`: it is written by
 * the database itself, so it survives an offline client, a dropped beacon and
 * a closed tab. What it cannot know is the BUILD, because a Postgres trigger
 * has never heard of a bundle hash.
 *
 * This module is the other half: the client reports the move it just made,
 * with the build id and session id `usePlayerLog` already stamps on every row.
 * Together they answer "when" (authoritatively, always) and "by what, running
 * which code" (richly, best-effort).
 *
 * WHAT IS DELIBERATELY NOT REPORTED
 * ---------------------------------
 * The ordinary forward crawl. `setLivePosition` fires on every cycle (~5/min)
 * and `updateEnrollmentProgress` on every round; eventing those would be a
 * flood, and they are the moves nobody has ever been confused by — a cursor
 * that walked forward one round is already legible from round telemetry and
 * `last_practiced_at`. Only NON-LINEAR moves report here: the INF-PLAY ratchet
 * (the write that relocated those learners) and explicit navigation, including
 * every regression. Expected rate: a handful per session, and zero in a
 * session that just plays forward.
 *
 * Wiring follows `bundlePathTelemetry`: `ProgressStore` lives in `@ssi/core`
 * and has no access to the Vue telemetry composable, so it reports through a
 * module-level sink that `LearningPlayer` points at `playerLog.event` on
 * mount. Before it is wired — and in tests, SSR and the offline builder —
 * reports are dropped on the floor. Fire-and-forget, and a throwing sink is
 * swallowed: telemetry never interferes with a progress write.
 */

/** Why the cursor moved. Each is a NON-LINEAR move; the forward crawl is not
 *  represented here on purpose (see the header). */
export type CursorMoveKind =
  /** `setMode('infplay', ratchetHighestTo)` lifted the cursor to the course's
   *  final main-loop LEGO. The write that stranded 22 enrollments. */
  | 'infplay_ratchet'
  /** `setEnrollmentCursor` — a deliberate jump: belt pick, jump-to-furthest,
   *  round-back, resume-TTL reset. Includes backward moves. */
  | 'explicit_nav'

export interface CursorMoveEvent {
  /** NOTE: no courseCode — `usePlayerLog` stamps `course_code` on the row,
   *  and `client_version` / `session_id` / `occurred_at` with it. */
  kind: CursorMoveKind
  /** Cursor LEGO id BEFORE the write. Null when it could not be read (an
   *  offline or errored pre-read) — absence is itself informative. */
  fromLegoId: string | null
  /** Cursor round index BEFORE the write, if known. */
  fromRoundIndex: number | null
  /** Cursor LEGO id AFTER the write. */
  toLegoId: string | null
  /** Cursor round index AFTER the write, if the caller set one. */
  toRoundIndex: number | null
  /** Did the write actually change anything? A forward-only filter that
   *  matched no row is a NO-OP, and a no-op ratchet is a very different
   *  fact from a ratchet that moved someone 1,386 rounds. */
  moved: boolean
  /** Caller-supplied context, e.g. 'belt_jump', 'jump_to_furthest'. */
  reason?: string
}

type Sink = (event: CursorMoveEvent) => void

let sink: Sink | null = null

/**
 * Register the telemetry sink. Called once by LearningPlayer with a function
 * that forwards to `playerLog.event('cursor_move', payload)`.
 * Pass null to unregister (unmount).
 */
export function setCursorTelemetrySink(next: Sink | null): void {
  sink = next
}

/** Report a non-linear cursor move. Safe to call before the sink is wired. */
export function reportCursorMove(event: CursorMoveEvent): void {
  if (!sink) return
  try {
    sink(event)
  } catch {
    // Telemetry must never break a progress write.
  }
}
