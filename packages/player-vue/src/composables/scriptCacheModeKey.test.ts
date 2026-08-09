/**
 * The script cache must be able to tell Easy's walk from Fast's.
 *
 * Tom, 2026-08-09, retesting the mid-session mode toggle live: switching modes
 * "does not correctly change which phrases play — complete fail", and only a
 * browser cache clear plus a reload ever made a mode change visible. The reason
 * a CACHE clear was involved at all is here: the entry was keyed on the course
 * alone, so the walk built under one mode was re-hydrated for the other on
 * every single load, permanently.
 *
 * These tests pin the key's mode segment and the one deliberate exception to
 * it — offline, where a script in the wrong shape beats no script at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Minimal in-memory stand-in for the `idb` store the cache writes through.
const store = new Map<string, unknown>()
vi.mock('idb', () => ({
  openDB: async () => ({
    objectStoreNames: { contains: () => true },
    get: async (_s: string, k: string) => store.get(k),
    put: async (_s: string, v: unknown, k: string) => { store.set(k, v) },
    delete: async (_s: string, k: string) => { store.delete(k) },
    close: () => {},
  }),
  deleteDB: async () => {},
}))
vi.mock('./listeningMetaCache', () => ({ refreshListeningMetaIfStale: async () => {} }))

const script = (tag: string) => ({
  courseCode: 'cym_for_eng',
  rounds: [{ roundNumber: 1, legoId: 'S0001L01', seedId: 'S0001', items: [], tag }],
  totalSeeds: 1,
  totalLegos: 1,
  totalCycles: 1,
  audioMapObj: {},
})

const online = (value: boolean) =>
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true })

describe('script cache — the learning mode is part of the key', () => {
  beforeEach(() => {
    store.clear()
    online(true)
  })

  it('does not serve the Fast walk to a learner on Easy', async () => {
    const { setCachedScript, getCachedScript, setScriptCacheMode } = await import('./useScriptCache')

    setScriptCacheMode('fast')
    await setCachedScript('cym_for_eng', script('fast-walk') as never)

    setScriptCacheMode('easy')
    // A miss is the CORRECT answer online: it makes the player walk the course
    // again under Easy, which is the whole point of the toggle.
    expect(await getCachedScript('cym_for_eng')).toBeNull()
  })

  it('keeps both modes side by side, each returning its own walk', async () => {
    const { setCachedScript, getCachedScript, setScriptCacheMode } = await import('./useScriptCache')

    setScriptCacheMode('fast')
    await setCachedScript('cym_for_eng', script('fast-walk') as never)
    setScriptCacheMode('easy')
    await setCachedScript('cym_for_eng', script('easy-walk') as never)

    expect((await getCachedScript('cym_for_eng'))?.rounds[0]).toMatchObject({ tag: 'easy-walk' })
    setScriptCacheMode('fast')
    expect((await getCachedScript('cym_for_eng'))?.rounds[0]).toMatchObject({ tag: 'fast-walk' })
  })

  it('offline, falls back to the other mode rather than leaving the learner with nothing', async () => {
    const { setCachedScript, getCachedScript, setScriptCacheMode } = await import('./useScriptCache')

    setScriptCacheMode('fast')
    await setCachedScript('cym_for_eng', script('fast-walk') as never)

    setScriptCacheMode('easy')
    online(false)
    expect((await getCachedScript('cym_for_eng'))?.rounds[0]).toMatchObject({ tag: 'fast-walk' })
  })

  it('a mode-keyed write retires the pre-mode-key entry for that course', async () => {
    const { setCachedScript, setScriptCacheMode } = await import('./useScriptCache')

    store.set('v10:cym_for_eng', script('legacy-walk'))
    setScriptCacheMode('easy')
    await setCachedScript('cym_for_eng', script('easy-walk') as never)

    expect(store.has('v10:cym_for_eng')).toBe(false)
    expect(store.has('v10:cym_for_eng:easy')).toBe(true)
  })
})
