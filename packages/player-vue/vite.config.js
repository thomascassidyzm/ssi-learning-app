import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// Generate build info at build time
const buildTime = new Date().toISOString()
const buildNumber = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
                    process.env.GIT_COMMIT?.slice(0, 7) ||
                    `dev-${Date.now().toString(36)}`

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
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
        // Precache app shell
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],

        // DON'T cache audio via workbox precache - runtime caching handles it
        globIgnores: ['**/*.{mp3,wav,ogg,m4a}'],

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
  },
  esbuild: mode === 'production'
    ? { pure: ['console.log', 'console.info', 'console.debug'] }
    : undefined,
}))
