import { createApp } from 'vue'
import './style.css'
// Schools design system (CSS variables for schools dashboard components)
import './styles/design-tokens.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'
import { shouldReloadForPreloadError } from './utils/bootHeal'
import { loadWebFonts } from './utils/loadWebFonts'
import { selectPrecacheEntriesToPoison } from './utils/wedgeCheat'

// Cold-start boot marks (all from navigation start via performance.now()).
// mainExec = the main bundle (Vue + App + its static dep tree) has finished
// parsing/evaluating and the entry body is running; nav→mainExec is HTML +
// main-bundle fetch+parse. mounted = + createApp/mount. The player chunk +
// LearningPlayer.onMounted happen after; the [ColdStart] event reads these
// back to decompose the app-shell prefix.
const __ssiBoot = (window.__ssiBoot = window.__ssiBoot || {})
__ssiBoot.mainExecMs = Math.round(typeof performance !== 'undefined' ? performance.now() : 0)

// Web fonts, off the critical path. This module script is deferred and the
// links it appends are media="print" until they load, so a hanging font host
// can no longer stop the app painting — it just renders in the system fallback
// every font token already names. See utils/loadWebFonts.ts.
loadWebFonts()

// Debug tooling — preview deploys (*.vercel.app) or ?debug only, NEVER
// production. eruda is an on-screen console/network inspector so logs are
// visible ON the iPhone without tethering to a Mac.
//
// BUNDLED, not CDN (Tom 2026-05-28): the CDN script can't load in airplane
// mode, so the console was dead during exactly the offline-playback tests it
// was needed for. A dynamic import gets code-split into its own chunk that the
// SW precaches (globPatterns **/*.js) — so once the app has been opened online
// once, the console works fully offline. Loaded only when the debug gate is on.
const DEBUG_TOOLS =
  typeof location !== 'undefined' &&
  (location.hostname.includes('vercel.app') || location.search.includes('debug'))
if (DEBUG_TOOLS && !window.eruda) {
  import('eruda').then(({ default: eruda }) => {
    try {
      eruda.init()
      // Park the floating button bottom-left — the player's transport + mode
      // controls live across the top and centre; eruda's default spot overlaps
      // them. Still draggable.
      eruda.position({ x: 6, y: window.innerHeight - 52 })
      // Panel defaults to full-height and opaque, which hides the player during
      // live play. Shrink to the bottom ~45% and make it semi-transparent so
      // logs scroll underneath while the player stays visible. Tunable in
      // eruda's own Settings tab.
      const settings = eruda.get('settings')
      if (settings) {
        settings.set('displaySize', 45)
        settings.set('transparency', 0.85)
      }
    } catch (e) { /* noop */ }
  }).catch(() => { /* chunk not precached yet (first load was offline) — noop */ })
}

// `?wedge=1` dev cheat (docs/pwa-lifecycle-design.md §3, T6/T7): deliberately
// corrupts two precached JS chunks so a tester can rehearse the boot
// watchdog's recovery without waiting for a real browser-update wedge.
// __ENABLE_WEDGE_CHEAT__ is false on staging/production builds. Guarded by
// sessionStorage so it poisons exactly once per session — the poisoned
// reload is meant to fail and hand off to the watchdog's own heal ladder,
// not re-poison itself on every subsequent heal reload.
// @ts-ignore - __ENABLE_WEDGE_CHEAT__ is defined by Vite
const ENABLE_WEDGE_CHEAT = typeof __ENABLE_WEDGE_CHEAT__ !== 'undefined' && __ENABLE_WEDGE_CHEAT__
if (ENABLE_WEDGE_CHEAT && location.search.includes('wedge=1') && 'caches' in window) {
  const ARMED_KEY = 'ssi-wedge-armed'
  let alreadyArmed = false
  try { alreadyArmed = sessionStorage.getItem(ARMED_KEY) === '1' } catch { /* storage blocked */ }
  if (!alreadyArmed) {
    try { sessionStorage.setItem(ARMED_KEY, '1') } catch { /* storage blocked */ }
    poisonPrecacheForWedgeTest().catch(() => {}).finally(() => window.location.reload())
  }
}

async function poisonPrecacheForWedgeTest() {
  const entryGraphUrls = Array.from(
    document.querySelectorAll('script[src], link[rel="modulepreload"][href]')
  ).map((el) => el.src || el.href)

  const entries = [] // { cache, request }
  for (const cacheName of await caches.keys()) {
    const cache = await caches.open(cacheName)
    for (const request of await cache.keys()) {
      if (request.url.endsWith('.js')) entries.push({ cache, request })
    }
  }

  const targets = new Set(
    selectPrecacheEntriesToPoison(entries.map((e) => e.request.url), entryGraphUrls)
  )

  await Promise.all(
    entries
      .filter((e) => targets.has(e.request.url))
      .map((e) =>
        e.cache.put(
          e.request,
          new Response('/* ssi wedge poison test — deliberately corrupt */', {
            headers: { 'Content-Type': 'application/javascript' },
          })
        )
      )
  )
}

const app = createApp(App)

// Configure router
app.use(router)

app.mount('#app')
__ssiBoot.mountedMs = Math.round(typeof performance !== 'undefined' ? performance.now() : 0)

// Boot handshake for the inline watchdog in index.html — it can't import
// anything (must run even when every module fetch fails), so this is the
// one signal it polls for. Set immediately on mount, before anything else
// that could throw. See utils/bootHeal.ts + docs/pwa-lifecycle-design.md §2.1.
window.__SSI_BOOTED = true

// Remove loading state once app is mounted
document.getElementById('app')?.classList.remove('app-loading')

// vite:preloadError fires when a dynamic import 404s because a deploy
// rotated hashed chunk filenames mid-session (the chunk the running page
// knows about no longer exists). Reload once to pick up the new build;
// sessionStorage-guarded so a genuinely broken chunk doesn't reload-loop.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const GUARD_KEY = 'ssi-preload-error-reloaded'
  let alreadyReloaded = false
  try { alreadyReloaded = sessionStorage.getItem(GUARD_KEY) === '1' } catch { /* storage blocked */ }
  if (!shouldReloadForPreloadError(alreadyReloaded)) return
  try { sessionStorage.setItem(GUARD_KEY, '1') } catch { /* storage blocked */ }
  window.location.reload()
})
