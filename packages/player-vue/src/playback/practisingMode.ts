/**
 * PRACTISING — the third player mode, and its ONE trigger.
 *
 * Tom's ruling, 2026-08-31, in his own words:
 *
 *   "we should just keep playing as always, whether network is good or bad,
 *    UNTIL we can't fetch the next NEW LEGO, the LEGO whose turn it is. At
 *    THAT point we go into practising mode. We keep playing from the cache
 *    from that point onwards."
 *
 * Two things follow, and they are the whole of this file.
 *
 * NETWORK QUALITY IS NOT A TRIGGER. Being offline, degraded, on a weak signal,
 * behind a captive portal — none of it changes anything by itself. The device
 * holds ample material and plays straight through a patchy connection exactly
 * as it always did. There is no online/offline branch here and none is wanted.
 *
 * THE TRIGGER IS ONE FETCH. The next NEW LEGO — the one whose turn it actually
 * is, per the learner's cursor — is fetched by the tier-3 prefetch in
 * `useInstantPlayback` (`prefetchTier3`, which walks the round-map to the round
 * AFTER the one playing). When THAT attempt comes back with nothing playable,
 * we are practising. Nothing else qualifies: not a generic fetch failure
 * somewhere else, not an empty forward queue, not a shape heuristic about how
 * a round is built. And note that the cycles fetch already falls back to this
 * device's own cached copy of that LEGO — so a "failed" here means the next new
 * LEGO is genuinely unreachable, from the network AND from the cache.
 *
 * Recovery is the same fetch succeeding. The moment the next new LEGO can be
 * had again, the mode ends and forward play resumes from a position that never
 * moved — because while it held, nothing about that position was written down
 * (see `practisingBlocksProgressWrite` in LearningPlayer.vue).
 */

/**
 * What came back from the attempt to fetch the next new LEGO.
 *
 * Only two of these say anything about the mode. `no-next` is the course's own
 * end — a real fact about the content, not a connection problem — and `skipped`
 * is us never having asked. Both leave the mode exactly as it was, in either
 * direction, which is what makes this safe to call from a hot watcher.
 */
export type NextLegoFetchOutcome =
  /** The next round's cycles are in hand — from the network or from this
   *  device's cache. Either way the next new LEGO is reachable. */
  | 'fetched'
  /** The attempt was made and produced nothing playable. THE trigger. */
  | 'failed'
  /** The round-map has no round after this one: the end of the course. */
  | 'no-next'
  /** We never asked, or our own teardown/budget cancelled the ask. Says
   *  nothing about the connection, so it must not move the mode. */
  | 'skipped'

/**
 * The mode's entire state machine: fail enters, fetch leaves, everything else
 * holds. Pure so the rule is asserted in a test rather than inside a
 * 19,000-line single-file component.
 */
export function nextPractisingState(
  current: boolean,
  outcome: NextLegoFetchOutcome,
): boolean {
  if (outcome === 'failed') return true
  if (outcome === 'fetched') return false
  return current
}
