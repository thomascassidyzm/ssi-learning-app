import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// Generate build info at build time
const buildTime = new Date().toISOString()
const buildNumber = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
                    process.env.GIT_COMMIT?.slice(0, 7) ||
                    `dev-${Date.now().toString(36)}`

// SW self-update policy by environment:
//   dev      → auto-update on reload (rapid churn; testers want fresh code,
//              and mixed stale bundles across deploys were a testing nightmare)
//   staging  → prompt-only, like production (the external/Colombo team vets
//              staging as a prod CANDIDATE, so they must experience the real
//              tap-to-update flow — and this is the only place that flow gets
//              exercised before it reaches live users)
//   main/prod→ prompt-only, honouring the never-auto-interrupt-a-live-session rule
// Vercel tags BOTH dev and staging as VERCEL_ENV='preview' (production branch is
// `main`), so we additionally carve staging out by branch name.
const swSelfUpdate = process.env.VERCEL_ENV !== 'production'
  && process.env.VERCEL_GIT_COMMIT_REF !== 'staging'

// Emits /version.json (static, never precached — see globPatterns below) so
// the running app can ask "what build is actually live right now?" without
// going through the service worker at all. This is what lets the update
// banner tell a genuinely-new deploy apart from a waiting SW that's stale
// only in SW-bookkeeping terms (see PwaUpdatePrompt.vue for why that gap
// exists). Reuses the exact same buildNumber as __BUILD_NUMBER__ so the two
// are always comparable.
const versionFilePlugin = () => ({
  name: 'ssi-version-file',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ buildNumber }),
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    versionFilePlugin(),
    VitePWA({
      // prompt: new SW waits until the user actively triggers it (banner
      // or blue dot). Tom's hard rule (2026-05-21): NEVER force-update
      // while audio is playing — autoUpdate's automatic SKIP_WAITING
      // posts controllerchange, vite-plugin-pwa reloads the page, and
      // any cycle audio mid-flight is killed. Reverts the autoUpdate
      // change from 18f4c27. The stale-bundle risk it addressed is
      // mitigated by NetworkFirst on navigations (so the next natural
      // page load always sees the fresh shell) + cleanupOutdatedCaches.
      registerType: 'prompt',

      workbox: {
        // Precache the app SHELL only. globPatterns catches all built assets;
        // globIgnores then removes weight no learner needs on the critical path:
        //   - the eruda debug console (~500KB, only ever loaded via ?debug)
        //   - the entire /admin surface chunks (admins are never offline)
        //   - static marketing/design mockups copied from public/
        // These still load from the network on demand if ever reached; keeping
        // them out of the precache shrinks the install every learner pays for.
        // DEFERRED to a staging-validated follow-up (they touch offline-teacher
        // use and the delicate stale-bundle path): trimming the schools-view +
        // echarts chunks, and the shadowed NetworkFirst navigation route.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],

        globIgnores: [
          '**/*.{mp3,wav,ogg,m4a}', // audio → runtime caching / IndexedDB, never precache
          '**/eruda-*.js',          // debug console, ?debug-only
          '**/Admin*.js',           // /admin surface chunks — never needed offline by learners
          '**/echarts-*.js',        // ~1MB charting lib, lazy-loaded only inside insight/admin boards
          '**/schools-*.js',        // /schools surface, loaded on demand (never an offline learner path)
          '**/_schools-mockups/**', // static HTML mockups
          '**/paddle-review/**',    // Paddle verification artifact
          '**/design/**',           // design-doc mockups
        ],

        // Workbox' default navigation handler returns the cached index.html
        // for *every* document navigation, which intercepts requests like
        // /terms before they can hit Vercel's cross-origin rewrite. List the
        // paths we want to bypass the SW so the rewrite to the marketing
        // site actually runs. /api/* must also stay on the network.
        navigateFallbackDenylist: [
          /^\/paddle-review$/,
          /^\/terms$/,
          /^\/privacy$/,
          /^\/refunds$/,
          /^\/api\//,
        ],

        // Clear ALL runtime caches when a new SW activates.
        // This ensures stale audio/font caches never persist across deploys.
        // Cost: users re-download audio after each deploy.
        // Acceptable: main deploys are weekly at most.
        cleanupOutdatedCaches: true,

        // skipWaiting + clientsClaim MUST be false to honour registerType:
        // 'prompt'. With them true, the new SW self-activates immediately
        // on install and claims every tab — interrupting any in-flight
        // session (audio killed mid-cycle, in-memory player state lost).
        // The "Update" button in PwaUpdatePrompt calls
        // updateServiceWorker(true), which posts SKIP_WAITING to the
        // waiting SW only when the user actively opts in. That path
        // remains the only way the new SW takes control. Tom's hard rule
        // (2026-05-22, learnt the hard way during a session): NEVER
        // interrupt a playing session with an automatic update.
        // Preview/local: self-update so testers run fresh code on reload
        // (mixed stale bundles were the testing nightmare). PRODUCTION: both
        // false — honour the never-auto-interrupt rule documented above.
        skipWaiting: swSelfUpdate,
        clientsClaim: swSelfUpdate,

        // Runtime caching for fonts/CDN/audio
        runtimeCaching: [
          // Document navigations (the HTML shell): NetworkFirst so a fresh
          // deploy propagates on next navigation without the user having to
          // explicitly tap "Update". Without this, the precache serves the
          // OLD index.html — which references OLD hashed JS bundles that no
          // longer exist on Vercel after a redeploy → MIME error on those
          // chunks. 3s timeout means offline users still fall back to cache.
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'navigation-cache',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          // NOTE: audio is deliberately NOT cached by the service worker.
          //
          // The SW intercepting /api/audio with CacheFirst was the source
          // of a long-running iOS Safari class of bug: iOS requires a 206
          // for <audio> Range requests, and the SW (and Vercel's edge)
          // served cached bodies in ways that flapped working/broken across
          // launches as the SW version cycled (prompt/skipWaiting:false).
          //
          // We're streaming-first now: audio goes straight to the origin
          // proxy (which returns correct 206s) and the browser's own HTTP
          // cache handles per-device repeat plays. Reliable OFFLINE is a
          // separate, deliberate path — the download bundle + IndexedDB
          // AudioCache ('ssi-audio-cache-v2'), independent of the SW. So
          // the SW has no business in the audio path; removing it makes
          // every launch behave identically. (2026-05-24)
        ],
      },

      manifest: {
        name: 'SaySomethingin',
        short_name: 'SSi',
        description: 'Learn languages naturally with immersive audio-based learning',
        theme_color: '#050508',
        background_color: '#050508',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split stable vendor + engine code into their own chunks.
        // Cold-start parse cost is ~NEUTRAL (the browser still downloads/parses
        // the same total JS before the player is interactive), but WARM/repeat
        // loads win big: a routine app-code deploy (LearningPlayer.vue etc.)
        // rotates only the small app chunks while vendor-vue / vendor-supabase /
        // core keep their content hashes and stay served from the HTTP cache and
        // the Workbox precache — so returning users / PWA precache stop
        // re-downloading ~700-800kB of unchanged vendor on every deploy.
        manualChunks(id) {
          const n = id.replace(/\\/g, '/')
          if (
            n.includes('/node_modules/vue/') ||
            n.includes('/node_modules/@vue/') ||
            n.includes('/node_modules/vue-router/') ||
            n.includes('/node_modules/@vueuse/')
          ) {
            return 'vendor-vue'
          }
          if (n.includes('/node_modules/@supabase/')) {
            return 'vendor-supabase'
          }
          // @ssi/core resolves via the pnpm workspace symlink to packages/core/dist
          if (n.includes('/packages/core/dist') || n.includes('/@ssi/core/')) {
            return 'core'
          }
          // echarts (+ its zrender dep) is only ever reached via `import('echarts')`
          // inside insight/admin widgets. Force it into its own named chunk so it
          // stays out of the entry graph AND can be excluded from the SW precache
          // below — otherwise it's a ~1MB download every learner pays for on
          // install despite never opening a board. Still lazy: loads on demand
          // when a board first mounts, then lives in the HTTP cache.
          if (n.includes('/node_modules/echarts/') || n.includes('/node_modules/zrender/')) {
            return 'echarts'
          }
          // The whole /schools surface is route-lazy and never imported by the
          // learner player (verified: nothing outside src/*/schools/ imports it).
          // Group it into one named chunk so it, too, stays out of the precache —
          // teachers/admins load it on demand online; it's never an offline
          // learner path.
          if (
            n.includes('/src/views/schools/') ||
            n.includes('/src/composables/schools/') ||
            n.includes('/src/components/schools/')
          ) {
            return 'schools'
          }
        },
      },
    },
  },
  esbuild: mode === 'production'
    ? { pure: ['console.log', 'console.info', 'console.debug'] }
    : undefined,
}))
