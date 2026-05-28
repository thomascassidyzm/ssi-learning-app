import { createApp } from 'vue'
import './style.css'
// Schools design system (CSS variables for schools dashboard components)
import './styles/design-tokens.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'

// Debug tooling — preview deploys (*.vercel.app) or ?debug only, NEVER
// production. Loads eruda, an on-screen console/network inspector, so logs
// are visible ON the iPhone without tethering to a Mac. Loaded early to
// capture startup logs; fails silently (offline / CSP) without affecting
// the app.
const DEBUG_TOOLS =
  typeof location !== 'undefined' &&
  (location.hostname.includes('vercel.app') || location.search.includes('debug'))
if (DEBUG_TOOLS && !window.eruda) {
  const s = document.createElement('script')
  s.src = 'https://cdn.jsdelivr.net/npm/eruda'
  s.onload = () => { try { window.eruda.init() } catch (e) { /* noop */ } }
  document.head.appendChild(s)
}

const app = createApp(App)

// Configure router
app.use(router)

app.mount('#app')

// Remove loading state once app is mounted
document.getElementById('app')?.classList.remove('app-loading')
