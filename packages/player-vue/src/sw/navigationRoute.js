/**
 * The service worker's document-navigation route, as handed to workbox-build's
 * runtimeCaching by vite.config.js. Like precachedShellPlugin.js, everything
 * here is STRINGIFIED into sw.js — the urlPattern and the plugin run inside the
 * worker and may close over nothing.
 *
 * The policy, in one line: fresh from the network when the network answers in
 * time, otherwise the PRECACHED shell — never a runtime copy.
 *
 * NetworkFirst so a fresh deploy propagates on the next navigation without the
 * user having to tap "Update". Without it the precache serves the OLD
 * index.html, which names OLD hashed chunks that no longer exist on Vercel
 * after a redeploy — MIME error on every chunk. The 3s timeout is what keeps a
 * slow or absent network from stranding the learner: the timeout and the
 * failure path both fall back to the precached shell, whose chunks were
 * installed alongside it and are therefore always there.
 *
 * This route used to keep its own copy of index.html in navigation-cache and
 * fall back to THAT. See precachedShellPlugin.js for how that copy outlived a
 * redeploy and ended in Tom's airplane-mode "Safari can't open the page"
 * (2026-09-12, job #377).
 */
import { precachedShellPlugin } from './precachedShellPlugin.js'

export const navigationRoute = {
  urlPattern: ({ request }) => request.mode === 'navigate',
  handler: 'NetworkFirst',
  options: {
    // Kept as a name only: the plugin never writes to it, and App.vue's
    // invalidateStaleCaches deletes any pre-fix copy on the first boot of a
    // new build.
    cacheName: 'navigation-cache',
    networkTimeoutSeconds: 3,
    plugins: [precachedShellPlugin],
    // Belt to the plugin's braces: if the strategy throws outright (network
    // gone AND no precache answered), Workbox's own fallback serves the
    // precached shell. This is what makes "airplane-mode open the app" reach
    // the player at all — the always-play invariant's first link.
    precacheFallback: { fallbackURL: 'index.html' },
  },
}
