/**
 * catalogueWait — how the app waits for the course catalogue when there is
 * NOTHING to fall back to.
 *
 * Tom's ruling, 2026-08-30:
 *
 *   "The 9-second cap is sacked. On a first cold visit there is no offline
 *    mirror and no cached catalogue, so there is nothing for a timeout to fall
 *    back TO — bounding the wait just converts a hang into a blank failure
 *    that is no better for the learner. Keep trying to load, and TELL THE
 *    LEARNER the network is slow."
 *
 * So this does not time out and it does not give up. That is not a
 * reintroduction of the unbounded hang the 2500ms critical-path budget exists
 * to kill (Tom 2026-08-15): that budget is about never making a learner wait
 * for the network when we already hold something we could play instead, and it
 * still governs every path where a fallback exists. This module is only ever
 * reached on the one path where no fallback exists at all, and there the
 * alternative to waiting is not playing sooner — it is never playing.
 *
 * What stops it being a hang is that the caller shows the learner it is
 * happening. Waiting visibly is a state; waiting blankly is a bug.
 *
 * Two things race:
 *  - the request already in flight, because it may be slow rather than dead,
 *    and if it lands it is the cheapest possible win;
 *  - a FRESH query on a backoff, because a stalled request measured on
 *    2026-08-30 was still pending 45s later while an identical new one
 *    answered in 344ms. Re-awaiting the loser is the one thing that reliably
 *    does not work.
 *
 * The backoff climbs and then holds, so a learner sitting on a bad connection
 * is retried a few times a minute rather than hammered.
 */

/** Climbing backoff between fresh attempts; the last value repeats forever. */
export const CATALOGUE_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000]

export const catalogueRetryDelay = (attempt: number): number =>
  CATALOGUE_RETRY_DELAYS_MS[Math.min(attempt, CATALOGUE_RETRY_DELAYS_MS.length - 1)]

/** A PostgREST result is only usable if it errored on nothing and carries rows. */
export function usableCatalogue<T extends { error?: unknown; data?: unknown }>(
  res: T | null | undefined,
): T | null {
  if (!res) return null
  if (res.error) return null
  return Array.isArray(res.data) && res.data.length > 0 ? res : null
}

export interface CatalogueWaitOptions {
  /** Start one more attempt. Given an abort signal when the platform has one. */
  startQuery: (signal?: AbortSignal) => PromiseLike<unknown>
  /** Called once per fresh attempt, for logging. */
  onRetry?: (attempt: number) => void
  /** Test seam. */
  delayFor?: (attempt: number) => number
}

/**
 * Resolve with the first usable catalogue result. Never rejects, never times
 * out, never spins: every lap of the loop waits out its full backoff before
 * starting another attempt, whether the previous one hung or failed instantly.
 *
 * That last clause is load-bearing and was wrong in the first draft — clearing
 * the backoff timer before awaiting it meant a FAST-failing network waited on
 * a promise that could no longer settle, and the learner got the permanently
 * blank screen this whole module exists to prevent.
 */
export async function waitForCatalogue<T extends { error?: unknown; data?: unknown }>(
  inFlight: PromiseLike<unknown>,
  { startQuery, onRetry, delayFor = catalogueRetryDelay }: CatalogueWaitOptions,
): Promise<T> {
  const live = new Set<Promise<T | null>>()
  const track = (query: PromiseLike<unknown>) => {
    const attempt: Promise<T | null> = Promise.resolve(query)
      .then(
        (res) => usableCatalogue(res as T),
        () => null,
      )
      .then((res) => {
        if (!res) live.delete(attempt)
        return res
      })
    live.add(attempt)
    return attempt
  }
  track(inFlight)

  let controller: AbortController | null = null
  try {
    for (let attempt = 0; ; attempt++) {
      let expire: ReturnType<typeof setTimeout>
      const backoff = new Promise<null>((resolve) => {
        expire = setTimeout(() => resolve(null), delayFor(attempt))
      })
      const winner = await Promise.race([...live, backoff])
      if (winner) {
        clearTimeout(expire!)
        return winner
      }
      // Nothing usable yet. Wait out the REST of the backoff — never clear the
      // timer here, or this await can never settle — then supersede the last
      // fresh attempt so a stalled socket cannot outlive its usefulness.
      await backoff
      controller?.abort()
      controller = typeof AbortController === 'function' ? new AbortController() : null
      onRetry?.(attempt + 2)
      track(startQuery(controller?.signal))
    }
  } finally {
    controller?.abort()
  }
}
