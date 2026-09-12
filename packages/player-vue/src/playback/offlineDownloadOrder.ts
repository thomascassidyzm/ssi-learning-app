/**
 * Fetch ORDER for both audio-delivery paths — a weighting on one queue, not a
 * scheduler. A downloader walks its id array in order, so ordering the array
 * IS the priority, and the order decides what a PARTIAL fetch is: the deliberate
 * download is chosen by percentage and can be interrupted, and the automatic
 * fetch-ahead is cut off the moment the learner loses signal.
 *
 * TOM'S RULING, 2026-09-12 (job #379): listening exercises — every pod slot,
 * list, metadata and audio — are fetched FIRST, ahead of the main course
 * clips, "so a learner who is unexpectedly offline can always play every
 * listening exercise … whatever amount was fetched, the pods are in it". There
 * is no offline MODE as such: the app is cache-first and the deliberate
 * download is simply "fetch more of the course ahead", so the same order
 * governs both paths and nothing here is mode-gated.
 *
 * This supersedes the 2026-09-01 "not first, but prioritised" weave (pods one
 * slot in eight through the course) and the same day's "never up front" scope
 * on the automatic path. Both were reasoned from a learner who stops early
 * holding dialogues and no course; Tom's report of 2026-09-12 — 250 MB and
 * 16,000 clips fetched, Pod 1 not among them, airplane mode, no dialogues —
 * is the failure he would rather have the other way round.
 *
 * What stays in front of the pods is the HEAD: a few rounds from the cursor,
 * the clips the learner is about to hear. That is minutes of audio, not a
 * corpus, and it is what keeps a cold start on cache during the one window
 * that is lock-fragile. Everything after the head is pods, then the course.
 */

/**
 * THE one builder. Tiers in priority order → one flat id array, deduped to
 * the EARLIEST position so an id claimed by two tiers keeps its highest
 * priority. The two exported builders below are typed views onto this: they
 * name the tiers each path has (the deliberate download has a `tail`, the
 * automatic fetch-ahead has `layer1` and a rolling `span`), and nothing else.
 */
export function orderTiers(...tiers: ReadonlyArray<readonly string[]>): string[] {
  return [...new Set(tiers.flat())]
}

export interface OfflineQueueTiers {
  /** A few rounds from the cursor — enough to start practising immediately. */
  head: readonly string[]
  /** Listening exercises: every pod slot's clips, then the Layer-1 pool. A
   *  PREFIX after the head, in its own order. */
  priority: readonly string[]
  /** The course itself, in learner order. */
  main: readonly string[]
  /** Everything else: commentary, Core, and the ids earlier tiers already
   *  claimed, which the dedupe drops. */
  tail: readonly string[]
}

/**
 * Build the deliberate-download queue: `head`, then ALL of `priority`, then
 * `main` in learner order, then `tail`. Deduped to the EARLIEST position, so
 * an id appearing in more than one tier keeps its highest priority.
 */
export function buildOfflineDownloadQueue(tiers: OfflineQueueTiers): string[] {
  const { head, priority, main, tail } = tiers
  return orderTiers(head, priority, main, tail)
}

export interface FetchAheadTiers {
  /** A few rounds from the cursor. */
  head: readonly string[]
  /** Every pod slot's clips — the whole listening corpus for the course. */
  pods: readonly string[]
  /** The Layer-1 cups due in the span ahead. */
  layer1: readonly string[]
  /** The rolling span of ordinary cycles ahead of the cursor. */
  span: readonly string[]
}

/**
 * Build the automatic fetch-ahead order: head, then every pod, then the
 * Layer-1 cups due in the span, then the span's cycles. Same rule as the
 * deliberate queue — listening before the course — so whatever the connection
 * allowed before it dropped, the pods are in it.
 */
export function buildFetchAheadOrder(tiers: FetchAheadTiers): string[] {
  const { head, pods, layer1, span } = tiers
  return orderTiers(head, pods, layer1, span)
}
