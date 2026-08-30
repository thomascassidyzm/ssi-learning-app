import { describe, it, expect, vi } from 'vitest'
import { waitForCatalogue, usableCatalogue, catalogueRetryDelay } from './catalogueWait'

const ok = () => ({ error: null, data: [{ course_code: 'zho_for_eng' }] })
const never = () => new Promise<never>(() => {})
const fast = (attempt: number) => [20, 40, 80, 120][Math.min(attempt, 3)]

/** Resolve if `p` settles within `ms`, else the string 'still-waiting'. */
const within = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise((r) => setTimeout(() => r('still-waiting'), ms))])

describe('usableCatalogue', () => {
  it('rejects errors, empties and nothings; accepts rows', () => {
    expect(usableCatalogue(null)).toBeNull()
    expect(usableCatalogue({ error: { message: 'nope' }, data: [{ a: 1 }] })).toBeNull()
    expect(usableCatalogue({ error: null, data: [] })).toBeNull()
    expect(usableCatalogue({ error: null, data: undefined })).toBeNull()
    expect(usableCatalogue(ok())).toEqual(ok())
  })
})

describe('catalogueRetryDelay', () => {
  it('climbs and then holds forever rather than growing without bound', () => {
    expect(catalogueRetryDelay(0)).toBe(2000)
    expect(catalogueRetryDelay(3)).toBe(15000)
    expect(catalogueRetryDelay(999)).toBe(15000)
  })
})

describe('waitForCatalogue', () => {
  it('takes the in-flight result without starting anything new', async () => {
    const startQuery = vi.fn(never)
    await expect(waitForCatalogue(Promise.resolve(ok()), { startQuery, delayFor: fast })).resolves.toEqual(ok())
    expect(startQuery).not.toHaveBeenCalled()
  })

  it('rescues a HUNG in-flight request with a fresh one', async () => {
    const startQuery = vi.fn(async () => ok())
    await expect(waitForCatalogue(never(), { startQuery, delayFor: fast })).resolves.toEqual(ok())
    expect(startQuery).toHaveBeenCalledTimes(1)
  })

  it('rescues a REJECTED in-flight request with a fresh one', async () => {
    const startQuery = vi.fn(async () => ok())
    await expect(
      waitForCatalogue(Promise.reject(new Error('offline')), { startQuery, delayFor: fast }),
    ).resolves.toEqual(ok())
    expect(startQuery).toHaveBeenCalledTimes(1)
  })

  it('rescues an in-flight request that returned an ERROR result', async () => {
    const startQuery = vi.fn(async () => ok())
    await expect(
      waitForCatalogue(Promise.resolve({ error: { message: 'boom' }, data: null }), { startQuery, delayFor: fast }),
    ).resolves.toEqual(ok())
  })

  it('keeps trying, paced, when every attempt FAILS FAST — the hang this module had', async () => {
    // The regression that matters: a fast-failing network must not leave the
    // loop awaiting a timer that was already cleared. It must keep retrying.
    const startQuery = vi.fn(async () => { throw new Error('dns') })
    const r = await within(waitForCatalogue(Promise.reject(new Error('dns')), { startQuery, delayFor: fast }), 300)
    expect(r).toBe('still-waiting')
    expect(startQuery.mock.calls.length).toBeGreaterThan(1)
  })

  it('keeps trying, paced, when every attempt HANGS', async () => {
    const startQuery = vi.fn(never)
    const r = await within(waitForCatalogue(never(), { startQuery, delayFor: fast }), 300)
    expect(r).toBe('still-waiting')
    expect(startQuery.mock.calls.length).toBeGreaterThan(1)
  })

  it('does not spin: retries are paced by the backoff, not fired in a tight loop', async () => {
    const startQuery = vi.fn(async () => { throw new Error('dns') })
    await within(waitForCatalogue(Promise.reject(new Error('dns')), { startQuery, delayFor: () => 50 }), 260)
    // ~5 slots of 50ms; a spinning loop would be in the thousands.
    expect(startQuery.mock.calls.length).toBeLessThan(12)
  })

  it('still takes a slow in-flight request that lands late', async () => {
    const late = new Promise((r) => setTimeout(() => r(ok()), 150))
    const startQuery = vi.fn(never)
    await expect(waitForCatalogue(late, { startQuery, delayFor: fast })).resolves.toEqual(ok())
  })

  it('supersedes each stale attempt so sockets cannot accumulate', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const startQuery = vi.fn((signal?: AbortSignal) => { signals.push(signal); return never() })
    void within(waitForCatalogue(never(), { startQuery, delayFor: fast }), 220)
    await new Promise((r) => setTimeout(r, 220))
    expect(signals.length).toBeGreaterThan(1)
    // every attempt but the newest has been aborted
    expect(signals.slice(0, -1).every((s) => s?.aborted)).toBe(true)
  })
})
