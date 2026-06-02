// SimplePlayer.ts - Clean playback engine (~180 lines)

export interface Cycle {
  id: string
  /**
   * Source ScriptItem type. Optional — older cycles in cache may not carry it.
   * Used by the UI to subtly cue the skip button during listening cycles
   * (listen_intro/listening/pod/listen_outro) without changing button behaviour.
   */
  type?: string
  known: { text: string; audioUrl: string }
  target: { text: string; textNative?: string; voice1Url: string; voice2Url: string }
  pauseDuration?: number // ms — set by toSimpleRounds formula
  lingerMs?: number // ms — extra hold after voice2 (intro/debut: lets learner read tiles)
  legoId?: string // The LEGO this cycle is practising
  seedId?: string // S#### seed prefix — used by telemetry/logEvent
  componentLegoIds?: string[]
  componentLegoTexts?: string[]
  componentLegoTextsNative?: string[]
  /** Authoritative content-level tiling from the backend (Popty), served
   * verbatim on course_practice_phrases.decomposition. When present the player
   * renders these blocks directly instead of re-deriving by runtime alignment. */
  decomposition?: Array<{ legoId: string | null; target: string; known: string; isGhost: boolean; isSalient?: boolean }>

  /** M-LEGO component breakdown for visual display */
  components?: Array<{ known: string; target: string }>
  componentsNative?: Array<{ known: string; target: string }>
  /** Listening phase: playback speed multiplier (1.0 = normal, 2.0 = double) */
  playbackSpeed?: number
  /** Raw target audio durations (ms). Kept on the cycle so runtime overrides
   * (e.g. Turbo) can recompute pauseDuration with a different formula
   * instead of just scaling the baked value. */
  target1DurationMs?: number
  target2DurationMs?: number
  /** Tagged at script-generation time on cycles that Turbo skips: 4th–7th
   * BUILD phrases, 2nd USE phrase, spaced_rep at alternate fib offsets.
   * intro/debut/listening/pod/bookend cycles are never tagged. SimplePlayer
   * consults the runtime override (which checks turboActive) to decide
   * whether to actually skip. */
  turboOmit?: boolean
}

/**
 * Runtime overrides that LearningPlayer can supply to apply mode-dependent
 * timing (Turbo) without baking it into the script. Pure callbacks — the
 * engine reads them at the moment of each phase, so flipping Turbo
 * mid-round takes effect on the very next pause / voice phase.
 */
export interface SimplePlayerRuntimeOverrides {
  /** Return ms to override cycle.pauseDuration for this cycle, or undefined to use the baked value. */
  getPauseDuration?: (cycle: Cycle) => number | undefined
  /** Return a multiplier applied to the cycle's playback rate (target voices only). 1.0 = no change. */
  getPlaybackSpeedMultiplier?: (cycle: Cycle) => number
  /** Return true to skip this cycle entirely (advance to the next). Used by Turbo to
   * cull turboOmit-tagged cycles. Consulted before starting any phase, so toggling
   * Turbo mid-round shortens the remaining round on the next cycle boundary. */
  shouldSkipCycle?: (cycle: Cycle) => boolean
  /**
   * Optional pre-PROMPT gate. Resolves when this cycle's known audio is
   * ready to play from the local cache. While we wait, the player sits
   * in the 'buffering' phase — the UI can surface a subtle message
   * after a brief threshold so the learner sees an explanation instead
   * of a silent PROMPT.
   *
   * Implementations MUST bound the wait (5s is a reasonable ceiling).
   * If the override rejects or times out, we fall through to playAudio
   * and the existing retry-once-then-halt machinery takes over — so a
   * permanent network failure still surfaces as a clean halt, not a
   * deadlocked player. */
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

export interface Round {
  roundNumber: number
  legoId: string
  seedId: string
  /** Canonical LEGO target text (from intro item — never inferred from cycles) */
  legoTargetText?: string
  /** Native script variant of legoTargetText */
  legoTargetTextNative?: string
  /** Canonical LEGO known text (from intro item) */
  legoKnownText?: string
  cycles: Cycle[]
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
type EventCallback = (data?: unknown) => void

export interface AudioFailedEvent {
  /**
   * - 'needs-gesture': iOS Safari revoked the audio unlock (backgrounded
   *   tab); play() rejected with NotAllowedError. UI prompts "tap to
   *   resume" and a user tap restores playback. The browser will not
   *   play ANY audio until that tap, so we must halt.
   * - 'play-error': audio element fired `error` (bad UUID / 404 / decode
   *   / CORS / blob-URL race against BundleDownloader). Emitted twice
   *   per cycle in the failure path: once with attempt=1 just before
   *   the silent retry, and once with attempt=2 if the retry also
   *   fails. The attempt=2 emission accompanies a halt — the player
   *   pauses and the UI offers tap-to-retry — because advancing the
   *   phase machine while no sound came out lies to the learner about
   *   what they just heard.
   */
  reason: 'needs-gesture' | 'play-error'
  /**
   * Cycle role the failure occurred on — lets diagnostics see whether
   * blob-URL races skew toward target voices (the bigger files that
   * BundleDownloader fetches later) vs the known prompt.
   */
  role?: 'known' | 'target1' | 'target2'
  cycleType?: string
  legoId?: string
  cycleId?: string
  /** HTMLMediaElement.error?.code if available (1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED). */
  errorCode?: number
  /** 1 = first try, 2 = retry. attempt=2 in a 'play-error' event means we've halted. */
  attempt?: 1 | 2
  lastError?: string
}

// Fallback: bootUpTime(2000) + scaleFactor(0.75) × estimatedTarget(6000) = 6500ms
const DEFAULT_PAUSE_DURATION = 6500

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
  private lingerTimer: ReturnType<typeof setTimeout> | null = null
  private listeners: Map<EventName, Set<EventCallback>> = new Map()

  // Named handlers for cleanup in dispose()
  private onEndedHandler: () => void
  private onErrorHandler: (e: Event) => void
  // Keeps navigator.mediaSession's position state fresh as each clip plays so
  // Android Chrome sees an active, advancing media session and is less likely
  // to suspend the backgrounded/locked tab (the cause of "finishes the phrase
  // then stops" online). Heuristic background-survival aid. Tom 2026-05-31.
  private onTimeUpdateHandler: () => void
  // Generation counter: increments on every playAudio call.
  // Stale play() rejections and safety timeouts check this to avoid
  // advancing the phase machine from a superseded audio request.
  private playGeneration: number = 0
  // Single silent retry for transient audio failures. Most production
  // errors are blob-URL races (BundleDownloader hasn't reached this
  // audio yet) — re-setting src + calling load()/play() against the
  // proxy URL almost always succeeds the second time. Tracks the URL
  // so we don't retry a different audio if playAudio fired in between.
  private retryAttempted: boolean = false
  private retryUrl: string | null = null
  private retryIsTarget: boolean = false

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
      const code = this.audio.error?.code
      console.warn(`[SimplePlayer] audio error (code=${code}) on phase=${this.state.phase}`, e)
      this.handleAudioFailure(code)
    }

    this.audio.addEventListener('ended', this.onEndedHandler)
    this.audio.addEventListener('error', this.onErrorHandler)
    this.onTimeUpdateHandler = () => this.updateMediaPositionState()
    this.audio.addEventListener('timeupdate', this.onTimeUpdateHandler)
    this.audio.addEventListener('loadedmetadata', this.onTimeUpdateHandler)
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
    this.audio.pause()
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

    if (!this.retryAttempted && this.retryUrl) {
      // First failure — log and silently retry the same URL.
      this.retryAttempted = true
      this.emit('audio_failed', this.buildFailedContext(errorCode, 1, lastError))
      this.retryCurrentAudio()
      return
    }

    // Retry already burned (or no URL to retry against) — halt.
    this.tripPlayError(errorCode, lastError)
  }

  /**
   * Re-set the audio src and call load()+play() against the same URL.
   * Browsers retry the network fetch — most blob-URL races against
   * BundleDownloader resolve here because by the time we re-fetch the
   * bundle has reached this audio. Reuses the same Audio element so
   * the mobile gesture unlock stays intact.
   */
  private retryCurrentAudio(): void {
    const url = this.retryUrl
    if (!url) return
    const isTarget = this.retryIsTarget
    this.clearSafetyTimer()
    const gen = ++this.playGeneration
    console.warn(`[SimplePlayer] Retrying audio (attempt 2/2): ${url}`)
    try {
      this.audio.src = url
      this.audio.load()
    } catch (err) {
      console.warn('[SimplePlayer] retry load() threw:', err)
    }
    let rate = 1.0
    if (isTarget && this.currentCycle) {
      rate = this.currentCycle.playbackSpeed ?? 1.0
      const multiplier = this.runtimeOverrides.getPlaybackSpeedMultiplier?.(this.currentCycle) ?? 1.0
      rate *= multiplier
    }
    this.audio.playbackRate = rate
    this.audio.play().catch((err) => {
      if (gen !== this.playGeneration) return
      console.warn('[SimplePlayer] retry play() rejected:', err?.message)
      if (isGestureRequiredError(err)) {
        this.tripGestureRequired(err.message || 'autoplay blocked')
        return
      }
      // Retry failed — halt with the play-error reason.
      this.tripPlayError(undefined, err?.message)
    })
    this.safetyTimer = setTimeout(() => {
      if (gen !== this.playGeneration) return
      console.warn('[SimplePlayer] Safety timeout on retry — halting')
      this.tripPlayError(undefined, 'safety-timeout-after-retry')
    }, 10_000)
  }

  /**
   * Halt the player after a failed retry. Same shape as
   * tripGestureRequired: pause audio, clear timers, drop isPlaying, emit
   * audio_failed. UI surfaces a "tap to retry" affordance bound to the
   * same resume() flow as the gesture-required path.
   */
  private tripPlayError(errorCode: number | undefined, lastError?: string): void {
    console.warn('[SimplePlayer] Audio playback failed after retry — halting session')
    this.audio.pause()
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.updateState({ isPlaying: false })
    this.emit('audio_failed', this.buildFailedContext(errorCode, 2, lastError))
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
   * Replace the runtime overrides. Used when LearningPlayer wants to
   * supply Turbo-aware callbacks after the player has been constructed,
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
        if (insertIndex <= this.state.roundIndex) {
          this.state.roundIndex++
        }
      }
      existingLegoIds.add(round.legoId)
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
  private findNextPlayableCycleIndex(round: Round, fromIndex: number): number {
    const skip = this.runtimeOverrides.shouldSkipCycle
    if (!skip) return fromIndex < round.cycles.length ? fromIndex : -1
    for (let i = fromIndex; i < round.cycles.length; i++) {
      if (!skip(round.cycles[i])) return i
    }
    return -1
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
    // Skip leading turboOmit cycles when Turbo is on. If every cycle is
    // skipped, the round is empty in this mode — advance to the next.
    const startIdx = this.findNextPlayableCycleIndex(round, this.state.cycleIndex)
    if (startIdx === -1) {
      console.debug(`[SimplePlayer] Round ${round.roundNumber}: all cycles skipped under Turbo, advancing`)
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
    this.audio.pause()
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
    this.startPhase('prompt')
  }

  stop(): void {
    this.audio.pause()
    this.audio.src = ''
    this.audio.playbackRate = 1.0
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.updateState({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
  }

  // Mirror of findNextPlayableCycleIndex, walking backwards. Used by
  // stepCycle(-1) so a Turbo-culled cycle is skipped over when stepping
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
   * Turbo-skipped cycles are honoured via find{Next,Prev}PlayableCycleIndex
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
    this.audio.pause()
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    if (!this.state.isPlaying) {
      this.updateState({ isPlaying: true })
    }
    this.startPhase(phase)
  }

  skipRound(): void {
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.audio.pause()
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
    const safeCycle = cycleCount > 0
      ? Math.min(Math.max(cycleIndex | 0, 0), cycleCount - 1)
      : 0
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.audio.pause()
    this.audio.src = ''
    const wasPlaying = this.state.isPlaying
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

    // Safety check: ensure we have the required data before playing
    const currentCycle = this.currentCycle

    // Listening / pod / bookend cycles only carry ONE audio track each
    // (target at 1×/2× OR known for translation). The 4-phase prompt /
    // pause / voice1 / voice2 walk hits phases that legitimately have
    // no audio — those gaps are by design, not missing data. Suppress
    // the warning for these cycle types so the console stays useful
    // for real audio gaps in speaking cycles.
    const isSingleAudioCycle = currentCycle?.type === 'listening'
      || currentCycle?.type === 'pod'
      || currentCycle?.type === 'listen_intro'
      || currentCycle?.type === 'listen_outro'

    switch (phase) {
      case 'prompt':
        // Warm the SW cache for THIS cycle's voice1/voice2 during the
        // PROMPT + PAUSE window (5-8s of dead network time). For LEGOs
        // already in AudioCache the URL is blob: and prefetchUrl no-ops;
        // for proxy URLs not yet covered by BundleDownloader, this lands
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
              await ensureReady(currentCycle)
            } catch (err) {
              // Override rejected or timed out. Fall through to play
              // attempt — if bytes really never arrive, the audio
              // element's retry-once-then-halt path will produce a
              // proper learner-visible halt instead of silent skip.
              console.warn('[SimplePlayer] ensureKnownReady rejected; falling through to play attempt', err)
            }
            // Bail if we were stopped, skipped, or moved on during the
            // wait. Anything that changes phase away from 'buffering'
            // or pauses playback supersedes this branch.
            if (this.state.phase !== 'buffering' || !this.state.isPlaying) return
            this.updateState({ phase: 'prompt' })
          }
          this.playAudio(await this.resolveUrl(currentCycle.known.audioUrl))
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
          this.playAudio(await this.resolveUrl(currentCycle.target.voice1Url), true)
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
          this.playAudio(await this.resolveUrl(currentCycle.target.voice2Url), true)
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
      const resolved = await resolver(url)
      return resolved || url
    } catch (err) {
      console.warn('[SimplePlayer] resolveAudioUrl threw; using original URL', err)
      return url
    }
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
    // Reset retry state on every fresh play. retryAttempted only stays
    // true between the first failure and either (a) the retry succeeding
    // or (b) playAudio being called again for a different URL.
    if (this.retryUrl !== url) {
      this.retryAttempted = false
      this.retryUrl = url
      this.retryIsTarget = isTarget
    }
    this.audio.src = url
    // Only modulate target language audio — known language always plays at 1.0x.
    // Runtime override (Turbo) can multiply the baked rate; the override is
    // expected to gate itself on cycle type so it doesn't double up on
    // listening cycles that already have an explicit speed.
    let rate = 1.0
    if (isTarget && this.currentCycle) {
      rate = this.currentCycle.playbackSpeed ?? 1.0
      const multiplier = this.runtimeOverrides.getPlaybackSpeedMultiplier?.(this.currentCycle) ?? 1.0
      rate *= multiplier
    }
    // Speed >1.05× is unexpected on speaking cycles (Turbo only goes
    // to 1.25×) but expected on L1 ps2x and L2 pod-stage 2× plays.
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
    this.safetyTimer = setTimeout(() => {
      // Ignore if a newer playAudio call has started
      if (gen !== this.playGeneration) return
      console.warn('[SimplePlayer] Safety timeout — audio ended event never fired, advancing')
      this.onAudioEnded()
    }, 10_000)
  }

  private startPausePhase(): void {
    const cycle = this.currentCycle
    // Runtime override (Turbo) can shorten the pause; if it returns
    // undefined, fall back to the baked cycle.pauseDuration.
    const override = cycle ? this.runtimeOverrides.getPauseDuration?.(cycle) : undefined
    const duration = override ?? cycle?.pauseDuration ?? DEFAULT_PAUSE_DURATION
    this.pauseTimer = setTimeout(() => {
      if (this.state.isPlaying) this.onAudioEnded()
    }, duration)
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer)
      this.safetyTimer = null
    }
  }

  private clearLingerTimer(): void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer)
      this.lingerTimer = null
    }
  }

  private onAudioEnded(): void {
    this.clearSafetyTimer()
    if (!this.state.isPlaying) return

    const nextPhase = this.getNextPhase()
    if (nextPhase) {
      this.startPhase(nextPhase)
    } else {
      // End of cycle — linger if requested (intro/debut tiles stay visible)
      const linger = this.currentCycle?.lingerMs
      if (linger && linger > 0) {
        this.lingerTimer = setTimeout(() => {
          this.lingerTimer = null
          if (this.state.isPlaying) this.advanceCycle()
        }, linger)
      } else {
        this.advanceCycle()
      }
    }
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

  private advanceCycle(): void {
    this.emit('cycle_completed', { cycle: this.currentCycle, round: this.currentRound })

    const round = this.currentRound
    if (!round || !round.cycles) {
      console.warn('[SimplePlayer] No round or cycles in advanceCycle, advancing to next round')
      this.advanceRound()
      return
    }
    // Find the next non-skipped cycle. Lets Turbo cull tagged cycles
    // mid-round: the current cycle finishes, then the runtime override
    // jumps over any turboOmit'd cycles before the next prompt.
    const nextIdx = this.findNextPlayableCycleIndex(round, this.state.cycleIndex + 1)
    if (nextIdx !== -1) {
      this.updateState({ cycleIndex: nextIdx })
      this.startPhase('prompt')
    } else {
      this.advanceRound()
    }
  }

  private advanceRound(): void {
    this.emit('round_completed', { round: this.currentRound })

    // The round_completed listener (LearningPlayer.handleRoundBoundary) runs
    // synchronously up to its first await; it can call pause() in that window
    // to schedule a between-round pod lap or commentary. If it did, isPlaying
    // is now false and we must NOT start the next round's prompt — that
    // would overlap with the pod lap on a separate audio element. We still
    // advance roundIndex so resume() picks up at the next round, with phase
    // set to 'idle' so resume() routes through startPhase('prompt').
    if (!this.state.isPlaying) {
      if (this.state.roundIndex < this.rounds.length - 1) {
        this.updateState({ roundIndex: this.state.roundIndex + 1, cycleIndex: 0, phase: 'idle' })
      } else {
        this.updateState({ phase: 'idle' })
        this.emit('session_complete')
      }
      return
    }

    if (this.state.roundIndex < this.rounds.length - 1) {
      this.updateState({ roundIndex: this.state.roundIndex + 1, cycleIndex: 0 })
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
    this.audio.removeEventListener('timeupdate', this.onTimeUpdateHandler)
    this.audio.removeEventListener('loadedmetadata', this.onTimeUpdateHandler)
    this.listeners.clear()
  }
}
