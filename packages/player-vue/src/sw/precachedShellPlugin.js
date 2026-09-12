/**
 * The navigation route's cache plugin: the only cached shell is the precached one.
 *
 * vite.config.js hands this object to workbox-build, which STRINGIFIES it into
 * the generated sw.js. So these functions run inside the service worker, not in
 * the app, and must close over nothing — only service-worker globals (`caches`,
 * `self`) are in scope where they land. Keep it import-free and self-contained.
 *
 * Why it exists (2026-09-12, job #377, Tom's airplane-mode report on staging):
 * the navigation route used to keep its own runtime copy of index.html. That
 * copy outlives a deploy: a new service worker installs and activates, the
 * precache swaps to the new build's chunks, and the runtime copy still names
 * the OLD build's chunks. One navigation on a slow network, where index.html
 * takes longer than the route's 3s network timeout, then serves that stale
 * shell; its chunks 404 on the CDN and are no longer precached; the inline
 * boot watchdog in index.html sees a same-origin script failure on a live
 * network, concludes the deploy is broken, and heals: it unregisters the
 * service worker and wipes every cache. Until the worker reinstalls in full,
 * the app cannot open offline at all. Six staging deploys in an hour made that
 * window easy to hit. Reproduced end to end in e2e/sw-stale-shell-redeploy-probe.mjs.
 *
 * The precached shell cannot go stale in that way: Workbox installs it and its
 * chunks together, and retires them together. So the route never stores a
 * runtime copy, and every cache read — network timeout or network failure —
 * answers with the precached shell instead.
 */
export const precachedShellPlugin = {
  // Never store a runtime copy of the shell.
  cacheWillUpdate: async () => null,

  // Every cache read answers with the precached index.html, ignoring whatever
  // a pre-fix worker left in the runtime cache. The precache is keyed with a
  // `__WB_REVISION__` query, hence ignoreSearch.
  cachedResponseWillBeUsed: async () => {
    const names = await caches.keys()
    const precacheName = names.find((n) => n.indexOf('workbox-precache') === 0)
    if (!precacheName) return null
    const precache = await caches.open(precacheName)
    const shellUrl = new URL('index.html', self.registration.scope).href
    const shell = await precache.match(shellUrl, { ignoreSearch: true })
    return shell || null
  },
}
