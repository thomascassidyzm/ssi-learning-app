import { afterEach, describe, expect, it, vi } from 'vitest'
import { estimateStorage, resetStorageBackend, setStorageBackend, storagePressure } from './storage'

const nav = navigator as Navigator & { storage?: unknown }

afterEach(() => {
  resetStorageBackend()
  vi.unstubAllGlobals()
  delete (nav as { storage?: unknown }).storage
})

describe('browser storage backend (the web path, unchanged)', () => {
  it('returns {} when navigator.storage is absent — fail soft, keep downloading', async () => {
    expect(await estimateStorage()).toEqual({})
    expect(await storagePressure()).toBe(0)
  })

  it('reports usage/quota when the browser exposes them', async () => {
    ;(nav as { storage?: unknown }).storage = { estimate: async () => ({ usage: 250, quota: 1000 }) }
    expect(await estimateStorage()).toEqual({ usageBytes: 250, quotaBytes: 1000 })
    expect(await storagePressure()).toBe(0.25)
  })

  it('clamps pressure to 0..1', async () => {
    ;(nav as { storage?: unknown }).storage = { estimate: async () => ({ usage: 5000, quota: 1000 }) }
    expect(await storagePressure()).toBe(1)
  })

  it('never throws when estimate() rejects', async () => {
    ;(nav as { storage?: unknown }).storage = { estimate: async () => { throw new Error('nope') } }
    expect(await estimateStorage()).toEqual({})
  })
})

describe('swappable backend (what the native shell will use)', () => {
  it('a different backend answers without any call site changing', async () => {
    setStorageBackend({ estimate: async () => ({ usageBytes: 2_000_000_000, quotaBytes: 64_000_000_000 }) })
    const est = await estimateStorage()
    expect(est.quotaBytes).toBe(64_000_000_000)
    expect(await storagePressure()).toBeCloseTo(0.03125)
  })
})
