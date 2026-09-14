/**
 * Mid-round cursor write queue (DB-01 throttle), lifted out of
 * LearningPlayer.vue so its one hard rule is testable on its own:
 *
 *   A cursor QUEUED while a write is refused never lands later.
 *
 * The queue holds one pending `{ learnerId, courseId, idx }` for up to
 * `delayMs`, then writes it; lifecycle boundaries (pause, background,
 * unmount) flush early. `refuse()` is consulted at BOTH ends — when the
 * cursor is queued and again when it flushes — because the two can straddle
 * a state change. Job #615 (finishing #607) caught exactly that on
 * production: an ssi_admin viewing-as opened the player, a cycle completed
 * and queued a cursor, the admin tapped Exit, view-as dropped, the player
 * unmounted and its teardown flush PATCHed course_enrollments under the
 * ADMIN's own learner — the fetch guard only blocks while viewing-as is ON,
 * and by flush time it was off. Same shape as the player_events residual
 * Astra found in #606: refuse at creation, not only at the exit.
 */
export interface CursorWrite {
  learnerId: string
  courseId: string
  idx: number
}

export interface CursorQueueOptions {
  /** Performs the write. Errors are reported through `onError`, never thrown. */
  write: (p: CursorWrite) => Promise<void>
  /** True when a cursor must not be queued or flushed right now. */
  refuse: () => boolean
  /** Throttle window; defaults to 60s. */
  delayMs?: number
  onError?: (err: unknown) => void
}

export interface CursorQueue {
  queue: (p: CursorWrite) => void
  flush: () => void
  cancel: () => void
  /** Test/diagnostic peek — the cursor waiting to be written, if any. */
  pending: () => CursorWrite | null
}

export function createCursorQueue(opts: CursorQueueOptions): CursorQueue {
  const delayMs = opts.delayMs ?? 60_000
  let pending: CursorWrite | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer) { clearTimeout(timer); timer = null }
  }

  const flush = () => {
    clearTimer()
    const p = pending
    pending = null
    if (!p) return
    // Re-check at the exit: the state that allowed the queue may be gone.
    if (opts.refuse()) return
    void opts.write(p).catch((err) => opts.onError?.(err))
  }

  const queue = (p: CursorWrite) => {
    // Refuse at CREATION: a cursor born under a refusal is never a learner's
    // cursor, so it is never held for a later, unguarded flush.
    if (opts.refuse()) return
    pending = p
    if (!timer) timer = setTimeout(flush, delayMs)
  }

  const cancel = () => {
    clearTimer()
    pending = null
  }

  return { queue, flush, cancel, pending: () => pending }
}
