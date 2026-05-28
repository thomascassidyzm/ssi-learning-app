import { createApp } from 'vue'
import './style.css'
// Schools design system (CSS variables for schools dashboard components)
import './styles/design-tokens.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'

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

const app = createApp(App)

// Configure router
app.use(router)

app.mount('#app')

// Remove loading state once app is mounted
document.getElementById('app')?.classList.remove('app-loading')
