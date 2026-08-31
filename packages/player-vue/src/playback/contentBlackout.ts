/**
 * CONTENT BLACKOUT — the admin test switch for PRACTISING mode.
 *
 * WHY THIS EXISTS. PRACTISING mode (see `practisingMode.ts`) has exactly one
 * trigger: the fetch for the NEXT NEW LEGO coming back with nothing. That state
 * has never been watched by a human on a real device, because it cannot be
 * provoked on one. Airplane mode does not do it — the script pre-generates ~57
 * rounds ahead, and on a bundle-enabled course the whole course sits in
 * IndexedDB, so the next new LEGO stays reachable with the radio off. A live
 * probe spent six runs and seven-minute offline windows failing to reach it
 * (job #473). And the doors we DID build are query strings, which do not exist
 * on an installed PWA — there is no address bar to type them into.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT. It is NOT a switch that turns
 * the banner on. A switch that sets `isPractising` would prove nothing: it would
 * show the banner whether or not the mode works. This switch makes the CONTENT
 * UNREACHABLE and then leaves the app alone. The cycles fetch fails the way a
 * dead network fails it; `prefetchTier3` catches that and reports 'failed';
 * `nextPractisingState` raises the mode; the banner, the write suppression and
 * the recovery probe all follow from the real code path. Everything that is
 * seen is the feature, not a mock of it.
 *
 * Recovery is the same honesty in reverse. Turn it off and nothing is reset by
 * hand: the next probe — the once-a-minute heartbeat, or the next round advance,
 * whichever comes first — fetches successfully, reports 'fetched', and the mode
 * ends on its own. So the second half of the behaviour, which nobody has ever
 * watched, is watched here.
 *
 * IN MEMORY ONLY, AND THAT IS THE POINT. It is not persisted anywhere. Every
 * app start begins with it off. Two reasons, both about not hurting a real
 * learner: a blackout that survived a restart would sit in front of the boot
 * fetch and leave the app unable to start at all, and a test switch that can
 * brick the app is worse than no switch. The cost is that it must be turned on
 * again after a restart, which is one tap.
 *
 * IT WRITES NOTHING AND BREAKS NOTHING. It changes no learner state. Progress
 * while it holds is suppressed by the mode's own gate
 * (`practisingBlocksProgressWrite`), exactly as it would be for a learner who
 * genuinely lost their connection — so the position does not move, and leaving
 * the blackout resumes forward play from where it stood.
 *
 * ONE HONEST CAVEAT, stated rather than hidden. On a bundle-enabled course the
 * blackout also declines the local bundle. A genuinely offline learner on such
 * a course still has that bundle and would NOT enter practising mode. So what
 * this reproduces is the trigger and everything downstream of it — which is the
 * thing under test — not the precise circumstances of one particular course.
 */

let blackoutActive = false
let lastProbe: BlackoutProbeReport | null = null

/** True while the admin test switch is holding content unreachable. */
export function isContentBlackoutActive(): boolean {
  return blackoutActive
}

/**
 * Turn the blackout on or off. Returns the new state so a caller can render
 * from the source of truth rather than its own copy.
 */
export function setContentBlackout(on: boolean): boolean {
  blackoutActive = !!on
  // A verdict from the previous throw must never sit under a fresh one — that
  // is the same "you cannot tell what you are looking at" problem one level up.
  clearBlackoutProbe()
  console.log(
    blackoutActive
      ? '[ContentBlackout] ON — the next new LEGO is now unreachable; PRACTISING should follow on the next round advance or within a minute'
      : '[ContentBlackout] OFF — content is reachable again; PRACTISING should end on the next probe',
  )
  return blackoutActive
}

/** Test/teardown helper. */
export function resetContentBlackout(): void {
  blackoutActive = false
  lastProbe = null
}

/**
 * WHAT THE SWITCH ACTUALLY DID, in one line the person who threw it can read.
 *
 * Added 2026-08-31, after a live session that nobody could settle. Tom threw
 * the switch while online, saw belts skip all the way to black, and said: "we
 * do not know if practising mode really worked". He was right that he could not
 * know — and neither could anyone else, because the switch had no way of
 * reporting back. It raises a blackout and returns. Whether the mode then moved
 * depended on an outcome computed several files away and shown nowhere.
 *
 * Two of the four outcomes are DESIGNED to leave the mode alone: 'no-next' (the
 * round map has no round after this one — the end of the course) and 'skipped'
 * (we never asked, or the failure was OUR 401/403/429/5xx rather than the
 * learner's reach). Both are correct. Both are silent. And a silent correct
 * no-op looks exactly like a switch that is not wired up.
 *
 * So the player writes the probe's verdict here and Settings renders it next to
 * the toggle. The switch now answers the only question worth asking of it: did
 * the mode move, and if not, why not.
 */
export type BlackoutProbeReport = {
  /** The tier-3 outcome, verbatim. */
  outcome: 'fetched' | 'failed' | 'no-next' | 'skipped'
  /** Where the mode ended up after the state machine saw that outcome. */
  practising: boolean
  /** Plain English, for the person holding the phone. */
  message: string
  at: number
}

/** Written by LearningPlayer the moment the probe the switch provoked returns. */
export function reportBlackoutProbe(
  outcome: BlackoutProbeReport['outcome'],
  practising: boolean,
): void {
  const message =
    outcome === 'failed' ? 'Practising mode is ON — the next new LEGO is unreachable.'
    : outcome === 'fetched' ? 'Content is reachable — practising mode is off.'
    : outcome === 'no-next' ? "Could not engage: there is no next new LEGO from here — this is the end of the course's new content, so there is nothing for the blackout to take away. Skip back a belt and try again."
    : 'Could not engage: the check was never made from this position. Play on for a round and it will try again.'
  lastProbe = { outcome, practising, message, at: Date.now() }
  console.log(`[ContentBlackout] probe said '${outcome}' → practising=${practising}: ${message}`)
}

/** Read by SettingsScreen to render the line under the toggle. */
export function lastBlackoutProbe(): BlackoutProbeReport | null {
  return lastProbe
}

/** Cleared with the switch, so a stale verdict never sits under a fresh throw. */
export function clearBlackoutProbe(): void {
  lastProbe = null
}
