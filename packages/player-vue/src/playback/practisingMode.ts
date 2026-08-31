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
 * a round is built.
 *
 * A "failed" is the LEARNER'S reach, not our own wobble. The cycles fetch does
 * try this device's cached copy first, but that cache is empty by definition
 * for a LEGO the learner has never reached — so the outcome is decided by what
 * the throw was about. Our own outage (401/403 expired login, 429, 5xx) reports
 * `skipped` and leaves the mode alone: an SSi problem must never cost a paying
 * learner their recorded progress. Only a genuine failure to reach the content
 * says `failed`.
 *
 * Recovery is the same fetch succeeding. The moment the next new LEGO can be
 * had again, the mode ends and forward play resumes from a position that never
 * moved — because while it held, nothing about that position was written down
 * (see `practisingBlocksProgressWrite` in LearningPlayer.vue).
 *
 * AND IT IS NOT THE ONLY THING HOLDING THAT LINE. This mode is the precise
 * trigger; underneath it sits a floor that refuses any progress write while a
 * RECYCLED round — one dealt from the offline urn, carrying an old LEGO's id —
 * is on the playhead. The mode can be off (a slow connection that aborts
 * reports `skipped`; a course with no round map can never report at all) while
 * recycled material plays, and a write from there moves a learner BACKWARDS.
 * Belt and braces, deliberately: see `recycledRoundOnPlayhead`.
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

/**
 * WHERE THE PLAYHEAD GOES INSTEAD.
 *
 * Added 2026-08-31, after Tom watched the mode hold for twenty minutes while
 * the app introduced new LEGOs the whole time. The mode had five consumers and
 * every one of them was a progress-WRITE gate; nothing in the serving path read
 * it. The failing fetch was assumed to starve the queue, and on a course whose
 * material is already on the device it starves nothing.
 *
 * So the mode holds the playhead, and this is the pure half of that: given the
 * engine's rounds and where we are, name a round BEHIND us that introduces
 * nothing. Newest first, stepping one further back each time it is called, so
 * the hold is a rotation over recent review rather than one round looping —
 * the same "recently introduced comes round more often" shape the offline urn
 * has, with no urn, no cache measurement and no network.
 *
 * Returns null when there is nothing behind us to hold on. The caller lets the
 * round play in that case and says so in telemetry: refusing to serve anything
 * at all would be worse than serving one more LEGO.
 */
export function chooseHeldRoundIndex<T>(
  rounds: readonly T[],
  fromIndex: number,
  step: number,
  window: number,
  introducesMaterial: (round: T) => boolean,
): number | null {
  if (!rounds.length || fromIndex <= 0) return null
  // Clamp BEFORE measuring the window. A queue that shrank underneath us (a
  // rebuild, a mode change) leaves fromIndex past the end, and taking the
  // window off the raw value puts the floor above every round there is — the
  // hold would silently never engage and a new LEGO would play.
  const start = Math.min(fromIndex, rounds.length)
  const floor = Math.max(0, start - window)
  const candidates: number[] = []
  for (let i = start - 1; i >= floor; i--) {
    const r = rounds[i]
    if (r && !introducesMaterial(r)) candidates.push(i)
  }
  if (candidates.length === 0) return null
  return candidates[Math.abs(step) % candidates.length]
}
