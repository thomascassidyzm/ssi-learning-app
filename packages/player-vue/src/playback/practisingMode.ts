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
 * Tom, 2026-08-31, once the first attempt at this had been measured against
 * his own real state:
 *
 *   "practice mode is designed as a no/low wifi test though ffs, so it should
 *    not serve any new LEGOS, else, what is the point???"
 *
 * That is the whole specification, and it is absolute: IN PRACTISING MODE, NO
 * NEW LEGO IS EVER INTRODUCED. The mode simulates a device that genuinely
 * cannot fetch new material, so it must behave like one.
 *
 * WHY THE FIRST ATTEMPT FAILED, because the shape of the failure is the reason
 * this function looks the way it does. It searched BACKWARDS over a 40-round
 * window for a ROUND that introduced nothing — no intro, no debut, no build.
 * Every main-loop round has all three. So on a learner whose whole history is
 * main-loop rounds (which is every ordinary learner) the candidate list was
 * always empty, the hold never engaged, and the mode changed nothing about
 * what was SERVED. Measured against Tom's own state on 2026-08-31 — learner
 * 81987d60, spa_for_eng, cursor S0403L03, round 828 — the next twenty items
 * with the mode ON were IDENTICAL, item for item, to the twenty with it OFF.
 *
 * SO DO NOT WIDEN THE WINDOW OR LOOSEN THE PREDICATE. A review-shaped round is
 * not a thing this course produces; a bigger search for one still finds none.
 * The unit was wrong, not its range.
 *
 * WHAT THIS DOES INSTEAD: it names a CYCLE, not a round. Every round the
 * learner has already completed ends in a block of practised material —
 * spaced repetition and USE phrases over LEGOs introduced long ago — sitting
 * behind that round's own intro/debut/build. That material is already in the
 * queue, its audio is already on the device (the round was played), and by
 * definition it introduces nothing. So we walk back over the completed
 * history, newest first, and land the playhead on the first cycle of a round
 * from which no introducing cycle remains. The mode then serves practised
 * material and only practised material, with no new content source, no fetch,
 * no urn, no cache measurement and no network.
 *
 * NO WINDOW CONSTANT. The rotation covers the whole played history and wraps,
 * so it cannot run dry while a single round has been completed, and there is
 * no arbitrary number to tune. Newest-first keeps the urn's shape — recently
 * introduced material comes round more often — without the urn.
 *
 * AND IT CANNOT RUN DRY. If no completed round has a practised-only tail at
 * all (a learner one round into a brand-new course), we replay the most recent
 * completed round from its start. That round's LEGO is one the learner has
 * already met, so replaying it introduces nothing NEW — which is the rule —
 * and there is always something to play. Null comes back only when nothing
 * whatsoever has been completed, which the caller cannot reach: the hold fires
 * from onRoundCompleted, so at least one round is always behind it.
 */

/** A landing place: a round in the completed history, and the cycle within it
 *  from which nothing introduces anything. */
export interface PractisedPosition {
  roundIndex: number
  cycleIndex: number
}

/**
 * Cycle types that INTRODUCE material. Everything else — spaced_rep, use,
 * listening, pod, the listening bookends — is review of something already met.
 *
 * Wider than `isMainLoopRound`'s intro/debut/build deliberately: the component
 * cycles belong to the new LEGO being taught and are new material by the same
 * argument, and a hold that landed on one would be serving the very thing the
 * mode exists to withhold. `isMainLoopRound` is left alone — it has other
 * consumers and other reasons — and this is the practising-specific test.
 */
const INTRODUCING_CYCLE_TYPES = new Set([
  'intro',
  'debut',
  'build',
  'component_intro',
  'component_practice',
])

export function cycleIntroducesMaterial(cycle: { type?: string } | null | undefined): boolean {
  return !!cycle?.type && INTRODUCING_CYCLE_TYPES.has(cycle.type)
}

/** The minimum a round must look like for this to reason about it. `Round`
 *  from SimplePlayer satisfies it; so does anything a probe hands us. */
export interface PractisableRound {
  cycles?: readonly ({ type?: string } | null | undefined)[]
}

/**
 * Where to put the playhead instead of the new LEGO.
 *
 * @param rounds  the engine's rounds, in play order
 * @param fromIndex  the index of the round we are REFUSING (i.e. the one that
 *                   would have played next); everything below it is history
 * @param step  a counter the caller increments on every hold, so consecutive
 *              holds rotate through the history rather than looping one round
 * @param introduces  which cycles count as new material; defaults to
 *                    `cycleIntroducesMaterial` and is injectable for tests
 */
export function choosePractisedPosition(
  rounds: readonly (PractisableRound | null | undefined)[],
  fromIndex: number,
  step: number,
  introduces: (cycle: { type?: string } | null | undefined) => boolean = cycleIntroducesMaterial,
): PractisedPosition | null {
  // Clamp BEFORE measuring. A queue that shrank underneath us (a rebuild, a
  // mode change) leaves fromIndex past the end, and reaching from the raw
  // value would index nothing at all — the hold would silently never engage
  // and a new LEGO would play.
  const start = Math.min(fromIndex, rounds.length)
  if (start <= 0) return null

  const offset = ((step % start) + start) % start
  for (let k = 0; k < start; k++) {
    // Newest first, wrapping, so every completed round is reachable and each
    // consecutive hold lands somewhere different.
    const i = start - 1 - ((offset + k) % start)
    const cycles = rounds[i]?.cycles
    if (!cycles || cycles.length === 0) continue
    // The first cycle that introduces nothing, PROVIDED nothing after it does
    // either — we play from there to the end of the round, so the whole tail
    // has to be clean. In practice the tail is the spaced-rep/USE block that
    // every main-loop round ends with; the check is here so the guarantee is
    // structural rather than a belief about round shape.
    let firstClean = -1
    let cleanToEnd = true
    for (let c = 0; c < cycles.length; c++) {
      if (introduces(cycles[c])) {
        if (firstClean !== -1) { cleanToEnd = false; break }
      } else if (firstClean === -1) {
        firstClean = c
      }
    }
    if (firstClean !== -1 && cleanToEnd) return { roundIndex: i, cycleIndex: firstClean }
  }

  // The floor. Nothing behind us has a practised-only tail, so replay the most
  // recently completed round whole: its LEGO is already introduced, so this
  // serves nothing new, and the mode still never runs dry.
  return { roundIndex: start - 1, cycleIndex: 0 }
}
