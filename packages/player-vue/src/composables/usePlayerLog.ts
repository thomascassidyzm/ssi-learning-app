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

interface PlayerEvent {
  event_type: string
  payload?: Record<string, unknown> | null
  course_code?: string | null
  session_id?: string
  occurred_at: string
  client_version?: string | null
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
}

const DEFAULT_FLUSH_INTERVAL_MS = 5000
const BATCH_TRIGGER = 10
const MAX_BUFFER = 200 // hard cap; events past this are dropped

let nextSessionId: string | null = null
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
    const hasExtra = Object.keys(extra).length > 0
    buffer.push({
      event_type: type,
      payload: hasExtra ? { ...(payload ?? {}), ...extra } : (payload ?? null),
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
  const flush = async (sync: boolean = false): Promise<void> => {
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

    const body = JSON.stringify({ events: batch })

    // sendBeacon for unmount/visibilitychange — survives page unload.
    if (sync && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' })
        navigator.sendBeacon('/api/player-events', blob)
        return
      } catch { /* fall through to fetch */ }
    }

    try {
      await fetch('/api/player-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      void flush(true)
    }
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    flushTimer = setInterval(() => { void flush() }, flushIntervalMs)
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onBeforeUnmount(() => {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    void flush(true)
  })

  return {
    /** Session id — same value across all events from this player mount. */
    sessionId,
    event,
    /** Force-flush now (e.g. before a known-suspicious operation). */
    flush,
  }
}
