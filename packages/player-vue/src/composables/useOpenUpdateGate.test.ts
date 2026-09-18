/**
 * The on-open update gate, tested at the two places it can hurt somebody: the
 * decision to hold the screen, and what happens after it does.
 *
 * Every case below is one of the five rules in the composable's header, and
 * the "offline" and "mid-play" cases are the ones that matter most — a screen
 * that holds the app when there is no update to take is worse than the silence
 * it replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  decideHold,
  runOpenUpdateGate,
  keepWaiting,
  updateHolding,
  updateSlow,
  readAttempt,
  writeAttempt,
  clearAttempt,
  ATTEMPT_KEY,
  OPEN_WINDOW_MS,
  SLOW_MS,
  PAINT_MS,
  __resetGateForTest,
} from './useOpenUpdateGate'

const OLD = { buildNumber: 'aaa1111', buildTime: '2026-09-18T10:00:00Z' }
const NEW = { buildNumber: 'bbb2222', buildTime: '2026-09-18T12:00:00Z' }

const base = {
  running: OLD,
  latest: NEW,
  elapsedSinceOpenMs: 100,
  isPlaying: false,
  attemptedBuild: null as string | null,
}

describe('decideHold — when the app may take the screen to update', () => {
  it('holds when the live build is provably newer, at open, with nothing playing', () => {
    expect(decideHold(base)).toEqual({ hold: true, reason: null })
  })

  it('does NOT hold when the version answer could not be read (offline is not an update)', () => {
    expect(decideHold({ ...base, latest: null })).toEqual({ hold: false, reason: 'no-answer' })
  })

  it('does NOT hold when we are already on the live build — nothing paints', () => {
    expect(decideHold({ ...base, latest: OLD })).toEqual({ hold: false, reason: 'already-current' })
  })

  it('does NOT hold on a merely DIFFERENT build that is not provably newer', () => {
    // A local build cut after the deployment is ahead of it, not behind it.
    const ahead = { buildNumber: 'ccc3333', buildTime: '2026-09-18T09:00:00Z' }
    expect(decideHold({ ...base, latest: ahead })).toEqual({ hold: false, reason: 'already-current' })
  })

  it('does NOT hold while audio is sounding (Tom\'s standing rule)', () => {
    expect(decideHold({ ...base, isPlaying: true })).toEqual({ hold: false, reason: 'playing' })
  })

  it('does NOT hold once the open window has passed — the banner owns it from there', () => {
    expect(decideHold({ ...base, elapsedSinceOpenMs: OPEN_WINDOW_MS + 1 }))
      .toEqual({ hold: false, reason: 'too-late' })
  })

  it('does NOT hold twice for the same target build — one attempt, never a reload loop', () => {
    expect(decideHold({ ...base, attemptedBuild: NEW.buildNumber }))
      .toEqual({ hold: false, reason: 'already-tried' })
  })

  it('DOES hold for a build newer than the one already attempted', () => {
    expect(decideHold({ ...base, attemptedBuild: 'zzz9999' })).toEqual({ hold: true, reason: null })
  })
})

describe('the attempt record', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('round-trips through sessionStorage and clears', () => {
    expect(readAttempt()).toBeNull()
    writeAttempt('bbb2222')
    expect(sessionStorage.getItem(ATTEMPT_KEY)).toBe('bbb2222')
    expect(readAttempt()).toBe('bbb2222')
    clearAttempt()
    expect(readAttempt()).toBeNull()
  })

  it('writes nothing for a missing build id rather than storing a blank', () => {
    writeAttempt(null)
    expect(readAttempt()).toBeNull()
  })
})

describe('runOpenUpdateGate — what the learner actually gets', () => {
  beforeEach(() => {
    __resetGateForTest()
    sessionStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    __resetGateForTest()
  })

  it('holds the screen, records the target and reloads AFTER the screen has painted', async () => {
    const reload = vi.fn()
    const decision = await runOpenUpdateGate({
      fetchLatest: async () => NEW,
      now: () => 0,
      isPlaying: () => false,
      reload,
      running: OLD,
    })

    expect(decision.hold).toBe(true)
    expect(updateHolding.value).toBe(true)
    expect(updateSlow.value).toBe(false)
    // The whole complaint was a reload nobody was told about: the screen is up
    // before the document goes away, not after.
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(PAINT_MS)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(readAttempt()).toBe(NEW.buildNumber)
  })

  it('admits it is slow after SLOW_MS, and "Keep waiting" re-arms that admission', async () => {
    await runOpenUpdateGate({
      fetchLatest: async () => NEW,
      now: () => 0,
      isPlaying: () => false,
      reload: vi.fn(),
      running: OLD,
    })
    expect(updateSlow.value).toBe(false)
    vi.advanceTimersByTime(SLOW_MS)
    expect(updateSlow.value).toBe(true)

    keepWaiting()
    expect(updateSlow.value).toBe(false)
    vi.advanceTimersByTime(SLOW_MS)
    expect(updateSlow.value).toBe(true)
  })

  it('paints nothing and reloads nothing when offline', async () => {
    const reload = vi.fn()
    const decision = await runOpenUpdateGate({
      fetchLatest: async () => null,
      now: () => 0,
      isPlaying: () => false,
      reload,
      running: OLD,
    })
    expect(decision).toEqual({ hold: false, reason: 'no-answer' })
    expect(updateHolding.value).toBe(false)
    vi.advanceTimersByTime(SLOW_MS * 2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('never takes over audio that is sounding', async () => {
    const reload = vi.fn()
    const decision = await runOpenUpdateGate({
      fetchLatest: async () => NEW,
      now: () => 0,
      isPlaying: () => true,
      reload,
      running: OLD,
    })
    expect(decision.reason).toBe('playing')
    expect(updateHolding.value).toBe(false)
    vi.advanceTimersByTime(PAINT_MS)
    expect(reload).not.toHaveBeenCalled()
  })

  it('clears a spent attempt record once we are demonstrably on the live build', async () => {
    writeAttempt(NEW.buildNumber)
    await runOpenUpdateGate({
      fetchLatest: async () => NEW,
      now: () => 0,
      isPlaying: () => false,
      reload: vi.fn(),
      running: NEW,
    })
    expect(readAttempt()).toBeNull()
  })

  it('refuses a second reload towards a build it already tried (no reload loop)', async () => {
    writeAttempt(NEW.buildNumber)
    const reload = vi.fn()
    const decision = await runOpenUpdateGate({
      fetchLatest: async () => NEW,
      now: () => 0,
      isPlaying: () => false,
      reload,
      running: OLD,
    })
    expect(decision.reason).toBe('already-tried')
    expect(updateHolding.value).toBe(false)
    vi.advanceTimersByTime(PAINT_MS)
    expect(reload).not.toHaveBeenCalled()
    // and the record survives, so the next open does not try again either
    expect(readAttempt()).toBe(NEW.buildNumber)
  })

  it('runs once per document — a second call is a no-op', async () => {
    const reload = vi.fn()
    await runOpenUpdateGate({ fetchLatest: async () => NEW, now: () => 0, isPlaying: () => false, reload, running: OLD })
    const second = await runOpenUpdateGate({ fetchLatest: async () => NEW, now: () => 0, isPlaying: () => false, reload, running: OLD })
    expect(second.hold).toBe(false)
    vi.advanceTimersByTime(PAINT_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
