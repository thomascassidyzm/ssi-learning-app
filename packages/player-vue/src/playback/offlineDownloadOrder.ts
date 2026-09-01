/**
 * Offline Mode fetch ORDER — a weighting on one queue, not a scheduler.
 *
 * The downloader walks its id array in order, so ordering the array IS the
 * priority. A full-course Offline Mode download is ~1.86 GB (spa_for_eng,
 * measured 2026-09-01) and the learner chooses what percentage of the
 * remaining course to take, so an interruption — or simply a smaller choice —
 * is the NORMAL case, not the edge. This order decides what a partial
 * download IS.
 *
 * TOM'S RULING, 2026-09-01: "Not first. But prioritised."
 *
 * That distinction is the whole design. Pod audio as a blocking PREFIX (what
 * this file did between 01b04769 and this commit) leaves a learner who stops
 * early holding complete pod dialogues and nothing to actually play next —
 * the ordinary rounds immediately ahead of them missing. That is worse than
 * no priority at all. So pods are INTERLEAVED with the course at an elevated
 * rate: the download proceeds in learner order, with pod audio pulled forward
 * and woven in well above its natural share, so at ANY point of interruption
 * the learner holds a usable mix — the next stretch of the course AND a
 * disproportionately large share of the pods.
 *
 * THE RATE. Pods are 3,138 of the 79,950 clips in a full spa_for_eng download
 * (1,067 turns + 2,027 fine-known glosses + 42 Take-G fusion slices + 2
 * bookends; measured live 2026-09-01) — a natural share of 3.9%. One slot in
 * every eight gives them 12.5%, about three times that, and lands the pods
 * complete around the one-third mark. Worked through:
 *
 *   stop at 25% of a full download   →  ~80% of the pods + ~23% of the course
 *   choose 33% or more, let it finish →  every pod clip, course intact
 *   natural share, for comparison     →  ~4% of the pods at the 25% mark
 *
 * A steeper rate (1 in 4) finishes the pods before the 25% mark but starves
 * the course at exactly the depth most learners pick; a shallower one stops
 * being a priority. One number, chosen against the measured corpus.
 */
export const PRIORITY_EVERY_NTH = 8

export interface OfflineQueueTiers {
  /** A few rounds from the cursor — enough to start practising immediately.
   *  Course content the learner is about to hear, so it stays a prefix. */
  head: readonly string[]
  /** Promoted listening, in its own priority order (pods lead, Layer-1
   *  follows). Woven through `main`, never placed in front of it. */
  priority: readonly string[]
  /** The course itself, in learner order — the spine the weave runs along. */
  main: readonly string[]
  /** Everything else: commentary, Core, and the ids earlier tiers already
   *  claimed, which the dedupe drops. */
  tail: readonly string[]
}

/**
 * Build the fetch queue: `head`, then `main` in learner order with one
 * `priority` id woven in every `everyNth` slots, then whatever either stream
 * has left, then `tail`. Deduped to the EARLIEST position, so an id appearing
 * in more than one tier keeps its highest priority.
 */
export function buildOfflineDownloadQueue(
  tiers: OfflineQueueTiers,
  everyNth: number = PRIORITY_EVERY_NTH,
): string[] {
  const { head, priority, main, tail } = tiers
  const step = Math.max(2, Math.floor(everyNth))
  const woven: string[] = []
  let p = 0
  let m = 0
  // Slot counting starts at 1 so the first slot is always MAIN — the learner's
  // next stretch of course leads, which is the point of "not first".
  for (let slot = 1; m < main.length || p < priority.length; slot++) {
    const takePriority = slot % step === 0 ? p < priority.length : m >= main.length
    if (takePriority && p < priority.length) woven.push(priority[p++])
    else if (m < main.length) woven.push(main[m++])
    else if (p < priority.length) woven.push(priority[p++])
  }
  return [...new Set([...head, ...woven, ...tail])]
}
