import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// Generate build info at build time
const buildTime = new Date().toISOString()
const buildNumber = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
                    process.env.GIT_COMMIT?.slice(0, 7) ||
                    `dev-${Date.now().toString(36)}`

// Dev-only affordances (the `?wedge=1` boot-watchdog rehearsal cheat). Vercel
// tags BOTH dev and staging as VERCEL_ENV='preview' (production branch is
// `main`), so staging is carved out by branch name — it must behave exactly
// like production, since it's the prod CANDIDATE the external team vets.
//
// NOTE (2026-08-07): this flag used to ALSO drive skipWaiting/clientsClaim, so
// dev and local builds let a new SW claim a live page the moment it installed.
// That is a mid-session teardown by another name — see the skipWaiting comment
// below for why no environment does it any more.
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
  server: {
    proxy: {
      '/api': { target: 'https://ssi-learning-app-git-dev-zenjin.vercel.app', changeOrigin: true },
    },
  },
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
        // Bundle the workbox runtime INTO sw.js. The default (false) emits a
        // separate workbox-*.js pulled in through an async self.define shim —
        // which registers the fetch/navigation handlers AFTER the SW's initial
        // script evaluation. Chromium only reliably dispatches top-level
        // navigations to handlers registered synchronously at first evaluation,
        // so offline cold starts skipped the SW entirely and landed on the
        // browser "No internet" page despite a full precache (2026-07-31,
        // reproduced with a dead server + e2e/sw-offline-shell-probe.mjs).
        // Inlining makes registration synchronous; offline nav serves the shell.
        inlineWorkboxRuntime: true,

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
          // schools-*.js is deliberately NOT ignored: the chunk graph hoists
          // shared modules into it, making it a static dep of boot-path chunks
          // (observed 2026-07-31: offline boot stalled loading schools-*.js).
          // ~300KB precache cost buys a boot that always completes offline.
          // Self-hosted fonts (2026-08-26): public/fonts/core/** IS precached —
          // ~204KB of DM Sans / JetBrains Mono / Space Mono / Noto Sans JP,
          // latin + latin-ext, the faces every learner's UI is actually made
          // of, so a cold offline boot is fully typeset with zero network.
          // public/fonts/ext/** is the per-language coverage subsets (Cyrillic,
          // Greek, Devanagari, Vietnamese) and the schools-only faces: ~954KB
          // that most learners never render. Same doctrine as the schools and
          // echarts chunks — vendored and same-origin, but picked up by the
          // runtime CacheFirst route below on first use, not paid for at
          // install. See scripts/vendor-fonts.mjs.
          '**/fonts/ext/**',
          '**/_schools-mockups/**', // static HTML mockups
          '**/paddle-review/**',    // Paddle verification artifact
          '**/design/**',           // design-doc mockups
          '**/board/**',            // one-off board reports, never an offline learner path
        ],

        // The precache route must not answer navigations either (2026-08-07).
        // Workbox's PrecacheRoute is registered FIRST, before any runtimeCaching
        // route, and by default it retries a URL ending in "/" with
        // `directoryIndex` appended — so a navigation to "/" matched the
        // precached index.html and was served CacheFirst from the OLD shell. The
        // NetworkFirst navigation route below never saw it, which quietly made
        // "just reload to get the new build" untrue: the ONLY way new code ever
        // reached a learner was a new SW ACTIVATING and swapping the precache —
        // i.e. exactly the destructive path that killed live sessions. Null
        // leaves index.html precached (precacheFallback still serves it offline)
        // while letting navigations reach the network first.
        directoryIndex: null,

        // NO precache NavigationRoute. vite-plugin-pwa DEFAULTS navigateFallback
        // to 'index.html', which registers a NavigationRoute bound to the
        // precached shell FIRST — shadowing the NetworkFirst navigation route
        // below (so fresh deploys never propagated through it) AND, observed
        // 2026-07-31 with a dead server, failing offline navigations through to
        // the network → the browser "No internet" page instead of the cached
        // shell. One navigation route below owns the whole story instead:
        // NetworkFirst online (fresh deploys propagate, /terms etc. reach
        // Vercel's rewrites), precacheFallback offline (the shell ALWAYS loads).
        navigateFallback: null,

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
        // FALSE IN EVERY ENVIRONMENT (2026-08-07). Dev/preview used to set
        // both true so testers "got fresh code on reload" — but a new SW that
        // claims a live page also runs Workbox's precache cleanup, which
        // deletes every chunk whose content changed in that build. The page
        // keeps running with a hole where its own code used to be, and the
        // next lazy import 404s: the app dies mid-session with no user action
        // at all. Reproduced in e2e/sw-update-probe.mjs (dev config: the new
        // SW claims the page and 10 of 21 entry chunks go 404).
        // Testers still get fresh code on reload without this: navigations are
        // NetworkFirst, so a plain reload always fetches the new index.html
        // and its new chunks. One lifecycle, all environments.
        skipWaiting: false,
        clientsClaim: false,

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
              // Offline floor: when the network is gone AND navigation-cache
              // has no entry (cold offline start), serve the precached shell.
              // This is what makes "airplane-mode open the app" reach the
              // player at all — the always-play invariant's first link.
              precacheFallback: { fallbackURL: 'index.html' },
            },
          },
          // The non-precached font subsets: per-language coverage (Cyrillic,
          // Greek, Devanagari, Vietnamese) and the schools-only faces. Same
          // origin now — the fonts.googleapis.com / fonts.gstatic.com routes
          // that used to sit here were retired on 2026-08-26 when the fonts
          // were self-hosted; nothing in the app requests a font host any more.
          // (The standalone marketing/methodology HTML under public/ still
          // links Google directly. Those are separate documents, not the app
          // boot path, and the CSP in vercel.json still allows them.)
          // maxEntries covers every file in public/fonts/ext with room to
          // spare; the old routes' maxEntries:10 could not even hold one
          // language's subsets.
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/fonts/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ssi-fonts-cache',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 365 },
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
        // Mist palette (matches index.html's pre-hydration bg + design-tokens.css
        // --bg-primary) — was the deprecated dark "cosmos" theme's black, which
        // gave every installed PWA a black splash screen on launch.
        theme_color: '#D9D6D2',
        background_color: '#e8e3dd',
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
    // `?wedge=1` boot-watchdog rehearsal cheat (docs/pwa-lifecycle-design.md
    // §3) — dev only. Reuses swSelfUpdate's exact env carve-out (not
    // production, not the staging branch) rather than inventing a second
    // "is this dev" check.
    __ENABLE_WEDGE_CHEAT__: JSON.stringify(swSelfUpdate),
  },
  build: {
    sourcemap: true,
    // The vendored circle-flags country set (assets/flags/countries/) is looked
    // up by import.meta.glob, so every one of the ~267 files is referenced at
    // build time even though a learner ever sees one or two. Inlining them as
    // data URIs would add ~230kB to the schools chunk for nothing — keep them
    // as separate emitted assets, fetched only when a variant course shows one.
    // Everything else keeps Vite's default 4kB inline behaviour.
    assetsInlineLimit: (filePath) =>
      filePath.includes('/assets/flags/countries/') ? false : undefined,
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
