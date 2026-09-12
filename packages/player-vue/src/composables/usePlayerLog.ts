/**
 * usePlayerLog — diagnostic event logger for the learning player.
 *
 * Buffers events in memory, flushes batches to /api/player-events
 * every FLUSH_INTERVAL_MS or when the buffer crosses BATCH_TRIGGER. On
 * page hide / unmount, sends a final beacon to avoid losing the last
 * few seconds of events.
 *
 * Failures are silent — diagnostic logging must never block the user
 * experience. If the network is unreachable, the buffer is dropped
 * (better than retrying forever and risking memory bloat).
 *
 * Usage:
 *   const log = usePlayerLog({ courseCode })
 *   log.event('tap_skip', { during: 'pod_lap', round: 42 })
 */

import { onMounted, onBeforeUnmount, type Ref } from 'vue'
import { isOfflineish } from '../config/networkGate'
import { apiUrl } from '@/platform/apiBase'
import { platform } from '@/platform/capabilities'

interface PlayerEvent {
  event_type: string
  payload?: Record<string, unknown> | null
  course_code?: string | null
  session_id?: string
  occurred_at: string
  client_version?: string | null
}

/**
 * What a play-state context can stamp. Every field optional: a surface that has
 * no belt (Listening Mode) leaves it out rather than inventing one.
 */
export interface PlayerLogContext {
  /** The learning mode in force: 'easy' | 'fast' in the player, 'listening' in Listening Mode. */
  mode?: string | null
  /** Belt name the learner is PLAYING under (playingBelt), not the belt achieved. */
  belt?: string | null
  seedId?: string | null
  roundIndex?: number | null
  [key: string]: unknown
}

interface PlayerLogOptions {
  /** Reactive course code — stamped on every event. Optional; can be unresolved at session start. */
  courseCode?: Ref<string | null | undefined> | string | null
  /** Reactive learner id (incl. `guest-<uuid>`) — merged into every event's
   *  payload so GUEST sessions are attributable. player_events has no
   *  learner_id column and user_id is null for guests, so without this a
   *  guest's runs are untrackable across sessions. */
  learnerId?: Ref<string | null | undefined> | string | null
  /**
   * Play-as-class audit trail (owner ruling 2026-07-16): while a class-mode
   * session is active, `learnerId` above resolves to the CLASS's own learner
   * id (the DB row every event attributes to, via the ssi-user-id cookie) —
   * this carries the DRIVING STAFF MEMBER's auth uid alongside it in every
   * event's payload, so "which teacher was actually at the keyboard" is
   * never lost even though the telemetry itself belongs to the class.
   */
  actorUserId?: Ref<string | null | undefined> | string | null
  /** Bundle hash / git sha to stamp for triage. */
  clientVersion?: string
  /** Override flush interval (ms). */
  flushIntervalMs?: number
  /**
   * Supabase access token getter (SEC25 INPUT-04). /api/player-events no
   * longer trusts the `ssi-user-id` cookie as an identity — a signed-in
   * learner's events are attributed from a VERIFIED bearer, and anything
   * without one is stored unattributed (guest). Omit it and the log still
   * works; the rows just carry no learner id.
   */
  getToken?: () => Promise<string | null>
  /**
   * Play-state context, stamped on EVERY event this log emits (job #325, Tom
   * 2026-09-12: "belt (and seed/round context) stored on the row, not derived
   * from seedId"). Called at the instant each event is logged, so a row carries
   * the mode and belt IN FORCE at that play, not the page-load selection and
   * not a stored preference. Keys the caller already set on its payload, even
   * to null, are never overwritten: a pod play's deliberate `seedId: null`
   * stays null. A context that throws stamps nothing and the row goes out as
   * it always did.
   */
  context?: () => PlayerLogContext | null | undefined
}

const DEFAULT_FLUSH_INTERVAL_MS = 5000
const BATCH_TRIGGER = 10
const MAX_BUFFER = 200 // hard cap; events past this are dropped
// How long a HIDDEN-tab flush waits for a pending bearer before securing the
// batch as an unattributed beacon. Supabase's getSession() answers from local
// storage in single-digit ms; it takes longer only when the access token has
// expired and must be refreshed over the network, or the auth client's
// navigator lock is held by another tab. This is a bounded TRADE-OFF, not a
// close — see flush() for the floor it sits on.
const HIDDEN_TOKEN_WAIT_MS = 800
// A flush whose page is NOT at risk of eviction (a player unmount inside a
// live tab, or a tab that has come back to the foreground) keeps waiting for
// the bearer up to this much. It is a guard against a hung auth client only:
// past it the batch goes out unattributed rather than never.
const SAFE_TOKEN_WAIT_MS = 10_000

let nextSessionId: string | null = null

// Live player logs, for the learner bug-report postbox (job #327): the report
// flushes every buffer first so the server can read the last five minutes from
// player_events, and carries whatever is STILL unflushed in its own body as a
// fallback. Registered on mount, removed on unmount; nothing else reads this.
interface LiveLog { flush: () => Promise<void>; pending: () => PlayerEvent[] }
const liveLogs = new Set<LiveLog>()

/** Flush every mounted player log now. Silent on failure, like flush itself. */
export async function flushAllPlayerLogs(): Promise<void> {
  await Promise.all([...liveLogs].map((l) => l.flush().catch(() => {})))
}

/** Every event still buffered in a mounted player log, in arrival order. */
export function pendingPlayerEvents(): PlayerEvent[] {
  return [...liveLogs].flatMap((l) => l.pending())
}
function genSessionId(): string {
  // Prefer crypto.randomUUID where available (modern browsers).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: timestamp + random
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function usePlayerLog(options: PlayerLogOptions = {}) {
  const sessionId = nextSessionId || (nextSessionId = genSessionId())
  const clientVersion = options.clientVersion ?? null
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS

  const buffer: PlayerEvent[] = []
  let flushTimer: ReturnType<typeof setInterval> | null = null

  // Last known access token, refreshed on every async flush so the unload
  // path (which cannot await) still has one to send.
  let cachedToken: string | null = null
  // The refresh currently in flight, if any. A sync flush that finds the
  // cache empty while this is pending WAITS for it (bounded) rather than
  // beaconing without a bearer — see flush().
  let tokenInFlight: Promise<void> | null = null
  const refreshToken = (): Promise<void> => {
    if (!options.getToken) return Promise.resolve()
    if (tokenInFlight) return tokenInFlight
    const p = (async () => {
      try {
        cachedToken = await options.getToken!()
      } catch { /* silent — telemetry never blocks UX */ }
    })().finally(() => { if (tokenInFlight === p) tokenInFlight = null })
    tokenInFlight = p
    return p
  }

  const resolveCourseCode = (): string | null => {
    const v = options.courseCode
    if (!v) return null
    if (typeof v === 'string') return v
    if (typeof v === 'object' && 'value' in v) return (v.value as string) ?? null
    return null
  }

  const resolveLearnerId = (): string | null => {
    const v = options.learnerId
    if (!v) return null
    if (typeof v === 'string') return v
    if (typeof v === 'object' && 'value' in v) return (v.value as string) ?? null
    return null
  }

  const resolveActorUserId = (): string | null => {
    const v = options.actorUserId
    if (!v) return null
    if (typeof v === 'string') return v
    if (typeof v === 'object' && 'value' in v) return (v.value as string) ?? null
    return null
  }

  /**
   * Log a player event. Type is a short snake_case label; payload is
   * arbitrary structured context. Stamped with course + session +
   * timestamp; user / device / IP are added server-side.
   */
  const event = (type: string, payload?: Record<string, unknown>): void => {
    if (typeof type !== 'string' || type.length === 0) return
    if (buffer.length >= MAX_BUFFER) return // drop, never grow unbounded

    const learnerId = resolveLearnerId()
    const actorUserId = resolveActorUserId()
    const extra = {
      ...(learnerId ? { learnerId } : {}),
      ...(actorUserId ? { actor_user_id: actorUserId } : {}),
    }
    // Context keys fill only what the caller left ABSENT. `'k' in payload` is
    // the test, so an explicit null from the caller wins over the context.
    let context: PlayerLogContext | null | undefined
    try { context = options.context?.() } catch { context = null }
    const stamped: Record<string, unknown> = {}
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        if (v === undefined) continue
        if (payload && k in payload) continue
        stamped[k] = v
      }
    }
    const hasExtra = Object.keys(extra).length > 0 || Object.keys(stamped).length > 0
    buffer.push({
      event_type: type,
      payload: hasExtra ? { ...stamped, ...(payload ?? {}), ...extra } : (payload ?? null),
      course_code: resolveCourseCode(),
      session_id: sessionId,
      occurred_at: new Date().toISOString(),
      client_version: clientVersion,
    })

    if (buffer.length >= BATCH_TRIGGER) {
      void flush()
    }
  }

  /** Drain the current buffer to the network. Silent on failure. */
  const flush = async (sync: boolean = false, cause: 'hidden' | 'unmount' = 'hidden'): Promise<void> => {
    if (buffer.length === 0) return
    // Don't fire a doomed request when we already know the network is gone.
    // On iOS every failed foreground request is a fresh chance to trip the
    // system "you're not connected — open Settings" alert Tom hit, and this
    // one flushes on a 5s interval, so an offline session fires it over and
    // over. Nothing is lost: the buffer is ALREADY dropped on failure by
    // design (see the header) — this drops it before touching the network
    // stack rather than after. isOfflineish() is the observed-stall signal,
    // never navigator.onLine on its own, so a weak-but-real connection still
    // flushes normally.
    if (isOfflineish()) {
      buffer.length = 0
      return
    }
    const batch = buffer.splice(0, buffer.length)

    // `acting_learner_id` carries the play-as-class claim (owner ruling
    // 2026-07-16). It used to travel ONLY as the ssi-user-id cookie, which
    // does not cross an origin — inside a native shell the API is a different
    // origin, so class practice would silently attribute to the staff member
    // instead of the class. Sending it in the body works on both origins and
    // needs no cookie loosening. The server treats it as an unsigned CLAIM
    // exactly as it treats the cookie: honoured only for a class the verified
    // bearer may actually drive. Guest ids (`guest-<uuid>`) are not uuids and
    // are ignored server-side, so they are not worth sending.
    const actingLearnerId = resolveLearnerId()
    // WHICH CONTAINER THIS LEARNER IS IN. `device_type` is derived server-side
    // from the user-agent and answers a different question — phone / tablet /
    // desktop — so a wrapped Android session and an ordinary phone browser both
    // read 'mobile' and are indistinguishable. For the India rollout, whose
    // whole question is whether the app beats the web, that distinction IS the
    // measurement. Sent once per batch (it is a property of the client, not of
    // an event) and read from the ONE platform door; the server falls back to
    // the user-agent's WebView marker if it is missing.
    const body = JSON.stringify({
      events: batch,
      app_shell: platform().shell,
      ...(actingLearnerId && !actingLearnerId.startsWith('guest-')
        ? { acting_learner_id: actingLearnerId }
        : {}),
    })

    // Attribution rides a VERIFIED bearer, never the cookie (SEC25 INPUT-04).
    // The token is cached from the previous flush so the unload path can use
    // it without awaiting; a background refresh keeps it current.
    //
    // The cache is ALSO primed at mount (see onMounted). Before that, the only
    // things that filled it were an async flush — timed, ten-event batch or
    // explicit — so any sync flush before the first of those had RESOLVED
    // beaconed its boot events with no bearer at all, and they landed
    // unattributed — nine such rows for class 8H, every one a cold_start /
    // bundle_boot_path / bundle_tier_heal at the head of its session (job
    // #307, 2026-09-12). Priming narrowed that window; the wait below
    // narrows it further (job #317), and job #320 states honestly what is
    // left of it.
    if (!sync) await refreshToken()
    let token = cachedToken
    if (sync && !token && options.getToken) {
      // The gap #307 left open (Astra, #316·G): priming at mount starts the
      // refresh, but a tab hidden or a player unmounted BEFORE getToken()
      // resolves still found the cache empty and beaconed the boot events
      // with no bearer. So a sync flush waits for the in-flight refresh
      // instead of racing it. A keepalive fetch issued after an awaited
      // promise inside a visibilitychange handler is still inside the
      // page's lifetime, on the same terms as sendBeacon. If no refresh is in
      // flight this starts one, so the NEXT sync path also has a token.
      //
      // HOW LONG TO WAIT is a trade-off the client cannot settle (Astra,
      // #319, on #317): a hidden page can be evicted at any moment without
      // firing anything, and a batch still held in JS at that moment is gone,
      // while a beacon already handed to the browser survives. Waiting longer
      // buys attribution and risks the batch; sending sooner secures the
      // batch and loses attribution. No client-only design closes both — a
      // full close needs an idempotent re-send the server can dedupe, which
      // is not built. So:
      //   • a page NOT at eviction risk — an unmount inside a live tab, or a
      //     tab that has come back to the foreground while we waited — keeps
      //     waiting, up to SAFE_TOKEN_WAIT_MS (a hung-client guard only);
      //   • a page that is hidden and STAYS hidden waits HIDDEN_TOKEN_WAIT_MS
      //     and then secures the batch as an unattributed beacon. A bearer
      //     that resolves after that point is NOT applied to this batch:
      //     that row lands unattributed, by this decision, and the next
      //     flush carries the token.
      const pending = refreshToken()
      const startedAt = Date.now()
      let settled = false
      void pending.then(() => { settled = true })
      while (!settled) {
        const atRisk = cause === 'hidden'
          && typeof document !== 'undefined' && document.visibilityState === 'hidden'
        const budget = atRisk ? HIDDEN_TOKEN_WAIT_MS : SAFE_TOKEN_WAIT_MS
        const remaining = budget - (Date.now() - startedAt)
        if (remaining <= 0) break
        await Promise.race([
          pending,
          new Promise<void>((r) => setTimeout(r, Math.min(remaining, HIDDEN_TOKEN_WAIT_MS))),
        ])
      }
      token = cachedToken
    }

    // sendBeacon for unmount/visibilitychange — survives page unload. It can't
    // carry a header, so it's only used when there's no token to carry (guest
    // sessions); a signed-in learner uses keepalive fetch instead, which the
    // same unload path supports.
    // sendBeacon returns false when the browser declines to queue the payload
    // — its per-origin beacon quota is full, or the page is being torn down —
    // and until job #320 that batch was simply dropped (Astra, #319). Now a
    // refused beacon falls through to the keepalive fetch below, the same
    // path a bearer-carrying sync flush already takes, so the batch is not
    // lost. A beacon that THROWS falls through the same way.
    if (sync && !token && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' })
        if (navigator.sendBeacon(apiUrl('/api/player-events'), blob)) return
      } catch { /* fall through to fetch */ }
    }

    try {
      await fetch('/api/player-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
        keepalive: true, // best-effort survive unload even via fetch
      })
    } catch { /* silent — diagnostic logging never blocks UX */ }
  }

  // Flush on visibility change (tab hide) — important on iOS where
  // backgrounded tabs may be killed without unmount firing.
  const handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'hidden') {
      void flush(true, 'hidden')
    }
  }

  const live: LiveLog = { flush: () => flush(), pending: () => [...buffer] }

  onMounted(() => {
    if (typeof window === 'undefined') return
    // Prime the bearer cache NOW, not on the first timed flush: the sync path
    // (tab hidden, unmount) cannot await and sends whatever is cached, so an
    // empty cache in the first seconds of a session is an unattributed row.
    void refreshToken()
    flushTimer = setInterval(() => { void flush() }, flushIntervalMs)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    liveLogs.add(live)
  })

  onBeforeUnmount(() => {
    liveLogs.delete(live)
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    // The tab is alive here — an unmount is a route change, not an unload —
    // so this flush may wait the full safe budget for its bearer.
    void flush(true, 'unmount')
  })

  return {
    /** Session id — same value across all events from this player mount. */
    sessionId,
    event,
    /** Force-flush now (e.g. before a known-suspicious operation). */
    flush,
  }
}
