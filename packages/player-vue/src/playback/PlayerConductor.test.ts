import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PlayerConductor, type ConductorEngine } from './PlayerConductor'

/** Deferred promise helper — lets a test control exactly when an async body resolves/rejects. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Minimal fake engine — isPlaying flips on play/pause/resume/stop, everything else is a spy. */
function makeFakeEngine() {
  let isPlaying = false
  let sessionCompleteCb: (() => void) | null = null
  const engine: ConductorEngine = {
    get currentState() {
      return { isPlaying }
    },
    play: vi.fn(() => { isPlaying = true }),
    pause: vi.fn(() => { isPlaying = false }),
    resume: vi.fn(() => { isPlaying = true }),
    stop: vi.fn(() => { isPlaying = false }),
    skipRound: vi.fn(),
    stepCycle: vi.fn(),
    skipToPhase: vi.fn(),
    jumpToRound: vi.fn(),
    addRounds: vi.fn(),
    appendRounds: vi.fn(),
    replaceQueueFromCurrent: vi.fn(),
    on: vi.fn((event, cb) => {
      if (event === 'session_complete') sessionCompleteCb = cb
    }),
  }
  return {
    engine,
    setPlaying: (v: boolean) => { isPlaying = v },
    fireSessionComplete: () => sessionCompleteCb?.(),
  }
}

describe('PlayerConductor — direct requests', () => {
  it('request() applies immediately and reflects isPlaying into stable state', () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })

    conductor.request((e) => e.play())
    expect(engine.play).toHaveBeenCalledTimes(1)
    expect(conductor.currentState).toEqual({ kind: 'playing' })

    conductor.request((e) => e.pause())
    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
  })

  it('transitions to ended on session_complete', () => {
    const { engine, fireSessionComplete } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())

    fireSessionComplete()

    expect(conductor.currentState).toEqual({ kind: 'ended' })
  })

  it('notifies onStateChanged subscribers', () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    const states: string[] = []
    conductor.onStateChanged((s) => states.push(s.kind))

    conductor.request((e) => e.play())
    conductor.request((e) => e.pause())

    expect(states).toEqual(['playing', 'userPaused'])
  })
})

describe('PlayerConductor — runInterlude', () => {
  it('on success, trusts the body\'s own final engine state (including staying paused)', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())

    await conductor.runInterlude('commentary', async () => {
      // Body deliberately stays paused (e.g. "learner pressed stop mid-lap").
      conductor.request((e) => e.pause())
    })

    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
  })

  it('on success, resumes if the body left it playing', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())

    await conductor.runInterlude('pod-lap', async () => {
      conductor.request((e) => e.resume())
    })

    expect(conductor.currentState).toEqual({ kind: 'playing' })
  })

  it('pauses the engine on entry when it was playing', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())
    vi.mocked(engine.pause).mockClear()

    let pausedDuringBody = false
    await conductor.runInterlude('commentary', async () => {
      pausedDuringBody = !engine.currentState.isPlaying
    })

    expect(pausedDuringBody).toBe(true)
    expect(engine.pause).toHaveBeenCalled()
  })

  it('on thrown error, falls back to resuming (the ed738a0f contract) — never stranded', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())

    await conductor.runInterlude('pod-lap', async () => {
      throw new Error('scheduler.nextLap() blew up on unexpected data')
    })

    expect(conductor.currentState).toEqual({ kind: 'playing' })
    expect(engine.resume).toHaveBeenCalled()
  })

  it('on thrown error while it was NOT playing beforehand, lands userPaused (no spurious resume)', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    // Never played — starts paused.

    await conductor.runInterlude('commentary', async () => {
      throw new Error('boom')
    })

    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
    expect(engine.resume).not.toHaveBeenCalled()
  })

  it('bounded by timeout — a hung promise still lands the player instead of stranding it forever', async () => {
    vi.useFakeTimers()
    try {
      const { engine } = makeFakeEngine()
      const conductor = new PlayerConductor(engine, { devGuard: false })
      conductor.request((e) => e.play())

      const hang = new Promise<void>(() => {}) // never resolves
      const p = conductor.runInterlude('pod-lap', () => hang, { timeoutMs: 5000 })

      await vi.advanceTimersByTimeAsync(5001)
      await p

      expect(conductor.currentState).toEqual({ kind: 'playing' })
      expect(engine.resume).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('serializes: a second interlude waits for the first to fully land before starting', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())

    const first = deferred<void>()
    const order: string[] = []

    const p1 = conductor.runInterlude('commentary', async () => {
      order.push('first-start')
      await first.promise
      order.push('first-end')
    })
    const p2 = conductor.runInterlude('pod-lap', async () => {
      order.push('second-start')
    })

    // Let microtasks settle for anything already resolvable — second must NOT
    // have started yet since first hasn't resolved.
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['first-start'])

    first.resolve()
    await p1
    await p2

    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('a rejected interlude does not wedge the queue for the next one', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })

    await conductor.runInterlude('a', async () => { throw new Error('first fails') })
    let secondRan = false
    await conductor.runInterlude('b', async () => { secondRan = true })

    expect(secondRan).toBe(true)
  })
})

describe('PlayerConductor — runSeek', () => {
  it('captures pre-seek play intent, pauses, and restores it after fn resolves', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())
    vi.mocked(engine.pause).mockClear()

    let pausedDuringSeek = false
    await conductor.runSeek(async () => {
      pausedDuringSeek = !engine.currentState.isPlaying
      conductor.request((e) => e.jumpToRound(3))
    })

    expect(pausedDuringSeek).toBe(true)
    expect(engine.jumpToRound).toHaveBeenCalledWith(3)
    expect(conductor.currentState).toEqual({ kind: 'playing' })
  })

  it('does not resume if it was already paused before the seek', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })

    await conductor.runSeek(async () => {
      conductor.request((e) => e.jumpToRound(0))
    })

    expect(conductor.currentState).toEqual({ kind: 'userPaused' })
    expect(engine.resume).not.toHaveBeenCalled()
  })

  it('restores intent even when fn throws — bounded exit', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())

    await conductor.runSeek(async () => {
      throw new Error('prefetch blew up')
    })

    expect(conductor.currentState).toEqual({ kind: 'playing' })
  })

  it('cancel-and-replace: a second seek supersedes the first, which lands nothing itself', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())

    const first = deferred<void>()
    const staleFlags: boolean[] = []

    const p1 = conductor.runSeek(async (isStale) => {
      await first.promise
      staleFlags.push(isStale())
      conductor.request((e) => e.jumpToRound(1))
    })

    // Second seek fires WITHOUT waiting for the first — no queueing.
    const p2 = conductor.runSeek(async () => {
      conductor.request((e) => e.jumpToRound(2))
    })

    await p2
    first.resolve()
    await p1

    expect(staleFlags).toEqual([true])
    // The superseded seek's own jumpToRound(1) call may still fire (fn ran
    // to completion) — request() calls always apply — but only the LIVE
    // seek's landing (resume/land state) actually took effect, and the
    // final destination is whatever the last request() call left it at.
    expect(engine.jumpToRound).toHaveBeenCalledWith(2)
    expect(conductor.currentState).toEqual({ kind: 'playing' })
  })

  it('lands exactly once even when seeks are back-to-back — no double resume', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: false })
    conductor.request((e) => e.play())
    vi.mocked(engine.resume).mockClear()

    await conductor.runSeek(async () => { conductor.request((e) => e.jumpToRound(1)) })
    await conductor.runSeek(async () => { conductor.request((e) => e.jumpToRound(2)) })

    expect(engine.resume).toHaveBeenCalledTimes(2)
  })

  it('bounded by timeout on seek too', async () => {
    vi.useFakeTimers()
    try {
      const { engine } = makeFakeEngine()
      const conductor = new PlayerConductor(engine, { devGuard: false })
      conductor.request((e) => e.play())

      const hang = new Promise<void>(() => {})
      const p = conductor.runSeek(() => hang, { timeoutMs: 3000 })

      await vi.advanceTimersByTimeAsync(3001)
      await p

      expect(conductor.currentState).toEqual({ kind: 'playing' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PlayerConductor — dev guard', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('warns on a direct engine call that bypasses the conductor', () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: true })
    void conductor // keep the conductor alive so the guard installed on `engine` stays meaningful

    engine.pause()

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('bypassing the conductor'),
      expect.anything(),
    )
  })

  it('does NOT warn when the call is routed through conductor.request()', () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: true })

    conductor.request((e) => e.pause())

    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('does NOT warn for calls made from inside runInterlude/runSeek bodies via request()', async () => {
    const { engine } = makeFakeEngine()
    const conductor = new PlayerConductor(engine, { devGuard: true })
    conductor.request((e) => e.play())

    await conductor.runInterlude('commentary', async () => {
      conductor.request((e) => e.resume())
    })
    await conductor.runSeek(async () => {
      conductor.request((e) => e.jumpToRound(0))
    })

    expect(errorSpy).not.toHaveBeenCalled()
  })
})
