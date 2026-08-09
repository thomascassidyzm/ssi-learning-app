// SimplePlayer.ts - Clean playback engine (~180 lines)

import { buildSilentWavDataUri } from './silentWav'

// Cycle/Round moved to `@ssi/core` (bundle-cutover Phase 1,
// docs/bundle-cutover-design.md §3, §5 step 1) — canonical source is
// `packages/core/src/script/playerTypes.ts`, so the shared generator can
// produce them without depending on player-vue. Re-exported here so every
// existing `from '../playback/SimplePlayer'` import keeps working.
export type { Cycle, Round } from '@ssi/core'
import type { Cycle, Round } from '@ssi/core'

/**
 * Runtime overrides that LearningPlayer can supply to apply mode-dependent
 * timing (the Easy / Fast learning modes) without baking it into the script.
 * Pure callbacks — the engine reads them at the moment of each phase, so
 * flipping mode mid-round takes effect on the very next pause / voice phase.
 */
export interface SimplePlayerRuntimeOverrides {
  /** Return ms to override cycle.pauseDuration for this cycle, or undefined to use the baked value. */
  getPauseDuration?: (cycle: Cycle) => number | undefined
  // NOTE: there is deliberately no mode speed hook here. Target-voice speed has
  // exactly ONE source — the baked `cycle.playbackSpeed` from `computeCycleSpeed`
  // / `computeListeningSpeed`. Easy owned such a hook until 2026-08-07 and used
  // it to cancel the belt ramp, so beginners on Easy heard speech faster than
  // beginners on Fast. Modes differ by pause, repetition and phrase length —
  // never by speed.
  /**
   * Extra silence (ms) held AFTER voice2 before the next cycle starts, on top
   * of whatever the cycle already bakes in as `lingerMs`. Easy mode uses it so
   * the next cycle doesn't come straight in over the top of the one just
   * heard — and, because voice2 is the phase with the target text on screen,
   * the text stays up for that bit longer (Tom, 2026-08-07). Return undefined
   * / 0 to leave the cycle's baked linger alone. Fast returns 0.
   */
  getPostVoice2GapMs?: (cycle: Cycle) => number | undefined
  /** Return true to skip this cycle entirely (advance to the next). Consulted
   * before starting any phase, so a mid-round change shortens the remaining
   * round on the next cycle boundary. Retired Turbo used this to cull its
   * tagged cycles; adaptation v2 is the only remaining caller — the Easy /
   * Fast modes differ by script-shape OVERRIDE, never by a cull. */
  shouldSkipCycle?: (cycle: Cycle) => boolean
  /**
   * How many times should THIS cycle play, under the mode that is active
   * RIGHT NOW? Consulted at the moment the cycle finishes, never snapshotted,
   * so a mode flipped mid-round is obeyed by the very next step in both
   * directions: Easy→Fast drops the second play of the phrase in flight, and
   * Fast→Easy gives the phrase in flight its second play without waiting for
   * a round boundary.
   *
   * Tom, 2026-08-09, after reproducing the mid-round flip: "the round walker
   * must read current mode live per-step, not snapshot it at round-start."
   * Repetition therefore belongs to the WALKER, not to the script: the queue
   * carries each phrase once and the mode decides how often it sounds. (The
   * generators still bake `_x2` copies for their own paths; LearningPlayer's
   * shouldSkipCycle drops those so the two mechanisms can never compound into
   * four plays.)
   *
   * Return 1, 0, undefined or anything non-finite to play once. Clamped to 2 —
   * Tom's rule, not a preference: "a phrase repeated 3x would drive people
   * nuts, but doubled up is perfect".
   */
  getCycleRepeatCount?: (cycle: Cycle) => number | undefined
  /**
   * Optional pre-PROMPT gate. Resolves when this cycle's known audio is
   * ready to play from the local cache. While we wait, the player sits
   * in the 'buffering' phase — the UI can surface a subtle message
   * after a brief threshold so the learner sees an explanation instead
   * of a silent PROMPT.
   *
   * The engine bounds this itself (ENSURE_KNOWN_READY_TIMEOUT_MS) — an
   * implementation that never settles cannot strand the learner in
   * 'buffering'. Past the bound, or on rejection, we fall through to the play
   * attempt; if bytes really never arrive, the clip is retried once and then
   * SKIPPED so the session continues (the ruling), never halted. */
  ensureKnownReady?: (cycle: Cycle) => Promise<void>
  /**
   * Optional URL resolver called just before playAudio for known / target1
   * / target2. Returns the URL to play.
   *
   * Typical implementation: if the audio is in IndexedDB, return a blob
   * URL; otherwise return the original URL unchanged. Lets the audio
   * element read directly from local cache instead of going through the
   * service-worker layer, which:
   *   - eliminates an SW round-trip per play
   *   - makes the cacheHit telemetry honest (blob URL = real hit)
   *
   * Must resolve cheaply (sub-ms) since it sits on the critical path.
   * If it throws or rejects, the original URL is used as a fallback —
   * never breaks playback.
   */
  resolveAudioUrl?: (audioUrl: string) => Promise<string>
}

// Phases: idle → buffering (only if known audio not yet local) → prompt → pause → voice1 → voice2
//
// 'buffering' is a guard before PROMPT, not a fifth playback phase. It only
// fires if the cycle's known audio URL points at the network proxy (not a
// local blob) AND a runtime ensureKnownReady override is wired. Otherwise
// PROMPT enters directly as before. The phase exists so the UI can surface
// a subtle "still fetching" message instead of letting the cycle start with
// no audible prompt.
export type Phase = 'idle' | 'buffering' | 'prompt' | 'pause' | 'voice1' | 'voice2'

export interface PlaybackState {
  roundIndex: number
  cycleIndex: number
  phase: Phase
  isPlaying: boolean
}

type EventName =
  | 'state_changed'
  | 'phase_changed'
  | 'cycle_completed'
  | 'round_completed'
  | 'session_complete'
  | 'audio_failed' // Browser needs a fresh user gesture to play audio (iOS autoplay).
  | 'interrupted' // Something OUTSIDE the app paused our element (see AudioInterruptedEvent).
type EventCallback = (data?: unknown) => void

/**
 * Emitted when the audio element was paused by something that is NOT us and
 * is NOT the learner — the web-platform face of an iOS audio-session
 * interruption: another app (a WhatsApp notification sound, a maps voice
 * prompt, a call) takes the audio session, iOS pauses our element, and the
 * session is left believing it is playing while nothing sounds.
 *
 * The engine NEVER self-resumes off this — it only records the interruption
 * and reports it. Recovery is a transition, and every transition belongs to
 * PlayerConductor (see PlayerConductor.resumeAfterInterruption).
 */
export interface AudioInterruptedEvent {
  /** Phase the session was in when the interruption landed. */
  phase: Phase
  /** True when the interruption hit one of the SILENT clips (pause phase or
   * post-voice2 linger) — the windows with no stall watchdog, and therefore
   * the ones that strand the session permanently rather than skipping a clip. */
  duringSilentClip: boolean
  /** Whether the page was backgrounded at the moment of the interruption. */
  hidden: boolean
}

export interface AudioFailedEvent {
  /**
   * - 'needs-gesture': iOS Safari revoked the audio unlock (backgrounded
   *   tab); play() rejected with NotAllowedError. UI prompts "tap to
   *   resume" and a user tap restores playback. The browser will not
   *   play ANY audio until that tap, so we must halt.
   * - 'play-error': the clip could not be played (bad UUID / 404 / decode /
   *   CORS / blob-URL race against the per-cycle resolver / a hung URL
   *   resolve caught by the phase watchdog). Emitted twice per cycle in the
   *   failure path: once with attempt=1 just before the silent retry, and
   *   once with attempt=2 if the retry also fails. attempt=2 accompanies a
   *   SKIP, not a halt — the player plays what it has and moves on, loudly
   *   logged (see skipFailedClip and the ruling block below). Telemetry
   *   shape is unchanged so admin diagnostics keep grouping on it.
   */
  reason: 'needs-gesture' | 'play-error'
  /**
   * Cycle role the failure occurred on — lets diagnostics see whether
   * blob-URL races skew toward target voices (the bigger files that
   * prefetchNextCycle warms later) vs the known prompt.
   */
  role?: 'known' | 'target1' | 'target2'
  cycleType?: string
  legoId?: string
  cycleId?: string
  /** HTMLMediaElement.error?.code if available (1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED). */
  errorCode?: number
  /** 1 = first try, 2 = retry. attempt=2 in a 'play-error' event means the
   * clip was skipped (playback continued). */
  attempt?: 1 | 2
  lastError?: string
  /**
   * How many clips in a row have now been skipped without a single one
   * playing (reset by the first real playback progress). 1 is a puncture —
   * expected, survivable, the ruling in action. A large and climbing number
   * means the learner is being driven through SILENCE: the session will still
   * reach 'session_complete', but nothing was audible.
   *
   * This exists because never-aborting has a cost that a stall did not have.
   * A stall was at least self-evident to the learner. Skipping is instant, so
   * a course with a wholly missing audio block races to a "session complete"
   * screen in milliseconds having taught nothing. The player must NOT stop —
   * that is settled — so the counter is how the failure stays loud instead:
   * it rides the existing telemetry to the release gate and the admin
   * diagnostics, which is where a hollow course is supposed to be caught.
   */
  consecutiveSkips?: number
}

// Fallback: bootUpTime(2000) + scaleFactor(0.75) × estimatedTarget(6000) = 6500ms
const DEFAULT_PAUSE_DURATION = 6500

// ---------------------------------------------------------------------------
// THE RULING: the player plays what it has.
//
// A clip that fails to load, is missing, or is slow must be SKIPPED so the
// session continues. It must NEVER stall. The two bounds below are what make
// that structural rather than aspirational.
//
// Field report (Aran, 2026-08-06, German, item "with you"): playback hard-
// stopped on one item and would not restart; skipping BACK re-entered the
// stall every time; only skipping FORWARD past it recovered; all practice for
// that item was lost. The server resolved all three clips fine — this was a
// CLIENT stall.
//
// Root cause: startPhase() awaits `resolveUrl()` (the resolveAudioUrl runtime
// override) before every prompt / voice1 / voice2, with NO timeout and NO
// timer armed anywhere. The stall watchdog (armSafetyTimer) only exists once
// playAudio() has been reached, so during that await the engine has phase set,
// isPlaying true, and not a single timer running. If the override's promise
// never settles, the session is dead where it stands — no audio, no advance,
// no error, nothing to retry.
//
// The override is live for every learner (LearningPlayer's cachePlayOnline is
// on unless ?stream), and resolves through AudioCache.getWavBlobUrl → an mp3→
// WAV decode. getWavBlobUrl MEMOISES the in-flight promise per audio id, so a
// single non-settling decode poisons that ONE id permanently: replaying the
// item re-awaits the same dead promise (skip BACK reproduces), while every
// other id is untouched (skip FORWARD escapes). That is exactly the reported
// asymmetry.
//
// Fix, in two layers:
//   1. resolveUrl() is bounded — past the ceiling we fall back to the original
//      network URL, which is always playable.
//   2. A PHASE WATCHDOG covers the whole window from phase entry to the moment
//      playAudio() actually assigns a src. Nothing inside that window — this
//      await, ensureKnownReady, or anything added later — can outlive the
//      bound: the watchdog fires, logs loudly, and SKIPS the clip by routing
//      through the normal onAudioEnded advance.
// The cache layer carries its own bound too (AudioCache.getWavBlobUrl), so the
// poisoned-memo class is closed at source as well as survived here.
// ---------------------------------------------------------------------------

/** Ceiling on the resolveAudioUrl override. Documented as "must resolve
 * cheaply (sub-ms)"; 4s is orders of magnitude of headroom, and past it the
 * original network URL is strictly better than waiting. */
const RESOLVE_URL_TIMEOUT_MS = 4_000

/** Ceiling on the ensureKnownReady pre-PROMPT gate. Its own docblock already
 * requires implementations to bound themselves at ~5s; the engine now enforces
 * that rather than trusting it. */
const ENSURE_KNOWN_READY_TIMEOUT_MS = 5_000

/** Ceiling on "phase entered → audio element actually told to play". Covers
 * every await on the path, present and future. Generous enough that a slow-
 * but-working resolve (bounded at 4s above) still lands inside it. */
const PHASE_START_TIMEOUT_MS = 8_000

// ---------------------------------------------------------------------------
// Background-safe PAUSE phase.
//
// pause→voice1 was the ONLY cycle transition driven by a bare setTimeout. iOS
// Safari freezes JS timers on a backgrounded / screen-locked tab and tears
// down the now-playing session during the SILENT pause, so the timer never
// fired and voice1 never played (learner heard the prompt, then nothing).
// Every OTHER phase advances on the audio element's 'ended' event — which a
// backgrounded tab still receives — and so survives background/lock. The
// Listening-Pod lap is immune for exactly the same reason: it keeps real
// audio sounding and chains clip→clip on 'ended'.
//
// Fix: during PAUSE, play a genuinely-silent, real-PCM one-shot clip on the
// SAME element the cycle already uses (this.audio). Its natural 'ended' flows
// through the existing onAudioEnded hub exactly like prompt/voice1/voice2, so
// pause now advances on a clock iOS does not throttle. This is the minimal
// mirror of the phases that already work — pause becomes "a phase with audio"
// instead of "a phase with only a timer".
//
// NOT the old silentAudio.ts "driving mode": that LOOPED silence on the main
// element and kept re-grabbing audio focus. This clip is strictly ONE-SHOT
// (never loop = true, never auto-restarted — that looping pattern is the
// disabled 2026-05-23 oscillation landmine) and the keepalive AudioContext
// (owned at LearningPlayer level via useAudioSessionKeepalive) is left exactly
// as-is underneath.
//
// The existing dynamic/mode pause-duration timer is kept as a trim/backstop:
// whichever of (clip 'ended', trim timer) fires first advances, guarded by
// playGeneration against a double advance.
//
// The clip is a `data:` URI synthesised here at module load: no bundled asset,
// no fetch, no IndexedDB, no service worker, no resolveUrl/206-Range path — so
// it is silent AND works fully offline by construction (a real WAV body, not
// an empty src iOS treats as nothing).

// Fixed clip length, comfortably longer than any realistic pause (DEFAULT is
// 6500ms; adaptive/mode pauses never exceed it by much). The trim timer cuts
// it short for the actual dynamic/mode pause; the natural 'ended' is the
// background backstop when the timer is frozen.
const SILENT_CLIP_DURATION_S = 12

const SILENT_PAUSE_CLIP = buildSilentWavDataUri(SILENT_CLIP_DURATION_S)

/**
 * Silent clips cut to an EXACT length, for the post-voice2 linger.
 *
 * The pause phase can use one long clip plus a trim timer because a frozen
 * (backgrounded) timer only overshoots a pause that was seconds long anyway.
 * The linger is ~1-2s, so an overshoot to the 12s clip would be a glaring
 * hole in the session under lock. Cutting the clip to the exact linger makes
 * its natural 'ended' — the event iOS does NOT freeze — the primary advance,
 * with the timer as a same-length backstop.
 *
 * Cached per rounded-to-50ms duration: a session uses two or three distinct
 * linger lengths, so this builds a handful of small strings once.
 */
const lingerClipCache = new Map<number, string>()
function silentClipForMs(ms: number): string {
  const key = Math.max(50, Math.round(ms / 50) * 50)
  let clip = lingerClipCache.get(key)
  if (!clip) {
    clip = buildSilentWavDataUri(key / 1000)
    lingerClipCache.set(key, clip)
  }
  return clip
}

/**
 * Consecutive skipped clips at which the log escalates from "a puncture" to
 * "this session is running silent". Three is one whole cycle's worth of clips
 * (prompt + both target voices), i.e. the learner has now been shown a full
 * item they could not hear any part of.
 */
const CONSECUTIVE_SKIP_ALARM = 3

/**
 * How long after one of OUR OWN stops of the audio element a `pause` event is
 * still attributed to us rather than to an outside interruption.
 *
 * The element's `pause` event is queued as a task, so our own pause()/src
 * assignment lands its event within a tick or two — but a backgrounded tab can
 * run that task late. 400ms is far beyond any same-tick queue delay and far
 * short of a real interruption, which arrives with no preceding stop of ours
 * at all.
 */
const SELF_STOP_GRACE_MS = 400

/**
 * The hard ceiling on how many times the walker will sound one cycle back to
 * back. Tom's rule, not a setting: "we do NOT ever want to repeat exactly the
 * same phrase more than 2x - a phrase repeated 3x would drive people nuts, but
 * doubled up is perfect". A runtime override asking for more is clamped here,
 * which is what keeps the live repeat and any repeat already baked into the
 * script from compounding into four plays.
 */
const MAX_CYCLE_PLAYS = 2

function isGestureRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const maybe = err as { name?: string; message?: string }
  if (maybe.name === 'NotAllowedError') return true
  const msg = (maybe.message || '').toLowerCase()
  return msg.includes('user didn') || msg.includes('user gesture') || msg.includes('not allowed')
}

export class SimplePlayer {
  private rounds: Round[]
  private audio: HTMLAudioElement
  // The iOS audio-session keepalive (the silent looped audio that holds the
  // session through PAUSE phases and inter-phase gaps when backgrounded) is
  // owned at the LearningPlayer level via useAudioSessionKeepalive — it spans
  // the whole session, including pod laps and commentary on other audio
  // elements. SimplePlayer only manages cycle audio.
  private state: PlaybackState
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private safetyTimer: ReturnType<typeof setTimeout> | null = null
  // Clips skipped back-to-back with no audible playback in between. See
  // AudioFailedEvent.consecutiveSkips for why this is tracked.
  private consecutiveSkips: number = 0
  // playGeneration the currently-armed play-path safety watchdog belongs to,
  // and the highest currentTime seen for it. The watchdog is a STALL detector:
  // each timeupdate that shows real progress reschedules it, so a healthy clip
  // that legitimately runs past the window is never truncated. See armSafetyTimer.
  private safetyGen: number = 0
  private lastAudioCurrentTime: number = 0
  // Phase-start watchdog: armed on entry to every audio-bearing phase, cleared
  // the moment playAudio() reaches the element. Guarantees the ruling — no
  // await between phase entry and audio can strand the session. See the
  // "THE RULING" block above.
  private phaseWatchdogTimer: ReturnType<typeof setTimeout> | null = null
  private phaseWatchdogToken: number = 0
  // True only while the silent pause clip is sounding on this.audio. Lets the
  // 'ended' hub and the teardown chokepoint tell a pause clip apart from a real
  // voice clip.
  private pauseClipActive: boolean = false
  // Absolute time (ms) the current pause should end — used by the foreground
  // visibilitychange catch-up to advance immediately if the trim timer was
  // frozen while backgrounded. 0 when not in a pause.
  private pauseEndsAt: number = 0
  private lingerTimer: ReturnType<typeof setTimeout> | null = null
  // True only while the silent linger clip is sounding on this.audio (the
  // post-voice2 hold). Lets the 'ended' hub tell a linger clip apart from a
  // real voice clip — same shape as pauseClipActive.
  private lingerClipActive: boolean = false
  // How many times the cycle at the CURRENT cursor has sounded. Reset on every
  // reposition (cycleIndex/roundIndex move, jump, skip) so a repeat can never
  // leak across cycles; read only by advanceCycle's live repeat check.
  private currentCyclePlays: number = 0
  private listeners: Map<EventName, Set<EventCallback>> = new Map()

  // Named handlers for cleanup in dispose()
  private onEndedHandler: () => void
  private onErrorHandler: (e: Event) => void
  // Keeps navigator.mediaSession's position state fresh as each clip plays so
  // Android Chrome sees an active, advancing media session and is less likely
  // to suspend the backgrounded/locked tab (the cause of "finishes the phrase
  // then stops" online). Heuristic background-survival aid. Tom 2026-05-31.
  private onTimeUpdateHandler: () => void
  // Belt-and-braces: if the silent pause clip's 'ended' is ever delayed by iOS
  // while the tab is hidden, foregrounding it advances the pause the instant it
  // should have elapsed. Bounds the worst case; never the primary mechanism
  // (the clip 'ended' is).
  private onVisibilityHandler: () => void
  // Fires whenever the element stops sounding — ours or not. See onElementPause.
  private onPauseHandler: () => void
  // Timestamp of the last stop of the element WE caused (audio.pause(), or a
  // src assignment, which also fires 'pause' via the media load algorithm).
  // Anything outside SELF_STOP_GRACE_MS of this was somebody else's doing.
  private selfStopAt: number = 0
  // Set when an outside agent paused us mid-session; cleared by
  // resumeFromInterruption (or by any transition that supersedes it). The
  // engine never acts on this itself — the conductor does.
  private interrupted: boolean = false
  // Generation counter: increments on every playAudio call.
  // Stale play() rejections and safety timeouts check this to avoid
  // advancing the phase machine from a superseded audio request.
  private playGeneration: number = 0
  // Single silent retry for transient audio failures. Most production
  // errors are blob-URL races (the per-cycle resolver hasn't landed this
  // audio yet) — re-setting src + calling load()/play() against the
  // proxy URL almost always succeeds the second time. Tracks the URL
  // so we don't retry a different audio if playAudio fired in between.
  private retryAttempted: boolean = false
  private retryUrl: string | null = null
  private retryIsTarget: boolean = false
  // The playGeneration that was current when the audio element's `.src` was
  // last assigned for real playback (playAudio / retryCurrentAudio /
  // startPausePhase). Lets onErrorHandler and handleAudioFailure recognise
  // "this error belongs to a src a reposition has already superseded" even
  // when startPhase() re-enters synchronously in the same tick and flips
  // `phase` back before the stale error/rejection's microtask ever runs —
  // see stopForReposition.
  private lastAssignedSrcGen: number = 0

  /** Runtime overrides — set via setRuntimeOverrides, may be reassigned at any time. */
  private runtimeOverrides: SimplePlayerRuntimeOverrides = {}

  constructor(rounds: Round[], overrides: SimplePlayerRuntimeOverrides = {}) {
    this.rounds = rounds
    this.runtimeOverrides = overrides
    this.audio = new Audio()
    this.state = { roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false }

    this.onEndedHandler = () => this.onAudioEnded()
    this.onErrorHandler = (e: Event) => {
      // Audio element fired an error during playback. Try once more,
      // then halt — silently advancing lies to the learner because the
      // UI moves through phases while no sound came out. Pause phase,
      // idle, and buffering don't have audio in flight, so ignore those.
      if (this.state.phase === 'pause' || this.state.phase === 'idle' || this.state.phase === 'buffering') return
      // The post-voice2 linger sounds a silent clip while phase is still
      // 'voice2'. A failure to sound SILENCE is not a learner-visible failure
      // — the backstop timer still ends the hold — so never retry/halt on it.
      if (this.lingerClipActive) return
      // Ignore errors against a src generation a reposition has already
      // superseded (e.g. audio.pause() interrupting a load whose 'error'
      // task fires after startPhase() re-armed phase in the same tick).
      if (this.lastAssignedSrcGen !== this.playGeneration) return
      const code = this.audio.error?.code
      console.warn(`[SimplePlayer] audio error (code=${code}) on phase=${this.state.phase}`, e)
      this.handleAudioFailure(code)
    }

    this.audio.addEventListener('ended', this.onEndedHandler)
    this.audio.addEventListener('error', this.onErrorHandler)
    this.onTimeUpdateHandler = () => {
      this.updateMediaPositionState()
      this.noteAudioProgress()
    }
    this.audio.addEventListener('timeupdate', this.onTimeUpdateHandler)
    this.audio.addEventListener('loadedmetadata', this.onTimeUpdateHandler)

    this.onPauseHandler = () => this.onElementPause()
    this.audio.addEventListener('pause', this.onPauseHandler)

    this.onVisibilityHandler = () => {
      // Only relevant during a backgrounded PAUSE. Back in the foreground and
      // the pause window has elapsed → advance now rather than waiting on a
      // trim timer iOS may have frozen. The clip's own 'ended' usually beats
      // this; it's the belt-and-braces backstop.
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      this.detectSilentClipInterruption()
      if (this.state.phase !== 'pause' || !this.state.isPlaying) return
      if (this.pauseEndsAt > 0 && Date.now() >= this.pauseEndsAt) this.endPausePhase()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityHandler)
    }
  }

  /**
   * Mark the element as having been stopped BY US — either an explicit
   * audio.pause() or a `.src` assignment (the media load algorithm pauses a
   * playing element and fires 'pause' too). Every one of our own stops goes
   * through here so onElementPause can tell our stops apart from an outside
   * interruption without inspecting call stacks.
   */
  private markSelfAudioStop(): void {
    this.selfStopAt = Date.now()
  }

  /** Stop the element, recording it as ours. The only sanctioned pause path. */
  private stopAudioElement(): void {
    this.markSelfAudioStop()
    this.audio.pause()
  }

  /**
   * The element stopped sounding. If the session believes it is playing and
   * we did not stop it ourselves, something OUTSIDE the app did — an iOS
   * audio-session interruption (another app's notification sound, a maps
   * prompt, a call), a lock-screen/bluetooth pause, or the OS reclaiming
   * audio focus from a backgrounded tab.
   *
   * We only RECORD it. Resuming is a transition and belongs to the conductor
   * — and resuming while the interrupting audio is still sounding would just
   * be rejected anyway.
   */
  private onElementPause(): void {
    if (!this.state.isPlaying) return              // learner-paused / stopped — not ours to touch
    if (this.state.phase === 'idle') return
    if (this.audio.ended) return                   // natural end; 'ended' owns this
    if (Date.now() - this.selfStopAt < SELF_STOP_GRACE_MS) return
    this.noteInterruption()
  }

  /**
   * Belt-and-braces detector, run when the page returns to the foreground:
   * the session thinks it is playing, but the element is paused mid-SILENT
   * clip (pause phase or post-voice2 linger).
   *
   * Those two windows are the ones with no stall watchdog — a voice clip
   * killed by an interruption still has armSafetyTimer to notice and advance,
   * but a silent clip has only its own 'ended' (which an interruption
   * cancels) and a setTimeout iOS freezes while backgrounded. If the 'pause'
   * event was itself dropped while hidden, this is the only thing that ever
   * notices, and it is exactly the intermittent case.
   */
  private detectSilentClipInterruption(): void {
    if (!this.state.isPlaying) return
    if (!this.pauseClipActive && !this.lingerClipActive) return
    if (!this.audio.paused) return
    if (Date.now() - this.selfStopAt < SELF_STOP_GRACE_MS) return
    this.noteInterruption()
  }

  private noteInterruption(): void {
    if (this.interrupted) return
    this.interrupted = true
    const duringSilentClip = this.pauseClipActive || this.lingerClipActive
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    console.warn(
      `[SimplePlayer] Audio stopped by something outside the app (audio-session interruption) — ` +
      `phase=${this.state.phase} silentClip=${duringSilentClip} hidden=${hidden}. ` +
      `Awaiting a conductor-driven resume.`,
    )
    this.emit('interrupted', { phase: this.state.phase, duringSilentClip, hidden } satisfies AudioInterruptedEvent)
  }

  /** True while an outside interruption is recorded and unrecovered. */
  get hasPendingInterruption(): boolean {
    return this.interrupted
  }

  /**
   * Recover from a recorded outside interruption by replaying the current
   * cycle from PROMPT — the same reasoning as resume(): whatever the learner
   * was mid-way through is gone from their head, so they get the whole cycle.
   *
   * No-ops unless an interruption is actually pending AND the session still
   * believes it is playing, so a learner who deliberately paused is never
   * un-paused, and a second call can never double-play (the flag is cleared
   * before the restart, and stopForReposition's generation bump makes any
   * in-flight audio work from before the interruption inert).
   *
   * Called ONLY by PlayerConductor.resumeAfterInterruption.
   */
  resumeFromInterruption(): void {
    if (!this.interrupted) return
    this.interrupted = false
    if (!this.state.isPlaying) return
    if (this.state.phase === 'idle') return
    console.log('[SimplePlayer] Recovering from audio interruption — replaying the current cycle from prompt')
    this.stopForReposition()
    this.startPhase('prompt')
  }

  /**
   * Refresh navigator.mediaSession's position state from the live audio
   * element. Android Chrome is markedly more reluctant to suspend a tab whose
   * media session reports an active, advancing position — which is what keeps
   * background / screen-off playback alive. Guards the NaN/0 duration and
   * out-of-range position that would make setPositionState throw. Tom
   * 2026-05-31.
   */
  private updateMediaPositionState(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    if (typeof ms.setPositionState !== 'function') return
    const duration = this.audio.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    const position = Math.min(Math.max(this.audio.currentTime || 0, 0), duration)
    try {
      ms.setPositionState({ duration, position, playbackRate: this.audio.playbackRate || 1 })
    } catch {
      // Invalid state (e.g. position transiently > duration mid-seek) — ignore.
    }
  }

  /**
   * Emit 'audio_failed' with reason 'needs-gesture' and pause. Used when
   * the browser autoplay policy rejects play() — most often iOS Safari
   * after a backgrounded tab lost its audio unlock.
   */
  private tripGestureRequired(lastError: string): void {
    console.warn('[SimplePlayer] Audio needs user gesture — pausing session')
    this.stopAudioElement()
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.updateState({ isPlaying: false })
    this.emit('audio_failed', {
      reason: 'needs-gesture',
      lastError,
    } satisfies AudioFailedEvent)
  }

  /**
   * Map the current phase to the audio role (for telemetry). Returns
   * undefined for phases that don't play cycle audio (pause, idle).
   */
  private phaseToRole(): 'known' | 'target1' | 'target2' | undefined {
    switch (this.state.phase) {
      case 'prompt': return 'known'
      case 'voice1': return 'target1'
      case 'voice2': return 'target2'
      default: return undefined
    }
  }

  /** Common context for an audio_failed telemetry payload. */
  private buildFailedContext(errorCode: number | undefined, attempt: 1 | 2, lastError?: string): AudioFailedEvent {
    const cycle = this.currentCycle
    return {
      reason: 'play-error',
      role: this.phaseToRole(),
      cycleType: cycle?.type,
      legoId: cycle?.legoId,
      cycleId: cycle?.id,
      errorCode,
      attempt,
      lastError,
      consecutiveSkips: this.consecutiveSkips,
    }
  }

  /**
   * Centralised handler for any audio failure on a playing phase. Routes
   * the first failure into a silent retry of the same URL; if the retry
   * also fails (or there's no URL to retry), halts the player and surfaces
   * an audio_failed event so the UI can offer tap-to-retry.
   *
   * Every failure emits audio_failed for telemetry — attempt=1 fires
   * before the retry, attempt=2 fires alongside the halt.
   */
  private handleAudioFailure(errorCode: number | undefined, lastError?: string): void {
    if (this.state.phase === 'pause' || this.state.phase === 'idle') return
    if (!this.state.isPlaying) return
    // Same staleness guard as onErrorHandler — a failure tied to a src a
    // reposition has already superseded must never retry/halt the NEW cycle.
    if (this.lastAssignedSrcGen !== this.playGeneration) return

    if (!this.retryAttempted && this.retryUrl) {
      // First failure — log and silently retry the same URL.
      this.retryAttempted = true
      this.emit('audio_failed', this.buildFailedContext(errorCode, 1, lastError))
      this.retryCurrentAudio()
      return
    }

    // Retry already burned (or no URL to retry against) — SKIP this clip and
    // carry on. This used to halt the session (pause + tap-to-retry chip) on
    // the reasoning that "advancing while no sound came out lies to the
    // learner about what they just heard". Tom's standing ruling overrides
    // that: the player plays what it has, and a clip that cannot be played is
    // skipped so the session continues. A permanently-unplayable clip (a
    // revoked/empty blob URL, a decode the device refuses) otherwise halts on
    // the SAME item every single replay — a reproducible hard stop on one
    // item, which is precisely what the ruling exists to prevent.
    //
    // 'needs-gesture' still halts (tripGestureRequired): there the browser
    // will not play ANY audio until the learner taps, so skipping would burn
    // the whole session in silence rather than lose one clip.
    this.skipFailedClip(errorCode, lastError)
  }

  /**
   * Re-set the audio src and call load()+play() against the same URL.
   * Browsers retry the network fetch — most blob-URL races against
   * the per-cycle resolver resolve here because by the time we re-fetch
   * the audio has landed in cache. Reuses the same Audio element so
   * the mobile gesture unlock stays intact.
   */
  private retryCurrentAudio(): void {
    const url = this.retryUrl
    if (!url) return
    const isTarget = this.retryIsTarget
    this.clearSafetyTimer()
    const gen = ++this.playGeneration
    this.lastAssignedSrcGen = gen
    console.warn(`[SimplePlayer] Retrying audio (attempt 2/2): ${url}`)
    try {
      // A src assignment pauses a playing element and fires 'pause' — ours,
      // not an interruption. Same at every other src assignment below.
      this.markSelfAudioStop()
      this.audio.src = url
      this.audio.load()
    } catch (err) {
      console.warn('[SimplePlayer] retry load() threw:', err)
    }
    let rate = 1.0
    if (isTarget && this.currentCycle) {
      rate = this.currentCycle.playbackSpeed ?? 1.0
    }
    this.audio.playbackRate = rate
    this.audio.play().catch((err) => {
      if (gen !== this.playGeneration) return
      console.warn('[SimplePlayer] retry play() rejected:', err?.message)
      if (isGestureRequiredError(err)) {
        this.tripGestureRequired(err.message || 'autoplay blocked')
        return
      }
      // Retry failed — skip this clip, don't halt (see skipFailedClip).
      this.skipFailedClip(undefined, err?.message)
    })
    this.safetyTimer = setTimeout(() => {
      if (gen !== this.playGeneration) return
      console.warn('[SimplePlayer] Safety timeout on retry — skipping this clip')
      this.skipFailedClip(undefined, 'safety-timeout-after-retry')
    }, 10_000)
  }

  /**
   * The clip cannot be played (retry burned, or nothing to retry against).
   * Log loudly, keep the telemetry contract (audio_failed attempt=2, which is
   * what the admin diagnostics group on), and ADVANCE — the phase machine
   * moves on exactly as if the clip had finished, so the session continues.
   *
   * Deliberately does NOT touch isPlaying: the ruling is that playback
   * continues. A halt here is what produced Aran's dead session on "with you".
   */
  private skipFailedClip(errorCode: number | undefined, lastError?: string): void {
    const cycle = this.currentCycle
    // Counted before the emit so the telemetry payload carries this skip.
    this.consecutiveSkips++
    if (this.consecutiveSkips >= CONSECUTIVE_SKIP_ALARM) {
      console.error(
        `[SimplePlayer] ${this.consecutiveSkips} clips skipped in a row with nothing audible — ` +
        `this session is running SILENT. The player will not stop (standing ruling), but this ` +
        `course has a dead audio block and should never have passed the release gate.`,
      )
    }
    console.error(
      `[SimplePlayer] Audio unplayable after retry — SKIPPING this clip and continuing. ` +
      `phase=${this.state.phase} role=${this.phaseToRole()} legoId=${cycle?.legoId} ` +
      `cycleId=${cycle?.id} known="${cycle?.known?.text}" target="${cycle?.target?.text}" ` +
      `errorCode=${errorCode} lastError=${lastError}`,
    )
    this.emit('audio_failed', this.buildFailedContext(errorCode, 2, lastError))
    this.stopAudioElement()
    this.clearSafetyTimer()
    // Retry budget is per clip — the next clip gets its own.
    this.retryAttempted = false
    this.retryUrl = null
    this.onAudioEnded()
  }

  // Event emitter
  on(event: EventName, callback: EventCallback): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(callback)
  }

  off(event: EventName, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback)
  }

  private emit(event: EventName, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(data))
  }

  // Getters
  get currentRound(): Round | undefined {
    return this.rounds[this.state.roundIndex]
  }

  get currentCycle(): Cycle | undefined {
    return this.currentRound?.cycles[this.state.cycleIndex]
  }

  get currentState(): PlaybackState {
    return { ...this.state }
  }

  get progress(): { round: number; totalRounds: number; cycle: number; totalCycles: number } {
    const round = this.currentRound
    return {
      round: this.state.roundIndex + 1,
      totalRounds: this.rounds.length,
      cycle: this.state.cycleIndex + 1,
      totalCycles: round?.cycles.length ?? 0,
    }
  }

  get roundCount(): number {
    return this.rounds.length
  }

  /**
   * Immutable snapshot of the live queue, in play order. The ONLY sanctioned
   * way for UI layers to read the whole queue: reactive mirrors are assigned
   * from this after each queue mutation (a PULL of engine truth), never
   * rebuilt by re-implementing the insertion logic on the outside (a push
   * mirror). The duplicated-algorithm mirror was the INF-PLAY text/audio
   * shear bug class — see M4 in docs/player/pull-consistency-map.md.
   * Shallow copy: Round objects are treated as immutable throughout.
   */
  get roundsSnapshot(): Round[] {
    return [...this.rounds]
  }

  /**
   * Replace the runtime overrides. Used when LearningPlayer wants to
   * supply mode-aware callbacks after the player has been constructed,
   * e.g. once the algorithm config has loaded from Supabase.
   */
  setRuntimeOverrides(overrides: SimplePlayerRuntimeOverrides): void {
    this.runtimeOverrides = overrides
  }

  // Dynamic round management (for priority loading)

  /**
   * Add rounds to the player. Rounds are inserted at the correct position
   * based on their roundNumber to maintain order.
   */
  addRounds(newRounds: Round[]): void {
    if (newRounds.length === 0) return

    // Build set of existing legoIds for fast duplicate detection
    const existingLegoIds = new Set(this.rounds.map(r => r.legoId))

    // Insert each round at the correct position based on legoId (which encodes seed + lego index)
    let indexShift = 0
    for (const round of newRounds) {
      // Skip if this exact LEGO already exists (by legoId, not roundNumber)
      if (existingLegoIds.has(round.legoId)) {
        continue
      }

      // Find insertion point (maintain legoId order - S0001L01 < S0001L02 < S0002L01)
      const insertIndex = this.rounds.findIndex(r => r.legoId > round.legoId)
      if (insertIndex === -1) {
        this.rounds.push(round)
      } else {
        this.rounds.splice(insertIndex, 0, round)
        // Accumulate the shift; emit once at the end via updateState so the
        // state_changed event fires (otherwise a direct roundIndex++ bypasses
        // Vue reactivity and the expansion-watcher chain never re-fires when
        // the resumed learner is far from the loaded edge). Ported from the
        // appendRounds fix below — both insertion paths now share the
        // invariant: never mutate roundIndex outside updateState.
        if (insertIndex <= this.state.roundIndex + indexShift) {
          indexShift++
        }
      }
      existingLegoIds.add(round.legoId)
    }
    if (indexShift > 0) {
      this.updateState({ roundIndex: this.state.roundIndex + indexShift })
    }
  }

  /**
   * Insert rounds keyed by roundNumber, with sorted insertion and
   * dedupe-by-roundNumber. Use for the infinite-play expansion path
   * (where new rounds reuse existing legoIds because they're reviews
   * of already-introduced LEGOs) and for any other path that re-runs
   * generateScript and produces overlapping main-loop rounds.
   *
   * `addRounds` dedupes by legoId — wrong for infinite-play rounds
   * (multiple revival rounds share the same primaryLegoKey of the
   * first random-USE LEGO they happened to pick). roundNumber is the
   * stable, unique key across the whole script.
   */
  appendRounds(newRounds: Round[]): void {
    if (newRounds.length === 0) return
    const existingRoundNumbers = new Set(this.rounds.map(r => r.roundNumber))
    let indexShift = 0
    for (const round of newRounds) {
      if (existingRoundNumbers.has(round.roundNumber)) continue
      const insertIndex = this.rounds.findIndex(r => r.roundNumber > round.roundNumber)
      if (insertIndex === -1) {
        this.rounds.push(round)
      } else {
        this.rounds.splice(insertIndex, 0, round)
        // Accumulate the shift; emit once at the end via updateState so
        // the state_changed event fires (otherwise direct ++ bypasses
        // Vue reactivity and the expansion-watcher chain never re-fires
        // when the resumed learner is far from the loaded edge).
        if (insertIndex <= this.state.roundIndex + indexShift) {
          indexShift++
        }
      }
      existingRoundNumbers.add(round.roundNumber)
    }
    if (indexShift > 0) {
      this.updateState({ roundIndex: this.state.roundIndex + indexShift })
    }

    console.debug(`[SimplePlayer] Added ${newRounds.length} rounds, total now: ${this.rounds.length}`)
  }

  /**
   * Splice a higher-quality / more-complete round batch around the one
   * currently playing. Rounds at or before the current index are kept
   * verbatim so the in-flight round, cycleIndex and phase are unaffected
   * — the playing round is never swapped (that would desync cycleIndex
   * against a different cycles array).
   *
   * The batch fills in everything the queue is missing on BOTH sides:
   *   • rounds AFTER current   → replace the forward queue (as before)
   *   • rounds BEFORE current  → spliced in IF the queue doesn't already
   *     have them. A cold bootstrap only loads forward from the resume
   *     point, so the behind-rounds are absent; without them skip-back
   *     dead-ends at the resume round. Adding them lets skip-back reach
   *     earlier material once the full script lands. roundIndex shifts by
   *     however many we prepend so it still points at the live round.
   *
   * Use when a more-complete round source becomes available mid-session
   * (typically: the JS full-script generator landing after the bootstrap
   * API path has already started playback). The handoff is silent — same
   * lego_id, same audio IDs, same phase transitions — because both
   * sources derive from the same content tables. Round numbers must align.
   */
  replaceQueueFromCurrent(newRounds: Round[]): void {
    if (newRounds.length === 0) return

    const currentRoundNumber = this.rounds[this.state.roundIndex]?.roundNumber

    if (currentRoundNumber == null) {
      // Idle / never initialized — full replace, sorted.
      this.rounds = [...newRounds].sort((a, b) => a.roundNumber - b.roundNumber)
      console.debug(`[SimplePlayer] Replaced queue (idle): ${this.rounds.length} rounds`)
      return
    }

    const kept = this.rounds.filter(r => r.roundNumber <= currentRoundNumber)
    const keptNumbers = new Set(kept.map(r => r.roundNumber))
    // Only the behind-rounds the queue is actually missing — dedupe against
    // what we're keeping so an already-complete queue is a no-op (no shift).
    const before = newRounds
      .filter(r => r.roundNumber < currentRoundNumber && !keptNumbers.has(r.roundNumber))
      .sort((a, b) => a.roundNumber - b.roundNumber)
    const future = newRounds
      .filter(r => r.roundNumber > currentRoundNumber)
      .sort((a, b) => a.roundNumber - b.roundNumber)

    this.rounds = [...before, ...kept, ...future]
    if (before.length > 0) {
      // Keep the cursor on the live round now that earlier rounds sit ahead
      // of it in the array. cycleIndex + phase stay as they were.
      this.updateState({ roundIndex: this.state.roundIndex + before.length })
    }
    console.debug(`[SimplePlayer] Spliced queue around current (round ${currentRoundNumber}): before ${before.length}, kept ${kept.length}, future ${future.length}, total ${this.rounds.length}`)
  }

  /**
   * Check if a round exists by its roundNumber
   */
  hasRound(roundNumber: number): boolean {
    return this.rounds.some(r => r.roundNumber === roundNumber)
  }

  /**
   * Get round by roundNumber (not index)
   */
  getRoundByNumber(roundNumber: number): Round | undefined {
    return this.rounds.find(r => r.roundNumber === roundNumber)
  }

  /**
   * Find the index of a round by its roundNumber
   */
  findRoundIndex(roundNumber: number): number {
    return this.rounds.findIndex(r => r.roundNumber === roundNumber)
  }

  /**
   * Find the next cycle index in a round that the runtime override says to play.
   * Returns -1 if every remaining cycle is being skipped — caller advances the round.
   */
  /**
   * The position a round OPENS on under the mode active right now.
   *
   * A round's cycles carry fixed, cached positions; which of them this mode
   * plays is a live question, so the opening position is derived rather than
   * assumed to be 0. Falls back to 0 when the mode plays none of them — the
   * caller decides whether that means "step over" or "nothing to do".
   */
  private firstPlayableCycleIndex(round: Round | undefined): number {
    if (!round?.cycles?.length) return 0
    const idx = this.findNextPlayableCycleIndex(round, 0)
    return idx === -1 ? 0 : idx
  }

  private findNextPlayableCycleIndex(round: Round, fromIndex: number): number {
    const skip = this.runtimeOverrides.shouldSkipCycle
    if (!skip) return fromIndex < round.cycles.length ? fromIndex : -1
    for (let i = fromIndex; i < round.cycles.length; i++) {
      if (!skip(round.cycles[i])) return i
    }
    return -1
  }

  /**
   * Stop playback and invalidate any in-flight audio work, synchronously,
   * BEFORE any reposition. Must be the first call in every skip/jump entry
   * point (skipRound, jumpToRound, skipToPhase — stepCycle routes through
   * jumpToRound).
   *
   * Bumping playGeneration first — before pause(), before any state change —
   * guarantees a play() promise or an in-flight startPhase() await left over
   * from the pre-skip cycle can never retry, halt, or play audio against
   * post-skip state. This matters even though those methods go on to call
   * startPhase() again in the very same synchronous call stack: that
   * re-entrant call flips `phase` back away from 'idle' before the OLD
   * attempt's rejection/error microtask/task ever gets a chance to run, so a
   * phase-only guard closes too early. The generation bump has no such
   * window — it's compared, not raced.
   *
   * Deliberately does NOT reset audio.src to ''. Empty string is not a
   * supported media resource — assigning it fires a same-tick 'error' event
   * (MEDIA_ERR_SRC_NOT_SUPPORTED, code 4) that used to get misattributed to
   * the just-repositioned cycle once phase had already flipped back (see
   * above), triggering a bogus retry/halt against the NEW cycle and
   * corrupting its audio.src — the observed "skip advances the display,
   * audio repeats/dies" bug. pause() alone is enough to stop sound; the next
   * playAudio() call overwrites .src with the real next-cycle URL.
   */
  private stopForReposition(): void {
    ++this.playGeneration
    // Any deliberate reposition supersedes a recorded interruption — the
    // learner (or the app) has already decided where playback goes next.
    this.interrupted = false
    // A reposition lands on a different cycle: the live repeat counter belongs
    // to the cycle we are leaving and must never follow the cursor.
    this.currentCyclePlays = 0
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.stopAudioElement()
    this.retryAttempted = false
    this.retryUrl = null
  }

  // Controls
  play(): void {
    if (this.state.isPlaying) return
    const round = this.currentRound
    if (!round) {
      console.warn('[SimplePlayer] No rounds loaded, cannot play')
      return
    }
    if (!round.cycles || round.cycles.length === 0) {
      console.warn(`[SimplePlayer] Round ${round.roundNumber} has no cycles, skipping`)
      this.advanceRound()
      return
    }
    // Honour the runtime cull (adaptation v2's shouldSkipCycle) on the
    // round's leading cycles. If every cycle is skipped the round has nothing
    // left to play — advance to the next.
    const startIdx = this.findNextPlayableCycleIndex(round, this.state.cycleIndex)
    if (startIdx === -1) {
      console.debug(`[SimplePlayer] Round ${round.roundNumber}: all cycles skipped by the runtime cull, advancing`)
      this.updateState({ isPlaying: true })
      this.advanceRound()
      return
    }
    if (startIdx !== this.state.cycleIndex) {
      this.updateState({ cycleIndex: startIdx })
    }
    console.debug(`[SimplePlayer] Starting Round ${round.roundNumber} (${round.legoId}): ${round.cycles.length} cycles`)
    this.updateState({ isPlaying: true })
    this.startPhase('prompt')
  }

  pause(): void {
    if (!this.state.isPlaying) return
    // Bump playGeneration BEFORE audio.pause() — same reasoning as
    // stopForReposition() above. Without this, pausing while a play()
    // promise is still in flight (e.g. a round-boundary interlude — pod lap,
    // L1 cup, commentary — landing its pause() just as the next round's
    // prompt audio started) rejects that promise with AbortError ("The
    // operation was aborted"). Since playAudio()'s catch handler only
    // ignores rejections whose generation is stale, an un-bumped pause() let
    // that rejection hit handleAudioFailure — a bogus retry-then-halt
    // against audio nothing was actually wrong with. Confirmed live
    // (2026-07-22): a learner's console showed exactly this
    // "[SimplePlayer] play() rejected: The operation was aborted" during a
    // round-boundary pause, with the session silently going dead.
    ++this.playGeneration
    // A deliberate pause outranks any recorded interruption: from here the
    // learner owns the play state, and nothing may un-pause them.
    this.interrupted = false
    this.stopAudioElement()
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.updateState({ isPlaying: false })
  }

  resume(): void {
    if (this.state.isPlaying) return
    this.updateState({ isPlaying: true })

    // Always restart the current cycle from prompt. If the learner has
    // stopped the app at all, the previous phase's context is gone from
    // their head — they may not remember the prompt that played before
    // the pause-phase silence, the voice they just heard, etc. So we
    // give them the full 4-phase cycle from the top.
    //
    // If a learner just wants to skip to voice1 / voice2, the in-cycle
    // phase-strip nav pill is the explicit way to do that.
    //
    // This also fixes the "looks frozen" UX where pausing in the silent
    // pause phase + resuming used to restart the silent timer with no
    // audio cue that anything had happened.
    //
    // AND THAT RESTART IS A HEARING, so it counts against the repeat ceiling.
    // Measured live on dev 2026-08-09, pausing mid-cycle to reach the Easy/Fast
    // control (which lives on the resting screen, so pause → switch → resume is
    // the ONLY way a learner switches mid-session) and resuming on Easy played
    // the phrase THREE times: the interrupted play, the restart above, and then
    // the repeat that advanceCycle still had to give because no play had been
    // counted yet. Three is the one thing config may not buy — "a phrase
    // repeated 3x would drive people nuts" — so the restart is counted here,
    // which spends exactly the repeat the learner has already been given.
    // Fast is untouched: its count of 1 never reaches the repeat branch.
    this.currentCyclePlays = Math.min(this.currentCyclePlays + 1, MAX_CYCLE_PLAYS)
    this.startPhase('prompt')
  }

  stop(): void {
    this.interrupted = false
    this.stopAudioElement()
    this.audio.src = ''
    this.audio.playbackRate = 1.0
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.currentCyclePlays = 0
    this.updateState({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
  }

  // Mirror of findNextPlayableCycleIndex, walking backwards. Used by
  // stepCycle(-1) so a runtime-culled cycle is skipped over when stepping
  // back rather than landing on a cycle that won't play.
  private findPrevPlayableCycleIndex(round: Round, fromIndex: number): number {
    const skip = this.runtimeOverrides.shouldSkipCycle
    if (!skip) return fromIndex >= 0 ? Math.min(fromIndex, round.cycles.length - 1) : -1
    for (let i = Math.min(fromIndex, round.cycles.length - 1); i >= 0; i--) {
      if (!skip(round.cycles[i])) return i
    }
    return -1
  }

  /**
   * CYCLE-level navigation — step one practice cycle forward (+1) or back
   * (-1), crossing round boundaries naturally. This is the finest-grained
   * transport control (the bottom-nav ‹ › pair); the header ‹‹ ›› handle
   * the coarser ROUND/LEGO axis. The engine just owns the slot arithmetic.
   *
   * Boundary crossing:
   *   - forward past the last cycle of round N  → round N+1, cycle 0
   *   - back   before cycle 0 of round N        → round N-1, last cycle
   * At the very ends (first cycle of round 0 / last cycle of last round)
   * the step is a no-op — the caller owns what happens off the edge
   * (the header forward enters INF PLAY; nothing precedes the start).
   *
   * Runtime-culled cycles are honoured via find{Next,Prev}PlayableCycleIndex
   * so a single tap lands on the next *playable* cycle, never a culled one.
   * Routes through jumpToRound so play-state preservation, audio teardown
   * and cycle clamping all reuse the audited path.
   */
  stepCycle(direction: 1 | -1): void {
    const roundIdx = this.state.roundIndex
    const round = this.rounds[roundIdx]
    if (!round?.cycles?.length) return

    if (direction === 1) {
      const nextIdx = this.findNextPlayableCycleIndex(round, this.state.cycleIndex + 1)
      if (nextIdx !== -1) {
        this.jumpToRound(roundIdx, nextIdx)
      } else if (roundIdx < this.rounds.length - 1) {
        this.jumpToRound(roundIdx + 1, 0)
      }
      // else: last cycle of last round — no-op.
    } else {
      const prevIdx = this.findPrevPlayableCycleIndex(round, this.state.cycleIndex - 1)
      if (prevIdx !== -1) {
        this.jumpToRound(roundIdx, prevIdx)
      } else if (roundIdx > 0) {
        const prevRound = this.rounds[roundIdx - 1]
        const lastPlayable = this.findPrevPlayableCycleIndex(prevRound, prevRound.cycles.length - 1)
        this.jumpToRound(roundIdx - 1, lastPlayable === -1 ? 0 : lastPlayable)
      }
      // else: first cycle of round 0 — no-op.
    }
  }

  // Phase-level navigation within the current cycle via skipToPhase() —
  // lets the UI's per-cycle phase strip jump to a specific part
  // (prompt/pause/voice1/voice2) without leaving the cycle.
  skipToPhase(phase: 'prompt' | 'pause' | 'voice1' | 'voice2'): void {
    if (!this.currentCycle) return
    this.stopForReposition()
    if (!this.state.isPlaying) {
      this.updateState({ isPlaying: true })
    }
    this.startPhase(phase)
  }

  skipRound(): void {
    this.stopForReposition()
    this.advanceRound()
  }

  /**
   * Jump to a specific round, optionally landing on a specific cycle
   * within that round. cycleIndex defaults to 0 (start of round) — the
   * legacy behaviour. Mid-round resume after PWA reload passes the
   * persisted cycle so the learner picks up where they left off.
   * Out-of-range cycleIndex is clamped to a valid index in the round.
   */
  jumpToRound(index: number, cycleIndex: number = 0): void {
    console.debug(`[SimplePlayer] jumpToRound(${index}, cycle=${cycleIndex}) - rounds.length=${this.rounds.length}, isPlaying=${this.state.isPlaying}`)
    if (index < 0 || index >= this.rounds.length) {
      console.warn(`[SimplePlayer] jumpToRound(${index}) OUT OF BOUNDS - only ${this.rounds.length} rounds loaded`)
      return
    }
    const round = this.rounds[index]
    const cycleCount = round?.cycles?.length ?? 0
    const clamped = cycleCount > 0
      ? Math.min(Math.max(cycleIndex | 0, 0), cycleCount - 1)
      : 0
    // A caller names a POSITION; where the walk actually lands is derived from
    // it under the live mode (Tom, 2026-08-09). Resolving forward here matters
    // most when we land PAUSED — play() would have derived it on resume, but
    // until then `currentCycle` is what the UI shows, and showing a cycle this
    // mode does not play is the text/audio desync in miniature. Falls back to
    // the clamped position when the mode plays nothing from here on, so a jump
    // never silently becomes a no-op.
    const forward = cycleCount > 0 ? this.findNextPlayableCycleIndex(round, clamped) : -1
    const safeCycle = forward === -1 ? clamped : forward
    const wasPlaying = this.state.isPlaying
    this.stopForReposition()
    // Must set isPlaying: false so play() doesn't early-return
    this.updateState({ roundIndex: index, cycleIndex: safeCycle, phase: 'idle', isPlaying: false })
    console.debug(`[SimplePlayer] jumpToRound: wasPlaying=${wasPlaying}, calling play()`)
    if (wasPlaying) this.play()
  }

  // Private methods
  private async startPhase(phase: Phase): Promise<void> {
    this.updateState({ phase })

    // Log what's playing
    const cycle = this.currentCycle
    const round = this.currentRound
    if (phase === 'prompt' && cycle) {
      console.log(`  [${this.state.cycleIndex + 1}/${round?.cycles.length}] "${cycle.known.text}" → "${cycle.target.text}"`)
    }

    this.emit('phase_changed', { phase, cycle: this.currentCycle, round: this.currentRound })

    // Arm the phase-start watchdog for every audio-bearing phase, BEFORE any
    // await below. From here until playAudio() assigns a src there is now
    // always a live bound — see the "THE RULING" block at the top of the file.
    if (phase === 'prompt' || phase === 'voice1' || phase === 'voice2') {
      this.armPhaseWatchdog()
    }

    // Safety check: ensure we have the required data before playing
    const currentCycle = this.currentCycle

    // Listening / pod / bookend cycles only carry ONE audio track each
    // (target at 1×/2× OR known for translation). The 4-phase prompt /
    // pause / voice1 / voice2 walk hits phases that legitimately have
    // no audio — those gaps are by design, not missing data. Suppress
    // the warning for these cycle types so the console stays useful
    // for real audio gaps in speaking cycles.
    const isSingleAudioCycle = currentCycle?.singleAudio === true
      || currentCycle?.type === 'listening'
      || currentCycle?.type === 'pod'
      || currentCycle?.type === 'listen_intro'
      || currentCycle?.type === 'listen_outro'

    switch (phase) {
      case 'prompt':
        // Warm the SW cache for THIS cycle's voice1/voice2 during the
        // PROMPT + PAUSE window (5-8s of dead network time). For LEGOs
        // already in AudioCache the URL is blob: and prefetchUrl no-ops;
        // for proxy URLs not yet covered by the SW cache, this lands
        // them in the SW cache before VOICE_1 needs them — closes the
        // weak-cellular race window where the audio element's own fetch
        // could fail mid-cycle.
        // Both target voices sit behind PROMPT + PAUSE — plenty of time
        // to load. 'low' priority so they don't compete with the known
        // audio loading right now (or the next cycle's known prefetch).
        this.prefetchUrl(currentCycle?.target?.voice1Url, 'low')
        this.prefetchUrl(currentCycle?.target?.voice2Url, 'low')
        if (currentCycle?.known?.audioUrl) {
          // Gate: don't enter PROMPT until known audio is locally cached.
          // The cycle IS the prompt — if we start PROMPT while the audio
          // element is still loading from network, a watchdog/safety
          // timer can advance to PAUSE before any bytes have played and
          // the learner hears silence where the prompt should be. Sitting
          // in 'buffering' until ready costs at most a few hundred ms in
          // the common case and gives the UI a phase to surface a
          // subtle "fetching" message in the rare slow case.
          //
          // Skip the gate for single-audio cycles (listening / pod /
          // bookend) — they don't carry a meaningful prompt/response
          // structure, so a missing track is benign and the existing
          // skip-and-advance behaviour is fine.
          const ensureReady = this.runtimeOverrides.ensureKnownReady
          if (ensureReady && !isSingleAudioCycle) {
            this.updateState({ phase: 'buffering' })
            try {
              // Bounded: an override that never settles must not strand the
              // learner in 'buffering' forever. The phase watchdog would
              // eventually skip the clip anyway; this lands the common case on
              // the play attempt instead, which is the better outcome.
              await this.withBound(
                ensureReady(currentCycle),
                ENSURE_KNOWN_READY_TIMEOUT_MS,
                'ensureKnownReady',
                undefined,
              )
            } catch (err) {
              // Override rejected or timed out. Fall through to the play
              // attempt — if bytes really never arrive, the element's
              // retry-once-then-SKIP path keeps the session moving.
              console.warn('[SimplePlayer] ensureKnownReady rejected; falling through to play attempt', err)
            }
            // Bail if we were stopped, skipped, or moved on during the
            // wait. Anything that changes phase away from 'buffering'
            // or pauses playback supersedes this branch.
            if (this.state.phase !== 'buffering' || !this.state.isPlaying) return
            this.updateState({ phase: 'prompt' })
          }
          // Staleness guard: resolveUrl (offline/cache path) can take tens–
          // hundreds of ms (IndexedDB read + mp3→WAV re-encode). If a
          // skip/jump/round-boundary superseded us during the await, playing
          // now would emit the OLD cycle's audio against the NEW cycle's text
          // — the audio/text desync the app must never produce. A superseded
          // continuation must go inert (no playAudio, no phase advance).
          const gen = this.playGeneration
          const url = await this.resolveUrl(currentCycle.known.audioUrl)
          if (gen !== this.playGeneration || this.currentCycle !== currentCycle || !this.state.isPlaying) return
          this.playAudio(url)
        } else {
          if (!isSingleAudioCycle) {
            console.warn(`[SimplePlayer] No prompt audio for "${currentCycle?.known?.text}" → "${currentCycle?.target?.text}", skipping`)
          }
          this.onAudioEnded()
        }
        break
      case 'pause':
        this.startPausePhase()
        break
      case 'voice1':
        if (currentCycle?.target?.voice1Url) {
          // Staleness guard — see the prompt branch. A superseded await must
          // not play the old cycle's voice1 over the new cycle's text.
          const gen = this.playGeneration
          const url = await this.resolveUrl(currentCycle.target.voice1Url)
          if (gen !== this.playGeneration || this.currentCycle !== currentCycle || !this.state.isPlaying) return
          this.playAudio(url, true)
        } else {
          if (!isSingleAudioCycle) {
            console.warn(`[SimplePlayer] No voice1 audio for "${currentCycle?.known?.text}" → "${currentCycle?.target?.text}", skipping`)
          }
          this.onAudioEnded()
        }
        break
      case 'voice2':
        // Warm the SW cache for the NEXT cycle's prompt + voice1/voice2
        // during VOICE_2 playback (~2-3s) + the inter-cycle gap. By the
        // time the next PROMPT phase fires, all three URLs are warm.
        this.prefetchNextCycle()
        if (currentCycle?.target?.voice2Url) {
          // Staleness guard — see the prompt branch. A superseded await must
          // not play the old cycle's voice2 over the new cycle's text.
          const gen = this.playGeneration
          const url = await this.resolveUrl(currentCycle.target.voice2Url)
          if (gen !== this.playGeneration || this.currentCycle !== currentCycle || !this.state.isPlaying) return
          this.playAudio(url, true)
        } else {
          if (!isSingleAudioCycle) {
            console.warn(`[SimplePlayer] No voice2 audio for "${currentCycle?.known?.text}" → "${currentCycle?.target?.text}", skipping`)
          }
          this.onAudioEnded()
        }
        break
    }
  }

  /**
   * Fire-and-forget warm-up for a single audio URL. Hits the SW CacheFirst
   * layer on `/api/audio/*` so the next playback request finds it warm.
   * Blob URLs (already in AudioCache/IndexedDB) and empty strings are
   * silently skipped — there's nothing to warm. Failures are swallowed:
   * this is best-effort, the actual playback path still gets its own
   * fetch + retry-once + halt-on-failure chain.
   */
  /**
   * Resolve an audio URL just before playback, via the optional
   * resolveAudioUrl runtime override. The typical implementation
   * substitutes a blob URL when the audio is already in IndexedDB,
   * letting the audio element bypass the service-worker layer.
   * Falls back to the original URL on rejection — never breaks playback.
   */
  private async resolveUrl(url: string): Promise<string> {
    const resolver = this.runtimeOverrides.resolveAudioUrl
    if (!resolver) return url
    try {
      // Bounded. The override is documented as "must resolve cheaply (sub-ms)"
      // but it runs an IndexedDB read + an mp3→WAV decode; a decode that never
      // settles used to hang this await forever with no timer armed anywhere —
      // the stall this fix exists to kill. Past the ceiling we play the
      // original network URL, which is always a valid resource.
      const resolved = await this.withBound(resolver(url), RESOLVE_URL_TIMEOUT_MS, 'resolveAudioUrl', url)
      return resolved || url
    } catch (err) {
      console.warn('[SimplePlayer] resolveAudioUrl threw; using original URL', err)
      return url
    }
  }

  /**
   * Race a promise against a ceiling, resolving to `onTimeout` if the ceiling
   * is reached. Never leaves a dangling timer. Used for every await that sits
   * between phase entry and audio actually playing — those are the ones that
   * can strand the session.
   */
  private withBound<T>(promise: Promise<T>, ms: number, label: string, onTimeout: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        console.error(`[SimplePlayer] ${label} exceeded its ${ms}ms bound — continuing without it`)
        resolve(onTimeout)
      }, ms)
    })
    return Promise.race([promise, bound]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  /**
   * Arm the phase-start watchdog. Fires if this phase never reaches
   * playAudio() (which clears it via clearSafetyTimer) within the bound —
   * i.e. something on the resolve path hung. On fire we log loudly and SKIP
   * the clip by routing through the normal advance, per the ruling.
   */
  private armPhaseWatchdog(): void {
    this.clearPhaseWatchdog()
    const token = ++this.phaseWatchdogToken
    this.phaseWatchdogTimer = setTimeout(() => {
      this.phaseWatchdogTimer = null
      if (token !== this.phaseWatchdogToken || !this.state.isPlaying) return
      const cycle = this.currentCycle
      console.error(
        `[SimplePlayer] PHASE WATCHDOG: phase=${this.state.phase} never reached audio within ` +
        `${PHASE_START_TIMEOUT_MS}ms (audio URL resolution hung) — SKIPPING this clip and continuing. ` +
        `legoId=${cycle?.legoId} cycleId=${cycle?.id} known="${cycle?.known?.text}" target="${cycle?.target?.text}"`,
      )
      this.emit('audio_failed', this.buildFailedContext(undefined, 2, 'phase-watchdog-resolve-hang'))
      this.onAudioEnded()
    }, PHASE_START_TIMEOUT_MS)
  }

  /** Disarm the phase-start watchdog and invalidate any already-queued fire. */
  private clearPhaseWatchdog(): void {
    if (this.phaseWatchdogTimer) {
      clearTimeout(this.phaseWatchdogTimer)
      this.phaseWatchdogTimer = null
    }
    ++this.phaseWatchdogToken
  }

  private warmedUrls = new Set<string>()

  private prefetchUrl(url: string | undefined, priority: RequestPriority = 'auto'): void {
    // Warm the BROWSER HTTP cache ahead of playback with a plain GET.
    //
    // History: this was disabled 2026-05-23 because it warmed the SW
    // CacheFirst layer with a full 200, which then poisoned iOS Safari's
    // later Range request (got 200, expected 206). That hazard is gone:
    // audio was removed from the service worker entirely (2026-05-24), so
    // this fetch now populates the browser's own immutable HTTP cache.
    // The audio element's later Range request is served from that cached
    // full body as a correct 206 by the browser itself — no SW, no CDN
    // range-mangling. Re-enabled so the 1-cycle lookahead works again.
    //
    // Blob URLs (already local in IndexedDB) and empty strings have
    // nothing to warm. Each URL is fetched at most once per session.
    if (!url || url.startsWith('blob:')) return
    if (this.warmedUrls.has(url)) return
    this.warmedUrls.add(url)
    try {
      void fetch(url, { priority }).catch(() => {})
    } catch {
      // best-effort; never let a warm-up throw into the playback path
    }
  }

  /**
   * Look one cycle ahead in the rounds queue and warm its three audio URLs.
   * Crosses round boundaries: if we're at the last cycle of round N, peeks
   * at round N+1 cycle 0. Returns silently if there's no next cycle (end
   * of session).
   *
   * Known audio is fetched with priority='high' because it plays the
   * instant the next cycle begins — no buffer phase to absorb late
   * arrival. Voice1 and voice2 are 'low' because they sit behind PROMPT
   * + PAUSE (~5-8s) and can comfortably load during that window.
   */
  private prefetchNextCycle(): void {
    const round = this.currentRound
    if (!round) return
    const nextCycleIdx = this.state.cycleIndex + 1
    let nextCycle: Cycle | undefined
    if (nextCycleIdx < round.cycles.length) {
      nextCycle = round.cycles[nextCycleIdx]
    } else {
      const nextRound = this.rounds[this.state.roundIndex + 1]
      nextCycle = nextRound?.cycles[0]
    }
    if (!nextCycle) return
    this.prefetchUrl(nextCycle.known?.audioUrl, 'high')
    this.prefetchUrl(nextCycle.target?.voice1Url, 'low')
    this.prefetchUrl(nextCycle.target?.voice2Url, 'low')
  }

  private playAudio(url: string, isTarget = false): void {
    this.clearSafetyTimer()
    const gen = ++this.playGeneration
    this.lastAssignedSrcGen = gen
    // Reset retry state on EVERY fresh play — the retry budget is per play
    // attempt, not per URL. Gating this on `retryUrl !== url` meant a clip
    // that had already burned its retry once (spaced repetition replays the
    // same audio; resume() replays the same prompt) skipped straight to the
    // failure path on its next attempt, with no second chance.
    this.retryAttempted = false
    this.retryUrl = url
    this.retryIsTarget = isTarget
    this.markSelfAudioStop()
    this.audio.src = url
    // Only modulate target language audio — known language always plays at 1.0x.
    // The baked rate is the whole truth: no mode may multiply it (see the
    // runtime-overrides note at the top of this file).
    let rate = 1.0
    if (isTarget && this.currentCycle) {
      rate = this.currentCycle.playbackSpeed ?? 1.0
    }
    // Speed >1.05× is unexpected on speaking cycles (neither Easy nor Fast
    // exceeds 1.0×) but expected on L1 ps2x and L2 pod-stage 2× plays.
    // Only warn for non-listening cycles to keep the console useful.
    const isExpectedFastCycle = this.currentCycle?.type === 'listening'
      || this.currentCycle?.type === 'pod'
    if (rate > 1.05 && !isExpectedFastCycle) {
      console.warn(`[SimplePlayer] ⚠️ SPEED ${rate}x on "${this.currentCycle?.target?.text}" (cycle.playbackSpeed=${this.currentCycle?.playbackSpeed})`)
    }
    this.audio.playbackRate = rate
    this.audio.play().catch((err) => {
      // Ignore rejections from superseded play() calls (e.g. "interrupted by new load")
      if (gen !== this.playGeneration) return
      console.warn('[SimplePlayer] play() rejected:', err.message)
      if (isGestureRequiredError(err)) {
        // Autoplay policy blocked us — pause so the UI can prompt
        // "tap to resume". The browser will not let us play anything
        // else until the user taps, so we halt regardless of retry.
        this.tripGestureRequired(err.message || 'autoplay blocked')
        return
      }
      // Any other play() rejection (bad src, network, decode) — try
      // once more, then halt. Don't silently advance — that lies to
      // the learner about what they just heard.
      this.handleAudioFailure(undefined, err?.message)
    })
    // Arm the stall watchdog. Reset the progress marker first so the first
    // timeupdate for this clip counts as progress and reschedules cleanly.
    this.lastAudioCurrentTime = 0
    this.armSafetyTimer(gen)
  }

  /**
   * Arm (or re-arm) the play-path safety watchdog for a given play generation.
   * This is a STALL detector, not an absolute play deadline: noteAudioProgress
   * reschedules it every time real playback progress is observed, so a clip
   * that legitimately runs longer than the window is NEVER truncated. Only a
   * genuinely stalled element — no `timeupdate` progress for the whole window —
   * fires, advancing rather than hanging. Firing is gated on the generation so
   * a superseded play can't advance the machine (the "silently advancing lies
   * to the learner" failure this timer exists to prevent, without the old
   * false-positive on long clips).
   */
  private armSafetyTimer(gen: number): void {
    this.clearSafetyTimer()
    this.safetyGen = gen
    this.safetyTimer = setTimeout(() => {
      if (gen !== this.playGeneration) return
      console.warn('[SimplePlayer] Safety timeout — audio stalled (no progress for 10s), advancing')
      this.onAudioEnded()
    }, 10_000)
  }

  /**
   * Feed the stall watchdog from `timeupdate`/`loadedmetadata`. Reschedules the
   * safety timer whenever currentTime advances. Guarded so only the currently
   * armed play-path watchdog is rescheduled — pause-clip and idle timeupdates,
   * and the retry path's own hard deadline, must not re-arm it.
   */
  private noteAudioProgress(): void {
    if (!this.safetyTimer || this.safetyGen !== this.playGeneration) return
    const t = this.audio.currentTime
    if (t > this.lastAudioCurrentTime) {
      this.lastAudioCurrentTime = t
      // Real, audible progress — the run of skipped clips (if any) is over.
      this.consecutiveSkips = 0
      this.armSafetyTimer(this.safetyGen)
    }
  }

  private startPausePhase(): void {
    const cycle = this.currentCycle
    // The mode runtime override can shorten the pause; if it returns
    // undefined, fall back to the baked cycle.pauseDuration.
    const override = cycle ? this.runtimeOverrides.getPauseDuration?.(cycle) : undefined
    const duration = override ?? cycle?.pauseDuration ?? DEFAULT_PAUSE_DURATION
    this.pauseEndsAt = Date.now() + duration

    // Play a genuinely-silent ONE-SHOT clip on the MAIN element for the pause.
    // Its 'ended' (a background-safe media event) OR the trim timer below —
    // whichever fires first — advances to voice1. The clip is what keeps the
    // now-playing session asserted and the advance firing while the tab is
    // backgrounded / the screen is locked, exactly as the pod lap's real
    // clips do. The clip is longer than any realistic pause; the trim timer
    // cuts it to the precise pause duration for this cycle. See
    // buildSilentWavDataUri.
    const gen = ++this.playGeneration
    this.lastAssignedSrcGen = gen
    this.pauseClipActive = true
    try {
      this.markSelfAudioStop()
      this.audio.src = SILENT_PAUSE_CLIP
      this.audio.playbackRate = 1.0
      this.audio.loop = false // NEVER loop — that is the disabled oscillation landmine.
      const p = this.audio.play()
      // Some environments (and the test stub) return undefined from play().
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // The pause clip is non-critical: if it can't sound (rare), the trim
          // timer still advances the pause. Never halt the cycle on silence,
          // and never trip the gesture-required path off the silent clip.
        })
      }
    } catch {
      // Ditto — fall through to the timer.
    }

    // Trim timer: bounds the (longer) clip to the exact pause duration for
    // this cycle. While foregrounded this fires on time; while backgrounded iOS
    // may throttle it, in which case the clip's own 'ended' (or the visibility
    // catch-up) carries the advance instead.
    this.pauseTimer = setTimeout(() => {
      if (gen !== this.playGeneration) return
      this.endPausePhase()
    }, duration)
  }

  /**
   * Advance out of the PAUSE phase exactly once. Stops the silent clip,
   * invalidates the trim timer + any late 'ended', and routes through the
   * normal onAudioEnded hub so pause→voice1 is identical to every other phase
   * transition. Idempotent: the playGeneration bump makes a second caller
   * (e.g. the clip 'ended' arriving just after the trim timer) a no-op.
   */
  private endPausePhase(): void {
    if (this.state.phase !== 'pause' || !this.state.isPlaying) return
    if (!this.pauseClipActive) return
    this.pauseClipActive = false
    this.pauseEndsAt = 0
    ++this.playGeneration // invalidate the trim timer and any trailing 'ended'
    this.clearPauseTimer()
    this.stopAudioElement()
    this.onAudioEnded()
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
    // Stop the silent pause clip wherever the timer is cleared. Every exit path
    // (pause / skipToPhase / skipRound / jumpToRound / stop / trip*) already
    // calls clearPauseTimer, so this is the single chokepoint that guarantees
    // the clip is never left sounding — zero new call sites needed.
    if (this.pauseClipActive) {
      this.pauseClipActive = false
      this.pauseEndsAt = 0
      try { this.stopAudioElement() } catch { /* element may already be torn down */ }
    }
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer)
      this.safetyTimer = null
    }
    // Single chokepoint for the phase-start watchdog too. Every path that
    // stops or supersedes a phase already calls this (playAudio, pause, stop,
    // stopForReposition, onAudioEnded, tripGestureRequired, retryCurrentAudio),
    // so the watchdog is disarmed exactly when it stops being the thing
    // protecting the learner — and re-armed by the next startPhase.
    this.clearPhaseWatchdog()
  }

  private clearLingerTimer(): void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer)
      this.lingerTimer = null
    }
    // Stop the silent linger clip wherever the timer is cleared — the same
    // single chokepoint clearPauseTimer uses. Every exit path (pause / stop /
    // stopForReposition / tripGestureRequired) already calls this, so the clip
    // can never be left sounding into the next cycle.
    if (this.lingerClipActive) {
      this.lingerClipActive = false
      try { this.stopAudioElement() } catch { /* element may already be torn down */ }
    }
  }

  private onAudioEnded(): void {
    this.clearSafetyTimer()
    if (!this.state.isPlaying) return

    // The silent pause clip reaching its natural end is the background-safe
    // trigger for pause→voice1. Route it through endPausePhase so it shares the
    // single, generation-guarded advance path with the trim timer (no double
    // advance, clip stopped, isPlaying re-checked).
    if (this.state.phase === 'pause' && this.pauseClipActive) {
      this.endPausePhase()
      return
    }

    // The silent linger clip reaching its natural end is the background-safe
    // trigger for "post-voice2 hold is over". Route it through endLinger so it
    // shares the single, generation-guarded advance path with the backstop
    // timer. Checked BEFORE getNextPhase because the phase is still 'voice2'
    // here — without this we'd fall straight back into the linger branch.
    if (this.lingerClipActive) {
      this.endLinger()
      return
    }

    const nextPhase = this.getNextPhase()
    if (nextPhase) {
      this.startPhase(nextPhase)
    } else {
      // End of cycle — hold before the next cycle starts. Two sources, and we
      // take the longer: the cycle's own baked linger (intro/debut tiles stay
      // visible) and the active mode's post-voice2 gap (Easy).
      const cycle = this.currentCycle
      const modeGap = cycle ? this.runtimeOverrides.getPostVoice2GapMs?.(cycle) : undefined
      const linger = Math.max(cycle?.lingerMs ?? 0, modeGap ?? 0)
      if (linger > 0) {
        this.startLinger(linger)
      } else {
        this.advanceCycle()
      }
    }
  }

  /**
   * Hold after voice2 for `duration` ms, then advance to the next cycle.
   *
   * Sounds an exactly-`duration` silent clip on the MAIN element so the hold
   * advances on a media 'ended' event rather than a bare setTimeout — the same
   * background/lock-screen protocol the PAUSE phase uses (see the
   * "Background-safe PAUSE phase" block above). The timer is kept as an equal-
   * length backstop for environments where the clip can't sound; whichever
   * fires first advances, guarded by playGeneration against a double advance.
   */
  private startLinger(duration: number): void {
    const gen = ++this.playGeneration
    this.lastAssignedSrcGen = gen
    this.lingerClipActive = true
    try {
      this.markSelfAudioStop()
      this.audio.src = silentClipForMs(duration)
      this.audio.playbackRate = 1.0
      this.audio.loop = false // NEVER loop — the disabled 2026-05-23 oscillation landmine.
      const p = this.audio.play()
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Non-critical: the backstop timer still ends the hold. Never halt
          // the cycle on silence, and never trip gesture-required off it.
        })
      }
    } catch {
      // Ditto — fall through to the timer.
    }

    this.lingerTimer = setTimeout(() => {
      if (gen !== this.playGeneration) return
      this.endLinger()
    }, duration)
  }

  /**
   * End the post-voice2 hold exactly once and advance. Idempotent: the
   * playGeneration bump makes a second caller (clip 'ended' arriving just
   * after the backstop timer, or vice versa) a no-op.
   */
  private endLinger(): void {
    if (!this.lingerClipActive) return
    this.lingerClipActive = false
    ++this.playGeneration // invalidate the backstop timer and any trailing 'ended'
    this.clearLingerTimer()
    this.stopAudioElement()
    if (this.state.isPlaying) this.advanceCycle()
  }

  private getNextPhase(): Phase | null {
    // Simple transitions: prompt → pause → voice1 → voice2 → (next cycle)
    // Skip pause entirely for intro cycles (pauseDuration === 0) to avoid event-loop gap
    if (this.state.phase === 'prompt' && this.currentCycle?.pauseDuration === 0) {
      return 'voice1'
    }
    const transitions: Record<Phase, Phase | null> = {
      idle: null,
      buffering: null,  // No auto-advance; startPhase('prompt') handles the buffering→prompt transition explicitly
      prompt: 'pause',
      pause: 'voice1',
      voice1: 'voice2',
      voice2: null,  // End of cycle, advance to next
    }
    return transitions[this.state.phase]
  }

  /** The active mode's repeat count for a cycle, read LIVE and clamped to 2. */
  private repeatCountFor(cycle: Cycle | null): number {
    if (!cycle) return 1
    const raw = this.runtimeOverrides.getCycleRepeatCount?.(cycle)
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
    return Math.max(1, Math.min(Math.floor(raw), MAX_CYCLE_PLAYS))
  }

  private advanceCycle(): void {
    this.emit('cycle_completed', { cycle: this.currentCycle, round: this.currentRound })

    // LIVE repeat decision — the walker's, not the script's (Tom, 2026-08-09).
    // Asked HERE, at the moment the cycle ends, so a mode flipped halfway
    // through a round is obeyed by this very step: Easy→Fast stops the second
    // play of the phrase in flight, Fast→Easy grants it. Snapshotting the mode
    // at round start is exactly the bug.
    const justPlayed = this.currentCycle
    this.currentCyclePlays += 1
    if (
      justPlayed &&
      this.currentCyclePlays < this.repeatCountFor(justPlayed) &&
      !this.runtimeOverrides.shouldSkipCycle?.(justPlayed)
    ) {
      this.startPhase('prompt')
      return
    }
    this.currentCyclePlays = 0

    const round = this.currentRound
    if (!round || !round.cycles) {
      console.warn('[SimplePlayer] No round or cycles in advanceCycle, advancing to next round')
      this.advanceRound()
      return
    }
    // Find the next non-skipped cycle. Lets the runtime cull take effect
    // mid-round: the current cycle finishes, then the override jumps over
    // any cycles it now wants skipped before the next prompt.
    const nextIdx = this.findNextPlayableCycleIndex(round, this.state.cycleIndex + 1)
    if (nextIdx !== -1) {
      this.currentCyclePlays = 0
      this.updateState({ cycleIndex: nextIdx })
      this.startPhase('prompt')
    } else {
      this.advanceRound()
    }
  }

  private advanceRound(): void {
    this.emit('round_completed', { round: this.currentRound })
    this.currentCyclePlays = 0

    // The round_completed listener (LearningPlayer.handleRoundBoundary) runs
    // synchronously up to its first await; it can call pause() in that window
    // to schedule a between-round pod lap or commentary. If it did, isPlaying
    // is now false and we must NOT start the next round's prompt — that
    // would overlap with the pod lap on a separate audio element. We still
    // advance roundIndex so resume() picks up at the next round, with phase
    // set to 'idle' so resume() routes through startPhase('prompt').
    if (!this.state.isPlaying) {
      if (this.state.roundIndex < this.rounds.length - 1) {
        const nextIndex = this.state.roundIndex + 1
        this.updateState({
          roundIndex: nextIndex,
          cycleIndex: this.firstPlayableCycleIndex(this.rounds[nextIndex]),
          phase: 'idle',
        })
      } else {
        this.updateState({ phase: 'idle' })
        this.emit('session_complete')
      }
      return
    }

    if (this.state.roundIndex < this.rounds.length - 1) {
      const nextIndex = this.state.roundIndex + 1
      const nextRound = this.rounds[nextIndex]
      // POSITION IS NOT PLAY SEQUENCE (Tom, 2026-08-09). Entering a round used
      // to mean position 0, literally — which is only ever right because
      // position 0 is the intro. The moment the active mode selects an early
      // cycle out, opening at 0 plays a cycle this mode said not to play. So
      // the entry point is DERIVED here, live, exactly as play() already
      // derived it from a standstill; and a round the mode empties entirely is
      // stepped over rather than stalled on.
      const startIdx = this.findNextPlayableCycleIndex(nextRound, 0)
      if (startIdx === -1) {
        console.debug(`[SimplePlayer] Round ${nextRound?.roundNumber}: every cycle selected out by the active mode, stepping over`)
        this.updateState({ roundIndex: nextIndex, cycleIndex: 0 })
        this.advanceRound()
        return
      }
      this.updateState({ roundIndex: nextIndex, cycleIndex: startIdx })
      const round = this.currentRound
      if (round) {
        console.debug(`[SimplePlayer] Starting Round ${round.roundNumber} (${round.legoId}): ${round.cycles.length} cycles`)
      }
      this.startPhase('prompt')
    } else {
      console.log('[SimplePlayer] Session complete')
      this.updateState({ phase: 'idle', isPlaying: false })
      this.emit('session_complete')
    }
  }

  private updateState(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial }
    this.emit('state_changed', this.currentState)
  }

  dispose(): void {
    this.stop()
    this.audio.removeEventListener('ended', this.onEndedHandler)
    this.audio.removeEventListener('error', this.onErrorHandler)
    this.audio.removeEventListener('pause', this.onPauseHandler)
    this.audio.removeEventListener('timeupdate', this.onTimeUpdateHandler)
    this.audio.removeEventListener('loadedmetadata', this.onTimeUpdateHandler)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityHandler)
    }
    this.listeners.clear()
  }
}
