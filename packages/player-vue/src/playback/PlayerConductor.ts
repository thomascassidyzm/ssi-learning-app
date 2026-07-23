/**
 * PlayerConductor — the single owner of every SimplePlayer control transition
 * (pause/resume/stop/skip/jump/addRounds/...). See docs/player-decomposition-options.md
 * (Option 2) for the decision this implements.
 *
 * The disease this retires (docs/player-decomposition-options.md "The actual
 * disease"): four bug classes, all from nobody owning "what state is
 * playback in right now, and who's allowed to change it":
 *   - fire-and-forget promises stranding the player paused (ed738a0f)
 *   - async work racing the engine across a skip/jump (73c1507a)
 *   - state mirrors drifting (the cachedRounds/loadedRounds duplicate array)
 *   - silent stale-cache fallbacks deciding policy invisibly
 *
 * The conductor closes the first two structurally:
 *   - every transient state (interlude, seeking) carries its OWN return path
 *     (resumeTo / intent) rather than trusting a detached promise chain to
 *     call resume() correctly on every exit;
 *   - every transient state has a BOUNDED exit — a timeout as well as the
 *     existing try/catch — so a hung interlude can no longer strand the
 *     player forever (ed738a0f's fix caught throws but not a promise that
 *     never settles);
 *   - interlude/seek entries are serialized through one queue, so a
 *     round-boundary interlude and a user-initiated skip can never
 *     interleave their pause/resume calls (73c1507a's race).
 *
 * NOT in scope here: the mirror-drift class (that's the separate
 * cachedRounds/loadedRounds deletion) and stale-cache fallbacks (the
 * offline layer). See the options paper.
 */

export type PlayIntent = 'playing' | 'userPaused'

export type ConductorState =
  | { kind: 'loading' }
  | { kind: 'playing' }
  | { kind: 'userPaused' }
  | { kind: 'ended' }
  | { kind: 'interlude'; interludeKind: string; resumeTo: PlayIntent }
  | { kind: 'seeking'; intent: PlayIntent }

/**
 * The subset of SimplePlayer the conductor needs. Kept narrow (rather than
 * importing the concrete class) so tests can drive the state machine
 * against a trivial fake instead of a full audio-element mock.
 */
export interface ConductorEngine {
  readonly currentState: { isPlaying: boolean }
  play(): void
  pause(): void
  resume(): void
  stop(): void
  skipRound(): void
  stepCycle(direction: 1 | -1): void
  skipToPhase(phase: 'prompt' | 'pause' | 'voice1' | 'voice2'): void
  jumpToRound(index: number, cycleIndex?: number): void
  addRounds(rounds: unknown[]): void
  appendRounds(rounds: unknown[]): void
  replaceQueueFromCurrent(rounds: unknown[]): void
  on(event: 'session_complete', callback: () => void): void
}

export interface RunOptions {
  /** Bounds the interlude/seek body. Default 15s — generous for a network
   * round-trip (audio prefetch, Supabase write) but short enough that a
   * genuinely hung promise still lands the player back in a stable state
   * within one impatient-tap's worth of time. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

export class ConductorTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`[PlayerConductor] "${label}" exceeded its ${ms}ms bound — forcing a landing`)
    this.name = 'ConductorTimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConductorTimeoutError(label, ms)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer)) as Promise<T>
}

function isDev(): boolean {
  try {
    const env = (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }).env
    if (env?.DEV) return true
    if (env?.MODE === 'test') return true
  } catch {
    // import.meta access can throw in some runtimes (e.g. plain CJS test harnesses).
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return true
  return false
}

const GUARDED_METHODS = [
  'play', 'pause', 'resume', 'stop', 'skipRound', 'stepCycle',
  'skipToPhase', 'jumpToRound', 'addRounds', 'appendRounds', 'replaceQueueFromCurrent',
] as const

/**
 * Dev-only runtime assert: flags any call to a SimplePlayer control method
 * that didn't come from this conductor's own callEngine(). Non-blocking
 * (always still calls the original method) — this is a visibility net for
 * the migration, not a hard gate, since call sites migrate incrementally.
 *
 * Shadows the methods on the INSTANCE (not the prototype), so it only ever
 * affects the one engine the conductor owns.
 */
export function installDevGuard(engine: ConductorEngine, conductor: PlayerConductor): void {
  if (!isDev()) return
  for (const name of GUARDED_METHODS) {
    const original = (engine as unknown as Record<string, (...args: unknown[]) => unknown>)[name]
    if (typeof original !== 'function') continue
    const bound = original.bind(engine)
    ;(engine as unknown as Record<string, (...args: unknown[]) => unknown>)[name] = (...args: unknown[]) => {
      if (!conductor.isExecuting) {
        console.error(
          `[PlayerConductor] direct engine.${name}() call bypassing the conductor — ` +
          `route this call site through conductor.request()/runInterlude()/runSeek() instead.`,
          new Error('call site').stack,
        )
      }
      return bound(...args)
    }
  }
}

/**
 * One owner of every SimplePlayer transition. See module docblock.
 */
export class PlayerConductor {
  private engine: ConductorEngine
  private state: ConductorState = { kind: 'loading' }
  private queue: Promise<void> = Promise.resolve()
  private listeners = new Set<(state: ConductorState) => void>()
  private seekGeneration = 0
  private executing = false

  constructor(engine: ConductorEngine, opts: { devGuard?: boolean } = {}) {
    this.engine = engine
    this.engine.on('session_complete', () => this.setState({ kind: 'ended' }))
    if (opts.devGuard !== false) installDevGuard(engine, this)
  }

  get currentState(): ConductorState {
    return this.state
  }

  /** True only while THIS conductor is mid-call into the engine — the dev guard's signal. */
  get isExecuting(): boolean {
    return this.executing
  }

  onStateChanged(callback: (state: ConductorState) => void): void {
    this.listeners.add(callback)
  }

  offStateChanged(callback: (state: ConductorState) => void): void {
    this.listeners.delete(callback)
  }

  private setState(next: ConductorState): void {
    this.state = next
    this.listeners.forEach((cb) => cb(next))
  }

  private callEngine<T>(fn: (engine: ConductorEngine) => T): T {
    this.executing = true
    try {
      return fn(this.engine)
    } finally {
      this.executing = false
    }
  }

  /**
   * Reflect the engine's real isPlaying into a stable top-level state.
   * No-ops while a transient state (interlude/seeking) owns the machine —
   * those land explicitly via landInterlude/landSeek instead, which is what
   * keeps a nested request() (e.g. an interlude body calling pause() then
   * resume() several times) from prematurely flipping the outer state.
   */
  private syncStableState(): void {
    if (this.state.kind === 'interlude' || this.state.kind === 'seeking') return
    this.setState(this.engine.currentState.isPlaying ? { kind: 'playing' } : { kind: 'userPaused' })
  }

  /**
   * Direct, synchronous engine control — play/pause/resume/stop/skip/jump/
   * addRounds and friends, with no async gap between the decision and the
   * call. Always applies immediately: these are instantaneous, so there is
   * nothing to serialize against, and it's what interlude/seek bodies call
   * internally (their own pause()/resume() bracketing) without deadlocking
   * the queue below — request() never touches `queue`.
   */
  request(action: (engine: ConductorEngine) => void): void {
    this.callEngine(action)
    this.syncStableState()
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    // Chain onto the queue regardless of whether the previous entry
    // resolved or rejected — a failed interlude must not wedge every
    // subsequent skip/interlude behind a rejected promise forever.
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * Bracket an async interlude (commentary / pod lap / L1 cup). The
   * conductor does NOT pause the engine on entry — `fn` owns the pause
   * decision entirely, because an interlude body may legitimately decide
   * NOTHING is due (a plain round boundary with no commentary/pod/L1) and
   * playback must flow straight into the next round. An eager pause here
   * combined with "the body decides its own landing on success" stranded
   * the player paused at every no-interlude boundary (the 2026-07-23
   * staging stall): the body played nothing, made no landing decision,
   * and nobody resumed. `fn` keeps its existing internal pause()/resume()
   * logic unchanged (those route through request() and no-op against the
   * top-level state while we're in this interlude) — it decides its own
   * landing on SUCCESS, including deliberately staying paused (e.g. the
   * learner pressed stop mid-lap). Only on FAILURE (thrown error or the
   * timeout bound) does the conductor force a fallback: resume if we were
   * playing before the interlude, exactly the ed738a0f contract, but now
   * bounded by a timeout too, not just a try/catch.
   *
   * Serialized: if an interlude or seek is already in flight, this one
   * queues behind it rather than interleaving.
   */
  runInterlude(kind: string, fn: () => Promise<void>, opts: RunOptions = {}): Promise<void> {
    return this.enqueue(async () => {
      const resumeTo: PlayIntent = this.engine.currentState.isPlaying ? 'playing' : 'userPaused'
      this.setState({ kind: 'interlude', interludeKind: kind, resumeTo })
      let failed = false
      try {
        await withTimeout(fn(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, `interlude:${kind}`)
      } catch (err) {
        failed = true
        console.error(`[PlayerConductor] interlude "${kind}" failed — recovering by resuming:`, err)
      } finally {
        this.landInterlude(kind, resumeTo, failed)
      }
    })
  }

  private landInterlude(kind: string, resumeTo: PlayIntent, failed: boolean): void {
    // A newer transition (another interlude, or a seek) already took the
    // machine somewhere else — that transition owns the landing now.
    if (this.state.kind !== 'interlude' || this.state.interludeKind !== kind) return
    if (failed && resumeTo === 'playing' && !this.engine.currentState.isPlaying) {
      this.callEngine((e) => e.resume())
    }
    this.setState(this.engine.currentState.isPlaying ? { kind: 'playing' } : { kind: 'userPaused' })
  }

  /**
   * Bracket an async seek (skip/jump prep: prefetching the destination's
   * audio before repositioning) around a pause, so the engine can never
   * free-run underneath the prefetch (73c1507a). Captures the pre-skip
   * play intent IN THE STATE ITSELF and restores it once `fn` resolves —
   * `fn` should do its prefetch and call the actual jumpToRound/stepCycle
   * (via request()) but never touch play/pause itself.
   *
   * Cancel-and-replace, not FIFO: a second runSeek call while one is still
   * in flight does NOT wait in a queue behind it (that would stall a rapid
   * double-tap for the first tap's full timeout). Instead it supersedes —
   * the stale call's `isStale()` flips true, its own landing is skipped
   * (the new seek owns that), and only the newest seek's `fn` result is
   * used. This is the seeking(intent) state: bounded exit for BOTH the
   * live seek (lands normally) and every superseded one (bows out silently
   * rather than fighting over the landing).
   */
  async runSeek<T>(fn: (isStale: () => boolean) => Promise<T>, opts: RunOptions = {}): Promise<T | undefined> {
    const myGeneration = ++this.seekGeneration
    const intent: PlayIntent =
      this.state.kind === 'seeking' ? this.state.intent
      : this.engine.currentState.isPlaying ? 'playing' : 'userPaused'
    if (this.state.kind !== 'seeking') {
      this.setState({ kind: 'seeking', intent })
    }
    if (intent === 'playing' && this.engine.currentState.isPlaying) {
      this.callEngine((e) => e.pause())
    }
    const isStale = () => myGeneration !== this.seekGeneration
    try {
      return await withTimeout(fn(isStale), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'seek')
    } catch (err) {
      if (!isStale()) console.error('[PlayerConductor] seek failed — restoring pre-seek play intent:', err)
      return undefined
    } finally {
      if (!isStale()) this.landSeek(intent)
    }
  }

  private landSeek(intent: PlayIntent): void {
    if (this.state.kind !== 'seeking') return
    if (intent === 'playing' && !this.engine.currentState.isPlaying) {
      this.callEngine((e) => e.resume())
    }
    this.setState(this.engine.currentState.isPlaying ? { kind: 'playing' } : { kind: 'userPaused' })
  }
}
