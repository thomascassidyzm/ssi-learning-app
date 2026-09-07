/**
 * How long somebody must actually wait before a refused sign-in code can be
 * asked for again — and the sentence that says so.
 *
 * WHY THIS IS A MODULE AND NOT A STRING
 * -------------------------------------
 * The refusal used to read "Give it a couple of minutes, then try again" while
 * sitting on a FIFTEEN-minute rolling window (send-code.ts, WINDOW_MS). Someone
 * told a couple of minutes comes back at three, is refused again, and concludes
 * the thing is broken — which is the exact belief the sentence was written to
 * prevent. A hand-written number cannot track the limit it describes.
 *
 * So the number is DERIVED. The limiter already counts the sends inside the
 * window; the oldest of those sends is the one that ages out and lets the next
 * one through, so `oldest + windowMs` IS the moment the door reopens. The
 * sentence quotes that, and it cannot go stale when the window is retuned.
 */

/**
 * Milliseconds until the window has room again, given the oldest counted
 * attempt inside it. No timestamp — the audit read failed or came back thin —
 * means we cannot claim better than the whole window.
 */
export function retryAfterMs(oldestAttemptAt: number | null, windowMs: number, now: number = Date.now()): number {
  if (oldestAttemptAt === null || !Number.isFinite(oldestAttemptAt)) return windowMs
  return Math.max(0, Math.min(windowMs, oldestAttemptAt + windowMs - now))
}

/** "in about a minute" / "in about 12 minutes". Rounded UP: early is a lie, late is a wait. */
export function describeWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes <= 1) return 'in about a minute'
  return `in about ${minutes} minutes`
}
