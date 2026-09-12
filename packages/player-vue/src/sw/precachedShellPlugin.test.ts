import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { precachedShellPlugin } from './precachedShellPlugin.js'

// A Cache Storage stand-in: the stale runtime copy sits in navigation-cache,
// the real shell sits in the precache under a revision query.
function fakeCaches(entries: Record<string, Record<string, string>>) {
  const open = async (name: string) => ({
    match: async (url: string, opts?: { ignoreSearch?: boolean }) => {
      const store = entries[name] || {}
      for (const key of Object.keys(store)) {
        const k = opts?.ignoreSearch ? key.split('?')[0] : key
        if (k === url) return new Response(store[key])
      }
      return undefined
    },
  })
  return { keys: async () => Object.keys(entries), open }
}

const SCOPE = 'https://staging.saysomethingin.app/'
let savedCaches: unknown
let savedSelf: unknown

beforeEach(() => {
  savedCaches = (globalThis as any).caches
  savedSelf = (globalThis as any).self.registration
  ;(globalThis as any).self.registration = { scope: SCOPE }
})
afterEach(() => {
  ;(globalThis as any).caches = savedCaches
  ;(globalThis as any).self.registration = savedSelf
})

describe('precachedShellPlugin', () => {
  it('never stores a runtime copy of the shell', async () => {
    expect(await precachedShellPlugin.cacheWillUpdate()).toBeNull()
  })

  it('answers a cache read with the PRECACHED shell, not the runtime copy a pre-fix worker left behind', async () => {
    ;(globalThis as any).caches = fakeCaches({
      'ssi-auth-handoff': {},
      'navigation-cache': { [SCOPE]: '<html>stale build A</html>' },
      ['workbox-precache-v2-' + SCOPE]: { [SCOPE + 'index.html?__WB_REVISION__=abc123']: '<html>precached build B</html>' },
    })
    const res = await precachedShellPlugin.cachedResponseWillBeUsed()
    expect(res).toBeInstanceOf(Response)
    expect(await res!.text()).toBe('<html>precached build B</html>')
  })

  it('returns null when nothing is precached, so the route falls through to the network', async () => {
    ;(globalThis as any).caches = fakeCaches({ 'navigation-cache': { [SCOPE]: '<html>stale</html>' } })
    expect(await precachedShellPlugin.cachedResponseWillBeUsed()).toBeNull()
  })

  it('is self-contained: workbox stringifies it into sw.js, so it may reference only service-worker globals', () => {
    for (const fn of Object.values(precachedShellPlugin)) {
      const src = fn.toString()
      expect(src).not.toMatch(/\bimport\b|\brequire\(/)
      // The only free identifiers it may use.
      const code = src.replace(/'[^']*'|"[^"]*"/g, '')
      const idents = new Set(code.match(/\b[a-zA-Z_$][\w$]*\b/g))
      for (const banned of ['matchPrecache', 'workbox', 'window', 'document', 'process']) expect(idents.has(banned)).toBe(false)
    }
  })
})
