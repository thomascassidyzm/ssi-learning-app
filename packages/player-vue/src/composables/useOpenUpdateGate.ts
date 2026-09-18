/**
 * useOpenUpdateGate — the update that happens ON OPEN, said out loud.
 *
 * Tom, 2026-09-18, on production from his phone: "when I open the app and it
 * automatically checks for updates, it's not letting the user know what it's
 * doing — and it often just falls over itself and often needs to be quit and
 * then loaded up again."
 *
 * WHAT THIS IS. One check, once, at open: is the build actually live newer
 * than the build this document is running? If it is, the app says so on screen
 * and holds the surface while it takes the update, instead of reloading under
 * the learner's thumb or saying nothing at all and letting the banner arrive
 * mid-round. If it is NOT — the overwhelmingly common case, and every offline
 * case — nothing paints, nothing is fetched twice, and boot is untouched.
 *
 * WHAT TAKING THE UPDATE MEANS. A plain reload, exactly as PwaUpdatePrompt's
 * `onUpdate` does, and for the same reason: navigations are NetworkFirst, so a
 * reload fetches the new index.html and its new chunks from the origin, while
 * the old service worker keeps quietly serving its own precache. The waiting
 * worker is NEVER told to skip waiting — activating it under a live document
 * deletes that document's own chunks from the precache and kills it at the
 * next lazy import. That ruling is not relitigated here; see the long comment
 * in PwaUpdatePrompt.vue.
 *
 * FIVE RULES, and each one is the answer to a way this could hurt somebody.
 *
 * 1. SILENT WHEN UNSURE. The predicate is `isProvablyStale`, not
 *    `isDifferentBuild`. The banner fails OPEN so a real update is never
 *    swallowed — right for a banner the learner may ignore, wrong for a
 *    blocking screen: offline, a dead endpoint or an unreadable answer must
 *    all mean "carry on", never "hold the app".
 *
 * 2. NEVER OVER PLAYING AUDIO. Tom's standing rule since 2026-05-21. If
 *    anything is sounding, the gate stands down and the banner owns it.
 *
 * 3. ON OPEN MEANS ON OPEN. If the answer arrives after the open window, the
 *    learner has moved on and a screen taking over is an interruption, not an
 *    explanation. The gate stands down and the banner owns it.
 *
 * 4. ONE ATTEMPT PER TARGET BUILD. The reload can land on the old build
 *    anyway — on a slow network the navigation times out at 3s and the
 *    precached shell answers. Reloading again would be a reload LOOP, which is
 *    worse than being one build behind, so the target build id is recorded in
 *    sessionStorage before the reload and a second attempt at the same target
 *    is refused. A genuinely newer build later is a new target and is allowed.
 *
 * 5. A WEDGED RELOAD MUST BE ESCAPABLE BY HAND. On iOS standalone a
 *    programmatic `location.reload()` can silently not take; the one thing
 *    that unsticks it is a user gesture. So the held screen escalates on its
 *    own to a tappable way out rather than spinning forever — the same escape,
 *    for the same reason, as the boot watchdog's "tap to relaunch".
 */
import { ref } from 'vue'
import { isProvablyStale } from '../platform/buildStaleness'
import type { BuildStamp } from '../platform/buildStaleness'
import { fetchLatestBuild } from './usePwaUpdate'
import { runningBuild } from './useAppStaleness'

/**
 * How late the version answer may arrive and still count as "on open". A
 * healthy answer is one round trip; past this the learner is using the app and
 * the non-blocking banner is the honest surface (rule 3).
 */
export const OPEN_WINDOW_MS = 8000

/**
 * How long the held screen waits before admitting it is slow and offering a
 * way out (Tom's "~10s"). A reload that is going to take has taken long
 * before this; anything still here is either a very slow network or the iOS
 * wedge, and both are better served by a button than by a spinner (rule 5).
 */
export const SLOW_MS = 10000

/** The version check's own deadline. Nothing waits on it, but a hung fetch
 * must not leave the gate half-open behind the learner's back. */
export const CHECK_TIMEOUT_MS = 4000

/** Long enough for the held screen to actually paint and be read before the
 * document goes away. A reload fired in the same tick shows the learner
 * nothing, which is the whole complaint. */
export const PAINT_MS = 700

/** sessionStorage key carrying the build id this session has already tried to
 * reload onto (rule 4). Session-scoped: a fresh launch gets a fresh attempt. */
export const ATTEMPT_KEY = 'ssi-open-update-attempt'

/** True while the app is holding the surface to take an update. */
export const updateHolding = ref(false)

/** True once the hold has outlived SLOW_MS — the screen says so and offers
 * "Keep waiting" / "Reload". */
export const updateSlow = ref(false)

/** Read the recorded attempt without throwing where storage is blocked. */
export function readAttempt(): string | null {
  try {
    return sessionStorage.getItem(ATTEMPT_KEY)
  } catch {
    return null
  }
}

/** Record the build id we are reloading towards. Best-effort: storage being
 * blocked costs us the loop guard, not the update. */
export function writeAttempt(buildNumber: string | null | undefined): void {
  try {
    if (buildNumber) sessionStorage.setItem(ATTEMPT_KEY, buildNumber)
  } catch {
    /* storage blocked */
  }
}

/** Forget the attempt. Called once we are demonstrably on the live build, so a
 * later deploy in the same session is not mistaken for the one we just took. */
export function clearAttempt(): void {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY)
  } catch {
    /* storage blocked */
  }
}

export interface HoldDecision {
  /** Hold the surface and reload onto `target`. */
  hold: boolean
  /** Why not, for the log and for the tests. Null when holding. */
  reason:
    | null
    | 'no-answer'        // offline / endpoint down / unreadable — rule 1
    | 'already-current'  // nothing to do, and nothing paints
    | 'playing'          // rule 2
    | 'too-late'         // rule 3
    | 'already-tried'    // rule 4
}

/**
 * The whole decision, as one pure function — no DOM, no clock, no storage.
 * Everything that could hurt a learner is expressible as an argument here, so
 * everything that could hurt a learner is testable here.
 */
export function decideHold(args: {
  running: BuildStamp
  latest: BuildStamp | null
  elapsedSinceOpenMs: number
  isPlaying: boolean
  attemptedBuild: string | null
}): HoldDecision {
  const { running, latest, elapsedSinceOpenMs, isPlaying, attemptedBuild } = args
  // Rule 1: an answer we cannot read is not an update.
  if (!latest) return { hold: false, reason: 'no-answer' }
  if (!isProvablyStale(running, latest)) return { hold: false, reason: 'already-current' }
  // Rule 2: never over audio.
  if (isPlaying) return { hold: false, reason: 'playing' }
  // Rule 3: on open means on open.
  if (elapsedSinceOpenMs > OPEN_WINDOW_MS) return { hold: false, reason: 'too-late' }
  // Rule 4: one attempt per target build.
  if (attemptedBuild && latest.buildNumber && attemptedBuild === latest.buildNumber) {
    return { hold: false, reason: 'already-tried' }
  }
  return { hold: true, reason: null }
}

/** Injection seam, so the runner is testable without a browser. */
export interface GateDeps {
  fetchLatest: () => Promise<BuildStamp | null>
  now: () => number
  isPlaying: () => boolean
  reload: () => void
  running?: BuildStamp
}

function defaultDeps(): GateDeps {
  return {
    fetchLatest: fetchLatestBuild,
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    isPlaying: () => audibleNow,
    reload: () => window.location.reload(),
  }
}

/**
 * Whether anything is sounding right now. Fed by the same `ssi-play-state`
 * event the update banner listens to, so the two surfaces can never disagree
 * about whether it is safe to take over (rule 2).
 */
let audibleNow = false
let playStateBound = false

export function bindPlayState(): void {
  if (playStateBound || typeof window === 'undefined') return
  playStateBound = true
  window.addEventListener('ssi-play-state', (e: Event) => {
    audibleNow = !!(e as CustomEvent).detail?.playing
  })
}

/** Test seam — reset the module's play-state memory between cases. */
export function __setAudibleForTest(v: boolean): void {
  audibleNow = v
}

let ran = false

/**
 * Run the gate once for this document. Never throws, never rejects, and
 * resolves to what it decided so a caller (or a test) can say what happened.
 *
 * Deliberately NOT awaited by boot: the app opens at its own speed and this
 * answer either takes the screen over or costs nothing at all.
 */
export async function runOpenUpdateGate(overrides: Partial<GateDeps> = {}): Promise<HoldDecision> {
  const deps = { ...defaultDeps(), ...overrides }
  if (ran) return { hold: false, reason: 'too-late' }
  ran = true
  bindPlayState()

  const openedAt = deps.now()
  const latest = await Promise.race([
    deps.fetchLatest().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS)),
  ])

  const decision = decideHold({
    running: deps.running ?? runningBuild,
    latest,
    // Measured from the moment the gate was asked, which is boot — not from
    // navigation start, so a `now()` that is a wall clock rather than
    // `performance.now()` gives the same answer.
    elapsedSinceOpenMs: deps.now() - openedAt,
    isPlaying: deps.isPlaying(),
    attemptedBuild: readAttempt(),
  })

  if (!decision.hold) {
    // We are on the live build — the recorded attempt has served its purpose
    // and must not shadow a later deploy in the same session.
    if (decision.reason === 'already-current') clearAttempt()
    return decision
  }

  console.log('[OpenUpdate] live build is newer — holding the screen and reloading onto it')
  writeAttempt(latest?.buildNumber)
  updateHolding.value = true
  updateSlow.value = false
  setTimeout(() => { if (updateHolding.value) updateSlow.value = true }, SLOW_MS)
  // Let the screen paint and be read before the document goes away.
  setTimeout(() => deps.reload(), PAINT_MS)
  return decision
}

/** "Keep waiting" — stay held, and re-arm the slow escalation so the way out
 * comes back rather than being spent by one tap. */
export function keepWaiting(): void {
  updateSlow.value = false
  setTimeout(() => { if (updateHolding.value) updateSlow.value = true }, SLOW_MS)
}

/** Test seam — the once-per-document latch is module state by design. */
export function __resetGateForTest(): void {
  ran = false
  updateHolding.value = false
  updateSlow.value = false
  audibleNow = false
}
